import fs from 'fs';
import path from 'path';
import { getKnownRegressions, getAllChronicFiles, recordExploration } from '../memory/evolution.ts';
import { writeLog, generateId } from '../logger.ts';
import { type ProposalRecord, writeExplorationProposals } from '../proposals.ts';

// ========================================================
// TYPES
// ========================================================

export interface ExplorationCandidate {
  file: string;
  score: number;
  reasons: string[];
}

export interface ExplorationResult {
  status: 'SUCCESS' | 'NO_CANDIDATES';
  zonesExplored: string[];
  details: string[];
}

// ========================================================
// ENGINE
// ========================================================

export function getExplorationPressure(projectRoot: string): number {
  const regressions = getKnownRegressions(projectRoot) as Record<string, number>;
  const totalRegressions = Object.values(regressions).reduce((sum, count) => sum + count, 0);
  const chronicFiles = getAllChronicFiles(projectRoot);

  // Pressure formula
  let score = 0;
  score += totalRegressions * 10;
  score += chronicFiles.length * 15;

  return Math.min(score, 100);
}

export function identifyExplorationCandidates(projectRoot: string): ExplorationCandidate[] {
  const regressions = getKnownRegressions(projectRoot) as Record<string, number>;
  const chronicFiles = getAllChronicFiles(projectRoot);

  const candidatesMap = new Map<string, ExplorationCandidate>();

  for (const [file, count] of Object.entries(regressions)) {
    candidatesMap.set(file, {
      file,
      score: count * 10,
      reasons: [`${count} past regressions recorded`],
    });
  }

  for (const file of chronicFiles) {
    if (candidatesMap.has(file)) {
      const c = candidatesMap.get(file)!;
      c.score += 20;
      c.reasons.push('Chronic failure locus');
    } else {
      candidatesMap.set(file, {
        file,
        score: 20,
        reasons: ['Chronic failure locus'],
      });
    }
  }

  // Fallback: If no memory candidates, scan src/ for large files
  if (candidatesMap.size === 0) {
    const fallbackCandidates = discoverLargeFiles(projectRoot);
    for (const f of fallbackCandidates) {
      candidatesMap.set(f, {
        file: f,
        score: 10,
        reasons: ['Large file size / High coupling risk'],
      });
    }
  }

  return Array.from(candidatesMap.values()).sort((a, b) => b.score - a.score);
}

function discoverLargeFiles(root: string): string[] {
  // Simple glob scan of src/ for big files (mock implementation)
  const srcDir = path.join(root, 'src');
  if (!fs.existsSync(srcDir)) return [];
  
  const found: string[] = [];
  function walk(dir: string) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.aok') walk(path.join(dir, entry.name));
        else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const size = fs.statSync(path.join(dir, entry.name)).size;
          if (size > 2000) found.push(path.relative(root, path.join(dir, entry.name)));
        }
      }
    } catch {}
  }
  walk(srcDir);
  return found.slice(0, 3);
}

// ========================================================
// ACTUATION
// ========================================================

export async function runExplorationWindow(projectRoot: string): Promise<ExplorationResult> {
  const pressure = getExplorationPressure(projectRoot);
  const exploreId = generateId();
  const candidates = identifyExplorationCandidates(projectRoot);

  writeLog(projectRoot, 'explorations', {
    id: exploreId,
    command: 'explore',
    phase: 'explore',
    status: 'INFO',
    details: { pressure, candidates: candidates.length }
  });

  console.log(`\n🔍 EXPLORATION WINDOW STARTED`);
  console.log(`   Pressure Score: ${pressure}/100\n`);

  if (candidates.length === 0) {
    return { status: 'NO_CANDIDATES', zonesExplored: [], details: ['No files require exploration'] };
  }

  const targets = candidates.slice(0, 3);
  console.log(`   Targeting ${targets.length} zone(s) for proposal generation:`);

  const explored: string[] = [];
  const details: string[] = [];
  const proposals: ProposalRecord[] = [];

  for (const target of targets) {
    console.log(`\n   🔬 Exploring: ${target.file}`);
    for (const reason of target.reasons) console.log(`      • ${reason}`);

    const absPath = path.isAbsolute(target.file) ? target.file : path.join(projectRoot, target.file);
    if (!fs.existsSync(absPath)) {
      console.log(`      ⏭  File not found on disk`);
      continue;
    }

    const proposal = summarizeExplorationProposal(target, fs.readFileSync(absPath, 'utf-8'));
    proposals.push(proposal);
    explored.push(target.file);
    details.push(`[Proposal recorded] ${target.file} — ${proposal.summary}`);

    recordExploration(projectRoot, {
      file: target.file,
      strategy: 'proposal-only',
      succeeded: true,
      regressionsCaused: false,
    });
  }

  const proposalFile = writeExplorationProposals(projectRoot, proposals, { pressure });

  writeLog(projectRoot, 'explorations', {
    id: exploreId,
    command: 'explore',
    phase: 'explore',
    status: 'SUCCESS',
    details: { zonesExplored: explored, proposalFile: path.relative(projectRoot, proposalFile) }
  });

  return { status: 'SUCCESS', zonesExplored: explored, details };
}

// ========================================================
// UTILS
// ========================================================

function summarizeExplorationProposal(candidate: ExplorationCandidate, content: string): ProposalRecord {
  const targetFiles = [candidate.file];
  const verificationSteps = [
    `Review the current tests covering ${candidate.file} and add a focused regression test before refactoring.`,
    `Apply the refactor in a branch and re-run the configured test command against the affected area.`,
    'Confirm the refactor reduces coupling or file size without introducing new failures.',
  ];

  if (content.length > 4000) {
    return {
      id: `explore-${candidate.file.replace(/[^\w]+/g, '-')}`,
      category: 'exploration',
      summary: `Decompose oversized module ${candidate.file}`,
      probableCause: `The file is large enough to trigger exploration fallback heuristics and is accumulating complexity signals: ${candidate.reasons.join('; ')}.`,
      targetFiles,
      proposedChange: `Split ${candidate.file} into smaller modules with narrower responsibilities before adding more repair logic.`,
      riskLevel: 'high',
      severity: 'high',
      confidence: 'medium',
      blastRadius: 'broad',
      suggestedOrder: 1,
      verificationSteps,
    };
  }

  if (/\n\s*\n\s*\n/.test(content)) {
    return {
      id: `explore-${candidate.file.replace(/[^\w]+/g, '-')}`,
      category: 'exploration',
      summary: `Normalize low-signal churn in ${candidate.file}`,
      probableCause: `The file shows formatting drift and mild structural decay signals: ${candidate.reasons.join('; ')}.`,
      targetFiles,
      proposedChange: `Normalize formatting, remove low-signal whitespace churn, and use that cleanup as a baseline before deeper refactors.`,
      riskLevel: 'low',
      severity: 'low',
      confidence: 'medium',
      blastRadius: 'narrow',
      suggestedOrder: 3,
      verificationSteps,
    };
  }

  return {
    id: `explore-${candidate.file.replace(/[^\w]+/g, '-')}`,
    category: 'exploration',
    summary: `Review coupling around ${candidate.file}`,
    probableCause: `Historical regressions or chronic failures suggest this file is a hotspot: ${candidate.reasons.join('; ')}.`,
    targetFiles,
    proposedChange: `Map dependencies around ${candidate.file}, add focused tests, then extract the highest-churn responsibilities into smaller units.`,
    riskLevel: 'medium',
    severity: 'medium',
    confidence: 'medium',
    blastRadius: 'moderate',
    suggestedOrder: 2,
    verificationSteps,
  };
}
