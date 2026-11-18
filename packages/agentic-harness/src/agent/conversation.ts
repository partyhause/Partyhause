import type { AgentMessage } from './loop.js';

export interface ConversationContext {
  userId: string;
  eventId?: string;
  history: AgentMessage[];
  semanticEmbedding?: number[];
}

export function buildSemanticPrompt(context: ConversationContext, userInput: string): string {
  const history = context.history.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
  return `You are a helpful, intelligent event planning assistant.
User context: ${context.userId}, event: ${context.eventId ?? 'none'}.
Prior conversation:
${history}
User: ${userInput}
Respond semantically, ask clarifying questions if needed, and suggest next steps.
`;
}

export function summarizeConversation(history: AgentMessage[]): string {
  const text = history.map(m => `${m.role}: ${m.content}`).join('\n');
  return `Summarize this conversation in 2-3 sentences:\n${text}`;
}
