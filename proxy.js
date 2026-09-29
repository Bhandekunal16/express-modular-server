const http = require("http");

const {
  host: TARGET_HOST,
  port: TARGET_PORT,
  proxyPort,
} = require("./json/app.json");

const rateLimiter = require("./layers/rate.limiting.layer");
const { rateLimiting } = require("./json/config.json");

const server = http.createServer((req, res) => {
  if (rateLimiting && !rateLimiter(req, res)) {
    return;
  }

  const { url: path, method, headers } = req;

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path,
    method,
    headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const { statusCode, headers } = proxyRes;
    res.writeHead(statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error("Proxy error:", e.message);

    if (!res.headersSent) {
      res.writeHead(502);
    }

    res.end("Bad Gateway");
  });

  req.pipe(proxyReq);
});

server.listen(proxyPort, TARGET_HOST, () => {
  console.log(`http://${TARGET_HOST}:${proxyPort}`);
});
