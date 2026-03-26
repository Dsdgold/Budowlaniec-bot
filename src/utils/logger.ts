/**
 * Logger aplikacji oparty na Winston
 * Rozszerzony o metody trace/fatal/child wymagane przez Baileys
 */
import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Format logu: [timestamp] [level] message
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] ${stack || message}${metaStr}`;
});

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), logFormat),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

/**
 * Wrapper loggera kompatybilny z Baileys (pino-compatible)
 * Baileys wymaga: trace, debug, info, warn, error, fatal, child, level
 */
const logger: any = {
  level: process.env.LOG_LEVEL || 'info',
  trace: (msg: any, ...args: any[]) => winstonLogger.silly(typeof msg === 'object' ? JSON.stringify(msg) : msg, ...args),
  debug: (msg: any, ...args: any[]) => winstonLogger.debug(typeof msg === 'object' ? JSON.stringify(msg) : msg, ...args),
  info: (msg: any, ...args: any[]) => winstonLogger.info(typeof msg === 'object' ? JSON.stringify(msg) : msg, ...args),
  warn: (msg: any, ...args: any[]) => winstonLogger.warn(typeof msg === 'object' ? JSON.stringify(msg) : msg, ...args),
  error: (msg: any, ...args: any[]) => winstonLogger.error(typeof msg === 'object' ? JSON.stringify(msg) : msg, ...args),
  fatal: (msg: any, ...args: any[]) => winstonLogger.error(typeof msg === 'object' ? JSON.stringify(msg) : msg, ...args),
  child: () => logger, // Baileys wywołuje logger.child() — zwracamy ten sam logger
};

export { logger };
export default logger;
