// Unit tests for the semantic event-extraction engine
// (server/lib/event-extraction.ts). Pure functions — no network, no DB.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectTemplate,
  extractDateTime,
  extractNumbers,
  extractLocation,
  extractHeuristically,
  extractWithLlm,
  resolveLlmConfig,
  resolveReasoningEffort,
} from '../../server/lib/event-extraction';

// Fixed reference date so relative-date assertions are deterministic.
// 2026-08-19 is a Wednesday.
const REF = new Date('2026-08-19T12:00:00');

describe('detectTemplate', () => {
  it('detects a wedding from unambiguous language', () => {
    const r = detectTemplate("We're getting married in June and want an intimate reception");
    expect(r.templateId).toBe('wedding');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects a hackathon', () => {
    const r = detectTemplate('48-hour hackathon for 120 developers with cash prizes and judges');
    expect(r.templateId).toBe('hackathon');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('reports zero confidence on zero signal instead of pretending', () => {
    const r = detectTemplate('hello there, nothing to see');
    expect(r.confidence).toBe(0);
  });

  it('does not let generic words hijack the template (old matcher defect)', () => {
    // "seminar" used to sit in BOTH the conference and workshop keyword
    // lists; "attendees" alone must not out-vote an explicit "workshop".
    const r = detectTemplate('a hands-on workshop with 20 students and a certificate');
    expect(r.templateId).toBe('workshop');
  });
});

describe('extractDateTime (chrono-node)', () => {
  it('parses explicit dates with times', () => {
    const r = extractDateTime('the party is on June 5th 2027 at 7pm', REF);
    expect(r.eventDate).toBe('2027-06-05');
    expect(r.eventTime).toBe('19:00');
  });

  it('parses relative dates forward from the reference', () => {
    const r = extractDateTime('planning dinner next Saturday', REF);
    expect(r.eventDate).toBe('2026-08-29');
    expect(r.eventTime).toBeUndefined(); // no time stated -> none invented
  });

  it('returns no fields when there is no date', () => {
    const r = extractDateTime('a party at Riverside Park', REF);
    expect(r.eventDate).toBeUndefined();
    expect(r.spans).toHaveLength(0);
  });
});

describe('extractLocation', () => {
  it('extracts the venue and never the time-of-day (old matcher extracted "3pm")', () => {
    const text = 'birthday party at Riverside Park on Saturday at 3pm';
    const { spans } = extractDateTime(text, REF);
    expect(extractLocation(text, spans)).toBe('Riverside Park');
  });

  it('extracts venue phrasing', () => {
    const text = 'the venue is The Grand Ballroom, doors at 6';
    const { spans } = extractDateTime(text, REF);
    expect(extractLocation(text, spans)).toBe('The Grand Ballroom');
  });

  it('returns undefined instead of garbage', () => {
    const text = 'we want it to be at least fun';
    const { spans } = extractDateTime(text, REF);
    expect(extractLocation(text, spans)).toBeUndefined();
  });
});

describe('extractNumbers', () => {
  it('extracts guest count and comma budgets', () => {
    const r = extractNumbers('expecting 150 guests with a budget of $12,500');
    expect(r.guests).toBe(150);
    expect(r.budget).toBe(12500);
  });

  it('understands $5k shorthand', () => {
    expect(extractNumbers('around $5k budget').budget).toBe(5000);
  });

  it('extracts small gatherings the old floor rejected', () => {
    expect(extractNumbers('dinner for 4 people').guests).toBe(4);
  });
});

describe('extractHeuristically (end to end)', () => {
  it('produces a complete result for a rich description', () => {
    const r = extractHeuristically(
      "Planning my daughter's kids birthday party at Sunshine Hall on June 5th 2027 at 2pm, about 25 kids, superhero theme, budget of $800, bounce house please",
      REF,
    );
    expect(r.templateId).toBe('kids-birthday');
    expect(r.eventDate).toBe('2027-06-05');
    expect(r.eventTime).toBe('14:00');
    expect(r.location).toBe('Sunshine Hall');
    expect(r.expectedGuests).toBe(25);
    expect(r.budget).toBe(800);
    expect(r.theme?.toLowerCase()).toContain('superhero');
    expect(r.formData.activities).toEqual(['Bounce House']);
    expect(r.source).toBe('heuristic');
  });
});

describe('LLM layer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolveLlmConfig returns null when nothing is configured', () => {
    expect(resolveLlmConfig({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('resolveLlmConfig builds the Azure OpenAI URL', () => {
    const config = resolveLlmConfig({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
    } as NodeJS.ProcessEnv);
    expect(config?.url).toBe(
      'https://example.openai.azure.com/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-10-21',
    );
  });

  it('resolveLlmConfig builds the NVIDIA NIM URL with bearer auth and model', () => {
    const config = resolveLlmConfig({
      NVIDIA_API_KEY: 'nvapi-test-key',
    } as NodeJS.ProcessEnv);
    expect(config?.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(config?.headers.Authorization).toBe('Bearer nvapi-test-key');
    expect(config?.model).toBe('meta/llama-3.3-70b-instruct');
  });

  it('NVIDIA wins over Azure and OpenAI when its key is set', () => {
    // Setting NVIDIA_API_KEY is a deliberate operator opt-in; the other two
    // providers are what Bicep provisions, so the only deployment where all
    // three coexist is one whose operator wants NVIDIA to answer.
    const config = resolveLlmConfig({
      NVIDIA_API_KEY: 'nvapi-test-key',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/',
      AZURE_OPENAI_API_KEY: 'azure-key',
      AZURE_OPENAI_DEPLOYMENT: 'gpt-4o-mini',
      OPENAI_API_KEY: 'openai-key',
    } as NodeJS.ProcessEnv);
    expect(config?.url).toContain('integrate.api.nvidia.com');
  });

  it('honours NVIDIA_BASE_URL and NVIDIA_MODEL for a self-hosted NIM endpoint', () => {
    const config = resolveLlmConfig({
      NVIDIA_API_KEY: 'nvapi-test-key',
      NVIDIA_BASE_URL: 'http://localhost:8000/v1/',
      NVIDIA_MODEL: 'nvidia/nemotron-4-340b',
    } as NodeJS.ProcessEnv);
    expect(config?.url).toBe('http://localhost:8000/v1/chat/completions');
    expect(config?.model).toBe('nvidia/nemotron-4-340b');
  });

  // reasoning_effort is model-specific vocabulary, and a wrong value is not an
  // error any caller sees: the retry below swallows it into a second round
  // trip. gpt-5-mini accepts 'minimal'; gpt-5.6-sol rejects it with
  // unsupported_value and lists 'none', 'low', 'medium', 'high', 'xhigh'.
  // Verified against the live deployment before this was made configurable.
  describe('resolveReasoningEffort', () => {
    it("defaults to 'minimal' so existing deployments are unchanged", () => {
      expect(resolveReasoningEffort({} as NodeJS.ProcessEnv)).toBe('minimal');
    });

    it('treats an empty value as unset rather than as a request to send ""', () => {
      // A Container App env var set to the empty string is indistinguishable
      // from absent at the process level, and "" is not valid vocabulary.
      expect(
        resolveReasoningEffort({ AZURE_OPENAI_REASONING_EFFORT: '   ' } as NodeJS.ProcessEnv),
      ).toBe('minimal');
    });

    it('passes a configured value through, so a model swap needs no code change', () => {
      expect(
        resolveReasoningEffort({ AZURE_OPENAI_REASONING_EFFORT: 'none' } as NodeJS.ProcessEnv),
      ).toBe('none');
    });

    it("lets an operator omit the parameter entirely with 'off'", () => {
      expect(
        resolveReasoningEffort({ AZURE_OPENAI_REASONING_EFFORT: 'off' } as NodeJS.ProcessEnv),
      ).toBeNull();
      expect(
        resolveReasoningEffort({ AZURE_OPENAI_REASONING_EFFORT: 'OFF' } as NodeJS.ProcessEnv),
      ).toBeNull();
    });

    it('reads LLM_REASONING_EFFORT as the provider-neutral name', () => {
      // Moving a deployment from Azure OpenAI to NVIDIA NIM must be an env
      // change, not a code change; the neutral name is how, and it wins over
      // the Azure-scoped legacy alias when both are set.
      expect(
        resolveReasoningEffort({ LLM_REASONING_EFFORT: 'low' } as NodeJS.ProcessEnv),
      ).toBe('low');
      expect(
        resolveReasoningEffort({
          LLM_REASONING_EFFORT: 'off',
          AZURE_OPENAI_REASONING_EFFORT: 'minimal',
        } as NodeJS.ProcessEnv),
      ).toBeNull();
    });
  });

  it('accepts a valid LLM response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  templateId: 'wedding',
                  eventName: 'Ava & Sam',
                  eventDate: '2027-06-05',
                  eventTime: '16:00',
                  location: 'Lakeside Gardens',
                  expectedGuests: 90,
                  budget: 20000,
                  theme: null,
                  specialRequests: null,
                  confidence: 0.92,
                }),
              },
            },
          ],
        }),
      }),
    );

    const result = await extractWithLlm('our wedding...', REF, {
      url: 'https://example.test/llm',
      headers: {},
    });
    expect(result?.source).toBe('llm');
    expect(result?.templateId).toBe('wedding');
    expect(result?.expectedGuests).toBe(90);
  });

  it('returns null (fallback) on malformed LLM output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"templateId":"pool-party","confidence":2}' } }],
        }),
      }),
    );
    const result = await extractWithLlm('text', REF, { url: 'https://example.test/llm', headers: {} });
    expect(result).toBeNull();
  });

  it('returns null (fallback) on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const result = await extractWithLlm('text', REF, { url: 'https://example.test/llm', headers: {} });
    expect(result).toBeNull();
  });
});
