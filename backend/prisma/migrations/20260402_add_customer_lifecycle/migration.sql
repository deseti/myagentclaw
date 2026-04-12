ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS customers_workspace_id_is_archived_is_blocked_idx
  ON customers (workspace_id, is_archived, is_blocked);