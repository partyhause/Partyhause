import type { SerialisedEvent } from '@partyhause/core';

/**
 * Centralized Event Type Definitions
 * 
 * This file contains all event-related TypeScript interfaces and types.
 * DO NOT create duplicate Event interfaces in component files.
 * 
 * Usage:
 *   import { Event, EventSummary, EventDetail } from '@/types/event';
 */

/**
 * Core Event interface - represents a complete event record from the database
 */
/**
 * An event as this app handles it: the API contract, plus the view-model
 * aliases the UI carries locally.
 *
 * `extends Partial<SerialisedEvent>` is the load-bearing part. Every
 * API-derived field now comes from `packages/core/src/contracts/event.ts`,
 * which is transcribed from `server/lib/event-dto.ts`, so those fields cannot
 * drift from the wire again. This file used to redeclare them, and the copies
 * disagreed: `location` admitted a structured object no route has ever sent,
 * `start_date` was `string | undefined` where the column is nullable, and
 * `status` was required where the serialiser can emit null.
 *
 * `Partial` rather than a direct extend because these objects are also built
 * locally, in drafts and the creation wizard, before an id or a server-side
 * `capabilities` block exists.
 *
 * Everything declared below is genuinely NOT on the wire. Each one is a local
 * alias or a UI concern, and each is marked as such.
 */
export interface Event extends Partial<SerialisedEvent> {
  id: string;

  /**
   * The legacy `title` column. Not on the wire: `event-dto.ts:150` emits a
   * single `name`, falling back to `title` internally. Kept because local
   * draft objects still carry it. Use `getEventTitle` rather than either.
   */
  title?: string | null;

  /** Local alias for `location`. No route returns it. */
  venue?: string;
  /** Local alias for `start_date`. No route returns it. */
  date?: string;
  /** Second local alias for `start_date`. No route returns it. */
  event_date?: string;

  /** Local host join. The API sends `host_id` only. */
  host?: {
    id: string;
    name: string;
    avatar_url?: string;
    email?: string;
  };

  /** UI-only. The API's field is `privacy`. */
  visibility?: 'private' | 'public' | 'network' | 'group';

  /** Not a column on `model Event`. Carried by the invite flow locally. */
  image_url?: string;
  /** Not a column on `model Event`. */
  spotify_playlist_url?: string;

  /** Derived counts the list route attaches under `stats`, not on the event. */
  guest_count?: number;
  rsvp_count?: number;
}

/**
 * Minimal event summary for lists, cards, and carousels
 * Use this for dashboard and browse views
 */
export type EventSummary = Pick<Event, 
  | 'id' 
  | 'title' 
  | 'date' 
  | 'location' 
  | 'image_url' 
  | 'description' 
  | 'template_type'
>;

/**
 * Full event details with required host info
 * Use this for detail screens where host is always present
 */
export interface EventDetail extends Event {
  host: Required<Event>['host'];
  guest_count: number;
  rsvp_count: number;
}

/**
 * Event statistics for analytics and dashboards
 */
export interface EventStats {
  total_guests: number;
  confirmed_guests: number;
  declined_guests: number;
  pending_guests: number;
  checked_in: number;
  views?: number;
  shares?: number;
}

/**
 * Event with computed statistics
 */
export interface EventWithStats extends Event {
  stats: EventStats;
}

/**
 * Event creation/update payload
 */
export interface EventFormData {
  title: string;
  description: string;
  location: string;
  venue?: string;
  date: string;
  end_date?: string;
  image_url?: string;
  template_type: string;
  visibility: 'private' | 'public' | 'network' | 'group';
  settings?: Record<string, any>;
}

/**
 * Event filter/search parameters
 */
export interface EventFilters {
  template_type?: string[];
  visibility?: string[];
  date_from?: string;
  date_to?: string;
  location?: string;
  search?: string;
  host_id?: string;
}

/**
 * Type guards for event types
 */
export function isEventDetail(event: Event | EventDetail): event is EventDetail {
  return (event as EventDetail).guest_count !== undefined;
}

export function isEventWithStats(event: Event | EventWithStats): event is EventWithStats {
  return (event as EventWithStats).stats !== undefined;
}

/**
 * Resolve the display name of an event.
 *
 * There are two name columns. `name` is NOT NULL and written by the classic
 * creation form; `title` is nullable and written by the template flows.
 * POST /api/events accepts either and populates both, but older rows and
 * partial writes mean neither can be assumed present.
 *
 * Four screens each open-coded `event.name || event.title || 'Untitled Event'`
 * and a fifth read `event.title` alone, which rendered an empty heading when
 * the column was null. This is that rule in one place.
 */
export function getEventTitle(event: Pick<Event, 'name' | 'title'>): string {
  return event.name || event.title || 'Untitled Event';
}

/**
 * Utility functions
 */
export function getEventLocation(event: Event): string {
  // Two branches were removed here with the object arm of `location`. They
  // read `.name` and `.address` off a shape the API does not send, so they
  // could never run.
  if (typeof event.location === 'string' && event.location.trim() !== '') {
    return event.location;
  }
  return event.venue || 'Location TBD';
}
