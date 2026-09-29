const { express, cors } = require("./dependency.map");

const {
  errorInterceptor,
  encryption_Interceptor,
  logger_interceptor,
} = require("./json/config.json");

const {
  errorInterceptors,
  encryptionInterceptor,
  loggerInterceptor,
} = require("./interceptor.map");

function middleware(app) {
  app.use(cors());
  app.use(express.json());

  if (encryption_Interceptor) app.use(encryptionInterceptor);
  if (logger_interceptor) app.use(loggerInterceptor);
}

function errorMiddleware(app) {
  if (errorInterceptor) app.use(errorInterceptors);
}

module.exports = { middleware, errorMiddleware };
