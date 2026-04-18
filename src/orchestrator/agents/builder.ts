import { BaseAgent } from './base.ts';
import { HandoffPayload, HandoffRecord, TaskRecord, RepoRecord, StagedMutationRef } from '../types.ts';
import { SafeWriter } from '../fs-sandbox.ts';

export class BuilderAgent extends BaseAgent {
  async run(task: TaskRecord, previousHandoff: HandoffRecord | null, repo: RepoRecord | null): Promise<HandoffPayload> {
    const prompt = `
      You are the BUILDER agent. Your sole purpose is to implement code changes.
      Target Repository Path: ${repo ? repo.path : 'None provided'}
      Task Goal: ${task.goal}
      Scope: ${task.scope}
      Non-goals: ${task.non_goals}
      Previous Handoff: ${previousHandoff?.message || 'None'}
      
      Respond with exactly the files changed, code paths, and test steps.
      Format changes as:
      --- FILE: path/to/file ---
      [CONTENT]
      --- END ---
    `;
    
    let responseText = await this.llm.createChatCompletion([{ role: 'system', content: this.record.instruction_profile }, { role: 'user', content: prompt }]);

    const stagedMutations: StagedMutationRef[] = [];

    // Stage mutations through SafeWriter — builder never commits directly
    if (repo) {
        const writer = new SafeWriter(repo.path);
        
        const fileRegex = /---\s*FILE:\s*(.*?)\s*---([\s\S]*?)---\s*END\s*---/g;
        let match;
        while ((match = fileRegex.exec(responseText)) !== null) {
            const targetPath = match[1].trim();
            const content = match[2];
            try {
                const isTruthFile = targetPath.includes('AOK_TRUTH_');
                const allowOverwrite = isTruthFile || task.goal.includes('OVERWRITE');
                const stageId = await writer.stageMutation(task.id, targetPath, content, 'overwrite', { allowOverwrite });
                stagedMutations.push({
                    stageId,
                    targetPath,
                    operationType: 'overwrite',
                    allowOverwrite
                });
            } catch (err: any) {
                responseText += `\n[BUILD ERROR] Failed to stage ${targetPath}: ${err.message}`;
            }
        }
    }

    return {
      message: responseText,
      staged_mutations: stagedMutations,
      suggested_state_transition: 'implemented'
    };
  }
}
