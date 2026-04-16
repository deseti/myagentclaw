-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "BroadcastCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "BroadcastCampaignRecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "customers"
ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "broadcast_campaigns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "assigned_agent_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "message_template" TEXT NOT NULL,
    "channel_type" "ChannelType" NOT NULL,
    "status" "BroadcastCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "audience_preview_count" INTEGER NOT NULL DEFAULT 0,
    "total_audience" INTEGER NOT NULL DEFAULT 0,
    "total_sent" INTEGER NOT NULL DEFAULT 0,
    "total_delivered" INTEGER NOT NULL DEFAULT 0,
    "total_failed" INTEGER NOT NULL DEFAULT 0,
    "total_skipped" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_campaign_audiences" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "filter_type" TEXT NOT NULL,
    "include_mode" TEXT NOT NULL DEFAULT 'INCLUDE',
    "operator" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "value_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_campaign_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_campaign_recipients" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel_session_id" TEXT,
    "recipient_status" "BroadcastCampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tags_idx" ON "customers" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_idx" ON "broadcast_campaigns"("workspace_id");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_status_idx" ON "broadcast_campaigns"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_scheduled_at_idx" ON "broadcast_campaigns"("workspace_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_assigned_agent_id_idx" ON "broadcast_campaigns"("workspace_id", "assigned_agent_id");

-- CreateIndex
CREATE INDEX "broadcast_campaigns_workspace_id_channel_type_idx" ON "broadcast_campaigns"("workspace_id", "channel_type");

-- CreateIndex
CREATE INDEX "broadcast_campaign_audiences_workspace_id_idx" ON "broadcast_campaign_audiences"("workspace_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_audiences_campaign_id_idx" ON "broadcast_campaign_audiences"("campaign_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_audiences_workspace_id_campaign_id_posit_idx" ON "broadcast_campaign_audiences"("workspace_id", "campaign_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_campaign_recipients_campaign_id_customer_id_key" ON "broadcast_campaign_recipients"("campaign_id", "customer_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_recipients_workspace_id_idx" ON "broadcast_campaign_recipients"("workspace_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_recipients_campaign_id_idx" ON "broadcast_campaign_recipients"("campaign_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_recipients_customer_id_idx" ON "broadcast_campaign_recipients"("customer_id");

-- CreateIndex
CREATE INDEX "broadcast_campaign_recipients_workspace_id_campaign_id_rec_idx" ON "broadcast_campaign_recipients"("workspace_id", "campaign_id", "recipient_status");

-- CreateIndex
CREATE INDEX "broadcast_campaign_recipients_channel_session_id_idx" ON "broadcast_campaign_recipients"("channel_session_id");

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaigns" ADD CONSTRAINT "broadcast_campaigns_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaign_audiences" ADD CONSTRAINT "broadcast_campaign_audiences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaign_audiences" ADD CONSTRAINT "broadcast_campaign_audiences_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "broadcast_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_campaign_recipients" ADD CONSTRAINT "broadcast_campaign_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;