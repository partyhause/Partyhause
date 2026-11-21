/**
 * Landing page contract.
 *
 * This file exists because `rg -i landing src/test/` returned nothing: the
 * first screen every anonymous visitor sees had no coverage at all, which is
 * how two dead call-to-action buttons and an invisible mobile navigation
 * shipped and stayed.
 *
 * The assertions below are deliberately behavioural rather than visual. They
 * pin the things that were actually broken:
 *
 *   1. Every CTA reaches a destination. Two used to call `setCurrentPage(
 *      'dashboard')`, which for a signed-out visitor matched no branch in
 *      App.tsx's mode effect, so the page re-rendered itself.
 *   2. All three `LandingIntent` values are producible. Every CTA previously
 *      took the `'create_event'` default, so two thirds of AuthScreen's
 *      intent-specific copy was unreachable.
 *   3. The navigation is operable below the `md` breakpoint.
 *   4. The legal pages are linked. privacy.html, terms.html and support.html
 *      are built and served, and were reachable only by typing the URL.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import LandingPageCreative from '@/components/LandingPageCreative';
import { usePartyStore } from '@/store/usePartyStore';

vi.mock('@/lib/events', () => ({
  eventService: {
    getUserEvents: vi.fn().mockResolvedValue([]),
    getEventGuests: vi.fn().mockResolvedValue([]),
  },
}));

const resetStore = () => {
  usePartyStore.setState({
    user: null,
    isAuthenticated: false,
    events: [],
    currentEvent: null,
    guests: [],
    isLoading: false,
    loadedEventIds: new Set<string>(),
    fetchingEventId: null,
  });
};

/** Every element that a visitor can click to move somewhere. */
const allButtons = () => screen.getAllByRole('button');

/**
 * Records every router location change beneath it. `useNavigate` inside
 * MemoryRouter performs a real history transition; observing `useLocation`
 * from a child is how the inertness sweep counts a navigation as "the button
 * went somewhere".
 */
function NavigationRecorder({ children, onNavigate }: { children: React.ReactNode; onNavigate: (path: string) => void }) {
  const location = useLocation();
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current !== null && location.key !== lastKey.current) {
      onNavigate(location.pathname);
    }
    lastKey.current = location.key;
  }, [location, onNavigate]);
  return <>{children}</>;
}

describe('LandingPageCreative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    // jsdom has no layout engine, so scrollIntoView is undefined on elements.
    Element.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    resetStore();
    vi.restoreAllMocks();
  });

  describe('calls to action reach a destination', () => {
    it('routes the primary hero CTA to auth with the create_event intent', () => {
      const onStartAuth = vi.fn();
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={onStartAuth} /></MemoryRouter>);

      fireEvent.click(screen.getAllByRole('button', { name: /create your event/i })[0]);

      expect(onStartAuth).toHaveBeenCalledWith('create_event');
    });

    it('routes the invite CTA with the join_event intent', () => {
      const onStartAuth = vi.fn();
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={onStartAuth} /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: /i have an invite/i }));

      expect(onStartAuth).toHaveBeenCalledWith('join_event');
    });

    it('routes the browse CTA with the explore_features intent', () => {
      const onStartAuth = vi.fn();
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={onStartAuth} /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: /look around first/i }));

      expect(onStartAuth).toHaveBeenCalledWith('explore_features');
    });

    it('produces all three intents, so no AuthScreen copy branch is unreachable', () => {
      const onStartAuth = vi.fn();
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={onStartAuth} /></MemoryRouter>);

      fireEvent.click(screen.getAllByRole('button', { name: /create your event/i })[0]);
      fireEvent.click(screen.getByRole('button', { name: /i have an invite/i }));
      fireEvent.click(screen.getByRole('button', { name: /look around first/i }));

      const intents = new Set(onStartAuth.mock.calls.map(([intent]) => intent));
      expect(intents).toEqual(new Set(['create_event', 'join_event', 'explore_features']));
    });

    it('never leaves a signed-out visitor on currentPage "dashboard"', () => {
      // The precise regression. `setCurrentPage('dashboard')` with no user
      // falls through every branch of App.tsx's effect, so appMode stays
      // 'landing' and the click appears to do nothing. The cutover removed
      // page state from the store entirely, so the assertion now pins the
      // mechanism's absence rather than the symptom.
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      expect(usePartyStore.getState()).not.toHaveProperty('currentPage');
    });

    it('leaves no button without a reachable destination', () => {
      const onStartAuth = vi.fn();
      const navigations: string[] = [];
      render(
      <MemoryRouter>
        <NavigationRecorder onNavigate={navigations.push.bind(navigations)}>
          <LandingPageCreative onStartAuth={onStartAuth} />
        </NavigationRecorder>
      </MemoryRouter>);

      const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
      const scrollTo = window.scrollTo as unknown as ReturnType<typeof vi.fn>;

      // Buttons are re-queried on every iteration rather than captured once.
      // The archetype detail panel is keyed on the selection, so choosing a
      // different archetype remounts it; a handle captured before that click
      // refers to a detached node, and clicking a detached node does nothing.
      // That would have reported a live button as inert.
      const total = allButtons().length;

      for (let index = 0; index < total; index += 1) {
        const button = allButtons()[index];
        const label = button.textContent || button.getAttribute('aria-label') || `#${index}`;

        const navigatedBefore = navigations.length;
        const before =
          onStartAuth.mock.calls.length +
          scrollIntoView.mock.calls.length +
          scrollTo.mock.calls.length;

        fireEvent.click(button);

        const after =
          onStartAuth.mock.calls.length +
          scrollIntoView.mock.calls.length +
          scrollTo.mock.calls.length;

        const isArchetypeSelector = button.hasAttribute('aria-pressed');
        const isMenuToggle = button.hasAttribute('aria-expanded');
        const didSomething =
          after > before || navigations.length > navigatedBefore || isArchetypeSelector || isMenuToggle;

        expect(didSomething, `"${label}" is inert`).toBe(true);
      }
    });
  });

  describe('navigation below the md breakpoint', () => {
    it('exposes a menu toggle', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      const toggle = screen.getByRole('button', { name: /open menu/i });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', 'landing-mobile-nav');
    });

    it('reveals the destinations when opened', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));

      const panel = document.getElementById('landing-mobile-nav');
      expect(panel).not.toBeNull();
      const inPanel = within(panel as HTMLElement);
      expect(inPanel.getByRole('button', { name: /how it works/i })).toBeInTheDocument();
      expect(inPanel.getByRole('button', { name: /find your style/i })).toBeInTheDocument();
      expect(inPanel.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('closes on Escape rather than trapping the visitor', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
      expect(document.getElementById('landing-mobile-nav')).not.toBeNull();

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(document.getElementById('landing-mobile-nav')).toBeNull();
    });

    it('closes after a destination is chosen', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      fireEvent.click(screen.getByRole('button', { name: /open menu/i }));
      const panel = document.getElementById('landing-mobile-nav') as HTMLElement;
      fireEvent.click(within(panel).getByRole('button', { name: /how it works/i }));

      expect(document.getElementById('landing-mobile-nav')).toBeNull();
    });
  });

  describe('every in-page nav target exists', () => {
    it.each([
      ['How it works', 'how-it-works'],
      ['Find your style', 'find-your-style'],
      ['Party culture', 'party-culture'],
    ])('%s scrolls to a section that is actually on the page', (label, id) => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      const section = document.getElementById(id);
      expect(section).not.toBeNull();

      const scrollIntoView = vi.fn();
      (section as HTMLElement).scrollIntoView = scrollIntoView;

      fireEvent.click(screen.getAllByRole('button', { name: new RegExp(label, 'i') })[0]);
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  describe('archetype selection', () => {
    it('marks exactly one option as pressed at a time', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      const options = allButtons().filter((b) => b.hasAttribute('aria-pressed'));
      expect(options).toHaveLength(4);
      expect(options.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);

      fireEvent.click(options[2]);

      const after = allButtons().filter((b) => b.hasAttribute('aria-pressed'));
      expect(after[2]).toHaveAttribute('aria-pressed', 'true');
      expect(after.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    });

    it('changes the detail panel when the selection changes', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
      const first = live.textContent;

      const options = allButtons().filter((b) => b.hasAttribute('aria-pressed'));
      fireEvent.click(options[3]);

      const updated = document.querySelector('[aria-live="polite"]') as HTMLElement;
      expect(updated.textContent).not.toBe(first);
    });
  });

  describe('footer', () => {
    it.each([
      ['Privacy', '/privacy.html'],
      ['Terms', '/terms.html'],
      ['Support', '/support.html'],
    ])('links %s to the served page at %s', (label, href) => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    });

    it('states a copyright year', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      expect(
        screen.getByText(new RegExp(`${new Date().getFullYear()}\\s+PartyHause`)),
      ).toBeInTheDocument();
    });
  });

  describe('brand rules from docs/BRAND.md', () => {
    it('carries no undefined utility classes', () => {
      // `.hover-lift` was applied in three places and defined nowhere in the
      // repository, so it silently did nothing.
      const { container } = render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      expect(container.querySelectorAll('.hover-lift')).toHaveLength(0);
    });

    it('renders the committed mark rather than a decorative icon lockup', () => {
      // BRAND.md retires Sparkles icons as logo flanks.
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      expect(screen.getAllByRole('img', { name: 'PartyHause' }).length).toBeGreaterThan(0);
    });

    it('shows the tagline', () => {
      render(
      <MemoryRouter><LandingPageCreative onStartAuth={vi.fn()} /></MemoryRouter>);

      expect(screen.getByText('Plan. Party. Perfect.')).toBeInTheDocument();
    });
  });
});
