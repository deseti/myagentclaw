# Polymarket Growth Autopilot - Technical Design

Date: 2026-04-04

## Summary

Fase 7 membuka autopilot hanya untuk paket `Growth`, tetapi implementasinya tidak boleh berupa agent yang langsung bebas memanggil place order. Arsitektur yang direkomendasikan tetap memakai model hybrid:

- local skill menjadi feature gate dan capability agent
- backend core memegang semua logic sensitif: policy, risk checks, execution, audit, reconciliation, dan kill switch

Autopilot harus diperlakukan sebagai pipeline terkontrol, bukan chat action langsung.

## Product Rules

- `Free`: tidak punya akses Polymarket.
- `Starter`: read-only dan assisted trading manual, tanpa autopilot.
- `Growth`: boleh mengaktifkan autopilot jika semua guardrail valid.
- Autopilot tidak aktif default.
- Satu workspace hanya boleh punya satu config autopilot aktif pada satu waktu.
- Semua aksi autopilot wajib tercatat dan bisa dimatikan seketika.

## Non-Goals For Phase 7

- Tidak membuat agent bebas menentukan strategi dari prompt tanpa policy terstruktur.
- Tidak membuka martingale, averaging tanpa batas, atau ukuran order tanpa limit.
- Tidak mendukung shorting atau strategi derivatif di luar primitive order yang sudah ada.
- Tidak menghapus approval model `Starter`; autopilot hanya untuk `Growth`.

## Required Feature Gate

Tetap gunakan built-in local skill terpisah untuk capability autopilot, misalnya `polymarket-growth-autopilot`.

Tujuan skill ini:

- mengontrol apakah fitur autopilot muncul di dashboard
- mengontrol apakah agent boleh meminta insight atau menjalankan evaluasi autopilot
- menjaga pola yang sama dengan `polymarket-read-only`

Namun skill ini bukan tempat eksekusi order. Eksekusi tetap dilakukan backend lewat route internal dan worker khusus.

## High-Level Architecture

Autopilot dibagi menjadi 5 lapisan:

1. Configuration Layer
   Menyimpan strategi, batas risiko, status aktif, dan kill switch per workspace.

2. Planner Layer
   Mengevaluasi market universe sesuai strategy rules dan menghasilkan candidate action.

3. Guardrail Layer
   Memvalidasi candidate action terhadap semua batas risiko, exposure, cooldown, dan policy paket.

4. Executor Layer
   Mengubah candidate action yang lolos menjadi preview, lalu place/cancel order melalui backend trading client yang sudah ada.

5. Reconciliation Layer
   Menyamakan keadaan internal dengan posisi, order terbuka, dan audit aktual dari Polymarket.

## Execution Model

Jangan gunakan model event-driven penuh pada fase pertama. Mulai dari scheduler terkontrol.

Rekomendasi eksekusi awal:

- job scheduler periodik per workspace `Growth`
- interval minimum global, misalnya 60 detik atau 300 detik
- setiap tick hanya memproses workspace yang:
  - status subscription masih aktif
  - skill built-in autopilot terpasang
  - config autopilot aktif
  - credential trading valid
  - tidak sedang pause atau emergency stop

Flow satu tick:

1. load config autopilot workspace
2. acquire lock workspace autopilot
3. ambil snapshot state saat ini:
   - settings workspace
   - balances dan allowances
   - open orders
   - positions
   - market data yang diperlukan strategy
4. planner menghasilkan candidate decision
5. guardrail memvalidasi candidate
6. jika lolos, executor melakukan preview lalu place/cancel
7. simpan decision log dan run summary
8. release lock

## State Machine

Status config autopilot yang direkomendasikan:

- `DRAFT`: config belum bisa dijalankan
- `READY`: config valid tetapi belum aktif
- `ACTIVE`: scheduler boleh menjalankan evaluation
- `PAUSED`: sementara berhenti, tidak place order baru
- `STOPPING`: cancel open orders terpilih lalu pindah ke `PAUSED`
- `EMERGENCY_STOP`: blok semua aksi baru sampai direset manual
- `ERROR`: butuh intervensi operator

Status run yang direkomendasikan:

- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `COMPLETED_NO_ACTION`
- `BLOCKED_BY_GUARDRAIL`
- `FAILED`
- `CANCELLED`

## Proposed Data Model

Model yang sudah ada:

- `PolymarketProfile`
- `PolymarketTradeAudit`

Model baru yang direkomendasikan:

### `PolymarketAutopilotConfig`

Satu record per workspace.

Field inti:

- `workspaceId`
- `ownerId`
- `status`
- `strategyType`
- `strategyConfigJson`
- `riskConfigJson`
- `marketScopeJson`
- `executionConfigJson`
- `lastValidatedAt`
- `lastValidationError`
- `lastRunAt`
- `pausedReason`
- `emergencyStoppedAt`
- `createdAt`
- `updatedAt`

### `PolymarketAutopilotRun`

Satu record per tick evaluasi scheduler.

Field inti:

- `workspaceId`
- `configId`
- `status`
- `startedAt`
- `finishedAt`
- `snapshotJson`
- `summaryJson`
- `errorMessage`

### `PolymarketAutopilotDecision`

Satu record per decision candidate di dalam satu run.

Field inti:

- `runId`
- `workspaceId`
- `decisionType` seperti `PLACE_ORDER`, `CANCEL_ORDER`, `SKIP`
- `marketSlug`
- `tokenId`
- `side`
- `payloadJson`
- `guardrailResultJson`
- `status`
- `executedAuditId`
- `reasonCode`
- `createdAt`

### Optional extension on `PolymarketTradeAudit`

Tambahkan field berikut agar audit manual dan autopilot bisa hidup berdampingan:

- `source` dengan nilai `MANUAL` atau `AUTOPILOT`
- `runId` nullable
- `decisionId` nullable
- `reasonCode` nullable

Jika tidak ingin mengubah audit table besar di awal, source dan linkage bisa sementara disimpan di `requestJson`, tetapi itu solusi transisi saja.

## Strategy Model

Fase 7 sebaiknya tidak membuka strategy arbitrary. Batasi ke daftar strategi terstruktur.

Strategi awal yang direkomendasikan:

1. `PRICE_THRESHOLD_REVERSION`
   Beli atau jual jika harga bergerak melewati batas tertentu dari anchor.

2. `RANGE_MAKER`
   Menjaga limit order di range tertentu dengan spread kecil dan inventory cap.

3. `EVENT_MOMENTUM`
   Menempatkan order hanya saat sinyal momentum memenuhi syarat ketat dan market termasuk whitelist.

Semua strategi harus disimpan sebagai config JSON yang tervalidasi backend, bukan prompt bebas.

## Market Scope Model

Config market scope harus eksplisit.

Field yang direkomendasikan:

- `allowedTags`
- `allowedSports`
- `allowedMarketSlugs`
- `blockedMarketSlugs`
- `maxMarketsPerRun`
- `minLiquidity`
- `minVolume24h`
- `excludeNegRisk`
- `excludeClosed`
- `excludeResolved`

Default aman:

- whitelist-only lebih aman daripada open universe
- batasi jumlah market yang dievaluasi per run

## Guardrail Model

Guardrail wajib dievaluasi server-side sebelum preview dan place order.

### Hard Guardrails

Jika gagal, decision langsung ditolak.

- package bukan `Growth`
- skill autopilot tidak terpasang
- config status bukan `ACTIVE`
- credential belum valid
- private key atau API credential gagal test
- daily kill switch aktif
- balance collateral tidak cukup
- allowance tidak cukup
- market tidak ada di whitelist atau masuk blacklist
- market resolved atau closed
- negative risk market diblok jika config melarang
- order size melewati `maxOrderSize`
- total exposure market melewati `maxExposurePerMarket`
- total exposure workspace melewati `maxTotalExposure`
- estimated daily loss melewati `maxDailyLoss`
- cooldown market belum lewat
- sudah ada open order sejenis yang conflict

### Soft Guardrails

Jika gagal, decision boleh disimpan sebagai `SKIP` tanpa error fatal.

- spread terlalu lebar
- likuiditas terlalu tipis
- slippage estimasi terlalu tinggi
- harga di luar target band strategi
- market data stale
- sinyal belum cukup kuat

### Global Risk Config

Minimal field yang harus ada:

- `maxOrderSizeUsd`
- `maxExposurePerMarketUsd`
- `maxTotalExposureUsd`
- `maxOpenOrders`
- `maxDailyLossUsd`
- `maxDailyOrderCount`
- `marketCooldownSeconds`
- `cancelStaleAfterSeconds`
- `maxSlippageBps`
- `requirePositiveExpectedValue`
- `dryRun`

## Order Execution Policy

Jangan place order langsung dari planner. Gunakan dua tahap:

1. planner menghasilkan execution intent
2. executor memanggil preview backend yang sudah ada

Kenapa begitu:

- preview manual trading saat ini sudah memvalidasi shape order dan membaca orderbook
- ini mengurangi duplikasi logic order construction
- guardrail terakhir bisa membandingkan hasil preview dengan policy config

Urutan executor yang direkomendasikan:

1. build execution intent
2. call preview helper internal
3. validate preview result
4. create decision record
5. place order
6. write trade audit
7. update run summary

Untuk cancel stale order:

- jangan cancel semua order tiap tick
- cancel hanya order yang memenuhi policy usia, drift harga, atau conflict dengan intent baru

## Locking And Concurrency

Setiap workspace autopilot wajib pakai distributed lock.

Lock keys yang direkomendasikan:

- `polymarket:autopilot:run:{workspaceId}`
- `polymarket:autopilot:reconcile:{workspaceId}`

Aturan:

- satu workspace tidak boleh punya dua run aktif bersamaan
- run overlap harus `SKIP` atau `CANCELLED`
- order placement harus idempotent terhadap duplicate tick

Idempotency key yang direkomendasikan:

- hash dari `workspaceId + strategyVersion + tokenId + side + normalizedPrice + normalizedSize + runWindow`

## Internal API Surfaces

API publik dashboard `Growth`:

- `GET /api/polymarket/autopilot/config?workspaceId=...`
- `PUT /api/polymarket/autopilot/config`
- `POST /api/polymarket/autopilot/validate`
- `POST /api/polymarket/autopilot/activate`
- `POST /api/polymarket/autopilot/pause`
- `POST /api/polymarket/autopilot/emergency-stop`
- `GET /api/polymarket/autopilot/runs?workspaceId=...`
- `GET /api/polymarket/autopilot/decisions?workspaceId=...`

API internal scheduler/worker:

- `POST /internal/polymarket/autopilot/run-workspace`
- `POST /internal/polymarket/autopilot/reconcile-workspace`
- `POST /internal/polymarket/autopilot/emergency-stop`

API internal agent capability, read-only by default:

- agent boleh membaca status autopilot, run summary, dan reason blocked
- agent tidak boleh place order langsung lewat prompt tanpa execution policy backend

## Worker Split

Autopilot harus dijalankan oleh worker khusus, bukan request cycle dashboard.

Queue yang direkomendasikan:

- `polymarket-autopilot-run`
- `polymarket-autopilot-reconcile`
- `polymarket-autopilot-alert`

Alasan:

- evaluasi market dan order bisa lambat
- butuh retry policy terkontrol
- lebih mudah diberi concurrency limit

## Reconciliation Model

Fase 7 tidak boleh bergantung penuh pada asumsi response place order terakhir.

Job reconciliation periodik harus:

- sinkronkan open orders aktual
- sinkronkan posisi aktual
- tandai drift antara state internal dan exchange state
- memicu `EMERGENCY_STOP` jika mismatch kritis melebihi threshold

Contoh trigger emergency:

- posisi aktual jauh di atas exposure config
- order terbuka tidak dikenal oleh sistem internal
- credential validasi mendadak gagal
- repeated failure rate melewati threshold

## Audit And Explainability

Semua run dan decision harus punya reason code terstruktur.

Contoh `reasonCode`:

- `BLOCKED_PACKAGE`
- `BLOCKED_SKILL_NOT_INSTALLED`
- `BLOCKED_INVALID_CREDENTIALS`
- `BLOCKED_MARKET_SCOPE`
- `BLOCKED_MAX_EXPOSURE_PER_MARKET`
- `BLOCKED_MAX_DAILY_LOSS`
- `BLOCKED_COOLDOWN`
- `BLOCKED_STALE_MARKET_DATA`
- `SKIPPED_WEAK_SIGNAL`
- `EXECUTED_PLACE_ORDER`
- `EXECUTED_CANCEL_STALE`
- `TRIGGERED_EMERGENCY_STOP`

Tujuan utamanya:

- dashboard bisa menjelaskan kenapa autopilot tidak mengeksekusi apa pun
- operator bisa audit tanpa membaca raw JSON terus-menerus

## UI Requirements For Growth Autopilot

Halaman dashboard autopilot minimal harus punya:

- status config dan kill switch
- strategy form yang tervalidasi
- risk form terpisah dari strategy logic
- preview validation sebelum activate
- run history
- decision history
- blocked reasons summary
- emergency stop action yang selalu terlihat

UI tidak boleh langsung mengedit raw JSON tanpa validation layer.

## Observability Requirements

Metric minimum:

- run count per status
- average run duration
- decision count per reason code
- order placement success rate
- cancel success rate
- emergency stop count
- reconciliation drift count
- credential failure count

Log minimum:

- workspaceId
- configId
- runId
- decisionId
- tokenId
- marketSlug
- reasonCode

## Rollout Plan

### Stage 1

- config persistence
- validation only
- no live order placement
- dry-run mode mandatory

### Stage 2

- limited live execution for internal test workspace
- whitelist market only
- very small order size caps

### Stage 3

- Growth beta with explicit opt-in
- reconciliation and alerting active

### Stage 4

- broader Growth release setelah risk ops Fase 8 dianggap cukup matang

## Recommended Implementation Order

1. tambahkan data model config, run, decision
2. tambahkan config validation endpoint dan UI draft
3. tambahkan dry-run worker scheduler
4. tambahkan decision logging dan reason codes
5. tambahkan live executor dengan strict whitelist
6. tambahkan reconciliation worker
7. tambahkan emergency stop otomatis berbasis mismatch atau failure threshold

## Key Decision

Keputusan arsitektur yang direkomendasikan adalah:

- agent boleh membantu analisis dan menjelaskan state autopilot
- agent tidak menjadi eksekutor utama order
- backend worker adalah satu-satunya komponen yang boleh mengeksekusi autopilot live

Ini menjaga pola hybrid yang sudah disepakati: skill lokal sebagai capability dan feature gate, backend core sebagai pemilik logic sensitif.