module.exports = function sendBadGateway(proxyReq, res) {
  proxyReq.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    if (!res.writableEnded) res.end("Bad Gateway");
  });
};
