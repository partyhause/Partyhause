import { Harness } from '../harness.js';
import type { AgentMessage } from './loop.js';

export interface AgentSession {
  id: string;
  userId: string;
  eventId?: string;
  messages: AgentMessage[];
  plan?: { steps: Array<{ tool: string; args: any; rationale: string }> };
  lastCritique?: string;
}

export class EventPlannerAgent {
  private harness: Harness;
  private sessions = new Map<string, AgentSession>();

  constructor(harness: Harness) {
    this.harness = harness;
  }

  private getSession(userId: string, eventId?: string): AgentSession {
    const id = `${userId}:${eventId ?? 'global'}`;
    if (!this.sessions.has(id)) {
      this.sessions.set(id, { id, userId, eventId, messages: [] });
    }
    return this.sessions.get(id)!;
  }

  private async critiquePlan(plan: any, context: string): Promise<string> {
    const critiquePrompt = `Critique this event planning plan for correctness, missing data, and conflicts. Context: ${context}\nPlan: ${JSON.stringify(plan)}\nReturn a short critique.`;
    const res = await this.harness.run([{ role: 'user', content: critiquePrompt }], { maxSteps: 2 });
    return res.finalAnswer ?? 'No critique';
  }

  async converse(userId: string, userMessage: string, eventId?: string, jwt?: string): Promise<string> {
    const session = this.getSession(userId, eventId);
    session.messages.push({ role: 'user', content: userMessage });

    const system = `You are an intelligent event planning assistant for PartyHause. You have access to partyboard, timeline, liveday tools. You can reason step-by-step, ask clarifying questions, and explain plans semantically.`;

    const messages: AgentMessage[] = [
      { role: 'system', content: system },
      ...session.messages
    ];

    const result = await this.harness.run(messages, { maxSteps: 10 });
    session.messages.push({ role: 'assistant', content: result.finalAnswer ?? '' });
    return result.finalAnswer ?? '';
  }

  async planEvent(userId: string, goal: string, eventId?: string, jwt?: string): Promise<{ plan: any; critique: string }> {
    const planPrompt = `Create a step-by-step plan to achieve: ${goal}. Use partyboard, timeline, liveday tools. Output JSON with steps.`;
    const planResult = await this.harness.run([{ role: 'user', content: planPrompt }], { maxSteps: 5 });
    const plan = JSON.parse(planResult.finalAnswer ?? '{}');
    const critique = await this.critiquePlan(plan, goal);
    return { plan, critique };
  }

  async executePlan(userId: string, eventId: string, jwt?: string): Promise<string> {
    const session = this.getSession(userId, eventId);
    if (!session.plan) return 'No plan exists';
    const result = await this.harness.run([{ role: 'user', content: `Execute plan: ${JSON.stringify(session.plan)}` }], { maxSteps: 15 });
    return result.finalAnswer ?? '';
  }
}
