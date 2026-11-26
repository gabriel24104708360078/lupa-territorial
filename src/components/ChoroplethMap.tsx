/**
 * Mapa coroplético estadual em Leaflet colorido em tempo real pelo índice composto (0 a 1).
 * Funciona também sem internet (geometrias locais em GeoJSON) e oferece tabela acessível equivalente em texto.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { NormalizedMunicipalityResult } from '../lib/indexCalculator.ts';
import { getVulnerabilityBand, type MunicipalityData } from '../types/territorial.ts';

interface ChoroplethMapProps {
  stateName: string;
  stateSigla: string;
  malhaGeoJson: GeoJSON.FeatureCollection | null;
  municipalities: MunicipalityData[];
  indexResults: Record<string, NormalizedMunicipalityResult>;
  selectedIds: string[];
  onToggleMunicipality: (id: string) => void;
}

export function ChoroplethMap({
  stateName,
  stateSigla,
  malhaGeoJson,
  municipalities,
  indexResults,
  selectedIds,
  onToggleMunicipality,
}: ChoroplethMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const geoLayerRef = useRef<L.GeoJSON | null>(null);
  const onToggleRef = useRef(onToggleMunicipality);
  onToggleRef.current = onToggleMunicipality;

  const [showTextAlt, setShowTextAlt] = useState(false);
  const [searchRank, setSearchRank] = useState('');

  const munById = useMemo(() => {
    const m = new Map<string, MunicipalityData>();
    for (const item of municipalities) m.set(item.id, item);
    return m;
  }, [municipalities]);

  const rankedList = useMemo(() => {
    const q = searchRank.trim().toLowerCase();
    return [...municipalities]
      .map((m) => {
        const res = indexResults[m.id];
        const score = res?.compositeIndex ?? null;
        return {
          ...m,
          score,
          band: getVulnerabilityBand(score),
        };
      })
      .filter((m) => !q || m.nome.toLowerCase().includes(q))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }, [municipalities, indexResults, searchRank]);

  // Inicializa o mapa Leaflet uma única vez quando o container estiver montado e no modo mapa
  useEffect(() => {
    if (showTextAlt || !mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
    });
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      geoLayerRef.current = null;
    };
  }, [showTextAlt]);

  // Atualiza camada GeoJSON e enquadra o estado quando a malha muda
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !malhaGeoJson || showTextAlt) return;

    if (geoLayerRef.current) {
      geoLayerRef.current.remove();
      geoLayerRef.current = null;
    }

    const layer = L.geoJSON(malhaGeoJson, {
      style: (feature) => {
        const cod = String(feature?.properties?.codarea ?? '');
        const score = indexResults[cod]?.compositeIndex ?? null;
        const band = getVulnerabilityBand(score);
        const isSelected = selectedIds.includes(cod);
        return {
          fillColor: band.color,
          fillOpacity: 0.88,
          color: isSelected ? '#0f172a' : '#475569',
          weight: isSelected ? 2.6 : 0.7,
        };
      },
      onEachFeature: (feature, featureLayer) => {
        const cod = String(feature?.properties?.codarea ?? '');
        const mun = munById.get(cod);
        const score = indexResults[cod]?.compositeIndex ?? null;
        const band = getVulnerabilityBand(score);
        const labelScore = score !== null ? score.toFixed(3).replace('.', ',') : 'Sem dado';
        const munName = mun?.nome || `Município ${cod}`;

        featureLayer.bindTooltip(
          `${munName} — Índice: ${labelScore} (${band.label})`,
          { sticky: true },
        );

        featureLayer.on('click', () => {
          onToggleRef.current(cod);
        });
      },
    }).addTo(map);

    geoLayerRef.current = layer;

    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [14, 14] });
    }
  }, [malhaGeoJson, showTextAlt]);

  // Recolore os polígonos imediatamente quando pesos ou seleção mudam, sem refazer fitBounds
  useEffect(() => {
    const layer = geoLayerRef.current;
    if (!layer) return;

    layer.eachLayer((subLayer) => {
      const pathLayer = subLayer as L.Path & { feature?: GeoJSON.Feature };
      const cod = String(pathLayer.feature?.properties?.codarea ?? '');
      const mun = munById.get(cod);
      const score = indexResults[cod]?.compositeIndex ?? null;
      const band = getVulnerabilityBand(score);
      const isSelected = selectedIds.includes(cod);

      pathLayer.setStyle({
        fillColor: band.color,
        fillOpacity: 0.88,
        color: isSelected ? '#0f172a' : '#475569',
        weight: isSelected ? 2.6 : 0.7,
      });

      const labelScore = score !== null ? score.toFixed(3).replace('.', ',') : 'Sem dado';
      const munName = mun?.nome || `Município ${cod}`;
      pathLayer.setTooltipContent(`${munName} — Índice: ${labelScore} (${band.label})`);
    });
  }, [indexResults, selectedIds, munById]);

  const legendSteps = [
    getVulnerabilityBand(0.1),
    getVulnerabilityBand(0.35),
    getVulnerabilityBand(0.6),
    getVulnerabilityBand(0.85),
    getVulnerabilityBand(null),
  ];

  return (
    <section aria-labelledby="map-section-title" className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="map-section-title" className="text-base font-semibold text-slate-900">
            Mapa coroplético de {stateName} ({stateSigla})
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Clique em um município no mapa (ou use a lista acessível em texto) para incluir ou remover da comparação (máx. 3).
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowTextAlt((prev) => !prev)}
          aria-expanded={showTextAlt}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          {showTextAlt ? 'Ver mapa coroplético' : 'Alternativa em texto (ranking)'}
        </button>
      </div>

      {/* Legenda que combina cor + faixa numérica + rótulo textual */}
      <ul
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-slate-100 py-2.5 text-xs text-slate-800"
        aria-label="Legenda do índice de vulnerabilidade no mapa"
      >
        {legendSteps.map((step) => (
          <li key={step.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3.5 w-3.5 rounded-sm border border-slate-500"
              style={{ backgroundColor: step.color }}
              aria-hidden="true"
            />
            <span className="font-medium">{step.label}</span>
            <span className="font-mono-tabular text-slate-600">({step.rangeText})</span>
          </li>
        ))}
      </ul>

      {showTextAlt ? (
        <div className="mt-4">
          <div className="mb-3 max-w-xs">
            <label htmlFor="rank-filter" className="block text-xs font-medium text-slate-700">
              Filtrar município na tabela
            </label>
            <input
              id="rank-filter"
              type="text"
              value={searchRank}
              onChange={(e) => setSearchRank(e.target.value)}
              placeholder="Digite o nome do município..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
            />
          </div>

          <div className="max-h-[380px] overflow-y-auto rounded-md border border-slate-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-700">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Pos.</th>
                  <th scope="col" className="px-3 py-2 font-medium">Município</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Índice (0–1)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Faixa</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Comparar</th>
                </tr>
              </thead>
              <tbody>
                {rankedList.map((m, idx) => {
                  const selected = selectedIds.includes(m.id);
                  return (
                    <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono-tabular text-slate-500">{idx + 1}</td>
                      <th scope="row" className="px-3 py-2 font-medium text-slate-900">
                        {m.nome}
                      </th>
                      <td className="px-3 py-2 text-right font-mono-tabular text-slate-900">
                        {m.score !== null ? m.score.toFixed(3).replace('.', ',') : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{m.band.label}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onToggleMunicipality(m.id)}
                          aria-pressed={selected}
                          className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                            selected
                              ? 'bg-slate-900 text-white hover:bg-slate-800'
                              : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                          }`}
                        >
                          {selected ? 'Selecionado' : 'Selecionar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div
          ref={mapContainerRef}
          role="region"
          aria-label={`Mapa coroplético dos municípios de ${stateName}. Use o botão Alternativa em texto (ranking) para navegar por teclado.`}
          className="mt-4 h-[410px] w-full rounded-md border border-slate-200 bg-slate-100"
        />
      )}
    </section>
  );
}
