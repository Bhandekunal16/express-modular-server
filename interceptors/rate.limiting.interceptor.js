const { rateLimit } = require("../dependency.map");
const {
  windowMs,
  limit,
  standardHeaders,
  legacyHeaders,
} = require("../json/rate-limiting.config.json");

module.exports = function limiter() {
  rateLimit({
    windowMs,
    limit,
    standardHeaders,
    legacyHeaders,
  });
};
