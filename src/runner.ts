import { $ } from "bun";
import type { Job } from "./types.js";
import { SANDBOX_TYPES, getSandboxConfig } from "./sandbox-types.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "runner" });

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

export async function buildImages(): Promise<void> {
  const seen = new Set<string>();
  for (const [type, cfg] of Object.entries(SANDBOX_TYPES)) {
    if (!cfg.build || seen.has(cfg.image)) continue;
    seen.add(cfg.image);
    log.info(
      { type, image: cfg.image, context: cfg.build.context },
      "building image",
    );
    await $`docker build -q -t ${cfg.image} ${cfg.build.context}`.quiet();
  }
}

export async function startSandbox(job: Job): Promise<RunningSandbox> {
  const cfg = getSandboxConfig(job.type);
  const name = `${NAME_PREFIX}${job.jobId}`;
  const portMap = `:${cfg.containerPort}`;
  const envArgs = [
    "-e",
    `JOB_ID=${job.jobId}`,
    "-e",
    `JOB_TYPE=${job.type}`,
    ...Object.entries(cfg.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
  ];
  const extraArgs = cfg.dockerArgs ?? [];
  const cmd = cfg.cmd ?? [];

  const fullId = (
    await $`docker run -d --rm --name ${name} -p ${portMap} ${extraArgs} ${envArgs} ${cfg.image} ${cmd}`.text()
  ).trim();

  const portInfo = (
    await $`docker port ${fullId} ${cfg.containerPort}/tcp`.text()
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
