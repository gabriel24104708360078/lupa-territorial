/**
 * Página "Sobre os dados" detalhando fontes oficiais, códigos de tabelas/variáveis, limitações metodológicas e privacidade.
 */

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatDatePtBr, type IndicatorMeta } from '../types/territorial.ts';

interface AboutApiResponse {
  indicators: Array<{
    code: string;
    nome: string;
    nome_curto: string;
    unidade: string;
    fonte: string;
    tabela_codigo: string;
    variavel_codigo: string;
    classificacao: string | null;
    ano_referencia: number;
    incluir_no_indice: number;
    maior_e_melhor: number;
    peso_padrao: number;
    source_url: string;
    descricao: string;
  }>;
  stats: {
    cachedStates: number;
    cachedMunicipalities: number;
    cachedValues: number;
    testValues: number;
    lastCollectedAt: string | null;
  };
}

interface AboutDataPageProps {
  indicatorsFallback: IndicatorMeta[];
  collectedAt: string;
  isOffline: boolean;
  isTeste: boolean;
  onBackToDashboard: () => void;
}

export function AboutDataPage({
  indicatorsFallback,
  collectedAt,
  isOffline,
  isTeste,
  onBackToDashboard,
}: AboutDataPageProps) {
  const [aboutData, setAboutData] = useState<AboutApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/about')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AboutApiResponse;
      })
      .then((json) => {
        if (active) {
          setAboutData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError('Não foi possível consultar o resumo de metadados no servidor.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = aboutData?.indicators
    ? aboutData.indicators.map((i) => ({
        code: i.code,
        nome: i.nome,
        unidade: i.unidade,
        fonte: i.fonte,
        tabelaCodigo: i.tabela_codigo,
        variavelCodigo: i.variavel_codigo,
        classificacao: i.classificacao,
        anoReferencia: i.ano_referencia,
        pesoPadrao: i.peso_padrao,
        incluirNoIndice: i.incluir_no_indice === 1,
        maiorEMelhor: i.maior_e_melhor === 1,
        sourceUrl: i.source_url,
      }))
    : indicatorsFallback;

  const displayDate = formatDatePtBr(aboutData?.stats?.lastCollectedAt || collectedAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sobre os dados e metodologia</h1>
          <p className="mt-1 text-sm text-slate-600">
            Fonte: IBGE e Ipeadata, atualizado em {displayDate}
            {isOffline ? ` · Dados de ${displayDate} (modo offline)` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToDashboard}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
        >
          Voltar ao painel comparativo
        </button>
      </div>

      {isTeste && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          Dados de teste, não são reais.
        </div>
      )}

      <section aria-labelledby="about-rules" className="rounded-lg border border-slate-200 bg-white p-6 space-y-3">
        <h2 id="about-rules" className="text-lg font-semibold text-slate-900">
          O que o índice mede e limitações conhecidas
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <strong>Ferramenta comparativa, não diagnóstico nem causalidade:</strong> o índice composto normaliza indicadores entre
            0 e 1 apenas dentro dos municípios da UF selecionada. Um valor alto indica maior vulnerabilidade relativa naquela
            combinação de pesos, sem estabelecer relação de causa e efeito nem substituir diagnósticos locais.
          </li>
          <li>
            <strong>Indisponibilidade do IVS municipal no Ipeadata:</strong> a série <code>AVS_IVS</code> (Índice de Vulnerabilidade
            Social) da API OData do Ipeadata contempla apenas Brasil, Grandes Regiões e UFs — não há série municipal. Para
            representar vulnerabilidade recente por município, o painel utiliza a taxa de famílias beneficiárias do Bolsa Família por
            1.000 habitantes (<code>FAM_PBF</code>).
          </li>
          <li>
            <strong>Séries do Atlas DH de 2010 com peso padrão 0:</strong> os indicadores <code>ADH_IDHM</code> (IDHM) e{' '}
            <code>ADH_PPOB</code> (% de vulneráveis à pobreza) estão disponíveis no Ipeadata apenas para 1991, 2000 e 2010. Por
            serem anteriores ao Censo 2022, iniciam com peso 0 e podem ser ativados manualmente pelo usuário.
          </li>
          <li>
            <strong>Escopo territorial:</strong> abrange exclusivamente dados agregados por município. Dados por setor censitário,
            bairro ou projeções futuras estão fora do escopo.
          </li>
          <li>
            <strong>Privacidade:</strong> nenhuma informação pessoal é coletada, armazenada ou transmitida. Não há login, cookies
            de rastreamento ou ferramentas de analytics.
          </li>
        </ul>
      </section>

      <section aria-labelledby="about-sources" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 id="about-sources" className="text-lg font-semibold text-slate-900">
          Dicionário de fontes, tabelas e variáveis
        </h2>

        {loading && <p className="mt-3 text-sm text-slate-600">Carregando metadados do banco...</p>}
        {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th scope="col" className="py-2.5 pr-3 font-medium">Indicador</th>
                <th scope="col" className="py-2.5 px-2 font-medium">Fonte</th>
                <th scope="col" className="py-2.5 px-2 font-medium">Tabela / Série</th>
                <th scope="col" className="py-2.5 px-2 font-medium">Variável / Classif.</th>
                <th scope="col" className="py-2.5 px-2 text-right font-medium">Ano ref.</th>
                <th scope="col" className="py-2.5 px-2 text-right font-medium">Peso padrão</th>
                <th scope="col" className="py-2.5 pl-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ind) => (
                <tr key={ind.code} className="border-b border-slate-100">
                  <th scope="row" className="py-2.5 pr-3 font-medium text-slate-900">
                    {ind.nome}
                  </th>
                  <td className="py-2.5 px-2 text-slate-700">{ind.fonte}</td>
                  <td className="py-2.5 px-2 font-mono-tabular text-slate-800">{ind.tabelaCodigo}</td>
                  <td className="py-2.5 px-2 font-mono-tabular text-slate-700">
                    {ind.variavelCodigo}
                    {ind.classificacao ? ` · ${ind.classificacao}` : ''}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-800">{ind.anoReferencia}</td>
                  <td className="py-2.5 px-2 text-right font-mono-tabular text-slate-800">
                    {ind.incluirNoIndice ? ind.pesoPadrao : 'Contexto'}
                  </td>
                  <td className="py-2.5 pl-2">
                    <a
                      href={ind.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-teal-800 underline hover:text-teal-950"
                    >
                      Documentação
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {aboutData?.stats && (
        <section aria-labelledby="about-cache" className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 id="about-cache" className="text-lg font-semibold text-slate-900">
            Persistência local (SQLite)
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-600">UFs em cache</dt>
              <dd className="mt-1 font-mono-tabular text-lg font-semibold text-slate-900">
                {aboutData.stats.cachedStates}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Municípios em cache</dt>
              <dd className="mt-1 font-mono-tabular text-lg font-semibold text-slate-900">
                {aboutData.stats.cachedMunicipalities.toLocaleString('pt-BR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Registros de indicadores</dt>
              <dd className="mt-1 font-mono-tabular text-lg font-semibold text-slate-900">
                {aboutData.stats.cachedValues.toLocaleString('pt-BR')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-600">Última coleta</dt>
              <dd className="mt-1 font-mono-tabular text-lg font-semibold text-slate-900">
                {formatDatePtBr(aboutData.stats.lastCollectedAt)}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
