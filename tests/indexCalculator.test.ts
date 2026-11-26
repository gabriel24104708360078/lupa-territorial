/**
 * Testes unitários da normalização min-máx (0 a 1), inversão de direção e cálculo do índice composto.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCompositeIndexForState,
  computeStateBounds,
  normalizeMinMax,
  toVulnerabilityScore,
} from '../src/lib/indexCalculator.ts';

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
