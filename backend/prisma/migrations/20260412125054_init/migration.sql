-- CreateEnum
CREATE TYPE "SubTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('ACTIVE', 'GRACE', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AgentAccessMode" AS ENUM ('OPEN_ACCESS', 'APPROVAL_REQUIRED');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('TELEGRAM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'CONNECTING');

-- CreateEnum
CREATE TYPE "KnowledgeType" AS ENUM ('FAQ', 'PRODUCT', 'INFO', 'PAYMENT', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'PROSPECT', 'WARM', 'HOT', 'CLOSED', 'LOST');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'NEEDS_ADMIN', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('CUSTOMER', 'AI', 'ADMIN');

-- CreateEnum
CREATE TYPE "AgentCustomerAccessStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "FollowUpType" AS ENUM ('FOLLOW_UP', 'PAYMENT_REMINDER', 'REACTIVATION');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentReminderType" AS ENUM ('INVOICE', 'DP', 'INSTALLMENT', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentReminderStatus" AS ENUM ('PENDING', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SUBSCRIPTION', 'TOPUP', 'ADDON');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AddOnStatus" AS ENUM ('ACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PolymarketTradeAuditAction" AS ENUM ('PREVIEW', 'PLACE_ORDER', 'CANCEL_ORDER');

-- CreateEnum
CREATE TYPE "PolymarketTradeAuditStatus" AS ENUM ('SUCCESS', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PolymarketAutopilotStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'STOPPING', 'EMERGENCY_STOP', 'ERROR');

-- CreateEnum
CREATE TYPE "PolymarketAutopilotRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_NO_ACTION', 'BLOCKED_BY_GUARDRAIL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PolymarketAutopilotDecisionType" AS ENUM ('PLACE_ORDER', 'CANCEL_ORDER', 'SKIP');

-- CreateEnum
CREATE TYPE "PolymarketAutopilotDecisionStatus" AS ENUM ('PROPOSED', 'BLOCKED', 'EXECUTED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PolymarketAutopilotAlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PolymarketAutopilotAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "owners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "sub_tier" "SubTier" NOT NULL DEFAULT 'FREE',
    "sub_status" "SubStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_profiles" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "account_address" TEXT,
    "api_address" TEXT,
    "funder_address" TEXT,
    "signature_type" INTEGER,
    "signer_address" TEXT,
    "encrypted_private_key" TEXT,
    "encrypted_api_key" TEXT,
    "encrypted_api_secret" TEXT,
    "encrypted_api_passphrase" TEXT,
    "credentials_last_verified_at" TIMESTAMP(3),
    "credentials_last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_trade_audits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "action" "PolymarketTradeAuditAction" NOT NULL,
    "status" "PolymarketTradeAuditStatus" NOT NULL,
    "market_slug" TEXT,
    "market_question" TEXT,
    "token_id" TEXT,
    "outcome_label" TEXT,
    "side" TEXT,
    "order_kind" TEXT,
    "order_type" TEXT,
    "price" DECIMAL(18,8),
    "size" DECIMAL(18,8),
    "amount" DECIMAL(18,8),
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "response_order_id" TEXT,
    "run_id" TEXT,
    "decision_id" TEXT,
    "reason_code" TEXT,
    "request_json" JSONB,
    "response_json" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_trade_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_autopilot_configs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "status" "PolymarketAutopilotStatus" NOT NULL DEFAULT 'DRAFT',
    "strategy_type" TEXT NOT NULL,
    "strategy_config_json" JSONB NOT NULL,
    "risk_config_json" JSONB NOT NULL,
    "market_scope_json" JSONB NOT NULL,
    "execution_config_json" JSONB NOT NULL,
    "last_validated_at" TIMESTAMP(3),
    "last_validation_error" TEXT,
    "last_run_at" TIMESTAMP(3),
    "paused_reason" TEXT,
    "emergency_stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_autopilot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_autopilot_runs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_id" TEXT,
    "status" "PolymarketAutopilotRunStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "snapshot_json" JSONB,
    "summary_json" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_autopilot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_autopilot_decisions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT,
    "config_id" TEXT,
    "workspace_id" TEXT NOT NULL,
    "decision_type" "PolymarketAutopilotDecisionType" NOT NULL,
    "status" "PolymarketAutopilotDecisionStatus" NOT NULL,
    "market_slug" TEXT,
    "token_id" TEXT,
    "side" TEXT,
    "payload_json" JSONB,
    "guardrail_result_json" JSONB,
    "reason_code" TEXT,
    "executed_audit_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_autopilot_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_autopilot_health_checks" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_id" TEXT,
    "trigger" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "emergency_stop_applied" BOOLEAN NOT NULL DEFAULT false,
    "report_json" JSONB NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_autopilot_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polymarket_autopilot_alerts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "config_id" TEXT,
    "severity" "PolymarketAutopilotAlertSeverity" NOT NULL,
    "status" "PolymarketAutopilotAlertStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details_json" JSONB,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "polymarket_autopilot_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona" TEXT,
    "tone" TEXT,
    "goal" TEXT,
    "llm_provider" TEXT NOT NULL DEFAULT 'openai-compatible',
    "llm_model" TEXT NOT NULL DEFAULT 'minimaxai/minimax-m2.7',
    "openclaw_skill" TEXT,
    "access_mode" "AgentAccessMode" NOT NULL DEFAULT 'OPEN_ACCESS',
    "approval_code" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL DEFAULT 'TELEGRAM',
    "phone_number" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "session_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "KnowledgeType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reference_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "name" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_at" TIMESTAMP(3),
    "last_seen" TIMESTAMP(3),
    "total_interactions" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_customer_accesses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "AgentCustomerAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "approved_at" TIMESTAMP(3),
    "last_pending_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_customer_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "channel_type" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "FollowUpType" NOT NULL,
    "message" TEXT NOT NULL,
    "notes" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "type" "PaymentReminderType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "due_date" TIMESTAMP(3) NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "status" "PaymentReminderStatus" NOT NULL DEFAULT 'PENDING',
    "template_type" "PaymentReminderType",
    "message_content" TEXT NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "tier" "SubTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "quota_limit" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "expire_date" TIMESTAMP(3) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_usage" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "month_year" TEXT NOT NULL,
    "used_messages" INTEGER NOT NULL DEFAULT 0,
    "limit_messages" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "xendit_invoice_id" TEXT,
    "xendit_payment_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "add_ons" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "status" "AddOnStatus" NOT NULL DEFAULT 'ACTIVE',
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "owners_email_key" ON "owners"("email");

-- CreateIndex
CREATE UNIQUE INDEX "polymarket_profiles_workspace_id_key" ON "polymarket_profiles"("workspace_id");

-- CreateIndex
CREATE INDEX "polymarket_trade_audits_workspace_id_created_at_idx" ON "polymarket_trade_audits"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "polymarket_trade_audits_workspace_id_action_status_idx" ON "polymarket_trade_audits"("workspace_id", "action", "status");

-- CreateIndex
CREATE UNIQUE INDEX "polymarket_autopilot_configs_workspace_id_key" ON "polymarket_autopilot_configs"("workspace_id");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_configs_owner_id_status_idx" ON "polymarket_autopilot_configs"("owner_id", "status");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_runs_workspace_id_created_at_idx" ON "polymarket_autopilot_runs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_runs_config_id_started_at_idx" ON "polymarket_autopilot_runs"("config_id", "started_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_decisions_workspace_id_created_at_idx" ON "polymarket_autopilot_decisions"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_decisions_run_id_created_at_idx" ON "polymarket_autopilot_decisions"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_decisions_workspace_id_status_decision_idx" ON "polymarket_autopilot_decisions"("workspace_id", "status", "decision_type");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_health_checks_workspace_id_checked_at_idx" ON "polymarket_autopilot_health_checks"("workspace_id", "checked_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_health_checks_config_id_checked_at_idx" ON "polymarket_autopilot_health_checks"("config_id", "checked_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_alerts_workspace_id_status_severity_la_idx" ON "polymarket_autopilot_alerts"("workspace_id", "status", "severity", "last_seen_at");

-- CreateIndex
CREATE INDEX "polymarket_autopilot_alerts_workspace_id_code_status_idx" ON "polymarket_autopilot_alerts"("workspace_id", "code", "status");

-- CreateIndex
CREATE INDEX "knowledge_bases_workspace_id_type_idx" ON "knowledge_bases"("workspace_id", "type");

-- CreateIndex
CREATE INDEX "customers_workspace_id_idx" ON "customers"("workspace_id");

-- CreateIndex
CREATE INDEX "customers_workspace_id_is_archived_is_blocked_idx" ON "customers"("workspace_id", "is_archived", "is_blocked");

-- CreateIndex
CREATE UNIQUE INDEX "customers_workspace_id_phone_number_key" ON "customers"("workspace_id", "phone_number");

-- CreateIndex
CREATE INDEX "agent_customer_accesses_workspace_id_status_idx" ON "agent_customer_accesses"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "agent_customer_accesses_customer_id_status_idx" ON "agent_customer_accesses"("customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_customer_accesses_agent_id_customer_id_key" ON "agent_customer_accesses"("agent_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_customer_id_key" ON "leads"("customer_id");

-- CreateIndex
CREATE INDEX "leads_workspace_id_status_idx" ON "leads"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "conversations_customer_id_status_idx" ON "conversations"("customer_id", "status");

-- CreateIndex
CREATE INDEX "conversations_agent_id_idx" ON "conversations"("agent_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "follow_ups_workspace_id_status_scheduled_at_idx" ON "follow_ups"("workspace_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "payment_reminders_workspace_id_status_scheduled_at_idx" ON "payment_reminders"("workspace_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "payment_reminders_workspace_id_due_date_idx" ON "payment_reminders"("workspace_id", "due_date");

-- CreateIndex
CREATE INDEX "payment_reminders_workspace_id_customer_id_idx" ON "payment_reminders"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "payment_reminders_workspace_id_agent_id_idx" ON "payment_reminders"("workspace_id", "agent_id");

-- CreateIndex
CREATE INDEX "payment_reminders_conversation_id_idx" ON "payment_reminders"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_workspace_id_key" ON "subscriptions"("workspace_id");

-- CreateIndex
CREATE INDEX "quota_usage_workspace_id_month_year_idx" ON "quota_usage"("workspace_id", "month_year");

-- CreateIndex
CREATE UNIQUE INDEX "quota_usage_workspace_id_month_year_key" ON "quota_usage"("workspace_id", "month_year");

-- CreateIndex
CREATE INDEX "transactions_workspace_id_status_idx" ON "transactions"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "add_ons_workspace_id_status_idx" ON "add_ons"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_workspace_id_idx" ON "admin_users"("workspace_id");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_profiles" ADD CONSTRAINT "polymarket_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_trade_audits" ADD CONSTRAINT "polymarket_trade_audits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_configs" ADD CONSTRAINT "polymarket_autopilot_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_runs" ADD CONSTRAINT "polymarket_autopilot_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_runs" ADD CONSTRAINT "polymarket_autopilot_runs_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "polymarket_autopilot_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_decisions" ADD CONSTRAINT "polymarket_autopilot_decisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_decisions" ADD CONSTRAINT "polymarket_autopilot_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "polymarket_autopilot_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_decisions" ADD CONSTRAINT "polymarket_autopilot_decisions_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "polymarket_autopilot_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_health_checks" ADD CONSTRAINT "polymarket_autopilot_health_checks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_health_checks" ADD CONSTRAINT "polymarket_autopilot_health_checks_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "polymarket_autopilot_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_alerts" ADD CONSTRAINT "polymarket_autopilot_alerts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polymarket_autopilot_alerts" ADD CONSTRAINT "polymarket_autopilot_alerts_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "polymarket_autopilot_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_accesses" ADD CONSTRAINT "agent_customer_accesses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_accesses" ADD CONSTRAINT "agent_customer_accesses_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_accesses" ADD CONSTRAINT "agent_customer_accesses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "add_ons" ADD CONSTRAINT "add_ons_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
