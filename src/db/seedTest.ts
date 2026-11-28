/**
 * Script idempotente para inserir ou remover dados fictícios de teste (is_teste = 1).
 * Uso: `npm run db:seed-test` para inserir e `npm run db:clean-test` para apagar apenas os dados de teste.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppDatabase } from './client.ts';
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

export interface SeedTestSummary {
  states: number;
  municipalities: number;
  indicator_values: number;
  indicators_catalog: number;
  ipeadata_cache: number;
}

export async function seedTestData(db: AppDatabase): Promise<SeedTestSummary> {
  const now = new Date().toISOString();

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

  // Deduplica (municipality_id, indicator_code, ano) porque populacao=2022 aparece em metrics e popTrend
  const valMap = new Map<string, unknown[]>();
  const munRows: unknown[][] = [];

  for (const mun of TEST_MUNICIPALITIES) {
    munRows.push([mun.id, TEST_STATE_ID, mun.nome, mun.microrregiao, mun.regiao_imediata, 1]);

    for (const [code, val] of Object.entries(mun.metrics)) {
      const ano = anoPorIndicador[code];
      valMap.set(`${mun.id}:${code}:${ano}`, [mun.id, code, ano, val, now, 'seed_teste', 1]);
    }
    for (const [ano, pop] of mun.popTrend) {
      valMap.set(`${mun.id}:populacao:${ano}`, [mun.id, 'populacao', ano, pop, now, 'seed_teste', 1]);
    }
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      `
      INSERT INTO states (id, sigla, nome, regiao, malha_geojson, collected_at, is_offline, is_teste)
      VALUES (?, ?, ?, ?, ?, ?, 0, 1)
      ON CONFLICT(id) DO UPDATE SET
        sigla = EXCLUDED.sigla,
        nome = EXCLUDED.nome,
        malha_geojson = EXCLUDED.malha_geojson,
        collected_at = EXCLUDED.collected_at,
        is_teste = 1
      `,
      [TEST_STATE_ID, 'ZT', 'Estado Fictício de Teste', 'Ambiente de Testes', TEST_GEOJSON, now],
    );

    await tx.upsertBatch({
      table: 'municipalities',
      columns: ['id', 'state_id', 'nome', 'microrregiao', 'regiao_imediata', 'is_teste'],
      rows: munRows,
      conflictColumns: ['id'],
      updateColumns: ['nome', 'microrregiao', 'regiao_imediata', 'is_teste'],
    });

    await tx.upsertBatch({
      table: 'indicator_values',
      columns: ['municipality_id', 'indicator_code', 'ano', 'valor', 'collected_at', 'source_mode', 'is_teste'],
      rows: Array.from(valMap.values()),
      conflictColumns: ['municipality_id', 'indicator_code', 'ano', 'is_teste'],
      updateColumns: ['valor', 'collected_at', 'source_mode'],
    });
  });

  const statesRow = await db.queryOne<{ cnt: number | string }>('SELECT COUNT(*) as cnt FROM states WHERE is_teste = 1');
  const munRow = await db.queryOne<{ cnt: number | string }>(
    'SELECT COUNT(*) as cnt FROM municipalities WHERE is_teste = 1',
  );
  const valRow = await db.queryOne<{ cnt: number | string }>(
    'SELECT COUNT(*) as cnt FROM indicator_values WHERE is_teste = 1',
  );
  const catRow = await db.queryOne<{ cnt: number | string }>('SELECT COUNT(*) as cnt FROM indicators');

  return {
    states: Number(statesRow?.cnt ?? 0),
    municipalities: Number(munRow?.cnt ?? 0),
    indicator_values: Number(valRow?.cnt ?? 0),
    indicators_catalog: Number(catRow?.cnt ?? 0),
    ipeadata_cache: 0,
  };
}

export async function cleanTestData(
  db: AppDatabase,
): Promise<{ statesDeleted: number; municipalitiesDeleted: number; valuesDeleted: number }> {
  return db.transaction(async (tx) => {
    const valRes = await tx.execute('DELETE FROM indicator_values WHERE is_teste = 1');
    const munRes = await tx.execute('DELETE FROM municipalities WHERE is_teste = 1');
    const stRes = await tx.execute('DELETE FROM states WHERE is_teste = 1');
    return {
      statesDeleted: stRes.changes,
      municipalitiesDeleted: munRes.changes,
      valuesDeleted: valRes.changes,
    };
  });
}

function isMainEntry(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(entry);
}

if (isMainEntry(import.meta.url)) {
  (async () => {
    const db = await openDatabase();
    try {
      await runMigrations(db);
      if (process.argv.includes('--clean')) {
        const res = await cleanTestData(db);
        console.log(`Dados de teste removidos (${db.dialect}):`);
        console.log(`- states: ${res.statesDeleted} linha(s) removida(s)`);
        console.log(`- municipalities: ${res.municipalitiesDeleted} linha(s) removida(s)`);
        console.log(`- indicator_values: ${res.valuesDeleted} linha(s) removida(s)`);
      } else {
        const counts = await seedTestData(db);
        console.log(`Dados de teste inseridos/atualizados (${db.dialect}, estado ZT, id=99, is_teste=1):`);
        console.log(`- states (is_teste=1): ${counts.states} linha(s)`);
        console.log(`- municipalities (is_teste=1): ${counts.municipalities} linha(s)`);
        console.log(`- indicator_values (is_teste=1): ${counts.indicator_values} linha(s)`);
        console.log(`- indicators (catálogo compartilhado): ${counts.indicators_catalog} linha(s)`);
        console.log(`- ipeadata_cache: ${counts.ipeadata_cache} linha(s)`);
      }
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error('Erro no script de seed de teste:', err);
    process.exit(1);
  });
}
