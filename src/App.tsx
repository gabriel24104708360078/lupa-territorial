/**
 * Aplicação principal Lupa Territorial: seleção de UF e até 3 municípios, comparativo (radar, tabela, tendência),
 * índice composto com pesos editáveis em tempo real, mapa coroplético estadual e página "Sobre os dados".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import { AboutDataPage } from './components/AboutDataPage.tsx';
import { ChoroplethMap } from './components/ChoroplethMap.tsx';
import { ComparisonTable } from './components/ComparisonTable.tsx';
import { ProvenanceModal } from './components/ProvenanceModal.tsx';
import { RadarChartSvg } from './components/RadarChartSvg.tsx';
import { TrendChartSvg } from './components/TrendChartSvg.tsx';
import { WeightsPanel } from './components/WeightsPanel.tsx';
import { DEFAULT_WEIGHTS } from './lib/indicatorsCatalog.ts';
import { computeCompositeIndexForState } from './lib/indexCalculator.ts';
import {
  formatDatePtBr,
  getVulnerabilityBand,
  type ProvenanceTarget,
  type StateOverviewResponse,
  type StateSummary,
} from './types/territorial.ts';

type ActivePage = 'painel' | 'sobre';

const DEFAULT_STATE_ID = 33; // Rio de Janeiro como estado inicial padrão

export default function App() {
  const [page, setPage] = useState<ActivePage>('painel');

  const [states, setStates] = useState<StateSummary[]>([]);
  const [selectedStateId, setSelectedStateId] = useState<number>(DEFAULT_STATE_ID);

  const [overview, setOverview] = useState<StateOverviewResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedMunIds, setSelectedMunIds] = useState<string[]>([]);
  const [munSearch, setMunSearch] = useState<string>('');
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);

  const [weights, setWeights] = useState<Record<string, number>>(() => ({ ...DEFAULT_WEIGHTS }));
  const [provenanceTarget, setProvenanceTarget] = useState<ProvenanceTarget | null>(null);

  // Carrega a lista das 27 UFs (e eventual UF de teste se seedada no banco)
  useEffect(() => {
    let active = true;
    fetch('/api/states')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { states: StateSummary[] };
      })
      .then((json) => {
        if (!active) return;
        setStates(json.states);
        if (!json.states.some((s) => s.id === DEFAULT_STATE_ID) && json.states.length > 0) {
          setSelectedStateId(json.states[0].id);
        }
      })
      .catch(() => {
        // Caso /api/states falhe, o carregamento do overview exibirá o erro principal
      });

    return () => {
      active = false;
    };
  }, []);

  const loadStateOverview = useCallback(async (stateId: number) => {
    setLoading(true);
    setError(null);
    setSelectionWarning(null);
    try {
      const res = await fetch(`/api/states/${stateId}/overview`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Erro HTTP ${res.status}`);
      }
      const data = (await res.json()) as StateOverviewResponse;
      setOverview(data);

      // Seleciona inicialmente até 3 municípios representativos (maior população + médio + menor) para demonstrar o comparativo
      const sortedByPop = [...data.municipalities].sort(
        (a, b) => (b.values['populacao']?.valor ?? 0) - (a.values['populacao']?.valor ?? 0),
      );
      if (sortedByPop.length >= 3) {
        const mid = Math.floor(sortedByPop.length / 2);
        setSelectedMunIds([sortedByPop[0].id, sortedByPop[mid].id, sortedByPop[sortedByPop.length - 1].id]);
      } else {
        setSelectedMunIds(sortedByPop.map((m) => m.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados do estado.');
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStateOverview(selectedStateId);
  }, [selectedStateId, loadStateOverview]);

  // Recalcula o índice composto para todo o estado em tempo real sempre que os pesos mudam
  const indexResults = useMemo(() => {
    if (!overview) return {};
    const inputs = overview.municipalities.map((m) => ({
      municipalityId: m.id,
      values: Object.fromEntries(
        Object.entries(m.values).map(([code, obj]) => [code, obj.valor]),
      ),
    }));
    return computeCompositeIndexForState(inputs, weights);
  }, [overview, weights]);

  const selectedMunicipalities = useMemo(() => {
    if (!overview) return [];
    const byId = new Map(overview.municipalities.map((m) => [m.id, m]));
    return selectedMunIds.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  }, [overview, selectedMunIds]);

  const normalizedByMunForRadar = useMemo(() => {
    const out: Record<string, Record<string, number | null>> = {};
    for (const m of selectedMunicipalities) {
      out[m.id] = indexResults[m.id]?.normalizedVulnerability || {};
    }
    return out;
  }, [selectedMunicipalities, indexResults]);

  const filteredMunicipalities = useMemo(() => {
    if (!overview) return [];
    const q = munSearch.trim().toLowerCase();
    if (!q) return overview.municipalities;
    return overview.municipalities.filter((m) => m.nome.toLowerCase().includes(q));
  }, [overview, munSearch]);

  const handleToggleMunicipality = useCallback((id: string) => {
    setSelectionWarning(null);
    setSelectedMunIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 3) {
        setSelectionWarning('Limite de 3 municípios atingido. Remova um município antes de adicionar outro.');
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  const handleChangeWeight = useCallback((code: string, value: number) => {
    setWeights((prev) => ({ ...prev, [code]: value }));
  }, []);

  const handleResetWeights = useCallback(() => {
    setWeights({ ...DEFAULT_WEIGHTS });
  }, []);

  const collectedDateLabel = formatDatePtBr(overview?.state.collectedAt);
  const isOffline = Boolean(overview?.state.isOffline);
  const offlineIndicators = overview?.state.offlineIndicators || [];
  const isTeste = Boolean(overview?.state.isTeste || selectedMunicipalities.some((m) => m.isTeste));

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Ir para o conteúdo principal
      </a>

      {/* Cabeçalho com 3 zonas limpas: marca, navegação e ação primária */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={() => setPage('painel')}
            className="text-left text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Lupa Territorial
          </button>

          <nav aria-label="Navegação principal" className="flex items-center gap-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setPage('painel')}
              aria-current={page === 'painel' ? 'page' : undefined}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                page === 'painel'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Painel comparativo
            </button>
            <button
              type="button"
              onClick={() => setPage('sobre')}
              aria-current={page === 'sobre' ? 'page' : undefined}
              className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                page === 'sobre'
                  ? 'border-teal-700 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              Sobre os dados
            </button>
          </nav>

          <div className="hidden sm:flex items-center shrink-0">
            <button
              type="button"
              onClick={() => loadStateOverview(selectedStateId)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Recarregar UF
            </button>
          </div>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {page === 'sobre' ? (
          <AboutDataPage
            indicatorsFallback={overview?.indicators || []}
            collectedAt={overview?.state.collectedAt || ''}
            isOffline={isOffline}
            offlineIndicators={offlineIndicators}
            isTeste={isTeste}
            onBackToDashboard={() => setPage('painel')}
          />
        ) : (
          <div className="space-y-6">
            {/* Cabeçalho da tela e fonte obrigatória visível */}
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  Retrato social comparativo por município
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Ferramenta de comparação relativa ao estado selecionado. Não estabelece causalidade nem substitui diagnóstico local.
                </p>
              </div>
              <p className="text-xs font-medium text-slate-700">
                Fonte: IBGE e Ipeadata, atualizado em <span className="font-mono-tabular">{collectedDateLabel}</span>
              </p>
            </div>

            {/* Avisos obrigatórios de modo offline total, parcial por indicador ou dados de teste */}
            {isOffline ? (
              <div
                role="status"
                className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-950"
              >
                Dados de {collectedDateLabel} (modo offline) — exibindo amostra oficial armazenada localmente.
              </div>
            ) : offlineIndicators.length > 0 ? (
              <div
                role="status"
                className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
              >
                <span className="font-medium">
                  IBGE carregado ao vivo; apenas os indicadores abaixo usaram amostra local (modo offline):
                </span>{' '}
                {offlineIndicators
                  .map((item) => `${item.nome} (dados de ${formatDatePtBr(item.collectedAt)})`)
                  .join('; ')}
                .
              </div>
            ) : null}

            {isTeste && (
              <div
                role="status"
                className="rounded-md border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-900"
              >
                Dados de teste, não são reais.
              </div>
            )}

            {/* Barra de seleção: UF + até 3 municípios */}
            <section aria-labelledby="selector-title" className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 id="selector-title" className="text-base font-semibold text-slate-900">
                1. Seleção de estado e até 3 municípios
              </h2>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <label htmlFor="uf-select" className="block text-xs font-medium text-slate-700">
                    Unidade da Federação (UF)
                  </label>
                  <select
                    id="uf-select"
                    value={selectedStateId}
                    onChange={(e) => setSelectedStateId(Number(e.target.value))}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    {states.length === 0 ? (
                      <option value={DEFAULT_STATE_ID}>Rio de Janeiro (RJ)</option>
                    ) : (
                      states.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome} ({s.sigla}){s.isTeste ? ' [Dados de teste]' : ''}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div className="md:col-span-4">
                  <label htmlFor="mun-search" className="block text-xs font-medium text-slate-700">
                    Buscar município no estado
                  </label>
                  <div className="relative mt-1.5">
                    <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden="true" />
                    <input
                      id="mun-search"
                      type="text"
                      value={munSearch}
                      onChange={(e) => setMunSearch(e.target.value)}
                      placeholder="Ex.: Niterói, Campos..."
                      className="w-full rounded-md border border-slate-300 bg-white py-2 pr-3 pl-9 text-sm text-slate-900"
                    />
                  </div>
                </div>

                <div className="md:col-span-4">
                  <label htmlFor="mun-add-select" className="block text-xs font-medium text-slate-700">
                    Adicionar município à comparação ({selectedMunIds.length}/3)
                  </label>
                  <select
                    id="mun-add-select"
                    value=""
                    disabled={!overview || loading}
                    onChange={(e) => {
                      if (e.target.value) {
                        handleToggleMunicipality(e.target.value);
                      }
                    }}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                  >
                    <option value="">Escolha um município...</option>
                    {filteredMunicipalities.map((m) => {
                      const already = selectedMunIds.includes(m.id);
                      return (
                        <option key={m.id} value={m.id} disabled={already}>
                          {m.nome} {already ? '(selecionado)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Municípios selecionados como botões interativos de remoção */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-600">Selecionados:</span>
                {selectedMunicipalities.length === 0 ? (
                  <span className="text-xs text-slate-600">Nenhum município selecionado no momento.</span>
                ) : (
                  selectedMunicipalities.map((m) => {
                    const score = indexResults[m.id]?.compositeIndex ?? null;
                    const band = getVulnerabilityBand(score);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => handleToggleMunicipality(m.id)}
                        aria-label={`Remover ${m.nome} da comparação`}
                        className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-200 whitespace-nowrap shrink-0"
                      >
                        <span>{m.nome}</span>
                        <span className="font-mono-tabular text-slate-600">
                          {score !== null ? score.toFixed(2).replace('.', ',') : '—'} ({band.label})
                        </span>
                        <X className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                      </button>
                    );
                  })
                )}
              </div>

              {selectionWarning && (
                <p role="alert" className="mt-3 text-xs font-medium text-amber-800">
                  {selectionWarning}
                </p>
              )}
            </section>

            {/* Estados de carregamento e erro */}
            {loading ? (
              <div className="space-y-4" aria-busy="true" aria-label="Carregando dados da UF">
                <div className="h-48 animate-pulse rounded-lg border border-slate-200 bg-white" />
                <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-white" />
              </div>
            ) : error ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-white p-6">
                <h2 className="text-base font-semibold text-red-900">Erro ao carregar os dados desta UF</h2>
                <p className="mt-1 text-sm text-slate-700">{error}</p>
                <button
                  type="button"
                  onClick={() => loadStateOverview(selectedStateId)}
                  className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Tentar novamente
                </button>
              </div>
            ) : overview ? (
              <>
                {/* Nota transparente sobre séries do Ipeadata */}
                <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700">
                  <strong>Nota sobre o Ipeadata:</strong> {overview.ipeadataNotice}
                </p>

                {/* Pesos editáveis em tempo real e fórmula visível */}
                <WeightsPanel
                  indicators={overview.indicators}
                  weights={weights}
                  onChangeWeight={handleChangeWeight}
                  onResetWeights={handleResetWeights}
                />

                {/* Grade principal: Radar + Mapa coroplético */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                  <div className="lg:col-span-5">
                    <RadarChartSvg
                      municipalities={selectedMunicipalities}
                      indicators={overview.indicators}
                      normalizedByMun={normalizedByMunForRadar}
                    />
                  </div>
                  <div className="lg:col-span-7">
                    <ChoroplethMap
                      stateName={overview.state.nome}
                      stateSigla={overview.state.sigla}
                      malhaGeoJson={overview.malhaGeoJson}
                      municipalities={overview.municipalities}
                      indexResults={indexResults}
                      selectedIds={selectedMunIds}
                      onToggleMunicipality={handleToggleMunicipality}
                    />
                  </div>
                </div>

                {/* Tabela comparativa com botão "De onde vem" em cada número */}
                <ComparisonTable
                  municipalities={selectedMunicipalities}
                  indicators={overview.indicators}
                  indexResults={indexResults}
                  onInspectProvenance={setProvenanceTarget}
                />

                {/* Gráfico de tendência histórica persistida no SQLite */}
                <TrendChartSvg municipalities={selectedMunicipalities} />
              </>
            ) : null}
          </div>
        )}
      </main>

      {/* Rodapé fixo com aviso institucional obrigatório */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 text-xs text-slate-700 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="font-semibold text-slate-900">
            Informativo. Não substitui atendimento de saúde. Emergência: SAMU 192.
          </p>
          <p className="text-slate-600">
            Fonte: IBGE e Ipeadata, atualizado em {collectedDateLabel} · Sem coleta de dados pessoais ou cookies de rastreio.
          </p>
        </div>
      </footer>

      <ProvenanceModal target={provenanceTarget} onClose={() => setProvenanceTarget(null)} />
    </div>
  );
}
