/**
 * Servidor Express do Lupa Territorial (porta 3000).
 * Centraliza chamadas às APIs IBGE/Ipeadata, persiste cache no SQLite e expõe rotas /api/* para o front-end.
 */

import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { openDatabase, runMigrations } from './src/db/schema.ts';
import { ensureStateDataLoaded, ensureStatesList } from './src/services/externalData.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const db = openDatabase();
  runMigrations(db);

  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Lista todas as UFs disponíveis (e eventual estado fictício de teste se seedado)
  app.get('/api/states', async (_req: Request, res: Response) => {
    try {
      const { states, isOffline, collectedAt } = await ensureStatesList(db);
      res.json({
        isOffline,
        collectedAt,
        hasTestData: states.some((s) => s.is_teste === 1),
        states: states.map((s) => ({
          id: s.id,
          sigla: s.sigla,
          nome: s.nome,
          regiao: s.regiao,
          isOffline: s.is_offline === 1,
          isTeste: s.is_teste === 1,
          collectedAt: s.collected_at,
        })),
      });
    } catch (err) {
      console.error('Erro em GET /api/states:', err);
      res.status(502).json({ error: 'Não foi possível carregar a lista de estados.' });
    }
  });

  // Retorna malha, municípios, valores mais recentes, histórico de tendências e catálogo de fontes para uma UF
  app.get('/api/states/:stateId/overview', async (req: Request, res: Response) => {
    const stateId = Number(req.params.stateId);
    if (!Number.isInteger(stateId) || stateId < 1 || stateId > 999) {
      res.status(400).json({ error: 'Código de UF inválido.' });
      return;
    }

    try {
      const status = await ensureStateDataLoaded(db, stateId);

      const stateRow = db
        .prepare('SELECT id, sigla, nome, regiao, malha_geojson, collected_at, is_offline, is_teste FROM states WHERE id = ?')
        .get(stateId) as {
          id: number;
          sigla: string;
          nome: string;
          regiao: string;
          malha_geojson: string | null;
          collected_at: string;
          is_offline: number;
          is_teste: number;
        } | undefined;

      if (!stateRow) {
        res.status(404).json({ error: 'Estado não encontrado.' });
        return;
      }

      const indicators = db
        .prepare(`
          SELECT code, nome, nome_curto, unidade, fonte, tabela_codigo, variavel_codigo,
                 classificacao, ano_referencia, incluir_no_indice, maior_e_melhor,
                 peso_padrao, source_url, descricao
          FROM indicators
          ORDER BY incluir_no_indice DESC, peso_padrao DESC, ano_referencia DESC
        `)
        .all() as Array<{
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
        }>;

      const municipalities = db
        .prepare(`
          SELECT id, nome, microrregiao, regiao_imediata, is_teste
          FROM municipalities
          WHERE state_id = ?
          ORDER BY nome ASC
        `)
        .all(stateId) as Array<{
          id: string;
          nome: string;
          microrregiao: string | null;
          regiao_imediata: string | null;
          is_teste: number;
        }>;

      const valuesRows = db
        .prepare(`
          SELECT iv.municipality_id, iv.indicator_code, iv.ano, iv.valor, iv.source_mode
          FROM indicator_values iv
          JOIN municipalities m ON m.id = iv.municipality_id
          WHERE m.state_id = ?
          ORDER BY iv.ano ASC
        `)
        .all(stateId) as Array<{
          municipality_id: string;
          indicator_code: string;
          ano: number;
          valor: number | null;
          source_mode: string;
        }>;

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

        // Mantém o ano mais recente disponível para cada indicador na visão comparativa/índice
        const current = entry.values[row.indicator_code];
        if (!current || row.ano >= current.ano) {
          entry.values[row.indicator_code] = { valor: row.valor, ano: row.ano };
        }

        if (
          (row.indicator_code === 'populacao' || row.indicator_code === 'bolsa_familia_taxa') &&
          typeof row.valor === 'number' &&
          Number.isFinite(row.valor)
        ) {
          entry.trends[row.indicator_code].push({ ano: row.ano, valor: row.valor });
        }
      }

      res.json({
        state: {
          id: stateRow.id,
          sigla: stateRow.sigla,
          nome: stateRow.nome,
          regiao: stateRow.regiao,
          collectedAt: status.collectedAt,
          isOffline: status.isOffline,
          isTeste: status.isTeste || stateRow.is_teste === 1,
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
          anoReferencia: ind.ano_referencia,
          incluirNoIndice: ind.incluir_no_indice === 1,
          maiorEMelhor: ind.maior_e_melhor === 1,
          pesoPadrao: ind.peso_padrao,
          sourceUrl: ind.source_url,
          descricao: ind.descricao,
        })),
        municipalities: municipalities.map((m) => ({
          id: m.id,
          nome: m.nome,
          microrregiao: m.microrregiao,
          regiaoImediata: m.regiao_imediata,
          isTeste: m.is_teste === 1,
          values: byMun[m.id]?.values || {},
          trends: byMun[m.id]?.trends || { populacao: [], bolsa_familia_taxa: [] },
        })),
        malhaGeoJson: stateRow.malha_geojson ? JSON.parse(stateRow.malha_geojson) : null,
        ipeadataNotice:
          'O IVS (AVS_IVS) no Ipeadata existe apenas para Brasil, Regiões e Estados (sem série municipal). Por isso utilizamos a taxa municipal de benefícios do Bolsa Família por 1.000 habitantes (FAM_PBF) e, com peso padrão 0 por serem de 2010, o IDHM (ADH_IDHM) e a proporção de vulneráveis à pobreza (ADH_PPOB).',
      });
    } catch (err) {
      console.error('Erro em GET /api/states/:stateId/overview:', err);
      res.status(502).json({
        error: 'Não foi possível carregar os indicadores desta UF nem pelos servidores oficiais nem pelo cache offline.',
      });
    }
  });

  // Metadados gerais e estatísticas do cache SQLite para a página "Sobre os dados"
  app.get('/api/about', (_req: Request, res: Response) => {
    const indicators = db
      .prepare('SELECT code, nome, nome_curto, unidade, fonte, tabela_codigo, variavel_codigo, classificacao, ano_referencia, incluir_no_indice, maior_e_melhor, peso_padrao, source_url, descricao FROM indicators')
      .all();
    const stats = db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM states WHERE is_teste = 0 AND malha_geojson IS NOT NULL) as cachedStates,
          (SELECT COUNT(*) FROM municipalities WHERE is_teste = 0) as cachedMunicipalities,
          (SELECT COUNT(*) FROM indicator_values WHERE is_teste = 0) as cachedValues,
          (SELECT COUNT(*) FROM indicator_values WHERE is_teste = 1) as testValues,
          (SELECT MAX(collected_at) FROM states WHERE is_teste = 0) as lastCollectedAt
      `)
      .get();

    res.json({ indicators, stats });
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build não encontrado.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Lupa Territorial ativo em http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Falha ao iniciar servidor:', err);
  process.exit(1);
});
