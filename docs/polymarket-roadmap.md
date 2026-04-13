# Polymarket Roadmap

Dokumen ini menetapkan alur implementasi Polymarket dari awal sampai siap dipakai tanpa loncat fase.

## Aturan Paket

- `Free`: tidak mendapat fitur trading Polymarket.
- `Starter`: read-only + assisted trading. Tidak boleh full otomatis.
- `Growth`: boleh full otomatis setelah semua guardrail, monitoring, dan risk ops selesai.

## Prinsip Urutan Kerja

1. Bangun fondasi read-only dulu.
2. Setelah data publik stabil, baru tambahkan identitas user Polymarket.
3. Setelah identity + read-only siap, baru tambahkan credential flow trading.
4. Setelah credential flow siap, baru tambahkan manual order.
5. Setelah manual order stabil, baru tambahkan autopilot khusus `Growth`.
6. Monitoring, audit, dan risk ops wajib selesai sebelum full otomatis dianggap production-ready.
7. Feature gating local skill harus tetap menjadi kontrol utama untuk capability agent dan akses UI, sedangkan logic sensitif tetap di backend core.

## Fase Implementasi

### Fase 0: Scope dan Policy Produk

Tujuan:
- mengunci pembagian fitur per paket
- menghindari perubahan policy di tengah implementasi

Output:
- `Free` diblok dari skill dan trading Polymarket
- `Starter` hanya read-only dan assisted trading
- `Growth` satu-satunya paket yang boleh full otomatis

Status:
- selesai secara keputusan produk

### Fase 1: Read-only Connector Backend

Tujuan:
- menghubungkan backend ke API publik Polymarket tanpa auth trading
- menyediakan data market, detail market, tags, sports, orderbook, dan positions publik

Output minimum:
- client backend untuk Gamma API, Data API, dan CLOB read endpoints
- route backend read-only
- proteksi akses mulai `Starter`

Endpoint target:
- `GET /api/polymarket/markets`
- `GET /api/polymarket/markets/slug/:slug`
- `GET /api/polymarket/tags`
- `GET /api/polymarket/sports`
- `GET /api/polymarket/orderbook/:tokenId`
- `GET /api/polymarket/positions`

Definition of done:
- route tersedia di backend
- `Free` ditolak
- `Starter` dan `Growth` bisa baca data publik
- market dan orderbook bisa diuji tanpa auth trading

Status sekarang:
- backend connector dan route read-only sudah dibuat
- belum ada UI
- belum ada skill agent
- belum ada penyimpanan address per user

### Fase 2: User Identity dan Settings Polymarket

Tujuan:
- menyimpan identitas Polymarket user secara resmi di sistem
- menghindari query address manual di URL

Output minimum:
- halaman settings Polymarket per workspace atau owner
- field address Polymarket / funder address / signature type
- test connection read-only

Data yang perlu disimpan:
- display address
- API-use address jika berbeda
- funder address
- signature type
- metadata koneksi

Definition of done:
- user bisa menyimpan address Polymarket
- route positions tidak lagi mengandalkan input manual setiap request
- dashboard read-only bisa memakai address tersimpan

Catatan:
- fase ini tetap read-only
- belum menyimpan credential trading sensitif

### Fase 3: Dashboard Read-only Polymarket

Tujuan:
- memberi UI yang nyata untuk eksplorasi market sebelum masuk trading

Output minimum:
- halaman daftar market aktif
- filter by slug atau tag
- detail market
- orderbook viewer
- positions viewer berdasarkan address tersimpan

Definition of done:
- user `Starter` dan `Growth` bisa menjelajah market dari dashboard
- user bisa lihat posisi read-only tanpa menulis query manual

Catatan:
- fase ini masih read-only
- ini bukan fase trading

### Fase 4: Skill Agent Read-only

Tujuan:
- membuat agent bisa membaca data Polymarket, bukan cuma dashboard

Output minimum:
- skill atau tool agent untuk:
  - cari market aktif
  - baca market by slug
  - baca orderbook
  - baca posisi user

Paket:
- `Starter`: boleh
- `Growth`: boleh
- `Free`: tidak boleh

Definition of done:
- agent bisa menjawab pertanyaan market dan posisi dengan data live Polymarket
- belum ada place order

Catatan:
- ini tetap read-only
- fase ini datang setelah dashboard/settings supaya model tidak bergantung pada input manual yang kacau

### Fase 5: Credential Flow Trading

Tujuan:
- menyiapkan auth L1/L2 Polymarket secara aman

Output minimum:
- penyimpanan encrypted credential
- alur derive atau create API credential
- validasi signature type dan funder address
- test authenticated request tanpa order

Secret yang dikelola:
- private key atau metode signing yang dipilih
- `apiKey`
- `secret`
- `passphrase`

Definition of done:
- sistem bisa membuat atau derive credential Polymarket
- sistem bisa melakukan authenticated read trading endpoint
- secret tidak masuk ke prompt agent atau workspace file biasa

Catatan:
- belum ada order placement
- ini fase paling sensitif dari sisi security

### Fase 6: Manual Order dan Assisted Trading

Tujuan:
- membuka eksekusi order nyata secara terkontrol

Output minimum:
- place order
- cancel order
- list open orders
- fetch balances dan allowances
- approval flow untuk `Starter`

Paket:
- `Starter`: boleh assisted trading saja
- `Growth`: boleh manual trading dan dipakai dasar autopilot

Definition of done:
- user bisa submit order nyata dari sistem
- order bisa dibatalkan
- semua aksi tercatat di audit log
- `Starter` tetap membutuhkan approval eksplisit

Catatan:
- autopilot belum boleh aktif

### Fase 6.5: Local Skill Feature Gating

Tujuan:
- memastikan fitur Polymarket mengikuti model local skill hybrid
- memisahkan feature gate agent/UI dari logic backend sensitif

Output minimum:
- built-in skill local `polymarket-read-only`
- route backend publik dan internal hanya aktif jika skill terpasang
- dashboard hanya menampilkan halaman Polymarket jika skill tersedia

Definition of done:
- uninstall skill membuat akses fitur Polymarket tertutup
- install skill mengaktifkan kembali akses UI dan capability agent
- logic credential, order, dan audit tetap tinggal di backend core

Status:
- selesai

### Fase 7: Growth Autopilot

Tujuan:
- memberi kemampuan full otomatis khusus `Growth`

Output minimum:
- strategy rules
- scheduled evaluation
- auto place order
- auto cancel stale order
- auto manage exits

Paket:
- hanya `Growth`

Definition of done:
- user `Growth` bisa mengaktifkan auto mode
- engine hanya berjalan jika risk config valid
- kill switch tersedia
- semua keputusan terekam di audit log

Catatan:
- ini baru boleh dimulai setelah manual order stabil
- desain teknis guardrail perlu dikunci sebelum implementasi kode

### Fase 8: Monitoring, Audit, dan Risk Ops

Tujuan:
- membuat fitur layak dipakai terus-menerus, bukan sekadar demo

Output minimum:
- execution log UI
- order history
- error history
- risk setting UI
- reconciliation job
- alerting untuk gagal order atau auth error

Guardrail minimum:
- max order size
- max exposure per market
- allowed categories or market whitelist
- cooldown antar aksi
- max daily loss
- dry-run mode
- emergency stop

Definition of done:
- operator bisa audit semua aksi
- user bisa mematikan auto mode kapan saja
- mismatch posisi atau order bisa terdeteksi

Status sekarang:
- execution log UI sudah ada lewat run, decision, dan trade audit history
- reconciliation route backend sudah nyata dan sekarang juga menyimpan health check persisten
- alert persisten `OPEN` / `RESOLVED` untuk drift, auth error, dan run failure sudah ada di backend
- dashboard Growth sekarang punya tab monitoring untuk melihat alert aktif, error history, dan hasil reconciliation terakhir
- live executor backend untuk `PRICE_THRESHOLD_REVERSION` sudah terpasang, termasuk place/cancel order nyata, linkage audit, dan guardrail dasar
- delivery alert eksternal masih belum ada

## Urutan Nyata yang Harus Diikuti

Urutan implementasi yang benar adalah:

1. Fase 1: read-only connector backend
2. Fase 2: settings identity user Polymarket
3. Fase 3: dashboard read-only
4. Fase 4: skill agent read-only
5. Fase 5: credential flow trading
6. Fase 6: manual order dan assisted trading
7. Fase 6.5: local skill feature gating
8. Fase 7: Growth autopilot
9. Fase 8: monitoring dan risk ops

## Status Saat Ini

- Fase 0 sampai Fase 6 selesai secara praktis di backend dan dashboard.
- Fase 6.5 selesai: Polymarket sekarang mengikuti local skill hybrid gating.
- Fase 7 sudah punya jalur dry-run dan live execution terbatas untuk `PRICE_THRESHOLD_REVERSION`: schema, endpoint contract, queue worker, scheduler, local skill autopilot, agent/internal status-history-trigger endpoint, dan executor order nyata sudah ada di source.
- UI operator autopilot Growth sudah masuk ke dashboard source, dan internal reconciliation report sudah tidak lagi `501` placeholder.
- Fase 8 sudah lebih maju lewat monitoring tab, alert persisten, reconciliation report, dan health check tersimpan, tetapi delivery alert eksternal dan operasi production-hardening penuh belum selesai.

## Kenapa Tidak Boleh Loncat

- Kalau langsung buat autopilot tanpa credential flow, trading tidak bisa jalan.
- Kalau langsung buat skill agent tanpa settings identity, agent akan tergantung input manual yang tidak stabil.
- Kalau langsung buat manual order tanpa audit dan risk design, sistem rawan eksekusi berbahaya.
- Kalau langsung buka full otomatis di `Starter`, policy paket akan bentrok dengan batas tool runtime yang sekarang.

## Current Checkpoint

Posisi pengerjaan saat ini:

- keputusan paket sudah dikunci
- Fase 0 sampai Fase 6.5 sudah selesai
- Fase 7 live-capable sudah selesai di source untuk strategy awal `PRICE_THRESHOLD_REVERSION`
- pekerjaan berikutnya adalah deploy, verifikasi runtime live, dan menutup sisa production hardening Fase 8

## Next Step Resmi

Next step resmi setelah dokumen ini adalah:

1. mem-build dan memverifikasi UI operator autopilot di frontend runtime
2. memverifikasi executor live di backend runtime dan database migration terkait audit linkage
3. lanjut menutup Fase 8 monitoring, alerting, audit, dan risk ops sampai siap production
