import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// Mock the centralized API base URL helper so we can control the resolved
// email endpoint without depending on Vite env var stubbing quirks.
vi.mock('@/lib/apiBase', () => ({
  apiUrl: vi.fn((path: string) => {
    // Default: same-origin. Tests override this per-case via the mock below.
    const base = (import.meta.env as any).VITE_API_URL || '';
    return base ? `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}` : path;
  }),
  getApiBaseUrl: vi.fn(() => (import.meta.env as any).VITE_API_URL || ''),
}));

import { emailTemplates } from '@/lib/email';
import { apiUrl } from '@/lib/apiBase';

// Mock fetch globally
global.fetch = vi.fn();

describe('Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    // VITE_API_URL is not a predeclared Vite env var; assign directly.
    (import.meta.env as any).VITE_API_URL = '';
  });

  // The `sendEmail` describe block that was here tested a function that could
  // never have worked: it sent no Authorization header to a route behind
  // requireAuth, and no `event_id` to a route that requires one. The tests
  // passed because they asserted against a mocked fetch rather than the route.
  // Both the function and its tests are gone; the live sender is covered by
  // src/test/send-email-scoping.test.ts.

  describe('emailTemplates.eventInvitation', () => {
    it('should generate a valid invitation email template', () => {
      const eventDetails = {
        name: 'Test Party',
        date: 'December 31, 2024',
        location: '123 Party Street, Fun City'
      };

      const invitationUrl = 'https://partyhause.app/invite/abc123';

      const template = emailTemplates.eventInvitation(
        'guest@example.com',
        eventDetails,
        invitationUrl
      );

      expect(template.to).toBe('guest@example.com');
      expect(template.subject).toContain('Test Party');
      expect(template.html).toContain('Test Party');
      expect(template.html).toContain('December 31, 2024');
      expect(template.html).toContain('123 Party Street, Fun City');
      expect(template.html).toContain(invitationUrl);
      expect(template.html).toContain('PartyHause');
    });

    it('should include RSVP call-to-action in the template', () => {
      const eventDetails = {
        name: 'Test Party',
        date: 'December 31, 2024',
        location: '123 Party Street, Fun City'
      };

      const invitationUrl = 'https://partyhause.app/invite/abc123';

      const template = emailTemplates.eventInvitation(
        'guest@example.com',
        eventDetails,
        invitationUrl
      );

      expect(template.html).toContain('RSVP Now');
      expect(template.html).toContain('Ready to join the party');
    });

    it('should include QR code placeholder', () => {
      const eventDetails = {
        name: 'Test Party',
        date: 'December 31, 2024',
        location: '123 Party Street, Fun City'
      };

      const invitationUrl = 'https://partyhause.app/invite/abc123';

      const template = emailTemplates.eventInvitation(
        'guest@example.com',
        eventDetails,
        invitationUrl
      );

    expect(template.html).toContain('QR Check-in');
    });

    it('should handle special characters in event details', () => {
      const eventDetails = {
        name: 'John\'s "Amazing" Party & Celebration',
        date: 'December 31, 2024',
        location: '123 Main St. <Apt 4B>, Fun City'
      };

      const invitationUrl = 'https://partyhause.app/invite/abc123';

      const template = emailTemplates.eventInvitation(
        'guest@example.com',
        eventDetails,
        invitationUrl
      );

      // Should not throw and should contain escaped content
      expect(template.html).toContain('John');
      expect(template.html).toContain('Amazing');
      expect(template.html).toContain('Party');
      expect(template.html).toContain('Celebration');
    });
  });

  describe('emailTemplates.rsvpConfirmation', () => {
    it('should generate RSVP confirmation email for accepted invitation', () => {
      const eventDetails = {
        name: 'Test Party',
        date: 'December 31, 2024',
        location: '123 Party Street, Fun City'
      };

      const template = emailTemplates.rsvpConfirmation(
        'guest@example.com',
        eventDetails,
        'John Doe'
      );

      expect(template.to).toBe('guest@example.com');
      expect(template.subject).toContain('RSVP Confirmed');
  expect(template.html).toContain('RSVP Confirmed');
      expect(template.html).toContain('Test Party');
      expect(template.html).toContain('John Doe');
    });
  });

  describe('emailTemplates.eventReminder', () => {
    it('should generate event reminder email', () => {
      const eventDetails = {
        name: 'Test Party',
        date: 'December 31, 2024',
        location: '123 Party Street, Fun City'
      };

      const template = emailTemplates.eventReminder(
        'guest@example.com',
        eventDetails,
        'John Doe'
      );

      expect(template.to).toBe('guest@example.com');
    expect(template.subject).toContain('Test Party');
    expect(template.subject).toContain("Don't forget");
    expect(template.html).toContain("Tomorrow's the day");
      expect(template.html).toContain('Test Party');
      expect(template.html).toContain('John Doe');
    });

    it('should include QR code when provided', () => {
      const eventDetails = {
        name: 'Test Party',
        date: 'December 31, 2024',
        location: '123 Party Street, Fun City'
      };

      const template = emailTemplates.eventReminder(
        'guest@example.com',
        eventDetails,
        'John Doe',
        'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=test'
      );

      expect(template.html).toContain('QR');
      expect(template.html).toContain('https://api.qrserver.com/v1/create-qr-code');
    });
  });
});
