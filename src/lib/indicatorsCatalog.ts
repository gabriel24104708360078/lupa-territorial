/**
 * Catálogo oficial de indicadores do sistema Lupa Territorial.
 * Define metadados, códigos de tabela/variável IBGE/Ipeadata, direção no índice e pesos padrão.
 */

export interface IndicatorDefinition {
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
  /** true = quanto maior o valor bruto, menor a vulnerabilidade (ex.: renda, água, esgoto) */
  maiorEMelhor: boolean;
  pesoPadrao: number;
  sourceUrl: string;
  descricao: string;
}

export const INDICATORS_CATALOG: IndicatorDefinition[] = [
  {
    code: 'renda_2022',
    nome: 'Rendimento nominal médio mensal domiciliar per capita',
    nomeCurto: 'Renda per capita',
    unidade: 'R$',
    fonte: 'IBGE Censo 2022',
    tabelaCodigo: '10295',
    variavelCodigo: '13431',
    classificacao: '2[6794]|86[95251]|58[95253]',
    anoReferencia: 2022,
    incluirNoIndice: true,
    maiorEMelhor: true,
    pesoPadrao: 1,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/10295',
    descricao:
      'Média do rendimento nominal mensal domiciliar per capita dos moradores em domicílios particulares permanentes ocupados.',
  },
  {
    code: 'alfabetizacao_2022',
    nome: 'Taxa de alfabetização (15 anos ou mais)',
    nomeCurto: 'Alfabetização',
    unidade: '%',
    fonte: 'IBGE Censo 2022',
    tabelaCodigo: '9543',
    variavelCodigo: '2513',
    classificacao: '2[6794]|86[95251]|287[100362]',
    anoReferencia: 2022,
    incluirNoIndice: true,
    maiorEMelhor: true,
    pesoPadrao: 1,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/9543',
    descricao:
      'Percentual de pessoas com 15 anos ou mais de idade que sabem ler e escrever pelo menos um bilhete simples.',
  },
  {
    code: 'agua_2022',
    nome: 'Domicílios com abastecimento de água por rede geral',
    nomeCurto: 'Água por rede',
    unidade: '%',
    fonte: 'IBGE Censo 2022',
    tabelaCodigo: '6803',
    variavelCodigo: '1000381',
    classificacao: '1821[72144]',
    anoReferencia: 2022,
    incluirNoIndice: true,
    maiorEMelhor: true,
    pesoPadrao: 1,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/6803',
    descricao:
      'Percentual de domicílios particulares permanentes ocupados com ligação à rede geral de distribuição utilizada como forma principal.',
  },
  {
    code: 'esgoto_2022',
    nome: 'Domicílios com esgotamento sanitário por rede ou fossa ligada',
    nomeCurto: 'Esgotamento sanitário',
    unidade: '%',
    fonte: 'IBGE Censo 2022',
    tabelaCodigo: '6805',
    variavelCodigo: '1000381',
    classificacao: '11558[46290]',
    anoReferencia: 2022,
    incluirNoIndice: true,
    maiorEMelhor: true,
    pesoPadrao: 1,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/6805',
    descricao:
      'Percentual de domicílios particulares permanentes ocupados com rede geral, rede pluvial ou fossa séptica ligada à rede.',
  },
  {
    code: 'lixo_2022',
    nome: 'Domicílios com lixo coletado',
    nomeCurto: 'Coleta de lixo',
    unidade: '%',
    fonte: 'IBGE Censo 2022',
    tabelaCodigo: '6892',
    variavelCodigo: '1000381',
    classificacao: '67[2520]',
    anoReferencia: 2022,
    incluirNoIndice: true,
    maiorEMelhor: true,
    pesoPadrao: 1,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/6892',
    descricao:
      'Percentual de domicílios particulares permanentes ocupados cujo destino do lixo é coleta direta ou por caçamba de serviço de limpeza.',
  },
  {
    code: 'bolsa_familia_taxa',
    nome: 'Benefícios do Bolsa Família por 1.000 habitantes',
    nomeCurto: 'Bolsa Família / 1k hab.',
    unidade: 'benef./1.000 hab.',
    fonte: 'Ipeadata / MDS (FAM_PBF)',
    tabelaCodigo: 'FAM_PBF',
    variavelCodigo: 'FAM_PBF',
    classificacao: null,
    anoReferencia: 2025,
    incluirNoIndice: true,
    maiorEMelhor: false,
    pesoPadrao: 1,
    sourceUrl: 'http://www.ipeadata.gov.br/api/odata4/Metadados(%27FAM_PBF%27)',
    descricao:
      'Número de famílias beneficiárias do Programa Bolsa Família em dezembro dividido pela população municipal (× 1.000). Maior valor indica maior vulnerabilidade social.',
  },
  {
    code: 'idhm_2010',
    nome: 'IDHM — Índice de Desenvolvimento Humano Municipal (Censo 2010)',
    nomeCurto: 'IDHM (2010)',
    unidade: 'índice (0–1)',
    fonte: 'Ipeadata / Atlas DH (ADH_IDHM)',
    tabelaCodigo: 'ADH_IDHM',
    variavelCodigo: 'ADH_IDHM',
    classificacao: null,
    anoReferencia: 2010,
    incluirNoIndice: true,
    maiorEMelhor: true,
    pesoPadrao: 0,
    sourceUrl: 'http://www.ipeadata.gov.br/api/odata4/Metadados(%27ADH_IDHM%27)',
    descricao:
      'Índice composto de longevidade, educação e renda do Atlas do Desenvolvimento Humano (referência Censo 2010). Peso padrão 0 por ser anterior a 2022.',
  },
  {
    code: 'vulneraveis_2010',
    nome: 'Proporção de vulneráveis à pobreza (Censo 2010)',
    nomeCurto: 'Vulneráveis à pobreza (2010)',
    unidade: '%',
    fonte: 'Ipeadata / Atlas DH (ADH_PPOB)',
    tabelaCodigo: 'ADH_PPOB',
    variavelCodigo: 'ADH_PPOB',
    classificacao: null,
    anoReferencia: 2010,
    incluirNoIndice: true,
    maiorEMelhor: false,
    pesoPadrao: 0,
    sourceUrl: 'http://www.ipeadata.gov.br/api/odata4/Metadados(%27ADH_PPOB%27)',
    descricao:
      'Proporção de indivíduos com renda domiciliar per capita igual ou inferior a meio salário mínimo de agosto de 2010. Peso padrão 0 por ser de 2010.',
  },
  {
    code: 'populacao',
    nome: 'População residente',
    nomeCurto: 'População',
    unidade: 'habitantes',
    fonte: 'IBGE Censo 2022 / Estimativas (6579)',
    tabelaCodigo: '4714',
    variavelCodigo: '93',
    classificacao: null,
    anoReferencia: 2022,
    incluirNoIndice: false,
    maiorEMelhor: true,
    pesoPadrao: 0,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/4714',
    descricao:
      'População residente total do município (Censo 2022) e estimativas anuais (tabela 6579). Usada como contexto e denominador da taxa do Bolsa Família.',
  },
  {
    code: 'domicilios',
    nome: 'Domicílios particulares permanentes ocupados',
    nomeCurto: 'Domicílios ocupados',
    unidade: 'domicílios',
    fonte: 'IBGE Censo 2022',
    tabelaCodigo: '4712',
    variavelCodigo: '381',
    classificacao: null,
    anoReferencia: 2022,
    incluirNoIndice: false,
    maiorEMelhor: true,
    pesoPadrao: 0,
    sourceUrl: 'https://sidra.ibge.gov.br/tabela/4712',
    descricao:
      'Quantidade de domicílios particulares permanentes ocupados no município no Censo 2022. Exibida apenas como contexto territorial.',
  },
];

export const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(
  INDICATORS_CATALOG.filter((i) => i.incluirNoIndice).map((i) => [i.code, i.pesoPadrao]),
);
