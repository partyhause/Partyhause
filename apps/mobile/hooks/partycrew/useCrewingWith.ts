/**
 * useCrewingWith Hook
 * Fetches list of creators a user is following
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CrewCreatorRow } from '@partyhause/core';
import { api } from '@/lib/client';

/**
 * Re-exported so existing consumers that imported the local `Creator` shape
 * keep compiling. The canonical definition now lives in @partyhause/core and
 * is checked against the route by scripts/audit-contracts.cjs.
 */
export type Creator = CrewCreatorRow;

interface UseCrewingWithResult {
  creators: Creator[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  hasMore: boolean;
  loadMore: () => Promise<void>;
}

export function useCrewingWith(
  userId?: string,
  limit: number = 20
): UseCrewingWithResult {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // In-flight guards, same shape as useCrewFeed: isLoading is only held
  // across a reset, so a page fetch needs its own guard or a fast scroll
  // fires onEndReached twice with the same offset and appends the same page
  // twice. The sequence ref discards a response whose caller has been
  // superseded, and only the newest call releases the flag.
  const fetchingRef = useRef(false);
  const sequenceRef = useRef(0);
  // The offset is read through a ref so fetchCreators' identity does not
  // change per page, which would re-trigger the reset effect below.
  const offsetRef = useRef(0);

  const fetchCreators = useCallback(async (reset: boolean = false, force: boolean = false) => {
    if (fetchingRef.current && !force) return;
    fetchingRef.current = true;
    const ticket = ++sequenceRef.current;

    try {
      if (!(await api.auth.isAuthenticated())) {
        if (sequenceRef.current === ticket) setIsLoading(false);
        return;
      }

      // The route reads `userId` straight off the query string and never falls
      // back to the bearer token's subject, so omitting it produces a 404 rather
      // than "my own crew". Resolve it from the cached session instead.
      let targetUserId = userId;
      if (!targetUserId) {
        const cached = await api.auth.getCachedUser();
        targetUserId = cached?.id;
      }
      if (!targetUserId) {
        if (sequenceRef.current === ticket) setIsLoading(false);
        return;
      }

      if (reset) setIsLoading(true);

      const currentOffset = reset ? 0 : offsetRef.current;

      // The Authorization header is attached by the shared transport, so the
      // manual session lookup and URL assembly are gone.
      const { data, error: apiError } = await api.partycrew.crewingWith(targetUserId, {
        limit,
        offset: currentOffset,
      });

      if (sequenceRef.current !== ticket) return;

      if (apiError) {
        setError(apiError.message);
      } else if (data) {
        if (reset) {
          setCreators(data.creators);
          offsetRef.current = limit;
        } else {
          setCreators(prev => [...prev, ...data.creators]);
          offsetRef.current = currentOffset + limit;
        }
        setHasMore(data.has_more);
        setError(null);
      }
      setIsLoading(false);
    } finally {
      if (sequenceRef.current === ticket) {
        fetchingRef.current = false;
      }
    }
  }, [userId, limit]);

  useEffect(() => {
    void fetchCreators(true);
  }, [userId, fetchCreators]);

  const refetch = useCallback(async () => {
    await fetchCreators(true, true);
  }, [fetchCreators]);

  const loadMore = useCallback(async () => {
    if (!isLoading && hasMore) {
      await fetchCreators(false);
    }
  }, [isLoading, hasMore, fetchCreators]);

  return {
    creators,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
  };
}
