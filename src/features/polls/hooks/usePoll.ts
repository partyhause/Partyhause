/**
 * Polls, over the shared client.
 *
 * Five bare fetches used to live here, each rebuilding the base URL, reading
 * the token by hand and sending `Bearer ${token ?? ''}` — a literal
 * "Bearer " with nothing after it when signed out, which the server reads as
 * a malformed header rather than as an absent one. None of them had a
 * timeout, a retry, or 401 handling, so a dropped connection hung until the
 * browser gave up and a revoked session produced "Failed to fetch polls"
 * instead of signing the user out.
 */
import { useState, useEffect } from 'react';
import { Poll, VoteData, CreatePollData } from '../types';
import { apiGet, apiPost } from '@/lib/api-client';

interface UsePollOptions {
  eventId?: string;
  pollId?: string;
  autoRefresh?: boolean;
}

export const usePoll = ({ eventId, pollId, autoRefresh = false }: UsePollOptions = {}) => {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [currentPoll, setCurrentPoll] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch polls for an event
  const fetchPolls = async (eventIdParam?: string) => {
    const id = eventIdParam || eventId;
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: failure } = await apiGet<{ polls?: Poll[] }>(
        `/api/polls?eventId=${encodeURIComponent(id)}`,
      );
      if (failure) throw new Error(failure.message);
      setPolls(data?.polls || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch polls');
    } finally {
      setLoading(false);
    }
  };

  // Fetch a single poll
  const fetchPoll = async (pollIdParam?: string) => {
    const id = pollIdParam || pollId;
    if (!id) return;

    setLoading(true);
    setError(null);

    try {
      const { data, error: failure } = await apiGet<{ poll?: Poll }>(
        `/api/polls/${encodeURIComponent(id)}`,
      );
      if (failure) throw new Error(failure.message);
      setCurrentPoll(data?.poll ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch poll');
    } finally {
      setLoading(false);
    }
  };

  // Create a new poll
  const createPoll = async (eventIdParam: string, pollData: CreatePollData): Promise<Poll | null> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: failure } = await apiPost<{ poll?: Poll }>('/api/polls', {
        event_id: eventIdParam,
        ...pollData,
      });
      if (failure) throw new Error(failure.message);
      const newPoll = data?.poll as Poll;

      // Add to polls list if we're viewing this event
      if (eventIdParam === eventId) {
        setPolls((prev) => [newPoll, ...prev]);
      }

      return newPoll;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create poll');
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Vote on a poll
  const vote = async (pollIdParam: string, voteData: VoteData): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: failure } = await apiPost<{ poll?: Poll }>(
        `/api/polls/${encodeURIComponent(pollIdParam)}/vote`,
        voteData,
      );
      if (failure) throw new Error(failure.message);
      const updatedPoll = data?.poll as Poll;

      // Update the poll in the list
      setPolls((prev) =>
        prev.map((p) => (p.id === pollIdParam ? updatedPoll : p))
      );

      // Update current poll if it's the one we voted on
      if (pollIdParam === pollId) {
        setCurrentPoll(updatedPoll);
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit vote');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Close a poll
  const closePoll = async (pollIdParam: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: failure } = await apiPost<{ poll?: Poll }>(
        `/api/polls/${encodeURIComponent(pollIdParam)}/close`,
      );
      if (failure) throw new Error(failure.message);
      const updatedPoll = data?.poll as Poll;

      // Update the poll in the list
      setPolls((prev) =>
        prev.map((p) => (p.id === pollIdParam ? updatedPoll : p))
      );

      // Update current poll if it's the one we closed
      if (pollIdParam === pollId) {
        setCurrentPoll(updatedPoll);
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close poll');
      return false;
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh polls
  useEffect(() => {
    if (autoRefresh && eventId) {
      const interval = setInterval(() => {
        fetchPolls(eventId);
      }, 5000); // Refresh every 5 seconds

      return () => clearInterval(interval);
    }
  }, [autoRefresh, eventId]);

  // Initial fetch
  useEffect(() => {
    if (eventId) {
      fetchPolls(eventId);
    } else if (pollId) {
      fetchPoll(pollId);
    }
  }, [eventId, pollId]);

  return {
    polls,
    currentPoll,
    loading,
    error,
    fetchPolls,
    fetchPoll,
    createPoll,
    vote,
    closePoll,
  };
};
