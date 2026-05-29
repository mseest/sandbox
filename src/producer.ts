import { randomUUID } from "node:crypto";
import type { JobQueue } from "./queue.js";
import type { Job, JobType } from "./types.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "producer" });

export function createJob(type: JobType = "http"): Job {
  return {
    jobId: randomUUID().slice(0, 8),
    type,
    createdAt: Date.now(),
  };
}

export function startProducer(queue: JobQueue, intervalMs = 2000): () => void {
  const handle = setInterval(() => {
    const job = createJob("http");
    log.info({ jobId: job.jobId, type: job.type }, "enqueue");
    queue.enqueue(job);
  }, intervalMs);
  return () => clearInterval(handle);
}
