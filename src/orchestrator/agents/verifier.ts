import { BaseAgent } from './base.ts';
import { HandoffPayload, HandoffRecord, TaskRecord, RepoRecord } from '../types.ts';

export class VerifierAgent extends BaseAgent {
  async run(task: TaskRecord, previousHandoff: HandoffRecord | null, repo: RepoRecord | null): Promise<HandoffPayload> {
    const prompt = `
      You are the VERIFIER agent. You must check actual files and determine if the claimed builder implementation is real.
      Target Repository Path: ${repo ? repo.path : 'None provided'}
      Definition of Done: ${task.definition_of_done}
      Proof Required: ${task.proof_required}
      Builder's Claim: ${previousHandoff?.message || 'None'}
      
      Return PASS/FAIL with exact evidence.
    `;
    
    const responseText = await this.llm.createChatCompletion([{ role: 'system', content: this.record.instruction_profile }, { role: 'user', content: prompt }]);

    // Naive parse for V1.5 to decide transition based on PASS/FAIL in text
    const isPass = responseText.includes('PASS');

    return {
      message: responseText,
      suggested_state_transition: isPass ? 'verified' : 'in_progress' // Sent back to builder if failed
    };
  }
}
