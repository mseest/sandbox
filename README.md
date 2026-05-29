# sandbox-orchestrator

A lightweight job queue that spins up an isolated Docker sandbox per job.
Each sandbox runs a `Bun.serve` HTTP server inside a container; the
orchestrator logs its public URL.

This is the early scaffold of an orchestration platform for AI agent
sandboxes — task 1 is the queue, task 2 is one container per job, task 3
is multiple sandbox types (an `http` echo server and a `browser` Chrome
container with CDP exposed).

## Prerequisites

- [Bun](https://bun.com) `>= 1.3`
- [Docker](https://docs.docker.com/get-docker/) daemon running (Docker
  Desktop, OrbStack, colima, etc.)

Verify both are available:

```bash
bun --version
docker version --format '{{.Server.Version}}'
```

## Install

```bash
bun install
```

## Run

```bash
bun start
```

On first run the orchestrator will:

1. Verify the Docker daemon is reachable.
2. Build any local sandbox images declared in `SANDBOX_TYPES` (currently
   `sandbox-runner:latest` from `./sandbox`). External images like
   `chromedp/headless-shell` are pulled on first use by `docker run`.
3. Start the producer (1 job every 2 seconds) and consumer.
4. For each job, run a fresh container of the type's image and log its URL.

Example output:

```
[runner] building sandbox-runner:latest from ./sandbox...
[orchestrator] producer + consumer running. Ctrl+C to stop.
[producer] enqueue jobId=edbac39c type=http
[consumer] start    jobId=edbac39c type=http waited=1ms
[consumer] ready    jobId=edbac39c container=cab8bab3db9e url=http://localhost:61781 took=140ms
```

Press `Ctrl+C` to stop. All running sandbox containers are torn down before exit.

## Test a sandbox

While the orchestrator is running, hit any URL it logged.

**`http` type** — the Bun.serve echo server:

```bash
curl http://localhost:61781/
# {"jobId":"edbac39c","type":"http","startedAt":"2026-05-29T08:27:58.036Z","path":"/","method":"GET"}

curl http://localhost:61781/health
# {"ok":true,"jobId":"edbac39c"}
```

**`browser` type** — Chrome with Chrome DevTools Protocol on port 9222.
The URL maps to the CDP HTTP endpoint; clients fetch `/json/version` to
discover the WebSocket URL for full CDP control:

```bash
curl http://localhost:62364/json/version
# {
#   "Browser": "Chrome/148.0.7778.97",
#   "Protocol-Version": "1.3",
#   ...
#   "webSocketDebuggerUrl": "ws://localhost:62364/devtools/browser/6f2e1d94-..."
# }
```

The default producer only emits `http` jobs. To exercise the `browser`
type today, import `startSandbox` directly (see
`src/runner.ts:startSandbox`) — a public job API is out of scope for
this scaffold.

You can also list running sandboxes directly with Docker:

```bash
docker ps --filter "name=sandbox-"
```

## Typecheck

```bash
bun run typecheck
```

## Project layout

```
.
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # entrypoint: preflight + wires producer/consumer/registry
│   ├── queue.ts          # in-memory EventEmitter-backed JobQueue
│   ├── producer.ts       # emits a job every N ms
│   ├── consumer.ts       # reacts to "job" events, awaits sandbox start
│   ├── runner.ts         # docker primitives: verify / build / start / stop / registry
│   ├── sandbox-types.ts  # SANDBOX_TYPES registry (one entry per sandbox kind)
│   └── types.ts          # Job, JobType
└── sandbox/              # build context for the `http` image
    ├── Dockerfile        # FROM oven/bun:1-alpine, runs server.ts
    └── server.ts         # Bun.serve, reads JOB_ID / JOB_TYPE from env
```

## How it works

- The orchestrator process keeps the queue and registry in memory.
- Producer enqueues `{ jobId, type, createdAt }`.
- The queue is an `EventEmitter`; the consumer reacts to `"job"`.
- For each job, `startSandbox(job)` looks up `SANDBOX_TYPES[job.type]`
  and runs:
  ```bash
  docker run -d --rm --name sandbox-<jobId> -p :<containerPort> \
    <dockerArgs> -e JOB_ID=<jobId> -e JOB_TYPE=<type> <env> \
    <image> <cmd>
  ```
  then `docker port <id> <containerPort>/tcp` to learn the
  randomly-assigned host port.
- Each container is tracked in a `SandboxRegistry`. On `SIGINT` / `SIGTERM`,
  every tracked container is `docker rm -f`’d, plus a safety-net sweep for any
  orphan named `sandbox-*`.

## Adding a sandbox type

The registry in `src/sandbox-types.ts` is the single source of truth for
job types. To add a new type:

1. Add an entry to `SANDBOX_TYPES`:
   ```ts
   redis: {
     image: "redis:7-alpine",
     containerPort: 6379,
   },
   ```
2. If the image is built locally, set `build: { context: "./sandbox/<name>" }`
   and drop a `Dockerfile` there. Otherwise the image is pulled on first
   `docker run`.
3. Optional: `env`, `dockerArgs` (e.g. `--shm-size=2g`), `cmd` to override
   the image's CMD.

The new key is automatically picked up by `buildImages()` (if `build` is
set), accepted by the consumer, and added to the `JobType` union — no
changes needed in `runner.ts`, `consumer.ts`, `index.ts`, or `types.ts`.

The `browser` type uses `chromedp/headless-shell` with `--shm-size=2g`
(the default 64 MB `/dev/shm` is too small for Chrome). The image's
`run.sh` entrypoint already starts Chrome with the right CDP flags, so
no `cmd` override is needed.

## Cleanup if something leaks

```bash
docker rm -f $(docker ps -aq --filter "name=sandbox-")
```
