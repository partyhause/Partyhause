/**
 * Comments on a PartyCrew post.
 *
 * PartyCrewFeedScreen's comment button used to log to the console. It now
 * navigates here, and this screen reads and writes through the endpoints added
 * to /api/feed alongside it. Creating the route in the same change as the link
 * is deliberate: a button pointing at a route that does not exist is the exact
 * navigation defect (P7) this work is closing, and it would have been trivial
 * to introduce while fixing another instance of it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PostComment } from '@partyhause/core';
import { api } from '@/lib/client';
import { COLORS } from '@/constants/theme';

const MAX_COMMENT_LENGTH = 2000;

export default function PostCommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const router = useRouter();

  const [comments, setComments] = useState<PostComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The cursor is read through a ref so `load` does not depend on it, and so
  // the pagination guard below can check the in-flight state the state
  // spinner cannot express: isLoading is only true across the initial load,
  // so a fast scroll can fire onEndReached twice with the same cursor and
  // append the same page twice, which is a duplicate-key list.
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  const load = useCallback(
    async (reset: boolean) => {
      // A missing id must not leave the spinner running forever.
      if (!postId) {
        setError('This post could not be found.');
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      // The comments route requires auth (server/routes/feed.ts), so a
      // signed-out visitor's retry can never succeed; the message says what
      // to do instead of inviting one.
      if (!(await api.auth.isAuthenticated())) {
        setError('Sign in to read and write comments.');
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      const { data, error: apiError } = await api.feed.comments(postId, {
        limit: 20,
        // On a reset the cursor is dropped, otherwise a refresh resumes
        // mid-stream and silently hides anything posted since.
        cursor: reset ? undefined : cursorRef.current ?? undefined,
      });

      if (apiError) {
        setError('Comments could not be loaded.');
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setError(null);
      setComments((prev) => (reset ? data?.comments ?? [] : [...prev, ...(data?.comments ?? [])]));
      cursorRef.current = data?.next_cursor ?? null;
      setCursor(data?.next_cursor ?? null);
      setHasMore(Boolean(data?.next_cursor));
      setIsLoading(false);
      setIsRefreshing(false);
    },
    [postId],
  );

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    if (!hasMore || isLoading || !cursorRef.current) return;
    loadingMoreRef.current = true;
    try {
      await load(false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, isLoading, load]);

  useEffect(() => {
    void load(true);
    // Deliberately keyed on postId only. Including `load` would re-run on every
    // cursor change and refetch the first page after each page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || !postId || isSending) return;

    setIsSending(true);
    const { data, error: apiError } = await api.feed.comment(postId, body, replyTo?.id);
    setIsSending(false);

    if (apiError || !data) {
      // The draft is preserved on failure. Clearing it would destroy what the
      // user wrote to report a failure they did not cause.
      Alert.alert('Not posted', 'Your comment did not send. It is still here, try again.');
      return;
    }

    // Append rather than refetch: the server returned the created row, so the
    // list is already correct and a refetch would discard scroll position.
    setComments((prev) => [...prev, data.comment]);
    setDraft('');
    setReplyTo(null);
  };

  const renderComment = ({ item }: { item: PostComment }) => {
    const author = item.user?.display_name || item.user?.username || 'Someone';
    const isReply = Boolean(item.parent_comment_id);
    return (
      <View style={[styles.comment, isReply && styles.replyIndent]}>
        <View style={styles.commentHeader}>
          <Text style={styles.author}>{author}</Text>
          <Text style={styles.timestamp}>
            {new Date(item.created_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        </View>
        <Text style={styles.body}>{item.body}</Text>
        <TouchableOpacity
          onPress={() => setReplyTo(item)}
          accessibilityRole="button"
          accessibilityLabel={`Reply to ${author}`}
        >
          <Text style={styles.replyAction}>Reply</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Comments', headerBackTitle: 'Feed' }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
      >
        {isLoading ? (
          <ActivityIndicator style={styles.loading} size="large" color="#C02A16" />
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(c) => c.id}
            renderItem={renderComment}
            contentContainerStyle={comments.length === 0 ? styles.emptyWrap : styles.list}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={() => {
                  setIsRefreshing(true);
                  cursorRef.current = null;
                  setCursor(null);
                  void load(true);
                }}
                tintColor="#C02A16"
              />
            }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            void loadMore();
          }}
          ListFooterComponent={
            // A pagination failure is silent otherwise: the error renders only
            // in the empty component, which the list never shows once it has
            // content.
            error && comments.length > 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>{error}</Text>
                <TouchableOpacity onPress={() => void load(true)} accessibilityRole="button">
                  <Text style={styles.retry}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="chatbubble-outline" size={40} color={COLORS.neutral[400]} />
                <Text style={styles.emptyText}>
                  {error ?? 'No comments yet. Say the first thing.'}
                </Text>
                {error ? (
                  <TouchableOpacity onPress={() => void load(true)} accessibilityRole="button">
                    <Text style={styles.retry}>Try again</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            }
          />
        )}

        {replyTo ? (
          <View style={styles.replyBanner}>
            <Text style={styles.replyBannerText} numberOfLines={1}>
              Replying to {replyTo.user?.display_name || replyTo.user?.username || 'someone'}
            </Text>
            <TouchableOpacity
              onPress={() => setReplyTo(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
            >
              <Ionicons name="close" size={18} color={COLORS.neutral[600]} />
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={replyTo ? 'Write a reply' : 'Add a comment'}
            placeholderTextColor={COLORS.neutral[400]}
            multiline
            maxLength={MAX_COMMENT_LENGTH}
            accessibilityLabel={replyTo ? 'Reply text' : 'Comment text'}
          />
          <TouchableOpacity
            onPress={submit}
            disabled={!draft.trim() || isSending}
            style={[styles.send, (!draft.trim() || isSending) && styles.sendDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
            accessibilityState={{ disabled: !draft.trim() || isSending }}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loading: { marginTop: 40 },
  list: { padding: 16, paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { alignItems: 'center', gap: 10, padding: 32 },
  emptyText: { color: COLORS.neutral[600], fontSize: 15, textAlign: 'center' },
  retry: { color: '#C02A16', fontWeight: '600', fontSize: 15 },
  comment: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.neutral[100] },
  replyIndent: { paddingLeft: 24, borderLeftWidth: 2, borderLeftColor: COLORS.neutral[100] },
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  author: { fontWeight: '600', color: COLORS.neutral[800], fontSize: 15 },
  timestamp: { color: COLORS.neutral[400], fontSize: 13 },
  body: { color: COLORS.neutral[700], fontSize: 15, lineHeight: 21 },
  replyAction: { color: '#C02A16', fontSize: 13, fontWeight: '600', marginTop: 6 },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.background.secondary,
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral[200],
  },
  replyBannerText: { color: COLORS.neutral[600], fontSize: 13, flex: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.neutral[200],
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: COLORS.background.secondary,
    borderWidth: 1,
    borderColor: COLORS.neutral[300],
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: COLORS.neutral[800],
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#C02A16',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: COLORS.neutral[300] },
});
