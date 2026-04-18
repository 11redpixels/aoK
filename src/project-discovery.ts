import fs from 'fs';
import path from 'path';

export interface ValidationCommandDetection {
  command: string | null;
  source: 'package-script' | 'playwright-convention' | 'none';
  reasoning: string;
}

interface PackageJsonShape {
  type?: string;
  scripts?: Record<string, string>;
}

const SCRIPT_CANDIDATES = [
  'test:e2e',
  'e2e',
  'test',
  'check',
  'verify',
  'validate',
  'smoke',
];

export function readPackageJson(projectRoot: string): PackageJsonShape | null {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
  } catch {
    return null;
  }
}

export function getProjectModuleType(projectRoot: string): 'module' | 'commonjs' {
  const packageJson = readPackageJson(projectRoot);
  return packageJson?.type === 'module' ? 'module' : 'commonjs';
}

export function chooseConfigFilename(projectRoot: string): 'aok.config.cjs' | 'aok.config.js' {
  return getProjectModuleType(projectRoot) === 'module' ? 'aok.config.cjs' : 'aok.config.js';
}

export function detectValidationCommand(projectRoot: string): ValidationCommandDetection {
  const packageJson = readPackageJson(projectRoot);
  const scripts = packageJson?.scripts ?? {};

  for (const name of SCRIPT_CANDIDATES) {
    const script = scripts[name];
    if (typeof script === 'string' && script.trim()) {
      return {
        command: `npm run ${name}`,
        source: 'package-script',
        reasoning: `Detected package.json script "${name}".`,
      };
    }
  }

  const hasPlaywrightConfig =
    fs.existsSync(path.join(projectRoot, 'playwright.config.ts')) ||
    fs.existsSync(path.join(projectRoot, 'playwright.config.js')) ||
    fs.existsSync(path.join(projectRoot, 'playwright.config.mjs'));
  const hasPlaywrightTests =
    fs.existsSync(path.join(projectRoot, 'tests')) ||
    fs.existsSync(path.join(projectRoot, 'e2e'));

  if (hasPlaywrightConfig && hasPlaywrightTests) {
    return {
      command: 'npx playwright test',
      source: 'playwright-convention',
      reasoning: 'Detected Playwright config and a conventional tests directory.',
    };
  }

  return {
    command: null,
    source: 'none',
    reasoning: 'No test, check, verify, validate, smoke, or Playwright convention was detected.',
  };
}
