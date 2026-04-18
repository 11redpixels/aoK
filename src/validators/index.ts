import { runUXValidator } from '../intelligence/ux-validator.ts';

export function runUXValidationEnforcement(projectRoot: string = process.cwd()) {
  return runUXValidator(projectRoot);
}
