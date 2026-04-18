import { SafeWriter } from '../src/orchestrator/fs-sandbox';
import * as fs from 'fs';
import * as path from 'path';

const repoPath = process.cwd();
const writer = new SafeWriter(repoPath);

async function runTests() {
    let passed = 0;
    const total = 12;
    
    // =====================================================
    // UNIT TESTS: SafeWriter boundary enforcement
    // =====================================================

    // 1: Path Escape (../)
    try {
        await writer.stageMutation('task123', '../../etc/passwd', 'content', 'overwrite');
        console.error('❌ Test 1 Failed: Path Escape was not blocked');
    } catch(e: any) {
        if (e.message.includes('INVALID_PATH_ESCAPE')) {
            console.log('✅ Test 1 Passed: Path escape correctly blocked'); passed++;
        } else console.error('❌ Test 1 Failed with wrong error:', e.message);
    }

    // 2: Absolute System Path
    try {
        await writer.stageMutation('task123', '/tmp/absolute_system_file', 'content', 'overwrite');
        console.error('❌ Test 2 Failed: Absolute path was not blocked');
    } catch(e: any) {
        if (e.message.includes('ABSOLUTE_PATH_DISALLOWED')) {
            console.log('✅ Test 2 Passed: Absolute system path correctly blocked'); passed++;
        } else console.error('❌ Test 2 Failed with wrong error:', e.message);
    }

    // 3: Symlink Escape
    const symlinkPath = path.join(repoPath, 'dummy_link');
    try { fs.symlinkSync('/tmp', symlinkPath); } catch (e) {}
    try {
        await writer.stageMutation('task123', 'dummy_link/hacked.txt', 'content', 'overwrite');
        console.error('❌ Test 3 Failed: Symlink escape was not blocked');
    } catch(e: any) {
        if (e.message.includes('SYMLINK_ESCAPE')) {
            console.log('✅ Test 3 Passed: Symlink escape correctly blocked'); passed++;
        } else console.error('❌ Test 3 Failed with wrong error:', e.message);
    } finally {
        if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    }

    // 4: Overwrite Without Permission
    try {
        await writer.stageMutation('task123', 'safe_target.txt', 'content', 'overwrite', { allowOverwrite: false });
        console.error('❌ Test 4 Failed: Overwrite block was bypassed');
    } catch(e: any) {
        if (e.message.includes('OVERWRITE_FORBIDDEN')) {
            console.log('✅ Test 4 Passed: Overwrite properly forbidden'); passed++;
        } else console.error('❌ Test 4 Failed with wrong error:', e.message);
    }

    // 5: Malformed Patch
    try {
        await writer.stageMutation('task123', 'safe_target.txt', 'random text', 'patch');
        console.error('❌ Test 5 Failed: Malformed patch accepted');
    } catch(e: any) {
        if (e.message.includes('MALFORMED_PATCH')) {
            console.log('✅ Test 5 Passed: Malformed patch blocked'); passed++;
        } else console.error('❌ Test 5 Failed with wrong error:', e.message);
    }

    // =====================================================
    // INTEGRATION TESTS: Engine-owned staged commit lifecycle
    // =====================================================

    // 6: Staged mutation + verified -> commit succeeds
    const target6 = path.join(repoPath, 'test_commit_target.txt');
    if (fs.existsSync(target6)) fs.unlinkSync(target6);
    try {
        const stageId = await writer.stageMutation('taskOK', target6, 'COMMITTED_CONTENT\n', 'overwrite', { allowOverwrite: true });
        await writer.updateValidationState(stageId, 'verified');
        await writer.commitStaged('taskOK', stageId);
        const content = fs.readFileSync(target6, 'utf-8');
        if (content.includes('COMMITTED_CONTENT')) {
            console.log('✅ Test 6 Passed: Staged verified commit succeeded'); passed++;
        } else {
            console.error('❌ Test 6 Failed: Content mismatch after commit');
        }
    } catch(e: any) {
        console.error('❌ Test 6 Failed unexpectedly:', e.message);
    } finally {
        if (fs.existsSync(target6)) fs.unlinkSync(target6);
    }

    // 7: Staged mutation + rejected -> no commit -> blocked
    try {
        const stageId = await writer.stageMutation('taskREJ', 'target_rejected.txt', '--- \n+++ \n@@', 'patch');
        await writer.updateValidationState(stageId, 'rejected');
        await writer.commitStaged('taskREJ', stageId);
        console.error('❌ Test 7 Failed: Rejected stage committed');
    } catch(e: any) {
        if (e.message.includes('VALIDATION_REQUIRED')) {
            console.log('✅ Test 7 Passed: Rejected validation prevents commit'); passed++;
        } else console.error('❌ Test 7 Failed with wrong error:', e.message);
    }

    // 8: Missing stageId -> blocked
    try {
        await writer.commitStaged('taskMISSING', 'stage_nonexistent_xyz');
        console.error('❌ Test 8 Failed: Missing stage committed');
    } catch(e: any) {
        if (e.message.includes('STAGE_NOT_FOUND')) {
            console.log('✅ Test 8 Passed: Missing stageId blocked'); passed++;
        } else console.error('❌ Test 8 Failed with wrong error:', e.message);
    }

    // 9: TaskId mismatch on commit -> blocked
    try {
        const stageId = await writer.stageMutation('taskA', 'target_mismatch.txt', '--- \n+++ \n@@', 'patch');
        await writer.updateValidationState(stageId, 'verified');
        await writer.commitStaged('taskB', stageId);
        console.error('❌ Test 9 Failed: Mismatched task committed');
    } catch(e: any) {
        if (e.message.includes('TASK_MISMATCH')) {
            console.log('✅ Test 9 Passed: Task ID mismatch blocked'); passed++;
        } else console.error('❌ Test 9 Failed with wrong error:', e.message);
    }

    // 10: Unverified stage cannot commit (pending state)
    try {
        const stageId = await writer.stageMutation('taskPEND', 'target_pending.txt', '--- \n+++ \n@@', 'patch');
        // Don't call updateValidationState — leave as 'pending'
        await writer.commitStaged('taskPEND', stageId);
        console.error('❌ Test 10 Failed: Pending stage committed');
    } catch(e: any) {
        if (e.message.includes('VALIDATION_REQUIRED')) {
            console.log('✅ Test 10 Passed: Pending validation prevents commit'); passed++;
        } else console.error('❌ Test 10 Failed with wrong error:', e.message);
    }

    // 11: Valid staged overwrite on existing file with permission
    const target11 = path.join(repoPath, 'test_overwrite_target.txt');
    fs.writeFileSync(target11, 'ORIGINAL');
    try {
        const stageId = await writer.stageMutation('taskOW', target11, 'OVERWRITTEN\n', 'overwrite', { allowOverwrite: true });
        await writer.updateValidationState(stageId, 'verified');
        await writer.commitStaged('taskOW', stageId);
        const content = fs.readFileSync(target11, 'utf-8');
        if (content.includes('OVERWRITTEN')) {
            console.log('✅ Test 11 Passed: Authorized overwrite committed'); passed++;
        } else {
            console.error('❌ Test 11 Failed: Content mismatch');
        }
    } catch(e: any) {
        console.error('❌ Test 11 Failed unexpectedly:', e.message);
    } finally {
        if (fs.existsSync(target11)) fs.unlinkSync(target11);
    }

    // 12: Valid staged patch commits atomically
    const target12 = path.join(repoPath, 'dummy_patch_target.txt');
    fs.writeFileSync(target12, 'line1\nline2\n');
    const validPatch = `--- dummy_patch_target.txt\n+++ dummy_patch_target.txt\n@@ -1,2 +1,2 @@\n-line1\n+line1_modified\n line2\n`;
    try {
        const stageId = await writer.stageMutation('taskPATCH', 'dummy_patch_target.txt', validPatch, 'patch');
        await writer.updateValidationState(stageId, 'verified');
        await writer.commitStaged('taskPATCH', stageId);
        const content = fs.readFileSync(target12, 'utf-8');
        if (content.includes('line1_modified')) {
            console.log('✅ Test 12 Passed: Staged patch committed atomically'); passed++;
        } else {
            console.error('❌ Test 12 Failed: Patch content incorrect');
        }
    } catch(e: any) {
        console.error('❌ Test 12 Failed unexpectedly:', e.message);
    } finally {
        if (fs.existsSync(target12)) fs.unlinkSync(target12);
    }

    console.log(`\nResults: ${passed}/${total} Tests Passed`);
    process.exit(passed === total ? 0 : 1);
}

runTests();
