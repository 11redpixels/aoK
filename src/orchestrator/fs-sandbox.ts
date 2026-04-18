import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

export interface StageMetadata {
    taskId: string;
    targetPath: string;
    operationType: 'patch' | 'overwrite';
    contentHash: string;
    timestamp: string;
    validationState: 'pending' | 'verified' | 'rejected';
}

export interface SandboxWriteOptions {
    allowOverwrite?: boolean;
    allowMultiFilePatch?: boolean;
}

export class SafeWriter {
    private repoPath: string;

    constructor(repoPath: string) {
        this.repoPath = path.resolve(repoPath);
    }

    resolveSafePath(targetPath: string): string {
        if (path.isAbsolute(targetPath)) {
            if (!targetPath.startsWith(this.repoPath) && !targetPath.includes('.aok/temp/')) {
                throw new Error(`ABSOLUTE_PATH_DISALLOWED: Cannot target absolute paths outside the repository (${targetPath})`);
            }
        }

        const resolved = path.resolve(this.repoPath, targetPath);
        
        const rel = path.relative(this.repoPath, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(`INVALID_PATH_ESCAPE: Path resolves outside repository.`);
        }

        let checkPath = resolved;
        while (!fs.existsSync(checkPath) && checkPath !== this.repoPath) {
            checkPath = path.dirname(checkPath);
            if (checkPath === path.dirname(checkPath)) break; 
        }
        
        if (fs.existsSync(checkPath)) {
            const real = fs.realpathSync(checkPath);
            if (!real.startsWith(fs.realpathSync(this.repoPath))) {
                throw new Error(`SYMLINK_ESCAPE: Target path resolves to external symlink source.`);
            }
        }

        return resolved;
    }

    async stageMutation(taskId: string, targetPath: string, payload: string, operationType: 'patch' | 'overwrite', options: SandboxWriteOptions = {}): Promise<string> {
        const safeTarget = this.resolveSafePath(targetPath);
        
        if (operationType === 'overwrite' && !options.allowOverwrite) {
            throw new Error(`OVERWRITE_FORBIDDEN: Task metadata does not permit full destructive overwrites.`);
        }

        if (operationType === 'patch') {
            if (!payload.includes('--- ') && !payload.includes('+++ ') && !payload.startsWith('@@')) {
                throw new Error(`MALFORMED_PATCH: Payload does not conform to standard diff structural signatures.`);
            }
            if (!options.allowMultiFilePatch && (payload.split('\n--- ').length > 2)) {
                throw new Error(`MULTI_FILE_PATCH_FORBIDDEN: Patch targets multiple structural boundaries.`);
            }
        }

        const stageDir = path.join(this.repoPath, '.aok', 'staging');
        if (!fs.existsSync(stageDir)) fs.mkdirSync(stageDir, { recursive: true });

        const hash = crypto.randomBytes(8).toString('hex');
        const contentHash = crypto.createHash('sha256').update(payload).digest('hex');
        const stageId = `stage_${taskId}_${hash}`;
        
        const metadata: StageMetadata = {
            taskId,
            targetPath: safeTarget,
            operationType,
            contentHash,
            timestamp: new Date().toISOString(),
            validationState: 'pending'
        };

        fs.writeFileSync(path.join(stageDir, `${stageId}.json`), JSON.stringify(metadata, null, 2));
        fs.writeFileSync(path.join(stageDir, `${stageId}.payload`), payload);
        
        return stageId;
    }

    async updateValidationState(stageId: string, state: 'verified' | 'rejected') {
        const metaPath = path.join(this.repoPath, '.aok', 'staging', `${stageId}.json`);
        if (!fs.existsSync(metaPath)) throw new Error('Stage metadata not found');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        meta.validationState = state;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    async commitStaged(taskId: string, stageId: string): Promise<void> {
        const stageDir = path.join(this.repoPath, '.aok', 'staging');
        const metaPath = path.join(stageDir, `${stageId}.json`);
        const payloadPath = path.join(stageDir, `${stageId}.payload`);

        if (!fs.existsSync(metaPath) || !fs.existsSync(payloadPath)) {
            throw new Error(`STAGE_NOT_FOUND: Stage transaction ${stageId} missing or purged.`);
        }

        const meta: StageMetadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

        if (meta.taskId !== taskId) {
            throw new Error(`TASK_MISMATCH: Staged write is bound to task ${meta.taskId}, orchestrator bound to ${taskId}.`);
        }

        if (meta.validationState !== 'verified') {
            throw new Error(`VALIDATION_REQUIRED: Cannot commit unverified or rejected transaction.`);
        }

        const currentPayload = fs.readFileSync(payloadPath, 'utf-8');
        const currentHash = crypto.createHash('sha256').update(currentPayload).digest('hex');
        if (currentHash !== meta.contentHash) {
            throw new Error(`PAYLOAD_SCRAMBLED: Stage content hash discrepancy detected before commit.`);
        }

        const safeTarget = meta.targetPath;
        const dir = path.dirname(safeTarget);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const tmpCommitFile = path.join(dir, `.${path.basename(safeTarget)}.tmp_commit_${Date.now()}`);
        
        try {
            if (meta.operationType === 'overwrite') {
                fs.writeFileSync(tmpCommitFile, currentPayload);
            } else if (meta.operationType === 'patch') {
                if (fs.existsSync(safeTarget)) {
                    fs.copyFileSync(safeTarget, tmpCommitFile);
                } else {
                    fs.writeFileSync(tmpCommitFile, ''); 
                }
                
                try {
                    execSync(`patch -s --forward "${tmpCommitFile}" < "${payloadPath}"`);
                } catch (pe: any) {
                    throw new Error(`Patch Application Failed: ${pe.message}`);
                }
            }
            
            // ATOMIC COMMIT
            fs.renameSync(tmpCommitFile, safeTarget);
        } catch (e: any) {
            if (fs.existsSync(tmpCommitFile)) fs.unlinkSync(tmpCommitFile);
            throw new Error(`COMMIT_FAILED: Could not finalize atomic filesystem operation: ${e.message}`);
        }
    }
}
