import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { detectValidationCommand } from './project-discovery.ts';

export interface AOKConfig {
  testCommand: string;
  maxRepairAttempts: number;
  enableExploration: boolean;
  memoryPath: string;
  strictUXMode: boolean;
}

export interface ConfigResolution {
  config: AOKConfig;
  configPath: string | null;
  source: 'config' | 'detected' | 'default';
  warnings: string[];
}

const DEFAULT_CONFIG: AOKConfig = {
  testCommand: '',
  maxRepairAttempts: 4,
  enableExploration: false,
  memoryPath: '.aok/memory',
  strictUXMode: true,
};

const cachedConfigs = new Map<string, ConfigResolution>();

export function getConfig(projectRoot: string): AOKConfig {
  return resolveConfig(projectRoot).config;
}

export function resolveConfig(projectRoot: string): ConfigResolution {
  if (cachedConfigs.has(projectRoot)) {
    return cachedConfigs.get(projectRoot)!;
  }

  const configCandidates = [
    path.join(projectRoot, 'aok.config.cjs'),
    path.join(projectRoot, 'aok.config.js'),
  ];
  const configPath = configCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  const detected = detectValidationCommand(projectRoot);

  if (!configPath) {
    const resolution: ConfigResolution = {
      config: {
        ...DEFAULT_CONFIG,
        testCommand: detected.command ?? DEFAULT_CONFIG.testCommand,
      },
      configPath: null,
      source: detected.command ? 'detected' : 'default',
      warnings: detected.command
        ? [`No AOK config file found. Using detected validation command: ${detected.command}`]
        : ['No AOK config file found and no validation command could be detected.'],
    };
    cachedConfigs.set(projectRoot, resolution);
    return resolution;
  }

  try {
    const localRequire = createRequire(configPath);
    const userConfig = localRequire(configPath);
    const warnings: string[] = [];
    const configuredTestCommand = typeof userConfig.testCommand === 'string' ? userConfig.testCommand.trim() : '';

    if (!configuredTestCommand) {
      warnings.push(
        detected.command
          ? `Config missing testCommand. Falling back to detected validation command: ${detected.command}`
          : 'Config missing testCommand and no validation command was detected.',
      );
    }

    const resolution: ConfigResolution = {
      config: {
        testCommand: configuredTestCommand || detected.command || DEFAULT_CONFIG.testCommand,
        maxRepairAttempts: typeof userConfig.maxRepairAttempts === 'number' ? userConfig.maxRepairAttempts : DEFAULT_CONFIG.maxRepairAttempts,
        enableExploration: typeof userConfig.enableExploration === 'boolean' ? userConfig.enableExploration : DEFAULT_CONFIG.enableExploration,
        memoryPath: typeof userConfig.memoryPath === 'string' ? userConfig.memoryPath : DEFAULT_CONFIG.memoryPath,
        strictUXMode: typeof userConfig.strictUXMode === 'boolean' ? userConfig.strictUXMode : DEFAULT_CONFIG.strictUXMode,
      },
      configPath,
      source: 'config',
      warnings,
    };
    cachedConfigs.set(projectRoot, resolution);
    return resolution;
  } catch (err: any) {
    const resolution: ConfigResolution = {
      config: {
        ...DEFAULT_CONFIG,
        testCommand: detected.command ?? DEFAULT_CONFIG.testCommand,
      },
      configPath,
      source: detected.command ? 'detected' : 'default',
      warnings: [
        `Failed to parse ${path.basename(configPath)}: ${err.message}`,
        detected.command
          ? `Falling back to detected validation command: ${detected.command}`
          : 'No validation command could be detected, so AOK has no runnable truth command.',
      ],
    };
    cachedConfigs.set(projectRoot, resolution);
    return resolution;
  }
}

export function resetConfigCache() {
  cachedConfigs.clear();
}
