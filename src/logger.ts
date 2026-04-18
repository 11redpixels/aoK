import fs from 'fs';
import path from 'path';

export type LogCategory = 'runs' | 'failures' | 'fixes' | 'explorations';

export interface LogEvent {
  id: string;          // UUID or tracking ID
  timestamp: string;   // ISO String
  command: string;     // 'run', 'repair', 'explore', 'test:e2e'
  phase: string;       // 'intelligence', 'actuation', 'verify', 'learn', 'explore'
  status: string;      // 'SUCCESS', 'FAILED', 'PARTIAL', 'INFO'
  details: any;        // Metadata object
}

export function writeLog(projectRoot: string, category: LogCategory, event: Omit<LogEvent, 'timestamp'>) {
  const logDir = path.join(projectRoot, '.aok', 'logs');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, `${category}.jsonl`);
  const fullEvent: LogEvent = {
    ...event,
    timestamp: new Date().toISOString()
  };

  try {
    fs.appendFileSync(logFile, JSON.stringify(fullEvent) + '\n', 'utf-8');
  } catch (err) {
    // Fail silently to avoid crashing the main loop on logging errors
    console.warn(`[AOK] Failed to write log: ${err}`);
  }
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
}
