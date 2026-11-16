import { settings } from "../../config.js";
import { htmlToText } from "../../util/text.js";
import { sameCountry } from "../abroad.js";
import type { JobSource, RawJob, SourceContext } from "./index.js";

/**
 * Google for Jobs, pela API da SerpApi (https://serpapi.com/google-jobs-api): as vagas que o Google reúne de
 * LinkedIn, Indeed, Glassdoor e páginas de carreira, já com a descrição completa e sem IA navegando.
 * Precisa de uma chave (SERPAPI_KEY no .env; o plano gratuito tem 250 buscas por mês). Cada termo de busca
 * gasta uma busca da cota, então há um limite de termos por rodada (`googleJobs.maxQueries`).
 * A chave nunca aparece em mensagem de erro, log ou tela.
 */

export const SERPAPI_SIGNUP_URL = "https://serpapi.com/users/sign_up";
export const SERPAPI_KEY_URL = "https://serpapi.com/manage-api-key";
const ENDPOINT = "https://serpapi.com/search";

/** País → parâmetros do Google (gl: país, hl: idioma, location: região). País fora da lista: só a busca. */
const COUNTRY_PARAMS: [string, { gl: string; hl: string; location: string }][] = [
  ["brasil", { gl: "br", hl: "pt-br", location: "Brazil" }],
  ["portugal", { gl: "pt", hl: "pt-pt", location: "Portugal" }],
  ["estados unidos", { gl: "us", hl: "en", location: "United States" }],
  ["canada", { gl: "ca", hl: "en", location: "Canada" }],
  ["reino unido", { gl: "uk", hl: "en", location: "United Kingdom" }],
  ["mexico", { gl: "mx", hl: "es", location: "Mexico" }],
  ["argentina", { gl: "ar", hl: "es", location: "Argentina" }],
  ["chile", { gl: "cl", hl: "es", location: "Chile" }],
  ["colombia", { gl: "co", hl: "es", location: "Colombia" }],
  ["espanha", { gl: "es", hl: "es", location: "Spain" }],
  ["alemanha", { gl: "de", hl: "de", location: "Germany" }],
  ["franca", { gl: "fr", hl: "fr", location: "France" }],
];

export function countryParams(country: string): Record<string, string> {
  return COUNTRY_PARAMS.find(([name]) => sameCountry(name, country))?.[1] ?? {};
}

/** "3 days ago", "há 3 dias", "1 hour ago", "30+ days ago" → data ISO aproximada; sem número reconhecível, nada. */
export function postedAtFrom(text: string | undefined, now = Date.now()): string | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const n = Number(t.match(/(\d+)/)?.[1] ?? (/\b(an?|um|uma)\b/.test(t) ? 1 : NaN));
  if (!Number.isFinite(n)) return undefined;
  const unit = /min/.test(t) ? 60_000 : /hour|hora/.test(t) ? 3_600_000 : /day|dia/.test(t) ? 86_400_000 : /week|semana/.test(t) ? 7 * 86_400_000 : /month|m[eê]s/.test(t) ? 30 * 86_400_000 : 0;
  return unit ? new Date(now - n * unit).toISOString() : undefined;
}

interface SerpJob {
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  share_link?: string;
  job_id?: string;
  extensions?: string[];
  detected_extensions?: { posted_at?: string; salary?: string; schedule_type?: string; work_from_home?: boolean };
  job_highlights?: { title?: string; items?: string[] }[];
  apply_options?: { title?: string; link?: string }[];
}

const isHttp = (link: string | undefined) => {
  try {
    return Boolean(link) && /^https?:$/.test(new URL(link!).protocol);
  } catch {
    return false;
  }
};
/** Link http(s) que não é do próprio Google. */
const isJobSiteLink = (link: string | undefined) => isHttp(link) && !/(^|\.)google\./i.test(new URL(link!).hostname);

/** Resposta da SerpApi → vagas. Puro (testado com o exemplo da documentação). */
export function parseGoogleJobs(data: { jobs_results?: SerpJob[] }, now = Date.now()): RawJob[] {
  return (data.jobs_results ?? [])
    .filter((j) => j.title && j.company_name)
    .map((j): RawJob => {
      // O link da própria vaga (LinkedIn, Gupy, site da empresa) e não o do Google: assim a mesma vaga vinda
      // de outra fonte é reconhecida como repetida.
      const link = j.apply_options?.find((o) => isJobSiteLink(o.link))?.link ?? (isHttp(j.share_link) ? j.share_link! : "");
      const highlights = (j.job_highlights ?? [])
        .filter((h) => h.items?.length)
        .map((h) => `## ${h.title ?? "Detalhes"}\n${h.items!.map((i) => `- ${i}`).join("\n")}`)
        .join("\n\n");
      const remote = Boolean(j.detected_extensions?.work_from_home) || /anywhere|remote|remoto|home office|qualquer lugar|trabalho remoto/i.test(`${j.location ?? ""} ${(j.extensions ?? []).join(" ")}`);
      return {
        source: "googlejobs",
        title: j.title!.trim(),
        company: j.company_name!.trim(),
        location: (j.location ?? "").trim(),
        remote,
        url: link,
        postedAt: postedAtFrom(j.detected_extensions?.posted_at, now),
        salary: j.detected_extensions?.salary || undefined,
        tags: [j.via?.replace(/^via\s+/i, ""), j.detected_extensions?.schedule_type].filter((x): x is string => Boolean(x)),
        description: [htmlToText(j.description ?? ""), highlights].filter(Boolean).join("\n\n"),
      };
    })
    .filter((j) => j.url);
}

/** Uma busca na SerpApi. Erros vêm com a mensagem da SerpApi, nunca com a chave. */
export async function serpApiJobs(query: string, key: string, country: string): Promise<RawJob[]> {
  const params = new URLSearchParams({ engine: "google_jobs", q: query, ...countryParams(country), api_key: key });
  const hide = (s: string) => s.split(key).join("***");
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { headers: { "User-Agent": settings.userAgent, Accept: "application/json" } });
  } catch (e) {
    throw new Error(hide(`não consegui falar com a SerpApi (${(e as Error).message})`));
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; jobs_results?: SerpJob[] };
  // Sem vagas para o termo não é erro.
  if (data.error && /hasn't returned any results|no results/i.test(data.error)) return [];
  if (!res.ok || data.error) throw new Error(hide(data.error ?? `a SerpApi respondeu ${res.status}`));
  return parseGoogleJobs(data);
}

export const googleJobs: JobSource = {
  name: "googlejobs",
  description: "Google for Jobs (LinkedIn, Indeed, Glassdoor e páginas de carreira, pela API da SerpApi; precisa de chave)",
  async fetch(ctx: SourceContext) {
    const key = process.env.SERPAPI_KEY?.trim();
    if (!key) throw new Error("falta a chave da SerpApi (Preferências → Como buscar → Google for Jobs)");
    const out: RawJob[] = [];
    for (const q of ctx.queries.slice(0, Math.max(1, ctx.googleJobsMaxQueries ?? 3))) out.push(...(await serpApiJobs(q, key, ctx.country ?? "")));
    return out;
  },
};
