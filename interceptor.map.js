module.exports = {
  errorInterceptors: require("./interceptors/error.interceptors"),
  encryptionInterceptor: require("./interceptors/encryption.interceptors"),
  loggerInterceptor: require("./interceptors/logger.interceptors"),
};
