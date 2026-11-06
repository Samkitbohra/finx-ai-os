import Anthropic from '@anthropic-ai/sdk';

export const llmEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Set ANTHROPIC_API_KEY to use FinX AI.');
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/** One-shot text completion (used for translation and reply classification). */
export async function complete(system: string, user: string, maxTokens = 800): Promise<string> {
  const r = await anthropic().messages.create({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
  return r.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
}
