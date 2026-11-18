import fs from "node:fs";
import path from "node:path";
import { loadJobs } from "../jobs/store.js";
import { evidenceOf } from "../profile.js";
import type { Job } from "../schemas.js";
import { norm } from "../util/text.js";

/**
 * Palavras-chave do mercado da própria pessoa, sem IA: o que as vagas que ela já analisou pedem (as
 * `atsKeywords` da análise de cada pacote). Vale para qualquer área: uma enfermeira vê "UTI" e "SAE", quem
 * é de marketing vê "Google Ads". O currículo-base recebe só os termos que o perfil comprova; os que o perfil
 * não comprova são lacunas, mostradas à pessoa como plano de estudo, nunca escritas no currículo.
 */

export interface MarketKeyword {
  term: string;
  /** Em quantas vagas analisadas o termo aparece. */
  jobs: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Tira o "s" do plural ("APIs", "testes"), mas não de "ss" ("Sass" não vira "SAS"; "Express" fica). */
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const words = (term: string) => norm(term).trim().split(/\s+/).filter(Boolean);

/**
 * Termo de duas palavras com uma sigla ("APIs REST", "REST APIs"): a ordem muda de um idioma para outro e o
 * sentido fica. Sem sigla, a ordem muda o sentido ("design system" não é "system design").
 */
const reorderable = (term: string) => term.trim().split(/\s+/).length === 2 && /[A-Z]{2,}/.test(term);

/** As grafias que valem o mesmo termo: com e sem o plural e, se `reorderable`, na ordem inversa. */
function variantsOf(term: string): string[] {
  const w = words(term);
  if (!w.length) return [];
  const forms = [w, [...w.slice(0, -1), singular(w[w.length - 1])], w.map(singular)];
  if (reorderable(term)) forms.push(...forms.map((f) => [f[1], f[0]]));
  return [...new Set(forms.map((f) => f.join(" ")))];
}

/** O texto menciona o termo como palavra inteira (sem acento, sem maiúsculas; "code reviews" vale "code review"). Puro. */
export function mentions(text: string, term: string): boolean {
  const hay = norm(text);
  return variantsOf(term).some((v) => new RegExp(`(^|[^a-z0-9])${escape(v)}($|[^a-z0-9])`).test(hay));
}

/** Chave que junta as grafias do mesmo termo ("REST APIs", "APIs REST", "code reviews", "Code Review"). */
const termKey = (term: string) => {
  const w = words(term).map(singular);
  return (reorderable(term) ? w.sort() : w).join(" ");
};

/**
 * Quantas vagas pedem cada termo (cada vaga conta uma vez por termo; grafias do mesmo termo se somam), do
 * mais pedido ao menos. O termo mostrado é a grafia mais usada nas vagas. Puro.
 */
export function countKeywords(lists: string[][]): MarketKeyword[] {
  const map = new Map<string, { jobs: number; spellings: Map<string, number> }>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const raw of list) {
      const term = raw.trim();
      const key = termKey(term);
      if (!key) continue;
      const cur = map.get(key) ?? { jobs: 0, spellings: new Map<string, number>() };
      cur.spellings.set(term, (cur.spellings.get(term) ?? 0) + 1);
      if (!seen.has(key)) cur.jobs++;
      seen.add(key);
      map.set(key, cur);
    }
  }
  return [...map.values()]
    .map(({ jobs, spellings }) => ({ term: [...spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], jobs }))
    .sort((a, b) => b.jobs - a.jobs || a.term.localeCompare(b.term));
}

/** Termo que conta como "pedido pelo mercado": em pelo menos 3 vagas e em 5% das analisadas. */
export const minJobs = (total: number) => Math.max(3, Math.ceil(total * 0.05));

/**
 * Separa o que o mercado pede em: termos que o perfil comprova (para o currículo usar) e lacunas (para a
 * pessoa ver). Só as seções de evidência do perfil contam: o que está em "Lacunas" não é prova. O teto é
 * folgado (o mínimo de vagas já cresce com o total analisado): cortar termos comprovados e pedidos faz a IA
 * tirá-los das competências, porque a regra manda preferir o que o mercado pede. Puro.
 */
export function splitMarket(market: MarketKeyword[], truth: string, total: number, max = 60): { proven: MarketKeyword[]; gaps: MarketKeyword[] } {
  const evidence = evidenceOf(truth);
  const wanted = market.filter((k) => k.jobs >= minJobs(total));
  return { proven: wanted.filter((k) => mentions(evidence, k.term)).slice(0, max), gaps: wanted.filter((k) => !mentions(evidence, k.term)).slice(0, 15) };
}

/** As listas de palavras-chave das vagas com pacote (analysis.json de cada pasta). */
export function analyzedKeywordLists(jobs: Job[] = loadJobs()): string[][] {
  const out: string[][] = [];
  for (const j of jobs) {
    if (!j.outputDir) continue;
    try {
      const a = JSON.parse(fs.readFileSync(path.join(j.outputDir, "analysis.json"), "utf8")) as { analysis?: { atsKeywords?: unknown } };
      const list = a.analysis?.atsKeywords;
      if (Array.isArray(list)) out.push(list.filter((x): x is string => typeof x === "string"));
    } catch {
      /* pacote sem análise */
    }
  }
  return out;
}

/** O mercado de agora para o currículo-base. Sem vagas analisadas, listas vazias (o currículo sai como sempre). */
export function currentMarket(truth: string): { proven: MarketKeyword[]; gaps: MarketKeyword[]; total: number } {
  let lists: string[][] = [];
  try {
    lists = analyzedKeywordLists();
  } catch {
    /* sem vagas salvas */
  }
  return { ...splitMarket(countKeywords(lists), truth, lists.length), total: lists.length };
}
