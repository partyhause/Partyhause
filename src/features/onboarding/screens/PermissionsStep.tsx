/**
 * `/onboarding/permissions` — the mobile journey's contacts primer, on the
 * web.
 *
 * THE SCREEN THAT CANNOT ASK WHAT WEB CANNOT GRANT
 *   On iOS this screen precedes a contacts permission prompt; its copy says
 *   "We'll only access your contacts to make inviting easier." The web has
 *   no contacts permission to request — the Contact Picker API is Chromium-
 *   only, partial, and wrong to imply as a gate. So the web port keeps the
 *   screen (it is in the union funnel the mobile journey established) but
 *   says what is true: inviting pulls from your address book when you upload
 *   or paste it, and PartyHause handles guest emails with the care the
 *   privacy policy describes. No permission is requested or implied.
 *
 * NOT IN THE SERVER'S STEP MACHINE
 *   Like welcome and location, this is a pause: it renders standalone,
 *   persists nothing, and hands forward. It exists so the rhythm of the
 *   mobile journey survives the port — a beat between "where do you host"
 *   and "finish your profile" where the product explains itself instead of
 *   asking.
 */

import { useNavigate } from 'react-router-dom';
import { ArrowRight, Mail, ShieldCheck, Users } from 'lucide-react';
import { ONBOARDING_ROUTE } from '@/features/onboarding/journeyRoutes';

const POINTS = [
  {
    icon: Users,
    title: 'Inviting, without the typing',
    body: 'Paste or upload your guest list and PartyHause matches emails to seats.',
  },
  {
    icon: Mail,
    title: 'Invites land in the inbox',
    body: 'Guests answer from the email itself — no account needed to RSVP.',
  },
  {
    icon: ShieldCheck,
    title: 'Your list stays yours',
    body: 'Guest emails are used to invite and count, never sold or shared.',
  },
] as const;

export function PermissionsStep() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-center text-3xl font-bold text-foreground">
          Stay connected
        </h1>
        <p className="mt-3 text-center text-base text-muted-foreground">
          Inviting works best when PartyHause can reach the people you know.
          Here is what that means in practice.
        </p>

        <ul className="mt-10 space-y-6">
          {POINTS.map(({ icon: Icon, title, body }) => (
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
          onClick={() => navigate(ONBOARDING_ROUTE.plannerChat)}
          className="mt-12 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Continue
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
