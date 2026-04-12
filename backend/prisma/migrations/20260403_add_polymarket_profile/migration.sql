CREATE TABLE IF NOT EXISTS polymarket_profiles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  account_address TEXT,
  api_address TEXT,
  funder_address TEXT,
  signature_type INTEGER,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT polymarket_profiles_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS polymarket_profiles_workspace_id_idx
  ON polymarket_profiles (workspace_id);