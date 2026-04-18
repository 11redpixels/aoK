import { BaseAgent } from './base.ts';
import { HandoffPayload, HandoffRecord, TaskRecord, RepoRecord } from '../types.ts';

export class ReviewerAgent extends BaseAgent {
  async run(task: TaskRecord, previousHandoff: HandoffRecord | null, repo: RepoRecord | null): Promise<HandoffPayload> {
    const prompt = `
      You are the REVIEWER agent. Check for hardening, edge cases, auth, transactions, race conditions, cleanup.
      Target Repository Path: ${repo ? repo.path : 'None provided'}
      Task Goal: ${task.goal}
      Verifier's Check: ${previousHandoff?.message || 'None'}
      
      Review and verify edge cases. If changes are needed, send back to builder. Otherwise pass.
    `;
    
    const responseText = await this.llm.createChatCompletion([{ role: 'system', content: this.record.instruction_profile }, { role: 'user', content: prompt }]);

    const isPass = responseText.includes('PASS');

    return {
      message: responseText,
      suggested_state_transition: isPass ? 'hardened' : 'in_progress'
    };
  }
}
