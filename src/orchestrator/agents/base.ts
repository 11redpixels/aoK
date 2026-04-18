import { AgentRecord, HandoffPayload, TaskRecord, HandoffRecord, RepoRecord } from '../types.ts';
import { TaskLedger } from '../ledger.ts';
import { createLLMProvider, LLMProvider, AOKConfigLLM } from '../../llm/index.ts';

export abstract class BaseAgent {
  protected record: AgentRecord;
  protected ledger: TaskLedger;
  protected llm: LLMProvider;

  constructor(record: AgentRecord, ledger: TaskLedger) {
    this.record = record;
    this.ledger = ledger;

    const llmConfig: AOKConfigLLM = {
      provider: record.provider_metadata.provider || 'openai',
      model: record.provider_metadata.model || 'gpt-4o',
      apiKey: process.env.AOK_API_KEY
    };
    this.llm = createLLMProvider(llmConfig);
  }

  get id() { return this.record.agent_id; }
  get role() { return this.record.role; }

  // Must be implemented by specific agents (Builder, Verifier, etc)
  abstract run(task: TaskRecord, previousHandoff: HandoffRecord | null, repo: RepoRecord | null): Promise<HandoffPayload>;

  /**
   * Helper to write a simple handoff when an agent is done
   */
  async execute(task: TaskRecord, previousHandoff: HandoffRecord | null): Promise<void> {
    console.log(`[Agent ${this.record.name} (${this.role})] Executing task ${task.id}...`);
    
    // Explicit engine-level checks
    if (this.role === 'supervisor' && this.record.allowed_actions.includes('write_file')) {
        console.warn(`[Warning] Supervisor should not have write_file permission.`);
    }

    const repo = task.repo_id ? this.ledger.getRepo(task.repo_id) : null;
    const payload = await this.run(task, previousHandoff, repo);

    if (payload.request_approval) {
      if (this.role === 'builder') {
          throw new Error('Permission Denied: Builder cannot request approvals.');
      }
      const approvalId = Math.random().toString(36).substring(2, 9);
      this.ledger.createApproval({
        id: approvalId,
        task_id: task.id,
        gate_type: payload.request_approval.gate_type,
        status: 'pending',
        requested_by_agent_id: this.id,
        reason: payload.request_approval.reason,
        human_feedback: null,
        timestamp: new Date().toISOString()
      });
      // Mark task as blocked
      this.ledger.updateTaskState(task.id, task.state, task.owner_role, approvalId);
    }

    const nextRole = payload.suggested_state_transition ? this.mapTransitionToRole(payload.suggested_state_transition) : task.next_recommended_role;
    let toAgentId = null;
    if (nextRole) {
      // Security Check: Verifier cannot modify task ownership outside of typical routing. We handle actual ownership in engine.ts.
      const nextAgent = this.ledger.getActiveAgentByRole(nextRole);
      if (nextAgent) toAgentId = nextAgent.agent_id;
    }

    const handoff: HandoffRecord = {
      id: Math.random().toString(36).substring(2, 9),
      task_id: task.id,
      from_agent_id: this.id,
      to_agent_id: toAgentId,
      timestamp: new Date().toISOString(),
      message: payload.message,
      artifacts_referenced: payload.artifacts_referenced || [],
      suggested_state_transition: payload.suggested_state_transition || null
    };

    // Encode staged mutations into the handoff message metadata so engine can retrieve them
    if (payload.staged_mutations && payload.staged_mutations.length > 0) {
      handoff.message += `\n\n__STAGED_MUTATIONS__${JSON.stringify(payload.staged_mutations)}__END_STAGED__`;
    }

    if (this.role === 'reviewer' && handoff.message.includes('expand scope')) {
       throw new Error('Permission Denied: Reviewer cannot expand scope.');
    }

    this.ledger.createHandoff(handoff);
  }

  // Simplified mapping for V1.5 routing fallback
  private mapTransitionToRole(transition: string): string | null {
    if (transition === 'in_progress') return 'builder';
    if (transition === 'implemented') return 'verifier';
    if (transition === 'verified') return 'reviewer';
    if (transition === 'hardened' || transition === 'done') return 'supervisor';
    return null;
  }
}
