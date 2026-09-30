function sendGatewayTimeout(res) {
  if (!res.headersSent) res.writeHead(504);
  if (!res.writableEnded) res.end("Gateway Timeout");
}

function updateResponseTimeout(proxyRes, res, timeout) {
  proxyRes.setTimeout(timeout, () => {
    proxyRes.destroy();
    sendGatewayTimeout(res);
  });
}

function updateRequestTimeout(proxyReq, res, timeout) {
  proxyReq.setTimeout(timeout, () => {
    proxyReq.destroy();
    sendGatewayTimeout(res);
  });
}

module.exports = { updateResponseTimeout, updateRequestTimeout };
