/**
 * The partyboard — event planning operations room.
 *
 * Wraps `/api/partyboard/*` so both clients reach the board through one
 * typed surface instead of hand-rolled fetch calls. The web app previously
 * called `/api/partyboard/*` at 7 sites with no typed client; this resource
 * closes that gap.
 *
 * WHAT IS NOT HERE YET
 *   `POST /api/partyboard/stickies/:id/convert-to-task` accepts optional
 *   `due_date`, `priority`, `description`, `assignee_id` from the migration
 *   `20261112000000_partyboard_operations_room`. Those fields are exposed in
 *   `CreateTaskInput` below.
 */

import type { Transport, ApiResponse } from '../http/transport';

/** A sticky on the board, as returned by GET /api/partyboard/stickies. */
export interface PartyBoardSticky {
  id: string;
  session_id: string | null;
  event_id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation?: number;
  z_index: number;
  category?: string | null;
  reaction_count: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at?: string;
  data: Record<string, unknown>;
}

/** A task on the board, as returned by GET /api/partyboard/tasks. */
export interface PartyBoardTask {
  id: string;
  event_id: string;
  sticky_id: string;
  title: string;
  estimated_cost: number | null;
  actual_cost: number | null;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_id: string | null;
  description: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  completed_at: string | null;
}

/** Input for creating a sticky. */
export interface CreateStickyInput {
  event_id: string;
  session_id?: string | null;
  type: 'note' | 'idea' | 'checklist' | 'link' | 'cost' | 'image';
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  category?: string | null;
  data: Record<string, unknown>;
  rotation?: number | null;
  z_index?: number | null;
}

/** Input for updating a sticky's position. */
export interface UpdateStickyPositionInput {
  sticky_id: string;
  position: { x: number; y: number };
}

/** Input for converting an idea sticky to a task. */
export interface ConvertToTaskInput {
  due_date?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical' | null;
  description?: string | null;
  assignee_id?: string | null;
}

export interface PartyBoardResource {
  /** List stickies for an event, optionally filtered by session. */
  listStickies(
    eventId: string,
    sessionId?: string | null,
  ): Promise<ApiResponse<{ stickies: PartyBoardSticky[] }>>;

  /** Create a sticky on the board. */
  createSticky(input: CreateStickyInput): Promise<ApiResponse<{ sticky: PartyBoardSticky }>>;

  /** Drag a sticky to a new position. */
  updateStickyPosition(input: UpdateStickyPositionInput): Promise<ApiResponse<unknown>>;

  /** Toggle the caller's vote on an idea sticky. */
  voteOnSticky(stickyId: string): Promise<ApiResponse<unknown>>;

  /** Convert an idea sticky into a committed task. */
  convertToTask(
    stickyId: string,
    input?: ConvertToTaskInput,
  ): Promise<ApiResponse<{ task_id: string; status: string }>>;

  /** Delete a sticky. */
  deleteSticky(stickyId: string): Promise<ApiResponse<unknown>>;

  /** List tasks for an event. Includes due_date, priority, assignee, costs. */
  listTasks(eventId: string): Promise<ApiResponse<{ tasks: PartyBoardTask[] }>>;

  /** Budget rollup for an event: estimated vs actual cost across all tasks. */
  getBudget(eventId: string): Promise<ApiResponse<{
    estimated_total: number;
    actual_total: number;
    task_count: number;
    open_count: number;
    done_count: number;
  }>>;
}

export function createPartyBoardResource(t: Transport): PartyBoardResource {
  const getBudget = async (eventId: string) => {
    const result = await t.request<{ tasks: PartyBoardTask[] }>(
      `/api/partyboard/tasks?event_id=${eventId}`,
      { method: 'GET' },
    );
    if (result.error) return { data: null, error: result.error };

    const tasks = result.data?.tasks ?? [];
    const estimated_total = tasks.reduce(
      (sum, t) => sum + (t.estimated_cost ?? 0),
      0,
    );
    const actual_total = tasks.reduce(
      (sum, t) => sum + (t.actual_cost ?? 0),
      0,
    );
    const open_count = tasks.filter((t) => t.status === 'open').length;
    const done_count = tasks.filter((t) => t.status === 'done').length;

    return {
      data: {
        estimated_total,
        actual_total,
        task_count: tasks.length,
        open_count,
        done_count,
      },
      error: null,
    };
  };

  return {
    listStickies: (eventId, sessionId) => {
      const params = new URLSearchParams({ event_id: eventId });
      if (sessionId) params.append('session_id', sessionId);
      return t.request<{ stickies: PartyBoardSticky[] }>(
        `/api/partyboard/stickies/?${params.toString()}`,
        { method: 'GET' },
      );
    },

    createSticky: (input) =>
      t.request<{ sticky: PartyBoardSticky }>('/api/partyboard/stickies/', {
        method: 'POST',
        body: input,
      }),

    updateStickyPosition: (input) =>
      t.request<unknown>(
        `/api/partyboard/stickies/${input.sticky_id}/position`,
        { method: 'PATCH', body: { position: input.position } },
      ),

    voteOnSticky: (stickyId) =>
      t.request<unknown>(
        `/api/partyboard/stickies/${stickyId}/vote`,
        { method: 'PATCH' },
      ),

    convertToTask: (stickyId, input) =>
      t.request<{ task_id: string; status: string }>(
        `/api/partyboard/stickies/${stickyId}/convert-to-task`,
        { method: 'POST', body: input ?? {} },
      ),

    deleteSticky: (stickyId) =>
      t.request<unknown>(`/api/partyboard/stickies/${stickyId}`, {
        method: 'DELETE',
      }),

    listTasks: (eventId) =>
      t.request<{ tasks: PartyBoardTask[] }>(
        `/api/partyboard/tasks?event_id=${eventId}`,
        { method: 'GET' },
      ),

    getBudget,
  };
}
