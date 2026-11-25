import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePartyBoard } from './usePartyBoard';
import { StickyItem } from '../types';

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiPatch = vi.mocked(apiPatch);
const mockApiDelete = vi.mocked(apiDelete);

const mockSticky: StickyItem = {
  id: 'sticky-1',
  event_id: 'event-1',
  session_id: 'session-1',
  type: 'note',
  position: { x: 100, y: 100 },
  size: { width: 200, height: 200 },
  rotation: 0,
  z_index: 1,
  category: 'venue',
  reaction_count: 0,
  created_by: 'user-1',
  created_by_name: 'Test User',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  data: { content: 'Test sticky note', color: '#ff0000', font_size: 14 },
};

const mockStickiesResponse = { stickies: [mockSticky] };

describe('usePartyBoard', () => {
  beforeEach(() => {
    mockApiGet.mockResolvedValue({ data: mockStickiesResponse, error: null });
    mockApiPost.mockResolvedValue({ data: { sticky: mockSticky }, error: null });
    mockApiPatch.mockResolvedValue({ data: null, error: null });
    mockApiDelete.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchStickies', () => {
    it('fetches stickies from the API on mount', async () => {
      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockApiGet).toHaveBeenCalledTimes(1);
      expect(mockApiGet).toHaveBeenCalledWith('/api/partyboard/stickies?eventId=event-1');
      expect(result.current.stickies).toEqual([mockSticky]);
    });

    it('handles API errors gracefully', async () => {
      mockApiGet.mockResolvedValue({ data: null, error: { message: 'Network error' } });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.stickies).toEqual([]);
    });

    it('loading state is true during fetch', async () => {
      let resolvePromise: (() => void) | null = null;
      mockApiGet.mockImplementation(() =>
        new Promise((r) => {
          resolvePromise = () => r({ data: mockStickiesResponse, error: null });
        })
      );

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise?.();
      });

      expect(result.current.loading).toBe(false);
    });
  });

  describe('createNote', () => {
    it('creates a note sticky successfully', async () => {
      mockApiPost.mockResolvedValue({ data: { sticky: mockSticky }, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      const newSticky = await act(async () => {
        return await result.current.createNote({
          content: 'Test note',
          category: 'venue',
          color: '#ff0000',
          position: { x: 50, y: 50 },
        });
      });

      expect(mockApiPost).toHaveBeenCalledWith('/api/partyboard/stickies', {
        event_id: 'event-1',
        session_id: undefined,
        type: 'note',
        position: { x: 50, y: 50 },
        size: { width: 200, height: 200 },
        category: 'venue',
        data: { content: 'Test note', color: '#ff0000', font_size: 14 },
      });
      expect(newSticky).toEqual(mockSticky);
      expect(result.current.stickies).toContain(mockSticky);
    });

    it('handles creation errors', async () => {
      mockApiPost.mockResolvedValue({ data: null, error: { message: 'Server error' } });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      const newSticky = await act(async () => {
        return await result.current.createNote({
          content: 'Test note',
          category: 'venue',
          color: '#ff0000',
          position: { x: 50, y: 50 },
        });
      });

      expect(newSticky).toBeNull();
      expect(result.current.error).toBe('Server error');
      expect(result.current.stickies).toHaveLength(1); // 1 from mount fetchStickies
    });
  });

  describe('createIdea', () => {
    it('creates an idea sticky successfully', async () => {
      mockApiPost.mockResolvedValue({ data: { sticky: mockSticky }, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      const newSticky = await act(async () => {
        return await result.current.createIdea({
          content: 'Great idea!',
          category: 'food',
          estimated_cost: 500,
          position: { x: 200, y: 200 },
        });
      });

      expect(mockApiPost).toHaveBeenCalledWith('/api/partyboard/stickies', {
        event_id: 'event-1',
        session_id: undefined,
        type: 'idea',
        position: { x: 200, y: 200 },
        size: { width: 200, height: 200 },
        category: 'food',
        data: { content: 'Great idea!', category: 'food', estimated_cost: 500 },
      });
      expect(newSticky).toEqual(mockSticky);
    });
  });

  describe('voteOnIdea', () => {
    it('updates vote count on successful vote', async () => {
      mockApiPatch.mockResolvedValue({ data: { votes: 5, user_has_voted: true }, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      const success = await act(async () => {
        return await result.current.voteOnIdea('sticky-1');
      });

      expect(success).toBe(true);
      expect(result.current.stickies[0].reaction_count).toBe(5);
      expect((result.current.stickies[0].data as any).user_has_voted).toBe(true);
    });

    it('handles vote errors', async () => {
      mockApiPatch.mockResolvedValue({ data: null, error: { message: 'Vote failed' } });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      const success = await act(async () => {
        return await result.current.voteOnIdea('sticky-1');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Vote failed');
    });
  });

  describe('convertToTask', () => {
    it('converts sticky to task successfully', async () => {
      mockApiPost.mockResolvedValue({ data: { task_id: 'task-1', status: 'created' }, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      const success = await act(async () => {
        return await result.current.convertToTask('sticky-1');
      });

      expect(success).toBe(true);
    });

    it('handles convert failure', async () => {
      mockApiPost.mockResolvedValue({ data: null, error: { message: 'Convert failed' } });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      const success = await act(async () => {
        return await result.current.convertToTask('sticky-1');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Convert failed');
    });
  });

  describe('updateStickyPosition', () => {
    it('updates sticky position optimistically', async () => {
      mockApiPatch.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.updateStickyPosition('sticky-1', { x: 500, y: 500 });
      });

      expect(result.current.stickies[0].position).toEqual({ x: 500, y: 500 });
    });

    it('debounces position updates', async () => {
      vi.useFakeTimers();
      mockApiPatch.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        result.current.updateStickyPosition('sticky-1', { x: 100, y: 100 });
      });
      act(() => {
        result.current.updateStickyPosition('sticky-1', { x: 200, y: 200 });
      });
      act(() => {
        result.current.updateStickyPosition('sticky-1', { x: 300, y: 300 });
      });

      vi.advanceTimersByTime(350);
      await act(async () => {
        await Promise.resolve();
      });

      vi.useRealTimers();

      expect(mockApiPatch).toHaveBeenCalledTimes(1);
      expect(mockApiPatch).toHaveBeenCalledWith(
        '/api/partyboard/stickies/sticky-1/position',
        { position: { x: 300, y: 300 } }
      );
    });

    it('rolls back position on API error', async () => {
      mockApiPatch.mockResolvedValue({ data: null, error: { message: 'Server error' } });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await result.current.updateStickyPosition('sticky-1', { x: 500, y: 500 });
      });

      expect(result.current.stickies[0].position).toEqual({ x: 100, y: 100 });
      expect(result.current.error).toBe('Server error');
    });
  });

  describe('deleteSticky', () => {
    it('deletes a sticky successfully', async () => {
      mockApiDelete.mockResolvedValue({ data: null, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      const success = await act(async () => {
        return await result.current.deleteSticky('sticky-1');
      });

      expect(success).toBe(true);
      expect(result.current.stickies).toHaveLength(0);
    });

    it('handles delete errors', async () => {
      mockApiDelete.mockResolvedValue({ data: null, error: { message: 'Delete failed' } });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });

      const success = await act(async () => {
        return await result.current.deleteSticky('sticky-1');
      });

      expect(success).toBe(false);
      expect(result.current.error).toBe('Delete failed');
      expect(result.current.stickies).toHaveLength(1); // 1 from mount fetchStickies
    });
  });

  describe('seedFromTemplate', () => {
    it('creates stickies from template data', async () => {
      mockApiPost.mockResolvedValue({ data: { sticky: mockSticky }, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

        // Test-only methods not typed on the hook return type.
        const board = result.current as unknown as {
          seedFromTemplate: (id: string, data: unknown) => Promise<void>;
        };
        await act(async () => {
          await board.seedFromTemplate('birthday', {
            name: 'Birthday Celebration',
            slug: 'birthday-celebration',
            category: 'birthday',
            default_payload: {
              stickies: [
                {
                  slug: 'birthday-cake',
                  type: 'note',
                  position: { x: 100, y: 100 },
                  size: { width: 200, height: 200 },
                  category: 'food',
                  data: { content: "Don't forget the cake!", color: '#ff6b6b' },
                },
              ],
            },
          });
        });

      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(mockApiPost).toHaveBeenCalledWith('/api/partyboard/stickies', {
        event_id: 'event-1',
        session_id: undefined,
        type: 'note',
        position: { x: 100, y: 100 },
        size: { width: 200, height: 200 },
        category: 'food',
        data: { content: "Don't forget the cake!", color: '#ff6b6b' },
      });
    });

    it('does not seed if stickies already exist', async () => {
      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        await Promise.resolve();
      });
        const board = result.current as unknown as {
          seedFromTemplate: (id: string, data: unknown) => Promise<void>;
        };
        await act(async () => {
          await board.seedFromTemplate('birthday', {
            name: 'Birthday',
            slug: 'birthday',
            category: 'birthday',
            default_payload: { stickies: [] },
          });
        });
      expect(mockApiPost).not.toHaveBeenCalled();
    });
  });

  describe('seedFromFormData', () => {
    it('creates stickies from event form data', async () => {
      mockApiPost.mockResolvedValue({ data: { sticky: mockSticky }, error: null });

      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));
        const board = result.current as unknown as {
          seedFromFormData: (data: unknown) => Promise<void>;
        };
        await act(async () => {
          await board.seedFromFormData({
            name: 'Birthday Party',
            start_date: '2026-12-25',
            start_time: '18:00',
            location: 'My House',
            description: 'A birthday celebration',
            template_type: 'birthday',
          });
        });
      expect(mockApiPost).toHaveBeenCalledTimes(4);
    });
  });

  describe('getStats', () => {
    it('calculates correct statistics', async () => {
      const { result } = renderHook(() => usePartyBoard({ eventId: 'event-1' }));

      await act(async () => {
        mockApiPost.mockResolvedValue({ data: { sticky: mockSticky }, error: null });
        await result.current.createNote({ content: 'a', category: 'food', color: '#ff0000', position: { x: 0, y: 0 } });
      });

      const stats = result.current.getStats();
      expect(stats.stickies).toBe(2); // 1 from mount fetch + 1 from createNote
      expect(stats.votes).toBe(0);
    });
  });
});