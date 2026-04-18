/**
 * AOK Phase 3 — Autonomous Loop Integration Test
 * 
 * Tests the full loop mechanics:
 * 1. Intelligence Layer reads raw failures → classifies them
 * 2. Autonomous loop reads repair-tasks.json
 * 3. Strategies attempt to find files and apply patches
 * 4. Circuit breaker stops after MAX_ATTEMPTS
 * 5. Fix history is tracked
 * 6. Final report is generated
 * 
 * Since there's no real project to fix, strategies will return "no files found"
 * and the loop will hit the circuit breaker — which validates the loop infra.
 */

import { runUXValidator } from '../src/intelligence/ux-validator';
import { runAutonomousRepair } from '../src/repair/autonomous-loop';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

async function main() {
  console.log('\n══════════════════════════════════════');
  console.log('  AOK INTEGRATION TEST — Phase 3');
  console.log('══════════════════════════════════════\n');

  // ── Step 1: Verify raw failures exist ──
  const rawPath = path.join(ROOT, '.aok', 'e2e-failures.json');
  if (!fs.existsSync(rawPath)) {
    console.log('❌ No .aok/e2e-failures.json — run aok init and inject test data first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  console.log(`📥 Raw failures loaded: ${raw.length}`);

  // ── Step 2: Run Intelligence Layer ──
  console.log('\n🧠 Running Intelligence Layer...');
  const report = runUXValidator(ROOT);
  console.log(`✅ Classified ${report.totalFailures} failures:`);
  for (const f of report.failures) {
    console.log(`   ${f.id} [${f.type}] — ${f.probableCause}`);
  }

  // ── Step 3: Run Autonomous Loop ──
  console.log('\n🔧 Running Autonomous Repair Loop...');
  const result = await runAutonomousRepair(ROOT);

  // ── Step 4: Print Result ──
  console.log('\n');
  console.log('══════════════════════════════════════');
  console.log('  INTEGRATION TEST RESULTS');
  console.log('══════════════════════════════════════');
  console.log('');
  console.log(`  Status:   ${result.status}`);
  console.log(`  Attempts: ${result.totalAttempts}`);
  console.log(`  Fixes:    ${result.fixesApplied.length}`);
  console.log(`  Remaining: ${result.remainingIssues.length}`);
  console.log('');

  if (result.fixesApplied.length > 0) {
    console.log('  Fixes Applied:');
    for (const fix of result.fixesApplied) {
      console.log(`    ${fix.success ? '✅' : '❌'} [${fix.failureId}] ${fix.strategy} → ${fix.filesModified.join(', ') || '(none)'}`);
    }
    console.log('');
  }

  if (result.remainingIssues.length > 0) {
    console.log('  Remaining:');
    for (const issue of result.remainingIssues) {
      console.log(`    ❌ ${issue}`);
    }
    console.log('');
  }

  // ── Step 5: Verify fix-history.json was created ──
  const historyPath = path.join(ROOT, '.aok', 'fix-history.json');
  if (fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    console.log(`  📜 Fix history entries: ${history.length}`);
  } else {
    console.log('  ⚠️  No fix-history.json created');
  }

  // ── Step 6: Check for patches ──
  const patchDir = path.join(ROOT, '.aok', 'patches');
  if (fs.existsSync(patchDir)) {
    const patches = fs.readdirSync(patchDir);
    console.log(`  📎 Patch files generated: ${patches.length}`);
    for (const p of patches) {
      console.log(`     → ${p}`);
    }
  }

  console.log('');
  console.log('══════════════════════════════════════');

  // Determine pass/fail
  const passed = (
    result.status === 'FAILED' && // Expected: FAILED because no real project to fix
    result.totalAttempts >= 1 &&
    result.totalAttempts <= 4     // Circuit breaker worked
  );

  console.log(`\n${passed ? '✅ INTEGRATION TEST PASSED' : '❌ INTEGRATION TEST FAILED'}`);
  console.log('  (FAILED status is expected — no target project files to fix)\n');
}

main().catch((err) => {
  console.error('💥 Integration test crashed:', err);
  process.exit(1);
});
