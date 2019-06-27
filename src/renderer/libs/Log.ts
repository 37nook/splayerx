import { ILog } from '@/interfaces/ILog';
import electron from 'electron';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { join } from 'path';
import Sentry from '../../shared/sentry';
import { ELECTRON_CACHE_DIRNAME, DEFAULT_LOG_DIRNAME } from '@/constants';

const app = electron.app || electron.remote.app;
const defaultPath = join(app.getPath(ELECTRON_CACHE_DIRNAME), DEFAULT_LOG_DIRNAME);

const transport = new DailyRotateFile({
  filename: `${defaultPath}/%DATE%.log`,
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

const logger = winston.createLogger({
  format: winston.format.combine(winston.format.printf((info) => {
    if (info.stack) {
      return `${info.time} - ${info.level}: ${info.message}-${info.stack}`;
    }
    return `${info.time} - ${info.level}: ${info.message}`;
  })),
  transports: [ transport ],
});

export default class Log implements ILog {
  private log(level: string, message: string, stack?: string | undefined) {
    if (level in console) console[level](message);
    else console.log(message);

    try {
      logger.log({
        time: new Date().toISOString(),
        level,
        message: message,
        stack: stack
      });
    } catch (error) {}
  }
  /**
   * @description 记录程序状态日志
   * @author tanghaixiang
   * @param {string} label 类名或者文件名
   * @param {string} message 打印信息
   */
  info(label: string, message: string, stack?: string | undefined): void {
    this.log('info', message, stack);
  }
  /**
   * @description 记录逻辑和程序出错日志
   * @author tanghaixiang
   * @param {string} label 类名或者文件名
   * @param {(string | Error)} message 错误信息
   */
  error(label: string, message: string | Error): void {
    if (message instanceof Error) {
      this.log('error', message.message, message.stack);
    } else {
      this.log('error', message);
    }
    if (process.env.NODE_ENV !== 'development') {
      Sentry.captureException(message);
    } else {
      console.error(message);
    }
  }
}

export const log = new Log();
