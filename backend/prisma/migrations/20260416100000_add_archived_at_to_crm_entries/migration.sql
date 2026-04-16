-- Add archived_at column to crm_customer_pipeline_entries if not exists
ALTER TABLE "crm_customer_pipeline_entries" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
