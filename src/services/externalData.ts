/**
 * Serviço de coleta, cache em banco (SQLite local ou PostgreSQL na publicação) e fallback offline para IBGE e Ipeadata.
 * Nunca expõe segredos no front-end e sempre registra a data de coleta e o modo (online/offline) por indicador.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AppDatabase } from '../db/client.ts';

export interface StateRow {
  id: number;
  sigla: string;
  nome: string;
  regiao: string;
  malha_geojson: string | null;
  collected_at: string;
  is_offline: number;
  is_teste: number;
}

export interface RawMunicipality {
  id: string;
  stateId: number;
  nome: string;
  microrregiao: string | null;
  regiaoImediata: string | null;
}

export interface OfflineStateBundle {
  collectedAt: string;
  state: { id: number; sigla: string; nome: string; regiao: string };
  municipalities: RawMunicipality[];
  /** Mapa: municipalityId -> indicatorCode -> { ano: valor } */
  ibgeSeries: Record<string, Record<string, Record<string, number | null>>>;
}

function resolveDataDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'data'),
    path.resolve(import.meta.dirname ?? '.', '../../data'),
    path.resolve(import.meta.dirname ?? '.', '../../../data'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'states.json'))) {
      return dir;
    }
  }
  return candidates[0];
}

const DATA_DIR = resolveDataDir();
const FETCH_TIMEOUT_MS = 25000;
const IPEA_TIMEOUT_MS = 25000;
// Cache considerado fresco por 7 dias antes de tentar nova atualização online
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineIndicatorNotice {
  code: string;
  nome: string;
  collectedAt: string;
}

export interface SeriesSyncStatus {
  mode: 'online' | 'offline';
  collectedAt: string;
}

const INDICATOR_LABELS: Record<string, string> = {
  renda_2022: 'Renda per capita (IBGE 10295)',
  alfabetizacao_2022: 'Alfabetização (IBGE 9543)',
  agua_2022: 'Água por rede (IBGE 6803)',
  esgoto_2022: 'Esgotamento sanitário (IBGE 6805)',
  lixo_2022: 'Coleta de lixo (IBGE 6892)',
  populacao: 'População residente (IBGE 4714 / 6579)',
  domicilios: 'Domicílios ocupados (IBGE 4712)',
  bolsa_familia_taxa: 'Bolsa Família / 1.000 hab. (Ipeadata FAM_PBF)',
  idhm_2010: 'IDHM 2010 (Ipeadata ADH_IDHM)',
  vulneraveis_2010: 'Vulneráveis à pobreza 2010 (Ipeadata ADH_PPOB)',
};

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao consultar ${url}`);
  }
  return (await res.json()) as T;
}

function parseIbgeNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === '-' || s === '..' || s === '...' || s === 'X') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isCacheFresh(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false;
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < CACHE_TTL_MS;
}

function readOfflineJson<T>(relativePath: string): T | null {
  const fullPath = path.resolve(DATA_DIR, relativePath);
  // Garante confinamento dentro do diretório data/
  if (!fullPath.startsWith(DATA_DIR + path.sep) || !fs.existsSync(fullPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
}

/**
 * Busca a lista das 27 UFs (prioriza cache fresco no banco -> API IBGE -> data/states.json).
 */
export async function ensureStatesList(
  db: AppDatabase,
): Promise<{ states: StateRow[]; isOffline: boolean; collectedAt: string }> {
  const existing = await db.queryAll<StateRow>(
    'SELECT id, sigla, nome, regiao, malha_geojson, collected_at, is_offline, is_teste FROM states ORDER BY nome ASC',
  );

  const realStates = existing.filter((s) => Number(s.is_teste) === 0);
  if (realStates.length >= 27 && isCacheFresh(realStates[0]?.collected_at)) {
    return {
      states: existing,
      isOffline: realStates.some((s) => Number(s.is_offline) === 1),
      collectedAt: realStates[0].collected_at,
    };
  }

  try {
    const remote = await fetchJsonWithTimeout<Array<{ id: number; sigla: string; nome: string; regiao: { nome: string } }>>(
      'https://servicodados.ibge.gov.br/api/v1/localidades/estados',
    );
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      await tx.upsertBatch({
        table: 'states',
        columns: ['id', 'sigla', 'nome', 'regiao', 'collected_at', 'is_offline', 'is_teste'],
        rows: remote.map((uf) => [uf.id, uf.sigla, uf.nome, uf.regiao?.nome || '', now, 0, 0]),
        conflictColumns: ['id'],
        updateColumns: ['sigla', 'nome', 'regiao', 'collected_at', 'is_offline'],
      });
    });
  } catch {
    if (realStates.length >= 27) {
      return {
        states: existing,
        isOffline: true,
        collectedAt: realStates[0].collected_at,
      };
    }
    const offline = readOfflineJson<{
      collectedAt: string;
      states: Array<{ id: number; sigla: string; nome: string; regiao: string }>;
    }>('states.json');
    if (!offline) {
      throw new Error('Falha na API de localidades do IBGE e arquivo offline data/states.json indisponível.');
    }
    await db.transaction(async (tx) => {
      await tx.upsertBatch({
        table: 'states',
        columns: ['id', 'sigla', 'nome', 'regiao', 'collected_at', 'is_offline', 'is_teste'],
        rows: offline.states.map((uf) => [uf.id, uf.sigla, uf.nome, uf.regiao, offline.collectedAt, 1, 0]),
        conflictColumns: ['id'],
        updateColumns: ['sigla', 'nome', 'regiao', 'collected_at', 'is_offline'],
      });
    });
  }

  const updated = await db.queryAll<StateRow>(
    'SELECT id, sigla, nome, regiao, malha_geojson, collected_at, is_offline, is_teste FROM states ORDER BY nome ASC',
  );
  const realUpdated = updated.filter((s) => Number(s.is_teste) === 0);
  return {
    states: updated,
    isOffline: realUpdated.some((s) => Number(s.is_offline) === 1),
    collectedAt: realUpdated[0]?.collected_at || new Date().toISOString(),
  };
}

/**
 * Baixa e armazena em cache no banco as séries municipais do Ipeadata (uma única vez por série).
 * Regra: como o $filter da API OData do Ipeadata é lento/inconsistente, baixamos as séries em paralelo
 * no servidor, filtramos apenas NIVNOME === 'Municípios' e persistimos em `ipeadata_cache`.
 */
export async function ensureIpeadataSeries(
  db: AppDatabase,
  seriesCodes: string[] = ['FAM_PBF', 'ADH_IDHM', 'ADH_PPOB'],
): Promise<{
  isOffline: boolean;
  collectedAt: string;
  bySeries: Record<string, SeriesSyncStatus>;
}> {
  const bySeries: Record<string, SeriesSyncStatus> = {};
  const toFetch: string[] = [];

  for (const code of seriesCodes) {
    const cachedMeta = await db.queryOne<{ cnt: number | string; latest: string | null; mode: string | null }>(
      'SELECT COUNT(*) as cnt, MAX(collected_at) as latest, MAX(source_mode) as mode FROM ipeadata_cache WHERE series_code = ?',
      [code],
    );

    if (Number(cachedMeta?.cnt ?? 0) > 0 && isCacheFresh(cachedMeta?.latest)) {
      bySeries[code] = {
        mode: cachedMeta?.mode === 'offline' ? 'offline' : 'online',
        collectedAt: cachedMeta?.latest || new Date().toISOString(),
      };
    } else {
      toFetch.push(code);
    }
  }

  if (toFetch.length > 0) {
    const fetchedResults = await Promise.all(
      toFetch.map(async (code) => {
        try {
          const url = `https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='${encodeURIComponent(code)}')`;
          const payload = await fetchJsonWithTimeout<{
            value?: Array<{ SERCODIGO: string; VALDATA: string; VALVALOR: number | null; NIVNOME: string; TERCODIGO: string }>;
          }>(url, IPEA_TIMEOUT_MS);

          const now = new Date().toISOString();
          const dedup = new Map<string, { municipalityId: string; ano: number; valor: number }>();
          for (const r of payload.value || []) {
            if (
              r.NIVNOME !== 'Municípios' ||
              typeof r.VALVALOR !== 'number' ||
              !Number.isFinite(r.VALVALOR) ||
              !r.TERCODIGO
            ) {
              continue;
            }
            const municipalityId = String(r.TERCODIGO);
            const ano = Number(r.VALDATA.slice(0, 4));
            if (!Number.isInteger(ano) || (code === 'FAM_PBF' && ano < 2018)) {
              continue;
            }
            dedup.set(`${municipalityId}:${ano}`, { municipalityId, ano, valor: r.VALVALOR });
          }

          return { code, mode: 'online' as const, collectedAt: now, rows: Array.from(dedup.values()) };
        } catch {
          const offline = readOfflineJson<{
            collectedAt: string;
            seriesCode: string;
            rows: Array<{ municipalityId: string; ano: number; valor: number }>;
          }>(`ipeadata/${code}.json`);

          if (offline && offline.rows.length > 0) {
            const dedup = new Map<string, { municipalityId: string; ano: number; valor: number }>();
            for (const r of offline.rows) {
              dedup.set(`${r.municipalityId}:${r.ano}`, r);
            }
            return {
              code,
              mode: 'offline' as const,
              collectedAt: offline.collectedAt,
              rows: Array.from(dedup.values()),
            };
          }

          const cachedFallback = await db.queryOne<{ cnt: number | string; latest: string | null }>(
            'SELECT COUNT(*) as cnt, MAX(collected_at) as latest FROM ipeadata_cache WHERE series_code = ?',
            [code],
          );

          return {
            code,
            mode: 'offline' as const,
            collectedAt: cachedFallback?.latest || new Date().toISOString(),
            rows: [] as Array<{ municipalityId: string; ano: number; valor: number }>,
          };
        }
      }),
    );

    const allRows: unknown[][] = [];
    for (const item of fetchedResults) {
      for (const r of item.rows) {
        allRows.push([item.code, r.municipalityId, r.ano, r.valor, item.collectedAt, item.mode]);
      }
      bySeries[item.code] = {
        mode: item.mode,
        collectedAt: item.collectedAt,
      };
    }

    if (allRows.length > 0) {
      await db.transaction(async (tx) => {
        await tx.upsertBatch({
          table: 'ipeadata_cache',
          columns: ['series_code', 'municipality_id', 'ano', 'valor', 'collected_at', 'source_mode'],
          rows: allRows,
          conflictColumns: ['series_code', 'municipality_id', 'ano'],
          updateColumns: ['valor', 'collected_at', 'source_mode'],
        });
      });
    }
  }

  const statuses = Object.values(bySeries);
  const usedOffline = statuses.some((s) => s.mode === 'offline');
  const latestCollected = statuses.map((s) => s.collectedAt).sort().at(-1) || new Date().toISOString();

  return { isOffline: usedOffline, collectedAt: latestCollected, bySeries };
}

interface IbgeAgregadoResponseItem {
  id: string;
  variavel: string;
  resultados?: Array<{
    series?: Array<{
      localidade: { id: string; nome: string };
      serie: Record<string, string>;
    }>;
  }>;
}

/**
 * Busca todos os indicadores IBGE e a malha GeoJSON de um estado no IBGE,
 * retornando o bundle completo pronto para persistência no banco.
 */
export async function fetchIbgeStateBundleOnline(
  stateId: number,
  stateMeta: { id: number; sigla: string; nome: string; regiao: string },
): Promise<{
  bundle: OfflineStateBundle;
  malhaGeoJson: string;
}> {
  const [munRaw, malhaRaw, d10295, d9543, d6803, d6805, d6892, d4714, d4712, d6579] = await Promise.all([
    fetchJsonWithTimeout<
      Array<{ id: number; nome: string; microrregiao?: { nome?: string }; ['regiao-imediata']?: { nome?: string } }>
    >(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateId}/municipios`),
    fetchJsonWithTimeout<Record<string, unknown>>(
      `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${stateId}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima`,
      25000,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/10295/periodos/2022/variaveis/13431?localidades=N6[N3[${stateId}]]&classificacao=2[6794]|86[95251]|58[95253]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/9543/periodos/2022/variaveis/2513?localidades=N6[N3[${stateId}]]&classificacao=2[6794]|86[95251]|287[100362]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/6803/periodos/2022/variaveis/1000381?localidades=N6[N3[${stateId}]]&classificacao=1821[72144]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/6805/periodos/2022/variaveis/1000381?localidades=N6[N3[${stateId}]]&classificacao=11558[46290]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/6892/periodos/2022/variaveis/1000381?localidades=N6[N3[${stateId}]]&classificacao=67[2520]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93?localidades=N6[N3[${stateId}]]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/4712/periodos/2022/variaveis/381?localidades=N6[N3[${stateId}]]`,
    ),
    fetchJsonWithTimeout<IbgeAgregadoResponseItem[]>(
      `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/2018|2019|2020|2021|2024|2025/variaveis/9324?localidades=N6[N3[${stateId}]]`,
    ),
  ]);

  const municipalities: RawMunicipality[] = munRaw.map((m) => ({
    id: String(m.id),
    stateId,
    nome: m.nome,
    microrregiao: m.microrregiao?.nome || null,
    regiaoImediata: m['regiao-imediata']?.nome || null,
  }));

  const ibgeSeries: Record<string, Record<string, Record<string, number | null>>> = {};
  for (const m of municipalities) {
    ibgeSeries[m.id] = {};
  }

  const ingestAgregado = (indicatorCode: string, payload: IbgeAgregadoResponseItem[]) => {
    const seriesList = payload?.[0]?.resultados?.[0]?.series || [];
    for (const s of seriesList) {
      const munId = String(s.localidade?.id || '');
      if (!ibgeSeries[munId]) ibgeSeries[munId] = {};
      if (!ibgeSeries[munId][indicatorCode]) ibgeSeries[munId][indicatorCode] = {};
      for (const [year, val] of Object.entries(s.serie || {})) {
        ibgeSeries[munId][indicatorCode][year] = parseIbgeNumber(val);
      }
    }
  };

  ingestAgregado('renda_2022', d10295);
  ingestAgregado('alfabetizacao_2022', d9543);
  ingestAgregado('agua_2022', d6803);
  ingestAgregado('esgoto_2022', d6805);
  ingestAgregado('lixo_2022', d6892);
  ingestAgregado('populacao', d4714);
  ingestAgregado('domicilios', d4712);
  ingestAgregado('populacao', d6579);

  return {
    bundle: {
      collectedAt: new Date().toISOString(),
      state: stateMeta,
      municipalities,
      ibgeSeries,
    },
    malhaGeoJson: JSON.stringify(malhaRaw),
  };
}

async function getOfflineIndicatorsFromDb(db: AppDatabase, stateId: number): Promise<OfflineIndicatorNotice[]> {
  const rows = await db.queryAll<{ code: string; collectedAt: string }>(
    `
      SELECT iv.indicator_code AS code, MAX(iv.collected_at) AS "collectedAt"
      FROM indicator_values iv
      JOIN municipalities m ON m.id = iv.municipality_id
      WHERE m.state_id = ? AND iv.is_teste = 0 AND iv.source_mode = 'offline'
      GROUP BY iv.indicator_code
      ORDER BY iv.indicator_code ASC
    `,
    [stateId],
  );

  return rows.map((r) => ({
    code: r.code,
    nome: INDICATOR_LABELS[r.code] || r.code,
    collectedAt: r.collectedAt,
  }));
}

/**
 * Garante que os municípios, malha GeoJSON e valores de indicadores de um estado estejam no banco.
 * Fluxo: Cache fresco no banco -> API IBGE + Ipeadata em paralelo -> Fallback offline granular em data/ (27 UFs).
 */
export async function ensureStateDataLoaded(
  db: AppDatabase,
  stateId: number,
): Promise<{
  isOffline: boolean;
  offlineIndicators: OfflineIndicatorNotice[];
  isTeste: boolean;
  collectedAt: string;
}> {
  const { states } = await ensureStatesList(db);
  const stateRow = states.find((s) => Number(s.id) === stateId);
  if (!stateRow) {
    throw new Error(`UF ${stateId} não encontrada.`);
  }

  // Se for o estado fictício de teste (is_teste = 1), já está pronto no banco.
  if (Number(stateRow.is_teste) === 1) {
    return { isOffline: false, offlineIndicators: [], isTeste: true, collectedAt: stateRow.collected_at };
  }

  const munCountRow = await db.queryOne<{ cnt: number | string }>(
    'SELECT COUNT(*) as cnt FROM municipalities WHERE state_id = ? AND is_teste = 0',
    [stateId],
  );

  const valCheckRow = await db.queryOne<{ cnt: number | string; latest: string | null }>(
    `
      SELECT COUNT(*) as cnt, MAX(iv.collected_at) as latest
      FROM indicator_values iv
      JOIN municipalities m ON m.id = iv.municipality_id
      WHERE m.state_id = ? AND iv.is_teste = 0
    `,
    [stateId],
  );

  const munCnt = Number(munCountRow?.cnt ?? 0);
  const valCnt = Number(valCheckRow?.cnt ?? 0);

  if (munCnt > 0 && valCnt > 0 && stateRow.malha_geojson && isCacheFresh(valCheckRow?.latest)) {
    return {
      isOffline: Number(stateRow.is_offline) === 1,
      offlineIndicators: await getOfflineIndicatorsFromDb(db, stateId),
      isTeste: false,
      collectedAt: valCheckRow?.latest || stateRow.collected_at,
    };
  }

  // 1. Dispara em paralelo: séries Ipeadata (Promise.all interno) + todos os agregados/malha IBGE (Promise.all interno)
  const [ipeaStatus, ibgeAttempt] = await Promise.all([
    ensureIpeadataSeries(db),
    fetchIbgeStateBundleOnline(stateId, {
      id: Number(stateRow.id),
      sigla: stateRow.sigla,
      nome: stateRow.nome,
      regiao: stateRow.regiao,
    })
      .then((res) => ({ ok: true as const, ...res }))
      .catch(() => ({ ok: false as const })),
  ]);

  let bundle: OfflineStateBundle | null = null;
  let malhaGeoJson: string | null = null;
  let ibgeMode: 'online' | 'offline' = 'online';

  if (ibgeAttempt.ok) {
    bundle = ibgeAttempt.bundle;
    malhaGeoJson = ibgeAttempt.malhaGeoJson;
  } else {
    ibgeMode = 'offline';
    bundle = readOfflineJson<OfflineStateBundle>(`states/${stateId}.json`);
    const offlineGeo = readOfflineJson<Record<string, unknown>>(`malhas/${stateId}.geojson`);
    malhaGeoJson = offlineGeo ? JSON.stringify(offlineGeo) : null;

    if (!bundle || !malhaGeoJson) {
      if (munCnt > 0 && valCnt > 0 && stateRow.malha_geojson) {
        return {
          isOffline: true,
          offlineIndicators: await getOfflineIndicatorsFromDb(db, stateId),
          isTeste: false,
          collectedAt: valCheckRow?.latest || stateRow.collected_at,
        };
      }
      throw new Error(`Não foi possível carregar dados online nem offline para a UF ${stateRow.sigla} (${stateId}).`);
    }
  }

  // 2. Persiste municípios, malha e valores IBGE + Ipeadata no banco mantendo origem granular
  const ibgeCollectedAt = bundle.collectedAt;

  const ipeaRows = await db.queryAll<{
    series_code: string;
    municipality_id: string;
    ano: number;
    valor: number;
  }>(
    `
      SELECT series_code, municipality_id, ano, valor
      FROM ipeadata_cache
      WHERE municipality_id LIKE ?
    `,
    [`${stateId}%`],
  );

  const ipeaByMun: Record<string, Record<string, Record<number, number>>> = {};
  for (const row of ipeaRows) {
    if (!ipeaByMun[row.municipality_id]) ipeaByMun[row.municipality_id] = {};
    if (!ipeaByMun[row.municipality_id][row.series_code]) ipeaByMun[row.municipality_id][row.series_code] = {};
    ipeaByMun[row.municipality_id][row.series_code][Number(row.ano)] = Number(row.valor);
  }

  const pbfMeta = ipeaStatus.bySeries['FAM_PBF'] || { mode: 'offline', collectedAt: ibgeCollectedAt };
  const idhmMeta = ipeaStatus.bySeries['ADH_IDHM'] || { mode: 'offline', collectedAt: ibgeCollectedAt };
  const ppobMeta = ipeaStatus.bySeries['ADH_PPOB'] || { mode: 'offline', collectedAt: ibgeCollectedAt };

  const munRows: unknown[][] = [];
  const valMap = new Map<string, unknown[]>();

  for (const mun of bundle.municipalities) {
    munRows.push([mun.id, stateId, mun.nome, mun.microrregiao, mun.regiaoImediata, 0]);

    const munIbge = bundle.ibgeSeries[mun.id] || {};
    for (const [indCode, yearsObj] of Object.entries(munIbge)) {
      for (const [yearStr, val] of Object.entries(yearsObj)) {
        const ano = Number(yearStr);
        if (Number.isInteger(ano)) {
          valMap.set(`${mun.id}:${indCode}:${ano}`, [mun.id, indCode, ano, val, ibgeCollectedAt, ibgeMode, 0]);
        }
      }
    }

    const munIpea = ipeaByMun[mun.id] || {};
    const popMap = munIbge['populacao'] || {};
    const pop2022 = popMap['2022'];

    const famPbfYears = munIpea['FAM_PBF'] || {};
    for (const [anoStr, benefCount] of Object.entries(famPbfYears)) {
      const ano = Number(anoStr);
      const popRef = popMap[anoStr] ?? pop2022;
      if (typeof popRef === 'number' && popRef > 0) {
        const taxaPorMil = Number(((benefCount / popRef) * 1000).toFixed(2));
        valMap.set(`${mun.id}:bolsa_familia_taxa:${ano}`, [
          mun.id,
          'bolsa_familia_taxa',
          ano,
          taxaPorMil,
          pbfMeta.collectedAt,
          pbfMeta.mode,
          0,
        ]);
      }
    }

    const idhmYears = munIpea['ADH_IDHM'] || {};
    for (const [anoStr, val] of Object.entries(idhmYears)) {
      const ano = Number(anoStr);
      valMap.set(`${mun.id}:idhm_2010:${ano}`, [mun.id, 'idhm_2010', ano, val, idhmMeta.collectedAt, idhmMeta.mode, 0]);
    }

    const ppobYears = munIpea['ADH_PPOB'] || {};
    for (const [anoStr, val] of Object.entries(ppobYears)) {
      const ano = Number(anoStr);
      valMap.set(`${mun.id}:vulneraveis_2010:${ano}`, [
        mun.id,
        'vulneraveis_2010',
        ano,
        val,
        ppobMeta.collectedAt,
        ppobMeta.mode,
        0,
      ]);
    }
  }

  await db.transaction(async (tx) => {
    await tx.execute('UPDATE states SET malha_geojson = ?, collected_at = ?, is_offline = ? WHERE id = ?', [
      malhaGeoJson,
      ibgeCollectedAt,
      ibgeMode === 'offline' ? 1 : 0,
      stateId,
    ]);

    await tx.upsertBatch({
      table: 'municipalities',
      columns: ['id', 'state_id', 'nome', 'microrregiao', 'regiao_imediata', 'is_teste'],
      rows: munRows,
      conflictColumns: ['id'],
      updateColumns: ['nome', 'microrregiao', 'regiao_imediata'],
    });

    await tx.upsertBatch({
      table: 'indicator_values',
      columns: ['municipality_id', 'indicator_code', 'ano', 'valor', 'collected_at', 'source_mode', 'is_teste'],
      rows: Array.from(valMap.values()),
      conflictColumns: ['municipality_id', 'indicator_code', 'ano', 'is_teste'],
      updateColumns: ['valor', 'collected_at', 'source_mode'],
    });
  });

  return {
    isOffline: ibgeMode === 'offline',
    offlineIndicators: await getOfflineIndicatorsFromDb(db, stateId),
    isTeste: false,
    collectedAt: ibgeCollectedAt,
  };
}
