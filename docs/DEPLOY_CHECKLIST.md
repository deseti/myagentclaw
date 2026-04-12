# myagentclaw — VPS Deployment Checklist

Centang semua item sebelum go-live di production.

---

## Infrastructure

- [ ] VPS minimal: **2 CPU, 2 GB RAM, 20 GB SSD** (Ubuntu 22.04 LTS direkomendasikan)
- [ ] Domain sudah pointing ke IP VPS (A record di DNS, TTL propagated)
- [ ] Firewall dikonfigurasi: **hanya port 80 dan 443 terbuka** ke publik
  ```bash
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 22/tcp   # SSH — batasi ke IP tertentu jika memungkinkan
  ufw enable
  ```
- [ ] SSH key-based auth aktif, password auth dinonaktifkan di `/etc/ssh/sshd_config`

---

## SSL Certificate

- [ ] Certbot terinstall: `apt install certbot`
- [ ] SSL certificate digenerate:
  ```bash
  certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
  ```
- [ ] Auto-renewal cron aktif: `certbot renew --dry-run` berhasil
- [ ] `nginx.prod.conf` sudah diupdate dengan nama domain yang benar

---

## Environment Variables

- [ ] `.env` sudah dibuat dari `.env.example`
- [ ] `POSTGRES_PASSWORD` — password kuat (min 20 karakter, acak)
- [ ] `JWT_SECRET` — min 32 karakter acak (`openssl rand -hex 32`)
- [ ] `INTERNAL_SECRET_KEY` — min 32 karakter acak
- [ ] `OPENAI_API_KEY` — sudah diset dan aktif
- [ ] `ANTHROPIC_API_KEY` — sudah diset (opsional jika tidak pakai Claude)
- [ ] `XENDIT_SECRET_KEY` — key production (bukan test key)
- [ ] `XENDIT_WEBHOOK_TOKEN` — token verification dari dashboard Xendit
- [ ] `TELEGRAM_BOT_TOKEN` — bot token production dari @BotFather
- [ ] `NEXT_PUBLIC_API_URL` — `https://yourdomain.com/api`
- [ ] `NEXT_PUBLIC_WS_URL` — `https://yourdomain.com`

---

## Docker & Services

- [ ] Docker Engine terinstall (versi 24+): `docker --version`
- [ ] Docker Compose plugin terinstall: `docker compose version`
- [ ] Build berhasil: `docker compose -f docker-compose.yml -f docker-compose.prod.yml build`
- [ ] Semua containers running: `docker compose ps` → semua status `Up`
- [ ] Redis policy aman untuk BullMQ: `docker compose exec redis redis-cli CONFIG GET maxmemory-policy` → `noeviction`
- [ ] Database migration berhasil: `docker compose exec backend npx prisma migrate deploy`
- [ ] Health check backend OK: `curl https://yourdomain.com/health`
- [ ] Frontend accessible: buka `https://yourdomain.com` di browser

---

## External Services

- [ ] **Xendit webhook URL** diupdate di dashboard Xendit:
  `https://yourdomain.com/api/webhooks/xendit`
- [ ] **Telegram bot webhook** diset (jika pakai webhook mode, bukan polling):
  ```bash
  curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://yourdomain.com/api/webhooks/telegram/<channelId>"
  ```
- [ ] Test pembayaran Xendit (mode test → mode production)
- [ ] Test pesan Telegram masuk dan mendapat balasan AI

---

## Monitoring & Backup

- [ ] **UptimeRobot** (atau tools serupa) monitoring aktif untuk:
  - `https://yourdomain.com/health` → alert jika down
  - Check interval: 5 menit
- [ ] **Database backup** terjadwal via crontab:
  ```bash
  # Backup setiap hari jam 02.00 WIB, simpan 7 hari terakhir
  0 19 * * * docker compose exec -T postgres pg_dump -U myagentclaw_user myagentclaw | gzip > /backup/myagentclaw_$(date +\%F).sql.gz
  find /backup -name "*.sql.gz" -mtime +7 -delete
  ```
- [ ] `/backup` directory tersedia dan writable
- [ ] **Error tracking** (Sentry atau LogTail) terpasang di backend
  - Set `SENTRY_DSN` di `.env` dan install `@sentry/node` di backend

---

## Security Final Check

- [ ] `openclaw` service tidak expose port ke publik (hanya internal Docker network)
- [ ] `postgres` tidak expose port ke publik
- [ ] `redis` tidak expose port ke publik
- [ ] Nginx memblokir `/internal/` dari luar (lihat config `deny all` di nginx.prod.conf)
- [ ] Rate limiting aktif untuk `/api/` dan `/api/auth/`
- [ ] Security headers aktif (X-Frame-Options, HSTS, dll)
- [ ] Tidak ada credential di Git history (`git log --diff-filter=M -- .env`)

---

## Post-Deploy Smoke Test

- [ ] Register akun owner baru berhasil
- [ ] Login berhasil dan masuk dashboard
- [ ] Buat 1 agent, set status ACTIVE
- [ ] Connect Telegram channel
- [ ] Kirim pesan test dari Telegram → mendapat balasan AI
- [ ] Masuk halaman Billing → lihat paket aktif
- [ ] Test checkout paket (Xendit test mode)

---

## Commands Berguna

```bash
# Monitor semua log real-time
docker compose logs -f

# Monitor log service spesifik
docker compose logs -f backend
docker compose logs -f openclaw

# Restart service tertentu
docker compose restart backend

# Stop semua
docker compose down

# Deploy ulang tanpa downtime (jika hanya ada code update)
git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build backend

# Masuk ke container backend
docker compose exec backend sh

# Cek Prisma migration status
docker compose exec backend npx prisma migrate status

# Manual database seed (hanya sekali di fresh install)
docker compose exec backend node prisma/seed.js
```
