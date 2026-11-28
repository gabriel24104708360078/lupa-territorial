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

## 5. Publicação no Vercel (Plano Hobby Gratuito) e Limitações

1. Conecte o repositório do GitHub no **Vercel** (o `package.json` define `"engines": { "node": "22.x" }` e o `vercel.json` já configura o deploy):
   - `regions`: `["gru1"]` (São Paulo, reduzindo a latência até as APIs do IBGE e do Ipeadata)
   - `buildCommand`: `"npm run build"` e `outputDirectory`: `"dist"`
   - `functions["api/index.ts"]`: `includeFiles: "data/**"` (com `.vercelignore` excluindo `data/*.sqlite*`) e `maxDuration: 60`
   - `rewrites`: `/api/(.*)` redireciona para `/api/index` e as demais rotas caem em `/index.html`
2. Não é necessário configurar chaves de API nem `GEMINI_API_KEY`, pois todas as fontes são públicas e o app não usa IA.

### Como funciona o SQLite (`node:sqlite`) no Vercel (`/tmp`)
- No runtime **Node 22 (`nodejs22.x`)** do Vercel, o módulo nativo `node:sqlite` (`DatabaseSync`) funciona diretamente sem compilação C++ (`node-gyp`), porém o sistema de arquivos da aplicação é **somente leitura**, exceto pelo diretório temporário **`/tmp`**.
- Quando a variável de ambiente `VERCEL` existe, o servidor grava o banco SQLite automaticamente em **`/tmp/lupa_territorial.sqlite`**.
- **Consultas ao vivo e plano B granular:** em *cold starts* ou reciclagem de instâncias, `/tmp` começa vazio; o servidor recria as tabelas, dispara as chamadas ao IBGE (Localidades, Malhas e SIDRA) e ao Ipeadata em paralelo (`Promise.all`, com tempo-limite de **25 s** por requisição) e só recorre às amostras em `data/` caso alguma fonte realmente falhe ou estoure o limite. Se o IBGE responder ao vivo e apenas um indicador do Ipeadata falhar, apenas aquele indicador usa a amostra local com aviso explícito na tela, sem marcar o estado inteiro como offline; se o IBGE falhar, exibe **"Dados de &lt;data&gt; (modo offline)"**.
- Para persistência definitiva multi-instância fora do `/tmp`, recomenda-se conectar um banco gerenciado externo (**PostgreSQL**).

---

## 6. Decisões e Limitações Conhecidas

- **Fórmula do índice composto:** `IV(m) = Σ(wᵢ × vᵢ(m)) / Σwᵢ`, onde `vᵢ(m) = (x − mín) / (máx − mín)` entre os municípios do estado. Quando `maior_e_melhor = true`, aplica-se `1 − vᵢ(m)` para que `1` represente maior vulnerabilidade. Se `máx === mín`, adota-se `0,5`.
- **Ipeadata sem filtro eficiente por município:** como o `$filter` do OData não filtra rapidamente por município, o servidor baixa a série uma vez, filtra `NIVNOME === 'Municípios'` e grava em `ipeadata_cache`.
- **Privacidade:** não há login, cookies de rastreio, analytics nem coleta de dados pessoais; apenas estatísticas públicas agregadas.
- **Fora do escopo:** dados por bairro ou setor censitário e modelos de previsão.

---

## 7. Uso de IA e prompts

- **Ferramenta utilizada:** Google AI Studio, modo Build.
- **Aplicação publicada:** https://lupa-territorial.vercel.app
- **Repositório GitHub:** https://github.com/gabriel24104708360078/lupa-territorial

### Correções e decisões registradas ao longo do desenvolvimento
1. **`AVS_IVS` sem série municipal no Ipeadata:** nos testes reais da API OData do Ipeadata, verificou-se que a série `AVS_IVS` (Índice de Vulnerabilidade Social) possui registros apenas para Brasil, Grandes Regiões e UFs. Decisão: documentar essa limitação na tela principal e em "Sobre os dados", utilizando `FAM_PBF` (Bolsa Família por 1.000 habitantes, último ano disponível) com peso padrão `1` e mantendo `ADH_IDHM` e `ADH_PPOB` (2010) com peso padrão `0`.
2. **Inclusão da coleta de lixo no índice:** adicionada a tabela SIDRA `6892` (variável `1000381`, classificação `67[2520]`, Censo 2022) com peso padrão `1` e inversão dos indicadores em que maior valor significa menor vulnerabilidade (`1 = mais vulnerável do estado`).
3. **Plano B completo para as 27 UFs:** em vez de amostra única apenas do RJ, foram baixados dados reais e malhas GeoJSON simplificadas (`qualidade=minima`) para todas as 27 UFs em `data/`, com script `npm run data:fetch` para recompra/atualização offline.
4. **Filtro do Ipeadata no servidor:** como o parâmetro `$filter` da API OData do Ipeadata falhou/excedeu o tempo nos testes iniciais, o servidor baixa cada série uma vez, filtra `NIVNOME === 'Municípios'` em Node.js e grava em cache na tabela `ipeadata_cache`.
5. **Troca de plataforma de publicação (Netlify → Vercel):** removidos `netlify.toml`, `netlify/functions/` e `serverless-http`; criada a função `api/index.ts` e o `vercel.json` reaproveitando o mesmo módulo Express (`src/server/apiApp.ts`) com `node:sqlite` gravando em `/tmp` quando `VERCEL` está definida.
6. **Correção do modo offline por tempo-limite no Vercel:** como os tempos-limite iniciais (`6,5 s` e `7,5 s`) faziam `/api/states/33/overview` cair no plano B em produção, o `vercel.json` passou a usar `"regions": ["gru1"]` e `"maxDuration": 60`, os tempos-limite externos foram ampliados para `25 s`, todas as chamadas SIDRA e Ipeadata passaram a executar em paralelo (`Promise.all`) e o fallback tornou-se granular por indicador (se apenas um indicador do Ipeadata falhar e o IBGE responder ao vivo, somente esse indicador vem de `data/`, com aviso específico na interface).

### Prompts principais utilizados (em ordem cronológica, na íntegra)

#### 1) Prompt inicial (BLOCO COMUM + Prompt do MVP do sistema 6)
```text
PAPEL E MODO DE TRABALHOVocê é um engenheiro full-stack sênior ajudando uma dupla de estudantes de Programação Web.Antes de escrever código: (1) liste suas suposições; (2) teste cada endpoint ou arquivo de dados informado e mostre a resposta real (status e campos principais); (3) se algo não existir ou falhar, PARE e me avise. Não invente endpoints, campos ou dados.Trabalhe em etapas pequenas e explique cada arquivo criado em 2 linhas, para que os estudantes consigam defender o código.REGRAS GERAIS- Português do Brasil, mobile first, acessível: contraste AA, rótulos nos campos, foco visível, navegação completa por teclado, alternativa em texto para gráficos e mapas. Nunca usar só cor para indicar nível.- Plano B: guardar amostras reais em data/ e usá-las quando a fonte falhar, com o aviso visível "Dados de <data> (modo offline)".- Toda tela mostra "Fonte: <nome>, atualizado em <data>". Criar a página "Sobre os dados" (fontes, limitações, avisos).- Privacidade: não coletar, gravar nem enviar dado pessoal; sem cookies de rastreio, sem login, sem analytics. Usar só dados agregados.- Banco de dados obrigatório: criar esquema com no mínimo 3 tabelas relacionadas (PK e FK) e script de criação e carga (migrations ou seed). O servidor consulta as APIs, grava o resultado no banco com data de coleta (cache) e o front-end lê do banco. Guardar histórico para gráficos de tendência. Só dados públicos e agregados, sem dado pessoal. Mostrar o esquema no README. Para rodar localmente, SQLite; para publicar, banco persistente (PostgreSQL ou Firestore). Informe qual banco escolheu e por quê.- Aviso fixo no rodapé: "Informativo. Não substitui atendimento de saúde. Emergência: SAMU 192."- Chaves e segredos só no servidor, por variável de ambiente; nunca no front-end nem no repositório.- Toda tela trata carregando, vazio e erro. Código simples, com comentários onde houver regra de negócio.- Entregar README com: problema, fontes (URL, nível, exemplo de resposta), como rodar, decisões e limitações conhecidas.SISTEMA: Lupa Territorial. Retrato social de municípios com índice composto transparente.PÚBLICO: gestores, pesquisadores, estudantes, conselhos.STACK: React + servidor Node do ambiente (junta as chamadas às APIs); Leaflet; gráfico de radar.DADOS (testar antes; registrar no README o número de cada tabela e variável):- Municípios e malhas: IBGE Localidades e Malhas.- Indicadores: API Agregados/SIDRA do IBGE (Censo 2022): população, domicílios, abastecimento de água por rede, esgotamento sanitário, alfabetização. Formato: https://servicodados.ibge.gov.br/api/v3/agregados/{tabela}/periodos/{periodo}/variaveis/{variavel} Localize as tabelas corretas na documentação e me mostre antes de usar.- Renda e vulnerabilidade: API OData do Ipeadata, quando houver série municipal; se não houver, dizer isso na tela.TELAS DO MVP:1) Seleção de até 3 municípios.2) Comparativo: radar, tabela e valores com ano de referência.3) Índice composto: normalização 0 a 1 (mín-máx entre os municípios do estado) e pesos editáveis na tela, com a fórmula visível e um botão "restaurar pesos".4) Mapa coroplético do estado pelo índice.5) Cada número tem um botão "de onde vem" com tabela, variável, ano e link.REGRAS: nunca afirmar causalidade; o índice é uma ferramenta de comparação, não um diagnóstico.CRITÉRIOS DE ACEITE: índice recalcula em tempo real ao mudar pesos; teste unitário da normalização.FORA DO ESCOPO: dados por bairro, previsões.
```

#### 2) Aprovação da Etapa 1 com ajustes
```text
Pode seguir para a Etapa 1, com estes ajustes:
1) Inclua também a coleta de lixo: tabela 6892, variável 1000381, classificação 67[2520] (lixo coletado), Censo 2022.
2) Indicadores do índice (todos com ano visível): renda 10295, alfabetização 9543, água 6803, esgoto 6805, lixo 6892 (peso padrão 1 cada); taxa de benefícios do Bolsa Família por 1.000 habitantes (FAM_PBF, último ano disponível, aqui maior = mais vulnerável, peso padrão 1); IDHM 2010 e % vulneráveis à pobreza 2010 (ADH_IDHM, ADH_PPOB) com peso padrão 0, porque são de 2010. População (4714) e domicílios (4712) só como contexto, fora do índice.
3) No índice, 1 = mais vulnerável do estado: inverter os indicadores em que maior é melhor.
4) Plano B: amostras reais para as 27 UFs (não só RJ), incluindo as malhas, com um script para baixar de novo.
5) Ipeadata: como o $filter não funciona bem, baixe a série uma vez no servidor, filtre por município e guarde no banco.
6) Script de dados de teste (seed) com coluna is_teste, idempotente, e comando para apagar só os dados de teste; toda tela com dados de teste mostra "Dados de teste, não são reais".
Mantenha os comentários no código e a explicação de cada arquivo em 2 linhas.
```

#### 3) Pedido de adaptação para Netlify
```text
Preciso publicar o app no Netlify (plano gratuito), a partir do repositório do GitHub. Adapte sem mudar as telas nem as regras do índice:
1) Crie netlify.toml: build "npm run build", publish "dist", functions em "netlify/functions", Node 22, e redirect de /api/* para a função (status 200). Inclua a pasta data/ nos arquivos da função (included_files) para o plano B funcionar.
2) Separe a criação do app Express (rotas /api) em um módulo reutilizado por server.ts (local) e por netlify/functions/api.ts, que embrulha o Express com serverless-http.
3) No Netlify o disco é temporário: quando estiver rodando lá (variável NETLIFY ou AWS_LAMBDA_FUNCTION_NAME), use o SQLite em /tmp; se o banco estiver vazio, recarregue das APIs e, se falharem, das amostras em data/, com o aviso "modo offline". Explique isso no README (seção de publicação e limitações).
4) O front-end deve chamar /api com caminho relativo, para funcionar igual no local e no Netlify.
5) Remova a dependência @google/genai e a GEMINI_API_KEY do .env.example, porque o app não usa IA.
6) Rode build, testes e lint e me mostre o resultado. Explique cada arquivo novo em 2 linhas.
```

#### 4) Troca para Vercel
```text
Mudança de plano: vou publicar no Vercel (plano Hobby, gratuito), não no Netlify. Ajuste:
1) Remova netlify.toml, a pasta netlify/ e a dependência serverless-http se não for mais usada.
2) Crie a função do Vercel em api/[...path].ts (ou api/index.ts com rewrite) que reutiliza o mesmo módulo do app Express, e um vercel.json com: buildCommand "npm run build", outputDirectory "dist", rewrite de /api/(.*) para a função e fallback das outras rotas para /index.html. Garanta que a pasta data/ seja incluída na função (includeFiles) para o plano B funcionar.
3) No Vercel o disco também é temporário: quando a variável VERCEL existir, use o SQLite em /tmp e recarregue das APIs ou das amostras em data/ se o banco estiver vazio, com o aviso "modo offline". Confirme que node:sqlite funciona no runtime Node 22 do Vercel; se não funcionar, avise antes de trocar de solução.
4) Atualize o README (seção de publicação e limitações) para Vercel.
5) Rode build, testes e lint e me mostre o resultado. Explique cada arquivo novo em 2 linhas.
```

#### 5) Correção de modo offline no Vercel e registro de uso de IA
```text
Duas tarefas:

1) MODO OFFLINE NO VERCEL. O app está publicado em https://lupa-territorial.vercel.app e, no Vercel, a rota /api/states/33/overview sempre cai no plano B ("modo offline"), porque as chamadas ao IBGE e ao Ipeadata passam dos tempos-limite de 6,5 s e 7,5 s. Ajuste para carregar ao vivo:
- vercel.json: "regions": ["gru1"] (São Paulo, perto das APIs) e "maxDuration": 60 na função api/index.ts.
- Aumente os tempos-limite das chamadas externas para cerca de 25 s e faça as chamadas do SIDRA em paralelo (Promise.all), não uma depois da outra.
- Mantenha o plano B: só usar data/ se a API falhar de verdade ou passar do limite, com o aviso "modo offline".
- Se um indicador do Ipeadata falhar mas o IBGE responder, use o IBGE ao vivo e só esse indicador da amostra, avisando qual veio offline (em vez de marcar tudo como offline).

2) README: crie a seção "Uso de IA e prompts", exigida pelo professor. Inclua:
- a ferramenta usada (Google AI Studio, modo Build);
- os prompts principais desta conversa, copiados na íntegra e em ordem: o prompt inicial (BLOCO COMUM + Prompt do MVP do sistema 6), a aprovação da Etapa 1 com ajustes, o pedido de adaptação para Netlify, a troca para Vercel e este pedido;
- uma lista do que precisou ser corrigido ou decidido (IVS sem série municipal, inclusão da coleta de lixo, plano B para as 27 UFs, filtro do Ipeadata, troca de Netlify para Vercel, modo offline por tempo-limite);
- o link do app publicado e o do repositório.

Rode build, testes e lint e me mostre o resultado.
```

