import pino from 'pino';

/**
 * 统一日志入口。
 *
 * - production: 输出 JSON,适合 pm2 滚动/日志聚合采集
 * - 其他: 通过 pino-pretty 输出人类可读格式
 *
 * 使用:
 *   import logger from '../utils/logger';
 *   logger.info('开始处理');
 *   logger.warn({ userId }, '配额接近上限');
 *   logger.error({ err }, '生成失败');
 *
 * 注意:第一个参数对象 = 结构化字段(可被日志系统查询),第二个 = 人类可读消息。
 */
const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
    level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
    base: { service: 'docflow-backend' },
    redact: {
        // 默认脱敏字段 — 防止密码、token 进日志
        paths: [
            'password',
            'passwordHash',
            'token',
            '*.password',
            '*.passwordHash',
            '*.token',
            'req.headers.authorization',
            'req.headers.cookie',
            'authorization',
        ],
        censor: '[REDACTED]',
    },
    transport: isProd
        ? undefined
        : {
              target: 'pino-pretty',
              options: {
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,service',
              },
          },
});

export default logger;
