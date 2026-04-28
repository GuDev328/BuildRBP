/**
 * Dev logger.
 * Enabled in Vite dev mode, Node development mode, or by logger.setEnabled().
 * Defaults to disabled when the environment cannot be detected safely.
 */

function detectDev(): boolean {
  try {
    // Indirect access avoids build failures outside import.meta environments.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (import.meta as any)?.env;
    if (meta !== undefined) {
      return meta.DEV === true;
    }
  } catch {
  }

  try {
    const proc = (globalThis as Record<string, unknown>)['process'] as
      | { env?: { NODE_ENV?: string } }
      | undefined;
    if (proc?.env?.NODE_ENV !== undefined) {
      return proc.env.NODE_ENV === 'development';
    }
  } catch {
  }

  return false;
}

const isBrowser = typeof window !== 'undefined';

function style(color: string) {
  return isBrowser ? `color: ${color}; font-weight: bold` : '';
}

const COLORS = {
  request: '#4f9eff',
  success: '#4caf50',
  error: '#f44336',
  warn: '#ff9800',
  dim: '#9e9e9e',
};

function prefix(tag: string, color: string): string[] {
  if (isBrowser) {
    return [`%c[HTTP] ${tag}`, style(color)];
  }
  return [`[HTTP] ${tag}`];
}

export interface LogEntry {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
  status?: number;
  error?: unknown;
}

export const logger = {
  enabled: detectDev(),

  setEnabled(value: boolean): void {
    this.enabled = value;
  },

  request(entry: Omit<LogEntry, 'status' | 'error'>): number {
    if (!this.enabled) return Date.now();
    const ts = Date.now();
    const tag = `➤ ${entry.method.toUpperCase()} ${entry.url}`;
    if (isBrowser) {
      console.groupCollapsed(...prefix(tag, COLORS.request));
      if (entry.params && Object.keys(entry.params).length) {
        console.log('%cParams:', style(COLORS.dim), entry.params);
      }
      if (entry.body) {
        console.log('%cBody:', style(COLORS.dim), entry.body);
      }
      console.groupEnd();
    } else {
      console.log(`[HTTP] ➤ ${entry.method.toUpperCase()} ${entry.url}`);
    }
    return ts;
  },

  response(entry: LogEntry, startTime: number): void {
    if (!this.enabled) return;
    const duration = Date.now() - startTime;
    const tag = `✔ ${entry.status} ${entry.method.toUpperCase()} ${entry.url} (${duration}ms)`;
    if (isBrowser) {
      console.groupCollapsed(...prefix(tag, COLORS.success));
      console.log('%cData:', style(COLORS.dim), entry.body);
      console.groupEnd();
    } else {
      console.log(`[HTTP] ✔ ${entry.status} ${entry.method.toUpperCase()} ${entry.url} (${duration}ms)`);
    }
  },

  error(entry: LogEntry, startTime: number): void {
    if (!this.enabled) return;
    const duration = Date.now() - startTime;
    const tag = `✖ ${entry.status ?? 'ERR'} ${entry.method.toUpperCase()} ${entry.url} (${duration}ms)`;
    if (isBrowser) {
      console.groupCollapsed(...prefix(tag, COLORS.error));
      console.error('%cError:', style(COLORS.dim), entry.error);
      console.groupEnd();
    } else {
      console.error(`[HTTP] ✖ ${entry.status ?? 'ERR'} ${entry.method.toUpperCase()} ${entry.url} (${duration}ms)`, entry.error);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (!this.enabled) return;
    if (isBrowser) {
      console.warn(`%c[HTTP] ⚠ ${message}`, style(COLORS.warn), ...args);
    } else {
      console.warn(`[HTTP] ⚠ ${message}`, ...args);
    }
  },

  debug(message: string, ...args: unknown[]): void {
    if (!this.enabled) return;
    if (isBrowser) {
      console.debug(`%c[HTTP] ◦ ${message}`, style(COLORS.dim), ...args);
    } else {
      console.debug(`[HTTP] ◦ ${message}`, ...args);
    }
  },
};
