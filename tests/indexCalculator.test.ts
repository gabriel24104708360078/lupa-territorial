/**
 * Testes unitários da normalização min-máx (0 a 1), inversão de direção e cálculo do índice composto.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCompositeIndexForState,
  computeSensitivityAnalysis,
  computeStateBounds,
  normalizeMinMax,
  rankMunicipalitiesByIndex,
  toVulnerabilityScore,
} from '../src/lib/indexCalculator.ts';
import { convertQuestionMarksToPg, normalizePgConnectionString } from '../src/db/client.ts';
import { isPgAlreadyExistsError } from '../src/db/schema.ts';
import { isNeededIpeadataRow } from '../src/services/externalData.ts';

test('normalizeMinMax normaliza corretamente no intervalo [0, 1]', () => {
  assert.equal(normalizeMinMax(100, 100, 500), 0);
  assert.equal(normalizeMinMax(500, 100, 500), 1);
  assert.equal(normalizeMinMax(300, 100, 500), 0.5);
});

test('normalizeMinMax retorna 0.5 neutro quando min === max (evita divisão por zero)', () => {
  assert.equal(normalizeMinMax(42, 42, 42), 0.5);
});

test('toVulnerabilityScore inverte indicadores em que maior é melhor (1 = mais vulnerável)', () => {
  // Renda: maior é melhor -> quem ganha o mínimo (1000) tem vulnerabilidade 1; quem ganha o máximo (3000) tem 0.
  assert.equal(toVulnerabilityScore(1000, { min: 1000, max: 3000 }, true), 1);
  assert.equal(toVulnerabilityScore(3000, { min: 1000, max: 3000 }, true), 0);
  assert.equal(toVulnerabilityScore(2000, { min: 1000, max: 3000 }, true), 0.5);

  // Bolsa Família por 1k hab: maior indica maior vulnerabilidade -> não inverte.
  assert.equal(toVulnerabilityScore(50, { min: 50, max: 250 }, false), 0);
  assert.equal(toVulnerabilityScore(250, { min: 50, max: 250 }, false), 1);
});

test('computeCompositeIndexForState recalcula corretamente ao alterar pesos e ignora pesos zerados', () => {
  const municipalities = [
    {
      municipalityId: 'A',
      values: {
        renda_2022: 3000,
        alfabetizacao_2022: 98,
        agua_2022: 100,
        esgoto_2022: 100,
        lixo_2022: 100,
        bolsa_familia_taxa: 20,
        idhm_2010: 0.85,
        vulneraveis_2010: 10,
      },
    },
    {
      municipalityId: 'B',
      values: {
        renda_2022: 1000,
        alfabetizacao_2022: 80,
        agua_2022: 50,
        esgoto_2022: 20,
        lixo_2022: 60,
        bolsa_familia_taxa: 220,
        idhm_2010: 0.55,
        vulneraveis_2010: 50,
      },
    },
    {
      municipalityId: 'C',
      values: {
        renda_2022: 2000,
        alfabetizacao_2022: 89,
        agua_2022: 75,
        esgoto_2022: 60,
        lixo_2022: 80,
        bolsa_familia_taxa: 120,
        idhm_2010: 0.70,
        vulneraveis_2010: 30,
      },
    },
  ];

  // Pesos padrão: 1 para os 6 indicadores principais, 0 para idhm_2010 e vulneraveis_2010
  const equalWeights = {
    renda_2022: 1,
    alfabetizacao_2022: 1,
    agua_2022: 1,
    esgoto_2022: 1,
    lixo_2022: 1,
    bolsa_familia_taxa: 1,
    idhm_2010: 0,
    vulneraveis_2010: 0,
  };

  const resDefault = computeCompositeIndexForState(municipalities, equalWeights);
  assert.equal(resDefault['A'].compositeIndex, 0);
  assert.equal(resDefault['B'].compositeIndex, 1);
  assert.ok(Math.abs((resDefault['C'].compositeIndex ?? 0) - 0.5) < 1e-9);
  assert.equal(resDefault['C'].usedIndicators, 6);

  // Peso somente em renda_2022 para validar recálculo dinâmico
  const onlyIncome = computeCompositeIndexForState(municipalities, { renda_2022: 3 });
  assert.equal(onlyIncome['A'].compositeIndex, 0);
  assert.equal(onlyIncome['B'].compositeIndex, 1);
  assert.equal(onlyIncome['C'].usedIndicators, 1);
});

test('computeStateBounds e computeCompositeIndexForState lidam com valores nulos sem quebrar', () => {
  const municipalities = [
    { municipalityId: '1', values: { renda_2022: 1200, agua_2022: null } },
    { municipalityId: '2', values: { renda_2022: 2400, agua_2022: null } },
  ];
  const bounds = computeStateBounds(municipalities);
  assert.deepEqual(bounds['renda_2022'], { min: 1200, max: 2400 });
  assert.equal(bounds['agua_2022'], null);

  const res = computeCompositeIndexForState(municipalities, { renda_2022: 1, agua_2022: 1 });
  assert.equal(res['1'].compositeIndex, 1);
  assert.equal(res['2'].compositeIndex, 0);
  assert.equal(res['1'].normalizedVulnerability['agua_2022'], null);
});

test('computeSensitivityAnalysis calcula ranking estadual e deslocamento ao retirar cada indicador', () => {
  const municipalities = [
    { municipalityId: 'M1', values: { renda_2022: 1000, agua_2022: 20 } },
    { municipalityId: 'M2', values: { renda_2022: 1200, agua_2022: 90 } },
    { municipalityId: 'M4', values: { renda_2022: 2500, agua_2022: 30 } },
    { municipalityId: 'M3', values: { renda_2022: 3000, agua_2022: 100 } },
  ];

  const weights = { renda_2022: 1, agua_2022: 1, idhm_2010: 0 };
  const base = computeCompositeIndexForState(municipalities, weights);
  const ranked = rankMunicipalitiesByIndex(base);
  assert.equal(ranked.totalRanked, 4);
  assert.equal(ranked.ranks['M1'], 1);
  assert.equal(ranked.ranks['M4'], 2);
  assert.equal(ranked.ranks['M2'], 3);
  assert.equal(ranked.ranks['M3'], 4);

  const sensitivity = computeSensitivityAnalysis(municipalities, weights, ['M2', 'M4']);
  const sM2 = sensitivity['M2'];
  assert.equal(sM2.baseRank, 3);

  const aguaShiftM2 = sM2.shifts.find((s) => s.indicatorCode === 'agua_2022');
  assert.ok(aguaShiftM2);
  assert.equal(aguaShiftM2.newRank, 2);
  assert.equal(aguaShiftM2.rankDelta, 1);

  const aguaShiftM4 = sensitivity['M4'].shifts.find((s) => s.indicatorCode === 'agua_2022');
  assert.ok(aguaShiftM4);
  assert.equal(aguaShiftM4.newRank, 3);
  assert.equal(aguaShiftM4.rankDelta, -1);

  const idhmShiftM2 = sM2.shifts.find((s) => s.indicatorCode === 'idhm_2010');
  assert.ok(idhmShiftM2);
  assert.equal(idhmShiftM2.rankDelta, 0);
});

test('convertQuestionMarksToPg converte placeholders sem alterar strings literais', () => {
  const sql = "SELECT * FROM states WHERE sigla = ? AND nome != 'Teste?' AND id = ?";
  assert.equal(
    convertQuestionMarksToPg(sql),
    "SELECT * FROM states WHERE sigla = $1 AND nome != 'Teste?' AND id = $2",
  );
});

test('normalizePgConnectionString configura sslmode=verify-full explicitamente em bancos remotos', () => {
  const neon = normalizePgConnectionString(
    'postgresql://user:pass@ep-cool.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  );
  assert.ok(neon.connectionString.includes('sslmode=verify-full'));
  assert.ok(neon.connectionString.includes('channel_binding=require'));
  assert.deepEqual(neon.ssl, { rejectUnauthorized: true });

  const local = normalizePgConnectionString('postgresql://postgres:postgres@localhost:5432/lupa?sslmode=disable');
  assert.equal(local.ssl, false);
});

test('isPgAlreadyExistsError reconhece códigos 23505 e 42P07 de DDL concorrente', () => {
  assert.equal(isPgAlreadyExistsError({ code: '23505' }), true);
  assert.equal(isPgAlreadyExistsError({ code: '42P07' }), true);
  assert.equal(isPgAlreadyExistsError({ code: '42601' }), false);
  assert.equal(isPgAlreadyExistsError(null), false);
});

test('isNeededIpeadataRow filtra apenas municípios da UF e anos usados pelo aplicativo', () => {
  // BA = 29, MG = 31
  assert.equal(isNeededIpeadataRow('FAM_PBF', '2927408', 2025, '29'), true);
  assert.equal(isNeededIpeadataRow('FAM_PBF', '2927408', 2018, '29'), true);
  assert.equal(isNeededIpeadataRow('FAM_PBF', '2927408', 2017, '29'), false);
  assert.equal(isNeededIpeadataRow('FAM_PBF', '3106200', 2025, '29'), false);

  assert.equal(isNeededIpeadataRow('ADH_IDHM', '2927408', 2010, '29'), true);
  assert.equal(isNeededIpeadataRow('ADH_IDHM', '2927408', 2000, '29'), false);
  assert.equal(isNeededIpeadataRow('ADH_PPOB', '2927408', 2010, '29'), true);
  assert.equal(isNeededIpeadataRow('ADH_PPOB', '2927408', 1991, '29'), false);
});
