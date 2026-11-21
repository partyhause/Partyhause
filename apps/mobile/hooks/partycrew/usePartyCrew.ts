/**
 * usePartyCrew Hook
 * Manages PartyCrew operations (join, leave, withdraw a request)
 */

import { useState } from 'react';
import type { CrewToggleResult } from '@partyhause/core';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/client';

interface UsePartyCrewResult {
  isJoining: boolean;
  error: string | null;
  /**
   * The one toggle path. Returns the full result, not a flag: a private
   * account answers `action: 'requested'`, a pending connection request
   * rather than a follow, and the caller must render that distinction or the
   * button claims a relationship that does not exist. Null when the request
   * failed.
   *
   * Passing `currentStatus` true sends 'leave', which also withdraws a
   * pending request (the route's leave branch cleans the request rows up).
   */
  toggleCrew: (creatorId: string, currentStatus: boolean) => Promise<CrewToggleResult | null>;
}

export function usePartyCrew(): UsePartyCrewResult {
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The route requires `action`; omitting it is a 400, so it is a required
   * argument here rather than an optional one. Throwing on failure is kept
   * deliberately: the caller translates a throw into an error haptic.
   */
  const makeRequest = async (
    creatorId: string,
    action: 'join' | 'leave',
  ): Promise<CrewToggleResult> => {
    const { data, error: apiError } = await api.partycrew.toggle(creatorId, action);

    if (apiError) {
      throw new Error(apiError.message);
    }
    if (!data) {
      throw new Error('Request failed');
    }

    return data;
  };

  const toggleCrew = async (
    creatorId: string,
    currentStatus: boolean,
  ): Promise<CrewToggleResult | null> => {
    setIsJoining(true);
    setError(null);

    try {
      const result = await makeRequest(creatorId, currentStatus ? 'leave' : 'join');

      if (result.success) {
        if (result.action === 'joined') {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (result.action === 'requested') {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } else {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to update PartyCrew';
      setError(errorMsg);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return null;
    } finally {
      setIsJoining(false);
    }
  };

  return {
    isJoining,
    error,
    toggleCrew,
  };
}
