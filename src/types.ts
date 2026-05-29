export type JobType = "http" | "compute" | "io";

export interface Job {
  jobId: string;
  type: JobType;
  createdAt: number;
  payload?: Record<string, unknown>;
}
