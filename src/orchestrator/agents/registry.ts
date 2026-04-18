import { TaskLedger } from '../ledger.ts';
import { AgentRecord } from '../types.ts';
import { BaseAgent } from './base.ts';
import { SupervisorAgent } from './supervisor.ts';
import { BuilderAgent } from './builder.ts';
import { VerifierAgent } from './verifier.ts';
import { ReviewerAgent } from './reviewer.ts';

export class AgentRegistry {
  private ledger: TaskLedger;

  constructor(ledger: TaskLedger) {
    this.ledger = ledger;
  }

  bootstrapDefaultAgents() {
    const agents: AgentRecord[] = [
      {
        agent_id: 'agent_sup_01',
        name: 'Supervisor',
        role: 'supervisor',
        instruction_profile: 'You own task state transitions and decide what runs next.',
        allowed_actions: ['assign_task', 'update_state'],
        status: 'active',
        provider_metadata: { provider: 'openai', model: 'gpt-4o' }
      },
      {
        agent_id: 'agent_bld_01',
        name: 'Builder',
        role: 'builder',
        instruction_profile: 'You write code. Return exactly the files changed.',
        allowed_actions: ['write_file', 'edit_file'],
        status: 'active',
        provider_metadata: { provider: 'openai', model: 'gpt-4o' }
      },
      {
        agent_id: 'agent_ver_01',
        name: 'Verifier',
        role: 'verifier',
        instruction_profile: 'You run tests and verify the code.',
        allowed_actions: ['run_command'],
        status: 'active',
        provider_metadata: { provider: 'openai', model: 'gpt-4o' }
      },
      {
        agent_id: 'agent_rev_01',
        name: 'Reviewer',
        role: 'reviewer',
        instruction_profile: 'You check for edge cases and hardening.',
        allowed_actions: ['read_file'],
        status: 'active',
        provider_metadata: { provider: 'openai', model: 'gpt-4o' }
      }
    ];

    for (const agent of agents) {
      this.ledger.upsertAgent(agent);
    }
  }

  getAgentInstance(agentId: string): BaseAgent | null {
    const record = this.ledger.getAgent(agentId);
    if (!record) return null;

    switch (record.role) {
      case 'supervisor': return new SupervisorAgent(record, this.ledger);
      case 'builder': return new BuilderAgent(record, this.ledger);
      case 'verifier': return new VerifierAgent(record, this.ledger);
      case 'reviewer': return new ReviewerAgent(record, this.ledger);
      default: return null;
    }
  }
}
