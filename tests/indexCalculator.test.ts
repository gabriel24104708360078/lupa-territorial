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
import { convertQuestionMarksToPg } from '../src/db/client.ts';

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
  // Cenário com 3 municípios em que M2 possui renda muito pior que M3, mas água/esgoto melhores:
  // Com peso igual entre renda_2022 e agua_2022:
  // M1: renda=1000 (vuln 1.0), agua=20 (vuln 1.0) -> média 1.00 (1º)
  // M2: renda=1200 (vuln 0.9), agua=90 (vuln 0.125) -> média 0.5125 (2º)
  // M3: renda=3000 (vuln 0.0), agua=100 (vuln 0.0) -> média 0.00 (3º)
  // Mas se colocarmos M4 intermediário com renda=2500 (vuln 0.25) e agua=30 (vuln 0.875) -> média 0.5625 (2º), M2 fica em 3º.
  // Ao retirar renda_2022 (peso 0), M2 cai de 0.5125 para 0.125 e M4 vai para 0.875, ou ao retirar agua_2022, M2 salta para 2º (+1)!
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

  // Ao retirar agua_2022 (em que M2 era bom), M2 passa a ser avaliado só por renda (vuln 0.9) e sobe de 3º para 2º (+1)
  const aguaShiftM2 = sM2.shifts.find((s) => s.indicatorCode === 'agua_2022');
  assert.ok(aguaShiftM2);
  assert.equal(aguaShiftM2.newRank, 2);
  assert.equal(aguaShiftM2.rankDelta, 1);

  // M4, por outro lado, cai de 2º para 3º (-1) quando agua_2022 é retirada
  const aguaShiftM4 = sensitivity['M4'].shifts.find((s) => s.indicatorCode === 'agua_2022');
  assert.ok(aguaShiftM4);
  assert.equal(aguaShiftM4.newRank, 3);
  assert.equal(aguaShiftM4.rankDelta, -1);

  // Indicador já zerado (idhm_2010) mantém rankDelta = 0
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
