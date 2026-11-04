import { loadExcluded, type Preferences } from "../profile.js";
import { norm } from "../util/text.js";
import type { RawJob } from "./sources/index.js";

export interface FilterResult {
  kept: RawJob[];
  dropped: { job: RawJob; reason: string }[];
}

const WORLDWIDE = ["worldwide", "anywhere", "global", "remote", "remoto"];

function excludedCompaniesFromFile(): string[] {
  return loadExcluded()
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((l) => l.match(/^\s*-\s*(?:empresa:\s*)?([^—|#(]+)/i)?.[1]?.trim())
    .filter((x): x is string => Boolean(x))
    .map(norm);
}

/** Filtro determinístico e barato, antes de gastar tokens com a triagem por IA. */
export function prefilter(raw: RawJob[], prefs: Preferences): FilterResult {
  const must = prefs.titleMustInclude.map(norm);
  const exclude = prefs.titleExclude.map(norm);
  const companies = [...prefs.excludedCompanies.map(norm), ...excludedCompaniesFromFile()];
  const regions = prefs.acceptedRegions.map(norm);
  const minDate = Date.now() - prefs.maxAgeDays * 86400_000;

  const kept: RawJob[] = [];
  const dropped: FilterResult["dropped"] = [];

  for (const job of raw) {
    const title = ` ${norm(job.title)} `;
    const drop = (reason: string) => dropped.push({ job, reason });

    if (must.length && !must.some((m) => title.includes(m))) {
      drop("título fora dos cargos-alvo");
      continue;
    }
    const ex = exclude.find((e) => title.includes(` ${e} `) || title.includes(` ${e},`));
    if (ex) {
      drop(`título contém '${ex}'`);
      continue;
    }
    if (companies.some((c) => c && norm(job.company).includes(c))) {
      drop("empresa excluída");
      continue;
    }
    if (job.postedAt && !Number.isNaN(Date.parse(job.postedAt)) && Date.parse(job.postedAt) < minDate) {
      drop(`publicada há mais de ${prefs.maxAgeDays} dias`);
      continue;
    }
    // Presencial/híbrida: só nas cidades aceitas. Local vago ("Híbrido", "Brasil") segue para a triagem decidir.
    if (job.remote === false) {
      const loc = norm(job.location);
      const vague = !loc || /^(brasil|brazil|hibrido|presencial|on-?site|hybrid)$/.test(loc);
      const cityOk = prefs.onsiteCities.some((c) => loc.includes(norm(c)));
      if (!vague && !cityOk) {
        drop(`presencial/híbrida em ${job.location}`);
        continue;
      }
    }
    const restrictions = (job.locationRestrictions ?? []).map(norm).filter(Boolean);
    if (restrictions.length) {
      const ok = restrictions.some(
        (r) =>
          r === "remote" ||
          r === "remoto" ||
          WORLDWIDE.slice(0, 3).some((w) => r.includes(w)) ||
          regions.some((g) => r.includes(g) || (r.length >= 4 && g.includes(r))),
      );
      if (!ok) {
        drop(`restrita a ${job.locationRestrictions!.join(", ")}`);
        continue;
      }
    }
    kept.push(job);
  }
  return { kept, dropped };
}
