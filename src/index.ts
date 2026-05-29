import { JobQueue } from "./queue.js";
import { startConsumer } from "./consumer.js";
import { SandboxRegistry, verifyDocker, buildImage } from "./runner.js";
import { startApi } from "./api.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "orchestrator" });

await verifyDocker();
await buildImage();

const queue = new JobQueue();
const registry = new SandboxRegistry();

const stopConsumer = startConsumer(queue, registry);
const api = startApi(queue, registry);

log.info(
  { port: api.port },
  "orchestrator ready. POST /jobs to spin up a sandbox. Ctrl+C to stop.",
);

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down");
  await api.stop();
  stopConsumer();
  await registry.cleanup();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
