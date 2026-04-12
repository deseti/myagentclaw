---
name: polymarket-read-only
description: Read live Polymarket data for agents, including trending or ramai markets, top-volume markets, market detail, orderbook, and saved-address positions.
---

# Polymarket Read-only

Gunakan skill ini saat user bertanya tentang market Polymarket, data live Polymarket, market yang lagi ramai, market trending, top volume, peluang outcome, orderbook, atau posisi Polymarket milik workspace yang aktif.

## Tool

- Gunakan tool `polymarket_read_only`.
- Skill ini read-only. Jangan mengklaim bisa place order, cancel order, atau trading otomatis.
- Untuk posisi user, tool selalu memakai address Polymarket yang sudah tersimpan di settings workspace. Jangan meminta user mengirim private key.

## Workflow yang benar

### 1. Cari market aktif

Pakai action `markets` atau `trending`.

- Untuk pertanyaan seperti `market Polymarket yang lagi ramai`, `yang trending`, `top volume`, atau `data live Polymarket sekarang`, prioritaskan action `trending`.
- Action `trending` harus dianggap sebagai default live market scan berbasis volume descending.

Contoh parameter:

```json
{
  "action": "trending",
  "limit": 5
}
```

Contoh jika user mencari market tertentu:

```json
{
  "action": "markets",
  "slug": "bitcoin",
  "limit": 5
}
```

Jika user ingin filter kategori, ambil dulu tag dengan action `tags`, lalu panggil `markets` dengan `tagId`.

### 2. Ambil detail market tertentu

Pakai action `market` dengan `slug` persis.

Contoh:

```json
{
  "action": "market",
  "slug": "bitcoin-above-120k-by-july"
}
```

Gunakan hasil ini untuk membaca pertanyaan market, deskripsi, outcome, outcomePrices, dan `clobTokenIds`.

### 3. Lihat orderbook

Pakai action `market` dulu jika belum punya `tokenId`, lalu ambil `clobTokenIds` dari hasil market detail. Setelah itu pakai action `orderbook`.

Contoh:

```json
{
  "action": "orderbook",
  "tokenId": "1234567890"
}
```

### 4. Lihat posisi user

Pakai action `positions`.

Contoh:

```json
{
  "action": "positions",
  "limit": 10
}
```

Jika hasil kosong, jelaskan bahwa koneksi valid tetapi tidak ada posisi yang terbuka pada address tersimpan.

## Aturan jawaban

- Jelaskan bahwa data berasal dari konektor read-only Polymarket live.
- Jika tool mengembalikan error settings/address, arahkan user untuk mengisi halaman Polymarket settings lebih dulu.
- Jangan membuat angka harga/probabilitas jika tool belum dipanggil.
- Jika tool live gagal, timeout, ditolak approval, atau hasilnya kosong untuk query yang diminta, katakan dengan jelas bahwa verifikasi live gagal atau tidak menemukan data. Jangan lanjut menyusun daftar market dari ingatan model.
- Jika user meminta trading, jelaskan bahwa skill ini belum melakukan trading dan hanya untuk baca data.
- Jika user meminta market yang ramai atau trending, jangan jawab dari asumsi. Panggil tool live dulu.
- Untuk jawaban daftar market trending atau top volume, tampilkan slug persis dari hasil tool agar user bisa cross-check di dashboard.