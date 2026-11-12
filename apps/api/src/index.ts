import { createApiApplication } from './app.js';
import { loadEnvironment } from './env.js';

// Standalone API process (local development, or a host that runs a long-lived Node server).
// On Vercel the same application runs inside the web app's /api/v1 route instead; see embedded.ts.
const environment = loadEnvironment();
const application = createApiApplication(environment);
const { server } = application;
let closing = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, 'Shutting down API');

  try {
    await application.close();
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
  await application.close().catch(() => undefined);
  process.exitCode = 1;
}
