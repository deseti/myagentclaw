CREATE TYPE "AnalyticsWindow" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ROLLING_7_DAYS', 'ROLLING_30_DAYS');

CREATE TABLE "analytics_metric_snapshots" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "agent_id" TEXT,
  "scope_key" TEXT NOT NULL,
  "metric_type" TEXT NOT NULL,
  "metric_value" DECIMAL(18,4) NOT NULL,
  "metric_date" TIMESTAMP(3) NOT NULL,
  "skill_type" TEXT,
  "window" "AnalyticsWindow" NOT NULL DEFAULT 'DAILY',
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "analytics_metric_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_summary_caches" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "agent_id" TEXT,
  "scope_key" TEXT NOT NULL,
  "cache_key" TEXT NOT NULL,
  "skill_type" TEXT,
  "window" "AnalyticsWindow" NOT NULL DEFAULT 'DAILY',
  "range_start" TIMESTAMP(3) NOT NULL,
  "range_end" TIMESTAMP(3) NOT NULL,
  "summary_json" JSONB NOT NULL,
  "last_computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "analytics_summary_caches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analytics_metric_snapshots_workspace_id_scope_key_metric_type_met_key"
ON "analytics_metric_snapshots"("workspace_id", "scope_key", "metric_type", "metric_date", "window");

CREATE INDEX "analytics_metric_snapshots_workspace_id_metric_date_idx"
ON "analytics_metric_snapshots"("workspace_id", "metric_date");

CREATE INDEX "analytics_metric_snapshots_workspace_id_metric_type_window_idx"
ON "analytics_metric_snapshots"("workspace_id", "metric_type", "window");

CREATE INDEX "analytics_metric_snapshots_workspace_id_agent_id_metric_date_idx"
ON "analytics_metric_snapshots"("workspace_id", "agent_id", "metric_date");

CREATE INDEX "analytics_metric_snapshots_workspace_id_skill_type_metric_date_idx"
ON "analytics_metric_snapshots"("workspace_id", "skill_type", "metric_date");

CREATE UNIQUE INDEX "analytics_summary_caches_workspace_id_scope_key_cache_key_windo_key"
ON "analytics_summary_caches"("workspace_id", "scope_key", "cache_key", "window", "range_start", "range_end");

CREATE INDEX "analytics_summary_caches_workspace_id_cache_key_updated_at_idx"
ON "analytics_summary_caches"("workspace_id", "cache_key", "updated_at");

CREATE INDEX "analytics_summary_caches_workspace_id_skill_type_updated_at_idx"
ON "analytics_summary_caches"("workspace_id", "skill_type", "updated_at");

ALTER TABLE "analytics_metric_snapshots"
ADD CONSTRAINT "analytics_metric_snapshots_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "analytics_metric_snapshots"
ADD CONSTRAINT "analytics_metric_snapshots_agent_id_fkey"
FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "analytics_summary_caches"
ADD CONSTRAINT "analytics_summary_caches_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;