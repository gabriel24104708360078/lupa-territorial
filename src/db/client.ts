/**
 * Interface única de acesso ao banco de dados para SQLite (local) e PostgreSQL (publicação via DATABASE_URL).
 * Suporta pg_advisory_xact_lock compatível com PgBouncer (modo transação), timeouts locais, SSL verify-full e lotes de 500 linhas.
 */

import fs from 'node:fs';
import path from 'node:path';

export type DbDialect = 'sqlite' | 'postgres';

export interface UpsertBatchOptions {
  table: string;
  columns: string[];
  rows: unknown[][];
  conflictColumns: string[];
  updateColumns: string[];
  chunkSize?: number;
}

export interface AdvisoryLockOptions {
  /** Se true, retorna { acquired: false } em lock_timeout (55P03) ou statement_timeout (57014) sem lançar erro */
  skipOnTimeout?: boolean;
}

export type AdvisoryLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; reason: 'lock_timeout' | 'statement_timeout' };

export interface DbExecutor {
  readonly dialect: DbDialect;
  queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | undefined>;
  execute(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  upsertBatch(options: UpsertBatchOptions): Promise<void>;
}

export interface AppDatabase extends DbExecutor {
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  withAdvisoryLock<T>(
    lockKey: number,
    fn: (exec: DbExecutor) => Promise<T>,
    options?: AdvisoryLockOptions,
  ): Promise<AdvisoryLockResult<T>>;
  close(): Promise<void>;
}

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(name: string): string {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`Identificador SQL inválido: ${name}`);
  }
  return name;
}

/**
 * Converte marcadores posicionais `?` (padrão SQLite) para `$1, $2, ...` (padrão PostgreSQL),
 * ignorando `?` dentro de literais entre aspas simples.
 */
export function convertQuestionMarksToPg(sql: string): string {
  let out = '';
  let paramIndex = 1;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "'";
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (ch === '?' && !inSingleQuote) {
      out += `$${paramIndex}`;
      paramIndex += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Normaliza a string de conexão PostgreSQL para usar sslmode=verify-full explicitamente
 * em conexões remotas, evitando o aviso de depreciação do pg-connection-string para prefer/require/verify-ca.
 */
export function normalizePgConnectionString(connectionString: string): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean } | undefined;
} {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return { connectionString, ssl: undefined };
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();

  if (sslMode === 'disable') {
    return { connectionString: parsed.toString(), ssl: false };
  }

  if (sslMode === 'no-verify') {
    return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: false } };
  }

  if (sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca' || (!sslMode && !isLocal)) {
    parsed.searchParams.set('sslmode', 'verify-full');
    return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true } };
  }

  if (sslMode === 'verify-full') {
    return { connectionString: parsed.toString(), ssl: { rejectUnauthorized: true } };
  }

  return { connectionString: parsed.toString(), ssl: undefined };
}

function buildBatchUpsertQuery(
  table: string,
  columns: string[],
  rowCount: number,
  conflictColumns: string[],
  updateColumns: string[],
): string {
  const safeTable = assertIdentifier(table);
  const safeCols = columns.map(assertIdentifier);
  const safeConflict = conflictColumns.map(assertIdentifier);
  const safeUpdates = updateColumns.map(assertIdentifier);

  const rowPlaceholder = `(${safeCols.map(() => '?').join(', ')})`;
  const valuesClause = Array.from({ length: rowCount }, () => rowPlaceholder).join(', ');
  const conflictClause =
    safeUpdates.length > 0
      ? `ON CONFLICT (${safeConflict.join(', ')}) DO UPDATE SET ${safeUpdates
          .map((c) => `${c} = EXCLUDED.${c}`)
          .join(', ')}`
      : `ON CONFLICT (${safeConflict.join(', ')}) DO NOTHING`;

  return `INSERT INTO ${safeTable} (${safeCols.join(', ')}) VALUES ${valuesClause} ${conflictClause}`;
}

async function runUpsertBatch(executor: DbExecutor, options: UpsertBatchOptions): Promise<void> {
  if (options.rows.length === 0) return;
  const colCount = Math.max(1, options.columns.length);
  // Blocos de ~500 linhas por INSERT (respeitando limites de parâmetros do SQLite 32.766 e PostgreSQL 65.535)
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? 500, Math.floor(30000 / colCount)));

  for (let i = 0; i < options.rows.length; i += chunkSize) {
    const slice = options.rows.slice(i, i + chunkSize);
    const sql = buildBatchUpsertQuery(
      options.table,
      options.columns,
      slice.length,
      options.conflictColumns,
      options.updateColumns,
    );
    const params: unknown[] = [];
    for (const row of slice) {
      for (const cell of row) {
        params.push(cell === undefined ? null : cell);
      }
    }
    await executor.execute(sql, params);
  }
}

export async function createSqliteClient(dbPath: string): Promise<AppDatabase> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  const toSqlParams = (params: unknown[] = []) =>
    params.map((p) => (p === undefined ? null : (p as string | number | bigint | Uint8Array | null)));

  const executor: DbExecutor = {
    dialect: 'sqlite',
    async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...toSqlParams(params)) as unknown as T[];
    },
    async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
      return db.prepare(sql).get(...toSqlParams(params)) as unknown as T | undefined;
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const res = db.prepare(sql).run(...toSqlParams(params));
      return { changes: Number(res.changes ?? 0) };
    },
    async upsertBatch(options: UpsertBatchOptions): Promise<void> {
      await runUpsertBatch(executor, options);
    },
  };

  return {
    ...executor,
    async exec(sql: string): Promise<void> {
      db.exec(sql);
    },
    async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const result = await fn(executor);
        db.exec('COMMIT;');
        return result;
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    async withAdvisoryLock<T>(
      _lockKey: number,
      fn: (exec: DbExecutor) => Promise<T>,
    ): Promise<AdvisoryLockResult<T>> {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const value = await fn(executor);
        db.exec('COMMIT;');
        return { acquired: true, value };
      } catch (err) {
        db.exec('ROLLBACK;');
        throw err;
      }
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}

export function getPgErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export async function createPostgresClient(rawConnectionString: string): Promise<AppDatabase> {
  const pgModule = await import('pg');
  const Pool = pgModule.default?.Pool ?? pgModule.Pool;

  const { connectionString, ssl } = normalizePgConnectionString(rawConnectionString);

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 10000,
    ...(ssl !== undefined ? { ssl } : {}),
  });

  const makeExecutor = (runner: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;
  }): DbExecutor => {
    const execObj: DbExecutor = {
      dialect: 'postgres',
      async queryAll<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
        const res = await runner.query(convertQuestionMarksToPg(sql), params);
        return res.rows as T[];
      },
      async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
        const res = await runner.query(convertQuestionMarksToPg(sql), params);
        return res.rows[0] as T | undefined;
      },
      async execute(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
        const res = await runner.query(convertQuestionMarksToPg(sql), params);
        return { changes: Number(res.rowCount ?? 0) };
      },
      async upsertBatch(options: UpsertBatchOptions): Promise<void> {
        await runUpsertBatch(execObj, options);
      },
    };
    return execObj;
  };

  const rootExec = makeExecutor(pool);

  return {
    ...rootExec,
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const txExec = makeExecutor(client);
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '20s'");
        const result = await fn(txExec);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    /**
     * Usa pg_advisory_xact_lock dentro de uma transação com lock_timeout='10s' e statement_timeout='20s'.
     * Compatível com PgBouncer em modo transação (o lock é liberado automaticamente no COMMIT/ROLLBACK).
     */
    async withAdvisoryLock<T>(
      lockKey: number,
      fn: (exec: DbExecutor) => Promise<T>,
      options?: AdvisoryLockOptions,
    ): Promise<AdvisoryLockResult<T>> {
      const client = await pool.connect();
      const lockedExec = makeExecutor(client);
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '20s'");
        await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
        const value = await fn(lockedExec);
        await client.query('COMMIT');
        return { acquired: true, value };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const code = getPgErrorCode(err);
        if (options?.skipOnTimeout && (code === '55P03' || code === '57014')) {
          return {
            acquired: false,
            reason: code === '55P03' ? 'lock_timeout' : 'statement_timeout',
          };
        }
        throw err;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
