/**
 * Tipos TypeScript compartilhados entre as respostas da API do servidor e os componentes React.
 */

export interface OfflineIndicatorNotice {
  code: string;
  nome: string;
  collectedAt: string;
}

export interface StateSummary {
  id: number;
  sigla: string;
  nome: string;
  regiao: string;
  isOffline: boolean;
  offlineIndicators?: OfflineIndicatorNotice[];
  isTeste: boolean;
  collectedAt: string;
}

export interface IndicatorMeta {
  code: string;
  nome: string;
  nomeCurto: string;
  unidade: string;
  fonte: string;
  tabelaCodigo: string;
  variavelCodigo: string;
  classificacao: string | null;
  anoReferencia: number;
  incluirNoIndice: boolean;
  maiorEMelhor: boolean;
  pesoPadrao: number;
  sourceUrl: string;
  descricao: string;
}

export interface MunicipalityData {
  id: string;
  nome: string;
  microrregiao: string | null;
  regiaoImediata: string | null;
  isTeste: boolean;
  values: Record<string, { valor: number | null; ano: number }>;
  trends: {
    populacao: Array<{ ano: number; valor: number }>;
    bolsa_familia_taxa: Array<{ ano: number; valor: number }>;
  };
}

export interface StateOverviewResponse {
  state: StateSummary;
  indicators: IndicatorMeta[];
  municipalities: MunicipalityData[];
  malhaGeoJson: GeoJSON.FeatureCollection | null;
  ipeadataNotice: string;
}

export interface ProvenanceTarget {
  indicator: IndicatorMeta;
  municipalityName: string;
  municipalityId: string;
  value: number | null;
  year: number;
  normalizedVulnerability: number | null;
}

export interface VulnerabilityBand {
  label: 'Baixa' | 'Moderada' | 'Alta' | 'Muito alta' | 'Indisponível';
  color: string;
  textClass: string;
  rangeText: string;
}

export function getVulnerabilityBand(score: number | null): VulnerabilityBand {
  if (score === null || !Number.isFinite(score)) {
    return {
      label: 'Indisponível',
      color: '#cbd5e1',
      textClass: 'text-slate-700',
      rangeText: 'Sem dado',
    };
  }
  if (score < 0.25) {
    return {
      label: 'Baixa',
      color: '#ccfbf1',
      textClass: 'text-teal-900',
      rangeText: '0,00 – 0,24',
    };
  }
  if (score < 0.5) {
    return {
      label: 'Moderada',
      color: '#5eead4',
      textClass: 'text-teal-950',
      rangeText: '0,25 – 0,49',
    };
  }
  if (score < 0.75) {
    return {
      label: 'Alta',
      color: '#f59e0b',
      textClass: 'text-amber-950',
      rangeText: '0,50 – 0,74',
    };
  }
  return {
    label: 'Muito alta',
    color: '#b91c1c',
    textClass: 'text-red-900',
    rangeText: '0,75 – 1,00',
  };
}

export function formatIndicatorValue(value: number | null | undefined, unidade: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  if (unidade === 'R$') {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
  }
  if (unidade === '%') {
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  }
  if (unidade === 'índice (0–1)') {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  if (unidade === 'habitantes' || unidade === 'domicílios') {
    return Math.round(value).toLocaleString('pt-BR');
  }
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
}

export function formatDatePtBr(isoDate: string | null | undefined): string {
  if (!isoDate) return 'data indisponível';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
