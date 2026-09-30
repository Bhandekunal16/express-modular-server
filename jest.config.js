/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/test/setup/jest.setup.js"],
  collectCoverageFrom: [
    "provider/**/*.js",
    "layers/**/*.js",
    "interceptors/**/*.js",
    "core/**/*.js",
    "middleware.loader.js",
    "createExpressApp.js",
    "createProxyServer.js",
    "proxy.js",
    "!**/node_modules/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "text-summary", "lcov"],
  transform: {},
};
