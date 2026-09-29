const { express, cors } = require("./dependency.map");

const {
  errorInterceptor,
  encryption_Interceptor,
  logger_interceptor,
  helmet_interceptor,
  rateLimiting
} = require("./json/config.json");

const {
  errorInterceptors,
  encryptionInterceptor,
  loggerInterceptor,
  helmetInterceptor,
  rateLimitInterceptor
} = require("./interceptor.map");

function middleware(app) {
  if (helmet_interceptor) app.use(helmetInterceptor);

  app.use(cors());
  app.use(express.json());

  if (encryption_Interceptor) app.use(encryptionInterceptor);
  if (logger_interceptor) app.use(loggerInterceptor);
  if (rateLimiting) app.use(rateLimitInterceptor)
}

function errorMiddleware(app) {
  if (errorInterceptor) app.use(errorInterceptors);
}

module.exports = { middleware, errorMiddleware };
