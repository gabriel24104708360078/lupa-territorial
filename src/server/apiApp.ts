/**
 * Módulo compartilhado que cria e configura o aplicativo Express com todas as rotas /api/*.
 * Reutilizado tanto pelo servidor local (server.ts) quanto pela Serverless Function do Vercel (api/index.ts).
 */

import express, { type Express, type Request, type Response } from 'express';
import type { AppDatabase } from '../db/client.ts';
import { openDatabase, runMigrations } from '../db/schema.ts';
import { INDICATORS_CATALOG } from '../lib/indicatorsCatalog.ts';
import { ensureStateDataLoaded, ensureStatesList } from '../services/externalData.ts';

const IPEADATA_NOTICE =
  'O IVS (AVS_IVS) no Ipeadata existe apenas para Brasil, Regiões e Estados (sem série municipal). Por isso utilizamos a taxa municipal de benefícios do Bolsa Família por 1.000 habitantes (FAM_PBF) e, com peso padrão 0 por serem de 2010, o IDHM (ADH_IDHM) e a proporção de vulneráveis à pobreza (ADH_PPOB).';

let sharedDbPromise: Promise<AppDatabase> | null = null;

function getDatabase(): Promise<AppDatabase> {
  if (!sharedDbPromise) {
    sharedDbPromise = (async () => {
      const db = await openDatabase();
      await runMigrations(db);
      return db;
    })().catch((err) => {
      sharedDbPromise = null;
      throw err;
    });
  }
  return sharedDbPromise;
}

export function createApiApp(): Express {
  const app = express();
  app.use(express.json());

  const router = express.Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Lista todas as UFs disponíveis (e eventual estado fictício de teste se seedado)
  router.get('/states', async (_req: Request, res: Response) => {
    try {
      const db = await getDatabase();
      const { states, isOffline, collectedAt } = await ensureStatesList(db);
      res.json({
        isOffline,
        collectedAt,
        hasTestData: states.some((s) => Number(s.is_teste) === 1),
        states: states.map((s) => ({
          id: Number(s.id),
          sigla: s.sigla,
          nome: s.nome,
          regiao: s.regiao,
          isOffline: Number(s.is_offline) === 1,
          isTeste: Number(s.is_teste) === 1,
          collectedAt: s.collected_at,
        })),
      });
    } catch (err) {
      console.error('Erro em GET /api/states:', err);
      res.status(502).json({ error: 'Não foi possível carregar a lista de estados.' });
    }
  });

  // Retorna malha, municípios, valores mais recentes, histórico de tendências e catálogo de fontes para uma UF
  router.get('/states/:stateId/overview', async (req: Request, res: Response) => {
    const stateId = Number(req.params.stateId);
    if (!Number.isInteger(stateId) || stateId < 1 || stateId > 999) {
      res.status(400).json({ error: 'Código de UF inválido.' });
      return;
    }

    try {
      const db = await getDatabase();
      const status = await ensureStateDataLoaded(db, stateId);

      // Carga recente (online ou fallback offline) já montada em memória: evita round-trip extra e funciona mesmo se o lock do cache expirar
      if (status.inMemoryOverview) {
        const mem = status.inMemoryOverview;
        const sortedIndicators = [...INDICATORS_CATALOG].sort((a, b) => {
          if (Number(b.incluirNoIndice) !== Number(a.incluirNoIndice)) {
            return Number(b.incluirNoIndice) - Number(a.incluirNoIndice);
          }
          if (b.pesoPadrao !== a.pesoPadrao) {
            return b.pesoPadrao - a.pesoPadrao;
          }
          return b.anoReferencia - a.anoReferencia;
        });

        res.json({
          state: {
            id: Number(mem.state.id),
            sigla: mem.state.sigla,
            nome: mem.state.nome,
            regiao: mem.state.regiao,
            collectedAt: status.collectedAt,
            isOffline: status.isOffline,
            offlineIndicators: status.offlineIndicators,
            isTeste: status.isTeste,
          },
          indicators: sortedIndicators,
          municipalities: mem.municipalities,
          malhaGeoJson: mem.malhaGeoJson,
          ipeadataNotice: IPEADATA_NOTICE,
        });
        return;
      }

      const stateRow = await db.queryOne<{
        id: number;
        sigla: string;
        nome: string;
        regiao: string;
        malha_geojson: string | null;
        collected_at: string;
        is_offline: number;
        is_teste: number;
      }>('SELECT id, sigla, nome, regiao, malha_geojson, collected_at, is_offline, is_teste FROM states WHERE id = ?', [
        stateId,
      ]);

      if (!stateRow) {
        res.status(404).json({ error: 'Estado não encontrado.' });
        return;
      }

      const indicators = await db.queryAll<{
        code: string;
        nome: string;
        nome_curto: string;
        unidade: string;
        fonte: string;
        tabela_codigo: string;
        variavel_codigo: string;
        classificacao: string | null;
        ano_referencia: number;
        incluir_no_indice: number;
        maior_e_melhor: number;
        peso_padrao: number;
        source_url: string;
        descricao: string;
      }>(`
        SELECT code, nome, nome_curto, unidade, fonte, tabela_codigo, variavel_codigo,
               classificacao, ano_referencia, incluir_no_indice, maior_e_melhor,
               peso_padrao, source_url, descricao
        FROM indicators
        ORDER BY incluir_no_indice DESC, peso_padrao DESC, ano_referencia DESC
      `);

      const municipalities = await db.queryAll<{
        id: string;
        nome: string;
        microrregiao: string | null;
        regiao_imediata: string | null;
        is_teste: number;
      }>(
        `
          SELECT id, nome, microrregiao, regiao_imediata, is_teste
          FROM municipalities
          WHERE state_id = ?
          ORDER BY nome ASC
        `,
        [stateId],
      );

      const valuesRows = await db.queryAll<{
        municipality_id: string;
        indicator_code: string;
        ano: number;
        valor: number | null;
        source_mode: string;
      }>(
        `
          SELECT iv.municipality_id, iv.indicator_code, iv.ano, iv.valor, iv.source_mode
          FROM indicator_values iv
          JOIN municipalities m ON m.id = iv.municipality_id
          WHERE m.state_id = ?
          ORDER BY iv.ano ASC
        `,
        [stateId],
      );

      const byMun: Record<
        string,
        {
          values: Record<string, { valor: number | null; ano: number }>;
          trends: {
            populacao: Array<{ ano: number; valor: number }>;
            bolsa_familia_taxa: Array<{ ano: number; valor: number }>;
          };
        }
      > = {};

      for (const m of municipalities) {
        byMun[m.id] = {
          values: {},
          trends: { populacao: [], bolsa_familia_taxa: [] },
        };
      }

      for (const row of valuesRows) {
        const entry = byMun[row.municipality_id];
        if (!entry) continue;

        const anoNum = Number(row.ano);
        const valNum = row.valor === null || row.valor === undefined ? null : Number(row.valor);

        const current = entry.values[row.indicator_code];
        if (!current || anoNum >= current.ano) {
          entry.values[row.indicator_code] = { valor: valNum, ano: anoNum };
        }

        if (
          (row.indicator_code === 'populacao' || row.indicator_code === 'bolsa_familia_taxa') &&
          typeof valNum === 'number' &&
          Number.isFinite(valNum)
        ) {
          entry.trends[row.indicator_code].push({ ano: anoNum, valor: valNum });
        }
      }

      res.json({
        state: {
          id: Number(stateRow.id),
          sigla: stateRow.sigla,
          nome: stateRow.nome,
          regiao: stateRow.regiao,
          collectedAt: status.collectedAt,
          isOffline: status.isOffline,
          offlineIndicators: status.offlineIndicators,
          isTeste: status.isTeste || Number(stateRow.is_teste) === 1,
        },
        indicators: indicators.map((ind) => ({
          code: ind.code,
          nome: ind.nome,
          nomeCurto: ind.nome_curto,
          unidade: ind.unidade,
          fonte: ind.fonte,
          tabelaCodigo: ind.tabela_codigo,
          variavelCodigo: ind.variavel_codigo,
          classificacao: ind.classificacao,
          anoReferencia: Number(ind.ano_referencia),
          incluirNoIndice: Number(ind.incluir_no_indice) === 1,
          maiorEMelhor: Number(ind.maior_e_melhor) === 1,
          pesoPadrao: Number(ind.peso_padrao),
          sourceUrl: ind.source_url,
          descricao: ind.descricao,
        })),
        municipalities: municipalities.map((m) => ({
          id: m.id,
          nome: m.nome,
          microrregiao: m.microrregiao,
          regiaoImediata: m.regiao_imediata,
          isTeste: Number(m.is_teste) === 1,
          values: byMun[m.id]?.values || {},
          trends: byMun[m.id]?.trends || { populacao: [], bolsa_familia_taxa: [] },
        })),
        malhaGeoJson: stateRow.malha_geojson ? JSON.parse(stateRow.malha_geojson) : null,
        ipeadataNotice: IPEADATA_NOTICE,
      });
    } catch (err) {
      console.error('Erro em GET /api/states/:stateId/overview:', err);
      res.status(502).json({
        error: 'Não foi possível carregar os indicadores desta UF nem pelos servidores oficiais nem pelo cache offline.',
      });
    }
  });

  // Metadados gerais e estatísticas do cache (SQLite local ou PostgreSQL) para a página "Sobre os dados"
  router.get('/about', async (_req: Request, res: Response) => {
    try {
      const db = await getDatabase();
      const indicators = await db.queryAll(
        'SELECT code, nome, nome_curto, unidade, fonte, tabela_codigo, variavel_codigo, classificacao, ano_referencia, incluir_no_indice, maior_e_melhor, peso_padrao, source_url, descricao FROM indicators',
      );
      const rawStats = await db.queryOne<{
        cachedStates: number | string;
        cachedMunicipalities: number | string;
        cachedValues: number | string;
        testValues: number | string;
        lastCollectedAt: string | null;
      }>(`
        SELECT
          (SELECT COUNT(*) FROM states WHERE is_teste = 0 AND malha_geojson IS NOT NULL) AS "cachedStates",
          (SELECT COUNT(*) FROM municipalities WHERE is_teste = 0) AS "cachedMunicipalities",
          (SELECT COUNT(*) FROM indicator_values WHERE is_teste = 0) AS "cachedValues",
          (SELECT COUNT(*) FROM indicator_values WHERE is_teste = 1) AS "testValues",
          (SELECT MAX(collected_at) FROM states WHERE is_teste = 0) AS "lastCollectedAt"
      `);

      res.json({
        dialect: db.dialect,
        indicators,
        stats: {
          cachedStates: Number(rawStats?.cachedStates ?? 0),
          cachedMunicipalities: Number(rawStats?.cachedMunicipalities ?? 0),
          cachedValues: Number(rawStats?.cachedValues ?? 0),
          testValues: Number(rawStats?.testValues ?? 0),
          lastCollectedAt: rawStats?.lastCollectedAt ?? null,
        },
      });
    } catch (err) {
      console.error('Erro em GET /api/about:', err);
      res.status(500).json({ error: 'Não foi possível consultar os metadados do banco.' });
    }
  });

  app.use('/api', router);

  return app;
}
