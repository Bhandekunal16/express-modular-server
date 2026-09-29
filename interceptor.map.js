module.exports = {
  errorInterceptors: require("./interceptors/error.interceptor"),
  encryptionInterceptor: require("./interceptors/encryption.interceptor"),
  loggerInterceptor: require("./interceptors/logger.interceptor"),
};
