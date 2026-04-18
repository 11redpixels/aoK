import { BaseAgent } from './base.ts';
import { HandoffPayload, HandoffRecord, TaskRecord, RepoRecord } from '../types.ts';

export class SupervisorAgent extends BaseAgent {
  async run(task: TaskRecord, previousHandoff: HandoffRecord | null, repo: RepoRecord | null): Promise<HandoffPayload> {
    const prompt = `
      You are the SUPERVISOR agent. You own task state transitions and decide what runs next.
      Target Repository Path: ${repo ? repo.path : 'None provided'}
      Task State: ${task.state}
      Previous Handoff: ${previousHandoff?.message || 'None'}
      
      Decide the next action or sign off on completion.
    `;
    
    const responseText = await this.llm.createChatCompletion([{ role: 'system', content: this.record.instruction_profile }, { role: 'user', content: prompt }]);

    let transition = 'planned';
    if (task.state === 'queued') {
        transition = 'planned';
    } else if (task.state === 'hardened') {
        transition = 'done';
    } else if (task.state === 'verified') {
        // Technically REVIEWER runs after VERIFIER in V1.5, so if the task falls back to the SUPERVISOR at Verified, it pushes it forward or backward
        transition = 'done'; 
    }

    return {
      message: responseText,
      suggested_state_transition: transition
    };
  }
}
