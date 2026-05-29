import { JobQueue } from "./queue.js";
import { startProducer } from "./producer.js";
import { startConsumer } from "./consumer.js";

const queue = new JobQueue();

const stopConsumer = startConsumer(queue);
const stopProducer = startProducer(queue, 1000);

console.log("[orchestrator] producer + consumer running. Ctrl+C to stop.");

const shutdown = (): void => {
  console.log("\n[orchestrator] shutting down...");
  stopProducer();
  stopConsumer();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
