import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { runUXValidator } from '../intelligence/ux-validator.ts';
import type { Failure, FailureType, RepairTaskReport } from '../intelligence/ux-validator.ts';
import {
  errorSignature,
  getFailedStrategies,
  getEffectiveStrategies,
  isChronicFailure,
  recordFix,
  recordFailurePattern,
  markRegression
} from '../memory/evolution.ts';
import { getConfig } from '../config.ts';
import { createFailureCaptureReport, parseRawErrors, writeFailureCaptureReport } from '../failures.ts';
import { writeLog, generateId } from '../logger.ts';
import { writeRepairProposal } from '../proposals.ts';

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// PUBLIC TYPES
// ═══════════════════════════════════════════

export interface RepairResult {
  status: 'SUCCESS' | 'FAILED';
  totalAttempts: number;
  fixesApplied: FixRecord[];
  remainingIssues: string[];
}

export interface FixRecord {
  failureId: string;
  strategy: string;
  filesModified: string[];
  success: boolean;
}

// ═══════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════

// Removed internal FixHistoryEntry type as we use evolution.ts now

interface Strategy {
  id: string;
  name: string;
  types: FailureType[];
  errorMatch: RegExp;
  apply: (failure: Failure, root: string) => StrategyResult;
}

interface StrategyResult {
  applied: boolean;
  filesModified: string[];
  description: string;
}

interface TestRunResult {
  passed: boolean;
  failureCount: number;
  rawOutput: string;
}

// Fix history tracking moved to evolution.ts

// ═══════════════════════════════════════════
// STRATEGIES
// ═══════════════════════════════════════════

function notApplied(reason: string): StrategyResult {
  return { applied: false, filesModified: [], description: reason };
}

function buildVerificationSteps(failure: Failure): string[] {
  return [
    `Re-run the configured test command and confirm the ${failure.step} failure no longer appears.`,
    `Inspect the primary target file${failure.suggestedTargetFiles.length === 1 ? '' : 's'} for the suspected cause.`,
    'Add or update a focused regression test before making the code change.',
  ];
}

function mapRiskLevel(failure: Failure): 'low' | 'medium' | 'high' {
  if (failure.severity === 'high' || failure.blastRadius === 'broad') return 'high';
  if (failure.severity === 'medium' || failure.blastRadius === 'moderate') return 'medium';
  return 'low';
}

const STRATEGIES: Strategy[] = [

  // ── UX: Strict mode selector suggestion (log only) ──
  {
    id: 'ux-selector-suggestion',
    name: 'Narrow Selector (suggestion)',
    types: ['UX'],
    errorMatch: /strict mode violation/i,
    apply: (failure, root) => {
      const selectorMatch = failure.error.match(/locator\(['"]([^'"]+)['"]\)/);
      const selector = selectorMatch ? selectorMatch[1] : 'unknown';
      const patchFile = writeRepairProposal(root, `${failure.id}-selector.md`, {
        id: failure.id,
        category: 'repair',
        summary: 'Selector is too broad for strict mode',
        probableCause: `Playwright matched multiple elements for \`${selector}\`, which usually means the selector is no longer specific enough after a UI change.`,
        targetFiles: failure.suggestedTargetFiles,
        proposedChange: 'Replace the broad locator with a stable selector, ideally a dedicated `data-testid` or a role-based selector tied to visible text.',
        riskLevel: mapRiskLevel(failure),
        severity: failure.severity,
        confidence: failure.confidence,
        blastRadius: failure.blastRadius,
        suggestedOrder: failure.suggestedOrder,
        verificationSteps: buildVerificationSteps(failure),
      });

      return {
        applied: true,
        filesModified: [patchFile],
        description: `Selector '${selector}' needs narrowing — suggestion written`,
      };
    },
  },
  {
    id: 'ux-state-investigation',
    name: 'Investigate UI State (suggestion)',
    types: ['UX'],
    errorMatch: /locator|element not found|not visible|not attached|click.*timeout|waiting for/i,
    apply: (failure, root) => {
      const patchFile = writeRepairProposal(root, `${failure.id}-ux.md`, {
        id: failure.id,
        category: 'repair',
        summary: `UI state issue detected in ${failure.step}`,
        probableCause: failure.probableCause,
        targetFiles: failure.suggestedTargetFiles,
        proposedChange: 'Inspect the render path for missing loading/data guards and confirm the locator still maps to a visible interactive element at the time of the test.',
        riskLevel: mapRiskLevel(failure),
        severity: failure.severity,
        confidence: failure.confidence,
        blastRadius: failure.blastRadius,
        suggestedOrder: failure.suggestedOrder,
        verificationSteps: buildVerificationSteps(failure),
      });
      return {
        applied: true,
        filesModified: [patchFile],
        description: 'Wrote UI investigation notes instead of mutating source files',
      };
    },
  },
  {
    id: 'functional-investigation',
    name: 'Investigate functional failure (suggestion)',
    types: ['FUNCTIONAL'],
    errorMatch: /500|404|fetch failed|api|internal server error|unhandled|uncaught|referenceerror|typeerror/i,
    apply: (failure, root) => {
      const patchFile = writeRepairProposal(root, `${failure.id}-functional.md`, {
        id: failure.id,
        category: 'repair',
        summary: `Functional failure detected in ${failure.step}`,
        probableCause: failure.probableCause,
        targetFiles: failure.suggestedTargetFiles,
        proposedChange: 'Debug the failing route or controller directly, then add a regression test for the failing request/response path before applying a manual fix.',
        riskLevel: mapRiskLevel(failure),
        severity: failure.severity,
        confidence: failure.confidence,
        blastRadius: failure.blastRadius,
        suggestedOrder: failure.suggestedOrder,
        verificationSteps: buildVerificationSteps(failure),
      });
      return {
        applied: true,
        filesModified: [patchFile],
        description: 'Wrote functional investigation notes instead of mutating source files',
      };
    },
  },
  {
    id: 'network-investigation',
    name: 'Investigate runtime readiness (suggestion)',
    types: ['NETWORK'],
    errorMatch: /timeout|econnrefused|connection refused|econnreset|enotfound|dns|socket hang up|abort/i,
    apply: (failure, root) => {
      const patchFile = writeRepairProposal(root, `${failure.id}-network.md`, {
        id: failure.id,
        category: 'repair',
        summary: `Runtime readiness issue detected in ${failure.step}`,
        probableCause: failure.probableCause,
        targetFiles: failure.suggestedTargetFiles,
        proposedChange: 'Confirm the dependent service is started before the test begins and add explicit readiness checks instead of widening timeouts blindly.',
        riskLevel: mapRiskLevel(failure),
        severity: failure.severity,
        confidence: failure.confidence,
        blastRadius: failure.blastRadius,
        suggestedOrder: failure.suggestedOrder,
        verificationSteps: [
          `Re-run the configured test command and confirm the ${failure.step} failure no longer appears.`,
          'Start the dependent service manually and verify the same request succeeds before the automated test runs.',
          'If a readiness gate is added, validate that local and CI startup behavior both remain stable.',
        ],
      });
      return {
        applied: true,
        filesModified: [patchFile],
        description: 'Wrote runtime-readiness notes instead of mutating source files',
      };
    },
  },
];

// ═══════════════════════════════════════════
// STRATEGY SELECTION
// ═══════════════════════════════════════════

function selectStrategy(
  projectRoot: string,
  failure: Failure,
  triedThisRound: Set<string>,
): Strategy | null {
  // Filter strategies applicable to this failure type and error pattern
  const applicable = STRATEGIES.filter((s) => {
    if (!s.types.includes(failure.type)) return false;
    if (!s.errorMatch.test(failure.error)) return false;
    return true;
  });

  if (applicable.length === 0) return null;

  const sig = errorSignature(failure.error);
  const failedStrategies = getFailedStrategies(projectRoot, sig);
  const effectiveStrategies = getEffectiveStrategies(projectRoot, sig);

  // Sort: prioritize previously successful strategies
  const sorted = [...applicable].sort((a, b) => {
    const aSuccess = effectiveStrategies.includes(a.id) ? -1 : 0;
    const bSuccess = effectiveStrategies.includes(b.id) ? -1 : 0;
    return aSuccess - bSuccess;
  });

  // Pick first strategy that hasn't failed >=2 times and hasn't been tried this round
  for (const strategy of sorted) {
    const roundKey = `${sig}:${strategy.id}`;
    if (triedThisRound.has(roundKey)) continue;
    if (failedStrategies.includes(strategy.id)) continue;
    return strategy;
  }

  return null;
}

// ═══════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════

function runTests(cwd: string, testCommand: string): Promise<TestRunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(testCommand, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const combined = stderr + '\n' + stdout;

      const failuresPath = path.join(cwd, '.aok', 'e2e-failures.json');
      const rawFailures = parseRawErrors(combined);

      if (code === 0) {
        writeFailureCaptureReport(failuresPath, createFailureCaptureReport([], 'passed'));
        resolve({ passed: true, failureCount: 0, rawOutput: combined });
      } else {
        writeFailureCaptureReport(failuresPath, createFailureCaptureReport(rawFailures, 'failed'));
        resolve({ passed: false, failureCount: rawFailures.length, rawOutput: combined });
      }
    });

    child.on('error', (err) => {
      const rawFailures = parseRawErrors(err.message);
      const failuresPath = path.join(cwd, '.aok', 'e2e-failures.json');
      writeFailureCaptureReport(failuresPath, createFailureCaptureReport(rawFailures, 'failed'));
      resolve({ passed: false, failureCount: 1, rawOutput: err.message });
    });
  });
}

// ═══════════════════════════════════════════
// REPAIR TASK LOADING
// ═══════════════════════════════════════════

function loadRepairTasks(root: string): RepairTaskReport | null {
  const repairPath = path.join(root, '.aok', 'repair-tasks.json');
  try {
    if (!fs.existsSync(repairPath)) return null;
    return JSON.parse(fs.readFileSync(repairPath, 'utf-8'));
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════
// MAIN AUTONOMOUS REPAIR LOOP
// ═══════════════════════════════════════════

export async function runAutonomousRepair(projectRoot: string): Promise<RepairResult> {
  const config = getConfig(projectRoot);
  const allFixes: FixRecord[] = [];
  let attempt = 0;
  const pipelineId = generateId();

  writeLog(projectRoot, 'runs', {
    id: pipelineId,
    command: 'repair',
    phase: 'actuation',
    status: 'INFO',
    details: { maxAttempts: config.maxRepairAttempts }
  });

  while (attempt < config.maxRepairAttempts) {
    attempt++;
    console.log(`\n  🔄 Attempt ${attempt}/${config.maxRepairAttempts}`);
    console.log('  ' + '─'.repeat(38));

    // Load current classified failures
    const report = loadRepairTasks(projectRoot);
    if (!report || report.totalFailures === 0) {
      console.log('    ✅ No failures remaining.');
      return {
        status: 'SUCCESS',
        totalAttempts: attempt,
        fixesApplied: allFixes,
        remainingIssues: [],
      };
    }

    console.log(`    📋 ${report.totalFailures} failure(s) to address`);

    // Track strategies tried this round to avoid duplicates within a single attempt
    const triedThisRound = new Set<string>();
    let anyApplied = false;

    // Apply strategies to each failure
    for (const failure of report.failures) {
      const sig = errorSignature(failure.error);

      if (isChronicFailure(projectRoot, sig)) {
        console.log(`    ⚠️  CHRONIC ISSUE DETECTED — requires architectural change`);
        console.log(`    ⏭  Skipping further attempts on ${failure.id}`);
        continue;
      }

      const strategy = selectStrategy(projectRoot, failure, triedThisRound);

      if (!strategy) {
        console.log(`    ⏭  ${failure.id} [${failure.type}]: No viable strategy`);
        continue;
      }

      const roundKey = `${sig}:${strategy.id}`;
      triedThisRound.add(roundKey);

      console.log(`    🛠  ${failure.id} [${failure.type}]: '${strategy.name}'`);

      const startMs = Date.now();
      let result: StrategyResult;
      try {
        result = strategy.apply(failure, projectRoot);
      } catch (err: any) {
        console.log(`    ❌  Strategy threw: ${err.message}`);
        recordFix(projectRoot, {
          errorSignature: sig,
          file: '',
          strategy: strategy.id,
          succeeded: false,
          durationMs: Date.now() - startMs,
          pipelineId
        });
        continue;
      }

      const durationMs = Date.now() - startMs;

      if (result.applied) {
        anyApplied = true;
        allFixes.push({
          failureId: failure.id,
          strategy: strategy.id, // storing id instead of name for memory
          filesModified: result.filesModified,
          success: false, // pending verification
        });
        
        writeLog(projectRoot, 'fixes', {
          id: generateId(),
          command: 'repair',
          phase: 'actuation',
          status: 'INFO',
          details: { failureId: failure.id, strategy: strategy.id, filesModified: result.filesModified }
        });

        console.log(`       → ${result.description}`);
        for (const f of result.filesModified) {
          console.log(`       → ${f}`);
        }
      } else {
        console.log(`       → Skip: ${result.description}`);
      }
    }

    // If nothing could be applied, stop looping
    if (!anyApplied) {
      console.log('\n    ⚠️  No strategies could produce changes. Stopping loop.');
      break;
    }

    console.log('\n    ℹ️  Guidance written under .aok/patches. No source files were modified.');

    for (const unresolved of report.failures) {
      recordFailurePattern(
        projectRoot,
        errorSignature(unresolved.error),
        unresolved.suggestedTargetFiles[0] || '',
        '',
      );
    }

    for (const fix of allFixes) {
      if (fix.success) continue;
      const legacyFailure = report.failures.find((failure) => failure.id === fix.failureId);
      if (!legacyFailure) continue;

      recordFix(projectRoot, {
        errorSignature: errorSignature(legacyFailure.error),
        file: fix.filesModified[0] || '',
        strategy: fix.strategy,
        succeeded: false,
        durationMs: 0,
        pipelineId
      });

      fix.filesModified
        .filter((file) => !file.startsWith('.aok/'))
        .forEach((file) => markRegression(projectRoot, file));
    }

    const remaining = report.failures.map(
      (failure) => `[${failure.type}] ${failure.error.split('\n')[0].slice(0, 100)}`,
    );

    writeLog(projectRoot, 'runs', {
      id: pipelineId,
      command: 'repair',
      phase: 'actuation',
      status: 'FAILED',
      details: {
        totalAttempts: attempt,
        fixesApplied: allFixes.length,
        remainingIssues: remaining.length,
        suggestionOnly: true,
      }
    });

    return {
      status: 'FAILED',
      totalAttempts: attempt,
      fixesApplied: allFixes,
      remainingIssues: remaining,
    };
  }

  // ── Circuit breaker or exhausted strategies ──
  const finalReport = loadRepairTasks(projectRoot);
  const remaining = finalReport?.failures.map(
    (f) => `[${f.type}] ${f.error.split('\n')[0].slice(0, 100)}`,
  ) ?? [];

  writeLog(projectRoot, 'runs', {
    id: pipelineId,
    command: 'repair',
    phase: 'actuation',
    status: 'FAILED',
    details: { totalAttempts: attempt, fixesApplied: allFixes.length, remainingIssues: remaining.length }
  });

  return {
    status: 'FAILED',
    totalAttempts: attempt,
    fixesApplied: allFixes,
    remainingIssues: remaining,
  };
}
