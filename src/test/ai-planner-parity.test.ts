/**
 * The conversational planner reaches both clients, and its contract matches
 * the server it was transcribed from.
 *
 * WHY THIS SUITE
 *   `/api/ai/chat` had one consumer on one platform for its whole life, and
 *   `packages/core` had no AI resource, so the iOS app could not call it. That
 *   was tolerable while the planner was a web convenience. It stopped being
 *   tolerable the moment it became the feature a paid tier gates: a
 *   subscription sold on iOS whose headline feature the iOS app cannot use is
 *   a scoping defect, and it would have surfaced as a refund queue rather than
 *   a failing build.
 *
 *   So the parity is asserted rather than assumed, in both directions: the
 *   contract against the server's own constants, and the mobile route against
 *   the wizard it hands off to.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  chatTurnRequest,
  eventTemplateId,
  extractedEventData,
  parseContract,
} from '../../packages/core/src/contracts';
import { createAiResource, trimTranscript, MAX_CHAT_MESSAGES } from '../../packages/core/src/resources/ai';
import { KNOWN_TEMPLATE_IDS } from '../../server/lib/event-extraction';
import { MAX_MESSAGES, MAX_MESSAGE_CHARS } from '../../server/lib/event-chat';

const ROOT = path.resolve(__dirname, '../..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('contract matches the server', () => {
  it('template vocabulary is the server list, not a copy that can drift', () => {
    // The server interpolates KNOWN_TEMPLATE_IDS straight into the system
    // prompt AND uses it as the zod enum the model's JSON is validated
    // against. A client offering an id the server does not know fails
    // validation server-side and silently falls back to the heuristic path.
    expect([...eventTemplateId.options].sort()).toEqual([...KNOWN_TEMPLATE_IDS].sort());
  });

  it('transcript bounds are the server bounds', () => {
    // sanitizeMessages refuses anything outside these, so a client that does
    // not mirror them discovers the limit as a 400 mid-conversation.
    expect(MAX_CHAT_MESSAGES).toBe(MAX_MESSAGES);
    expect(parseContract(chatTurnRequest, {
      messages: Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })),
    }).ok).toBe(false);
    expect(parseContract(chatTurnRequest, {
      messages: [{ role: 'user', content: 'x'.repeat(MAX_MESSAGE_CHARS + 1) }],
    }).ok).toBe(false);
  });

  it('requires the last message to be from the user', () => {
    // The server refuses otherwise rather than asking the model to reply to
    // itself.
    expect(parseContract(chatTurnRequest, {
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
    }).ok).toBe(false);
    expect(parseContract(chatTurnRequest, {
      messages: [{ role: 'assistant', content: 'hello' }, { role: 'user', content: 'hi' }],
    }).ok).toBe(true);
  });

  it('carries source, which metering depends on', () => {
    // runChatTurn falls back to a free deterministic extractor whenever the
    // LLM is unconfigured, times out, or returns something unparseable. The
    // user cannot tell the difference, so this field is the only thing that
    // separates a billable answer from a local one.
    expect(extractedEventData.shape.source.options).toEqual(['llm', 'heuristic']);
  });
});

describe('trimTranscript', () => {
  it('keeps the newest turns, not the oldest', () => {
    // The planner's own rule is that the latest statement wins on a
    // contradiction, so dropping recent turns would discard the corrections
    // and keep the stale detail.
    const long = Array.from({ length: 60 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    const trimmed = trimTranscript(long);

    expect(trimmed).toHaveLength(MAX_CHAT_MESSAGES);
    expect(trimmed[trimmed.length - 1].content).toBe('m59');
    expect(trimmed[0].content).toBe('m20');
  });

  it('truncates an oversized message rather than letting the server refuse it', () => {
    const trimmed = trimTranscript([{ role: 'user', content: 'x'.repeat(9000) }]);
    expect(trimmed[0].content).toHaveLength(MAX_MESSAGE_CHARS);
  });

  it('leaves a short transcript untouched', () => {
    const short = [{ role: 'user' as const, content: 'hi' }];
    expect(trimTranscript(short)).toEqual(short);
  });
});

describe('ai resource', () => {
  const turn = {
    reply: 'Fifty people in June needs a venue booked now.',
    extracted: {
      templateId: 'birthday',
      description: '',
      formData: {},
      confidence: 0.9,
      source: 'llm',
    },
    complete: false,
    source: 'llm',
  };

  it('unwraps the { success, data } envelope', () => {
    const request = vi.fn().mockResolvedValue({ data: { success: true, data: turn }, error: null });
    const resource = createAiResource({ request } as never);

    return resource.chat([{ role: 'user', content: 'hi' }]).then((result) => {
      expect(result.error).toBeNull();
      expect(result.data).toEqual(turn);
    });
  });

  it('trims before sending, so the server never sees an oversized transcript', async () => {
    const request = vi.fn().mockResolvedValue({ data: { success: true, data: turn }, error: null });
    const resource = createAiResource({ request } as never);

    await resource.chat(
      Array.from({ length: 60 }, (_, i) => ({ role: 'user' as const, content: `m${i}` })),
    );

    const [, options] = request.mock.calls[0];
    expect(options.body.messages).toHaveLength(MAX_CHAT_MESSAGES);
  });

  it('reports a 2xx with no payload as an error rather than returning null data', async () => {
    // A 200 whose body did not carry `data` would otherwise reach the screen
    // as a successful turn with nothing in it.
    const request = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const resource = createAiResource({ request } as never);

    const result = await resource.chat([{ role: 'user', content: 'hi' }]);
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/no result/i);
  });

  it('passes a transport error through untouched', async () => {
    const error = { message: 'Too many AI requests.', status: 429 };
    const request = vi.fn().mockResolvedValue({ data: null, error });
    const resource = createAiResource({ request } as never);

    expect((await resource.chat([{ role: 'user', content: 'hi' }])).error).toEqual(error);
  });
});

describe('the planner is reachable on mobile', () => {
  it('has a screen', () => {
    expect(fs.existsSync(path.join(ROOT, 'apps/mobile/app/events/create/assistant.tsx'))).toBe(true);
  });

  it('is registered in the create-flow stack', () => {
    // An expo-router file with no Stack.Screen entry still routes, but without
    // a title or back label, which is the kind of half-wired screen App Review
    // rejects under guideline 2.1.
    expect(read('apps/mobile/app/events/create/_layout.tsx')).toMatch(/name="assistant"/);
  });

  it('has an entry point a user can actually reach', () => {
    // The gap this closes was not "no code exists", it was "no path leads to
    // it". A screen with no caller is the same as no screen.
    const picker = read('apps/mobile/app/events/create/index.tsx');
    expect(picker).toMatch(/\/events\/create\/assistant/);
  });

  it('calls the shared resource rather than a hand-rolled fetch', () => {
    const screen = read('apps/mobile/app/events/create/assistant.tsx');
    expect(screen).toMatch(/api\.ai\.chat/);
    expect(screen).not.toMatch(/(?<![.\w])fetch\s*\(/);
  });

  it('hands the date forward, which the web handler dropped', () => {
    // src/components/EventCreation.tsx:665-673 records that eventDate and
    // eventTime were discarded there for as long as the handler existed, so
    // the user retyped a date the planner had already parsed.
    const screen = read('apps/mobile/app/events/create/assistant.tsx');
    expect(screen).toMatch(/toIsoStart/);
    expect(read('apps/mobile/app/events/create/basics.tsx')).toMatch(/params\.startDate/);
  });

  it('maps the one template id the two vocabularies disagree on', () => {
    // The planner knows `workshop`; the wizard's TEMPLATES array calls it
    // `class`. Handing over an unmatched id makes TEMPLATES.find return
    // undefined and the details step render empty.
    const screen = read('apps/mobile/app/events/create/assistant.tsx');
    expect(screen).toMatch(/'workshop'/);
    expect(screen).toMatch(/'class'/);

    const picker = read('apps/mobile/app/events/create/index.tsx');
    for (const id of KNOWN_TEMPLATE_IDS) {
      const mapped = id === 'workshop' ? 'class' : id;
      expect(
        picker.includes(`id: '${mapped}'`) || screen.includes(`'${mapped}'`),
        `planner can emit '${id}' and nothing on mobile handles it`,
      ).toBe(true);
    }
  });
});
