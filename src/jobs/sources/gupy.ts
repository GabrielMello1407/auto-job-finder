import { settings } from "../../config.js";
import { htmlToText } from "../../util/text.js";
import { GUPY_JOB_TYPE, GUPY_WORKPLACE, nextData } from "../page.js";
import type { JobSource, RawJob } from "./index.js";

/*
 * Gupy: o portal de vagas (portal.gupy.io) que boa parte das empresas do Brasil usa, em todas as áreas.
 * A página de busca já traz as vagas em JSON (`__NEXT_DATA__`), 12 por página, com a descrição.
 * Os requisitos completos ficam na página da vaga: o pacote os baixa na hora de gerar (src/jobs/open.ts).
 */

const PAGES_PER_QUERY = 3;
const DAY = 86_400_000;

export interface GupySearchPage {
  jobs: RawJob[];
  /** Vagas que a página trouxe (antes de tirar as com inscrição encerrada). */
  count: number;
  total: number;
  offset: number;
  limit: number;
}

const brDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });

/** Vagas de uma página de busca do portal da Gupy (o JSON de `__NEXT_DATA__`). */
export function gupySearchPage(data: any, now = Date.now()): GupySearchPage {
  const list = data?.props?.pageProps?.initialJobList;
  const items: any[] = Array.isArray(list?.data) ? list.data : [];
  const p = list?.pagination ?? {};
  const jobs: RawJob[] = [];
  for (const j of items) {
    if (!j?.name || !j?.jobUrl) continue;
    if (/inactive\.gupy\.io/i.test(j.jobUrl)) continue; // página de carreira desativada
    const deadline = typeof j.applicationDeadline === "string" ? j.applicationDeadline : "";
    if (deadline && Date.parse(deadline) + DAY < now) continue; // inscrições já encerradas
    const place = [j.city, j.state].filter(Boolean).join(", ");
    const mode = GUPY_WORKPLACE[j.workplaceType] ?? "";
    const remote = j.workplaceType === "remote" ? true : j.workplaceType ? false : null;
    const type = GUPY_JOB_TYPE[j.type] ?? "";
    jobs.push({
      source: "gupy",
      title: String(j.name).replace(/\s+/g, " ").trim(),
      company: String(j.careerPageName ?? "").trim() || "(ver na vaga)",
      location: remote ? `Remoto${place ? ` (${place})` : ""}` : place || "Brasil",
      remote,
      url: j.jobUrl,
      postedAt: j.publishedDate,
      tags: [mode, type].filter(Boolean),
      description: [
        [mode && `Modelo: ${mode}`, type && `Tipo: ${type}`, deadline && `Inscrições até: ${brDate(deadline)}`].filter(Boolean).join(" · "),
        htmlToText(String(j.description ?? "")),
      ]
        .filter(Boolean)
        .join("\n\n"),
      // Vaga remota na Gupy é para quem mora no Brasil.
      locationRestrictions: remote ? ["Brasil"] : [],
    });
  }
  return { jobs, count: items.length, total: Number(p.total) || 0, offset: Number(p.offset) || 0, limit: Number(p.limit) || items.length };
}

export const gupy: JobSource = {
  name: "gupy",
  description: "Gupy (portal de vagas do Brasil, todas as áreas; use termos em português)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      for (let page = 1; page <= PAGES_PER_QUERY; page++) {
        const url = `https://portal.gupy.io/job-search/term=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`;
        const res = await fetch(url, { headers: { "User-Agent": settings.userAgent, Accept: "text/html" } });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${url}`);
        const data = nextData(await res.text());
        if (!data) throw new Error("a página de busca da Gupy mudou de formato (sem __NEXT_DATA__)");
        const r = gupySearchPage(data);
        out.push(...r.jobs);
        if (!r.count || r.offset + r.limit >= r.total) break;
      }
    }
    return out;
  },
};
