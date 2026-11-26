/**
 * Gráfico de radar em SVG acessível comparando até 3 municípios nos indicadores ativos do índice.
 * Utiliza cores + padrões de traço + formatos distintos de marcadores e oferece alternativa em tabela textual.
 */

import { useState } from 'react';
import { formatIndicatorValue, type IndicatorMeta, type MunicipalityData } from '../types/territorial.ts';

interface RadarChartSvgProps {
  municipalities: MunicipalityData[];
  indicators: IndicatorMeta[];
  /** Mapa: municipalityId -> indicatorCode -> score normalizado de vulnerabilidade (0..1) */
  normalizedByMun: Record<string, Record<string, number | null>>;
}

const SERIES_STYLES = [
  { stroke: '#0f766e', fill: 'rgba(15, 118, 110, 0.16)', dash: '', marker: 'circle' as const, label: 'Linha contínua' },
  { stroke: '#b45309', fill: 'rgba(180, 83, 9, 0.14)', dash: '6 4', marker: 'square' as const, label: 'Linha tracejada' },
  { stroke: '#1d4ed8', fill: 'rgba(29, 78, 216, 0.14)', dash: '2 3', marker: 'diamond' as const, label: 'Linha pontilhada' },
];

export function RadarChartSvg({ municipalities, indicators, normalizedByMun }: RadarChartSvgProps) {
  const [showTextAlt, setShowTextAlt] = useState(false);

  const axes = indicators.filter((i) => i.incluirNoIndice);
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 128;
  const levels = [0.25, 0.5, 0.75, 1];

  const getPoint = (axisIdx: number, value01: number) => {
    const angle = (Math.PI * 2 * axisIdx) / axes.length - Math.PI / 2;
    const r = value01 * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  if (municipalities.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Selecione entre 1 e 3 municípios acima para visualizar o gráfico de radar comparativo.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Radar de vulnerabilidade relativa no estado (0 a 1)
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Quanto mais próximo da borda externa (1,00), maior a vulnerabilidade relativa naquele indicador dentro da UF.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTextAlt((prev) => !prev)}
          aria-expanded={showTextAlt}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          {showTextAlt ? 'Ver gráfico radar' : 'Ver alternativa em texto'}
        </button>
      </div>

      {/* Legenda acessível com cor e estilo de traço */}
      <ul className="mt-4 flex flex-wrap gap-4 text-xs text-slate-800" aria-label="Legenda dos municípios no radar">
        {municipalities.map((mun, idx) => {
          const st = SERIES_STYLES[idx % SERIES_STYLES.length];
          return (
            <li key={mun.id} className="flex items-center gap-2">
              <svg width="26" height="10" aria-hidden="true">
                <line x1="0" y1="5" x2="26" y2="5" stroke={st.stroke} strokeWidth="2.5" strokeDasharray={st.dash} />
              </svg>
              <span className="font-medium">{mun.nome}</span>
              <span className="text-slate-500">({st.label})</span>
            </li>
          );
        })}
      </ul>

      {showTextAlt ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">
              Alternativa em texto dos escores normalizados de vulnerabilidade (0 a 1) exibidos no gráfico de radar.
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th scope="col" className="py-2 pr-3 font-medium">Indicador (Ano)</th>
                {municipalities.map((m) => (
                  <th key={m.id} scope="col" className="py-2 px-2 text-right font-medium">
                    {m.nome}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axes.map((ind) => (
                <tr key={ind.code} className="border-b border-slate-100">
                  <th scope="row" className="py-2 pr-3 font-normal text-slate-800">
                    {ind.nomeCurto} ({ind.anoReferencia})
                  </th>
                  {municipalities.map((m) => {
                    const score = normalizedByMun[m.id]?.[ind.code] ?? null;
                    const raw = m.values[ind.code]?.valor ?? null;
                    return (
                      <td key={m.id} className="py-2 px-2 text-right font-mono-tabular text-slate-900">
                        {score !== null ? score.toFixed(2).replace('.', ',') : '—'}{' '}
                        <span className="text-slate-500">({formatIndicatorValue(raw, ind.unidade)})</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 flex justify-center">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="w-full max-w-[400px]"
            role="img"
            aria-labelledby="radar-svg-title radar-svg-desc"
          >
            <title id="radar-svg-title">
              Gráfico de radar comparando {municipalities.map((m) => m.nome).join(', ')}
            </title>
            <desc id="radar-svg-desc">
              Eixos de 0 a 1 representando vulnerabilidade relativa no estado em cada indicador. Use o botão Ver alternativa em texto para tabela completa.
            </desc>

            {/* Anéis concêntricos de escala */}
            {levels.map((lvl) => {
              const pts = axes.map((_, idx) => {
                const p = getPoint(idx, lvl);
                return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
              });
              return (
                <polygon
                  key={lvl}
                  points={pts.join(' ')}
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="1"
                />
              );
            })}

            {/* Rótulos numéricos de escala no eixo vertical superior */}
            {levels.map((lvl) => (
              <text
                key={`lbl-${lvl}`}
                x={cx + 4}
                y={cy - lvl * maxR + 4}
                fontSize="10"
                fill="#64748b"
                className="font-mono-tabular"
              >
                {lvl.toFixed(2).replace('.', ',')}
              </text>
            ))}

            {/* Eixos radiais e rótulos dos indicadores */}
            {axes.map((ind, idx) => {
              const edge = getPoint(idx, 1);
              const labelPt = getPoint(idx, 1.24);
              const anchor =
                Math.abs(labelPt.x - cx) < 12 ? 'middle' : labelPt.x > cx ? 'start' : 'end';
              return (
                <g key={ind.code}>
                  <line x1={cx} y1={cy} x2={edge.x} y2={edge.y} stroke="#cbd5e1" strokeWidth="1" />
                  <text
                    x={labelPt.x}
                    y={labelPt.y}
                    textAnchor={anchor}
                    dominantBaseline="central"
                    fontSize="10.5"
                    fontWeight="600"
                    fill="#1e293b"
                  >
                    {ind.nomeCurto}
                  </text>
                </g>
              );
            })}

            {/* Polígonos e marcadores distintos por município */}
            {municipalities.map((mun, mIdx) => {
              const st = SERIES_STYLES[mIdx % SERIES_STYLES.length];
              const pts = axes.map((ind, aIdx) => {
                const score = normalizedByMun[mun.id]?.[ind.code];
                const v = typeof score === 'number' && Number.isFinite(score) ? score : 0;
                return getPoint(aIdx, v);
              });

              return (
                <g key={mun.id}>
                  <polygon
                    points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                    fill={st.fill}
                    stroke={st.stroke}
                    strokeWidth="2.2"
                    strokeDasharray={st.dash}
                  />
                  {pts.map((p, aIdx) => {
                    if (st.marker === 'circle') {
                      return <circle key={aIdx} cx={p.x} cy={p.y} r="3.5" fill={st.stroke} stroke="#fff" strokeWidth="1" />;
                    }
                    if (st.marker === 'square') {
                      return (
                        <rect
                          key={aIdx}
                          x={p.x - 3.2}
                          y={p.y - 3.2}
                          width="6.4"
                          height="6.4"
                          fill={st.stroke}
                          stroke="#fff"
                          strokeWidth="1"
                        />
                      );
                    }
                    return (
                      <polygon
                        key={aIdx}
                        points={`${p.x},${p.y - 4.2} ${p.x + 4.2},${p.y} ${p.x},${p.y + 4.2} ${p.x - 4.2},${p.y}`}
                        fill={st.stroke}
                        stroke="#fff"
                        strokeWidth="1"
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
