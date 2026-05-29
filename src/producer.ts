import { randomUUID } from "node:crypto";
import type { JobQueue } from "./queue.js";
import type { Job, JobType } from "./types.js";

const JOB_TYPES: JobType[] = ["http", "compute", "io"];

function randomJobType(): JobType {
  const idx = Math.floor(Math.random() * JOB_TYPES.length);
  return JOB_TYPES[idx]!;
}

export function createJob(type: JobType = "http"): Job {
  return {
    jobId: randomUUID().slice(0, 8),
    type,
    createdAt: Date.now(),
  };
}

export function startProducer(queue: JobQueue, intervalMs = 1000): () => void {
  const handle = setInterval(() => {
    const job = createJob(randomJobType());
    console.log(`[producer] enqueue jobId=${job.jobId} type=${job.type}`);
    queue.enqueue(job);
  }, intervalMs);
  return () => clearInterval(handle);
}
