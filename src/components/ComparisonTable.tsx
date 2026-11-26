/**
 * Tabela comparativa de até 3 municípios com ano de referência visível, valores tabulares
 * e botão "De onde vem" em cada número exibido.
 */

import { Info } from 'lucide-react';
import type { NormalizedMunicipalityResult } from '../lib/indexCalculator.ts';
import {
  formatIndicatorValue,
  getVulnerabilityBand,
  type IndicatorMeta,
  type MunicipalityData,
  type ProvenanceTarget,
} from '../types/territorial.ts';

interface ComparisonTableProps {
  municipalities: MunicipalityData[];
  indicators: IndicatorMeta[];
  indexResults: Record<string, NormalizedMunicipalityResult>;
  onInspectProvenance: (target: ProvenanceTarget) => void;
}

export function ComparisonTable({
  municipalities,
  indicators,
  indexResults,
  onInspectProvenance,
}: ComparisonTableProps) {
  if (municipalities.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Nenhum município selecionado. Escolha até 3 municípios no seletor acima ou clique no mapa para comparar indicadores.
      </div>
    );
  }

  const indexIndicators = indicators.filter((i) => i.incluirNoIndice);
  const contextIndicators = indicators.filter((i) => !i.incluirNoIndice);

  const renderRow = (ind: IndicatorMeta) => (
    <tr key={ind.code} className="border-t border-slate-100 hover:bg-slate-50/70">
      <th scope="row" className="py-3 pr-4 text-left align-top font-normal">
        <div className="font-medium text-slate-900">{ind.nomeCurto}</div>
        <div className="mt-0.5 text-[11px] text-slate-600">
          Ref.: <span className="font-mono-tabular">{ind.anoReferencia}</span> · {ind.unidade} · {ind.fonte}
        </div>
      </th>
      {municipalities.map((mun) => {
        const entry = mun.values[ind.code];
        const rawVal = entry?.valor ?? null;
        const year = entry?.ano ?? ind.anoReferencia;
        const normVuln = indexResults[mun.id]?.normalizedVulnerability[ind.code] ?? null;

        return (
          <td key={mun.id} className="px-3 py-3 text-right align-top">
            <div className="font-mono-tabular text-sm font-semibold text-slate-900">
              {formatIndicatorValue(rawVal, ind.unidade)}
            </div>
            {normVuln !== null && (
              <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-600">
                escore {normVuln.toFixed(2).replace('.', ',')}
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                onInspectProvenance({
                  indicator: ind,
                  municipalityName: mun.nome,
                  municipalityId: mun.id,
                  value: rawVal,
                  year,
                  normalizedVulnerability: normVuln,
                })
              }
              aria-label={`De onde vem ${ind.nomeCurto} de ${mun.nome}`}
              className="mt-1 inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-50 whitespace-nowrap"
            >
              <Info className="h-3 w-3" aria-hidden="true" />
              De onde vem
            </button>
          </td>
        );
      })}
    </tr>
  );

  return (
    <section aria-labelledby="comparison-table-title" className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="border-b border-slate-200 pb-3">
        <h2 id="comparison-table-title" className="text-base font-semibold text-slate-900">
          Tabela comparativa e procedência dos dados
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Valores observados com ano de referência explícito e botão &ldquo;De onde vem&rdquo; em cada número.
        </p>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-700">
              <th scope="col" className="py-2.5 pr-4 text-left font-semibold">
                Indicador / Referência
              </th>
              {municipalities.map((m) => (
                <th key={m.id} scope="col" className="px-3 py-2.5 text-right font-semibold text-slate-900">
                  <div>{m.nome}</div>
                  <div className="font-mono-tabular text-[11px] font-normal text-slate-500">IBGE {m.id}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Linha síntese do índice composto calculado em tempo real */}
            <tr className="bg-slate-50 font-semibold">
              <th scope="row" className="py-3 pr-4 text-left text-slate-900">
                Índice composto de vulnerabilidade
                <div className="mt-0.5 text-[11px] font-normal text-slate-600">
                  Escala 0,00 (menos vulnerável) a 1,00 (mais vulnerável no estado)
                </div>
              </th>
              {municipalities.map((m) => {
                const score = indexResults[m.id]?.compositeIndex ?? null;
                const band = getVulnerabilityBand(score);
                return (
                  <td key={m.id} className="px-3 py-3 text-right">
                    <div className="font-mono-tabular text-base font-bold text-slate-900">
                      {score !== null ? score.toFixed(3).replace('.', ',') : '—'}
                    </div>
                    <div className={`mt-0.5 text-xs font-medium ${band.textClass}`}>
                      Nível: {band.label}
                    </div>
                  </td>
                );
              })}
            </tr>

            {indexIndicators.map(renderRow)}

            <tr className="bg-slate-50">
              <th
                colSpan={municipalities.length + 1}
                scope="colgroup"
                className="px-2 py-2 text-left text-[11px] font-semibold text-slate-700"
              >
                Indicadores de contexto territorial (fora do cálculo do índice)
              </th>
            </tr>

            {contextIndicators.map(renderRow)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
