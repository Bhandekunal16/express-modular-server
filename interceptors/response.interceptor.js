const { performance } = require("node:perf_hooks");

module.exports = function responseLogger(req, res, next) {
  const start = performance.now();

  res.on("finish", () => {
    const duration = performance.now() - start;

    const resolvedRequestId =
    req.requestId || req.headers["x-request-id"] || "N/A";

    const { method, originalUrl } = req;

    console.log({
      requestId: resolvedRequestId,
      method,
      originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(duration.toFixed(2)),
      contentLength: res.getHeader("content-length") || 0,
    });
  });

  next();
};