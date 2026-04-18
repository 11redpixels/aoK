import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createFailureCaptureReport, parseRawErrors, writeFailureCaptureReport } from '../src/failures.ts';
import { runUXValidator } from '../src/intelligence/ux-validator.ts';
import type { Failure } from '../src/intelligence/ux-validator.ts';
import { runAutonomousRepair } from '../src/repair/autonomous-loop.ts';
import { generateEvolutionReport } from '../src/memory/evolution.ts';
import { getExplorationPressure, runExplorationWindow } from '../src/exploration/engine.ts';
import { getConfig, resolveConfig } from '../src/config.ts';
import { writeLog, generateId } from '../src/logger.ts';
import { listProposals, updateProposalStatus, type ProposalStatus } from '../src/proposal-registry.ts';
import { chooseConfigFilename, detectValidationCommand } from '../src/project-discovery.ts';
import { OrchestratorEngine, TaskLedger } from '../src/orchestrator/index.ts';

const program = new Command();
const CLI_DIR = path.dirname(fs.realpathSync(process.argv[1] ?? process.cwd()));
const TEMPLATE_DIR = resolveTemplateDir();

program
  .name('aok')
  .description('Agent Operating Kernel — Autonomous Software Maintenance Engine')
  .version('1.0.0');

// ========================================================
// INIT
// ========================================================
program
  .command('init')
  .description('Initialize AOK configuration and templates in the current project.')
  .action(() => {
    const cwd = process.cwd();
    const aokDir = path.join(cwd, '.aok');
    const memoryDir = path.join(aokDir, 'memory');
    const failuresFile = path.join(aokDir, 'e2e-failures.json');
    const templateDir = TEMPLATE_DIR;
    const configFilename = chooseConfigFilename(cwd);
    const configPath = path.join(cwd, configFilename);
    const detected = detectValidationCommand(cwd);

    console.log('\n🔧 Initializing AOK...\n');

    // ── 1. Create Core Directories ──
    if (!fs.existsSync(aokDir)) fs.mkdirSync(aokDir, { recursive: true });
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    if (!fs.existsSync(failuresFile)) {
      writeFailureCaptureReport(failuresFile, createFailureCaptureReport([], 'passed'));
    }

    // ── 2. Copy Templates if available ──
    if (fs.existsSync(templateDir)) {
      copyDirSync(templateDir, cwd, new Set(['aok.config.js']));
      console.log('  ✅ Extracted default template files');
    } else {
      console.log('  ⚠️  Template directory missing. Continuing with config-only initialization.');
    }

    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, renderConfigTemplate(detected.command));
      console.log(`  ✅ Created ${configFilename}`);
    } else {
      console.log(`  ✅ Reusing existing ${configFilename}`);
    }

    if (detected.command) {
      console.log(`  ✅ Validation command: ${detected.command}`);
    } else {
      console.log('  ⚠️  No validation command detected. Set `testCommand` in the AOK config before running tests.');
    }

    console.log('\n🚀 AOK initialized. Run `aok test:e2e` to start.\n');
  });

function resolveTemplateDir(): string {
  const candidates = [
    path.join(CLI_DIR, '../templates/default'),
    path.join(CLI_DIR, '../../templates/default'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function copyDirSync(src: string, dest: string, ignoredNames = new Set<string>()) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath, ignoredNames);
    else if (!fs.existsSync(destPath)) fs.copyFileSync(srcPath, destPath);
  }
}

function renderConfigTemplate(testCommand: string | null): string {
  return [
    'module.exports = {',
    `  testCommand: ${JSON.stringify(testCommand ?? '')},`,
    '  maxRepairAttempts: 4,',
    '  enableExploration: false,',
    '  strictUXMode: true,',
    '  memoryPath: ".aok/memory"',
    '};',
    '',
  ].join('\n');
}

// ========================================================
// DOCTOR
// ========================================================
program
  .command('doctor')
  .description('Validate environment readiness.')
  .action(() => {
    const cwd = process.cwd();
    let healthy = true;
    const resolution = resolveConfig(cwd);
    const configFilename = chooseConfigFilename(cwd);

    console.log('\n🩺 Running AOK Diagnostics...\n');

    if (!fs.existsSync(path.join(cwd, '.aok'))) {
      console.log('  ❌ .aok/ directory missing. Run `aok init`.');
      healthy = false;
    } else {
      console.log('  ✅ .aok/ directory found');
    }

    if (!resolution.configPath) {
      console.log(`  ❌ ${configFilename} missing. Run \`aok init\`.`);
      healthy = false;
    } else {
      console.log(`  ✅ ${path.basename(resolution.configPath)} found`);
      if (!resolution.config.testCommand) {
        console.log('  ❌ No runnable validation command configured or detected.');
        healthy = false;
      }
    }

    if (!fs.existsSync(path.join(cwd, 'package.json'))) {
      console.log('  ❌ package.json not found — are you in a project root?');
      healthy = false;
    } else {
      console.log('  ✅ package.json found');
    }

    const templateDir = TEMPLATE_DIR;
    if (fs.existsSync(templateDir)) {
      console.log('  ✅ Template directory available');
    } else {
      console.log('  ⚠️  Template directory missing (init will create config only)');
    }

    if (resolution.config.testCommand) {
      console.log(`  ✅ Validation command ready: ${resolution.config.testCommand}`);
    } else {
      console.log('  ❌ Validation command missing. Set `testCommand` in the AOK config.');
      healthy = false;
    }

    for (const warning of resolution.warnings) {
      console.log(`  ⚠️  ${warning}`);
    }

    console.log('');
    if (healthy) {
      console.log('✅ AOK environment is healthy.\n');
    } else {
      console.log('⚠️  Fix the issues above, then re-run `aok doctor`.\n');
    }
  });

// ========================================================
// TEST:E2E
// ========================================================
program
  .command('test:e2e')
  .description('Run configured E2E tests, capture failures, and run Intelligence Layer.')
  .action(async () => {
    const cwd = process.cwd();
    const resolution = resolveConfig(cwd);
    const config = resolution.config;
    const failuresFile = path.join(cwd, '.aok', 'e2e-failures.json');

    if (!fs.existsSync(path.join(cwd, '.aok'))) {
      console.log('❌ .aok/ not found. Run `aok init` first.');
      process.exit(1);
    }

    if (!config.testCommand) {
      console.log('❌ No validation command is configured or detectable. Set `testCommand` in the AOK config first.');
      process.exit(1);
    }

    for (const warning of resolution.warnings) {
      console.log(`⚠️  ${warning}`);
    }

    console.log(`\n🎭 Reality Layer — Running Tests (${config.testCommand})...\n`);

    const result = await runTests(cwd, config.testCommand);

    if (result.passed) {
      writeFailureCaptureReport(failuresFile, createFailureCaptureReport([], 'passed'));
      console.log('\n✅ All tests passed. No failures detected.\n');
    } else {
      const failures = parseRawErrors(result.rawOutput);
      writeFailureCaptureReport(failuresFile, createFailureCaptureReport(failures, 'failed'));
      console.log(`\n❌ ${failures.length} failure(s) captured to .aok/e2e-failures.json`);
    }

    // Intelligence Layer
    console.log('\n🧠 Intelligence Layer — Running UX Validator...\n');
    const report = runUXValidator(cwd);

    if (report.totalFailures === 0) {
      console.log('  ✅ No failures to classify.\n');
    } else {
      console.log(`  📋 ${report.totalFailures} failure(s) classified → .aok/repair-tasks.json`);
      const typeCounts: Record<string, number> = {};
      for (const f of report.failures) {
        typeCounts[f.type] = (typeCounts[f.type] || 0) + 1;
      }
      console.log('');
      for (const [type, count] of Object.entries(typeCounts)) {
        console.log(`     ${type}: ${count}`);
      }
      console.log('');
      console.log('  Run `aok tasks` to view or `aok run` to auto-fix.\n');
    }
  });

// ========================================================
// TASKS (view structured tasks)
// ========================================================
program
  .command('tasks')
  .description('Read classified failures and output structured repair tasks.')
  .action(() => {
    const cwd = process.cwd();
    const repairFile = path.join(cwd, '.aok', 'repair-tasks.json');
    const failuresFile = path.join(cwd, '.aok', 'e2e-failures.json');

    if (!fs.existsSync(repairFile)) {
      if (fs.existsSync(failuresFile)) {
        console.log('\n⚙️  No repair-tasks.json found. Running Intelligence Layer...\n');
        runUXValidator(cwd);
      } else {
        console.log('❌ No failure data found. Run `aok init` and `aok test:e2e` first.');
        process.exit(1);
      }
    }

    let report: { generatedAt: string; totalFailures: number; failures: Failure[] } | null = null;
    try {
      report = JSON.parse(fs.readFileSync(repairFile, 'utf-8'));
    } catch {
      console.log('❌ Failed to parse .aok/repair-tasks.json');
      process.exit(1);
    }

    if (!report || !report.failures || report.failures.length === 0) {
      console.log('\n✅ System healthy. No repair needed.\n');
      return;
    }

    console.log('');
    console.log(`  Generated: ${report.generatedAt}`);
    console.log(`  Failures:  ${report.totalFailures}`);
    console.log('');

    for (const failure of report.failures) {
      console.log('═══════════════════════════════════════════');
      console.log('  FAILURE DETECTED');
      console.log('═══════════════════════════════════════════');
      console.log('');
      console.log(`  ID:    ${failure.id}`);
      console.log(`  Type:  ${failure.type}`);
      console.log(`  Step:  ${failure.step}`);
      console.log('');
      console.log('  Cause:');
      console.log(`    ${failure.probableCause}`);
      console.log('');
      console.log('  Error:');
      const errorLines = failure.error.split('\n');
      const displayLines = errorLines.slice(0, 10);
      for (const line of displayLines) {
        console.log(`    ${line}`);
      }
      if (errorLines.length > 10) {
        console.log(`    ... (${errorLines.length - 10} more lines)`);
      }
      console.log('');
      console.log('  Suggested Fix Targets:');
      for (const target of failure.suggestedTargetFiles) {
        console.log(`    → ${target}`);
      }
      console.log('');
      console.log('  Priority:');
      console.log(`    Severity:      ${failure.severity}`);
      console.log(`    Confidence:    ${failure.confidence}`);
      console.log(`    Blast Radius:  ${failure.blastRadius}`);
      console.log(`    Suggested Ord: ${failure.suggestedOrder}`);
      console.log('');
      console.log('═══════════════════════════════════════════');
      console.log('');
    }

    console.log(`📋 Total repair tasks: ${report.totalFailures}`);
    console.log('');
  });

program
  .command('patches')
  .description('List generated repair and exploration proposals with review status.')
  .action(() => {
    const cwd = process.cwd();
    const proposals = listProposals(cwd);

    if (proposals.length === 0) {
      console.log('\n✅ No proposals generated yet.\n');
      return;
    }

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  AOK PROPOSAL REGISTRY');
    console.log('═══════════════════════════════════════════');
    console.log('');

    for (const proposal of proposals) {
      console.log(`[${proposal.suggestedOrder}] ${proposal.id}`);
      console.log(`  Status:      ${proposal.status}`);
      console.log(`  Category:    ${proposal.category}`);
      console.log(`  Severity:    ${proposal.severity}`);
      console.log(`  Confidence:  ${proposal.confidence}`);
      console.log(`  BlastRadius: ${proposal.blastRadius}`);
      console.log(`  Summary:     ${proposal.summary}`);
      console.log(`  Path:        ${proposal.path}`);
      console.log('');
    }
  });

program
  .command('proposal:status')
  .description('Update the review status of a generated proposal.')
  .argument('<proposalId>', 'Proposal identifier')
  .argument('<status>', 'pending | in_review | accepted | rejected | implemented')
  .action((proposalId: string, status: ProposalStatus) => {
    const cwd = process.cwd();
    const allowedStatuses: ProposalStatus[] = ['pending', 'in_review', 'accepted', 'rejected', 'implemented'];

    if (!allowedStatuses.includes(status)) {
      console.log(`❌ Invalid status '${status}'. Use one of: ${allowedStatuses.join(', ')}`);
      process.exit(1);
    }

    const updated = updateProposalStatus(cwd, proposalId, status);
    if (!updated) {
      console.log(`❌ Proposal '${proposalId}' not found.`);
      process.exit(1);
    }

    console.log(`✅ Updated ${proposalId} → ${status}`);
  });

// ========================================================
// REPAIR (ACTUATE -> VERIFY LOOP ONLY)
// ========================================================
program
  .command('repair')
  .description('Run the autonomous repair loop on existing failures (Actuate → Verify).')
  .option('--auto', 'Run autonomous loop internally using LLM APIs')
  .action(async (options) => {
    const cwd = process.cwd();

    if (!fs.existsSync(path.join(cwd, '.aok'))) {
      console.log('❌ .aok/ not found. Run `aok init` first.');
      process.exit(1);
    }

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  AOK — AUTONOMOUS REPAIR');
    console.log('═══════════════════════════════════════════');

    console.log('\n🔧 Step 1: Actuation Layer — Autonomous repair starting...');

    const result = await runAutonomousRepair(cwd);

    printRepairResult(result, cwd);
  });

// ========================================================
// REPORT (Evolution Memory Insights)
// ========================================================
program
  .command('report')
  .description('View Evolution Memory insights: fix success rates, chronic issues, and regression hotspots.')
  .action(() => {
    const cwd = process.cwd();
    const memoryDir = path.join(cwd, '.aok', 'memory');

    if (!fs.existsSync(memoryDir)) {
      console.log('❌ .aok/memory/ not found. Run `aok init` first.');
      process.exit(1);
    }

    const report = generateEvolutionReport(cwd);

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  AOK EVOLUTION REPORT');
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log(`  Total Fixes Attempted: ${report.totalFixes}`);
    console.log(`  Fix Success Rate:      ${report.fixSuccessRate}%`);
    console.log('');

    console.log('  🧠 Observations:');
    for (const obs of report.driftObservations) {
      console.log(`    • ${obs}`);
    }
    console.log('');

    if (report.chronicIssues.length > 0) {
      console.log('  ⚠️  Chronic Issues Detected:');
      for (const issue of report.chronicIssues) {
        console.log(`    - ${issue}`);
      }
      console.log('');
    } else {
      console.log('  ✅ No chronic issues detected.');
      console.log('');
    }

    if (report.regressionHotspots.length > 0) {
      console.log('  🔥 Regression Hotspots:');
      for (const spot of report.regressionHotspots) {
        console.log(`    - ${spot}`);
      }
      console.log('');
    }

    console.log('  💡 Recommendations:');
    for (const rec of report.topRecommendations) {
      console.log(`    → ${rec}`);
    }

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('');
  });

// ========================================================
// EXPLORE (Controlled Refactor Engine)
// ========================================================
program
  .command('explore')
  .description('Schedule an exploration window to refactor fragile or stagnant code zones.')
  .action(async () => {
    const cwd = process.cwd();
    const memoryDir = path.join(cwd, '.aok', 'memory');

    if (!fs.existsSync(memoryDir)) {
      console.log('❌ .aok/memory/ not found. Run `aok init` first.');
      process.exit(1);
    }

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  AOK EXPLORATION ENGINE');
    console.log('═══════════════════════════════════════════');
    
    const pressure = getExplorationPressure(cwd);
    
    if (pressure < 40) {
      console.log(`\n  Exploration Pressure: ${pressure}/100`);
      console.log('  ✅ System is stable. No structural exploration needed at this time.\n');
      return;
    } 
    
    if (pressure < 70) {
      console.log(`\n  Exploration Pressure: ${pressure}/100`);
      console.log('  ⚠️  Structural rot accumulating. Recommend triggering exploration soon.');
      console.log('  (Run `aok explore --force` to override and execute now, though prototype ignores flags)\n');
      return;
    }

    const result = await runExplorationWindow(cwd);

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  EXPLORATION COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log(`  Outcome: ${result.status.toLowerCase()}`);
    console.log('');

    if (result.zonesExplored.length > 0) {
      console.log('  Zones explored:');
      for (const zone of result.zonesExplored) {
        console.log(`    - ${zone}`);
      }
      console.log('');
    } else {
      console.log('  Zones explored: (none)');
      console.log('');
    }

    if (result.details.length > 0) {
      console.log('  Details:');
      for (const detail of result.details) {
        console.log(`    → ${detail}`);
      }
      console.log('');
    }

  });

// ========================================================
// ORCHESTRATOR 
// ========================================================

const repoCmd = program
  .command('repo')
  .description('Manage AOK workspaces (repositories).');

repoCmd
  .command('attach <repoPath> [name]')
  .description('Attach a new repository to the AOK ledger.')
  .action((repoPath: string, name?: string) => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    
    const absolutePath = path.resolve(cwd, repoPath);
    if (!fs.existsSync(absolutePath)) {
      console.log(`❌ Path does not exist: ${absolutePath}`);
      return;
    }
    
    const repoName = name || path.basename(absolutePath);
    const id = Math.random().toString(36).substring(2, 9);
    
    // Check if it's the first repo, make it active if so
    const existing = ledger.listRepos();
    const isFirst = existing.length === 0;

    ledger.attachRepo({
      id,
      name: repoName,
      path: absolutePath,
      is_active: isFirst,
      created_at: new Date().toISOString()
    });

    console.log(`✅ Attached repo '${repoName}' at ${absolutePath}`);
  });

repoCmd
  .command('list')
  .description('List all attached repositories.')
  .action(() => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    const repos = ledger.listRepos();
    
    if (repos.length === 0) {
      console.log('No repositories attached. Run `aok repo attach <path>`.');
      return;
    }

    console.log('Attached Repositories:');
    for (const r of repos) {
      const activeMark = r.is_active ? '=>' : '  ';
      console.log(`${activeMark} [${r.id}] ${r.name} (${r.path})`);
    }
  });

repoCmd
  .command('use <name>')
  .description('Set a repository as the active workspace.')
  .action((name: string) => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    const success = ledger.useRepo(name);
    
    if (success) {
      console.log(`✅ Set active repo to '${name}'.`);
    } else {
      console.log(`❌ Repo '${name}' not found.`);
    }
  });


const orchestrateCmd = program
  .command('orchestrate')
  .description('Manage the multi-agent orchestration system.');

orchestrateCmd
  .command('init')
  .description('Initialize the orchestrator ledger and default agents.')
  .action(() => {
    const cwd = process.cwd();
    const engine = new OrchestratorEngine(cwd);
    engine.init();
    console.log('✅ Orchestrator initialized. Ledger and agents created at .aok/ledger.sqlite');
  });

orchestrateCmd
  .command('run')
  .description('Run the orchestrator loop.')
  .option('--once', 'Run the loop for one tick only')
  .option('--watch', 'Continuously run the loop on an interval')
  .action(async (options) => {
    const cwd = process.cwd();
    const engine = new OrchestratorEngine(cwd);
    
    if (options.watch) {
      console.log('🔄 Orchestrator running in watch mode (interval: 5s)... Press Ctrl+C to stop.');
      setInterval(async () => {
         await engine.runOnce();
      }, 5000);
    } else {
      console.log('🔄 Orchestrator running tick...');
      const result = await engine.runOnce();
      if (!result) {
        console.log('Orchestrator halted or no work to do.');
      }
    }
  });

orchestrateCmd
  .command('status')
  .description('Print the status of the orchestrator ledger.')
  .action(() => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    
    console.log('═══════════════════════════════════════════');
    console.log('  ORCHESTRATOR STATUS');
    console.log('═══════════════════════════════════════════\n');
    
    const activeRepo = ledger.getActiveRepoContext();
    if (activeRepo) {
      console.log(`Active Workspace: ${activeRepo.name} (${activeRepo.path})\n`);
    } else {
      console.log(`⚠️  No active workspace. Some commands may fail.\n`);
    }

    const activeTask = ledger.getActiveTask();
    if (activeTask) {
      console.log(`Active Task ID: [${activeTask.id}]`);
      console.log(`Title:          ${activeTask.title}`);
      console.log(`State:          ${activeTask.state}`);
      console.log(`Owner:          ${activeTask.owner_role}`);
      if (activeTask.blocker) console.log(`Blocker:        Approval required (${activeTask.blocker})`);
      
      const handoff = ledger.getLatestHandoffForAgent(activeTask.id, null as any);
      if (handoff) {
        console.log(`\n📄 Latest Handoff:`);
        console.log(`  From:    ${handoff.from_agent_id}`);
        console.log(`  Message: ${handoff.message.substring(0, 80)}...`);
      }
    } else {
      console.log('No active tasks queued.');
    }

    const approvals = ledger.getPendingApprovals();
    if (approvals.length > 0) {
      console.log('\n⚠️  Pending Approvals Require Human Action:');
      for (const a of approvals) {
        console.log(`  - [${a.id}] ${a.gate_type} from ${a.requested_by_agent_id}: ${a.reason}`);
      }
      console.log('\nRun `aok orchestrate approve <id>` to unblock.');
    }
    console.log('\n═══════════════════════════════════════════');
  });

orchestrateCmd
  .command('approve <approvalId>')
  .description('Approve a blocked task transition.')
  .option('--reject', 'Reject instead of approve')
  .option('-m, --message <msg>', 'Optional feedback message')
  .action((approvalId: string, options) => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    
    const approvals = ledger.getPendingApprovals();
    const approval = approvals.find(a => a.id === approvalId);
    if (!approval) {
      console.log(`❌ No pending approval found with id '${approvalId}'.`);
      return;
    }

    const status = options.reject ? 'rejected' : 'approved';
    const feedback = options.message || null;
    
    ledger.resolveApproval(approvalId, status, feedback);
    
    // Unblock the task
    const task = ledger.getTaskById(approval.task_id);
    if (task) {
      ledger.updateTaskState(task.id, task.state, task.owner_role, null);
    }

    console.log(`✅ Approval ${approvalId} marked as ${status}. Task unblocked.`);
  });

orchestrateCmd
  .command('create-task <title>')
  .description('Create a new task.')
  .option('--repo <name>', 'Specific repo to target (defaults to active workspace)')
  .option('--goal <string>', 'The primary goal', 'Test the orchestration system lifecycle')
  .option('--scope <string>', 'The scope', 'End to end state transitions')
  .option('--non_goals <string>', 'Non goals', 'Modify actual source code')
  .option('--definition_of_done <string>', 'Definition of done', 'Task transitions to finished')
  .option('--proof_required <string>', 'Proof required', 'Handoff logs verification')
  .action((title: string, options) => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    
    let targetRepoId = null;
    
    if (options.repo) {
       const repos = ledger.listRepos();
       const r = repos.find(x => x.name === options.repo);
       if (!r) {
           console.log(`❌ Target repo '${options.repo}' not found. Run 'aok repo list'`);
           return;
       }
       targetRepoId = r.id;
    } else {
       const active = ledger.getActiveRepoContext();
       if (!active) {
           console.log(`❌ No active workspace. Run 'aok repo attach <path>' or specify --repo.`);
           return;
       }
       targetRepoId = active.id;
    }

    const taskId = Math.random().toString(36).substring(2, 9);
    ledger.createTask({
      id: taskId,
      repo_id: targetRepoId,
      title: title,
      goal: options.goal,
      scope: options.scope,
      non_goals: options.non_goals,
      owner_role: 'supervisor',
      state: 'queued',
      definition_of_done: options.definition_of_done,
      proof_required: options.proof_required,
      blocker: null,
      next_recommended_role: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    console.log(`✅ Task [${taskId}] created and queued for workspace.`);
  });

orchestrateCmd
  .command('prove-execution')
  .description('Run a hard truth integration pipeline to verify authoritative file mutation.')
  .option('--repo <name>', 'Specific repo to target (defaults to active workspace)')
  .action(async (options) => {
    const cwd = process.cwd();
    const ledger = new TaskLedger(cwd);
    
    let targetRepo = null;
    if (options.repo) {
       const repos = ledger.listRepos();
       targetRepo = repos.find(x => x.name === options.repo);
       if (!targetRepo) {
           console.log(`❌ Target repo '${options.repo}' not found. Run 'aok repo list'`);
           return;
       }
    } else {
       targetRepo = ledger.getActiveRepoContext();
       if (!targetRepo) {
           console.log(`❌ No active workspace. Run 'aok repo attach <path>' or specify --repo.`);
           return;
       }
    }

    const tempDir = path.join(targetRepo.path, '.aok', 'temp');
    if (!fs.existsSync(tempDir)) {
       fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFile = path.join(tempDir, `AOK_TRUTH_${Date.now()}.txt`);
    fs.writeFileSync(tempFile, 'INIT\n');
    const taskId = Math.random().toString(36).substring(2, 9);
    ledger.createTask({
      id: taskId,
      repo_id: targetRepo.id,
      title: 'Prove Execution',
      goal: 'Modify the truth file with a deterministic signature',
      scope: `Target File: ${tempFile}`,
      non_goals: 'Do not modify anything else',
      owner_role: 'builder',
      state: 'planned',
      definition_of_done: 'File explicitly mutated',
      proof_required: tempFile,
      blocker: null,
      next_recommended_role: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    console.log(`✅ Created Truth Test File at ${tempFile}`);
    console.log(`✅ Triggering strict loop for Task [${taskId}]...\n`);

    // In simulation mode, the LLM won't produce real FILE blocks.
    // Pre-stage a deterministic mutation so the engine's staged commit path is exercised.
    if (process.env.AOK_SIMULATION_MODE === 'true') {
        const { SafeWriter } = require('../src/orchestrator/fs-sandbox.ts');
        const writer = new SafeWriter(targetRepo.path);
        try {
            const stageId = await writer.stageMutation(taskId, tempFile, 'MUTATED_BY_PROVE_EXECUTION\n', 'overwrite', { allowOverwrite: true });
            // Inject staged mutation marker into a synthetic handoff so engine can find it
            const mutRef = JSON.stringify([{ stageId, targetPath: tempFile, operationType: 'overwrite', allowOverwrite: true }]);
            ledger.createHandoff({
                id: Math.random().toString(36).substring(2, 9),
                task_id: taskId,
                from_agent_id: null,
                to_agent_id: null,
                timestamp: new Date().toISOString(),
                message: `[prove-execution staged mutation]\n\n__STAGED_MUTATIONS__${mutRef}__END_STAGED__`,
                artifacts_referenced: [],
                suggested_state_transition: null
            });
            console.log(`✅ Pre-staged mutation: ${stageId}`);
        } catch (err: any) {
            console.error(`❌ Failed to pre-stage mutation: ${err.message}`);
        }
    }

    const engine = new OrchestratorEngine(cwd);
    while (true) {
       const res = await engine.runOnce();
       const updated = ledger.getTaskById(taskId);
       if (!res || updated?.state === 'done' || updated?.state === 'blocked' || updated?.state === 'rejected') {
           console.log(`\n🏁 Prove Execution Complete. Final State: ${updated?.state}`);
           if (updated?.blocker) console.log(`   Blocker: ${updated.blocker}`);
           break;
       }
    }
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  });

// ========================================================
// RUN (full autonomous loop)
// ========================================================
program
  .command('run')
  .description('Execute the full autonomous repair loop: Test → Understand → Fix → Verify.')
  .option('--auto', 'Run autonomous loop internally using LLM APIs')
  .action(async (options) => {
    const cwd = process.cwd();
    const resolution = resolveConfig(cwd);
    const config = resolution.config;

    if (!fs.existsSync(path.join(cwd, '.aok'))) {
      console.log('❌ .aok/ not found. Run `aok init` first.');
      process.exit(1);
    }

    if (!config.testCommand) {
      console.log('❌ No validation command is configured or detectable. Set `testCommand` in the AOK config first.');
      process.exit(1);
    }

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  AOK — FULL AUTONOMOUS LOOP');
    console.log('═══════════════════════════════════════════');

    // ── Step 1: Reality Layer ──
    for (const warning of resolution.warnings) {
      console.log(`⚠️  ${warning}`);
    }

    console.log(`\n🎭 Step 1: Reality Layer — Running tests (${config.testCommand})...\n`);

    const testResult = await runTests(cwd, config.testCommand);

    if (testResult.passed) {
      const failuresPath = path.join(cwd, '.aok', 'e2e-failures.json');
      writeFailureCaptureReport(failuresPath, createFailureCaptureReport([], 'passed'));

      console.log('');
      console.log('═══════════════════════════════════════════');
      console.log('  AUTONOMOUS REPAIR COMPLETE');
      console.log('═══════════════════════════════════════════');
      console.log('');
      console.log('  Status: SUCCESS');
      console.log('  All tests passing. No repair needed.');
      console.log('');
      console.log('═══════════════════════════════════════════');
      console.log('');
      return;
    }

    // Write raw failures
    const rawFailures = parseRawErrors(testResult.rawOutput);
    const failuresPath = path.join(cwd, '.aok', 'e2e-failures.json');
    writeFailureCaptureReport(failuresPath, createFailureCaptureReport(rawFailures, 'failed'));
    console.log(`\n  ❌ ${rawFailures.length} failure(s) captured.`);

    // ── Step 2: Intelligence Layer ──
    console.log('\n🧠 Step 2: Intelligence Layer — Classifying failures...');
    const report = runUXValidator(cwd);
    console.log(`  📋 ${report.totalFailures} failure(s) classified.`);

    if (report.totalFailures === 0) {
      console.log('\n  ✅ No actionable failures found.\n');
      return;
    }

    // ── Step 3: Actuation Layer ──
    console.log('\n🔧 Step 3: Actuation Layer — Autonomous repair starting...');

    const result = await runAutonomousRepair(cwd);

    printRepairResult(result, cwd);
  });

function printRepairResult(result: any, cwd?: string) {

    // ── Final Report ──
    console.log('');
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  AUTONOMOUS REPAIR COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log(`  Status:   ${result.status}`);
    console.log(`  Attempts: ${result.totalAttempts}/${MAX_ATTEMPTS}`);
    console.log('');

    if (result.fixesApplied.length > 0) {
      console.log('  Fixes Applied:');
      for (const fix of result.fixesApplied) {
        const mark = fix.success ? '✅' : '❌';
        console.log(`    ${mark} [${fix.failureId}] ${fix.strategy}`);
        for (const f of fix.filesModified) {
          console.log(`       → ${f}`);
        }
      }
    } else {
      console.log('  Fixes Applied: (none)');
    }

    console.log('');

    if (result.remainingIssues.length > 0) {
      console.log('  Remaining Issues:');
      for (const issue of result.remainingIssues) {
        console.log(`    ❌ ${issue}`);
      }
    } else {
      console.log('  Remaining Issues: (none)');
    }

    console.log('');
    
    if (cwd) {
      // Memory Insights extraction
      const evoReport = generateEvolutionReport(cwd);
      
      console.log('  Memory Insights:');
      if (evoReport.chronicIssues.length > 0) {
        console.log(`    ⚠️  Chronic issues detected: ${evoReport.chronicIssues.length}`);
      } else {
        console.log('    ✅ No chronic issues active');
      }
      if (evoReport.regressionHotspots.length > 0) {
        console.log(`    🔥 Top regression hotspot: ${evoReport.regressionHotspots[0]}`);
      }
      console.log(`    🧠 Current System Fix Success Rate: ${evoReport.fixSuccessRate}%`);
      
      console.log('');
      console.log('  Run `aok report` for full evolution details.');
      console.log('');
    }
    
    console.log('═══════════════════════════════════════════');
    console.log('');

    process.exit(result.status === 'SUCCESS' ? 0 : 1);
}

// ========================================================
// HELPERS
// ========================================================

const MAX_ATTEMPTS = 4;

function runTests(cwd: string, testCommand: string): Promise<{ passed: boolean; rawOutput: string }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(testCommand, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    child.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      resolve({ passed: code === 0, rawOutput: stderr + '\n' + stdout });
    });

    child.on('error', (err) => {
      stderr += err.message;
      resolve({ passed: false, rawOutput: stderr + '\n' + stdout });
    });
  });
}

program.parse(process.argv);
