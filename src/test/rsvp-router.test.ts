import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type RequestHandler } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MvpError } from '../../server/lib/mvp-contract';
import type { AuthenticatedRequest } from '../../server/middleware/auth';
import { createRsvpRouter, rsvpInputErrorHandler } from '../../server/routes/rsvp';

const passThrough: RequestHandler = (_request, _response, next) => next();

/**
 * Stand in for attachOptionalActor.
 *
 * The real middleware verifies a JWT against the database, which this suite has
 * no access to. What the router is responsible for is narrower and is what is
 * asserted here: taking whatever identity the middleware attached, reducing it
 * to an actor, and handing it to the service. The verification itself is
 * covered by the auth middleware's own tests.
 */
function attachUser(user: AuthenticatedRequest['user']): RequestHandler {
  return (request, _response, next) => {
    (request as AuthenticatedRequest).user = user;
    next();
  };
}

describe('RSVP router', () => {
  let server: Server;
  let baseUrl: string;
  const service = {
    resolve: vi.fn().mockResolvedValue({ status: 200, body: { rsvp: { status: 'pending' } } }),
    update: vi.fn().mockResolvedValue({ status: 200, body: { rsvp: { status: 'accepted' } } }),
  };

  async function listen(attachActor: RequestHandler): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use('/api/rsvp', rsvpInputErrorHandler, createRsvpRouter(service, passThrough, attachActor));
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it('resolves with no session at all, and passes no actor to update', async () => {
    // The read must stay reachable signed out: an invitee decides whether to
    // create an account *after* seeing what they were invited to.
    await listen(passThrough);
    const resolveBody = { token: 'A'.repeat(43) };
    const updateBody = { token: 'A'.repeat(43), status: 'accepted', expectedRevision: 1 };

    const resolved = await fetch(`${baseUrl}/api/rsvp/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resolveBody),
    });
    const updated = await fetch(`${baseUrl}/api/rsvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody),
    });

    expect(resolved.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(service.resolve).toHaveBeenCalledWith(resolveBody);
    expect(service.update).toHaveBeenCalledWith(updateBody, null);
    for (const response of [resolved, updated]) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
    }
  });

  it('hands the verified identity to update as an actor', async () => {
    await listen(attachUser({
      id: 'user-1',
      email: 'guest@example.com',
      email_verified: true,
      token_version: 3,
    }));
    const updateBody = { token: 'A'.repeat(43), status: 'accepted', expectedRevision: 1 };

    await fetch(`${baseUrl}/api/rsvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody),
    });

    expect(service.update).toHaveBeenCalledWith(updateBody, { id: 'user-1', email: 'guest@example.com' });
  });

  it('treats an identity with no address as no identity', async () => {
    // `email` is optional on the request user. An actor with a blank address
    // could never match an invited one, and passing it through would turn
    // "you need to sign in" into "you signed in as the wrong person".
    await listen(attachUser({ id: 'user-1', email: '', email_verified: true, token_version: 0 }));

    await fetch(`${baseUrl}/api/rsvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'A'.repeat(43), status: 'accepted', expectedRevision: 1 }),
    });

    expect(service.update).toHaveBeenCalledWith(expect.anything(), null);
  });

  it('never attaches an actor to resolve', async () => {
    // resolve/1 is the contract. A second argument here would mean the read
    // could start varying by viewer, which is how a public page grows a session
    // dependency by accident.
    await listen(attachUser({ id: 'user-1', email: 'guest@example.com', email_verified: true, token_version: 0 }));

    await fetch(`${baseUrl}/api/rsvp/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'A'.repeat(43) }),
    });

    expect(service.resolve).toHaveBeenCalledWith({ token: 'A'.repeat(43) });
    expect(service.resolve.mock.calls[0]).toHaveLength(1);
  });

  it('surfaces the account-required refusal with its code and privacy headers', async () => {
    service.update.mockRejectedValueOnce(
      new MvpError(401, 'RSVP_ACCOUNT_REQUIRED', 'Sign in with the invited email address to respond to this invitation'),
    );
    await listen(passThrough);

    const response = await fetch(`${baseUrl}/api/rsvp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'A'.repeat(43), status: 'accepted', expectedRevision: 1 }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'RSVP_ACCOUNT_REQUIRED' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('returns identical safe errors without reflecting a token', async () => {
    service.resolve.mockRejectedValueOnce(
      new MvpError(404, 'RSVP_UNAVAILABLE', 'This invitation is unavailable'),
    );
    await listen(passThrough);
    const secret = 'B'.repeat(43);
    const response = await fetch(`${baseUrl}/api/rsvp/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: secret }),
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain('RSVP_UNAVAILABLE');
    expect(body).not.toContain(secret);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('applies privacy headers to malformed JSON responses', async () => {
    await listen(passThrough);
    const response = await fetch(`${baseUrl}/api/rsvp/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'INVALID_JSON', error: 'Request body must be valid JSON' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
  });
});
