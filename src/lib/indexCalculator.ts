/**
 * Funções puras de normalização min-máx (0 a 1) e cálculo do índice composto de vulnerabilidade.
 * Regra de negócio: no índice composto, 1 = município mais vulnerável do estado e 0 = menos vulnerável.
 */

import { INDICATORS_CATALOG, type IndicatorDefinition } from './indicatorsCatalog.ts';

export interface MunicipalityMetricInput {
  municipalityId: string;
  values: Record<string, number | null | undefined>;
}

export interface NormalizedMunicipalityResult {
  municipalityId: string;
  /** Valores normalizados já orientados para vulnerabilidade (0 = melhor, 1 = mais vulnerável) */
  normalizedVulnerability: Record<string, number | null>;
  /** Valores normalizados na direção positiva para leitura em radar (0 = pior no estado, 1 = melhor no estado) */
  normalizedPerformance: Record<string, number | null>;
  /** Índice composto ponderado (0 a 1, onde 1 = mais vulnerável do estado) */
  compositeIndex: number | null;
  /** Quantidade de indicadores válidos usados no cálculo deste município */
  usedIndicators: number;
}

export interface MinMaxBounds {
  min: number;
  max: number;
}

/**
 * Normaliza um valor numérico pela escala min-máx entre 0 e 1.
 * Se min === max (empate estadual), retorna 0.5 neutro para evitar divisão por zero.
 */
export function normalizeMinMax(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('Valores inválidos para normalização min-máx.');
  }
  if (max === min) {
    return 0.5;
  }
  const ratio = (value - min) / (max - min);
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Converte um valor normalizado para a escala de vulnerabilidade (1 = mais vulnerável).
 * Quando `maiorEMelhor` é verdadeiro (ex.: renda, alfabetização, água, esgoto, lixo), inverte: 1 - norm.
 */
export function toVulnerabilityScore(
  value: number,
  bounds: MinMaxBounds,
  maiorEMelhor: boolean,
): number {
  const norm = normalizeMinMax(value, bounds.min, bounds.max);
  return maiorEMelhor ? 1 - norm : norm;
}

/**
 * Calcula mínimo e máximo estaduais para cada indicador do catálogo.
 */
export function computeStateBounds(
  municipalities: MunicipalityMetricInput[],
  catalog: IndicatorDefinition[] = INDICATORS_CATALOG,
): Record<string, MinMaxBounds | null> {
  const bounds: Record<string, MinMaxBounds | null> = {};

  for (const ind of catalog) {
    if (!ind.incluirNoIndice) continue;
    let min = Infinity;
    let max = -Infinity;

    for (const mun of municipalities) {
      const val = mun.values[ind.code];
      if (typeof val === 'number' && Number.isFinite(val)) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }

    bounds[ind.code] = min <= max ? { min, max } : null;
  }

  return bounds;
}

/**
 * Calcula os scores normalizados e o índice composto de vulnerabilidade para todos os municípios de um estado.
 * Fatores ausentes em um município são ignorados na média ponderada daquele município (soma dos pesos disponíveis).
 */
export function computeCompositeIndexForState(
  municipalities: MunicipalityMetricInput[],
  weights: Record<string, number>,
  catalog: IndicatorDefinition[] = INDICATORS_CATALOG,
): Record<string, NormalizedMunicipalityResult> {
  const indexIndicators = catalog.filter((i) => i.incluirNoIndice);
  const bounds = computeStateBounds(municipalities, indexIndicators);
  const results: Record<string, NormalizedMunicipalityResult> = {};

  for (const mun of municipalities) {
    const normalizedVulnerability: Record<string, number | null> = {};
    const normalizedPerformance: Record<string, number | null> = {};
    let weightedSum = 0;
    let totalWeight = 0;
    let usedIndicators = 0;

    for (const ind of indexIndicators) {
      const raw = mun.values[ind.code];
      const b = bounds[ind.code];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || !b) {
        normalizedVulnerability[ind.code] = null;
        normalizedPerformance[ind.code] = null;
        continue;
      }

      const vuln = toVulnerabilityScore(raw, b, ind.maiorEMelhor);
      normalizedVulnerability[ind.code] = vuln;
      // Para o radar de desempenho comparativo, 1 representa a melhor situação relativa no estado.
      normalizedPerformance[ind.code] = 1 - vuln;

      const w = Math.max(0, Number(weights[ind.code] ?? 0));
      if (w > 0) {
        weightedSum += vuln * w;
        totalWeight += w;
        usedIndicators += 1;
      }
    }

    results[mun.municipalityId] = {
      municipalityId: mun.municipalityId,
      normalizedVulnerability,
      normalizedPerformance,
      compositeIndex: totalWeight > 0 ? weightedSum / totalWeight : null,
      usedIndicators,
    };
  }

  return results;
}

export interface SensitivityIndicatorShift {
  indicatorCode: string;
  indicatorName: string;
  currentWeight: number;
  baseRank: number | null;
  newRank: number | null;
  /** Diferença de posição no ranking (1º = mais vulnerável): positivo = subiu posições; negativo = desceu posições */
  rankDelta: number | null;
  baseIndex: number | null;
  newIndex: number | null;
}

export interface MunicipalitySensitivityResult {
  municipalityId: string;
  totalRanked: number;
  baseRank: number | null;
  baseIndex: number | null;
  shifts: SensitivityIndicatorShift[];
}

/**
 * Ordena os municípios pelo índice composto (1º = maior vulnerabilidade do estado).
 * Empates exatos são desempatados pelo código IBGE para manter determinismo.
 */
export function rankMunicipalitiesByIndex(
  results: Record<string, NormalizedMunicipalityResult>,
): { ranks: Record<string, number | null>; totalRanked: number } {
  const valid = Object.values(results)
    .filter((r): r is NormalizedMunicipalityResult & { compositeIndex: number } => r.compositeIndex !== null)
    .sort((a, b) => {
      const diff = b.compositeIndex - a.compositeIndex;
      if (Math.abs(diff) > 1e-12) return diff;
      return a.municipalityId.localeCompare(b.municipalityId);
    });

  const ranks: Record<string, number | null> = {};
  for (const id of Object.keys(results)) {
    ranks[id] = null;
  }
  valid.forEach((item, idx) => {
    ranks[item.municipalityId] = idx + 1;
  });

  return { ranks, totalRanked: valid.length };
}

/**
 * Análise de sensibilidade: para os municípios selecionados, calcula a posição atual no ranking do estado
 * e a nova posição ao zerar o peso de cada indicador individualmente (1 por vez).
 * Mudanças grandes indicam que a colocação daquele município depende fortemente daquele indicador.
 */
export function computeSensitivityAnalysis(
  municipalities: MunicipalityMetricInput[],
  weights: Record<string, number>,
  selectedMunicipalityIds: string[],
  catalog: IndicatorDefinition[] = INDICATORS_CATALOG,
): Record<string, MunicipalitySensitivityResult> {
  const indexIndicators = catalog.filter((i) => i.incluirNoIndice);
  const baseResults = computeCompositeIndexForState(municipalities, weights, indexIndicators);
  const { ranks: baseRanks, totalRanked } = rankMunicipalitiesByIndex(baseResults);

  // Calcula uma vez o ranking estadual sem cada indicador ativo (peso = 0)
  const scenarioByIndicator: Record<
    string,
    {
      currentWeight: number;
      results: Record<string, NormalizedMunicipalityResult>;
      ranks: Record<string, number | null>;
    }
  > = {};

  for (const ind of indexIndicators) {
    const currentWeight = Math.max(0, Number(weights[ind.code] ?? 0));
    if (currentWeight <= 0) {
      scenarioByIndicator[ind.code] = {
        currentWeight: 0,
        results: baseResults,
        ranks: baseRanks,
      };
      continue;
    }

    const withoutIndWeights = { ...weights, [ind.code]: 0 };
    const scenarioResults = computeCompositeIndexForState(municipalities, withoutIndWeights, indexIndicators);
    const { ranks } = rankMunicipalitiesByIndex(scenarioResults);
    scenarioByIndicator[ind.code] = {
      currentWeight,
      results: scenarioResults,
      ranks,
    };
  }

  const output: Record<string, MunicipalitySensitivityResult> = {};
  for (const munId of selectedMunicipalityIds) {
    const baseRank = baseRanks[munId] ?? null;
    const baseIndex = baseResults[munId]?.compositeIndex ?? null;

    const shifts: SensitivityIndicatorShift[] = indexIndicators.map((ind) => {
      const scenario = scenarioByIndicator[ind.code];
      if (scenario.currentWeight <= 0) {
        return {
          indicatorCode: ind.code,
          indicatorName: ind.nomeCurto,
          currentWeight: 0,
          baseRank,
          newRank: baseRank,
          rankDelta: baseRank !== null ? 0 : null,
          baseIndex,
          newIndex: baseIndex,
        };
      }

      const newRank = scenario.ranks[munId] ?? null;
      const newIndex = scenario.results[munId]?.compositeIndex ?? null;
      const rankDelta = baseRank !== null && newRank !== null ? baseRank - newRank : null;

      return {
        indicatorCode: ind.code,
        indicatorName: ind.nomeCurto,
        currentWeight: scenario.currentWeight,
        baseRank,
        newRank,
        rankDelta,
        baseIndex,
        newIndex,
      };
    });

    output[munId] = {
      municipalityId: munId,
      totalRanked,
      baseRank,
      baseIndex,
      shifts,
    };
  }

  return output;
}

