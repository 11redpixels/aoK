export type Role = 'supervisor' | 'builder' | 'verifier' | 'reviewer';
export type TaskState = 'queued' | 'planned' | 'in_progress' | 'implemented' | 'verified' | 'hardened' | 'blocked' | 'done' | 'rejected';
export type AgentStatus = 'active' | 'offline' | 'paused';
export type RunStatus = 'running' | 'completed' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface AgentRecord {
  agent_id: string;
  name: string;
  role: Role;
  instruction_profile: string;
  allowed_actions: string[];
  status: AgentStatus;
  provider_metadata: Record<string, any>;
}

export interface RepoRecord {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
  created_at: string;
}

export interface TaskRecord {
  id: string;
  repo_id: string | null;
  title: string;
  goal: string;
  scope: string;
  non_goals: string;
  owner_role: Role;
  state: TaskState;
  definition_of_done: string;
  proof_required: string;
  blocker: string | null;
  next_recommended_role: Role | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRunRecord {
  id: string;
  task_id: string;
  agent_id: string;
  status: RunStatus;
  started_at: string;
  completed_at: string | null;
}

export interface HandoffRecord {
  id: string;
  task_id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  timestamp: string;
  message: string;
  artifacts_referenced: string[];
  suggested_state_transition: string | null;
}

export interface ArtifactRecord {
  id: string;
  task_id: string;
  path: string;
  hash: string;
  created_at: string;
}

export interface ApprovalRecord {
  id: string;
  task_id: string;
  gate_type: string;
  status: ApprovalStatus;
  requested_by_agent_id: string | null;
  reason: string;
  human_feedback: string | null;
  timestamp: string;
}

export interface StagedMutationRef {
  stageId: string;
  targetPath: string;
  operationType: 'patch' | 'overwrite';
  allowOverwrite: boolean;
}

export interface HandoffPayload {
  message: string;
  artifacts_referenced?: string[];
  suggested_state_transition?: string;
  staged_mutations?: StagedMutationRef[];
  request_approval?: {
    gate_type: string;
    reason: string;
  };
}
