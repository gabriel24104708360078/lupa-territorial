/**
 * Script idempotente para inserir ou remover dados fictícios de teste (is_teste = 1).
 * Uso: `tsx src/db/seedTest.ts` para inserir e `tsx src/db/seedTest.ts --clean` para apagar apenas os dados de teste.
 */

import { DatabaseSync } from 'node:sqlite';
import { openDatabase, runMigrations } from './schema.ts';

export const TEST_STATE_ID = 99;

const TEST_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { codarea: '9900001' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-43.5, -22.5], [-43.3, -22.5], [-43.3, -22.3], [-43.5, -22.3], [-43.5, -22.5]]],
      },
    },
    {
      type: 'Feature',
      properties: { codarea: '9900002' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-43.3, -22.5], [-43.1, -22.5], [-43.1, -22.3], [-43.3, -22.3], [-43.3, -22.5]]],
      },
    },
    {
      type: 'Feature',
      properties: { codarea: '9900003' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[-43.5, -22.3], [-43.1, -22.3], [-43.1, -22.1], [-43.5, -22.1], [-43.5, -22.3]]],
      },
    },
  ],
});

const TEST_MUNICIPALITIES = [
  {
    id: '9900001',
    nome: 'Município Teste Horizonte',
    microrregiao: 'Microrregião Teste Norte',
    regiao_imediata: 'Região Teste Alpha',
    metrics: {
      renda_2022: 2450,
      alfabetizacao_2022: 96.5,
      agua_2022: 94.0,
      esgoto_2022: 88.0,
      lixo_2022: 98.5,
      bolsa_familia_taxa: 42.0,
      idhm_2010: 0.785,
      vulneraveis_2010: 14.2,
      populacao: 120000,
      domicilios: 41000,
    },
    popTrend: [
      [2018, 114000],
      [2019, 115500],
      [2020, 117000],
      [2021, 118500],
      [2022, 120000],
      [2024, 121200],
      [2025, 122100],
    ],
  },
  {
    id: '9900002',
    nome: 'Município Teste Vale Verde',
    microrregiao: 'Microrregião Teste Centro',
    regiao_imediata: 'Região Teste Alpha',
    metrics: {
      renda_2022: 1480,
      alfabetizacao_2022: 90.2,
      agua_2022: 79.0,
      esgoto_2022: 61.5,
      lixo_2022: 89.0,
      bolsa_familia_taxa: 108.5,
      idhm_2010: 0.695,
      vulneraveis_2010: 28.6,
      populacao: 68000,
      domicilios: 22400,
    },
    popTrend: [
      [2018, 65000],
      [2019, 65800],
      [2020, 66500],
      [2021, 67200],
      [2022, 68000],
      [2024, 68600],
      [2025, 69100],
    ],
  },
  {
    id: '9900003',
    nome: 'Município Teste Serra Clara',
    microrregiao: 'Microrregião Teste Sul',
    regiao_imediata: 'Região Teste Beta',
    metrics: {
      renda_2022: 920,
      alfabetizacao_2022: 82.4,
      agua_2022: 58.0,
      esgoto_2022: 34.0,
      lixo_2022: 72.0,
      bolsa_familia_taxa: 184.0,
      idhm_2010: 0.612,
      vulneraveis_2010: 44.8,
      populacao: 31500,
      domicilios: 10200,
    },
    popTrend: [
      [2018, 30800],
      [2019, 31000],
      [2020, 31150],
      [2021, 31300],
      [2022, 31500],
      [2024, 31620],
      [2025, 31700],
    ],
  },
];

export function seedTestData(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.exec('BEGIN;');
  try {
    db.prepare(`
      INSERT INTO states (id, sigla, nome, regiao, malha_geojson, collected_at, is_offline, is_teste)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
      ON CONFLICT(id) DO UPDATE SET
        sigla = excluded.sigla,
        nome = excluded.nome,
        malha_geojson = excluded.malha_geojson,
        collected_at = excluded.collected_at,
        is_teste = 1
    `).run(TEST_STATE_ID, 'ZT', 'Estado Fictício de Teste', 'Ambiente de Testes', TEST_GEOJSON, now);

    const upsertMun = db.prepare(`
      INSERT INTO municipalities (id, state_id, nome, microrregiao, regiao_imediata, is_teste)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        nome = excluded.nome,
        microrregiao = excluded.microrregiao,
        regiao_imediata = excluded.regiao_imediata,
        is_teste = 1
    `);

    const upsertVal = db.prepare(`
      INSERT INTO indicator_values (municipality_id, indicator_code, ano, valor, collected_at, source_mode, is_teste)
      VALUES (?, ?, ?, ?, ?, 'seed_teste', 1)
      ON CONFLICT(municipality_id, indicator_code, ano, is_teste) DO UPDATE SET
        valor = excluded.valor,
        collected_at = excluded.collected_at
    `);

    const anoPorIndicador: Record<string, number> = {
      renda_2022: 2022,
      alfabetizacao_2022: 2022,
      agua_2022: 2022,
      esgoto_2022: 2022,
      lixo_2022: 2022,
      bolsa_familia_taxa: 2025,
      idhm_2010: 2010,
      vulneraveis_2010: 2010,
      populacao: 2022,
      domicilios: 2022,
    };

    for (const mun of TEST_MUNICIPALITIES) {
      upsertMun.run(mun.id, TEST_STATE_ID, mun.nome, mun.microrregiao, mun.regiao_imediata);
      for (const [code, val] of Object.entries(mun.metrics)) {
        upsertVal.run(mun.id, code, anoPorIndicador[code], val, now);
      }
      for (const [ano, pop] of mun.popTrend) {
        upsertVal.run(mun.id, 'populacao', ano, pop, now);
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function cleanTestData(db: DatabaseSync): { statesDeleted: number; municipalitiesDeleted: number; valuesDeleted: number } {
  db.exec('BEGIN;');
  try {
    const valuesDeleted = Number(db.prepare('DELETE FROM indicator_values WHERE is_teste = 1').run().changes);
    const municipalitiesDeleted = Number(db.prepare('DELETE FROM municipalities WHERE is_teste = 1').run().changes);
    const statesDeleted = Number(db.prepare('DELETE FROM states WHERE is_teste = 1').run().changes);
    db.exec('COMMIT;');
    return { statesDeleted, municipalitiesDeleted, valuesDeleted };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDatabase();
  runMigrations(db);
  if (process.argv.includes('--clean')) {
    const res = cleanTestData(db);
    console.log('Dados de teste removidos:', res);
  } else {
    seedTestData(db);
    console.log('Dados de teste inseridos/atualizados (estado ZT, id=99, is_teste=1).');
  }
  db.close();
}
