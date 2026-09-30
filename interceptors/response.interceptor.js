const { performance } = require("../provider/dependency.map");
const { WRITE_L0G } = require("../provider/config.map");
const append = require("../core/file.functions");

module.exports = function responseLogger(req, res, next) {
  const start = performance.now();

  res.on("finish", () => {
    const duration = performance.now() - start;

    const resolvedRequestId =
    req.requestId || req.headers["x-request-id"] || "N/A";

    const { method, originalUrl } = req;

    const response = {
      requestId: resolvedRequestId,
      method,
      originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(duration.toFixed(2)),
      contentLength: res.getHeader("content-length") || 0,
    }

    if (WRITE_L0G) append(JSON.stringify(response));

    console.log(`response: ${JSON.stringify(response)}`);
  });

  next();
};