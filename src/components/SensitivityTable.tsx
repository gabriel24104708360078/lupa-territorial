/**
 * Tabela acessível de análise de sensibilidade do ranking estadual.
 * Mostra a posição atual e a variação de posições quando cada indicador é retirado (peso 0).
 */

import type { MunicipalitySensitivityResult } from '../lib/indexCalculator.ts';
import type { IndicatorMeta, MunicipalityData } from '../types/territorial.ts';

interface SensitivityTableProps {
  municipalities: MunicipalityData[];
  indicators: IndicatorMeta[];
  sensitivityByMun: Record<string, MunicipalitySensitivityResult>;
}

function formatShiftDescription(
  baseRank: number | null,
  newRank: number | null,
  rankDelta: number | null,
  currentWeight: number,
  totalRanked: number,
): { primary: string; detail: string; isLarge: boolean } {
  if (currentWeight <= 0) {
    return {
      primary: baseRank !== null ? `${baseRank}º (peso 0)` : '—',
      detail: 'Já está com peso 0',
      isLarge: false,
    };
  }
  if (newRank === null || baseRank === null || rankDelta === null) {
    return {
      primary: 'Sem índice',
      detail: 'Único peso ativo no cálculo',
      isLarge: false,
    };
  }
  const threshold = Math.max(3, Math.round(totalRanked * 0.05));
  const isLarge = Math.abs(rankDelta) >= threshold;

  if (rankDelta > 0) {
    return {
      primary: `${newRank}º (+${rankDelta})`,
      detail: `Sobe ${rankDelta} ${rankDelta === 1 ? 'posição' : 'posições'}${isLarge ? ' · Alta dependência' : ''}`,
      isLarge,
    };
  }
  if (rankDelta < 0) {
    const abs = Math.abs(rankDelta);
    return {
      primary: `${newRank}º (-${abs})`,
      detail: `Desce ${abs} ${abs === 1 ? 'posição' : 'posições'}${isLarge ? ' · Alta dependência' : ''}`,
      isLarge,
    };
  }
  return {
    primary: `${newRank}º (0)`,
    detail: 'Mantém a mesma posição',
    isLarge: false,
  };
}

export function SensitivityTable({
  municipalities,
  indicators,
  sensitivityByMun,
}: SensitivityTableProps) {
  const indexIndicators = indicators.filter((i) => i.incluirNoIndice);

  if (municipalities.length === 0) {
    return (
      <section aria-labelledby="sensitivity-title" className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 id="sensitivity-title" className="text-base font-semibold text-slate-900">
          Análise de sensibilidade no ranking do estado
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Selecione ao menos um município para visualizar como a posição no ranking estadual varia ao retirar cada indicador.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="sensitivity-title" className="rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <h2 id="sensitivity-title" className="text-base font-semibold text-slate-900">
          Análise de sensibilidade no ranking do estado
        </h2>
        <p className="mt-1 text-xs text-slate-700">
          Mostra a posição atual (onde <strong>1º</strong> é o mais vulnerável do estado) e a nova posição quando cada
          indicador é retirado individualmente (<strong>peso = 0</strong>).{' '}
          <strong>Mudanças grandes indicam que o resultado daquele município depende muito daquele indicador.</strong>
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <th scope="col" className="py-2.5 pr-4 pl-3 font-semibold">
                Indicador retirado (peso 0)
              </th>
              {municipalities.map((mun) => {
                const info = sensitivityByMun[mun.id];
                return (
                  <th key={mun.id} scope="col" className="min-w-[190px] px-3 py-2.5 font-semibold text-slate-900">
                    <div>{mun.nome}</div>
                    <div className="mt-0.5 font-normal text-slate-600 font-mono-tabular">
                      Posição atual:{' '}
                      {info?.baseRank !== null && info?.baseRank !== undefined
                        ? `${info.baseRank}º de ${info.totalRanked}`
                        : 'Sem índice'}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {indexIndicators.map((ind) => (
              <tr key={ind.code} className="border-b border-slate-100 hover:bg-slate-50/70">
                <th scope="row" className="py-3 pr-4 pl-3 font-medium text-slate-900">
                  <div>{ind.nomeCurto}</div>
                  <div className="text-[11px] font-normal text-slate-600">
                    Ano {ind.anoReferencia}
                  </div>
                </th>

                {municipalities.map((mun) => {
                  const info = sensitivityByMun[mun.id];
                  const shift = info?.shifts.find((s) => s.indicatorCode === ind.code);
                  const formatted = formatShiftDescription(
                    shift?.baseRank ?? null,
                    shift?.newRank ?? null,
                    shift?.rankDelta ?? null,
                    shift?.currentWeight ?? 0,
                    info?.totalRanked ?? 0,
                  );

                  return (
                    <td key={mun.id} className="px-3 py-3 align-top">
                      <div
                        className={`font-mono-tabular font-semibold ${
                          formatted.isLarge ? 'text-amber-950' : 'text-slate-900'
                        }`}
                      >
                        {formatted.primary}
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] ${
                          formatted.isLarge ? 'font-semibold text-amber-900' : 'text-slate-600'
                        }`}
                      >
                        {formatted.detail}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
