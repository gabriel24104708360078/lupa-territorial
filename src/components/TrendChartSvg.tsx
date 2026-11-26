/**
 * Gráfico de tendência histórica em SVG acessível usando dados persistidos no banco SQLite
 * (Estimativas populacionais 2018–2025 do IBGE e taxa de Bolsa Família por 1.000 hab. 2018–2025 do Ipeadata).
 */

import { useState } from 'react';
import type { MunicipalityData } from '../types/territorial.ts';

interface TrendChartSvgProps {
  municipalities: MunicipalityData[];
}

const LINE_STYLES = [
  { stroke: '#0f766e', dash: '', label: 'Contínua' },
  { stroke: '#b45309', dash: '6 4', label: 'Tracejada' },
  { stroke: '#1d4ed8', dash: '2 3', label: 'Pontilhada' },
];

export function TrendChartSvg({ municipalities }: TrendChartSvgProps) {
  const [metric, setMetric] = useState<'bolsa_familia_taxa' | 'populacao'>('bolsa_familia_taxa');
  const [showTextAlt, setShowTextAlt] = useState(false);

  if (municipalities.length === 0) {
    return null;
  }

  const allPoints = municipalities.flatMap((m) => m.trends[metric] || []);
  const years = Array.from(new Set(allPoints.map((p) => p.ano))).sort((a, b) => a - b);

  const width = 560;
  const height = 220;
  const padL = 56;
  const padR = 20;
  const padT = 18;
  const padB = 34;

  const values = allPoints.map((p) => p.valor);
  const minVal = values.length > 0 ? Math.min(...values) : 0;
  const maxVal = values.length > 0 ? Math.max(...values) : 1;
  const yMin = metric === 'bolsa_familia_taxa' ? 0 : Math.floor(minVal * 0.94);
  const yMax = maxVal === yMin ? yMin + 1 : maxVal * 1.05;

  const getX = (ano: number) => {
    if (years.length <= 1) return padL + (width - padL - padR) / 2;
    const minY = years[0];
    const maxY = years[years.length - 1];
    return padL + ((ano - minY) / (maxY - minY)) * (width - padL - padR);
  };

  const getY = (val: number) => {
    return height - padB - ((val - yMin) / (yMax - yMin)) * (height - padT - padB);
  };

  const formatAxisVal = (val: number) => {
    if (metric === 'populacao') {
      if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace('.', ',')}M`;
      if (val >= 1_000) return `${Math.round(val / 1_000)}k`;
      return String(Math.round(val));
    }
    return val.toFixed(0);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Histórico e tendência armazenados no banco
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            {metric === 'bolsa_familia_taxa'
              ? 'Benefícios do Bolsa Família por 1.000 habitantes (Ipeadata FAM_PBF + população IBGE).'
              : 'Evolução da população residente (IBGE Censo 2022 e Estimativas tabela 6579).'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md bg-slate-100 p-1" role="group" aria-label="Série histórica exibida">
            <button
              type="button"
              onClick={() => setMetric('bolsa_familia_taxa')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                metric === 'bolsa_familia_taxa' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Bolsa Família / 1k hab.
            </button>
            <button
              type="button"
              onClick={() => setMetric('populacao')}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                metric === 'populacao' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              População
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowTextAlt((prev) => !prev)}
            aria-expanded={showTextAlt}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {showTextAlt ? 'Ver gráfico de linhas' : 'Ver tabela histórica'}
          </button>
        </div>
      </div>

      {years.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">Sem histórico disponível para os municípios selecionados.</p>
      ) : showTextAlt ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th scope="col" className="py-2 pr-3 font-medium">Município</th>
                {years.map((y) => (
                  <th key={y} scope="col" className="py-2 px-2 text-right font-mono-tabular font-medium">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {municipalities.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <th scope="row" className="py-2 pr-3 font-medium text-slate-900">{m.nome}</th>
                  {years.map((y) => {
                    const pt = m.trends[metric].find((p) => p.ano === y);
                    return (
                      <td key={y} className="py-2 px-2 text-right font-mono-tabular text-slate-800">
                        {pt
                          ? metric === 'populacao'
                            ? Math.round(pt.valor).toLocaleString('pt-BR')
                            : pt.valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                          : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full"
            role="img"
            aria-label={`Série histórica de ${metric === 'bolsa_familia_taxa' ? 'Bolsa Família por mil habitantes' : 'população'} para ${municipalities.map((m) => m.nome).join(', ')}`}
          >
            {/* Linhas horizontais de grade */}
            {[0, 0.25, 0.5, 0.75, 1].map((t) => {
              const val = yMin + t * (yMax - yMin);
              const y = getY(val);
              return (
                <g key={t}>
                  <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                  <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b" className="font-mono-tabular">
                    {formatAxisVal(val)}
                  </text>
                </g>
              );
            })}

            {/* Rótulos dos anos no eixo X */}
            {years.map((y) => (
              <text
                key={y}
                x={getX(y)}
                y={height - 10}
                textAnchor="middle"
                fontSize="10.5"
                fill="#475569"
                className="font-mono-tabular"
              >
                {y}
              </text>
            ))}

            {/* Séries */}
            {municipalities.map((m, idx) => {
              const st = LINE_STYLES[idx % LINE_STYLES.length];
              const pts = [...m.trends[metric]].sort((a, b) => a.ano - b.ano);
              if (pts.length === 0) return null;
              const d = pts
                .map((p, pIdx) => `${pIdx === 0 ? 'M' : 'L'} ${getX(p.ano).toFixed(1)} ${getY(p.valor).toFixed(1)}`)
                .join(' ');
              return (
                <g key={m.id}>
                  <path d={d} fill="none" stroke={st.stroke} strokeWidth="2.3" strokeDasharray={st.dash} />
                  {pts.map((p) => (
                    <circle key={p.ano} cx={getX(p.ano)} cy={getY(p.valor)} r="3.2" fill={st.stroke} stroke="#fff" strokeWidth="1">
                      <title>
                        {m.nome} ({p.ano}): {p.valor.toLocaleString('pt-BR')}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
