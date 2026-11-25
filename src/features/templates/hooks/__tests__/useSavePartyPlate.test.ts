import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSavePartyPlate } from '../useSavePartyPlate';

const mockPost = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiPost: (...args: unknown[]) => mockPost(...args),
}));

vi.mock('@/components/ui/use-toast', () => ({
  toast: vi.fn(),
}));

describe('useSavePartyPlate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates required name and event_type before posting', async () => {
    const { result } = renderHook(() => useSavePartyPlate());

    await act(async () => {
      const ok = await result.current.save({ name: '', event_type: '' });
      expect(ok).toBe(false);
    });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('posts payload to /api/event-templates/ and returns true on success', async () => {
    mockPost.mockResolvedValue({ data: { id: 'tpl_1' }, error: null });

    const { result } = renderHook(() => useSavePartyPlate());

    const payload = {
      name: 'Birthday Party',
      description: 'A fun birthday',
      category: 'custom',
      event_type: 'single_day',
      start_date: '2026-12-01',
      start_time: '14:00',
      end_date: '2026-12-01',
      end_time: '18:00',
      location: 'Home',
      spotify_playlist_url: 'https://open.spotify.com/playlist/abc',
    };

    await act(async () => {
      const ok = await result.current.save(payload);
      expect(ok).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith('/api/event-templates/', {
      name: 'Birthday Party',
      description: 'A fun birthday',
      category: 'custom',
      default_payload: {
        event: {
          event_type: 'single_day',
          start_date: '2026-12-01',
          start_time: '14:00',
          end_date: '2026-12-01',
          end_time: '18:00',
          location: 'Home',
          spotify_playlist_url: 'https://open.spotify.com/playlist/abc',
        },
      },
    });
  });

  it('returns false and does not throw when the API fails', async () => {
    mockPost.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useSavePartyPlate());

    await act(async () => {
      const ok = await result.current.save({
        name: 'X',
        event_type: 'single_day',
      });
      expect(ok).toBe(false);
    });
  });

  it('sets isSaving true during the request and false after', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    const postPromise = new Promise<unknown>((res) => {
      resolvePost = res;
    });
    mockPost.mockReturnValue(postPromise);

    const { result } = renderHook(() => useSavePartyPlate());

    let savePromise: Promise<boolean>;
    act(() => {
      savePromise = result.current.save({
        name: 'X',
        event_type: 'single_day',
      });
    });

    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      resolvePost({ data: null, error: null });
      await savePromise;
    });

    expect(result.current.isSaving).toBe(false);
  });
});
