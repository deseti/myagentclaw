-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "CrmPipelinePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "CrmPipelineActivityType" AS ENUM (
      'CREATED',
      'STAGE_CHANGED',
      'NOTE_ADDED',
      'APPOINTMENT_CREATED',
      'APPOINTMENT_COMPLETED',
      'PAYMENT_SENT',
      'PAYMENT_COMPLETED',
      'LOST',
      'WON',
      'ASSIGNED_AGENT_CHANGED'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "crm_pipelines" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL,
    "probability_percent" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_closed_won" BOOLEAN NOT NULL DEFAULT false,
    "is_closed_lost" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customer_pipeline_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "assigned_agent_id" TEXT,
    "title" TEXT NOT NULL,
    "value_amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "priority" "CrmPipelinePriority" NOT NULL DEFAULT 'MEDIUM',
    "expected_close_date" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "source" TEXT,
    "lost_reason" TEXT,
    "notes" TEXT,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_customer_pipeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_activities" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_pipeline_entry_id" TEXT NOT NULL,
    "type" "CrmPipelineActivityType" NOT NULL,
    "previous_stage_id" TEXT,
    "new_stage_id" TEXT,
    "note" TEXT,
    "metadata_json" JSONB,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_pipeline_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_pipeline_notes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_pipeline_entry_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_pipeline_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipelines_workspace_id_name_key" ON "crm_pipelines"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "crm_pipelines_workspace_id_idx" ON "crm_pipelines"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_pipelines_workspace_id_is_active_idx" ON "crm_pipelines"("workspace_id", "is_active");

-- CreateIndex
CREATE INDEX "crm_pipelines_workspace_id_is_default_idx" ON "crm_pipelines"("workspace_id", "is_default");

-- CreateIndex
CREATE UNIQUE INDEX "crm_pipeline_stages_pipeline_id_position_key" ON "crm_pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_pipeline_id_idx" ON "crm_pipeline_stages"("pipeline_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_stages_pipeline_id_position_idx" ON "crm_pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_workspace_id_idx" ON "crm_customer_pipeline_entries"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_customer_id_idx" ON "crm_customer_pipeline_entries"("customer_id");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_stage_id_idx" ON "crm_customer_pipeline_entries"("stage_id");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_assigned_agent_id_idx" ON "crm_customer_pipeline_entries"("assigned_agent_id");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_last_activity_at_idx" ON "crm_customer_pipeline_entries"("last_activity_at");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_expected_close_date_idx" ON "crm_customer_pipeline_entries"("expected_close_date");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_workspace_id_pipeline_id_is_ar_idx" ON "crm_customer_pipeline_entries"("workspace_id", "pipeline_id", "is_archived");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_workspace_id_stage_id_is_arc_idx" ON "crm_customer_pipeline_entries"("workspace_id", "stage_id", "is_archived");

-- CreateIndex
CREATE INDEX "crm_customer_pipeline_entries_workspace_id_customer_id_idx" ON "crm_customer_pipeline_entries"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_activities_workspace_id_idx" ON "crm_pipeline_activities"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_activities_customer_pipeline_entry_id_idx" ON "crm_pipeline_activities"("customer_pipeline_entry_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_activities_created_at_idx" ON "crm_pipeline_activities"("created_at");

-- CreateIndex
CREATE INDEX "crm_pipeline_activities_workspace_id_customer_pipeline_entr_idx" ON "crm_pipeline_activities"("workspace_id", "customer_pipeline_entry_id", "created_at");

-- CreateIndex
CREATE INDEX "crm_pipeline_notes_workspace_id_idx" ON "crm_pipeline_notes"("workspace_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_notes_customer_pipeline_entry_id_idx" ON "crm_pipeline_notes"("customer_pipeline_entry_id");

-- CreateIndex
CREATE INDEX "crm_pipeline_notes_workspace_id_customer_pipeline_entry_i_idx" ON "crm_pipeline_notes"("workspace_id", "customer_pipeline_entry_id", "created_at");

-- AddForeignKey
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customer_pipeline_entries" ADD CONSTRAINT "crm_customer_pipeline_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customer_pipeline_entries" ADD CONSTRAINT "crm_customer_pipeline_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customer_pipeline_entries" ADD CONSTRAINT "crm_customer_pipeline_entries_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "crm_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customer_pipeline_entries" ADD CONSTRAINT "crm_customer_pipeline_entries_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customer_pipeline_entries" ADD CONSTRAINT "crm_customer_pipeline_entries_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_activities" ADD CONSTRAINT "crm_pipeline_activities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_activities" ADD CONSTRAINT "crm_pipeline_activities_customer_pipeline_entry_id_fkey" FOREIGN KEY ("customer_pipeline_entry_id") REFERENCES "crm_customer_pipeline_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_activities" ADD CONSTRAINT "crm_pipeline_activities_previous_stage_id_fkey" FOREIGN KEY ("previous_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_activities" ADD CONSTRAINT "crm_pipeline_activities_new_stage_id_fkey" FOREIGN KEY ("new_stage_id") REFERENCES "crm_pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_activities" ADD CONSTRAINT "crm_pipeline_activities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_notes" ADD CONSTRAINT "crm_pipeline_notes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_notes" ADD CONSTRAINT "crm_pipeline_notes_customer_pipeline_entry_id_fkey" FOREIGN KEY ("customer_pipeline_entry_id") REFERENCES "crm_customer_pipeline_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_pipeline_notes" ADD CONSTRAINT "crm_pipeline_notes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "owners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default pipeline for existing workspaces
INSERT INTO "crm_pipelines" (
    "id",
    "workspace_id",
    "name",
    "description",
    "is_default",
    "is_active",
    "created_at",
    "updated_at"
)
SELECT
    CONCAT('crm_default_pipeline_', w."id"),
    w."id",
    'Sales Pipeline',
    'Default sales pipeline for qualifying, following up, and closing leads.',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "workspaces" w
WHERE NOT EXISTS (
    SELECT 1
    FROM "crm_pipelines" cp
    WHERE cp."workspace_id" = w."id"
);

INSERT INTO "crm_pipeline_stages" (
    "id",
    "pipeline_id",
    "name",
    "description",
    "color",
    "position",
    "probability_percent",
    "is_default",
    "is_closed_won",
    "is_closed_lost",
    "created_at",
    "updated_at"
)
SELECT
    CONCAT('crm_default_stage_1_', cp."workspace_id"),
    cp."id",
    'New Lead',
    'Prospek baru yang belum dihubungi.',
    '#2563eb',
    1,
    10,
    true,
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id")
UNION ALL
SELECT
    CONCAT('crm_default_stage_2_', cp."workspace_id"),
    cp."id",
    'Contacted',
    'Lead sudah dihubungi dan menunggu tindak lanjut berikutnya.',
    '#0891b2',
    2,
    25,
    true,
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id")
UNION ALL
SELECT
    CONCAT('crm_default_stage_3_', cp."workspace_id"),
    cp."id",
    'Follow Up',
    'Lead sedang berada dalam proses follow-up aktif.',
    '#f59e0b',
    3,
    45,
    true,
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id")
UNION ALL
SELECT
    CONCAT('crm_default_stage_4_', cp."workspace_id"),
    cp."id",
    'Appointment Scheduled',
    'Lead sudah memiliki appointment aktif dengan agent.',
    '#8b5cf6',
    4,
    60,
    true,
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id")
UNION ALL
SELECT
    CONCAT('crm_default_stage_5_', cp."workspace_id"),
    cp."id",
    'Waiting Payment',
    'Lead menunggu pembayaran atau invoice diselesaikan.',
    '#f97316',
    5,
    80,
    true,
    false,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id")
UNION ALL
SELECT
    CONCAT('crm_default_stage_6_', cp."workspace_id"),
    cp."id",
    'Won',
    'Deal berhasil ditutup.',
    '#16a34a',
    6,
    100,
    true,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id")
UNION ALL
SELECT
    CONCAT('crm_default_stage_7_', cp."workspace_id"),
    cp."id",
    'Lost',
    'Lead tidak berhasil dikonversi.',
    '#dc2626',
    7,
    0,
    true,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "crm_pipelines" cp
WHERE cp."is_default" = true
AND NOT EXISTS (SELECT 1 FROM "crm_pipeline_stages" s WHERE s."pipeline_id" = cp."id");