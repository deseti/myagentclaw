DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentAccessMode') THEN
    CREATE TYPE "AgentAccessMode" AS ENUM ('OPEN_ACCESS', 'APPROVAL_REQUIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentCustomerAccessStatus') THEN
    CREATE TYPE "AgentCustomerAccessStatus" AS ENUM ('PENDING', 'ACTIVE');
  END IF;
END $$;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS access_mode "AgentAccessMode" NOT NULL DEFAULT 'OPEN_ACCESS',
  ADD COLUMN IF NOT EXISTS approval_code TEXT;

UPDATE agents
SET approval_code = SUBSTRING(UPPER(MD5(id || COALESCE(name, '') || clock_timestamp()::text)) FROM 1 FOR 8)
WHERE approval_code IS NULL;

CREATE TABLE IF NOT EXISTS agent_customer_accesses (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status "AgentCustomerAccessStatus" NOT NULL DEFAULT 'ACTIVE',
  approved_at TIMESTAMP(3),
  last_pending_at TIMESTAMP(3),
  last_message_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT agent_customer_accesses_pkey PRIMARY KEY (id),
  CONSTRAINT agent_customer_accesses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT agent_customer_accesses_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT agent_customer_accesses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_customer_accesses_agent_id_customer_id_key
  ON agent_customer_accesses (agent_id, customer_id);

CREATE INDEX IF NOT EXISTS agent_customer_accesses_workspace_id_status_idx
  ON agent_customer_accesses (workspace_id, status);

CREATE INDEX IF NOT EXISTS agent_customer_accesses_customer_id_status_idx
  ON agent_customer_accesses (customer_id, status);

INSERT INTO agent_customer_accesses (
  id,
  workspace_id,
  agent_id,
  customer_id,
  status,
  approved_at,
  last_message_at,
  created_at,
  updated_at
)
SELECT
  MD5(c.agent_id || ':' || c.customer_id || ':' || clock_timestamp()::text),
  a.workspace_id,
  c.agent_id,
  c.customer_id,
  'ACTIVE'::"AgentCustomerAccessStatus",
  CURRENT_TIMESTAMP,
  COALESCE(MAX(m.created_at), MAX(c.created_at), CURRENT_TIMESTAMP),
  COALESCE(MIN(c.created_at), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM conversations c
JOIN agents a ON a.id = c.agent_id
LEFT JOIN messages m ON m.conversation_id = c.id
GROUP BY a.workspace_id, c.agent_id, c.customer_id
ON CONFLICT (agent_id, customer_id) DO NOTHING;
