import fs from 'fs';
import path from 'path';
import { readFailureCaptureReport } from '../failures.ts';

// ========================================================
// TYPES
// ========================================================

export type FailureType = 'UX' | 'FUNCTIONAL' | 'NETWORK' | 'UNKNOWN';

export interface Failure {
  id: string;
  type: FailureType;
  step: string;
  error: string;
  probableCause: string;
  suggestedTargetFiles: string[];
  severity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  blastRadius: 'narrow' | 'moderate' | 'broad';
  suggestedOrder: number;
}

export interface RepairTaskReport {
  generatedAt: string;
  totalFailures: number;
  failures: Failure[];
}

interface RawFailure {
  id?: string;
  step?: string;
  type?: string;
  error?: string;
  timestamp?: string;
  location?: string;
  title?: string;
}

// ========================================================
// CLASSIFICATION ENGINE
// ========================================================

function classifyFailure(error: string): FailureType {
  const lower = error.toLowerCase();

  // UX failures — DOM/rendering/locator issues
  if (
    lower.includes('locator') ||
    lower.includes('element not found') ||
    lower.includes('selector') ||
    lower.includes('not visible') ||
    lower.includes('not attached') ||
    lower.includes('intercept') ||
    lower.includes('click') && lower.includes('timeout') ||
    lower.includes('waiting for') && lower.includes('selector') ||
    lower.includes('detached from dom') ||
    lower.includes('strict mode violation')
  ) {
    return 'UX';
  }

  // FUNCTIONAL failures — API/server/logic errors
  if (
    lower.includes('500') ||
    lower.includes('404') ||
    lower.includes('fetch failed') ||
    lower.includes('api') ||
    lower.includes('internal server error') ||
    lower.includes('unhandled') ||
    lower.includes('uncaught') ||
    lower.includes('referenceerror') ||
    lower.includes('typeerror') ||
    lower.includes('cannot read propert') ||
    lower.includes('is not a function') ||
    lower.includes('is not defined') ||
    lower.includes('pdf') && lower.includes('fail')
  ) {
    return 'FUNCTIONAL';
  }

  // NETWORK failures — connectivity/timeout
  if (
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('network') ||
    lower.includes('dns') ||
    lower.includes('socket hang up') ||
    lower.includes('abort')
  ) {
    return 'NETWORK';
  }

  return 'UNKNOWN';
}

// ========================================================
// ROOT CAUSE HEURISTICS
// ========================================================

function inferProbableCause(type: FailureType, error: string): string {
  const lower = error.toLowerCase();

  // ── UX causes ──
  if (type === 'UX') {
    if (lower.includes('click') && lower.includes('timeout'))
      return 'UI element not rendered or blocked by overlapping state';
    if (lower.includes('strict mode violation'))
      return 'Multiple elements matched selector — ambiguous locator';
    if (lower.includes('not visible'))
      return 'Element exists in DOM but is hidden or off-screen';
    if (lower.includes('not attached') || lower.includes('detached'))
      return 'Element was removed from DOM during interaction (race condition)';
    if (lower.includes('intercept'))
      return 'Click was intercepted by an overlay, modal, or tooltip';
    if (lower.includes('waiting for'))
      return 'Element did not appear within expected timeout — possible render failure';
    return 'UI element not rendered or blocked by state';
  }

  // ── FUNCTIONAL causes ──
  if (type === 'FUNCTIONAL') {
    if (lower.includes('500'))
      return 'Backend route returned 500 — server handler threw or missing error boundary';
    if (lower.includes('404'))
      return 'Route or resource not found — missing endpoint or wrong URL';
    if (lower.includes('fetch failed'))
      return 'Client-side fetch call failed — server may be down or CORS misconfigured';
    if (lower.includes('pdf'))
      return 'Client-side PDF generation failure — DOM not ready or library error';
    if (lower.includes('typeerror') || lower.includes('cannot read propert'))
      return 'Null/undefined property access — missing data or incorrect state';
    if (lower.includes('referenceerror') || lower.includes('is not defined'))
      return 'Variable reference error — missing import or undefined binding';
    if (lower.includes('is not a function'))
      return 'Attempted to call non-function — wrong type or missing method';
    if (lower.includes('unhandled') || lower.includes('uncaught'))
      return 'Unhandled exception — missing error handler or unexpected state';
    return 'Backend logic failure or missing handler';
  }

  // ── NETWORK causes ──
  if (type === 'NETWORK') {
    if (lower.includes('econnrefused'))
      return 'Server is not running or not accepting connections on expected port';
    if (lower.includes('econnreset'))
      return 'Connection was forcibly closed by remote host';
    if (lower.includes('enotfound') || lower.includes('dns'))
      return 'DNS resolution failed — invalid hostname or DNS misconfiguration';
    if (lower.includes('timeout'))
      return 'Request timed out — server overloaded or network latency';
    if (lower.includes('socket hang up'))
      return 'Server closed connection prematurely — possible crash during request';
    return 'Network connectivity failure';
  }

  return 'Unknown failure — manual investigation required';
}

// ========================================================
// FILE TARGETING HEURISTICS
// ========================================================

function suggestTargetFiles(type: FailureType, error: string): string[] {
  const lower = error.toLowerCase();

  switch (type) {
    case 'UX': {
      const targets = ['client/components/*', 'client/pages/*'];
      if (lower.includes('modal') || lower.includes('dialog'))
        targets.push('client/components/Modal*');
      if (lower.includes('form') || lower.includes('input'))
        targets.push('client/components/Form*');
      if (lower.includes('search'))
        targets.push('client/components/Search*');
      if (lower.includes('table') || lower.includes('list'))
        targets.push('client/components/Table*', 'client/components/List*');
      if (lower.includes('nav') || lower.includes('menu'))
        targets.push('client/components/Nav*');
      return targets;
    }

    case 'FUNCTIONAL': {
      const targets = ['server/routes/*', 'server/controllers/*'];
      // Try to extract route path from error
      const routeMatch = error.match(/\/api\/[a-z0-9\-_/]+/i);
      if (routeMatch) {
        const routeSegment = routeMatch[0]
          .replace('/api/', '')
          .split('/')[0];
        targets.unshift(`server/routes/${routeSegment}*`);
      }
      if (lower.includes('pdf'))
        targets.push('client/lib/pdf*', 'server/services/pdf*');
      if (lower.includes('database') || lower.includes('query'))
        targets.push('server/db/*', 'server/models/*');
      return targets;
    }

    case 'NETWORK': {
      return [
        'server/index.ts',
        'server/config.*',
        '.env',
        'config/*',
      ];
    }

    default:
      return ['(manual investigation required)'];
  }
}

function inferConfidence(type: FailureType, error: string): Failure['confidence'] {
  const lower = error.toLowerCase();
  if (type === 'UNKNOWN') return 'low';
  if (type === 'UX' && (lower.includes('locator') || lower.includes('strict mode violation'))) return 'high';
  if (type === 'FUNCTIONAL' && (lower.includes('500') || lower.includes('404') || lower.includes('/api/'))) return 'high';
  if (type === 'NETWORK' && (lower.includes('econnrefused') || lower.includes('timeout'))) return 'medium';
  return 'medium';
}

function inferSeverity(type: FailureType, error: string): Failure['severity'] {
  const lower = error.toLowerCase();
  if (type === 'FUNCTIONAL' && (lower.includes('500') || lower.includes('internal server error'))) return 'high';
  if (type === 'NETWORK' && (lower.includes('econnrefused') || lower.includes('dns'))) return 'high';
  if (type === 'UX' && lower.includes('strict mode violation')) return 'medium';
  if (type === 'UNKNOWN') return 'low';
  return 'medium';
}

function inferBlastRadius(type: FailureType, suggestedTargetFiles: string[]): Failure['blastRadius'] {
  if (suggestedTargetFiles.length >= 4) return 'broad';
  if (type === 'FUNCTIONAL' || type === 'NETWORK') return 'moderate';
  return 'narrow';
}

function priorityWeight(failure: Pick<Failure, 'severity' | 'confidence' | 'blastRadius'>): number {
  const severityWeight = { low: 10, medium: 20, high: 30 }[failure.severity];
  const confidenceWeight = { low: 1, medium: 2, high: 3 }[failure.confidence];
  const blastRadiusWeight = { narrow: 1, moderate: 2, broad: 3 }[failure.blastRadius];
  return severityWeight * 10 + confidenceWeight * 3 + blastRadiusWeight;
}

// ========================================================
// MAIN: RUN UX VALIDATION
// ========================================================

export function runUXValidator(projectRoot: string): RepairTaskReport {
  const failuresPath = path.join(projectRoot, '.aok', 'e2e-failures.json');
  const repairPath = path.join(projectRoot, '.aok', 'repair-tasks.json');

  // ── Read raw failures ──
  if (!fs.existsSync(failuresPath)) {
    const emptyReport: RepairTaskReport = {
      generatedAt: new Date().toISOString(),
      totalFailures: 0,
      failures: [],
    };
    fs.writeFileSync(repairPath, JSON.stringify(emptyReport, null, 2));
    return emptyReport;
  }

  const captureReport = readFailureCaptureReport(failuresPath);
  const raw: RawFailure[] = captureReport.failures.map((failure) => ({
    id: failure.id,
    step: failure.step,
    type: failure.rawType,
    error: failure.error,
    timestamp: failure.timestamp,
    location: failure.location,
    title: failure.title,
  }));

  if (!Array.isArray(raw) || raw.length === 0) {
    const emptyReport: RepairTaskReport = {
      generatedAt: new Date().toISOString(),
      totalFailures: 0,
      failures: [],
    };
    fs.writeFileSync(repairPath, JSON.stringify(emptyReport, null, 2));
    return emptyReport;
  }

  // ── Classify each failure ──
  const failures: Failure[] = raw.map((entry, index) => {
    const errorText = entry.error || '';
    const type = classifyFailure(errorText);
    const suggestedFile = entry.location || '';
    const suggestedTargetFiles = suggestedFile
      ? [suggestedFile, ...suggestTargetFiles(type, errorText)]
      : suggestTargetFiles(type, errorText);
    const confidence = inferConfidence(type, errorText);
    const severity = inferSeverity(type, errorText);
    const blastRadius = inferBlastRadius(type, suggestedTargetFiles);

    return {
      id: entry.id || `fail-${index + 1}`,
      type,
      step: entry.step || entry.title || 'unknown',
      error: errorText,
      probableCause: inferProbableCause(type, errorText),
      suggestedTargetFiles,
      severity,
      confidence,
      blastRadius,
      suggestedOrder: 0,
    };
  });

  failures
    .sort((a, b) => priorityWeight(b) - priorityWeight(a) || a.id.localeCompare(b.id))
    .forEach((failure, index) => {
      failure.suggestedOrder = index + 1;
    });

  // ── Build report ──
  const report: RepairTaskReport = {
    generatedAt: new Date().toISOString(),
    totalFailures: failures.length,
    failures,
  };

  // ── Write repair-tasks.json ──
  fs.writeFileSync(repairPath, JSON.stringify(report, null, 2));

  return report;
}
