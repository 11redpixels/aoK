const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runUXValidator } = require('../src/intelligence/ux-validator.ts');
const { writeFailureCaptureReport } = require('../src/failures.ts');

test('runUXValidator classifies failures from the shared report schema', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-validator-'));
  const failuresPath = path.join(root, '.aok', 'e2e-failures.json');

  writeFailureCaptureReport(failuresPath, {
    generatedAt: new Date().toISOString(),
    status: 'failed',
    failures: [
      {
        id: 'failure-1',
        step: 'profile save',
        error: 'Error: locator("[data-testid=save]") timed out after 5000ms',
        timestamp: new Date().toISOString(),
        source: 'playwright-reporter',
        location: 'tests/profile.spec.ts',
      },
      {
        id: 'failure-2',
        step: 'api health',
        error: 'Error: GET /api/health returned 500 Internal Server Error',
        timestamp: new Date().toISOString(),
        source: 'test-command',
      },
    ],
  });

  const report = runUXValidator(root);
  assert.equal(report.totalFailures, 2);
  const uxFailure = report.failures.find((failure) => failure.id === 'failure-1');
  const functionalFailure = report.failures.find((failure) => failure.id === 'failure-2');
  assert.equal(uxFailure.type, 'UX');
  assert.equal(functionalFailure.type, 'FUNCTIONAL');
  assert.equal(functionalFailure.suggestedOrder, 1);

  const repairTasksPath = path.join(root, '.aok', 'repair-tasks.json');
  assert.ok(fs.existsSync(repairTasksPath));
});
