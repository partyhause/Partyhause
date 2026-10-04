import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/App';
import { JoinEventPage } from '@/components/JoinEventPage';
import { useAuth } from '@/hooks/use-auth';
import { authService } from '@/lib/auth';
import { setStoredToken, setStoredUser } from '@/lib/auth-storage';
import { resolveRsvp, submitRsvp, type BrowserRsvpInvitation } from '@/lib/rsvp-client';

vi.mock('@/lib/rsvp-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rsvp-client')>();
  return { ...actual, resolveRsvp: vi.fn(), submitRsvp: vi.fn() };
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    authService: {
      ...actual.authService,
      signIn: vi.fn(),
      signUpWithInvitation: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ success: true }),
    },
  };
});

const EVENT = {
  name: 'Dinner',
  hostName: 'Ada Host',
  start: '2030-02-01T18:00:00.000Z',
  end: '2030-02-01T20:00:00.000Z',
  timezone: 'UTC',
  location: 'Main Hall',
};

/** An invitation issued under the account rule: reading is public, answering is not. */
const invitation: BrowserRsvpInvitation = {
  event: EVENT,
  rsvp: {
    status: 'pending',
    revision: 3,
    respondedAt: null,
    requiresAccount: true,
    claimed: false,
    invitedEmailHint: 'a****@example.com',
  },
};

/** An invitation issued before the rule, which still answers anonymously. */
const grandfathered: BrowserRsvpInvitation = {
  event: EVENT,
  rsvp: { ...invitation.rsvp, requiresAccount: false },
};

function signIn(): void {
  setStoredToken('session-token');
  setStoredUser({ id: 'user-1', email: 'ada@example.com', name: 'Ada' });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/join/token-value']}>
      <Routes><Route path="/join/:token" element={<JoinEventPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('browser RSVP page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('shows a read-only loading state before resolve completes', () => {
    vi.mocked(resolveRsvp).mockReturnValue(new Promise(() => undefined));
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading your invitation');
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('shows one privacy-safe unavailable state', async () => {
    vi.mocked(resolveRsvp).mockResolvedValue({
      data: null,
      error: { status: 404, code: 'RSVP_UNAVAILABLE', message: 'This invitation is unavailable' },
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Invitation unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy.html');
    expect(screen.getByRole('link', { name: 'Support' })).toHaveAttribute('href', '/support.html');
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('shows the event to a signed-out visitor before asking them to register', async () => {
    // The whole reason resolve stayed public. Someone deciding whether to make
    // an account has to be able to see what the account is for.
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Dinner' })).toBeInTheDocument();
    expect(screen.getByText('Hosted by Ada Host')).toBeInTheDocument();
    expect(screen.getByText('Main Hall')).toBeInTheDocument();
    // ...and only then the gate.
    expect(screen.getByText('Sign in to respond')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit RSVP' })).not.toBeInTheDocument();
  });

  it('names the invited address as a hint, never in full', async () => {
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    renderPage();

    await screen.findByText('Sign in to respond');
    expect(screen.getByText('a****@example.com')).toBeInTheDocument();
  });

  it('signs up with the invitation token so the guest is not sent back to their inbox', async () => {
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    vi.mocked(authService.signUpWithInvitation).mockImplementation(async () => {
      signIn();
      return { success: true, user: { id: 'user-1', email: 'ada@example.com' } };
    });
    renderPage();

    await screen.findByText('Sign in to respond');
    fireEvent.click(screen.getByRole('tab', { name: 'Create one' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));

    await waitFor(() => expect(authService.signUpWithInvitation).toHaveBeenCalledWith(
      'ada@example.com',
      'correct-horse',
      'Ada',
      expect.objectContaining({ ageEligible: true }),
      'token-value',
    ));
    // Re-resolved rather than reusing the copy held from before signing in:
    // expectedRevision is a compare-and-swap value and the host may have moved
    // the record in between.
    await waitFor(() => expect(resolveRsvp).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Submit RSVP' })).toBeInTheDocument();
  });

  it('reports a signup the server refused to auto-verify instead of showing a dead form', async () => {
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    vi.mocked(authService.signUpWithInvitation).mockResolvedValue({
      success: true,
      awaitingVerification: true,
      message: 'Check your email for a confirmation link before signing in.',
    });
    renderPage();

    await screen.findByText('Sign in to respond');
    fireEvent.click(screen.getByRole('tab', { name: 'Create one' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check your email');
    expect(screen.queryByRole('button', { name: 'Submit RSVP' })).not.toBeInTheDocument();
  });

  it('submits one explicit revision-bound response once an account is held', async () => {
    signIn();
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    vi.mocked(submitRsvp).mockResolvedValue({
      data: {
        ...invitation,
        rsvp: { ...invitation.rsvp, status: 'maybe', revision: 4, respondedAt: '2030-01-01T00:00:00.000Z', claimed: true },
      },
      error: null,
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Dinner' })).toBeInTheDocument();
    expect(screen.getByText('Awaiting your response')).toBeInTheDocument();
    expect(submitRsvp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /Maybe/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit RSVP' }));

    await waitFor(() => expect(submitRsvp).toHaveBeenCalledWith('token-value', 'maybe', 3));
    expect(await screen.findByText('Your response is now maybe.')).toBeInTheDocument();
    expect(screen.getByText('Maybe', { selector: 'p' })).toBeInTheDocument();
  });

  it('answers a grandfathered invitation with no account at all', async () => {
    // Links already sitting in inboxes when the rule landed keep working until
    // they expire. The page must not infer the requirement from whether a
    // session exists; the server states it per invitation.
    vi.mocked(resolveRsvp).mockResolvedValue({ data: grandfathered, error: null });
    vi.mocked(submitRsvp).mockResolvedValue({
      data: { ...grandfathered, rsvp: { ...grandfathered.rsvp, status: 'accepted', revision: 4 } },
      error: null,
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Submit RSVP' })).toBeInTheDocument();
    expect(screen.queryByText('Sign in to respond')).not.toBeInTheDocument();
    expect(screen.getByText('No account is required.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Accept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit RSVP' }));

    await waitFor(() => expect(submitRsvp).toHaveBeenCalledWith('token-value', 'accepted', 3));
  });

  it('returns to the sign-in panel when the session is rejected mid-flow', async () => {
    // api-client deliberately does not navigate away from /join/, because the
    // token lives in this URL. The page has to recover in place.
    signIn();
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    vi.mocked(submitRsvp).mockResolvedValue({
      data: null,
      error: { status: 401, code: 'RSVP_ACCOUNT_REQUIRED', message: 'Sign in with the invited email address' },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('radio', { name: /Accept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit RSVP' }));

    expect(await screen.findByText('Sign in to respond')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dinner' })).toBeInTheDocument();
  });

  it('explains a mismatched address rather than repeating the server string', async () => {
    signIn();
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });
    vi.mocked(submitRsvp).mockResolvedValue({
      data: null,
      error: { status: 403, code: 'RSVP_EMAIL_MISMATCH', message: 'This invitation was sent to a different email address' },
    });
    renderPage();

    fireEvent.click(await screen.findByRole('radio', { name: /Accept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit RSVP' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('a****@example.com');
  });

  it('mounts the public route without initializing the authenticated application', async () => {
    window.history.replaceState({}, '', '/join/token-value');
    vi.mocked(resolveRsvp).mockResolvedValue({ data: invitation, error: null });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Dinner' })).toBeInTheDocument();
    expect(useAuth).not.toHaveBeenCalled();
  });
});
