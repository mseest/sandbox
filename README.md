# sandbox-orchestrator

A lightweight job queue that spins up an isolated Docker sandbox per job.
Each sandbox runs a `Bun.serve` HTTP server inside a container; the
orchestrator logs its public URL.

This is the early scaffold of an orchestration platform for AI agent
sandboxes — task 1 is the queue, task 2 is one container per job.

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
2. Build the sandbox image (`sandbox-runner:latest`) from `./sandbox`.
3. Start the producer (1 job every 2 seconds) and consumer.
4. For each job, run a fresh container and log its URL.

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

While the orchestrator is running, hit any URL it logged:

```bash
curl http://localhost:61781/
# {"jobId":"edbac39c","type":"http","startedAt":"2026-05-29T08:27:58.036Z","path":"/","method":"GET"}

curl http://localhost:61781/health
# {"ok":true,"jobId":"edbac39c"}
```

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
│   ├── index.ts        # entrypoint: preflight + wires producer/consumer/registry
│   ├── queue.ts        # in-memory EventEmitter-backed JobQueue
│   ├── producer.ts     # emits a job every N ms
│   ├── consumer.ts     # reacts to "job" events, awaits sandbox start
│   ├── runner.ts       # docker primitives: verify / build / start / stop / registry
│   └── types.ts        # Job, JobType
└── sandbox/            # image build context (one image, reused per job)
    ├── Dockerfile      # FROM oven/bun:1-alpine, runs server.ts
    └── server.ts       # Bun.serve, reads JOB_ID / JOB_TYPE from env
```

## How it works

- The orchestrator process keeps the queue and registry in memory.
- Producer enqueues `{ jobId, type, createdAt }`.
- The queue is an `EventEmitter`; the consumer reacts to `"job"`.
- For each job, the consumer runs:
  ```bash
  docker run -d --rm --name sandbox-<jobId> -p :3000 \
    -e JOB_ID=<jobId> -e JOB_TYPE=<type> sandbox-runner:latest
  ```
  then `docker port <id> 3000/tcp` to learn the randomly-assigned host port.
- Each container is tracked in a `SandboxRegistry`. On `SIGINT` / `SIGTERM`,
  every tracked container is `docker rm -f`’d, plus a safety-net sweep for any
  orphan named `sandbox-*`.

## Cleanup if something leaks

```bash
docker rm -f $(docker ps -aq --filter "name=sandbox-")
```
