import { EventEmitter } from "node:events";
import type { Job } from "./types.js";

export class JobQueue extends EventEmitter {
  private readonly jobs: Job[] = [];

  enqueue(job: Job): void {
    this.jobs.push(job);
    this.emit("job", job);
  }

  dequeue(): Job | undefined {
    return this.jobs.shift();
  }

  size(): number {
    return this.jobs.length;
  }
}
