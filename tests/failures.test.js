const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createFailureCaptureReport,
  parseRawErrors,
  readFailureCaptureReport,
  writeFailureCaptureReport,
} = require('../src/failures.ts');

test('parseRawErrors extracts structured failures from command output', () => {
  const failures = parseRawErrors(`
1) homepage renders
Error: locator(".cta") timed out
  at tests/example.spec.ts:10

2) api responds
Error: expect(response.status()).toBe(200)
`);

  assert.equal(failures.length, 2);
  assert.equal(failures[0].source, 'test-command');
  assert.match(failures[0].error, /locator/);
  assert.equal(failures[1].rawType, 'assertion');
});

test('failure capture report round-trips through disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-failures-'));
  const filePath = path.join(dir, '.aok', 'e2e-failures.json');
  const report = createFailureCaptureReport([
    {
      id: 'f-1',
      step: 'checkout',
      error: 'Error: request failed',
      timestamp: new Date().toISOString(),
      source: 'test-command',
      rawType: 'functional',
    },
  ]);

  writeFailureCaptureReport(filePath, report);
  const loaded = readFailureCaptureReport(filePath);

  assert.equal(loaded.status, 'failed');
  assert.equal(loaded.failures.length, 1);
  assert.equal(loaded.failures[0].id, 'f-1');
});

test('legacy reporter payloads are normalized into the shared schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-legacy-'));
  const filePath = path.join(dir, '.aok', 'e2e-failures.json');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      status: 'failed',
      failures: [
        {
          id: 'pw-1',
          title: 'search: returns result',
          step: 'search',
          type: 'State',
          errorMessage: 'Error: locator("button") timed out',
          file: 'tests/search.spec.ts',
        },
      ],
    }),
  );

  const loaded = readFailureCaptureReport(filePath);
  assert.equal(loaded.failures.length, 1);
  assert.equal(loaded.failures[0].source, 'playwright-reporter');
  assert.equal(loaded.failures[0].location, 'tests/search.spec.ts');
  assert.match(loaded.failures[0].error, /locator/);
});
