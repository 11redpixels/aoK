import fs from 'fs';
import path from 'path';
import type { ProposalRecord } from './proposals.ts';

export type ProposalStatus = 'pending' | 'in_review' | 'accepted' | 'rejected' | 'implemented';

export interface ProposalRegistryEntry extends ProposalRecord {
  path: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
}

function getRegistryPath(projectRoot: string): string {
  return path.join(projectRoot, '.aok', 'proposals.json');
}

function loadRegistry(projectRoot: string): ProposalRegistryEntry[] {
  const registryPath = getRegistryPath(projectRoot);
  if (!fs.existsSync(registryPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRegistry(projectRoot: string, entries: ProposalRegistryEntry[]): void {
  const registryPath = getRegistryPath(projectRoot);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(entries, null, 2));
}

export function registerProposal(projectRoot: string, proposal: ProposalRecord, proposalPath: string): void {
  const entries = loadRegistry(projectRoot);
  const existingIndex = entries.findIndex((entry) => entry.id === proposal.id);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    const existing = entries[existingIndex];
    entries[existingIndex] = {
      ...existing,
      ...proposal,
      path: proposalPath,
      updatedAt: now,
    };
  } else {
    entries.push({
      ...proposal,
      path: proposalPath,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
  }

  entries.sort((a, b) => a.suggestedOrder - b.suggestedOrder || a.id.localeCompare(b.id));
  saveRegistry(projectRoot, entries);
}

export function listProposals(projectRoot: string): ProposalRegistryEntry[] {
  return loadRegistry(projectRoot);
}

export function updateProposalStatus(
  projectRoot: string,
  proposalId: string,
  status: ProposalStatus,
): ProposalRegistryEntry | null {
  const entries = loadRegistry(projectRoot);
  const entry = entries.find((candidate) => candidate.id === proposalId);
  if (!entry) {
    return null;
  }

  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  saveRegistry(projectRoot, entries);
  return entry;
}
