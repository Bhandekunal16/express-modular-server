const { WRITE_L0G, exclude } = require("../provider/config.map");
const append = require("../core/file.functions");

module.exports = function logger(req, _, next) {
  const {
    method,
    originalUrl,
    url,
    baseUrl,
    path,
    protocol,
    hostname,
    host,
    ip,
    ips,
    params,
    query,
    body,
    headers,
  } = req;

  const resolvedRequestId =
    req.requestId || req.headers["x-request-id"] || "N/A";

  let request = {
    method,
    originalUrl,
    url,
    baseUrl,
    path,
    params,
    query,
    protocol,
    hostname,
    host,
    ip,
    ips,
    body,
    headers,
    requestId: resolvedRequestId,
  };

  if (exclude.length !== 0) {
    for (const property of exclude) {
      delete request[property];
    }
  }

  if (WRITE_L0G) append(JSON.stringify(request));

  console.log(`request: ${JSON.stringify(request)}`);

  next();
};
