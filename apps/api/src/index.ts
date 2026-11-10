import { createDatabase } from '@lasuatos/database';
import { loadEnvironment } from './env.js';
import { buildServer, type ServerOptions } from './server.js';

const environment = loadEnvironment();
const database = environment.DATABASE_URL
  ? createDatabase(environment.DATABASE_URL)
  : undefined;

const serverOptions: ServerOptions = {
  logger: {
    level: environment.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.token',
        'req.body.location',
      ],
      censor: '[REDACTED]',
    },
  },
  ...(database ? { checkDatabase: database.checkConnection } : {}),
};

const server = buildServer(serverOptions);
let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, 'Shutting down API');

  try {
    await server.close();
    await database?.close();
  } catch (error) {
    server.log.error({ err: error }, 'API shutdown did not complete cleanly');
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await server.listen({ host: environment.API_HOST, port: environment.API_PORT });
} catch (error) {
  server.log.error({ err: error }, 'API failed to start');
  await database?.close();
  process.exitCode = 1;
}
