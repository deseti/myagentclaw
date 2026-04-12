DO $$ BEGIN
  CREATE TYPE "PolymarketAutopilotAlertSeverity" AS ENUM ('WARNING', 'CRITICAL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "PolymarketAutopilotAlertStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS polymarket_autopilot_health_checks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  config_id TEXT,
  trigger TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  emergency_stop_applied BOOLEAN NOT NULL DEFAULT FALSE,
  report_json JSONB NOT NULL,
  checked_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT polymarket_autopilot_health_checks_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT polymarket_autopilot_health_checks_config_id_fkey
    FOREIGN KEY (config_id) REFERENCES polymarket_autopilot_configs(id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS polymarket_autopilot_health_checks_workspace_id_checked_at_idx
  ON polymarket_autopilot_health_checks (workspace_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS polymarket_autopilot_health_checks_config_id_checked_at_idx
  ON polymarket_autopilot_health_checks (config_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS polymarket_autopilot_alerts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  config_id TEXT,
  severity "PolymarketAutopilotAlertSeverity" NOT NULL,
  status "PolymarketAutopilotAlertStatus" NOT NULL DEFAULT 'OPEN',
  source TEXT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json JSONB,
  first_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP(3),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT polymarket_autopilot_alerts_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT polymarket_autopilot_alerts_config_id_fkey
    FOREIGN KEY (config_id) REFERENCES polymarket_autopilot_configs(id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS polymarket_autopilot_alerts_workspace_id_status_severity_last_seen_at_idx
  ON polymarket_autopilot_alerts (workspace_id, status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS polymarket_autopilot_alerts_workspace_id_code_status_idx
  ON polymarket_autopilot_alerts (workspace_id, code, status);