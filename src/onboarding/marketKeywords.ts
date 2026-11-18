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

/** O texto menciona o termo como palavra inteira (sem acento, sem maiúsculas; "code reviews" vale "code review"). Puro. */
export function mentions(text: string, term: string): boolean {
  const t = norm(term).trim();
  if (!t) return false;
  const hay = norm(text);
  const variants = new Set([t, ...(t.length > 3 && t.endsWith("s") ? [t.slice(0, -1)] : [])]);
  return [...variants].some((v) => new RegExp(`(^|[^a-z0-9])${escape(v)}($|[^a-z0-9])`).test(hay));
}

/** Quantas vagas pedem cada termo (cada vaga conta uma vez por termo), do mais pedido ao menos. Puro. */
export function countKeywords(lists: string[][]): MarketKeyword[] {
  const map = new Map<string, MarketKeyword>();
  for (const list of lists) {
    const seen = new Set<string>();
    for (const raw of list) {
      const term = raw.trim();
      const key = norm(term);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const cur = map.get(key) ?? { term, jobs: 0 };
      cur.jobs++;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.jobs - a.jobs || a.term.localeCompare(b.term));
}

/** Termo que conta como "pedido pelo mercado": em pelo menos 3 vagas e em 5% das analisadas. */
export const minJobs = (total: number) => Math.max(3, Math.ceil(total * 0.05));

/**
 * Separa o que o mercado pede em: termos que o perfil comprova (para o currículo usar) e lacunas (para a
 * pessoa ver). Só as seções de evidência do perfil contam: o que está em "Lacunas" não é prova. Puro.
 */
export function splitMarket(market: MarketKeyword[], truth: string, total: number, max = 30): { proven: MarketKeyword[]; gaps: MarketKeyword[] } {
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
