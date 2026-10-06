const { performance } = require("node:perf_hooks");
const { randomUUID } = require("crypto");

module.exports = {
  express: require("express"),
  http: require("http"),
  cors: require("cors"),
  fs: require("fs"),
  path: require("path"),
  cluster: require("cluster"),
  os: require("os"),
  helmet: require("helmet"),
  rateLimit: require("express-rate-limit"),
  logByte: require("log-byte"),
  randomUUID,
  performance,
};
