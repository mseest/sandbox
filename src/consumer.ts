import type { JobQueue } from "./queue.js";
import type { Job } from "./types.js";

function logWork(job: Job): void {
  const waitedMs = Date.now() - job.createdAt;
  console.log(
    `[consumer] processing jobId=${job.jobId} type=${job.type} waited=${waitedMs}ms`,
  );
}

export function startConsumer(queue: JobQueue): () => void {
  const handler = (_job: Job): void => {
    const next = queue.dequeue();
    if (next) logWork(next);
  };
  queue.on("job", handler);
  return () => queue.off("job", handler);
}
