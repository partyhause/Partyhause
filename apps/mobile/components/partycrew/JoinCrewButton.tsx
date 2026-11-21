/**
 * JoinCrewButton Component
 * Smart button for joining/leaving a creator's PartyCrew
 * Shows 3 states: Join, Crewing ✓, Requested
 */

import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  View,
  ViewStyle
} from 'react-native';
import { usePartyCrew } from '@/hooks/partycrew/usePartyCrew';
import { useCrewStatus } from '@/hooks/partycrew/useCrewStatus';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

interface JoinCrewButtonProps {
  creatorId: string;
  variant?: 'default' | 'outline' | 'compact';
  onStatusChange?: (isFollowing: boolean) => void;
}

export function JoinCrewButton({ 
  creatorId, 
  variant = 'default',
  onStatusChange 
}: JoinCrewButtonProps) {
  const { status, isLoading: statusLoading, updateLocalStatus } = useCrewStatus(creatorId);
  const { isJoining, toggleCrew } = usePartyCrew();

  const handlePress = async () => {
    const isFollowing = status?.isFollowing || false;
    const isPending = status?.isPending || false;

    // Pending sends 'leave', not 'join': the server's leave branch withdraws a
    // pending request, while 'join' on an already-pending request answers
    // 'requested' again and the tap would re-ping forever without ever
    // cancelling.
    const result = await toggleCrew(creatorId, isFollowing || isPending);

    if (!result?.success) return;

    if (result.action === 'requested') {
      // A private account does not join immediately: the route created a
      // pending connection request. Flipping to "Crewing" here is the bug
      // that made this button claim a relationship that does not exist; the
      // request shows as pending until it is granted or withdrawn.
      updateLocalStatus({ isFollowing: false, isPending: true });
      onStatusChange?.(false);
      return;
    }

    // 'joined' or 'left'. 'left' also covers a withdrawn request: the
    // connection (if any) and the request rows are gone, so the button
    // returns to "Join Crew".
    const following = result.action === 'joined';
    updateLocalStatus({ isFollowing: following, isPending: false });
    onStatusChange?.(following);
  };

  /**
   * Withdraw the pending request outright, from the button that created it.
   * The route accepts the withdrawal from the requester and reads the
   * request id, which the status check supplies. The button re-arms for a
   * fresh join afterwards.
   */
  const handleCancelRequest = async () => {
    const requestId = status?.request?.id;
    if (!requestId || isJoining) return;

    const { error } = await api.partycrew.cancelRequest(requestId);
    if (error) return;

    updateLocalStatus({ isFollowing: false, isPending: false });
  };

  const confirmCancelRequest = () => {
    Alert.alert(
      'Cancel request',
      'Withdraw your request to join this PartyCrew?',
      [
        { text: 'Keep request', style: 'cancel' },
        { text: 'Cancel request', style: 'destructive', onPress: () => { void handleCancelRequest(); } },
      ],
    );
  };

  // Loading state
  if (statusLoading) {
    return (
      <View style={[
        styles.button, 
        styles.buttonOutline,
        variant === 'compact' && styles.buttonCompact
      ]}>
        <ActivityIndicator size="small" color={COLORS.primary.main} />
      </View>
    );
  }

  // Determine button state
  const isFollowing = status?.isFollowing || false;
  const isPending = status?.isPending || false;
  
  let buttonText = 'Join Crew';
  let colorStyle: ViewStyle = styles.buttonPrimary;

  if (isFollowing) {
    buttonText = 'Crewing ✓';
    colorStyle = styles.buttonSuccess;
  } else if (isPending) {
    buttonText = 'Requested';
    colorStyle = styles.buttonPending;
  }

  if (variant === 'outline') {
    colorStyle = styles.buttonOutline;
  }

  const buttonStyles: any = [
    styles.button,
    colorStyle,
    variant === 'compact' && styles.buttonCompact
  ];

  const textStyles: any = [
    styles.buttonText,
    variant === 'outline' ? styles.buttonTextOutline : styles.buttonTextPrimary,
    variant === 'compact' && styles.buttonTextCompact
  ];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={isPending ? confirmCancelRequest : handlePress}
      disabled={isJoining}
      activeOpacity={0.7}
    >
      {isJoining ? (
        <ActivityIndicator size="small" color={variant === 'outline' ? COLORS.primary.main : '#FFF'} />
      ) : (
        <Text style={textStyles}>{buttonText}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  buttonPrimary: {
    backgroundColor: COLORS.primary.main,
  },
  buttonSuccess: {
    backgroundColor: COLORS.success.main,
  },
  buttonPending: {
    backgroundColor: COLORS.warning.main,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: COLORS.primary.main,
  },
  buttonCompact: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    minWidth: 90,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  buttonTextPrimary: {
    color: '#FFFFFF',
  },
  buttonTextSuccess: {
    color: '#FFFFFF',
  },
  buttonTextPending: {
    color: '#FFFFFF',
  },
  buttonTextOutline: {
    color: COLORS.primary.main,
  },
  buttonTextCompact: {
    fontSize: 13,
  },
});
