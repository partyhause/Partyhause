-- PartyBoard: operations room upgrade.
--
-- Turns board tasks from a promoted-idea stub into a real action tracker:
-- due dates, assignees, priority, actual cost, description.
--
-- Every column is nullable except where a default keeps existing rows valid,
-- so the migration is lossless against a populated production database.
-- `status` keeps its CHECK ('open','done'); `priority` gains its own CHECK.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. New columns on partyboard_tasks.
-- ---------------------------------------------------------------------------

ALTER TABLE public.partyboard_tasks
    ADD COLUMN IF NOT EXISTS "due_date" timestamptz,
    ADD COLUMN IF NOT EXISTS "assignee_id" text,
    ADD COLUMN IF NOT EXISTS "priority" text NOT NULL DEFAULT 'medium',
    ADD COLUMN IF NOT EXISTS "actual_cost" decimal(10,2),
    ADD COLUMN IF NOT EXISTS "description" text;

-- ---------------------------------------------------------------------------
-- 2. Check constraints.
-- ---------------------------------------------------------------------------

-- Priority is a closed vocabulary. DEFAULT 'medium' means every existing row
-- already satisfies the constraint, so no backfill is needed.
ALTER TABLE public.partyboard_tasks
    ADD CONSTRAINT partyboard_tasks_priority_check
    CHECK ("priority" IN ('low', 'medium', 'high', 'critical'));

-- ---------------------------------------------------------------------------
-- 3. Indexes.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS "partyboard_tasks_due_date_idx"
    ON public.partyboard_tasks("due_date");

CREATE INDEX IF NOT EXISTS "partyboard_tasks_assignee_id_idx"
    ON public.partyboard_tasks("assignee_id");

COMMIT;
