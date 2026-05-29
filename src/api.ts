import type { JobQueue } from "./queue.js";
import { createJob } from "./producer.js";
import type { JobType } from "./types.js";
import {
  awaitJobReady,
  stopSandbox,
  type SandboxRegistry,
} from "./runner.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "api" });

const VALID_TYPES: ReadonlySet<JobType> = new Set(["http", "compute", "io"]);

interface CreateJobBody {
  type?: JobType;
}

export interface ApiServer {
  port: number;
  stop: () => Promise<void>;
}

export function startApi(
  queue: JobQueue,
  registry: SandboxRegistry,
  port = Number(process.env.PORT ?? 8080),
): ApiServer {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (req.method === "GET" && path === "/health") {
        return Response.json({ ok: true });
      }

      if (req.method === "POST" && path === "/jobs") {
        const body = (await req
          .json()
          .catch(() => ({}))) as CreateJobBody;
        const type = body.type ?? "http";
        if (!VALID_TYPES.has(type)) {
          return Response.json(
            { error: `invalid type: ${type}` },
            { status: 400 },
          );
        }
        const job = createJob(type);
        log.info({ jobId: job.jobId, type }, "request received");
        const ready = awaitJobReady(job.jobId);
        queue.enqueue(job);
        try {
          const sb = await ready;
          return Response.json(sb, { status: 201 });
        } catch (err) {
          return Response.json(
            { error: (err as Error).message, jobId: job.jobId },
            { status: 500 },
          );
        }
      }

      if (req.method === "GET" && path === "/jobs") {
        return Response.json(registry.list());
      }

      const deleteMatch = path.match(/^\/jobs\/([^/]+)$/);
      if (req.method === "DELETE" && deleteMatch) {
        const jobId = deleteMatch[1]!;
        const sb = registry.get(jobId);
        if (!sb) {
          return Response.json(
            { error: `no sandbox for jobId=${jobId}` },
            { status: 404 },
          );
        }
        await stopSandbox(sb.containerId);
        registry.remove(jobId);
        log.info({ jobId, containerId: sb.containerId }, "stopped");
        return new Response(null, { status: 204 });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  const boundPort = server.port ?? port;
  log.info({ port: boundPort }, "api listening");
  return {
    port: boundPort,
    stop: async () => {
      await server.stop();
    },
  };
}
