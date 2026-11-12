'use client';

import { ApiHealthSchema, ApiReadinessSchema } from '@lasuatos/contracts';
import { Activity, Database, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

type DatabaseState = 'checking' | 'up' | 'down' | 'not_configured' | 'unknown';
type ApiState = 'checking' | 'up' | 'down';

function databaseLabel(state: DatabaseState): string {
  switch (state) {
    case 'checking':
      return 'Checking';
    case 'up':
      return 'Connected';
    case 'down':
      return 'Unreachable';
    case 'not_configured':
      return 'Not configured';
    case 'unknown':
      return 'Status unknown';
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function SystemStatus() {
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [databaseState, setDatabaseState] = useState<DatabaseState>('checking');
  const [refreshKey, setRefreshKey] = useState(0);
  const [checking, setChecking] = useState(true);

  const checkServices = useCallback((signal: AbortSignal) => {
    const statusRequest = fetch('/api/v1/health', { cache: 'no-store', signal })
      .then(async (healthResponse) => {
        if (!healthResponse.ok) throw new Error('Health check failed');
        const health = ApiHealthSchema.safeParse(await healthResponse.json());
        if (!health.success) throw new Error('Health response was not recognized');

        try {
          const readinessResponse = await fetch('/api/v1/ready', {
            cache: 'no-store',
            signal,
          });
          const readiness = ApiReadinessSchema.safeParse(await readinessResponse.json());
          return {
            api: 'up' as const,
            database: readiness.success ? readiness.data.checks.database : 'unknown' as const,
          };
        } catch (error) {
          if (isAbortError(error)) throw error;
          return { api: 'up' as const, database: 'unknown' as const };
        }
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return null;
        return { api: 'down' as const, database: 'unknown' as const };
      });

    void statusRequest
      .then((result) => {
        if (!result || signal.aborted) return;
        setApiState(result.api);
        setDatabaseState(result.database);
      })
      .finally(() => {
        if (!signal.aborted) setChecking(false);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    checkServices(controller.signal);
    return () => controller.abort();
  }, [checkServices, refreshKey]);

  return (
    <section className="status-panel" aria-labelledby="status-heading">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">LIVE CHECK</p>
          <h2 id="status-heading">Service status</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => {
            setChecking(true);
            setApiState('checking');
            setDatabaseState('checking');
            setRefreshKey((key) => key + 1);
          }}
          disabled={checking}
          aria-label="Refresh service status"
          data-tip="Refresh service status"
        >
          <RefreshCw size={16} className={checking ? 'is-spinning' : undefined} aria-hidden="true" />
        </button>
      </div>

      <div className="status-row">
        <span className="status-icon"><Activity size={17} strokeWidth={1.8} aria-hidden="true" /></span>
        <span className="status-copy">
          <strong>Attendance API</strong>
          <small>Application process</small>
        </span>
        <span className={`status-value status-${apiState}`}>
          <i aria-hidden="true" />
          {apiState === 'up' ? 'Online' : apiState === 'down' ? 'Unavailable' : 'Checking'}
        </span>
      </div>

      <div className="status-row">
        <span className="status-icon"><Database size={17} strokeWidth={1.8} aria-hidden="true" /></span>
        <span className="status-copy">
          <strong>PostgreSQL</strong>
          <small>Persistent records</small>
        </span>
        <span className={`status-value status-${databaseState}`}>
          <i aria-hidden="true" />
          {databaseLabel(databaseState)}
        </span>
      </div>

      <p className="status-note" aria-live="polite">
        {apiState === 'down'
          ? 'The API did not respond. Refresh after the service starts.'
          : databaseState === 'not_configured'
            ? 'The API is running, but no database is configured. No records can be saved.'
            : databaseState === 'down'
              ? 'The database health check failed. No records can be saved right now.'
              : databaseState === 'up'
                ? 'The API and database responded to their health checks.'
                : 'Status is checked directly against the running API.'}
      </p>
    </section>
  );
}
