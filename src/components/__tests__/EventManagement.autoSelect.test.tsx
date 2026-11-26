import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventManagement } from '../EventManagement';

const mockSetCurrentEvent = vi.fn();
const mockUser = { id: 'u1', email: 'test@test.com', name: 'Test User' };

vi.mock('@/store/usePartyStore', () => ({
  usePartyStore: () => ({
    currentEvent: null,
    events: [
      { id: 'e1', name: 'Old Event', start_date: '2026-11-01', date: '2026-11-01' },
      { id: 'e2', name: 'New Event', start_date: '2026-11-15', date: '2026-11-15' },
    ],
    setCurrentEvent: mockSetCurrentEvent,
    loadEventGuests: vi.fn(),
    setEvents: vi.fn(),
    guests: [],
    isLoading: false,
    user: mockUser,
  }),
}));

vi.mock('@/components/GuestList', () => ({
  default: () => <div data-testid="guest-list">Guest List</div>,
}));

vi.mock('@/features/polls', () => ({
  PollsSection: () => <div data-testid="polls-section">Polls</div>,
}));

vi.mock('@/features/partyboard', () => ({
  PartyBoardSection: () => <div data-testid="partyboard-section">PartyBoard</div>,
}));

vi.mock('@/lib/events', () => ({
  eventService: {
    publishEvent: vi.fn(() => Promise.resolve({ event: { id: 'e1', status: 'published' } })),
  },
}));

vi.mock('@/components/ui/loading', () => ({
  Loading: ({ size }: { size?: string }) => <div data-testid="loading">{size}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button data-testid="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

describe('EventManagement auto-select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentEvent.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-selects the most recent event when currentEvent is null', async () => {
    render(
      <MemoryRouter initialEntries={['/event-management']}>
        <EventManagement />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockSetCurrentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'e2', name: 'New Event' }),
      );
    });
  });
});
