import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { AgentRecord, ApprovalRecord, HandoffRecord, TaskRecord, TaskRunRecord, ArtifactRecord, RepoRecord } from './types.ts';

export class TaskLedger {
  private db: Database.Database;

  constructor(projectRoot: string) {
    const dbDir = path.join(projectRoot, '.aok');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'ledger.sqlite');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        instruction_profile TEXT NOT NULL,
        allowed_actions TEXT NOT NULL,
        status TEXT NOT NULL,
        provider_metadata TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        path TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        repo_id TEXT REFERENCES repos(id),
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        scope TEXT NOT NULL,
        non_goals TEXT NOT NULL,
        owner_role TEXT NOT NULL,
        state TEXT NOT NULL,
        definition_of_done TEXT NOT NULL,
        proof_required TEXT NOT NULL,
        blocker TEXT,
        next_recommended_role TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        agent_id TEXT NOT NULL REFERENCES agents(agent_id),
        status TEXT NOT NULL,
        started_at DATETIME,
        completed_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        from_agent_id TEXT REFERENCES agents(agent_id),
        to_agent_id TEXT REFERENCES agents(agent_id),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        message TEXT NOT NULL,
        artifacts_referenced TEXT,
        suggested_state_transition TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        path TEXT NOT NULL,
        hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        gate_type TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by_agent_id TEXT REFERENCES agents(agent_id),
        reason TEXT NOT NULL,
        human_feedback TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration logic for repo_id if the table was created before V1.6
    try {
      const columns = this.db.pragma('table_info(tasks)') as any[];
      const hasRepoId = columns.some(col => col.name === 'repo_id');
      if (!hasRepoId) {
        this.db.exec('ALTER TABLE tasks ADD COLUMN repo_id TEXT REFERENCES repos(id);');
      }
    } catch (err) {
      console.warn('[Ledger] Migration check for repo_id skipped or failed', err);
    }
  }

  // --- Repositories ---
  attachRepo(repo: RepoRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO repos (id, name, path, is_active)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        path=excluded.path,
        is_active=excluded.is_active
    `);
    stmt.run(repo.id, repo.name, repo.path, repo.is_active ? 1 : 0);
  }

  listRepos(): RepoRecord[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY name ASC').all() as any[];
    return rows.map(r => ({ ...r, is_active: r.is_active === 1 }));
  }

  useRepo(name: string): boolean {
    const transaction = this.db.transaction(() => {
      // First check if it exists
      const target = this.db.prepare('SELECT id FROM repos WHERE name = ?').get(name);
      if (!target) return false;
      this.db.prepare('UPDATE repos SET is_active = 0').run();
      this.db.prepare('UPDATE repos SET is_active = 1 WHERE name = ?').run(name);
      return true;
    });
    return transaction();
  }

  getActiveRepoContext(): RepoRecord | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE is_active = 1 LIMIT 1').get() as any;
    if (!row) return null;
    return { ...row, is_active: true };
  }

  getRepo(id: string): RepoRecord | null {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, is_active: row.is_active === 1 };
  }

  // --- Agents ---
  upsertAgent(agent: AgentRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO agents (agent_id, name, role, instruction_profile, allowed_actions, status, provider_metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        name=excluded.name,
        role=excluded.role,
        instruction_profile=excluded.instruction_profile,
        allowed_actions=excluded.allowed_actions,
        status=excluded.status,
        provider_metadata=excluded.provider_metadata
    `);
    stmt.run(
      agent.agent_id,
      agent.name,
      agent.role,
      agent.instruction_profile,
      JSON.stringify(agent.allowed_actions),
      agent.status,
      JSON.stringify(agent.provider_metadata)
    );
  }

  getAgent(agentId: string): AgentRecord | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as any;
    if (!row) return null;
    return {
      ...row,
      allowed_actions: JSON.parse(row.allowed_actions),
      provider_metadata: JSON.parse(row.provider_metadata),
    };
  }

  getActiveAgentByRole(role: string): AgentRecord | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE role = ? AND status = ? LIMIT 1').get(role, 'active') as any;
    if (!row) return null;
    return {
      ...row,
      allowed_actions: JSON.parse(row.allowed_actions),
      provider_metadata: JSON.parse(row.provider_metadata),
    };
  }

  // --- Tasks ---
  createTask(task: TaskRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, repo_id, title, goal, scope, non_goals, owner_role, state, definition_of_done, proof_required, blocker, next_recommended_role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id, task.repo_id, task.title, task.goal, task.scope, task.non_goals, task.owner_role, task.state, task.definition_of_done, task.proof_required, task.blocker, task.next_recommended_role
    );
  }

  updateTaskState(taskId: string, state: string, ownerRole: string, blocker: string | null = null) {
    this.db.prepare(`
      UPDATE tasks SET state = ?, owner_role = ?, blocker = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(state, ownerRole, blocker, taskId);
  }

  getActiveTask(): TaskRecord | null {
    const row = this.db.prepare(
      "SELECT * FROM tasks WHERE state NOT IN ('done', 'rejected') AND blocker IS NULL ORDER BY created_at ASC LIMIT 1"
    ).get() as any;
    return row || null;
  }
  
  getTaskById(taskId: string): TaskRecord | null {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any || null;
  }

  // --- Handoffs ---
  createHandoff(handoff: HandoffRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO handoffs (id, task_id, from_agent_id, to_agent_id, message, artifacts_referenced, suggested_state_transition)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      handoff.id,
      handoff.task_id,
      handoff.from_agent_id,
      handoff.to_agent_id,
      handoff.message,
      JSON.stringify(handoff.artifacts_referenced),
      handoff.suggested_state_transition
    );
  }

  getLatestHandoffForAgent(taskId: string, targetAgentId: string): HandoffRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM handoffs 
      WHERE task_id = ? AND to_agent_id = ? 
      ORDER BY timestamp DESC LIMIT 1
    `).get(taskId, targetAgentId) as any;
    if (!row) return null;
    return {
      ...row,
      artifacts_referenced: row.artifacts_referenced ? JSON.parse(row.artifacts_referenced) : []
    };
  }

  getHandoffsForTask(taskId: string): HandoffRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM handoffs WHERE task_id = ? ORDER BY timestamp ASC
    `).all(taskId) as any[];
    return rows.map(row => ({
      ...row,
      artifacts_referenced: row.artifacts_referenced ? JSON.parse(row.artifacts_referenced) : []
    }));
  }

  // --- Approvals ---
  createApproval(approval: ApprovalRecord) {
    const stmt = this.db.prepare(`
      INSERT INTO approvals (id, task_id, gate_type, status, requested_by_agent_id, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(approval.id, approval.task_id, approval.gate_type, approval.status, approval.requested_by_agent_id, approval.reason);
  }

  getPendingApprovals(): ApprovalRecord[] {
    return this.db.prepare("SELECT * FROM approvals WHERE status = 'pending'").all() as ApprovalRecord[];
  }

  resolveApproval(approvalId: string, status: 'approved' | 'rejected', feedback: string | null) {
    this.db.prepare(`
      UPDATE approvals SET status = ?, human_feedback = ?, timestamp = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, feedback, approvalId);
  }
}
