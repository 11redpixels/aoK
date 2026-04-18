import fs from 'fs';
import path from 'path';
import { registerProposal } from './proposal-registry.ts';

export type ProposalRiskLevel = 'low' | 'medium' | 'high';
export type ProposalSeverity = 'low' | 'medium' | 'high';
export type ProposalConfidence = 'low' | 'medium' | 'high';
export type ProposalBlastRadius = 'narrow' | 'moderate' | 'broad';

export interface ProposalRecord {
  id: string;
  category: 'repair' | 'exploration';
  summary: string;
  probableCause: string;
  targetFiles: string[];
  proposedChange: string;
  riskLevel: ProposalRiskLevel;
  severity: ProposalSeverity;
  confidence: ProposalConfidence;
  blastRadius: ProposalBlastRadius;
  suggestedOrder: number;
  verificationSteps: string[];
}

export function writeRepairProposal(root: string, filename: string, proposal: ProposalRecord): string {
  const patchDir = path.join(root, '.aok', 'patches');
  fs.mkdirSync(patchDir, { recursive: true });
  const relativePath = path.join('.aok', 'patches', filename).replace(/\\/g, '/');
  fs.writeFileSync(path.join(root, relativePath), renderMarkdownProposal(proposal));
  registerProposal(root, proposal, relativePath);
  return relativePath;
}

export function writeExplorationProposals(
  root: string,
  proposals: ProposalRecord[],
  metadata: Record<string, unknown>,
): string {
  const proposalDir = path.join(root, '.aok', 'exploration');
  fs.mkdirSync(proposalDir, { recursive: true });
  const proposalPath = path.join(proposalDir, 'proposals.json');
  fs.writeFileSync(
    proposalPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...metadata,
        proposals,
      },
      null,
      2,
    ),
  );
  for (const proposal of proposals) {
    registerProposal(root, proposal, path.relative(root, proposalPath).replace(/\\/g, '/'));
  }
  return proposalPath;
}

function renderMarkdownProposal(proposal: ProposalRecord): string {
  return [
    `# ${proposal.summary}`,
    '',
    `- Category: ${proposal.category}`,
    `- Proposal ID: ${proposal.id}`,
    `- Risk Level: ${proposal.riskLevel}`,
    `- Severity: ${proposal.severity}`,
    `- Confidence: ${proposal.confidence}`,
    `- Blast Radius: ${proposal.blastRadius}`,
    `- Suggested Order: ${proposal.suggestedOrder}`,
    '',
    '## Probable Cause',
    proposal.probableCause,
    '',
    '## Target Files',
    ...proposal.targetFiles.map((file) => `- ${file}`),
    '',
    '## Proposed Change',
    proposal.proposedChange,
    '',
    '## Verification Steps',
    ...proposal.verificationSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
  ].join('\n');
}
