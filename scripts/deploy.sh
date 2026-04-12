#!/bin/bash
# =============================================================================
# myagentclaw Deploy Script
# Jalankan dari root project: bash scripts/deploy.sh
# =============================================================================
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║      myagentclaw Deploy Script           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Warna output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_ok()   { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
log_step() { echo -e "\n${YELLOW}>>> $1${NC}"; }

# ---------------------------------------------------------------------------
# 1. Cek dependency
# ---------------------------------------------------------------------------
log_step "1. Checking dependencies"

command -v docker   >/dev/null 2>&1 || log_err "Docker tidak terinstall"
command -v git      >/dev/null 2>&1 || log_err "Git tidak terinstall"
log_ok "docker dan git tersedia"

# ---------------------------------------------------------------------------
# 2. Pull latest code dari Git
# ---------------------------------------------------------------------------
log_step "2. Pulling latest code"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
log_ok "Current branch: $CURRENT_BRANCH"

git pull origin "$CURRENT_BRANCH" || log_err "git pull gagal. Periksa koneksi atau konflik."
log_ok "Code up to date"

# ---------------------------------------------------------------------------
# 3. Cek .env
# ---------------------------------------------------------------------------
log_step "3. Checking .env file"

if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo ""
        log_warn "⚠ File .env belum ada — .env.example telah dicopy ke .env"
        log_warn "  WAJIB edit .env dengan nilai production sebelum melanjutkan!"
        echo ""
        read -p "  Tekan ENTER jika sudah siap, atau Ctrl+C untuk batalkan deploy... "
    else
        log_err ".env dan .env.example tidak ditemukan. Buat file .env terlebih dahulu."
    fi
fi

# Cek variabel wajib
check_env() {
    if ! grep -q "^${1}=" .env || grep -q "^${1}=your_" .env || grep -q "^${1}=$" .env; then
        log_warn ".env: $1 tampaknya belum diisi"
    else
        log_ok ".env: $1 OK"
    fi
}

check_env "POSTGRES_PASSWORD"
check_env "JWT_SECRET"
check_env "INTERNAL_SECRET_KEY"
check_env "XENDIT_SECRET_KEY"

# ---------------------------------------------------------------------------
# 4. Build Docker images
# ---------------------------------------------------------------------------
log_step "4. Building Docker images (no-cache)"

echo "  Ini mungkin memakan waktu 5-15 menit..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache \
    || log_err "Docker build gagal. Periksa Dockerfile masing-masing service."
log_ok "Build selesai"

# ---------------------------------------------------------------------------
# 5. Start services
# ---------------------------------------------------------------------------
log_step "5. Starting services"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d \
    || log_err "docker compose up gagal"
log_ok "Services started"

# ---------------------------------------------------------------------------
# 6. Tunggu database siap
# ---------------------------------------------------------------------------
log_step "6. Waiting for database to be ready"

MAX_WAIT=30
WAITED=0
until docker compose exec -T postgres pg_isready -U myagentclaw_user -d myagentclaw >/dev/null 2>&1; do
    sleep 2
    WAITED=$((WAITED + 2))
    echo "  Menunggu PostgreSQL... (${WAITED}s)"
    if [ $WAITED -ge $MAX_WAIT ]; then
        log_err "PostgreSQL tidak siap dalam ${MAX_WAIT} detik"
    fi
done
log_ok "PostgreSQL siap"

# ---------------------------------------------------------------------------
# 7. Jalankan database migration
# ---------------------------------------------------------------------------
log_step "7. Running database migration"

docker compose exec -T backend npx prisma migrate deploy \
    || log_err "Prisma migration gagal"
log_ok "Migration selesai"

# ---------------------------------------------------------------------------
# 8. Health check
# ---------------------------------------------------------------------------
log_step "8. Health check"

sleep 5
HEALTH_URL="http://localhost:3001/health"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    log_ok "Backend health check passed (HTTP $HTTP_CODE)"
else
    log_warn "Backend belum siap atau health check gagal (HTTP $HTTP_CODE)"
    log_warn "Cek log: docker compose logs -f backend"
fi

# ---------------------------------------------------------------------------
# 9. Status services
# ---------------------------------------------------------------------------
log_step "9. Service status"

docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          DEPLOY SELESAI!                         ║"
echo "║                                                  ║"
echo "║  Monitor: docker compose logs -f                ║"
echo "║  Stop:    docker compose down                    ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
