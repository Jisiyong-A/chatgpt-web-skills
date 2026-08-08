import { pino, type Logger } from 'pino';

let logger: Logger | null = null;

export function initLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  logger = pino({
    level,
    base: { service: 'chatgpt-web-provider' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return logger;
}

export function getLogger(): Logger {
  if (!logger) {
    throw new Error('Logger not initialized: call initLogger() first');
  }
  return logger;
}
