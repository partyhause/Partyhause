import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarDays, Clock3, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authService } from '@/lib/auth';
import { getStoredUser, type StoredUser } from '@/lib/auth-storage';
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  LEGAL_URLS,
  MINIMUM_ACCOUNT_AGE,
  type SignupConsent,
} from '@/lib/legal';
import {
  resolveRsvp,
  submitRsvp,
  type BrowserRsvpChoice,
  type BrowserRsvpInvitation,
} from '@/lib/rsvp-client';

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; invitation: BrowserRsvpInvitation };

/** Which half of the identify panel is showing. */
type IdentifyMode = 'signin' | 'signup';

const CHOICES: Array<{ value: BrowserRsvpChoice; label: string; description: string }> = [
  { value: 'accepted', label: 'Accept', description: 'I will be there.' },
  { value: 'maybe', label: 'Maybe', description: 'I am not certain yet.' },
  { value: 'declined', label: 'Decline', description: 'I cannot attend.' },
];

const CONSENT: SignupConsent = {
  ageEligible: true,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
};

function formatDate(value: string, timezone: string): string {
  const date = new Date(value);
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function statusLabel(status: BrowserRsvpInvitation['rsvp']['status']): string {
  if (status === 'pending') return 'Awaiting your response';
  if (status === 'accepted') return 'Accepted';
  if (status === 'maybe') return 'Maybe';
  return 'Declined';
}

/**
 * The invitation page.
 *
 * TWO GATES, NOT ONE
 * Reading an invitation is public and responding to one is not. An invitee has
 * to be able to see the event before deciding whether to create an account for
 * it, so `resolve` runs before any identity check and the event details render
 * for a signed-out visitor exactly as they always did. The response form is
 * what moved behind an account.
 *
 * WHY THE FORMS ARE HERE RATHER THAN A REDIRECT TO AuthScreen
 * The invitation token lives in this page's URL and nowhere else. Sending the
 * visitor to the app's auth surface, which is a `currentPage` string state
 * machine rather than a route, means carrying the token through it and back,
 * and losing it at any point strands an invitee with no way back to the
 * invitation. Signing in here costs two small forms and loses nothing.
 *
 * WHY THE ADDRESS IS A HINT
 * The server masks the invited address. It has to show something, or a guest
 * who signs up with the wrong one of their addresses gets a 403 and no way to
 * work out why; it must not show the whole thing, because a signup bearing a
 * valid token is auto-verified and the address is the other half of that.
 */
export function JoinEventPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [viewer, setViewer] = useState<StoredUser | null>(() => getStoredUser());
  const [mode, setMode] = useState<IdentifyMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const [choice, setChoice] = useState<BrowserRsvpChoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ status: 'unavailable' });
      return;
    }
    setState({ status: 'loading' });
    const result = await resolveRsvp(token);
    if (result.error || !result.data) {
      setState({ status: 'unavailable' });
      return;
    }
    setState({ status: 'ready', invitation: result.data });
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run one credential action, then re-read the invitation.
   *
   * The re-read is required, not cosmetic: `expectedRevision` is a
   * compare-and-swap value, and the copy held from before signing in may be
   * stale if the host edited the guest in between. Submitting the old one
   * would produce a 409 the invitee cannot interpret.
   */
  async function identify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || identifying) return;
    setIdentifying(true);
    setIdentifyError(null);

    const result = mode === 'signin'
      ? await authService.signIn(email, password)
      : await authService.signUpWithInvitation(email, password, fullName, CONSENT, token);

    setIdentifying(false);

    if (!result.success) {
      setIdentifyError(result.error || 'Could not complete that. Check the details and try again.');
      return;
    }
    if (result.awaitingVerification) {
      // The server declined to auto-verify, which means the token no longer
      // matches this address. Say so rather than showing a signed-out page
      // with no explanation.
      setIdentifyError(
        result.message
        || 'Your account was created but still needs confirming. Check your email for the link.',
      );
      return;
    }

    setViewer(getStoredUser());
    setPassword('');
    await load();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token || !choice || state.status !== 'ready') return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    const result = await submitRsvp(token, choice, state.invitation.rsvp.revision);
    setSubmitting(false);
    if (result.data) {
      setState({ status: 'ready', invitation: result.data });
      setMessage(`Your response is now ${statusLabel(result.data.rsvp.status).toLowerCase()}.`);
      return;
    }
    if (result.error?.code === 'REVISION_CONFLICT') {
      const refreshed = await resolveRsvp(token);
      if (refreshed.data) setState({ status: 'ready', invitation: refreshed.data });
      else setState({ status: 'unavailable' });
      setChoice(null);
      setError('Your response changed in another request. Review the current response and try again.');
      return;
    }
    if (result.error?.code === 'RSVP_ACCOUNT_REQUIRED') {
      // The stored session was rejected or absent. api-client deliberately does
      // not navigate away from /join/, so the page is still here and simply
      // returns to the identify panel.
      setViewer(null);
      setError('Your session has expired. Sign in again to record your response.');
      return;
    }
    if (result.error?.code === 'RSVP_EMAIL_MISMATCH') {
      setError(
        `This invitation was sent to ${state.invitation.rsvp.invitedEmailHint}. `
        + 'Sign in with that address to respond.',
      );
      return;
    }
    if (result.error?.code === 'RSVP_ALREADY_CLAIMED' || result.error?.code === 'RSVP_SEAT_ALREADY_HELD') {
      setError(result.error.message);
      return;
    }
    if (result.error?.status === 404) {
      setState({ status: 'unavailable' });
      return;
    }
    setError(result.error?.message || 'Your response could not be saved. Please try again.');
  }

  function signOutViewer(): void {
    void authService.signOut().then(() => {
      setViewer(null);
      setError(null);
      setMessage(null);
      setEmail('');
      setPassword('');
    });
  }

  if (state.status === 'loading') {
    return (
      <main className="min-h-screen bg-[#f7f1ed] px-4 py-12 flex items-center justify-center">
        <div className="text-center" role="status">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-[#b53120]" />
          <p className="mt-4 font-medium text-[#4d3d37]">Loading your invitation...</p>
        </div>
      </main>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <main className="min-h-screen bg-[#f7f1ed] px-4 py-12 flex items-center justify-center">
        <Card className="w-full max-w-lg border-[#ddcbc2] bg-white shadow-sm">
          <CardHeader>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#a03a2b]">PartyHause RSVP</p>
            <CardTitle className="text-2xl text-[#2d211d]">Invitation unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="leading-6 text-[#675650]">This invitation cannot be opened. Ask the host for help if you expected it to be available.</p>
          </CardContent>
          <CardFooter className="gap-5 text-sm">
            <a className="font-semibold text-[#8f2c1f] underline" href="/privacy.html" rel="noreferrer">Privacy</a>
            <a className="font-semibold text-[#8f2c1f] underline" href="/support.html" rel="noreferrer">Support</a>
          </CardFooter>
        </Card>
      </main>
    );
  }

  const { invitation } = state;
  const mustIdentify = invitation.rsvp.requiresAccount && viewer === null;

  return (
    <main className="min-h-screen bg-[#f7f1ed] px-4 py-10 sm:py-16">
      <Card className="mx-auto w-full max-w-xl overflow-hidden border-[#ddcbc2] bg-white shadow-xl shadow-[#8d4a3820]">
        <div className="bg-[#2e1812] px-6 py-8 text-white sm:px-9">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#efa28d]">Private invitation</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{invitation.event.name}</h1>
          <p className="mt-3 text-[#f5e8e3]">Hosted by {invitation.event.hostName}</p>
        </div>
        <CardContent className="space-y-7 px-6 py-7 sm:px-9">
          <section aria-labelledby="event-details" className="space-y-4">
            <h2 className="text-lg font-bold text-[#2d211d]" id="event-details">Event details</h2>
            <div className="flex gap-3 text-[#574640]">
              <CalendarDays aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#b53120]" />
              <div><p className="font-semibold">Starts</p><p>{formatDate(invitation.event.start, invitation.event.timezone)}</p></div>
            </div>
            <div className="flex gap-3 text-[#574640]">
              <Clock3 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#b53120]" />
              <div><p className="font-semibold">Ends</p><p>{formatDate(invitation.event.end, invitation.event.timezone)}</p><p className="text-sm">{invitation.event.timezone}</p></div>
            </div>
            <div className="flex gap-3 text-[#574640]">
              <MapPin aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#b53120]" />
              <div><p className="font-semibold">Location</p><p>{invitation.event.location}</p></div>
            </div>
          </section>

          <div className="rounded-xl border border-[#ead9d1] bg-[#fff8f5] px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[#7b665e]">Current response</p>
            <p className="mt-1 text-lg font-bold text-[#2d211d]">{statusLabel(invitation.rsvp.status)}</p>
          </div>

          {mustIdentify ? (
            <section aria-labelledby="identify-heading" className="space-y-5">
              <div className="rounded-xl border border-[#ead9d1] bg-[#fdf6f3] px-4 py-3">
                <p className="flex items-center gap-2 font-bold text-[#2d211d]">
                  <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[#b53120]" />
                  Sign in to respond
                </p>
                <p className="mt-1 text-sm leading-5 text-[#675650]">
                  This invitation was sent to <strong>{invitation.rsvp.invitedEmailHint}</strong>.
                  Use that address so the host knows the reply is yours.
                </p>
              </div>

              <div className="flex gap-2" role="tablist">
                <Button
                  aria-selected={mode === 'signin'}
                  className={mode === 'signin' ? 'flex-1 bg-[#b53120] hover:bg-[#8f261a]' : 'flex-1'}
                  onClick={() => { setMode('signin'); setIdentifyError(null); }}
                  role="tab"
                  type="button"
                  variant={mode === 'signin' ? 'default' : 'outline'}
                >
                  I have an account
                </Button>
                <Button
                  aria-selected={mode === 'signup'}
                  className={mode === 'signup' ? 'flex-1 bg-[#b53120] hover:bg-[#8f261a]' : 'flex-1'}
                  onClick={() => { setMode('signup'); setIdentifyError(null); }}
                  role="tab"
                  type="button"
                  variant={mode === 'signup' ? 'default' : 'outline'}
                >
                  Create one
                </Button>
              </div>

              <form className="space-y-4" onSubmit={(event) => { void identify(event); }}>
                <h2 className="sr-only" id="identify-heading">
                  {mode === 'signin' ? 'Sign in' : 'Create an account'}
                </h2>
                {mode === 'signup' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="rsvp-name">Your name</Label>
                    <Input
                      autoComplete="name"
                      id="rsvp-name"
                      maxLength={100}
                      onChange={(event) => setFullName(event.target.value)}
                      required
                      value={fullName}
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="rsvp-email">Email address</Label>
                  <Input
                    autoComplete="email"
                    id="rsvp-email"
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    type="email"
                    value={email}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rsvp-password">Password</Label>
                  <Input
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    id="rsvp-password"
                    minLength={8}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                  {mode === 'signup' ? (
                    <p className="text-xs text-[#75635c]">At least 8 characters.</p>
                  ) : null}
                </div>
                {mode === 'signup' ? (
                  <p className="text-xs leading-5 text-[#75635c]">
                    By creating an account you confirm you are {MINIMUM_ACCOUNT_AGE} or over and agree
                    to the <a className="underline" href={LEGAL_URLS.terms} rel="noreferrer">Terms</a> and{' '}
                    <a className="underline" href={LEGAL_URLS.privacy} rel="noreferrer">Privacy Policy</a>.
                  </p>
                ) : null}
                {identifyError ? (
                  <p aria-live="assertive" className="rounded-lg bg-[#fff0f0] px-4 py-3 text-[#9b2327]" role="alert">
                    {identifyError}
                  </p>
                ) : null}
                <Button
                  className="min-h-12 w-full bg-[#b53120] text-base font-bold hover:bg-[#8f261a]"
                  disabled={identifying}
                  type="submit"
                >
                  {identifying
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Working...</>
                    : mode === 'signin' ? 'Sign in and continue' : 'Create account and continue'}
                </Button>
              </form>
            </section>
          ) : (
            <form className="space-y-5" onSubmit={(event) => { void submit(event); }}>
              {viewer ? (
                <p className="text-sm text-[#675650]">
                  Responding as <strong className="text-[#2d211d]">{viewer.email}</strong>.{' '}
                  <button className="font-semibold text-[#8f2c1f] underline" onClick={signOutViewer} type="button">
                    Not you?
                  </button>
                </p>
              ) : null}
              <fieldset>
                <legend className="text-lg font-bold text-[#2d211d]">Will you attend?</legend>
                <div className="mt-3 grid gap-3">
                  {CHOICES.map((option) => (
                    <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 ${choice === option.value ? 'border-[#b53120] bg-[#fff4f0]' : 'border-[#dfd5d1]'}`} key={option.value}>
                      <input
                        checked={choice === option.value}
                        className="h-5 w-5 accent-[#b53120]"
                        name="rsvp"
                        onChange={() => setChoice(option.value)}
                        type="radio"
                        value={option.value}
                      />
                      <span><span className="block font-bold text-[#2d211d]">{option.label}</span><span className="text-sm text-[#675650]">{option.description}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {message ? <p aria-live="polite" className="rounded-lg bg-[#eaf7ef] px-4 py-3 font-medium text-[#17643e]">{message}</p> : null}
              {error ? <p aria-live="assertive" className="rounded-lg bg-[#fff0f0] px-4 py-3 text-[#9b2327]" role="alert">{error}</p> : null}
              <Button className="min-h-12 w-full bg-[#b53120] text-base font-bold hover:bg-[#8f261a]" disabled={!choice || submitting} type="submit">
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving response...</> : 'Submit RSVP'}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="justify-between border-t border-[#eee5e1] px-6 py-5 text-sm sm:px-9">
          <span className="text-[#75635c]">
            {invitation.rsvp.requiresAccount
              ? 'Responding requires the invited account.'
              : 'No account is required.'}
          </span>
          <span className="flex gap-4">
            <a className="font-semibold text-[#8f2c1f] underline" href="/privacy.html" rel="noreferrer">Privacy</a>
            <a className="font-semibold text-[#8f2c1f] underline" href="/support.html" rel="noreferrer">Support</a>
          </span>
        </CardFooter>
      </Card>
    </main>
  );
}
