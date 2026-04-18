const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI_ARGS = ['--no-warnings', '--experimental-strip-types', path.join(ROOT, 'bin', 'aok.ts')];
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [...CLI_ARGS, ...args], {
    cwd,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function createFixtureProject(name) {
  const source = path.join(ROOT, 'tests', 'fixtures', name);
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `aok-${name}-`));
  copyDir(source, target);
  return target;
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const srcPath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, targetPath);
    } else {
      fs.copyFileSync(srcPath, targetPath);
    }
  }
}

function expectSuccess(result, context) {
  assert.equal(result.status, 0, `${context}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function expectStatus(result, status, context) {
  assert.equal(result.status, status, `${context}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function runFailureFixtureFlow() {
  const projectRoot = createFixtureProject('failing-project');

  let result = runCli(projectRoot, ['init']);
  expectSuccess(result, 'init failed');
  assert.ok(fs.existsSync(path.join(projectRoot, 'aok.config.js')));
  assert.ok(fs.existsSync(path.join(projectRoot, '.aok')));

  fs.writeFileSync(
    path.join(projectRoot, 'aok.config.js'),
    `module.exports = {
  testCommand: "node fail-test.js",
  maxRepairAttempts: 4,
  enableExploration: false,
  strictUXMode: true,
  memoryPath: ".aok/memory"
};\n`,
  );

  result = runCli(projectRoot, ['test:e2e']);
  expectStatus(result, 0, 'test:e2e failed unexpectedly');
  assert.match(result.stdout, /failure\(s\) classified/i);

  const failureReport = JSON.parse(fs.readFileSync(path.join(projectRoot, '.aok', 'e2e-failures.json'), 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.ok(failureReport.failures.length >= 1);

  const repairTasks = JSON.parse(fs.readFileSync(path.join(projectRoot, '.aok', 'repair-tasks.json'), 'utf8'));
  assert.ok(repairTasks.failures.length >= 1);
  assert.equal(repairTasks.failures[0].suggestedOrder, 1);

  result = runCli(projectRoot, ['tasks']);
  expectSuccess(result, 'tasks failed');
  assert.match(result.stdout, /Severity:/);
  assert.match(result.stdout, /Suggested Ord:/);

  result = runCli(projectRoot, ['repair']);
  expectStatus(result, 1, 'repair should exit non-zero when unresolved issues remain');
  const patchDir = path.join(projectRoot, '.aok', 'patches');
  assert.ok(fs.existsSync(patchDir));
  const patchFiles = fs.readdirSync(patchDir);
  assert.ok(patchFiles.length >= 1);
  const firstPatch = fs.readFileSync(path.join(patchDir, patchFiles[0]), 'utf8');
  assert.match(firstPatch, /## Probable Cause/);
  assert.match(firstPatch, /## Proposed Change/);
  assert.match(firstPatch, /## Verification Steps/);
  assert.match(firstPatch, /Severity:/);
  assert.match(firstPatch, /Suggested Order:/);

  result = runCli(projectRoot, ['patches']);
  expectSuccess(result, 'patches failed');
  assert.match(result.stdout, /AOK PROPOSAL REGISTRY/);
  assert.match(result.stdout, /pending/);

  const registry = JSON.parse(fs.readFileSync(path.join(projectRoot, '.aok', 'proposals.json'), 'utf8'));
  assert.ok(registry.length >= 1);
  const proposalId = registry[0].id;

  result = runCli(projectRoot, ['proposal:status', proposalId, 'accepted']);
  expectSuccess(result, 'proposal:status failed');

  result = runCli(projectRoot, ['patches']);
  expectSuccess(result, 'patches after status update failed');
  assert.match(result.stdout, /accepted/);

  result = runCli(projectRoot, ['report']);
  expectSuccess(result, 'report failed');
  assert.match(result.stdout, /AOK EVOLUTION REPORT/);
}

function runExploreFixtureFlow() {
  const projectRoot = createFixtureProject('explore-project');

  let result = runCli(projectRoot, ['init']);
  expectSuccess(result, 'init failed for explore fixture');

  fs.mkdirSync(path.join(projectRoot, '.aok', 'memory'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, '.aok', 'memory', 'evolution.json'),
    JSON.stringify({
      fixes: [],
      patterns: {
        chronic: {
          signature: 'hotspot signature',
          occurrences: 3,
          lastSeen: new Date().toISOString(),
          relatedFiles: ['src/hotspot.ts'],
        },
      },
      regressions: {
        'src/hotspot.ts': 7,
      },
      explorations: [],
    }),
  );

  result = runCli(projectRoot, ['explore']);
  expectSuccess(result, 'explore failed');
  assert.match(result.stdout, /EXPLORATION COMPLETE/);

  const proposalFile = path.join(projectRoot, '.aok', 'exploration', 'proposals.json');
  assert.ok(fs.existsSync(proposalFile));
  const payload = JSON.parse(fs.readFileSync(proposalFile, 'utf8'));
  assert.ok(payload.proposals.length >= 1);
  const proposal = payload.proposals[0];
  assert.ok(proposal.summary);
  assert.ok(proposal.probableCause);
  assert.ok(Array.isArray(proposal.targetFiles));
  assert.ok(proposal.proposedChange);
  assert.ok(proposal.riskLevel);
  assert.ok(proposal.severity);
  assert.ok(proposal.confidence);
  assert.ok(proposal.blastRadius);
  assert.ok(proposal.suggestedOrder);
  assert.ok(Array.isArray(proposal.verificationSteps));
}

function runEsmConfigFlow() {
  const projectRoot = createFixtureProject('esm-project');

  let result = runCli(projectRoot, ['init']);
  expectSuccess(result, 'init failed for esm fixture');
  assert.ok(fs.existsSync(path.join(projectRoot, 'aok.config.cjs')));
  assert.ok(!fs.existsSync(path.join(projectRoot, 'aok.config.js')));
  assert.match(result.stdout, /Validation command: npm run check/);

  result = runCli(projectRoot, ['doctor']);
  expectSuccess(result, 'doctor failed for esm fixture');
  assert.match(result.stdout, /aok\.config\.cjs found/);
  assert.match(result.stdout, /Validation command ready: npm run check/);

  result = runCli(projectRoot, ['test:e2e']);
  expectSuccess(result, 'test:e2e failed for esm fixture');
  assert.match(result.stdout, /All tests passed/);
}

function runLivePlaywrightFlow() {
  assert.ok(fs.existsSync(CHROME_PATH), `Chrome executable not found at ${CHROME_PATH}`);

  const projectRoot = createFixtureProject('live-app');
  const playwrightCli = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
  assert.ok(fs.existsSync(playwrightCli), 'Playwright CLI is not installed');

  let result = runCli(projectRoot, ['init']);
  expectSuccess(result, 'init failed for live app fixture');
  const defaultExample = path.join(projectRoot, 'tests', 'example.spec.ts');
  if (fs.existsSync(defaultExample)) {
    fs.unlinkSync(defaultExample);
  }

  const testCommand = [
    `NODE_PATH=${shellQuote(path.join(ROOT, 'node_modules'))}`,
    `AOK_CHROME_PATH=${shellQuote(CHROME_PATH)}`,
    `${shellQuote(process.execPath)} ${shellQuote(playwrightCli)} test`,
  ].join(' ');

  fs.writeFileSync(
    path.join(projectRoot, 'aok.config.js'),
    `module.exports = {
  testCommand: ${JSON.stringify(testCommand)},
  maxRepairAttempts: 4,
  enableExploration: false,
  strictUXMode: true,
  memoryPath: ".aok/memory"
};\n`,
  );

  result = runCli(projectRoot, ['test:e2e']);
  expectSuccess(result, 'live test:e2e failed');
  assert.match(result.stdout, /Reality Layer/);
  assert.match(result.stdout, /failure\(s\) classified/i);

  const capture = JSON.parse(fs.readFileSync(path.join(projectRoot, '.aok', 'e2e-failures.json'), 'utf8'));
  assert.equal(capture.status, 'failed');
  assert.ok(capture.failures.some((failure) => /locator/i.test(failure.error)));

  result = runCli(projectRoot, ['tasks']);
  expectSuccess(result, 'live tasks failed');
  assert.match(result.stdout, /Type:\s+UX/);

  result = runCli(projectRoot, ['repair']);
  expectStatus(result, 1, 'live repair should remain suggestion-only');
  const patchFiles = fs.readdirSync(path.join(projectRoot, '.aok', 'patches'));
  assert.ok(patchFiles.length >= 1);
}

runFailureFixtureFlow();
runExploreFixtureFlow();
runEsmConfigFlow();
runLivePlaywrightFlow();
console.log('CLI checks passed');
