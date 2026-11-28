/**
 * `/onboarding/welcome` — the mobile journey's marketing intro, on the web.
 *
 * THE ONE SCREEN WITH NO QUESTION
 *   Every other journey screen persists something; this one exists to set
 *   expectations before the first question lands, because a progress rail
 *   that starts asking about "organizer types" with no preamble reads as a
 *   form, and the journey is not a form. The mobile client's
 *   OnboardingMarketingWelcomeScreen plays the same role with the same copy.
 *
 * NOT IN THE RAIL
 *   The server's step ids do not include a welcome step, so JourneyShell's
 *   guard cannot host it: the shell redirects to the server's current step,
 *   and this screen would be a redirect loop wearing a hero illustration.
 *   It renders standalone and hands off to the server-named step, so the
 *   contract "the server decides which screen is next" is preserved — this
 *   screen only ever precedes it, never replaces it.
 *
 * WHY THE DASHBOARD CARD STILL TARGETS THE SERVER'S STEP
 *   Returning users resume mid-journey; dropping them back on a welcome
 *   banner every time would be the nag the card's "offered, never forced"
 *   header promises to avoid. Welcome is reached from the entry resolver
 *   only when the funnel has no answers at all.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarCheck, MessageCircle, Sparkles } from 'lucide-react';
import { useFunnelState } from '@/features/onboarding/useOnboardingJourney';
import { routeForCurrentStep } from '@/features/onboarding/journeyRoutes';

const HIGHLIGHTS = [
  {
    icon: Sparkles,
    title: 'Plan with AI',
    body: 'Turn "a birthday sometime next month" into a date, a timeline and a guest list.',
  },
  {
    icon: MessageCircle,
    title: 'Invite and track RSVPs',
    body: 'Send invites your guests can answer from their inbox, no account needed.',
  },
  {
    icon: CalendarCheck,
    title: 'Keep the memories alive',
    body: 'Polls, a party board and a timeline keep everyone in it together on the day.',
  },
] as const;

export function JourneyWelcome() {
  const { state } = useFunnelState();
  const navigate = useNavigate();

  // The server names the first screen this account is owed; welcome only
  // ever precedes it. A failed read fails open to the chat step, which is
  // the funnel's first question in every server version to date.
  const next =
    (state && !state.flow.completed && routeForCurrentStep(state.flow.current_step)) ||
    '/onboarding/planner-chat';

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <div className="mb-2 text-center">
          <p className="text-sm font-medium tracking-wide text-orange-600 uppercase">
            PartyHause
          </p>
        </div>
        <h1 className="text-center text-3xl font-bold text-foreground">
          Welcome to PartyHause
        </h1>
        <p className="mt-3 text-center text-base text-muted-foreground">
          Create events, invite friends, and keep the memories alive. Five short
          questions and the planner is yours.
        </p>

        <ul className="mt-10 space-y-6">
          {HIGHLIGHTS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex items-start gap-4">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-orange-50">
                <Icon className="h-5 w-5 text-orange-500" aria-hidden="true" />
              </span>
              <div>
                <p className="font-semibold text-foreground">{title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => navigate(next)}
          className="mt-12 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Continue
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Takes about a minute. You can leave any time and pick up where you left off.
        </p>
      </div>
    </div>
  );
}
