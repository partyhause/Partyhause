import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EventCreation } from '../EventCreation';

const mockSave = vi.fn(() => Promise.resolve(true));

vi.mock('@/features/templates/hooks/useSavePartyPlate', () => ({
  useSavePartyPlate: () => ({ save: mockSave, isSaving: false }),
}));

vi.mock('@/components/templates/EventTemplateSelection', () => ({
  PartyPlateSelection: ({ onSelectTemplate, onBack }: any) => (
    <div data-testid="party-plate-step">
      <button onClick={onBack}>Back</button>
      <button
        onClick={() =>
          onSelectTemplate({
            id: 't1',
            name: 'Wedding',
            description: '',
            icon: '',
            color: '',
            category: 'wedding',
          })
        }
      >
        Select Wedding
      </button>
    </div>
  ),
}));

vi.mock('@/components/templates/AIEventAssistant', () => ({
  default: () => <div data-testid="ai-assistant-step">AI Assistant</div>,
}));

vi.mock('@/components/templates/forms/TemplateFormRouter', () => ({
  default: () => <div data-testid="template-form-step">Template Form</div>,
}));

vi.mock('@/components/invites/InviteTemplateSelection', () => ({
  default: () => <div data-testid="invite-template-step">Invite Template</div>,
}));

vi.mock('@/components/invites/InviteCustomization', () => ({
  default: () => <div data-testid="invite-customize-step">Invite Customize</div>,
}));

vi.mock('@/features/timeline/components/TimelineManagement', () => ({
  default: () => <div data-testid="timeline-step">Timeline</div>,
}));

vi.mock('@/store/usePartyStore', () => ({
  usePartyStore: () => ({
    setEvents: vi.fn(),
    events: [],
    user: { id: 'u1', email: 'test@test.com', name: 'Test User' },
    setCurrentEvent: vi.fn(),
  }),
}));

describe('EventCreation saveAsPartyPlate integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockReset();
    mockSave.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts without crashing and renders party-plate step', async () => {
    render(
      <MemoryRouter initialEntries={['/create-event']}>
        <EventCreation />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('party-plate-step')).toBeInTheDocument();
    });

    expect(screen.getByText('Use AI')).toBeInTheDocument();
    expect(screen.getByText('Select Wedding')).toBeInTheDocument();
  });
});

