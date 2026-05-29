# CLAUDE.md

Context for agents and contributors working in this repo. See `README.md`
for the user-facing overview, prerequisites, and example output — this
file covers conventions, gotchas, and *why* things are the way they are.

## What this is

An early scaffold for an AI-agent sandbox orchestration platform.
Currently: an in-memory job queue + a consumer that spins up one Docker
container per job and tracks it in a registry. Intentionally small —
prefer extending the existing primitives over introducing frameworks.

## Runtime and tooling

- **Bun, not Node.** Scripts run via `bun run`, shell out via `$` from
  the `bun` package, and the sandbox image is `oven/bun:1-alpine`. Don't
  reach for `child_process` / `execa` — match the existing `$\`...\``
  style in `src/runner.ts`.
- **TypeScript ESM with `.js` import specifiers.** Source files import
  siblings as `./foo.js` even though the file is `foo.ts` — this is
  required by `moduleResolution: "bundler"` + ESM. Keep the `.js`
  extension when adding new imports.
- **`strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`.**
  Array/string indexing returns `T | undefined`; handle the undefined
  case explicitly (see how `runner.ts` parses `docker port` output).
- **Single `tsconfig.json`** — `bun run typecheck` is the canonical
  check. Run it before declaring work done.

## Architecture, briefly

- `src/index.ts` — entrypoint. Preflights Docker, builds the image once,
  wires `JobQueue` + `SandboxRegistry` to producer and consumer, and
  installs SIGINT/SIGTERM handlers for cleanup.
- `src/queue.ts` — `EventEmitter`-backed queue. `enqueue` pushes and
  emits `"job"`; the consumer reacts and `dequeue`s.
- `src/producer.ts` / `src/consumer.ts` — both return a `stop()`
  closure. Follow that pattern for any new long-running component so
  shutdown stays composable.
- `src/runner.ts` — all Docker primitives live here. `SandboxRegistry`
  owns tracked containers and, on cleanup, also sweeps orphans matching
  `sandbox-*` as a safety net. Don't shell out to Docker from elsewhere.
- `sandbox/` — image build context. One image is reused per job;
  per-job behavior comes from `JOB_ID` / `JOB_TYPE` env vars, not from
  separate images.

## Conventions

- **Container naming**: `sandbox-<jobId>`. The registry cleanup and the
  orphan sweep both rely on this prefix — don't change it casually.
- **One Docker image, many containers.** If a job needs different
  behavior, branch inside `sandbox/server.ts` on `JOB_TYPE` before
  considering a second image.
- **Logging is in transition.** `src/logger.ts` configures `pino` (+
  `pino-pretty` in dev), but most code still uses `console.log` with a
  `[component]` prefix. New code can adopt the pino logger; if you do,
  consider migrating siblings in the same file for consistency.
- **Errors in best-effort cleanup paths are swallowed** (see
  `stopSandbox`, `findOrphanSandboxes`). That's intentional — cleanup
  must not throw during shutdown. Don't "fix" these by rethrowing.

## Gotchas

- **Docker must be running** for `bun start`. `verifyDocker()` will
  throw a clear error if not. `bun run typecheck` does not need Docker.
- **First `bun start` builds the image** (`sandbox-runner:latest`).
  Subsequent runs are fast because Docker caches layers; if you change
  `sandbox/Dockerfile` or `sandbox/server.ts`, the rebuild happens
  automatically on next start.
- **If something leaks**, the README has the one-liner:
  `docker rm -f $(docker ps -aq --filter "name=sandbox-")`.
- **Job IDs are short** (`randomUUID().slice(0, 8)`) — fine for a
  scaffold, but assume collisions become possible if you scale this up.

## When making changes

- Prefer editing existing files over adding new ones. The whole `src/`
  tree is < 200 lines — keep it that way unless the task genuinely
  needs more.
- If you add a new long-running component, return a `stop()` closure
  and wire it into `index.ts`'s shutdown path.
- If you add Docker operations, add them to `src/runner.ts` so cleanup
  stays centralized.
- After changes: `bun run typecheck`. For end-to-end behavior, `bun
  start` and watch a couple of jobs cycle, then Ctrl+C and confirm
  `docker ps --filter name=sandbox-` is empty.
