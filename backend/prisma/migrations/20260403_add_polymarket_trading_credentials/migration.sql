ALTER TABLE polymarket_profiles
  ADD COLUMN IF NOT EXISTS signer_address TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_api_key TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_api_secret TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_api_passphrase TEXT,
  ADD COLUMN IF NOT EXISTS credentials_last_verified_at TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS credentials_last_error TEXT;