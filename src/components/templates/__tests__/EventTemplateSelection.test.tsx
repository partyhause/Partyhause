import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PartyPlateSelection } from '../EventTemplateSelection';

const mockUsePartyPlates = vi.fn();
vi.mock('@/features/templates/hooks/usePartyPlates', () => ({
  usePartyPlates: () => mockUsePartyPlates(),
}));

vi.mock('@/components/ui/use-toast', () => ({
  toast: vi.fn(),
}));

const defaultProps = {
  onSelectTemplate: vi.fn(),
  onUseAI: vi.fn(),
  onBack: vi.fn(),
};

describe('PartyPlateSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onSelectTemplate.mockReset();
    defaultProps.onUseAI.mockReset();
    defaultProps.onBack.mockReset();
    mockUsePartyPlates.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders system templates in Discover tab', async () => {
    mockUsePartyPlates.mockReturnValue({
      system: [
        { id: 's1', name: 'Wedding', description: 'A wedding', category: 'wedding' },
      ],
      mine: [],
      isLoading: false,
      error: undefined,
    });

    render(<PartyPlateSelection {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Wedding')).toBeInTheDocument();
    });

    expect(screen.getByText('Discover')).toBeInTheDocument();
    expect(defaultProps.onSelectTemplate).not.toHaveBeenCalled();
  });

  it('renders Mine tab', () => {
    mockUsePartyPlates.mockReturnValue({
      system: [],
      mine: [],
      isLoading: false,
      error: undefined,
    });

    render(<PartyPlateSelection {...defaultProps} />);

    expect(screen.getByText('Mine')).toBeInTheDocument();
  });

  it('calls onSelectTemplate when a template card is clicked', async () => {
    mockUsePartyPlates.mockReturnValue({
      system: [
        { id: 's1', name: 'Conference', description: 'A conference', category: 'conference' },
      ],
      mine: [],
      isLoading: false,
      error: undefined,
    });

    render(<PartyPlateSelection {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Conference')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Conference'));

    expect(defaultProps.onSelectTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', name: 'Conference' }),
    );
  });

  it('shows loading skeletons while isLoading', () => {
    mockUsePartyPlates.mockReturnValue({
      system: [],
      mine: [],
      isLoading: true,
      error: undefined,
    });

    render(<PartyPlateSelection {...defaultProps} />);

    expect(screen.getByText('PartyPlates')).toBeInTheDocument();
  });

  it('shows error message when load fails', () => {
    mockUsePartyPlates.mockReturnValue({
      system: [],
      mine: [],
      isLoading: false,
      error: new Error('Failed to load'),
    });

    render(<PartyPlateSelection {...defaultProps} />);

    expect(screen.getByText(/Failed to load/)).toBeInTheDocument();
  });

  it('calls onUseAI when Chat with AI Planner is clicked', async () => {
    mockUsePartyPlates.mockReturnValue({
      system: [],
      mine: [],
      isLoading: false,
      error: undefined,
    });

    render(<PartyPlateSelection {...defaultProps} />);

    fireEvent.click(screen.getByText('Chat with AI Planner'));

    expect(defaultProps.onUseAI).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when Back button is clicked', () => {
    mockUsePartyPlates.mockReturnValue({
      system: [],
      mine: [],
      isLoading: false,
      error: undefined,
    });

    render(<PartyPlateSelection {...defaultProps} onBack={defaultProps.onBack} />);

    fireEvent.click(screen.getByText('Back'));

    expect(defaultProps.onBack).toHaveBeenCalledTimes(1);
  });
});
