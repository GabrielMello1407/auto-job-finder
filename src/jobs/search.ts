import fs from "node:fs";
import { settings } from "../config.js";
import { loadPreferences } from "../profile.js";
import { profileSystem } from "../prompts.js";
import type { Job } from "../schemas.js";
import { fixMojibake } from "../util/text.js";
import { jobPageText } from "./page.js";
import { prefilter } from "./filter.js";
import { SOURCES, type RawJob } from "./sources/index.js";
import { webSearchJobs } from "./sources/websearch.js";
import { upsertJobs } from "./store.js";

export interface SearchOptions {
  sources?: string[];
  queries?: string[];
  web?: boolean;
  webHint?: string;
}

export async function searchJobs(opts: SearchOptions = {}) {
  const prefs = loadPreferences();
  const ctx = { queries: opts.queries?.length ? opts.queries : prefs.queries, companyBoards: prefs.companyBoards };
  const names = opts.sources?.length ? opts.sources : prefs.defaultSources;

  const raw: RawJob[] = [];
  const errors: string[] = [];
  await Promise.all(
    names.map(async (name) => {
      const src = SOURCES[name];
      if (!src) {
        errors.push(`fonte desconhecida: ${name}`);
        return;
      }
      try {
        const found = await src.fetch(ctx);
        console.log(`  ${name}: ${found.length} vagas`);
        raw.push(...found);
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message}`);
      }
    }),
  );

  if (opts.web) {
    try {
      const found = await webSearchJobs({ ...prefs, queries: ctx.queries }, profileSystem(), opts.webHint);
      console.log(`  busca web (IA): ${found.length} vagas`);
      raw.push(...found);
    } catch (e) {
      errors.push(`web: ${(e as Error).message}`);
    }
  }

  // A mesma vaga volta em várias buscas/tags: remove duplicatas por URL antes do filtro.
  const unique = [...new Map(raw.map((j) => [j.url, { ...j, title: fixMojibake(j.title), company: fixMojibake(j.company) }])).values()];
  const { kept, dropped } = prefilter(unique, prefs);
  const added = upsertJobs(kept);
  return { found: unique.length, kept: kept.length, dropped, added, errors };
}

/** Adiciona uma vaga manualmente: URL (busca o texto da página) ou arquivo .md/.txt com a descrição. */
export async function addJob(input: { url?: string; file?: string; text?: string; title?: string; company?: string; location?: string }) {
  let description = "";
  if (input.text) description = input.text;
  else if (input.file) description = fs.readFileSync(input.file, "utf8");
  else if (input.url) {
    if (/linkedin\.com/i.test(input.url))
      throw new Error("O LinkedIn exige login para ler a vaga. Copie o texto da vaga e use 'ajf' → \"Colar uma vaga\" (ou ajf add --file vaga.md --url <link>).");
    const res = await fetch(input.url, { headers: { "User-Agent": settings.userAgent } });
    if (!res.ok) throw new Error(`Não consegui abrir a vaga (${res.status}). Cole o texto num arquivo e use --file.`);
    const html = await res.text();
    description = jobPageText(html);
    if (description.length < 400)
      throw new Error("A página veio quase vazia (site com login/JS, ex.: LinkedIn). Cole o texto num arquivo e use --file.");
  }
  if (!description) throw new Error("Informe --url ou --file.");

  const firstLine = description.split("\n").find((l) => l.trim().length > 3)?.replace(/^#+\s*/, "").trim() ?? "Vaga";
  const site = input.url?.match(/linkedin\.com|gupy\.io|indeed\.|glassdoor\.|catho\.|infojobs\.|vagas\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workday/i)?.[0];
  const raw: RawJob = {
    source: site ? `manual:${site.toLowerCase().replace(/\.(com|io|co)?$/, "").replace(/\.$/, "")}` : "manual",
    title: input.title || firstLine.slice(0, 120),
    company: input.company || "(empresa a confirmar)",
    location: input.location || "",
    remote: null,
    url: input.url || `manual://${input.file ?? "colada"}#${Date.now()}`,
    tags: [],
    description,
  };
  const [job] = upsertJobs([raw]) as Job[];
  if (!job) throw new Error("Essa vaga já está cadastrada.");
  return job;
}
