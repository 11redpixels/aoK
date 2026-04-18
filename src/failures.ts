import fs from 'fs';
import path from 'path';

export interface CapturedFailure {
  id: string;
  step: string;
  error: string;
  timestamp: string;
  source: 'test-command' | 'playwright-reporter';
  title?: string;
  location?: string;
  rawType?: string;
}

export interface FailureCaptureReport {
  generatedAt: string;
  status: 'passed' | 'failed';
  failures: CapturedFailure[];
}

function buildReport(
  failures: CapturedFailure[],
  status: FailureCaptureReport['status'],
): FailureCaptureReport {
  return {
    generatedAt: new Date().toISOString(),
    status,
    failures,
  };
}

export function createFailureCaptureReport(
  failures: CapturedFailure[],
  status: FailureCaptureReport['status'] = failures.length > 0 ? 'failed' : 'passed',
): FailureCaptureReport {
  return buildReport(failures, status);
}

export function normalizeFailureCaptureReport(input: unknown): FailureCaptureReport {
  if (Array.isArray(input)) {
    return buildReport(normalizeFailures(input), input.length > 0 ? 'failed' : 'passed');
  }

  if (input && typeof input === 'object') {
    const maybeReport = input as { generatedAt?: unknown; status?: unknown; failures?: unknown };
    const failures = normalizeFailures(maybeReport.failures);
    const status =
      maybeReport.status === 'passed' || maybeReport.status === 'failed'
        ? maybeReport.status
        : failures.length > 0
          ? 'failed'
          : 'passed';

    return {
      generatedAt:
        typeof maybeReport.generatedAt === 'string'
          ? maybeReport.generatedAt
          : new Date().toISOString(),
      status,
      failures,
    };
  }

  return buildReport([], 'passed');
}

function normalizeFailures(input: unknown): CapturedFailure[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry, index): CapturedFailure | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const raw = entry as Record<string, unknown>;
      const error =
        typeof raw.error === 'string'
          ? raw.error
          : typeof raw.errorMessage === 'string'
            ? raw.errorMessage
            : '';

      if (!error.trim()) {
        return null;
      }

      const title = typeof raw.title === 'string' ? raw.title : undefined;
      const step =
        typeof raw.step === 'string' && raw.step.trim()
          ? raw.step
          : title && title.trim()
            ? title
            : 'unknown';

      return {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `failure-${index + 1}`,
        step,
        error,
        timestamp:
          typeof raw.timestamp === 'string' && raw.timestamp.trim()
            ? raw.timestamp
            : new Date().toISOString(),
        source:
          raw.source === 'playwright-reporter' || raw.source === 'test-command'
            ? raw.source
            : title || raw.errorMessage
              ? 'playwright-reporter'
              : 'test-command',
        title,
        location:
          typeof raw.location === 'string'
            ? raw.location
            : typeof raw.file === 'string'
              ? raw.file
              : undefined,
        rawType: typeof raw.type === 'string' ? raw.type : undefined,
      };
    })
    .filter((failure): failure is CapturedFailure => failure !== null);
}

export function readFailureCaptureReport(filePath: string): FailureCaptureReport {
  if (!fs.existsSync(filePath)) {
    return buildReport([], 'passed');
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return normalizeFailureCaptureReport(raw);
  } catch {
    return buildReport([], 'passed');
  }
}

export function writeFailureCaptureReport(filePath: string, report: FailureCaptureReport): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
}

export function parseRawErrors(output: string): CapturedFailure[] {
  const failures: CapturedFailure[] = [];
  const lines = output.split('\n');
  let currentError = '';
  let inErrorBlock = false;

  for (const line of lines) {
    const isStart =
      /^\s*\d+\)\s/.test(line) ||
      /Error:/.test(line) ||
      /Timeout/.test(line) ||
      /expect\(.*\)\.to/.test(line) ||
      /locator\./.test(line) ||
      (/failed/i.test(line) && /test/i.test(line));

    if (isStart && !inErrorBlock) {
      inErrorBlock = true;
      currentError = line;
      continue;
    }

    if (!inErrorBlock) {
      continue;
    }

    if (/^\s*$/.test(line) || /^\s*\d+\)\s/.test(line)) {
      if (currentError.trim()) {
        failures.push(buildCommandFailure(currentError, failures.length));
      }

      if (/^\s*\d+\)\s/.test(line)) {
        currentError = line;
        inErrorBlock = true;
      } else {
        currentError = '';
        inErrorBlock = false;
      }
      continue;
    }

    currentError += '\n' + line;
  }

  if (currentError.trim()) {
    failures.push(buildCommandFailure(currentError, failures.length));
  }

  if (failures.length === 0 && output.trim()) {
    failures.push(buildCommandFailure(output.slice(-2000).trim(), 0));
  }

  return failures;
}

function buildCommandFailure(error: string, index: number): CapturedFailure {
  return {
    id: `failure-${index + 1}`,
    step: 'unknown',
    error,
    timestamp: new Date().toISOString(),
    source: 'test-command',
    rawType: classifyRawError(error),
  };
}

function classifyRawError(errorText: string): string {
  const lower = errorText.toLowerCase();
  if (lower.includes('timeout')) return 'timeout';
  if (lower.includes('expect') && lower.includes('to')) return 'assertion';
  if (lower.includes('locator') || lower.includes('selector')) return 'locator';
  if (lower.includes('navigation') || lower.includes('navigate')) return 'navigation';
  if (lower.includes('console error') || lower.includes('uncaught')) return 'console-error';
  return 'unknown';
}
