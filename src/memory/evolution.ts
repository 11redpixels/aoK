import fs from 'fs';
import path from 'path';

// ========================================================
// TYPES
// ========================================================

export interface FixRecord {
  errorSignature: string;
  file: string;
  strategy: string;
  succeeded: boolean;
  regressedLater: boolean;
  durationMs: number;
  pipelineId: string;
  timestamp: string;
}

export interface FailurePattern {
  signature: string;
  occurrences: number;
  lastSeen: string;
  relatedFiles: string[];
}

export interface ExplorationRecord {
  file: string;
  strategy: string;
  succeeded: boolean;
  regressionsCaused: boolean;
  timestamp: string;
}

export interface EvolutionState {
  fixes: FixRecord[];
  patterns: Record<string, FailurePattern>;
  regressions: Record<string, number>;
  explorations: ExplorationRecord[];
}

export interface EvolutionReport {
  timestamp: string;
  totalFixes: number;
  fixSuccessRate: number;
  chronicIssues: string[];
  regressionHotspots: string[];
  driftObservations: string[];
  topRecommendations: string[];
}

// ========================================================
// STORE MANAGEMENT
// ========================================================

function getMemoryPath(projectRoot: string): string {
  return path.join(projectRoot, '.aok', 'memory', 'evolution.json');
}

function loadMemory(projectRoot: string): EvolutionState {
  const p = getMemoryPath(projectRoot);
  if (fs.existsSync(p)) {
    try {
      const state = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!state.explorations) state.explorations = []; // migration
      return state;
    } catch { /* fresh start */ }
  }
  return { fixes: [], patterns: {}, regressions: {}, explorations: [] };
}

function saveMemory(projectRoot: string, state: EvolutionState): void {
  const p = getMemoryPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export function errorSignature(error: string): string {
  return error
    .replace(/\d+/g, 'N')
    .replace(/["'`]/g, '')
    .replace(/\/[^\s]+/g, '/PATH')
    .trim()
    .slice(0, 120)
    .toLowerCase();
}

// ========================================================
// QUERY API
// ========================================================

export function getFailedStrategies(projectRoot: string, signature: string): string[] {
  const state = loadMemory(projectRoot);
  const strategyFails: Record<string, number> = {};

  for (const fix of state.fixes) {
    if (fix.errorSignature === signature && !fix.succeeded) {
      strategyFails[fix.strategy] = (strategyFails[fix.strategy] || 0) + 1;
    }
  }

  return Object.keys(strategyFails).filter(s => strategyFails[s] >= 2);
}

export function getEffectiveStrategies(projectRoot: string, signature: string): string[] {
  const state = loadMemory(projectRoot);
  const effective = new Set<string>();

  for (const fix of state.fixes) {
    if (fix.errorSignature === signature && fix.succeeded) {
      effective.add(fix.strategy);
    }
  }

  return Array.from(effective);
}

export function isChronicFailure(projectRoot: string, signature: string): boolean {
  const state = loadMemory(projectRoot);
  const pattern = state.patterns[signature];
  return pattern ? pattern.occurrences >= 3 : false;
}

export function getKnownRegressions(projectRoot: string, file?: string): boolean | Record<string, number> {
  const state = loadMemory(projectRoot);
  if (file) {
    const normalizedFile = path.relative(projectRoot, file).replace(/\\/g, '/');
    return (state.regressions[normalizedFile] || 0) > 0;
  }
  return state.regressions;
}

export function getAllChronicFiles(projectRoot: string): string[] {
  const state = loadMemory(projectRoot);
  const files = new Set<string>();
  for (const pattern of Object.values(state.patterns)) {
    if (pattern.occurrences >= 3) {
      pattern.relatedFiles.forEach(f => files.add(f));
    }
  }
  return Array.from(files);
}

// ========================================================
// MUTATION API
// ========================================================

export function recordFix(
  projectRoot: string,
  fix: {
    errorSignature: string;
    file: string;
    strategy: string;
    succeeded: boolean;
    durationMs: number;
    pipelineId: string;
  }
): void {
  const state = loadMemory(projectRoot);
  const record: FixRecord = {
    ...fix,
    regressedLater: false,
    timestamp: new Date().toISOString()
  };

  state.fixes.push(record);
  saveMemory(projectRoot, state);
}

export function recordFailurePattern(projectRoot: string, signature: string, file: string, strategy: string): void {
  const state = loadMemory(projectRoot);
  
  if (!state.patterns[signature]) {
    state.patterns[signature] = {
      signature,
      occurrences: 0,
      lastSeen: new Date().toISOString(),
      relatedFiles: []
    };
  }

  const pattern = state.patterns[signature];
  pattern.occurrences += 1;
  pattern.lastSeen = new Date().toISOString();
  
  const normFile = path.relative(projectRoot, file).replace(/\\/g, '/');
  if (normFile && !pattern.relatedFiles.includes(normFile)) {
    pattern.relatedFiles.push(normFile);
  }

  saveMemory(projectRoot, state);
}

export function markRegression(projectRoot: string, file: string): void {
  const state = loadMemory(projectRoot);
  const normalizedFile = path.relative(projectRoot, file).replace(/\\/g, '/');
  
  state.regressions[normalizedFile] = (state.regressions[normalizedFile] || 0) + 1;
  
  // Also find successful fixes for this file and mark them as regressed
  for (const fix of state.fixes) {
    if (fix.succeeded && path.relative(projectRoot, fix.file).replace(/\\/g, '/') === normalizedFile) {
      fix.regressedLater = true;
    }
  }

  saveMemory(projectRoot, state);
}

export function recordExploration(
  projectRoot: string,
  record: Omit<ExplorationRecord, 'timestamp'>
): void {
  const state = loadMemory(projectRoot);
  state.explorations.push({
    ...record,
    timestamp: new Date().toISOString()
  });
  saveMemory(projectRoot, state);
}

export function generateEvolutionReport(projectRoot: string): EvolutionReport {
  const state = loadMemory(projectRoot);
  const totalFixes = state.fixes.length;
  const successfulFixes = state.fixes.filter(f => f.succeeded).length;
  const rate = totalFixes > 0 ? Math.round((successfulFixes / totalFixes) * 100) : 0;

  const chronicIssues = Object.values(state.patterns)
    .filter(p => p.occurrences >= 3)
    .map(p => `Pattern: ${p.signature.slice(0, 50)}... (${p.occurrences} occurrences)`);

  const regressionHotspots = Object.entries(state.regressions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([file, count]) => `${file} (${count} regressions)`);

  // Observations
  const driftObservations = [];
  if (rate < 50 && totalFixes > 5) {
    driftObservations.push("System instability increasing — low fix success rate detected.");
  }
  if (regressionHotspots.length > 2) {
    driftObservations.push("High regression density in core files indicating structural decay.");
  }
  if (driftObservations.length === 0) {
    driftObservations.push("System stable — code architecture handling auto-fixes gracefully.");
  }

  // Recommendations
  const topRecommendations = [];
  if (chronicIssues.length > 0) {
    topRecommendations.push(`Address ${chronicIssues.length} chronic failure patterns with major architectural refactors.`);
  }
  if (regressionHotspots.length > 0) {
    topRecommendations.push(`Add integration tests around hotspot: ${regressionHotspots[0].split(' ')[0]}`);
  }
  if (topRecommendations.length === 0) {
    topRecommendations.push('Continue monitoring. No major red flags.');
  }

  return {
    timestamp: new Date().toISOString(),
    totalFixes,
    fixSuccessRate: rate,
    chronicIssues,
    regressionHotspots,
    driftObservations,
    topRecommendations
  };
}
