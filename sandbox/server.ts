const PORT = Number(process.env.PORT ?? 3000);
const JOB_ID = process.env.JOB_ID ?? "unknown";
const JOB_TYPE = process.env.JOB_TYPE ?? "unknown";
const STARTED_AT = new Date().toISOString();

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, jobId: JOB_ID });
    }
    return Response.json({
      jobId: JOB_ID,
      type: JOB_TYPE,
      startedAt: STARTED_AT,
      path: url.pathname,
      method: req.method,
    });
  },
});

console.log(`[sandbox] jobId=${JOB_ID} listening on :${server.port}`);
