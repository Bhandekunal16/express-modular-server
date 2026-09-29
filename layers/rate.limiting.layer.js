const {
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS,
} = require("../json/rate-limiting.config.json");

const clients = new Map();

module.exports = function rateLimiter(req, res) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  let client = clients.get(ip);

  if (!client || now - client.start >= WINDOW_MS) {
    client = { start: now, count: 0 };
    clients.set(ip, client);
  }

  client.count++;

  const remaining = Math.max(0, MAX_REQUESTS - client.count);

  res.setHeader("RateLimit-Limit", MAX_REQUESTS);
  res.setHeader("RateLimit-Remaining", remaining);

  if (client.count > MAX_REQUESTS) {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": Math.ceil((WINDOW_MS - (now - client.start)) / 1000),
    });

    res.end(
      JSON.stringify({
        status: false,
        statusCode: 429,
        message: "Too Many Requests",
      }),
    );

    return false;
  }

  return true;
};
