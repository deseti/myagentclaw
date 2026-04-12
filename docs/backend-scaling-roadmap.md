# Backend Scaling Audit

Date: 2026-04-04

## Current Verdict

The shared backend is still safe to run as a single instance.

Current live snapshot from the running deployment:

- `myagentclaw_backend` CPU: about `0.06%`
- `myagentclaw_backend` memory: about `117 MiB`
- Redis memory: about `1.59 MiB / 256 MiB`
- 30 local `/health` requests completed with `200` responses
- Recent backend request logs show normal response times for common routes:
  - `/api/auth/me`: around `5-26ms`
  - `/api/skills/bundled` and `/api/skills/installed`: around `60-85ms`
  - Polymarket read routes: around `100-420ms`

The heavier resource usage is currently in dedicated OpenClaw runtimes, not in the shared backend API process.

## What This Means

- Keep one shared backend instance for now.
- Continue scaling at the runtime layer first: dedicated `openclaw` and `openclaw-adapter` containers per paid owner.
- Do not introduce two backend API instances yet, because the current code path still has single-instance assumptions.

## Current Scale Blockers For 2 Backends

### 1. Socket.IO is process-local

The backend attaches Socket.IO directly to the Fastify HTTP server in [backend/src/index.js](../backend/src/index.js#L125).

Impact if scaled to 2 backends:

- websocket rooms will exist only on the instance holding the client connection
- emits from the other instance will not reliably reach connected clients
- sticky sessions alone are not enough for cross-instance event delivery

Required fix:

- add a Redis adapter for Socket.IO so room membership and emits work across instances

### 2. Workers and cron start inside the web backend process

The backend starts BullMQ workers from [backend/src/index.js](../backend/src/index.js#L233), and the reminder cron runs in [backend/src/queues/reminder.worker.js](../backend/src/queues/reminder.worker.js#L139).

Impact if scaled to 2 backends:

- every backend instance will start workers
- cron schedules can run more than once
- reminder and follow-up processing can duplicate if not isolated carefully

Required fix:

- split worker and cron into dedicated services instead of booting them inside the web API container

### 3. Runtime provisioning is triggered from the web backend through Docker socket

Workspace runtime provisioning happens in [backend/src/lib/runtime-manager.js](../backend/src/lib/runtime-manager.js#L279) and uses the Docker socket directly.

Impact if scaled to 2 backends:

- concurrent requests can try to create or recreate the same dedicated containers
- race conditions can occur around container removal, creation, or startup checks

Required fix:

- add a distributed lock around owner runtime provisioning
- make create/start operations idempotent under concurrent requests

### 4. Some caches are in-memory per process

Examples:

- Polymarket cache in [backend/src/lib/polymarket-client.js](../backend/src/lib/polymarket-client.js#L7)
- skill search/detail caches in [backend/src/routes/skills.route.js](../backend/src/routes/skills.route.js#L19)

Impact if scaled to 2 backends:

- cache hit rate becomes inconsistent across instances
- not a correctness issue, but can increase external requests and latency

Required fix:

- acceptable to keep as-is initially
- later move hot shared caches to Redis if needed

## Important Operational Risk Found During Audit

BullMQ warns that Redis eviction policy should be `noeviction`, but the current compose uses `allkeys-lru`.

Current config is in [docker-compose.yml](../docker-compose.yml#L35).

Why it matters:

- under memory pressure Redis may evict queue-related keys
- that can corrupt queue reliability before backend CPU becomes a problem

Recommendation:

- change Redis policy from `allkeys-lru` to `noeviction`
- keep memory limit if desired, but monitor queue depth and failed jobs

## Recommended Roadmap To Reach 2 Safe Backend Instances

### Phase 1: Stabilize shared backend observability

- add basic backend metrics: request latency, error rate, active websocket count, queue depth, worker failures
- log provisioning duration for `ensureWorkspaceRuntime`
- track dedicated runtime creation rate and failure rate

Exit criteria:

- we can identify whether load is actually on web API, worker jobs, Polymarket routes, or runtime provisioning

### Phase 2: Separate web and background execution

- create a dedicated `backend-worker` service for BullMQ workers
- create a dedicated `backend-cron` service for scheduled jobs
- stop importing workers automatically from the web API entrypoint

Exit criteria:

- web backend only serves HTTP and websocket traffic
- workers and cron have exactly one controlled owner in production

### Phase 3: Make realtime multi-instance safe

- add `@socket.io/redis-adapter`
- use Redis pub/sub for room state and event fan-out
- place backend instances behind nginx with websocket support

Exit criteria:

- websocket clients receive events regardless of which backend instance emitted them

### Phase 4: Make runtime provisioning concurrent-safe

- add a distributed lock keyed by `ownerId` or `workspace.ownerId`
- wrap `ensureWorkspaceRuntime` with lock acquisition and timeout handling
- keep container creation idempotent and verify-after-create

Suggested lock backend:

- Redis `SET key value NX PX ttl`

Exit criteria:

- two backend instances cannot race to mutate the same owner runtime

### Phase 5: Scale the backend API to 2 instances

- run two `backend` containers behind nginx
- keep one worker service and one cron service
- validate login, dashboard realtime, skill install/uninstall, channel sync, and Polymarket flows under both instances

Exit criteria:

- no duplicate jobs
- no missing websocket events
- no provisioning races
- no auth/session regression

## Recommended Target Architecture

- `frontend`: 1 or more instances
- `backend-web`: 2 instances
- `backend-worker`: 1 instance
- `backend-cron`: 1 instance
- `redis`: 1 instance
- `postgres`: 1 primary instance
- `openclaw` shared: 1 instance
- `openclaw-adapter` shared: 1 instance
- dedicated `openclaw` and `openclaw-adapter`: per paid owner as needed

## Recommendation For Current State

Do not scale the web backend yet.

The current system is still comfortably within one shared backend instance, and the higher engineering value right now is to harden the architecture for safe scale-out rather than adding a second backend prematurely.