const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { chooseConfigFilename, detectValidationCommand } = require('../src/project-discovery.ts');
const { resolveConfig, resetConfigCache } = require('../src/config.ts');

test('detectValidationCommand prefers explicit package scripts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-discovery-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'detected-project',
      scripts: {
        check: 'node check.js',
        test: 'node test.js',
      },
    }),
  );

  const detection = detectValidationCommand(root);
  assert.equal(detection.command, 'npm run test');
  assert.equal(detection.source, 'package-script');
});

test('chooseConfigFilename uses cjs for module projects', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-module-type-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'module-project',
      type: 'module',
    }),
  );

  assert.equal(chooseConfigFilename(root), 'aok.config.cjs');
});

test('resolveConfig falls back to detected command when no config exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-config-fallback-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fallback-project',
      scripts: {
        check: 'node check.js',
      },
    }),
  );

  resetConfigCache();
  const resolution = resolveConfig(root);
  assert.equal(resolution.config.testCommand, 'npm run check');
  assert.equal(resolution.source, 'detected');
  assert.match(resolution.warnings[0], /No AOK config file found/);
});
