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
