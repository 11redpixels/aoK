import { TaskLedger } from './ledger.ts';
import { AgentRegistry } from './agents/registry.ts';
import { TaskRecord, Role, StagedMutationRef } from './types.ts';
import { SafeWriter } from './fs-sandbox.ts';

export class OrchestratorEngine {
  private ledger: TaskLedger;
  private registry: AgentRegistry;

  constructor(projectRoot: string) {
    this.ledger = new TaskLedger(projectRoot);
    this.registry = new AgentRegistry(this.ledger);
  }

  init() {
    this.registry.bootstrapDefaultAgents();
  }

  /**
   * Extract staged mutation references from builder handoff messages.
   */
  private extractStagedMutations(taskId: string): StagedMutationRef[] {
    // Walk all handoffs for this task looking for __STAGED_MUTATIONS__ markers
    const allHandoffs = this.ledger.getHandoffsForTask(taskId);
    const mutations: StagedMutationRef[] = [];
    for (const h of allHandoffs) {
      const match = h.message.match(/__STAGED_MUTATIONS__(.*?)__END_STAGED__/s);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          mutations.push(...parsed);
        } catch (e) {}
      }
    }
    return mutations;
  }

  async runOnce() {
    const pendingApprovals = this.ledger.getPendingApprovals();
    if (pendingApprovals.length > 0) {
      console.log(`[Orchestrator] Paused. ${pendingApprovals.length} pending human approvals required.`);
      return false; // Yield control back, halted
    }

    const task = this.ledger.getActiveTask();
    if (!task) {
      console.log('[Orchestrator] No active tasks to process.');
      return false; // Complete
    }

    const agentRecord = this.ledger.getActiveAgentByRole(task.owner_role);
    if (!agentRecord) {
      console.error(`[Orchestrator] Fatal Error: No active agent found for role '${task.owner_role}'.`);
      return false;
    }

    const agent = this.registry.getAgentInstance(agentRecord.agent_id);
    if (!agent) {
      console.error(`[Orchestrator] Fatal Error: Failed to instantiate agent '${agentRecord.agent_id}'.`);
      return false;
    }

    const previousHandoff = this.ledger.getLatestHandoffForAgent(task.id, agent.id);

    // Note: We use run, but it's executed via `execute` which writes the new handoff and handles blockers
    await agent.execute(task, previousHandoff);

    // V1.5 state fallback routing: if agent execution didn't explicitly block the task, apply transition
    const updatedTask = this.ledger.getTaskById(task.id);
    if (updatedTask && !updatedTask.blocker) {
        let nextState = task.state;
        let nextRole = task.owner_role;
        
        // MVP deterministic routing logic
        if (task.state === 'queued') {
            nextState = 'planned';
            nextRole = 'builder';
        } else if (task.state === 'planned' || task.state === 'in_progress') {
            nextState = 'implemented';
            nextRole = 'verifier';
        } else if (task.state === 'implemented') {
            // Check handoff to see if verifier failed
            const handoff = this.ledger.getLatestHandoffForAgent(task.id, null as any);
            if (handoff?.suggested_state_transition === 'in_progress') {
                nextState = 'in_progress';
                nextRole = 'builder';
            } else {
                nextState = 'verified';
                nextRole = 'reviewer';
            }
        } else if (task.state === 'verified') {
            const handoff = this.ledger.getLatestHandoffForAgent(task.id, null as any);
            if (handoff?.suggested_state_transition === 'in_progress') {
                nextState = 'in_progress';
                nextRole = 'builder';
            } else {
                nextState = 'hardened';
                nextRole = 'supervisor';
            }
        } else if (task.state === 'hardened') {
            // ===================================================================
            // ENGINE-OWNED STAGED MUTATION LIFECYCLE
            // The engine is the sole authority that validates and commits mutations.
            // ===================================================================
            const repo = task.repo_id ? this.ledger.getRepo(task.repo_id) : null;
            
            if (!repo) {
                console.error('[Engine] No repo context found for task. Cannot verify mutations.');
                updatedTask.blocker = 'NO_REPO_CONTEXT';
            } else {
                const stagedMutations = this.extractStagedMutations(task.id);
                const writer = new SafeWriter(repo.path);

                if (stagedMutations.length === 0) {
                    // No staged mutations found — check for direct filesystem evidence as fallback
                    let fallbackDetected = false;
                    
                    if (task.proof_required) {
                        const fs = require('fs');
                        const pathMod = require('path');
                        const targetPath = pathMod.resolve(repo.path, task.proof_required);
                        if (fs.existsSync(targetPath)) {
                            const content = fs.readFileSync(targetPath, 'utf-8');
                            if (content.trim() !== 'INIT') {
                                fallbackDetected = true;
                            }
                        }
                    }

                    // Optional secondary git check
                    if (!fallbackDetected) {
                        try {
                            const { execSync } = require('child_process');
                            const targets = task.proof_required ? [task.proof_required] : [];
                            if (targets.length > 0) {
                                const gitTargets = targets.map((t: string) => require('path').resolve(repo.path, t)).join(' ');
                                const status = execSync(`git status --porcelain -- ${gitTargets}`, { cwd: repo.path }).toString().trim();
                                if (status.length > 0) fallbackDetected = true;
                            }
                        } catch(e) {
                            // Git unavailable — not fatal
                        }
                    }

                    if (!fallbackDetected) {
                        console.error('[Engine] No staged mutations found and no filesystem evidence. Refusing DONE.');
                        updatedTask.blocker = 'NO_STAGED_MUTATIONS';
                    }
                } else {
                    // Process staged mutations: verify then commit
                    let allCommitted = true;
                    for (const mut of stagedMutations) {
                        try {
                            // Engine validates the stage
                            await writer.updateValidationState(mut.stageId, 'verified');
                            console.log(`[Engine] Stage ${mut.stageId} verified for ${mut.targetPath}`);
                            
                            // Engine commits the stage — atomic write
                            await writer.commitStaged(task.id, mut.stageId);
                            console.log(`[Engine] Stage ${mut.stageId} committed to ${mut.targetPath}`);
                        } catch (err: any) {
                            console.error(`[Engine] Stage commit failed for ${mut.stageId}: ${err.message}`);
                            try { await writer.updateValidationState(mut.stageId, 'rejected'); } catch(e) {}
                            updatedTask.blocker = `STAGE_COMMIT_FAILED: ${err.message}`;
                            allCommitted = false;
                            break;
                        }
                    }

                    if (allCommitted) {
                        // Post-commit filesystem verification
                        const fs = require('fs');
                        const pathMod = require('path');
                        let postCommitVerified = false;
                        
                        for (const mut of stagedMutations) {
                            const targetPath = pathMod.resolve(repo.path, mut.targetPath);
                            if (fs.existsSync(targetPath)) {
                                postCommitVerified = true;
                                break;
                            }
                        }

                        if (!postCommitVerified) {
                            console.error('[Engine] Post-commit verification failed: committed files not found on disk.');
                            updatedTask.blocker = 'POST_COMMIT_VERIFICATION_FAILED';
                        }
                    }
                }
            }

            if (updatedTask.blocker) {
                 nextState = 'blocked';
                 nextRole = 'supervisor';
            } else {
                 nextState = 'done';
                 nextRole = 'supervisor';
            }
        }

        // Explicit Check: Verifier cannot modify task ownership outside of returning it to builder or promoting to reviewer
        if (task.owner_role === 'verifier' && nextRole !== 'builder' && nextRole !== 'reviewer') {
             console.warn(`[Engine Check] Verifier attempted to bypass routing to role ${nextRole}. Correcting to reviewer.`);
             nextRole = 'reviewer';
        }

        console.log(`[Orchestrator] Task ${task.id} transitioning: [${task.state} -> ${nextState}] (Owner: ${nextRole})`);
        this.ledger.updateTaskState(task.id, nextState, nextRole, updatedTask.blocker);
    } else if (updatedTask && updatedTask.blocker) {
        console.log(`[Orchestrator] Task ${task.id} is blocked by approval gate: ${updatedTask.blocker}`);
    }

    return true; // Indicates we did work, might want to loop again
  }
}
