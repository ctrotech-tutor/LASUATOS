/**
 * One server instance for the load rehearsals: createApiApplication exactly as
 * the Vercel function builds it (serverless pool, the environment the parent
 * passes), listening on a loopback port. Started by shared.ts (startInstance)
 * as its own process, like one warm function instance; answers "stats" and
 * "stop" messages from the parent.
 *
 * LOAD_SERVER_LOGS=yes prints each error with the database's own reason
 * (Drizzle hides it in error.cause).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createApiApplication } from '../app.js';
import { loadEnvironment } from '../env.js';

const SERVER_LOGS = process.env.LOAD_SERVER_LOGS === 'yes';
/** LOAD_QUERY_TRACE=yes: print the statements of the busiest request on each route when the instance stops. */
const QUERY_TRACE = process.env.LOAD_QUERY_TRACE === 'yes';

/*
 * Database round trips per request, by route: the same `pg` module the
 * database package uses, counted where Drizzle calls it. Pool.query is one
 * round trip; Client.query without a callback is a statement on a checked-out
 * client (a transaction); the callback form is Pool.query's own inner call,
 * already counted. Counting only: the queries themselves are untouched.
 */
interface QueryCount { queries: number; statements?: string[] }
const statementText = (args: unknown[]): string => {
  const first = args[0] as string | { text?: string } | undefined;
  const text = typeof first === 'string' ? first : first?.text ?? '?';
  return text.replace(/\s+/g, ' ').slice(0, 220);
};
const requestScope = new AsyncLocalStorage<QueryCount>();
type Query = (this: unknown, ...args: unknown[]) => unknown;
const pg = createRequire(import.meta.resolve('@lasuatos/database'))('pg') as { Pool: { prototype: { query: Query } }; Client: { prototype: { query: Query } } };
const poolQuery = pg.Pool.prototype.query;
pg.Pool.prototype.query = function counted(this: unknown, ...args: unknown[]) {
  const scope = requestScope.getStore();
  if (scope) {
    scope.queries += 1;
    scope.statements?.push(statementText(args));
  }
  return poolQuery.apply(this, args);
};
const clientQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function counted(this: unknown, ...args: unknown[]) {
  const scope = requestScope.getStore();
  if (scope && typeof args.at(-1) !== 'function') {
    scope.queries += 1;
    scope.statements?.push(statementText(args));
  }
  return clientQuery.apply(this, args);
};
const routeQueries = new Map<string, { requests: number; queries: number }>();
const routeTraces = new Map<string, string[]>();

async function serve(): Promise<void> {
  const environment = loadEnvironment(process.env);
  const app = createApiApplication(environment, { serverless: true, logger: SERVER_LOGS ? { level: 'error' } : false });
  if (SERVER_LOGS) {
    process.stderr.write('[server] error logging on\n');
    app.server.addHook('onError', async (request, _reply, error) => {
      const cause = (error as { cause?: unknown }).cause;
      process.stderr.write(`[server] ${request.method} ${request.url}: ${error.name}: ${error.message.slice(0, 120)} | cause: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}\n`);
    });
  }
  app.server.addHook('onRequest', async (request) => {
    const scope: QueryCount = QUERY_TRACE ? { queries: 0, statements: [] } : { queries: 0 };
    requestScope.enterWith(scope);
    (request as unknown as { queryScope: QueryCount }).queryScope = scope;
  });
  app.server.addHook('onResponse', async (request) => {
    const scope = (request as unknown as { queryScope?: QueryCount }).queryScope;
    if (!scope) return;
    const key = `${request.method} ${request.routeOptions.url ?? request.url}`;
    const figures = routeQueries.get(key) ?? { requests: 0, queries: 0 };
    figures.requests += 1;
    figures.queries += scope.queries;
    routeQueries.set(key, figures);
    if (scope.statements && scope.statements.length > (routeTraces.get(key)?.length ?? -1)) routeTraces.set(key, scope.statements);
  });
  await app.server.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 200);
  // How long the request thread was blocked (a synchronous hash, JSON of a big answer…).
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  process.on('message', (message: { type?: string; reset?: boolean }) => {
    if (message?.type === 'stats') {
      const cpu = process.cpuUsage();
      process.send?.({
        type: 'stats',
        cpuMs: (cpu.user + cpu.system) / 1000,
        peakRssMb: Math.round(peakRss / 1e6),
        loopDelayMaxMs: Math.round(loop.max / 1e6),
        loopDelayP99Ms: Math.round(loop.percentile(99) / 1e6),
        face: app.faces?.stats() ?? null,
        queriesPerRoute: Object.fromEntries([...routeQueries].map(([route, figures]) => [route, Number((figures.queries / figures.requests).toFixed(2))])),
      });
      if (message.reset) loop.reset();
    } else if (message?.type === 'stop') {
      clearInterval(sampler);
      for (const [route, statements] of routeTraces) {
        process.stderr.write(`[queries] ${route}: ${statements.length}\n${statements.map((text, index) => `  ${index + 1}. ${text}`).join('\n')}\n`);
      }
      loop.disable();
      void app.close().finally(() => process.exit(0));
    }
  });
  process.send?.({ type: 'ready', port });
}

serve().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
