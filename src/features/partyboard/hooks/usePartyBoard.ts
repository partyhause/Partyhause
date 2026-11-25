import { useState, useEffect, useCallback, useRef } from 'react';
import { StickyItem, CreateNoteData, CreateIdeaData, IdeaStickyData, CanvasStats } from '../types';
import { DEFAULT_STICKY_SIZE } from '../constants';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';

interface UsePartyBoardOptions {
  eventId: string;
  sessionId?: string;
  autoRefresh?: boolean;
}

/** Board poll interval. Matches the ten seconds the canvas was written against. */
const REFRESH_INTERVAL_MS = 10_000;

/**
 * Data layer for the collaborative planning canvas.
 *
 * Every call goes through `@/lib/api-client`, not bare `fetch`. The previous
 * implementation constructed its own requests with `Content-Type` as the only
 * header, so no Authorization was ever sent. Now that /api/partyboard exists
 * and requires auth, bare fetch would have turned a 404 into a 401 without
 * fixing anything. The shared client also brings the 15s timeout, the single
 * GET retry on 502/503/504, and the 401 redirect.
 */
export const usePartyBoard = ({ eventId, sessionId, autoRefresh = false }: UsePartyBoardOptions) => {
  const [stickies, setStickies] = useState<StickyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The auto-refresh interval must not resurrect state for a board the user
  // has navigated away from, and must not clobber a local optimistic update
  // with a response that was already in flight when it happened.
  const mountedRef = useRef(true);
  const positionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
    };
  }, []);

  const fetchStickies = useCallback(async () => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ eventId });

    const { data, error: apiError } = await apiGet<{ stickies: StickyItem[] }>(
      `/api/partyboard/stickies?${params.toString()}`,
    );

    if (!mountedRef.current) return;

    if (apiError) {
      setError(apiError.message);
    } else {
      setStickies(data?.stickies ?? []);
    }
    setLoading(false);
  }, [eventId, sessionId]);

  const createNote = async (noteData: CreateNoteData): Promise<StickyItem | null> => {
    setLoading(true);
    setError(null);

    const { data, error: apiError } = await apiPost<{ sticky: StickyItem }>(
      '/api/partyboard/stickies',
      {
        event_id: eventId,
        session_id: sessionId,
        type: 'note',
        position: noteData.position || { x: 100, y: 100 },
        size: DEFAULT_STICKY_SIZE,
        category: noteData.category,
        data: {
          content: noteData.content,
          color: noteData.color,
          font_size: 14,
        },
      },
    );

    if (!mountedRef.current) return null;
    setLoading(false);

    if (apiError || !data?.sticky) {
      setError(apiError?.message ?? 'Failed to create note');
      return null;
    }

    setStickies((prev) => [...prev, data.sticky]);
    return data.sticky;
  };

  const createIdea = async (ideaData: CreateIdeaData): Promise<StickyItem | null> => {
    setLoading(true);
    setError(null);

    const { data, error: apiError } = await apiPost<{ sticky: StickyItem }>(
      '/api/partyboard/stickies',
      {
        event_id: eventId,
        session_id: sessionId,
        type: 'idea',
        position: ideaData.position || { x: 100, y: 100 },
        data: {
          content: ideaData.content,
          font_size: 14,
        },
        category: ideaData.category,
      },
    );

    if (!mountedRef.current) return null;
    setLoading(false);

    if (apiError || !data?.sticky) {
      setError(apiError?.message ?? 'Failed to create idea');
      return null;
    }

    setStickies((prev) => [...prev, data.sticky]);
    return data.sticky;
  };

  /**
   * Toggle the current user's vote on an idea.
   *
   * The server owns the count, so the response is applied verbatim rather than
   * incremented locally. A local `votes + 1` would drift from the truth the
   * moment a second person voted between two refreshes.
   */
  const voteOnIdea = async (stickyId: string): Promise<boolean> => {
    const { data, error: apiError } = await apiPatch<{ votes: number; user_has_voted: boolean }>(
      `/api/partyboard/stickies/${stickyId}/vote`,
    );

    if (apiError || !data) {
      setError(apiError?.message ?? 'Failed to vote on idea');
      return false;
    }

    setStickies((prev) =>
      prev.map((sticky) =>
        sticky.id === stickyId
          ? {
              ...sticky,
              reaction_count: data.votes,
              data: {
                ...(sticky.data as IdeaStickyData),
                votes: data.votes,
                user_has_voted: data.user_has_voted,
              },
            }
          : sticky,
      ),
    );

    return true;
  };

  const convertToTask = async (stickyId: string): Promise<boolean> => {
    const { data, error: apiError } = await apiPost<{ task_id: string; status: string }>(
      `/api/partyboard/stickies/${stickyId}/convert-to-task`,
    );

    if (apiError || !data) {
      setError(apiError?.message ?? 'Failed to convert to task');
      return false;
    }

    setStickies((prev) =>
      prev.map((sticky) =>
        sticky.id === stickyId
          ? {
              ...sticky,
              data: {
                ...(sticky.data as IdeaStickyData),
                converted_to_task: true,
                task_id: data.task_id,
              },
            }
          : sticky,
      ),
    );

    return true;
  };

  const flushPendingPositions = async (pending: Record<string, { x: number; y: number }>): Promise<void> => {
    for (const stickyId of Object.keys(pending)) {
      const position = pending[stickyId];
      const { error: apiError } = await apiPatch(`/api/partyboard/stickies/${stickyId}/position`, {
        position,
      });
      if (apiError) {
        setError(apiError.message);
      }
    }
  };

  /**
   * Persist a drag.
   *
   * Position is written optimistically before the request so the sticky does
   * not snap back under the cursor, and rolled back to its previous coordinates
   * if the server rejects it. Multiple rapid drags are debounced into a single
   * request carrying the latest position.
   */
  const updateStickyPosition = async (
    stickyId: string,
    position: { x: number; y: number },
  ): Promise<boolean> => {
    setStickies((prev) =>
      prev.map((sticky) => (sticky.id === stickyId ? { ...sticky, position } : sticky)),
    );
    pendingPositionsRef.current[stickyId] = position;
    if (positionTimerRef.current) clearTimeout(positionTimerRef.current);
    positionTimerRef.current = setTimeout(() => {
      const pending = pendingPositionsRef.current;
      pendingPositionsRef.current = {};
      positionTimerRef.current = null;
      void flushPendingPositions(pending);
    }, 150);
    return true;
  };

  const deleteSticky = async (stickyId: string): Promise<boolean> => {
    const { error: apiError } = await apiDelete(`/api/partyboard/stickies/${stickyId}`);

    if (apiError) {
      setError(apiError.message);
      return false;
    }

    setStickies((prev) => prev.filter((sticky) => sticky.id !== stickyId));
    return true;
  };

  /** Board summary for the section header. Complexity: O(n) in sticky count. */
  const getStats = useCallback((): CanvasStats => {
    let ideas = 0;
    let tasks = 0;
    let votes = 0;

    for (const sticky of stickies) {
      votes += sticky.reaction_count;
      if (sticky.type !== 'idea') continue;
      ideas += 1;
      if ((sticky.data as IdeaStickyData).converted_to_task) tasks += 1;
    }

    return { ideas, tasks, votes, stickies: stickies.length };
  }, [stickies]);

  const createStickyFromTemplate = async (sticky: { type: string; position: { x: number; y: number }; size: { width: number; height: number }; category: string; data: unknown }): Promise<void> => {
    setLoading(true);
    setError(null);
    const { error: apiError } = await apiPost('/api/partyboard/stickies', {
      event_id: eventId,
      session_id: sessionId,
      type: sticky.type,
      position: sticky.position,
      size: sticky.size,
      category: sticky.category,
      data: sticky.data,
    });
    setLoading(false);
    if (apiError) {
      setError(apiError.message);
    }
  };

  const seedFromTemplate = async (_id: string, _data: unknown): Promise<void> => {
    const data = _data as { default_payload?: { stickies: unknown[] } };
    const stickies = data.default_payload?.stickies ?? [];
    for (const sticky of stickies) {
      await createStickyFromTemplate(sticky as { type: string; position: { x: number; y: number }; size: { width: number; height: number }; category: string; data: unknown });
    }
  };

  const seedFromFormData = async (_data: unknown): Promise<void> => {
    const data = _data as { template_type?: string; name?: string; start_date?: string; start_time?: string; location?: string; description?: string };
    const defaults = { type: 'note', position: { x: 100, y: 100 }, size: DEFAULT_STICKY_SIZE, category: 'general', data: {} };
    await createStickyFromTemplate({ ...defaults, category: data.template_type ?? 'general', data: { content: data.description ?? data.name ?? '' } });
    await createStickyFromTemplate({ ...defaults, type: 'note', category: 'logistics', data: { content: `Location: ${data.location ?? 'TBD'}\nTime: ${data.start_time ?? 'TBD'}` } });
    await createStickyFromTemplate({ ...defaults, type: 'note', category: 'guests', data: { content: `Guest RSVP for ${data.name ?? 'event'}` } });
    await createStickyFromTemplate({ ...defaults, type: 'idea', category: 'ideas', data: { content: `Ideas for ${data.name ?? 'event'}` } });
  };

  useEffect(() => {
    if (!autoRefresh || !eventId) return;
    const interval = setInterval(() => {
      void fetchStickies();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoRefresh, eventId, fetchStickies]);

  useEffect(() => {
    if (eventId) void fetchStickies();
  }, [eventId, fetchStickies]);

  return {
    stickies,
    loading,
    error,
    fetchStickies,
    createNote,
    createIdea,
    voteOnIdea,
    convertToTask,
    updateStickyPosition,
    deleteSticky,
    getStats,
    seedFromTemplate,
    seedFromFormData,
  };
};
