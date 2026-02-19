import { createLogger, format, transports } from 'winston'

const isProduction = process.env.NODE_ENV === 'production'

export const logger = createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: isProduction
    ? format.combine(format.timestamp(), format.json())
    : format.combine(
        format.colorize(),
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf((info) => {
          const level = info['level'] as string
          const message = String(info['message'])
          const timestamp = info['timestamp'] as string | undefined
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { level: _l, message: _m, timestamp: _t, ...meta } = info as Record<string, unknown>
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''
          return `${timestamp} [${level}] ${message}${metaStr}`
        }),
      ),
  transports: [new transports.Console()],
})
