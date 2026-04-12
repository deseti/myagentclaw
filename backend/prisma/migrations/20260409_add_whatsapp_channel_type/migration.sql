DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum enum_value
    JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
    WHERE enum_type.typname = 'ChannelType'
      AND enum_value.enumlabel = 'WHATSAPP'
  ) THEN
    ALTER TYPE "ChannelType" ADD VALUE 'WHATSAPP';
  END IF;
END $$;
