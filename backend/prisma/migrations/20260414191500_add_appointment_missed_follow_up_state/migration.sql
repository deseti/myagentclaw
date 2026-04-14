ALTER TABLE "appointment_schedules"
ADD COLUMN IF NOT EXISTS "missed_follow_up_sent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "appointment_schedules"
ADD COLUMN IF NOT EXISTS "missed_follow_up_sent_at" TIMESTAMP(3);

ALTER TABLE "appointment_schedules"
ADD COLUMN IF NOT EXISTS "missed_follow_up_locked_at" TIMESTAMP(3);