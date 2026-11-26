/**
 * Script para baixar e atualizar amostras reais completas das 27 UFs (incluindo malhas GeoJSON)
 * e séries municipais do Ipeadata para o diretório `data/` (Plano B offline).
 * Uso: `npx tsx scripts/fetch-offline-data.ts`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fetchIbgeStateBundleOnline } from '../src/services/externalData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');

async function fetchJson<T>(url: string, timeoutMs = 30000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} em ${url}`);
  }
  return (await res.json()) as T;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function main(): Promise<void> {
  ensureDir(DATA_DIR);
  ensureDir(path.join(DATA_DIR, 'states'));
  ensureDir(path.join(DATA_DIR, 'malhas'));
  ensureDir(path.join(DATA_DIR, 'ipeadata'));

  console.log('1/3 Baixando lista das 27 UFs do IBGE...');
  const statesRaw = await fetchJson<Array<{ id: number; sigla: string; nome: string; regiao: { nome: string } }>>(
    'https://servicodados.ibge.gov.br/api/v1/localidades/estados',
  );
  const states = statesRaw
    .map((s) => ({
      id: s.id,
      sigla: s.sigla,
      nome: s.nome,
      regiao: s.regiao?.nome || '',
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const now = new Date().toISOString();
  fs.writeFileSync(path.join(DATA_DIR, 'states.json'), JSON.stringify({ collectedAt: now, states }));
  console.log(`   -> ${states.length} UFs salvas em data/states.json.`);

  console.log('2/3 Baixando séries municipais do Ipeadata (FAM_PBF, ADH_IDHM, ADH_PPOB)...');
  for (const code of ['FAM_PBF', 'ADH_IDHM', 'ADH_PPOB']) {
    const url = `https://www.ipeadata.gov.br/api/odata4/ValoresSerie(SERCODIGO='${code}')`;
    const payload = await fetchJson<{
      value?: Array<{ VALDATA: string; VALVALOR: number | null; NIVNOME: string; TERCODIGO: string }>;
    }>(url, 45000);

    const rows = (payload.value || [])
      .filter((r) => r.NIVNOME === 'Municípios' && typeof r.VALVALOR === 'number' && Number.isFinite(r.VALVALOR) && r.TERCODIGO)
      .map((r) => ({
        municipalityId: String(r.TERCODIGO),
        ano: Number(r.VALDATA.slice(0, 4)),
        valor: r.VALVALOR as number,
      }))
      .filter((r) => (code === 'FAM_PBF' ? r.ano >= 2018 : true));

    fs.writeFileSync(
      path.join(DATA_DIR, 'ipeadata', `${code}.json`),
      JSON.stringify({ collectedAt: new Date().toISOString(), seriesCode: code, rows }),
    );
    console.log(`   -> ${code}: ${rows.length} registros municipais salvos.`);
  }

  console.log('3/3 Baixando municípios, malhas GeoJSON e indicadores Censo 2022/Estimativas das 27 UFs...');
  for (const uf of states) {
    process.stdout.write(`   -> [${uf.sigla} - ${uf.id}] ${uf.nome}... `);
    const { bundle, malhaGeoJson } = await fetchIbgeStateBundleOnline(uf.id, uf);
    fs.writeFileSync(path.join(DATA_DIR, 'states', `${uf.id}.json`), JSON.stringify(bundle));
    fs.writeFileSync(path.join(DATA_DIR, 'malhas', `${uf.id}.geojson`), malhaGeoJson);
    console.log(`${bundle.municipalities.length} municípios ok.`);
  }

  console.log('Download offline completo das 27 UFs concluído com sucesso.');
}

main().catch((err) => {
  console.error('Erro ao baixar dados offline:', err);
  process.exit(1);
});
