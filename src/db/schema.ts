/**
 * Esquema relacional SQLite (via node:sqlite) para o Lupa Territorial.
 * Contém 5 tabelas relacionadas com PK/FK e suporte a cache com data de coleta, histórico e flag is_teste.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { INDICATORS_CATALOG } from '../lib/indicatorsCatalog.ts';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'lupa_territorial.sqlite');

export function openDatabase(dbPath: string = process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
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
      peso_padrao REAL NOT NULL DEFAULT 1,
      source_url TEXT NOT NULL,
      descricao TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS indicator_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      indicator_code TEXT NOT NULL REFERENCES indicators(code) ON DELETE CASCADE,
      ano INTEGER NOT NULL,
      valor REAL,
      collected_at TEXT NOT NULL,
      source_mode TEXT NOT NULL DEFAULT 'online',
      is_teste INTEGER NOT NULL DEFAULT 0,
      UNIQUE(municipality_id, indicator_code, ano, is_teste)
    );

    CREATE TABLE IF NOT EXISTS ipeadata_cache (
      series_code TEXT NOT NULL,
      municipality_id TEXT NOT NULL,
      ano INTEGER NOT NULL,
      valor REAL NOT NULL,
      collected_at TEXT NOT NULL,
      source_mode TEXT NOT NULL DEFAULT 'online',
      PRIMARY KEY (series_code, municipality_id, ano)
    );

    CREATE INDEX IF NOT EXISTS idx_mun_state ON municipalities(state_id);
    CREATE INDEX IF NOT EXISTS idx_val_mun_ind ON indicator_values(municipality_id, indicator_code, ano);
    CREATE INDEX IF NOT EXISTS idx_ipea_series_mun ON ipeadata_cache(series_code, municipality_id);
  `);

  const upsertIndicator = db.prepare(`
    INSERT INTO indicators (
      code, nome, nome_curto, unidade, fonte, tabela_codigo, variavel_codigo,
      classificacao, ano_referencia, incluir_no_indice, maior_e_melhor,
      peso_padrao, source_url, descricao
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      nome = excluded.nome,
      nome_curto = excluded.nome_curto,
      unidade = excluded.unidade,
      fonte = excluded.fonte,
      tabela_codigo = excluded.tabela_codigo,
      variavel_codigo = excluded.variavel_codigo,
      classificacao = excluded.classificacao,
      ano_referencia = excluded.ano_referencia,
      incluir_no_indice = excluded.incluir_no_indice,
      maior_e_melhor = excluded.maior_e_melhor,
      peso_padrao = excluded.peso_padrao,
      source_url = excluded.source_url,
      descricao = excluded.descricao
  `);

  for (const ind of INDICATORS_CATALOG) {
    upsertIndicator.run(
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
    );
  }
}

// Execução direta via CLI (`npx tsx src/db/schema.ts`) para criar tabelas e catálogo.
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDatabase();
  runMigrations(db);
  console.log('Esquema SQLite criado/atualizado com sucesso.');
  db.close();
}
