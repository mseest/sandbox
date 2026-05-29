export interface SandboxTypeConfig {
  image: string;
  containerPort: number;
  env?: Record<string, string>;
  dockerArgs?: string[];
  cmd?: string[];
  build?: { context: string };
}

const REGISTRY = {
  http: {
    image: "sandbox-runner:latest",
    containerPort: 3000,
    build: { context: "./sandbox" },
  },
  browser: {
    image: "chromedp/headless-shell:latest",
    containerPort: 9222,
    dockerArgs: ["--shm-size=2g"],
  },
} as const satisfies Record<string, SandboxTypeConfig>;

export type JobType = keyof typeof REGISTRY;

export const SANDBOX_TYPES: Record<JobType, SandboxTypeConfig> = REGISTRY;

export function getSandboxConfig(type: JobType): SandboxTypeConfig {
  return SANDBOX_TYPES[type];
}
