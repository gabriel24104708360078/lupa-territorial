/**
 * Painel de pesos editáveis em tempo real do índice composto, com fórmula explícita e botão "Restaurar pesos".
 */

import { RotateCcw } from 'lucide-react';
import type { IndicatorMeta } from '../types/territorial.ts';

interface WeightsPanelProps {
  indicators: IndicatorMeta[];
  weights: Record<string, number>;
  onChangeWeight: (code: string, value: number) => void;
  onResetWeights: () => void;
}

export function WeightsPanel({ indicators, weights, onChangeWeight, onResetWeights }: WeightsPanelProps) {
  const indexIndicators = indicators.filter((i) => i.incluirNoIndice);
  const sumWeights = indexIndicators.reduce((acc, ind) => acc + Math.max(0, weights[ind.code] ?? 0), 0);

  return (
    <section aria-labelledby="weights-panel-title" className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 id="weights-panel-title" className="text-base font-semibold text-slate-900">
            Pesos do índice composto (recálculo em tempo real)
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Ajuste os pesos abaixo. No índice, <strong>1,00</strong> representa o município mais vulnerável do estado e{' '}
            <strong>0,00</strong> o menos vulnerável.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetWeights}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Restaurar pesos
        </button>
      </div>

      {/* Fórmula transparente visível na tela */}
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-800">
        <p className="font-semibold text-slate-900">Fórmula visível e regra de normalização</p>
        <p className="mt-1 font-mono-tabular text-slate-900">
          IV(m) = Σ [ wᵢ × vᵢ(m) ] / Σ wᵢ &nbsp; (soma atual dos pesos: {sumWeights.toFixed(1).replace('.', ',')})
        </p>
        <p className="mt-1.5 text-slate-700">
          Onde <code>vᵢ(m) = (x − mín) / (máx − mín)</code> entre os municípios da UF. Indicadores em que maior valor é melhor
          (renda, alfabetização, água, esgoto, coleta de lixo e IDHM) são invertidos (<code>1 − norm</code>).
        </p>
      </div>

      {sumWeights === 0 && (
        <p role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
          Todos os pesos estão zerados. Aumente ao menos um peso ou clique em Restaurar pesos para calcular o índice.
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {indexIndicators.map((ind) => {
          const w = weights[ind.code] ?? 0;
          const sliderId = `weight-slider-${ind.code}`;
          const numId = `weight-num-${ind.code}`;
          return (
            <div key={ind.code} className="border-b border-slate-100 pb-3">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={sliderId} className="text-xs font-semibold text-slate-900">
                  {ind.nomeCurto}{' '}
                  <span className="font-normal text-slate-600">({ind.anoReferencia})</span>
                </label>
                <span className="text-[11px] text-slate-600 whitespace-nowrap shrink-0">
                  {ind.maiorEMelhor ? 'Invertido (1 − norm)' : 'Direto'}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-3">
                <input
                  id={sliderId}
                  type="range"
                  min={0}
                  max={5}
                  step={0.5}
                  value={w}
                  onChange={(e) => onChangeWeight(ind.code, Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-teal-700"
                />
                <label htmlFor={numId} className="sr-only">
                  Peso numérico para {ind.nomeCurto}
                </label>
                <input
                  id={numId}
                  type="number"
                  min={0}
                  max={5}
                  step={0.5}
                  value={w}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    onChangeWeight(ind.code, Number.isFinite(parsed) ? Math.min(5, Math.max(0, parsed)) : 0);
                  }}
                  className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right font-mono-tabular text-xs text-slate-900"
                />
              </div>
              {ind.anoReferencia === 2010 && (
                <p className="mt-1 text-[11px] text-slate-600">
                  Peso padrão 0 por utilizar dados do Censo 2010 (Atlas DH).
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
