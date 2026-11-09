import fs from "node:fs";
import { settings } from "../config.js";
import { loadPreferences } from "../profile.js";
import { profileSystem } from "../prompts.js";
import { fixMojibake, norm, shortHash } from "../util/text.js";
import { canonicalUrl } from "./dedupe.js";
import { jobPageText } from "./page.js";
import { prefilter } from "./filter.js";
import { SOURCES, type RawJob } from "./sources/index.js";
import { webSearchJobs } from "./sources/websearch.js";
import { STATUS_LABELS } from "./status.js";
import { flagHandledTwins, loadJobs, upsertJobs } from "./store.js";

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

  // A mesma vaga volta em várias buscas/tags: remove o mesmo link antes do filtro.
  const unique = [...new Map(raw.map((j) => [canonicalUrl(j.url), { ...j, title: fixMojibake(j.title), company: fixMojibake(j.company) }])).values()];
  const { kept, dropped } = prefilter(unique, prefs);
  // A mesma vaga em outro site (outro link) entra como repetida, já descartada (src/jobs/dedupe.ts).
  const { added: inserted, duplicates } = upsertJobs(kept);
  // Vagas salvas que são a mesma de uma que você já enviou ou tem pacote (inclusive as salvas antes desta checagem).
  const twins = flagHandledTwins();
  const twinIds = new Set(twins.map((t) => t.job.id));
  const added = inserted.filter((j) => !twinIds.has(j.id));
  return { found: unique.length, kept: kept.length, dropped, added, duplicates, twins, errors };
}

/** "12 novas · 3 repetidas (a mesma vaga em outro site) · de 80 encontradas; 40 passaram no filtro". */
export function searchSummary(s: Pick<Awaited<ReturnType<typeof searchJobs>>, "added" | "duplicates" | "twins" | "found" | "kept">): string {
  const dup = s.duplicates.length ? ` · ${s.duplicates.length} repetida(s) (a mesma vaga em outro site, já descartada)` : "";
  const twins = s.twins.length
    ? `\n🔁 ${s.twins.length} vaga(s) salva(s) eram a mesma de uma que você já enviou ou tem pacote: ${s.twins.map((t) => t.job.company).join(", ")}`
    : "";
  return `${s.added.length} novas${dup} · de ${s.found} encontradas; ${s.kept} passaram no filtro${twins}`;
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
    // Sem link, o texto identifica a vaga: colar o mesmo texto de novo é a mesma vaga; outro texto, outra vaga.
    url: input.url || `manual://texto/${shortHash(norm(description), 12)}`,
    tags: [],
    description,
  };
  // Colada pela pessoa: se parecer a mesma vaga de outra, entra normal e só fica marcada.
  const { added, known } = upsertJobs([raw], { keepNearDuplicates: true });
  const job = added[0];
  if (!job) {
    const same = known[0];
    throw new Error(same ? `Essa vaga já está cadastrada: ${same.company} — ${same.title} (${STATUS_LABELS[same.status]}).` : "Essa vaga já está cadastrada.");
  }
  if (job.duplicateOf) {
    const same = loadJobs().find((j) => j.id === job.duplicateOf);
    if (same) console.log(`⚠ Parece a mesma vaga que ${same.company} — ${same.title} (${STATUS_LABELS[same.status]}). Confira antes de gerar outro pacote.`);
  }
  return job;
}
