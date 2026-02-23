import winston from "winston";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const level = () => {
  const env = process.env.NODE_ENV || "development";
  const isDevelopment = env === "development";
  return isDevelopment ? "debug" : "info";
};

const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "grey",
};

winston.addColors(colors);

/** Dev: human-readable with colors and optional metadata */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize({ all: true }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr =
      Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `${timestamp} ${level}: ${message}${metaStr}${stackStr}`;
  }),
);

/** Production: JSON for parsing and querying */
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: "iso" }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const isProduction = process.env.NODE_ENV === "production";

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction ? productionFormat : devFormat,
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

export default logger;
