/**
 * Esquema relacional único do Lupa Territorial (PostgreSQL quando DATABASE_URL existir; SQLite local caso contrário).
 * Contém 5 tabelas relacionadas com PK/FK, data de coleta, histórico e coluna is_teste, com migrations automáticas.
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS_CATALOG } from '../lib/indicatorsCatalog.ts';
import { createPostgresClient, createSqliteClient, type AppDatabase } from './client.ts';

dotenv.config({ quiet: true });

const DEFAULT_LOCAL_DB_PATH = path.resolve(process.cwd(), 'data', 'lupa_territorial.sqlite');
const SERVERLESS_TEMP_DB_PATH = '/tmp/lupa_territorial.sqlite';

export function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function hasPostgresConfig(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '');
}

export function resolveDefaultDbPath(): string {
  if (process.env.SQLITE_DB_PATH && process.env.SQLITE_DB_PATH.trim() !== '') {
    return process.env.SQLITE_DB_PATH;
  }
  return isServerlessRuntime() ? SERVERLESS_TEMP_DB_PATH : DEFAULT_LOCAL_DB_PATH;
}

export async function openDatabase(dbPath?: string): Promise<AppDatabase> {
  if (!dbPath && hasPostgresConfig()) {
    return createPostgresClient(process.env.DATABASE_URL!.trim());
  }
  return createSqliteClient(dbPath ?? resolveDefaultDbPath());
}

export async function runMigrations(db: AppDatabase): Promise<void> {
  const idColumnSql =
    db.dialect === 'postgres' ? 'id SERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  const floatSql = db.dialect === 'postgres' ? 'DOUBLE PRECISION' : 'REAL';

  await db.exec(`
    CREATE TABLE IF NOT EXISTS states (
      id INTEGER PRIMARY KEY,
      sigla TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      regiao TEXT NOT NULL,
      malha_geojson TEXT,
      collected_at TEXT NOT NULL,
      is_offline INTEGER NOT NULL DEFAULT 0,
      is_teste INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS municipalities (
      id TEXT PRIMARY KEY,
      state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      microrregiao TEXT,
      regiao_imediata TEXT,
      is_teste INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS indicators (
      code TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      nome_curto TEXT NOT NULL,
      unidade TEXT NOT NULL,
      fonte TEXT NOT NULL,
      tabela_codigo TEXT NOT NULL,
      variavel_codigo TEXT NOT NULL,
      classificacao TEXT,
      ano_referencia INTEGER NOT NULL,
      incluir_no_indice INTEGER NOT NULL DEFAULT 1,
      maior_e_melhor INTEGER NOT NULL DEFAULT 1,
      peso_padrao ${floatSql} NOT NULL DEFAULT 1,
      source_url TEXT NOT NULL,
      descricao TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indicator_values (
      ${idColumnSql},
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      indicator_code TEXT NOT NULL REFERENCES indicators(code) ON DELETE CASCADE,
      ano INTEGER NOT NULL,
      valor ${floatSql},
      collected_at TEXT NOT NULL,
      source_mode TEXT NOT NULL DEFAULT 'online',
      is_teste INTEGER NOT NULL DEFAULT 0,
      UNIQUE(municipality_id, indicator_code, ano, is_teste)
    );

    CREATE TABLE IF NOT EXISTS ipeadata_cache (
      series_code TEXT NOT NULL,
      municipality_id TEXT NOT NULL,
      ano INTEGER NOT NULL,
      valor ${floatSql} NOT NULL,
      collected_at TEXT NOT NULL,
      source_mode TEXT NOT NULL DEFAULT 'online',
      PRIMARY KEY (series_code, municipality_id, ano)
    );

    CREATE INDEX IF NOT EXISTS idx_mun_state ON municipalities(state_id);
    CREATE INDEX IF NOT EXISTS idx_val_mun_ind ON indicator_values(municipality_id, indicator_code, ano);
    CREATE INDEX IF NOT EXISTS idx_ipea_series_mun ON ipeadata_cache(series_code, municipality_id);
  `);

  await db.upsertBatch({
    table: 'indicators',
    columns: [
      'code',
      'nome',
      'nome_curto',
      'unidade',
      'fonte',
      'tabela_codigo',
      'variavel_codigo',
      'classificacao',
      'ano_referencia',
      'incluir_no_indice',
      'maior_e_melhor',
      'peso_padrao',
      'source_url',
      'descricao',
    ],
    rows: INDICATORS_CATALOG.map((ind) => [
      ind.code,
      ind.nome,
      ind.nomeCurto,
      ind.unidade,
      ind.fonte,
      ind.tabelaCodigo,
      ind.variavelCodigo,
      ind.classificacao,
      ind.anoReferencia,
      ind.incluirNoIndice ? 1 : 0,
      ind.maiorEMelhor ? 1 : 0,
      ind.pesoPadrao,
      ind.sourceUrl,
      ind.descricao,
    ]),
    conflictColumns: ['code'],
    updateColumns: [
      'nome',
      'nome_curto',
      'unidade',
      'fonte',
      'tabela_codigo',
      'variavel_codigo',
      'classificacao',
      'ano_referencia',
      'incluir_no_indice',
      'maior_e_melhor',
      'peso_padrao',
      'source_url',
      'descricao',
    ],
  });
}

function isMainEntry(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(entry);
}

// Execução direta via CLI (`npm run db:migrate`) para criar tabelas e catálogo.
if (isMainEntry(import.meta.url)) {
  (async () => {
    const db = await openDatabase();
    try {
      await runMigrations(db);
      console.log(
        `Esquema ${db.dialect === 'postgres' ? 'PostgreSQL' : 'SQLite'} criado/atualizado com sucesso (${INDICATORS_CATALOG.length} indicadores no catálogo).`,
      );
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error('Erro ao executar migração:', err);
    process.exit(1);
  });
}
