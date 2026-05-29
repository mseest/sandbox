import type { JobType } from "./sandbox-types.js";

export type { JobType };

export interface Job {
  jobId: string;
  type: JobType;
  createdAt: number;
  payload?: Record<string, unknown>;
}
