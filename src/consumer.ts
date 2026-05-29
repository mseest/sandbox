import type { JobQueue } from "./queue.js";
import type { Job } from "./types.js";
import {
  startHttpSandbox,
  notifyJobReady,
  notifyJobFailed,
  type SandboxRegistry,
} from "./runner.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "consumer" });

async function processJob(job: Job, registry: SandboxRegistry): Promise<void> {
  const waitedMs = Date.now() - job.createdAt;
  log.info({ jobId: job.jobId, type: job.type, waitedMs }, "start");
  try {
    const sb = await startHttpSandbox(job);
    registry.add(sb);
    const elapsedMs = Date.now() - job.createdAt;
    log.info(
      {
        jobId: sb.jobId,
        containerId: sb.containerId,
        url: sb.url,
        elapsedMs,
      },
      "ready",
    );
    notifyJobReady(job.jobId, sb);
  } catch (err) {
    log.error({ jobId: job.jobId, err }, "failed");
    notifyJobFailed(job.jobId, err as Error);
  }
}

export function startConsumer(
  queue: JobQueue,
  registry: SandboxRegistry,
): () => void {
  const handler = (_job: Job): void => {
    const next = queue.dequeue();
    if (next) void processJob(next, registry);
  };
  queue.on("job", handler);
  return () => queue.off("job", handler);
}
