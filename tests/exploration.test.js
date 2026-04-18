const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runExplorationWindow } = require('../src/exploration/engine.ts');

test('runExplorationWindow records proposals without mutating source files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aok-explore-'));
  const srcDir = path.join(root, 'src');
  const filePath = path.join(srcDir, 'feature.ts');
  const original = 'export const feature = () => true;\n';

  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(filePath, original);
  fs.mkdirSync(path.join(root, '.aok', 'memory'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.aok', 'memory', 'evolution.json'),
    JSON.stringify({
      fixes: [],
      patterns: {
        chronic: {
          signature: 'locator timeout',
          occurrences: 3,
          lastSeen: new Date().toISOString(),
          relatedFiles: ['src/feature.ts'],
        },
      },
      regressions: {
        'src/feature.ts': 5,
      },
      explorations: [],
    }),
  );

  const result = await runExplorationWindow(root);
  const proposalPath = path.join(root, '.aok', 'exploration', 'proposals.json');

  assert.ok(fs.existsSync(proposalPath));
  assert.equal(fs.readFileSync(filePath, 'utf-8'), original);
  assert.equal(result.status, 'SUCCESS');
  assert.match(result.details[0], /Proposal recorded/);
});
