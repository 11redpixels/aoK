import OpenAI from 'openai';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AOKConfigLLM {
  provider: 'openai' | 'anthropic' | 'openrouter';
  apiKey?: string; // Optional if using local ENV vars
  model: string;
}

export interface LLMProvider {
  createChatCompletion(messages: LLMMessage[]): Promise<string>;
}

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-3-5-sonnet-20241022') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async createChatCompletion(messages: LLMMessage[]): Promise<string> {
    // Boilerplate for native sdk execution
    // const anthropic = new Anthropic({ apiKey: this.apiKey });
    // const response = await anthropic.messages.create({...})
    throw new Error('Native Anthropic execution is stubbed in this alpha version. Install @anthropic-ai/sdk to execute.');
  }
}

export class OpenAIProvider implements LLMProvider {
  private openai: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o', baseURL?: string) {
    this.openai = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async createChatCompletion(messages: LLMMessage[]): Promise<string> {
    if (process.env.AOK_SIMULATION_MODE === 'true') {
      return `[SIMULATED EXECUTION] Mocked payload for explicit AOK_SIMULATION_MODE. PASS`;
    }
    
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: messages as any,
    });
    return response.choices[0]?.message?.content || '';
  }
}

export function createLLMProvider(config: AOKConfigLLM): LLMProvider {
  let apiKey = config.apiKey || process.env.OPENAI_API_KEY || process.env.AOK_API_KEY;
  
  if (!apiKey && process.env.AOK_SIMULATION_MODE !== 'true') {
    throw new Error('[AOK ERROR] Native execution requires AOK_API_KEY environment variable or config property.');
  }

  // Supply a dummy key to bypass the OpenAI SDK internal constructor assertions when simulating offline
  if (!apiKey && process.env.AOK_SIMULATION_MODE === 'true') {
     apiKey = 'dummy-for-sim';
  }

  if (config.provider === 'anthropic') {
    return new AnthropicProvider(apiKey, config.model);
  }
  
  if (config.provider === 'openai') {
    return new OpenAIProvider(apiKey, config.model);
  }

  if (config.provider === 'openrouter') {
    return new OpenAIProvider(apiKey, config.model, 'https://openrouter.ai/api/v1');
  }

  throw new Error(`[AOK ERROR] Unknown LLM Provider: ${config.provider}`);
}
