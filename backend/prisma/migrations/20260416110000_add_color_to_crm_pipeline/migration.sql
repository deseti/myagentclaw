-- Add color column to crm_pipelines
ALTER TABLE "crm_pipelines" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT '#2563eb';
