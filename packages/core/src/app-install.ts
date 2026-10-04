/**
 * Where to send somebody who should install the app.
 *
 * One definition, shared by the server that renders invitation email and by
 * both clients, following the same pattern as `./legal.ts`. Three copies of a
 * store URL is how `emailTemplates` ended up existing twice with different
 * contents, and a wrong store link is worse than a missing one because it
 * looks like it works.
 *
 * WHY THIS IS EMPTY
 *   There is no App Store URL yet. `apps/mobile/eas.json` has no `ascAppId`
 *   and no App Store Connect record exists, so the canonical
 *   `https://apps.apple.com/app/id<ascAppId>` cannot be written down. An
 *   invented placeholder would render a button that 404s for every recipient,
 *   which is precisely the class of defect this repository keeps finding:
 *   a control that looks complete and leads nowhere.
 *
 *   Empty is therefore the honest value, and every surface that reads it must
 *   treat empty as "render nothing". That is a visible absence rather than a
 *   dead link, and it disappears the moment the real URL is filled in.
 *
 * WHY iOS ONLY
 *   Android is out of scope for 1.0
 *   (`docs/mobile-ios-launch/07-ios-app-store-launch-requirements.md:82`
 *   names an Android launch a submission blocker). An Android guest who taps
 *   an install prompt has nothing to install, which is the reason RSVP stays
 *   answerable in a browser with no account. The prompt is an upsell, never a
 *   requirement.
 */

/**
 * The iOS App Store listing.
 *
 * Fill in as `https://apps.apple.com/app/id<ascAppId>` once the App Store
 * Connect record exists, and set `ascAppId` in `apps/mobile/eas.json` in the
 * same change so the two cannot disagree.
 */
export const APP_STORE_URL = '';

/** True when there is somewhere real to send a person. */
export function hasAppStoreLink(): boolean {
  return APP_STORE_URL.trim().length > 0;
}

/**
 * What the install prompt says, everywhere it appears.
 *
 * Centralised so the reason given to a guest is identical in the email and on
 * the RSVP page. The reason matters more than the ask: "get our app" is a
 * request, "you will need this on the day" is information, and only the second
 * one survives a guest asking why.
 */
export const APP_INSTALL_COPY = {
  /** Secondary to the RSVP action. Never the primary call. */
  heading: 'Before the day',
  body: 'Check-in and the live schedule happen in the PartyHause app.',
  action: 'Get the app',
} as const;
