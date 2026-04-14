-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "AppointmentScheduleStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED', 'MISSED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "AppointmentType" AS ENUM ('SALES_CALL', 'DEMO', 'CONSULTATION', 'SUPPORT', 'FOLLOW_UP', 'CUSTOM');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "AppointmentLocationType" AS ENUM ('ONLINE', 'OFFLINE', 'PHONE_CALL');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "appointment_schedules" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "appointment_type" "AppointmentType" NOT NULL,
    "status" "AppointmentScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "location_type" "AppointmentLocationType" NOT NULL,
    "meeting_link" TEXT,
    "physical_location" TEXT,
    "notes" TEXT,
    "reminder_24h_sent" BOOLEAN NOT NULL DEFAULT false,
    "reminder_1h_sent" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_availability" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_hour" TEXT NOT NULL,
    "end_hour" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_activity_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_by" TEXT NOT NULL,
    "previous_status" "AppointmentScheduleStatus",
    "new_status" "AppointmentScheduleStatus",
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_schedules_workspace_id_idx" ON "appointment_schedules"("workspace_id");

-- CreateIndex
CREATE INDEX "appointment_schedules_agent_id_idx" ON "appointment_schedules"("agent_id");

-- CreateIndex
CREATE INDEX "appointment_schedules_customer_id_idx" ON "appointment_schedules"("customer_id");

-- CreateIndex
CREATE INDEX "appointment_schedules_scheduled_at_idx" ON "appointment_schedules"("scheduled_at");

-- CreateIndex
CREATE INDEX "appointment_schedules_status_idx" ON "appointment_schedules"("status");

-- CreateIndex
CREATE INDEX "appointment_availability_workspace_id_idx" ON "appointment_availability"("workspace_id");

-- CreateIndex
CREATE INDEX "appointment_availability_agent_id_idx" ON "appointment_availability"("agent_id");

-- CreateIndex
CREATE INDEX "appointment_availability_day_of_week_idx" ON "appointment_availability"("day_of_week");

-- CreateIndex
CREATE INDEX "appointment_availability_workspace_id_agent_id_day_of_week_idx" ON "appointment_availability"("workspace_id", "agent_id", "day_of_week");

-- CreateIndex
CREATE INDEX "appointment_activity_logs_workspace_id_idx" ON "appointment_activity_logs"("workspace_id");

-- CreateIndex
CREATE INDEX "appointment_activity_logs_appointment_id_idx" ON "appointment_activity_logs"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_activity_logs_action_type_idx" ON "appointment_activity_logs"("action_type");

-- CreateIndex
CREATE INDEX "appointment_activity_logs_created_at_idx" ON "appointment_activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "appointment_activity_logs_workspace_id_appointment_id_creat_idx" ON "appointment_activity_logs"("workspace_id", "appointment_id", "created_at");

-- AddForeignKey
ALTER TABLE "appointment_schedules" ADD CONSTRAINT "appointment_schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_schedules" ADD CONSTRAINT "appointment_schedules_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_schedules" ADD CONSTRAINT "appointment_schedules_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_availability" ADD CONSTRAINT "appointment_availability_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_availability" ADD CONSTRAINT "appointment_availability_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_activity_logs" ADD CONSTRAINT "appointment_activity_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_activity_logs" ADD CONSTRAINT "appointment_activity_logs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;