DO $$ BEGIN
  CREATE TYPE "PolymarketTradeAuditAction" AS ENUM ('PREVIEW', 'PLACE_ORDER', 'CANCEL_ORDER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PolymarketTradeAuditStatus" AS ENUM ('SUCCESS', 'FAILED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS polymarket_trade_audits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  action "PolymarketTradeAuditAction" NOT NULL,
  status "PolymarketTradeAuditStatus" NOT NULL,
  market_slug TEXT,
  market_question TEXT,
  token_id TEXT,
  outcome_label TEXT,
  side TEXT,
  order_kind TEXT,
  order_type TEXT,
  price DECIMAL(18, 8),
  size DECIMAL(18, 8),
  amount DECIMAL(18, 8),
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  response_order_id TEXT,
  request_json JSONB,
  response_json JSONB,
  error_message TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT polymarket_trade_audits_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS polymarket_trade_audits_workspace_id_created_at_idx
  ON polymarket_trade_audits (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS polymarket_trade_audits_workspace_id_action_status_idx
  ON polymarket_trade_audits (workspace_id, action, status);