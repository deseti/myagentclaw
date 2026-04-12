# Polymarket Autopilot Endpoint Contract

Date: 2026-04-05

Status: live-capable worker implemented

- live execution: configurable via `POLYMARKET_AUTOPILOT_LIVE_EXECUTION_ENABLED`
- scheduler worker: implemented
- supported tier: `GROWTH`
- required skill today: built-in `polymarket-growth-autopilot`

## Public API

Base prefix:

- `/api/polymarket/autopilot`

### `GET /config?workspaceId=...`

Purpose:

- membaca config autopilot workspace

Response shape:

```json
{
  "workspaceId": "string",
  "tier": "GROWTH",
  "supportedStrategies": [
    "PRICE_THRESHOLD_REVERSION",
    "RANGE_MAKER",
    "EVENT_MOMENTUM"
  ],
  "contract": {
    "liveExecutionEnabled": true
  },
  "config": null
}
```

### `PUT /config`

Purpose:

- menyimpan draft config atau config siap-aktivasi

Request shape:

```json
{
  "workspaceId": "string",
  "strategyType": "PRICE_THRESHOLD_REVERSION",
  "strategyConfig": {
    "sideMode": "BOTH",
    "referencePriceSource": "LAST_TRADE",
    "buyBelowPrice": 0.42,
    "sellAbovePrice": 0.58,
    "orderSizeUsd": 5,
    "maxPositionUsd": 20
  },
  "riskConfig": {
    "maxOrderSizeUsd": 10,
    "maxExposurePerMarketUsd": 25,
    "maxTotalExposureUsd": 50,
    "maxOpenOrders": 5,
    "maxDailyLossUsd": 10,
    "maxDailyOrderCount": 10,
    "marketCooldownSeconds": 300,
    "cancelStaleAfterSeconds": 900,
    "maxSlippageBps": 150,
    "requirePositiveExpectedValue": false
  },
  "marketScope": {
    "allowedTags": [],
    "allowedSports": [],
    "allowedMarketSlugs": ["market-slug"],
    "blockedMarketSlugs": [],
    "maxMarketsPerRun": 5,
    "minLiquidity": 0,
    "minVolume24h": 0,
    "excludeNegRisk": true,
    "excludeClosed": true,
    "excludeResolved": true
  },
  "executionConfig": {
    "dryRun": false,
    "evaluationIntervalSeconds": 300,
    "maxRuntimeSeconds": 120,
    "cancelStaleOrders": true
  }
}
```

Response shape:

```json
{
  "message": "string",
  "workspaceId": "string",
  "tier": "GROWTH",
  "valid": true,
  "validationErrors": [],
  "config": {
    "id": "string",
    "workspaceId": "string",
    "ownerId": "string",
    "status": "READY",
    "strategyType": "PRICE_THRESHOLD_REVERSION",
    "strategyConfig": {},
    "riskConfig": {},
    "marketScope": {},
    "executionConfig": {},
    "lastValidatedAt": "2026-04-04T00:00:00.000Z",
    "lastValidationError": null,
    "lastRunAt": null,
    "pausedReason": null,
    "emergencyStoppedAt": null,
    "createdAt": "2026-04-04T00:00:00.000Z",
    "updatedAt": "2026-04-04T00:00:00.000Z",
    "contract": {
      "liveExecutionEnabled": false,
      "schedulerEnabled": true
    }
  }
}
```

### `POST /validate`

Purpose:

- memvalidasi payload config tanpa menyimpan ke database

Response shape:

```json
{
  "workspaceId": "string",
  "tier": "GROWTH",
  "valid": true,
  "nextStatus": "READY",
  "validationErrors": [],
  "normalizedConfig": {
    "workspaceId": "string",
    "strategyType": "PRICE_THRESHOLD_REVERSION",
    "strategyConfig": {},
    "riskConfig": {},
    "marketScope": {},
    "executionConfig": {}
  },
  "contract": {
    "liveExecutionEnabled": true,
    "schedulerEnabled": true
  }
}
```

### `POST /activate`

Purpose:

- mengubah config valid menjadi `ACTIVE`
- worker akan menjalankan dry-run atau live execution sesuai `executionConfig.dryRun`

Request shape:

```json
{
  "workspaceId": "string"
}
```

Behavior note:

- endpoint ini butuh credential trading Polymarket yang sudah tersimpan dan pernah diverifikasi
- untuk live execution, `executionConfig.dryRun` harus `false`
- live execution saat ini hanya didukung untuk strategy `PRICE_THRESHOLD_REVERSION`

### `POST /run`

Purpose:

- mengantrikan run manual untuk config `ACTIVE`

Request shape:

```json
{
  "workspaceId": "string"
}
```

Response shape:

```json
{
  "accepted": true,
  "executed": false,
  "workspaceId": "string",
  "jobId": "string",
  "message": "Run autopilot Polymarket berhasil diantrikan."
}
```

### `POST /pause`

Request shape:

```json
{
  "workspaceId": "string",
  "reason": "optional string"
}
```

### `POST /emergency-stop`

Request shape:

```json
{
  "workspaceId": "string",
  "reason": "optional string"
}
```

### `GET /runs?workspaceId=...&limit=...`

Purpose:

- membaca history run autopilot

Response shape:

```json
{
  "workspaceId": "string",
  "tier": "GROWTH",
  "runs": [
    {
      "id": "string",
      "workspaceId": "string",
      "configId": "string",
      "status": "COMPLETED_NO_ACTION",
      "startedAt": "2026-04-04T00:00:00.000Z",
      "finishedAt": "2026-04-04T00:00:00.000Z",
      "snapshot": {},
      "summary": {},
      "errorMessage": null,
      "createdAt": "2026-04-04T00:00:00.000Z",
      "updatedAt": "2026-04-04T00:00:00.000Z"
    }
  ]
}
```

### `GET /decisions?workspaceId=...&limit=...&runId=...`

Purpose:

- membaca history decision autopilot

Response shape:

```json
{
  "workspaceId": "string",
  "tier": "GROWTH",
  "decisions": []
}
```

### `GET /monitoring?workspaceId=...`

Purpose:

- membaca snapshot monitoring terkini untuk operator dashboard
- menggabungkan summary alert, health check terakhir, dan riwayat alert terbaru

Response shape:

```json
{
  "workspaceId": "string",
  "tier": "GROWTH",
  "summary": {
    "openAlertCount": 0,
    "openCriticalCount": 0,
    "openWarningCount": 0,
    "latestRecommendedAction": "NONE",
    "latestCheckAt": "2026-04-04T00:00:00.000Z",
    "latestRunStatus": "COMPLETED",
    "failedRunCount24h": 0,
    "emergencyStopActive": false
  },
  "latestHealthCheck": {
    "id": "string",
    "workspaceId": "string",
    "trigger": "WORKER_SCHEDULER",
    "recommendedAction": "REVIEW",
    "emergencyStopApplied": false,
    "report": {},
    "checkedAt": "2026-04-04T00:00:00.000Z"
  },
  "openAlerts": [],
  "recentAlerts": []
}
```

### `POST /reconcile`

Purpose:

- memberi operator dashboard kemampuan menjalankan reconciliation on-demand
- hasil reconciliation juga disimpan sebagai health check dan disinkronkan ke alert persisten

## Internal API

Base prefix:

- `/internal/polymarket/autopilot`

### `POST /run-workspace`

Purpose:

- internal trigger untuk enqueue dry-run per workspace aktif

Request shape:

```json
{
  "workspaceId": "string"
}
```

Response shape:

```json
{
  "accepted": true,
  "executed": false,
  "workspaceId": "string",
  "jobId": "string"
}
```

### `GET /agents/:agentId/status`

Purpose:

- membaca status autopilot Growth dari perspektif agent built-in skill

### `GET /agents/:agentId/runs?limit=...`

Purpose:

- membaca history run autopilot untuk agent aktif

### `GET /agents/:agentId/decisions?limit=...&runId=...`

Purpose:

- membaca history decision autopilot untuk agent aktif

### `POST /agents/:agentId/run`

Purpose:

- memberi agent kemampuan memicu manual dry-run untuk workspace Growth yang sudah `ACTIVE`

### `POST /reconcile-workspace`

Purpose:

- menjalankan reconciliation report sinkron terhadap state exchange, audit internal, dan decision autopilot

Current behavior:

- mengembalikan laporan drift nyata
- menyimpan hasil health check terbaru
- menyinkronkan alert persisten `OPEN` / `RESOLVED`
- dapat mengubah config `ACTIVE` menjadi `EMERGENCY_STOP` bila menemukan mismatch kritis yang jelas

### `POST /emergency-stop`

Purpose:

- memaksa config workspace masuk `EMERGENCY_STOP` dari jalur internal

Request shape:

```json
{
  "workspaceId": "string",
  "reason": "optional string"
}
```

## Current Validation Rules

- workspace harus `GROWTH`
- skill built-in `polymarket-growth-autopilot` harus terpasang
- market scope harus memiliki whitelist minimal satu dari tag, sport, atau market slug
- jika live execution contract nonaktif, `dryRun` harus `true`
- jika live execution contract aktif, `dryRun=false` hanya boleh untuk `PRICE_THRESHOLD_REVERSION`
- `strategyConfig.orderSizeUsd` tidak boleh melewati `riskConfig.maxOrderSizeUsd`
- `riskConfig.maxExposurePerMarketUsd` tidak boleh melebihi `riskConfig.maxTotalExposureUsd`
- `riskConfig.cancelStaleAfterSeconds` tidak boleh lebih kecil dari `riskConfig.marketCooldownSeconds`

## Not Yet Implemented

- strategy live execution selain `PRICE_THRESHOLD_REVERSION`
- delivery alert keluar dari dashboard internal, misalnya webhook atau notifikasi eksternal