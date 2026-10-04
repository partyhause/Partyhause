/**
 * useCrewFeed Hook
 * Fetches personalized feed from PartyCrew creators
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FeedPost, FeedContentType } from '@partyhause/core';
import { api } from '@/lib/client';

export type { FeedPost };

interface UseCrewFeedResult {
  posts: FeedPost[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  /** Apply an optimistic update to one post in place. */
  updateLocalPost: (postId: string, update: (post: FeedPost) => FeedPost) => void;
}

export function useCrewFeed(
  contentType?: FeedContentType,
  limit: number = 10
): UseCrewFeedResult {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // In-flight guards. isLoading is the UI spinner and is only held across a
  // reset, so a page fetch needs its own guard: without one, a fast scroll
  // fires onEndReached twice with the same cursor and appends the same page
  // twice, which is a duplicate-key list. The sequence ref applies only the
  // newest response: two rapid filter switches can otherwise land out of
  // order and leave posts from the wrong filter displayed with the wrong
  // cursor. Only the newest call releases the in-flight flag, so an
  // interrupted page fetch cannot release it out from under a reset.
  const fetchingRef = useRef(false);
  const sequenceRef = useRef(0);
  // The cursor is read through a ref so fetchFeed's identity does not change
  // per page, which would re-trigger the reset effect below.
  const cursorRef = useRef<string | null>(null);

  const fetchFeed = useCallback(async (reset: boolean = false, force: boolean = false) => {
    if (fetchingRef.current && !force) return;
    fetchingRef.current = true;
    const ticket = ++sequenceRef.current;

    try {
      if (!(await api.auth.isAuthenticated())) {
        if (sequenceRef.current === ticket) setIsLoading(false);
        return;
      }

      if (reset) setIsLoading(true);

      // On a reset the cursor is deliberately dropped, otherwise a refresh
      // would resume mid-stream and silently hide everything published
      // since.
      const { data, error: apiError } = await api.feed.crew({
        limit,
        contentType,
        cursor: reset ? undefined : cursorRef.current ?? undefined,
      });

      if (sequenceRef.current !== ticket) return;

      if (apiError) {
        setError(apiError.message);
      } else if (data) {
        if (reset) {
          setPosts(data.posts);
        } else {
          setPosts(prev => [...prev, ...data.posts]);
        }
        cursorRef.current = data.next_cursor;
        setCursor(data.next_cursor);
        setHasMore(data.has_more);
        setError(null);
      }
      setIsLoading(false);
    } finally {
      if (sequenceRef.current === ticket) {
        fetchingRef.current = false;
      }
    }
  }, [contentType, limit]);

  useEffect(() => {
    void fetchFeed(true);
  }, [contentType, fetchFeed]);

  const refetch = useCallback(async () => {
    cursorRef.current = null;
    setCursor(null);
    await fetchFeed(true, true);
  }, [fetchFeed]);

  const loadMore = useCallback(async () => {
    if (!isLoading && hasMore && cursorRef.current) {
      await fetchFeed(false);
    }
  }, [isLoading, hasMore, fetchFeed]);

  const updateLocalPost = useCallback((postId: string, update: (post: FeedPost) => FeedPost) => {
    setPosts(prev => prev.map(p => (p.id === postId ? update(p) : p)));
  }, []);

  return {
    posts,
    isLoading,
    error,
    refetch,
    loadMore,
    hasMore,
    updateLocalPost,
  };
}
