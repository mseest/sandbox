import { JobQueue } from "./queue.js";
import { startProducer } from "./producer.js";
import { startConsumer } from "./consumer.js";
import { SandboxRegistry, verifyDocker, buildImages } from "./runner.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "orchestrator" });

await verifyDocker();
await buildImages();

const queue = new JobQueue();
const registry = new SandboxRegistry();

const stopConsumer = startConsumer(queue, registry);
const stopProducer = startProducer(queue, 2000);

log.info("producer + consumer running. Ctrl+C to stop.");

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutting down");
  stopProducer();
  stopConsumer();
  await registry.cleanup();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
