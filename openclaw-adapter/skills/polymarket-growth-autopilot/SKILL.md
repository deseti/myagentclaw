---
name: polymarket-growth-autopilot
description: Growth-only Polymarket automatic trading autopilot status, decision history, dry-run or live execution trigger for agents.
---

# Polymarket Growth Autopilot

Gunakan skill ini saat user meminta:

- cek status autopilot Polymarket
- lihat run history atau decision history autopilot
- memicu autopilot Growth sekarang
- memicu trading otomatis Polymarket sekarang
- cek kenapa trading otomatis Polymarket belum jalan
- menjelaskan kenapa autopilot tidak melakukan aksi
- menjawab apakah autopilot sekarang sudah bisa auto trading live atau belum

## Tool

- Gunakan tool `polymarket_growth_autopilot`.
- Skill ini membaca status autopilot, history, dan memicu worker autopilot sesuai config aktif.
- Jika `status.canTriggerLiveExecution === true`, run agent akan mengikuti mode live execution yang sudah aktif di backend.
- Jika `status.canTriggerLiveExecution !== true`, anggap trigger agent sebagai dry-run.
- Live execution saat ini hanya boleh diasumsikan siap untuk strategi `PRICE_THRESHOLD_REVERSION`.

## Workflow yang benar

### 1. Cek status autopilot

Pakai action `status`.

Contoh:

```json
{
  "action": "status"
}
```

### 2. Lihat run history

Pakai action `runs`.

Contoh:

```json
{
  "action": "runs",
  "limit": 5
}
```

### 3. Lihat decision history

Pakai action `decisions`.

Contoh:

```json
{
  "action": "decisions",
  "limit": 10
}
```

Jika user ingin decision dari run tertentu, kirim `runId`.

### 4. Picu run manual

Pakai action `trigger_run`.

Contoh:

```json
{
  "action": "trigger_run"
}
```

Alias `trigger_dry_run` masih boleh dipakai untuk kompatibilitas, tetapi gunakan `trigger_run` sebagai default.

## Aturan jawaban

- Selalu cek `status` dulu sebelum menjelaskan capability autopilot ke user.
- Untuk pertanyaan seperti `sudah bisa auto trading sekarang?`, jawab `ya` atau `belum` dulu secara eksplisit berdasarkan `status.config.status`, `status.executionMode`, dan `status.canTriggerLiveExecution`.
- Jika `status.canTriggerLiveExecution === true`, jelaskan bahwa agent bisa memicu run autopilot live sesuai config aktif workspace.
- Jika `status.canTriggerLiveExecution !== true`, jelaskan bahwa agent hanya bisa memicu dry-run atau run non-live.
- Jika `status.config.status === 'EMERGENCY_STOP'`, jelaskan tegas bahwa trading otomatis belum aktif dan agent tidak boleh mengklaim bisa trading live.
- Jika run dipicu, jelaskan bahwa job hanya diantrikan dan hasil akhir harus dicek dari status atau run history.
- Jangan mengklaim bahwa order live sudah terkirim kecuali backend status/run berikutnya memang menunjukkan keputusan dieksekusi.
- Jika backend mengembalikan error config, arahkan user untuk menyimpan config autopilot dan mengaktifkannya dulu.