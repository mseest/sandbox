import { $ } from "bun";
import type { Job } from "./types.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "runner" });

const IMAGE = "sandbox-runner:latest";
const BUILD_CONTEXT = "./sandbox";
const CONTAINER_PORT = 3000;
const NAME_PREFIX = "sandbox-";

export interface RunningSandbox {
  jobId: string;
  containerId: string;
  url: string;
}

export async function verifyDocker(): Promise<void> {
  try {
    await $`docker version --format {{.Server.Version}}`.quiet();
  } catch {
    throw new Error("Docker is not available. Is the daemon running?");
  }
}

export async function buildImage(): Promise<void> {
  log.info({ image: IMAGE, context: BUILD_CONTEXT }, "building image");
  await $`docker build -q -t ${IMAGE} ${BUILD_CONTEXT}`.quiet();
}

export async function startHttpSandbox(job: Job): Promise<RunningSandbox> {
  const name = `${NAME_PREFIX}${job.jobId}`;
  const portMap = `:${CONTAINER_PORT}`;
  const jobIdEnv = `JOB_ID=${job.jobId}`;
  const jobTypeEnv = `JOB_TYPE=${job.type}`;

  const fullId = (
    await $`docker run -d --rm --name ${name} -p ${portMap} -e ${jobIdEnv} -e ${jobTypeEnv} ${IMAGE}`.text()
  ).trim();

  const portInfo = (
    await $`docker port ${fullId} ${CONTAINER_PORT}/tcp`.text()
  ).trim();
  const firstLine = portInfo.split("\n")[0] ?? "";
  const hostPort = firstLine.split(":").pop();
  if (!hostPort) {
    await stopSandbox(fullId);
    throw new Error(`could not read mapped port from: ${portInfo}`);
  }

  return {
    jobId: job.jobId,
    containerId: fullId.slice(0, 12),
    url: `http://localhost:${hostPort}`,
  };
}

export async function stopSandbox(containerId: string): Promise<void> {
  try {
    await $`docker rm -f ${containerId}`.quiet();
  } catch {
    // best-effort
  }
}

interface Pending {
  resolve: (sb: RunningSandbox) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

export function awaitJobReady(
  jobId: string,
  timeoutMs = 30_000,
): Promise<RunningSandbox> {
  return new Promise<RunningSandbox>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(jobId);
      reject(new Error(`timed out waiting for job ${jobId}`));
    }, timeoutMs);
    pending.set(jobId, { resolve, reject, timer });
  });
}

export function notifyJobReady(jobId: string, sb: RunningSandbox): void {
  const p = pending.get(jobId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(jobId);
  p.resolve(sb);
}

export function notifyJobFailed(jobId: string, err: Error): void {
  const p = pending.get(jobId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(jobId);
  p.reject(err);
}

async function findOrphanSandboxes(): Promise<string[]> {
  try {
    const out = (
      await $`docker ps -q --filter name=${NAME_PREFIX}`.text()
    ).trim();
    if (!out) return [];
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export class SandboxRegistry {
  private readonly sandboxes = new Map<string, RunningSandbox>();

  add(sb: RunningSandbox): void {
    this.sandboxes.set(sb.jobId, sb);
  }

  get(jobId: string): RunningSandbox | undefined {
    return this.sandboxes.get(jobId);
  }

  remove(jobId: string): void {
    this.sandboxes.delete(jobId);
  }

  list(): RunningSandbox[] {
    return [...this.sandboxes.values()];
  }

  async cleanup(): Promise<void> {
    const known = this.list();
    const knownIds = new Set(known.map((sb) => sb.containerId));
    const orphans = (await findOrphanSandboxes()).filter(
      (id) => !knownIds.has(id.slice(0, 12)),
    );

    const total = known.length + orphans.length;
    if (total === 0) return;
    log.info(
      { total, tracked: known.length, orphans: orphans.length },
      "stopping sandboxes",
    );

    await Promise.all([
      ...known.map((sb) => stopSandbox(sb.containerId)),
      ...orphans.map((id) => stopSandbox(id)),
    ]);
    this.sandboxes.clear();
  }
}
