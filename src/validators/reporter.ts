import fs from 'fs';
import path from 'path';
import { createFailureCaptureReport, writeFailureCaptureReport } from '../failures.ts';

interface Reporter {
  onTestEnd?(test: TestCase, result: TestResult): void;
  onEnd?(result: FullResult): Promise<void> | void;
}

interface TestCase {
  id: string;
  title: string;
  location: {
    file: string;
  };
}

interface TestResult {
  status: string;
  error?: {
    message?: string;
    stack?: string;
  };
}

interface FullResult {
  status: 'passed' | 'failed';
}

export interface E2EFailure {
  id: string;
  title: string;
  step: string;
  type: 'UX' | 'Functional' | 'State' | 'Unknown';
  confidence: 'high' | 'medium' | 'low';
  errorMessage: string;
  file: string;
  suggestedFix: string;
}

class IntelligenceReporter implements Reporter {
  private failures: E2EFailure[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      const errorMsg = result.error?.message || result.error?.stack || 'Unknown error';
      
      let type: E2EFailure['type'] = 'Unknown';
      let confidence: E2EFailure['confidence'] = 'low';
      let suggestedFix = 'Investigate Playwright trace logs for failure context.';

      // Classification Logic
      if (errorMsg.includes('[UX ERROR]')) {
        type = 'UX';
        confidence = 'low';
        suggestedFix = 'A frontend console error or exception was thrown. Investigate the component logic for uncaught exceptions or hydration mismatches.';
      } else if (errorMsg.includes('locator(') || errorMsg.includes('waiting for selector')) {
        type = 'State'; // Often a UX state issue where data didn't load
        confidence = 'high';
        suggestedFix = 'A DOM element failed to appear. If it is a button/component, check if it was refactored or deleted. If it relies on data, check if the data mock or API failed to populate the DOM.';
      } else if (errorMsg.includes('waiting for response') || errorMsg.includes('request')) {
        type = 'Functional';
        confidence = 'high';
        suggestedFix = 'An API request failed or timed out. Validate the backend route handler schema, or check if the mock API logic is failing locally.';
      } else if (errorMsg.includes('expect(') && errorMsg.includes('toHaveText')) {
        type = 'State';
        confidence = 'medium';
        suggestedFix = 'Data integrity failure. A specific value was expected in the UI but it was missing or incorrect. Check data mapping and props.';
      }

      this.failures.push({
        id: test.id,
        title: test.title,
        step: test.title.split(':')[0] || 'Unknown Step',
        type,
        confidence,
        errorMessage: errorMsg,
        file: test.location.file,
        suggestedFix
      });
    }
  }

  async onEnd(result: FullResult) {
    const outputDir = path.resolve(process.cwd(), '.aok');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    writeFailureCaptureReport(
      path.join(outputDir, 'e2e-failures.json'),
      createFailureCaptureReport(
        this.failures.map((failure) => ({
          id: failure.id,
          step: failure.step,
          error: failure.errorMessage,
          timestamp: new Date().toISOString(),
          source: 'playwright-reporter',
          title: failure.title,
          location: failure.file,
          rawType: failure.type,
        })),
        result.status,
      ),
    );
    
    if (this.failures.length > 0) {
      console.log(`\n🧠 [INTELLIGENCE LAYER] Captured ${this.failures.length} structured UX failures.`);
    }
  }
}

export default IntelligenceReporter;
