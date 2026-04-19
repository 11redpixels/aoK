import { BaseAgent } from './base.ts';
import { HandoffPayload, HandoffRecord, TaskRecord, RepoRecord, StagedMutationRef } from '../types.ts';
import { SafeWriter } from '../fs-sandbox.ts';

export class BuilderAgent extends BaseAgent {
  async run(task: TaskRecord, previousHandoff: HandoffRecord | null, repo: RepoRecord | null): Promise<HandoffPayload> {
    // Extract explicit target file from scope if declared (e.g. "Modify exactly one file: path/to/file")
    const scopeFileMatch = task.scope.match(/(?:file|target|path)[:\s]+([^\s,."]+\.[a-zA-Z]+)/i)
      || task.goal.match(/(?:in|to|for)\s+([^\s,]+\.[a-zA-Z]+)/i);
    const declaredTarget = scopeFileMatch ? scopeFileMatch[1].trim() : null;

    // Read the target file content if it exists, so the LLM can produce a real modified version
    let existingContent = '';
    if (declaredTarget && repo) {
      const fs = require('fs');
      const pathMod = require('path');
      const fullPath = pathMod.resolve(repo.path, declaredTarget);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        existingContent = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    const prompt = `You are the BUILDER agent. You MUST output the COMPLETE modified file content.
Target Repository: ${repo ? repo.path : 'None'}
Target File: ${declaredTarget || 'Not specified'}
Task Goal: ${task.goal}
Scope: ${task.scope}
Non-goals: ${task.non_goals}
Previous Handoff: ${previousHandoff?.message || 'None'}

${existingContent ? `CURRENT FILE CONTENT of ${declaredTarget}:\n\`\`\`\n${existingContent}\`\`\`` : ''}

CRITICAL: You MUST respond with the modified file wrapped in this EXACT format:
--- FILE: ${declaredTarget || 'path/to/file'} ---
[complete modified file content here]
--- END ---

Do NOT respond with commentary only. You MUST include the --- FILE: ... --- block.`;

    let responseText = await this.llm.createChatCompletion([{ role: 'system', content: this.record.instruction_profile }, { role: 'user', content: prompt }]);

    const stagedMutations: StagedMutationRef[] = [];

    // Stage mutations through SafeWriter — builder never commits directly
    if (repo) {
        const writer = new SafeWriter(repo.path);
        
        const fileRegex = /---\s*FILE:\s*(.*?)\s*---([\s\S]*?)---\s*END\s*---/g;
        let match;
        while ((match = fileRegex.exec(responseText)) !== null) {
            const targetPath = match[1].trim();
            const content = match[2];
            try {
                const isTruthFile = targetPath.includes('AOK_TRUTH_');
                const allowOverwrite = isTruthFile || task.goal.includes('OVERWRITE') || !!declaredTarget;
                const stageId = await writer.stageMutation(task.id, targetPath, content, 'overwrite', { allowOverwrite });
                stagedMutations.push({
                    stageId,
                    targetPath,
                    operationType: 'overwrite',
                    allowOverwrite
                });
            } catch (err: any) {
                responseText += `\n[BUILD ERROR] Failed to stage ${targetPath}: ${err.message}`;
            }
        }

        if (stagedMutations.length === 0 && declaredTarget) {
            responseText += '\n[BUILD WARNING] Builder produced no structured FILE blocks. Task will be blocked at engine gate.';
        }
    }

    return {
      message: responseText,
      staged_mutations: stagedMutations,
      suggested_state_transition: 'implemented'
    };
  }
}
