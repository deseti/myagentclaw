ALTER TABLE polymarket_trade_audits
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS decision_id TEXT,
  ADD COLUMN IF NOT EXISTS reason_code TEXT;

CREATE INDEX IF NOT EXISTS polymarket_trade_audits_workspace_id_source_created_at_idx
  ON polymarket_trade_audits (workspace_id, source, created_at DESC);

CREATE INDEX IF NOT EXISTS polymarket_trade_audits_workspace_id_run_id_created_at_idx
  ON polymarket_trade_audits (workspace_id, run_id, created_at DESC);