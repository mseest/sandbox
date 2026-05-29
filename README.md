# sandbox-orchestrator

A lightweight orchestration service that spins up an isolated Docker
sandbox **on demand**. Clients `POST /jobs` against the orchestrator's HTTP
API; each request runs a fresh container with our own `Bun.serve` HTTP
server inside and returns its URL.

This is the early scaffold of an orchestration platform for AI agent
sandboxes.

## Prerequisites

- [Bun](https://bun.com) `>= 1.3`
- [Docker](https://docs.docker.com/get-docker/) daemon running (Docker
  Desktop, OrbStack, colima, etc.)

Verify:

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
2. Build the sandbox image (`sandbox-runner:latest`) from `./sandbox`.
3. Start the HTTP API on port `8080` (override with `PORT=…`).

The orchestrator then idles — **no sandboxes are spawned until you ask
for one**. Press `Ctrl+C` to stop; any running sandbox containers are torn
down before exit.

## API

Base URL: `http://localhost:8080`.

### `POST /jobs` — spin up a sandbox

```bash
curl -X POST -H 'content-type: application/json' \
  -d '{"type":"http"}' http://localhost:8080/jobs
# {"jobId":"e8d15f6a","containerId":"9c69c3514607","url":"http://localhost:62043"}
```

Body is optional. `type` defaults to `"http"`. The response is returned
once the container has been created and its port has been mapped (~100-150ms).

### `GET /jobs` — list running sandboxes

```bash
curl http://localhost:8080/jobs
# [{"jobId":"e8d15f6a","containerId":"9c69c3514607","url":"http://localhost:62043"}]
```

### `DELETE /jobs/:jobId` — stop a sandbox

```bash
curl -X DELETE http://localhost:8080/jobs/e8d15f6a
# 204 No Content
```

### `GET /health` — orchestrator health

```bash
curl http://localhost:8080/health
# {"ok":true}
```

## Test a sandbox

Use the `url` returned by `POST /jobs`:

```bash
curl http://localhost:62043/
# {"jobId":"e8d15f6a","type":"http","startedAt":"...","path":"/","method":"GET"}

curl http://localhost:62043/health
# {"ok":true,"jobId":"e8d15f6a"}
```

Or list containers directly:

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
│   ├── index.ts        # entrypoint: preflight, wires queue/consumer/api
│   ├── api.ts          # Bun.serve admin API (POST/GET/DELETE /jobs)
│   ├── queue.ts        # in-memory EventEmitter-backed JobQueue
│   ├── producer.ts     # createJob() — used by the API on demand
│   ├── consumer.ts     # reacts to "job" events, awaits sandbox start
│   ├── runner.ts       # docker primitives, registry, pending-job promises
│   ├── logger.ts       # pino logger
│   └── types.ts        # Job, JobType
└── sandbox/            # image build context (one image, reused per job)
    ├── Dockerfile      # FROM oven/bun:1-alpine, runs server.ts
    └── server.ts       # Bun.serve, reads JOB_ID / JOB_TYPE from env
```

## How it works

- The orchestrator process holds the queue and registry in memory.
- `POST /jobs` (`src/api.ts`) calls `createJob()`, enqueues it, and
  awaits a one-shot promise tied to that `jobId`.
- The consumer (`src/consumer.ts`) reacts to the queue's `"job"` event,
  runs `startHttpSandbox(job)`, registers the result, and resolves the
  pending promise so the HTTP response returns synchronously.
- `startHttpSandbox` runs:
  ```bash
  docker run -d --rm --name sandbox-<jobId> -p :3000 \
    -e JOB_ID=<jobId> -e JOB_TYPE=<type> sandbox-runner:latest
  ```
  then `docker port <id> 3000/tcp` to learn the randomly-assigned host port.
- Each container is tracked in `SandboxRegistry`. On `SIGINT` / `SIGTERM`,
  every tracked container is `docker rm -f`'d, plus a safety-net sweep
  for any orphan named `sandbox-*`.

## Cleanup if something leaks

```bash
docker rm -f $(docker ps -aq --filter "name=sandbox-")
```
