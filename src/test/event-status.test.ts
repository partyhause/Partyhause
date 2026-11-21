/**
 * `events.status` policy, and the two route paths that write it.
 *
 * WHY THIS FILE EXISTS
 *   `POST /api/events` never destructured `status` and hardcoded 'draft'
 *   (server/routes/events.ts, before 2026-09-14), so every event either client
 *   created was stuck in draft forever and mobile's `status: 'published'` at
 *   apps/mobile/app/events/create/review.tsx:131 was discarded in silence. The
 *   adjacent `PUT` accepted any string and handed it to a CHECK-constrained
 *   column. Neither path had a single test.
 *
 *   The pure tests below are exhaustive over the vocabulary, because the
 *   vocabulary is small and finite and there is no reason to sample it. The
 *   route tests exercise the two regressions directly, since a policy module
 *   that is correct and unwired is the same defect in a new location.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CREATABLE_EVENT_STATUSES,
  EVENT_STATUSES,
  isEventStatus,
  parseCreateStatus,
  parseUpdateStatus,
  statusTimestamps,
  type EventStatus,
} from '../../server/lib/event-status';

// ---------------------------------------------------------------------------
// Pure policy
// ---------------------------------------------------------------------------

describe('event status vocabulary', () => {
  it('matches events_status_check exactly', () => {
    // Transcribed from
    // prisma/migrations/20260905000200_core_integrity_constraints/migration.sql:20-21.
    // If the migration changes, this fails before production does.
    expect([...EVENT_STATUSES]).toEqual([
      'draft',
      'published',
      'active',
      'completed',
      'cancelled',
      'archived',
    ]);
  });

  it('accepts every member and rejects everything else', () => {
    for (const status of EVENT_STATUSES) {
      expect(isEventStatus(status)).toBe(true);
    }
    for (const value of ['', 'DRAFT', 'deleted', ' draft', 0, null, undefined, {}, []]) {
      expect(isEventStatus(value)).toBe(false);
    }
  });

  it('keeps the creatable set a strict subset of the vocabulary', () => {
    for (const status of CREATABLE_EVENT_STATUSES) {
      expect(EVENT_STATUSES).toContain(status);
    }
    expect(CREATABLE_EVENT_STATUSES.length).toBeLessThan(EVENT_STATUSES.length);
  });
});

describe('parseCreateStatus', () => {
  it('defaults to draft when the field is absent', () => {
    // The web creation form has never sent a status. That must keep working.
    expect(parseCreateStatus(undefined)).toBe('draft');
    expect(parseCreateStatus(null)).toBe('draft');
  });

  it('honours published, which is the defect this closes', () => {
    expect(parseCreateStatus('published')).toBe('published');
  });

  it('refuses lifecycle states that nothing has happened to yet', () => {
    // A just-created event cannot have been cancelled, completed or archived.
    for (const status of ['active', 'completed', 'cancelled', 'archived']) {
      expect(parseCreateStatus(status)).toBeNull();
    }
  });

  it('refuses unknown values instead of substituting a default', () => {
    // Returning 'draft' here would reintroduce the original defect: a value the
    // caller explicitly chose, silently replaced.
    for (const value of ['nonsense', '', 'Published', 42, true, {}]) {
      expect(parseCreateStatus(value)).toBeNull();
    }
  });
});

describe('parseUpdateStatus', () => {
  it('permits the whole vocabulary, because updates advance the lifecycle', () => {
    for (const status of EVENT_STATUSES) {
      expect(parseUpdateStatus(status)).toBe(status);
    }
  });

  it('refuses anything outside it', () => {
    for (const value of ['nonsense', '', null, undefined, 7, []]) {
      expect(parseUpdateStatus(value)).toBeNull();
    }
  });
});

describe('statusTimestamps', () => {
  const now = new Date('2026-09-14T12:00:00.000Z');
  const earlier = new Date('2026-09-01T09:00:00.000Z');

  it('stamps published_at on first publication', () => {
    expect(statusTimestamps('published', null, now)).toEqual({ published_at: now });
    expect(
      statusTimestamps('published', { status: 'draft', published_at: null }, now),
    ).toEqual({ published_at: now });
  });

  it('never rewrites published_at', () => {
    // It answers "when was this first published", which a later write does not
    // change.
    expect(
      statusTimestamps('published', { status: 'published', published_at: earlier }, now),
    ).toEqual({});
  });

  it('stamps cancelled_at on entry to cancelled', () => {
    expect(
      statusTimestamps('cancelled', { status: 'published', published_at: earlier }, now),
    ).toEqual({ cancelled_at: now });
  });

  it('does not restamp cancelled_at while already cancelled', () => {
    expect(
      statusTimestamps('cancelled', { status: 'cancelled', published_at: earlier }, now),
    ).toEqual({});
  });

  it('clears cancelled_at on exit, and keeps published_at', () => {
    // A row reading `published` while carrying a cancelled_at is self
    // contradictory, and something downstream will believe the wrong half.
    expect(
      statusTimestamps('cancelled', { status: 'cancelled', published_at: earlier }, now),
    ).toEqual({});
    expect(
      statusTimestamps('published', { status: 'cancelled', published_at: earlier }, now),
    ).toEqual({ cancelled_at: null });
  });

  it('touches nothing for statuses that carry no timestamp', () => {
    for (const status of ['draft', 'active', 'completed', 'archived'] as EventStatus[]) {
      expect(statusTimestamps(status, { status: 'draft', published_at: null }, now)).toEqual({});
    }
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const prismaMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  coHostFindFirst: vi.fn(),
  guestFindFirst: vi.fn(),
}));

vi.mock('../../server/lib/prisma', () => ({
  prisma: {
    event: {
      create: prismaMocks.create,
      update: prismaMocks.update,
      findUnique: prismaMocks.findUnique,
    },
    eventCoHost: { findFirst: prismaMocks.coHostFindFirst },
    guest: { findFirst: prismaMocks.guestFindFirst },
  },
}));

vi.mock('../../server/middleware/auth', () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user: unknown }).user = { id: 'host-1', email: 'host@partyhause.local' };
    next();
  },
}));

vi.mock('../../server/lib/pubsub', () => ({
  broadcastEvent: vi.fn().mockResolvedValue(undefined),
}));

const HOST_ID = 'host-1';

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    host_id: HOST_ID,
    name: 'Fortieth',
    title: 'Fortieth',
    location: 'The Hall',
    status: 'draft',
    privacy: 'private',
    is_public: false,
    published_at: null,
    cancelled_at: null,
    start_date: new Date('2026-10-01T18:00:00.000Z'),
    end_date: new Date('2026-10-01T23:00:00.000Z'),
    ...overrides,
  };
}

describe('/api/events status handling', () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // getEventAccess reads the event, then co-host, then guest.
    prismaMocks.findUnique.mockResolvedValue(eventRow());
    prismaMocks.coHostFindFirst.mockResolvedValue(null);
    prismaMocks.guestFindFirst.mockResolvedValue(null);
    prismaMocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      eventRow(data),
    );
    prismaMocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      eventRow(data),
    );

    const { default: eventsRouter } = await import('../../server/routes/events');
    const app = express();
    app.use(express.json());
    app.use('/api/events', eventsRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  const body = {
    name: 'Fortieth',
    start_date: '2026-10-01T18:00:00.000Z',
    end_date: '2026-10-01T23:00:00.000Z',
  };

  async function post(payload: unknown) {
    return fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async function put(payload: unknown) {
    return fetch(`${baseUrl}/api/events/event-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  it('persists status: published instead of discarding it', async () => {
    // The defect: mobile sent this and the row came back a draft.
    const response = await post({ ...body, status: 'published' });

    expect(response.status).toBe(201);
    const written = prismaMocks.create.mock.calls[0][0].data;
    expect(written.status).toBe('published');
    expect(written.published_at).toBeInstanceOf(Date);
  });

  it('still defaults to draft when no status is sent', async () => {
    // The web creation form has never sent one.
    const response = await post(body);

    expect(response.status).toBe(201);
    const written = prismaMocks.create.mock.calls[0][0].data;
    expect(written.status).toBe('draft');
    expect(written.published_at).toBeUndefined();
  });

  it('refuses an uncreatable status with 400 rather than a 500 from Postgres', async () => {
    const response = await post({ ...body, status: 'cancelled' });

    expect(response.status).toBe(400);
    expect(prismaMocks.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown status on create', async () => {
    const response = await post({ ...body, status: 'nonsense' });

    expect(response.status).toBe(400);
    expect(prismaMocks.create).not.toHaveBeenCalled();
  });

  it('refuses an unknown status on update before it reaches the constraint', async () => {
    // Previously this string was written straight to a CHECK-constrained column
    // and surfaced as a 500 carrying the constraint name.
    const response = await put({ status: 'nonsense' });

    expect(response.status).toBe(400);
    expect(prismaMocks.update).not.toHaveBeenCalled();
  });

  it('stamps published_at when an update publishes a draft', async () => {
    const response = await put({ status: 'published' });

    expect(response.status).toBe(200);
    const written = prismaMocks.update.mock.calls[0][0].data;
    expect(written.status).toBe('published');
    expect(written.published_at).toBeInstanceOf(Date);
  });

  it('preserves the original published_at when updating an already-published event', async () => {
    const firstPublished = new Date('2026-09-01T09:00:00.000Z');
    prismaMocks.findUnique.mockResolvedValue(
      eventRow({ status: 'published', published_at: firstPublished }),
    );

    const response = await put({ status: 'published' });

    expect(response.status).toBe(200);
    expect(prismaMocks.update.mock.calls[0][0].data.published_at).toBeUndefined();
  });

  it('accepts the whole vocabulary on update', async () => {
    for (const status of EVENT_STATUSES) {
      prismaMocks.update.mockClear();
      const response = await put({ status });
      expect(response.status).toBe(200);
      expect(prismaMocks.update.mock.calls[0][0].data.status).toBe(status);
    }
  });
});
