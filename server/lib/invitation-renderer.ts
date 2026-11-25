// The narrow subpath, not the package root.
//
// The root barrel re-exports the HTTP transport, which uses DOM types such as
// BodyInit. tsconfig.server.json declares `types: ["node"]` and no DOM lib, so
// importing the root here drags a browser type graph into the server build and
// fails on a line that has nothing to do with email. The server needs one
// constant, so it takes one subpath.
import { APP_INSTALL_COPY, APP_STORE_URL, hasAppStoreLink } from '@partyhause/core/app-install';

// Base for the RSVP link and the privacy/support footers. Read per render
// from VITE_APP_URL, the runtime variable Bicep provisions on the API
// container as the live web domain. auth.ts and billing.ts read the same
// variable for verification, reset and checkout links, with the same local
// fallback so Mailpit captures in dev point at the Vite server.
function rsvpOrigin(): string {
  const configured = process.env.VITE_APP_URL?.trim().replace(/\/+$/, '');
  return configured || 'http://localhost:5173';
}

export interface FixedInvitationDetails {
  eventName: string;
  hostName: string;
  start: Date;
  end: Date;
  timezone: string;
  location: string;
}

export interface FixedInvitationPreview {
  kind: 'fixed';
  subject: string;
  heading: string;
  eventName: string;
  hostName: string;
  start: string;
  end: string;
  timezone: string;
  location: string;
  message: string;
  actionLabel: string;
}

export interface FixedInvitationEmail {
  subject: string;
  html: string;
  plainText: string;
  rsvpUrl: string;
}

function safeLine(value: string, fallback: string): string {
  const normalized = [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(value);
  } catch {
    return value.toISOString();
  }
}

/** Build the immutable, structured invitation preview shown to a host. */
export function fixedInvitationPreview(details: FixedInvitationDetails): FixedInvitationPreview {
  const eventName = safeLine(details.eventName, 'Private event');
  const hostName = safeLine(details.hostName, 'Your host');
  const timezone = safeLine(details.timezone, 'UTC');
  return {
    kind: 'fixed',
    subject: `Invitation to ${eventName}`,
    heading: 'You are invited',
    eventName,
    hostName,
    start: formatDateTime(details.start, timezone),
    end: formatDateTime(details.end, timezone),
    timezone,
    location: safeLine(details.location, 'Location shared by the host'),
    message: 'Please use your private link to respond to this invitation.',
    actionLabel: 'View invitation and RSVP',
  };
}

/** Render the fixed HTML and plain-text invitation. Dynamic values are escaped. */
export function renderFixedInvitation(
  details: FixedInvitationDetails,
  guestName: string,
  token: string,
): FixedInvitationEmail {
  const preview = fixedInvitationPreview(details);
  const recipient = safeLine(guestName, 'Guest');
  const origin = rsvpOrigin();
  const rsvpUrl = `${origin}/join/${encodeURIComponent(token)}`;
  // Secondary to the RSVP button, never beside it.
  //
  // Replying is the thing the host needs and the thing this email exists to
  // get. An install prompt of equal weight competes with it, and a guest who
  // does neither is worse for the host than one who replies and never
  // installs. So the ask is placed after the reply, framed as information
  // about the day rather than a request.
  //
  // Absent entirely when there is no store link. APP_STORE_URL is empty until
  // an App Store Connect record exists, and a button that 404s for every
  // recipient is worse than no button.
  const installHtml = hasAppStoreLink()
    ? `      <p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #ebe7e5;font-size:14px">
        <strong>${escapeHtml(APP_INSTALL_COPY.heading)}</strong><br />
        ${escapeHtml(APP_INSTALL_COPY.body)}
        <a href="${escapeHtml(APP_STORE_URL)}" rel="noreferrer">${escapeHtml(APP_INSTALL_COPY.action)}</a>
      </p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#fbfaf9;color:#26201d;font-family:Arial,sans-serif">
    <main style="max-width:600px;margin:0 auto;padding:32px 24px">
      <p style="margin:0 0 16px">Hello ${escapeHtml(recipient)},</p>
      <h1 style="margin:0 0 20px;font-size:28px">${escapeHtml(preview.heading)}</h1>
      <p style="margin:0 0 20px">${escapeHtml(preview.hostName)} invited you to <strong>${escapeHtml(preview.eventName)}</strong>.</p>
      <dl>
        <dt><strong>Starts</strong></dt><dd>${escapeHtml(preview.start)}</dd>
        <dt><strong>Ends</strong></dt><dd>${escapeHtml(preview.end)}</dd>
        <dt><strong>Timezone</strong></dt><dd>${escapeHtml(preview.timezone)}</dd>
        <dt><strong>Location</strong></dt><dd>${escapeHtml(preview.location)}</dd>
      </dl>
      <p style="margin:28px 0"><a href="${escapeHtml(rsvpUrl)}" rel="noreferrer" style="background:#c02a16;color:#fff;padding:14px 20px;text-decoration:none;border-radius:8px">${escapeHtml(preview.actionLabel)}</a></p>
      <p style="font-size:13px;color:#6a5e58">This link is private and is only for your RSVP.</p>
${installHtml}
      <p style="font-size:13px"><a href="${origin}/privacy.html" rel="noreferrer">Privacy</a> | <a href="${origin}/support.html" rel="noreferrer">Support</a></p>
    </main>
  </body>
</html>`;
  const plainText = [
    `Hello ${recipient},`,
    '',
    `${preview.hostName} invited you to ${preview.eventName}.`,
    `Starts: ${preview.start}`,
    `Ends: ${preview.end}`,
    `Timezone: ${preview.timezone}`,
    `Location: ${preview.location}`,
    '',
    `${preview.actionLabel}: ${rsvpUrl}`,
    ...(hasAppStoreLink()
      ? ['', `${APP_INSTALL_COPY.heading}: ${APP_INSTALL_COPY.body} ${APP_STORE_URL}`]
      : []),
    '',
    `Privacy: ${origin}/privacy.html`,
    `Support: ${origin}/support.html`,
  ].join('\n');
  return { subject: preview.subject, html, plainText, rsvpUrl };
}
