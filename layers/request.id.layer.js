const crypto = require("crypto");

module.exports = function requestId(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();

  req.requestId = requestId;

  res.setHeader("X-Request-ID", requestId);

  next();
};
