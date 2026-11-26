# Lupa Territorial

Retrato social comparativo de municípios brasileiros com índice composto transparente, construído em **React + Node/Express + SQLite + Leaflet**. Voltado para gestores públicos, pesquisadores, estudantes e conselhos municipais.

> **Aviso:** Informativo. Não substitui atendimento de saúde. Emergência: **SAMU 192**.
> O índice é uma ferramenta comparativa relativa aos municípios do estado selecionado — **não constitui diagnóstico nem estabelece relação de causalidade**.

---

## 1. Problema e Objetivos

Comparar condições socioeconômicas e de infraestrutura entre municípios exige cruzar múltiplas bases públicas (IBGE Censo Demográfico, malhas cartográficas e séries sociais do Ipeadata), cada uma com formatos e anos de referência distintos. A **Lupa Territorial** unifica essas fontes no servidor, armazena cache e histórico em banco relacional e permite comparar até **3 municípios** lado a lado com:

- Seleção de qualquer uma das **27 UFs** e até **3 municípios**;
- **Índice composto (0 a 1)** normalizado por min-máx entre os municípios do estado (onde `1 = mais vulnerável do estado`), com pesos editáveis em tempo real, fórmula visível e botão **"Restaurar pesos"**;
- **Gráfico de radar** e **tabela comparativa** com ano de referência e botão **"De onde vem"** em cada valor;
- **Mapa coroplético estadual** (Leaflet) colorido em tempo real pelo índice;
- **Gráfico de tendência histórica** (população e Bolsa Família);
- **Alternativas em texto** para gráficos e mapa, navegação por teclado, foco visível e contraste WCAG AA;
- **Plano B offline** completo para as **27 UFs** em `data/`.

---

## 2. Fontes de Dados Oficiais (Testadas)

### A. IBGE Localidades e Malhas
- **Estados:** `GET https://servicodados.ibge.gov.br/api/v1/localidades/estados` (Nível: UF)
- **Municípios por UF:** `GET https://servicodados.ibge.gov.br/api/v1/localidades/estados/{uf}/municipios` (Nível: Município `N6`)
- **Malha municipal (GeoJSON):** `GET https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima`
  - Campo chave de ligação: `features[].properties.codarea` (código IBGE de 7 dígitos).

### B. IBGE Agregados / SIDRA (`https://servicodados.ibge.gov.br/api/v3/agregados/{tabela}/periodos/{periodo}/variaveis/{variavel}`)

| Indicador | Tabela | Variável | Classificação | Período | Nível | Uso no Índice |
|---|---:|---:|---|---|---|---|
| Renda domiciliar per capita média | `10295` | `13431` | `2[6794]\|86[95251]\|58[95253]` | `2022` | `N6` (Município) | Peso padrão `1` (invertido) |
| Taxa de alfabetização (15+ anos) | `9543` | `2513` | `2[6794]\|86[95251]\|287[100362]` | `2022` | `N6` (Município) | Peso padrão `1` (invertido) |
| Água por rede geral (forma principal) | `6803` | `1000381` | `1821[72144]` | `2022` | `N6` (Município) | Peso padrão `1` (invertido) |
| Esgotamento sanitário (rede ou fossa ligada) | `6805` | `1000381` | `11558[46290]` | `2022` | `N6` (Município) | Peso padrão `1` (invertido) |
| Coleta de lixo (lixo coletado) | `6892` | `1000381` | `67[2520]` | `2022` | `N6` (Município) | Peso padrão `1` (invertido) |
| População residente (Censo) | `4714` | `93` | — | `2022` | `N6` (Município) | Contexto + denominador |
| Domicílios particulares ocupados | `4712` | `381` | — | `2022` | `N6` (Município) | Apenas contexto |
| Estimativa da população (tendência) | `6579` | `9324` | — | `2018\|2019\|2020\|2021\|2024\|2025` | `N6` (Município) | Gráfico histórico |

**Exemplo real de resposta (Tabela `6803`, Angra dos Reis - RJ):**
```json
[
  {
    "id": "1000381",
    "variavel": "Domicílios particulares permanentes ocupados - percentual do total geral",
    "unidade": "Percentual",
    "resultados": [
      {
        "series": [
          {
            "localidade": { "id": "3300100", "nivel": { "id": "N6", "nome": "Município" }, "nome": "Angra dos Reis - RJ" },
            "serie": { "2022": "87.74" }
          }
        ]
      }
    ]
  }
]
```

### C. Ipeadata OData (`https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='...')`)
- **`FAM_PBF`** — Programa Bolsa Família (número de benefícios em dezembro, 2004–2025, nível `Municípios`). Convertido no servidor para **benefícios por 1.000 habitantes**. Peso padrão `1` (direto: maior valor = maior vulnerabilidade).
- **`ADH_IDHM`** — IDHM (Censo 1991, 2000, 2010, nível `Municípios`). Peso padrão `0` por ser de **2010**.
- **`ADH_PPOB`** — Proporção de vulneráveis à pobreza (Censo 1991, 2000, 2010, nível `Municípios`). Peso padrão `0` por ser de **2010**.
- **`AVS_IVS` (limitação verificada):** existe apenas para `Brasil`, `Regiões` e `Estados` (`0` registros municipais). Esse limite é informado na tela principal e em "Sobre os dados".

**Exemplo real de resposta (`FAM_PBF`):**
```json
{
  "SERCODIGO": "FAM_PBF",
  "VALDATA": "2004-01-01T00:00:00-02:00",
  "VALVALOR": 47349,
  "NIVNOME": "Municípios",
  "TERCODIGO": "3304557"
}
```

---

## 3. Banco de Dados e Esquema Relacional

### Escolha do banco
- **Localmente:** **SQLite** (via módulo nativo `node:sqlite` do Node.js 22), por dispensar instalação de servidor externo, rodar em arquivo único (`data/lupa_territorial.sqlite`) e facilitar a avaliação acadêmica pelos estudantes.
- **Para publicação em produção:** recomenda-se **PostgreSQL** (ex.: Cloud SQL), pois permite múltiplas réplicas de aplicação compartilharem o mesmo estado persistente sem bloqueio de arquivo local.

### Esquema (`src/db/schema.ts`)

```
states (PK: id)
  ├──< municipalities (PK: id, FK: state_id -> states.id)
  │       └──< indicator_values (PK: id, FK: municipality_id -> municipalities.id, FK: indicator_code -> indicators.code)
indicators (PK: code) ───────────────────────┘
ipeadata_cache (PK composta: series_code, municipality_id, ano)
```

1. `states`: `id` (PK), `sigla`, `nome`, `regiao`, `malha_geojson`, `collected_at`, `is_offline`, `is_teste`.
2. `municipalities`: `id` (PK IBGE 7 dígitos), `state_id` (FK -> `states.id`), `nome`, `microrregiao`, `regiao_imediata`, `is_teste`.
3. `indicators`: `code` (PK), `nome`, `nome_curto`, `unidade`, `fonte`, `tabela_codigo`, `variavel_codigo`, `classificacao`, `ano_referencia`, `incluir_no_indice`, `maior_e_melhor`, `peso_padrao`, `source_url`, `descricao`.
4. `indicator_values`: `id` (PK), `municipality_id` (FK -> `municipalities.id`), `indicator_code` (FK -> `indicators.code`), `ano`, `valor`, `collected_at`, `source_mode`, `is_teste`.
5. `ipeadata_cache`: cache único no servidor para séries completas do Ipeadata filtradas para o nível municipal.

---

## 4. Como Rodar

```bash
# 1. Instalar dependências
npm install

# 2. Criar/atualizar tabelas SQLite
npm run db:migrate

# 3. Iniciar servidor Express + React em modo desenvolvimento (porta 3000)
npm run dev
```

### Outros comandos úteis
- `npm test` — Executa os testes unitários da normalização min-máx e cálculo do índice (`tests/indexCalculator.test.ts`).
- `npm run data:fetch` — Baixa novamente as amostras reais das 27 UFs (incluindo malhas GeoJSON) e séries do Ipeadata para `data/`.
- `npm run db:seed-test` — Insere o estado fictício `ZT` (`is_teste = 1`, idempotente).
- `npm run db:clean-test` — Remove **apenas** os registros de teste (`WHERE is_teste = 1`).
- `npm run build` e `npm start` — Gera build de produção e sobe o servidor Node.

---

## 5. Decisões e Limitações Conhecidas

- **Fórmula do índice composto:** `IV(m) = Σ(wᵢ × vᵢ(m)) / Σwᵢ`, onde `vᵢ(m) = (x − mín) / (máx − mín)` entre os municípios do estado. Quando `maior_e_melhor = true`, aplica-se `1 − vᵢ(m)` para que `1` represente maior vulnerabilidade. Se `máx === mín`, adota-se `0,5`.
- **Ipeadata sem filtro eficiente por município:** como o `$filter` do OData não filtra rapidamente por município, o servidor baixa a série uma vez, filtra `NIVNOME === 'Municípios'` e grava em `ipeadata_cache`.
- **Privacidade:** não há login, cookies de rastreio, analytics nem coleta de dados pessoais; apenas estatísticas públicas agregadas.
- **Fora do escopo:** dados por bairro ou setor censitário e modelos de previsão.
