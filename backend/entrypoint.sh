#!/bin/sh
# =============================================================================
# backend/entrypoint.sh
# Tunggu PostgreSQL siap → jalankan prisma migrate → start app
# =============================================================================
set -e

echo "[entrypoint] Starting myagentclaw backend..."

build_database_url() {
  node <<'NODE'
const stripTrailingCr = (value) => String(value || '').replace(/\r$/, '');
const normalizeValue = (value) => stripTrailingCr(value).trim();

const user = normalizeValue(process.env.POSTGRES_USER);
const password = stripTrailingCr(process.env.POSTGRES_PASSWORD);
const host = normalizeValue(process.env.POSTGRES_HOST || 'postgres') || 'postgres';
const port = normalizeValue(process.env.POSTGRES_PORT || '5432') || '5432';
const database = normalizeValue(process.env.POSTGRES_DB);
const fallbackUrl = normalizeValue(process.env.DATABASE_URL);

if (!user || !database) {
  if (fallbackUrl) {
    process.stdout.write(fallbackUrl);
    process.exit(0);
  }

  process.stderr.write('[entrypoint] ERROR: POSTGRES_USER/POSTGRES_DB atau DATABASE_URL wajib diisi.\n');
  process.exit(1);
}

const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
process.stdout.write(`postgresql://${auth}@${host}:${port}/${encodeURIComponent(database)}?schema=public`);
NODE
}

if [ -n "${POSTGRES_USER:-}" ] || [ -n "${POSTGRES_DB:-}" ]; then
  export DATABASE_URL="$(build_database_url)"
fi

DB_HOST=${POSTGRES_HOST:-postgres}
DB_PORT=${POSTGRES_PORT:-5432}

# ---------------------------------------------------------------------------
# Tunggu PostgreSQL siap menerima koneksi
# Gunakan host/port terpisah agar aman meski credential mengandung karakter URL reserved
# ---------------------------------------------------------------------------
echo "[entrypoint] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."

MAX_RETRIES=30
RETRY=0

until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "[entrypoint] ERROR: PostgreSQL tidak siap setelah ${MAX_RETRIES} percobaan. Abort."
    exit 1
  fi
  echo "[entrypoint] PostgreSQL belum siap, tunggu 2s... (${RETRY}/${MAX_RETRIES})"
  sleep 2
done

echo "[entrypoint] PostgreSQL siap!"

# ---------------------------------------------------------------------------
# Jalankan Prisma schema sync
# Jika ada folder migrations → pakai migrate deploy (production)
# Jika belum ada               → pakai db push (local dev / first run)
# ---------------------------------------------------------------------------
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] Running prisma migrate deploy..."
  set +e
  MIGRATE_OUTPUT=$(npx prisma migrate deploy 2>&1)
  MIGRATE_EXIT=$?
  set -e

  echo "$MIGRATE_OUTPUT"

  if [ $MIGRATE_EXIT -ne 0 ]; then
    case "$MIGRATE_OUTPUT" in
      *P3005*)
        echo "[entrypoint] Existing schema detected without Prisma baseline. Falling back to prisma db push..."
        npx prisma db push
        ;;
      *)
        echo "[entrypoint] Prisma migrate deploy failed. Abort."
        exit $MIGRATE_EXIT
        ;;
    esac
  fi
else
  echo "[entrypoint] No migrations found, running prisma db push (dev mode)..."
  npx prisma db push
fi

echo "[entrypoint] Schema sync selesai!"

# ---------------------------------------------------------------------------
# Start aplikasi
# ---------------------------------------------------------------------------
echo "[entrypoint] Starting node src/index.js..."
exec node src/index.js
