# myagentclaw

AI Operating Layer untuk bisnis berbasis chat di Indonesia.

## Stack
- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + Shadcn/UI
- **Backend**: Node.js + Fastify + Prisma ORM
- **AI Runtime**: OpenClaw (custom) + OpenAI / Anthropic
- **Database**: PostgreSQL 15 + Redis 7
- **Channel**: Telegram Bot API
- **Payment**: Xendit
- **Deploy**: Docker Compose → VPS + Nginx

## Struktur Folder
```
myagentclaw/
├── frontend/     # Next.js 14 Dashboard Owner
├── backend/      # Node.js + Fastify API Server
├── openclaw/     # AI Runtime
└── nginx/        # Reverse Proxy
```

## Quick Start (Development)

1. Copy `.env.example` ke `.env` dan isi semua nilai
2. Jika mau aktifkan login Google, isi `GOOGLE_CLIENT_ID` dan `NEXT_PUBLIC_GOOGLE_CLIENT_ID` dengan OAuth Client ID tipe Web dari Google Cloud Console
3. Jalankan semua service:
```bash
docker compose up -d
```
4. Jalankan database migration:
```bash
docker compose exec backend npx prisma migrate dev
```
5. Seed data demo:
```bash
docker compose exec backend npm run seed
```

## Catatan Knowledge Base

- Fitur upload gambar QRIS sudah dihapus.
- Field `referenceUrl` sekarang dipakai sebagai payment link atau link referensi universal yang boleh dibagikan bot ke customer.

## Akses Database

- Database utama adalah PostgreSQL di `localhost:5432`.
- Jika ingin lihat database lewat browser, gunakan Adminer di `http://localhost:8080`.
- Login Adminer local:
	- System: `PostgreSQL`
	- Server: `postgres`
	- Username: isi dari `POSTGRES_USER` di `.env`
	- Password: isi dari `POSTGRES_PASSWORD` di `.env`
	- Database: isi dari `POSTGRES_DB` di `.env`

## Perintah Build (Copy-Paste)

Jalankan dari root project `D:\myagentclaw`.

### Build standar (backend + frontend + adapter)
```bash
docker compose build backend frontend openclaw-adapter
docker compose up -d backend frontend openclaw-adapter
docker compose exec backend npx prisma db push
docker compose restart backend frontend openclaw-adapter
```

### Build full (termasuk openclaw runtime)
```bash
docker compose build openclaw backend frontend openclaw-adapter
docker compose up -d openclaw backend frontend openclaw-adapter
docker compose exec backend npx prisma db push
docker compose restart openclaw backend frontend openclaw-adapter
```

### Build cepat (hanya frontend)
```bash
docker compose build frontend
docker compose up -d frontend
docker compose restart frontend
```

## Perintah Ngrok (Copy-Paste)

Jalankan dari terminal terpisah.
Catatan penting: yang diketik di PowerShell hanya baris di dalam blok kode bash, bukan judul teks dokumentasi.

### Jalankan tunnel ke frontend lokal

Opsi umum (tanpa custom domain):
```bash
ngrok http http://localhost:3000
```

Opsi custom domain (jika domain ngrok sudah disiapkan):
```bash
ngrok http --domain=YOUR-NGROK-DOMAIN.ngrok-free.dev http://localhost:3000
```

### Cek URL tunnel aktif
```bash
curl http://127.0.0.1:4040/api/tunnels
```

### Stop tunnel ngrok

Tekan `Ctrl + C` di terminal ngrok, atau pakai command:
```bash
taskkill /IM ngrok.exe /F
```

### Catatan
- Akun ngrok free biasanya hanya mengizinkan 1 endpoint aktif dalam satu waktu.
- Untuk setup ini, endpoint publik diarahkan ke frontend (port 3000), lalu route `/api` dan `/ws` diproxy oleh frontend ke backend.

## Dokumentasi
Lihat folder PDF untuk arsitektur dan panduan build lengkap.
