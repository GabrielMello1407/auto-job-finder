import { settings } from "../../config.js";
import type { Job } from "../../schemas.js";
import { htmlToText, shortHash } from "../../util/text.js";
import { getonbrd, githubBr, jobicy, weworkremotely } from "./extra.js";

export type RawJob = Omit<Job, "id" | "addedAt" | "status">;

export interface SourceContext {
  queries: string[];
  companyBoards: { greenhouse: string[]; lever: string[]; ashby: string[] };
}

export interface JobSource {
  name: string;
  description: string;
  fetch(ctx: SourceContext): Promise<RawJob[]>;
}

export function jobId(url: string): string {
  return shortHash(url.replace(/[?#].*$/, ""));
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": settings.userAgent, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${url}`);
  return (await res.json()) as T;
}

const isoFromUnix = (s: number | string | undefined) =>
  s ? new Date(Number(s) * (String(s).length <= 10 ? 1000 : 1)).toISOString() : undefined;

/* --------------------------- Remotive --------------------------- */
// https://remotive.com/api/remote-jobs — exige link de volta para a vaga (usamos a URL original).
const remotive: JobSource = {
  name: "remotive",
  description: "Remotive (vagas remotas internacionais, API pública)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const data = await getJson<{ jobs: any[] }>(
        `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`,
      );
      for (const j of data.jobs ?? []) {
        out.push({
          source: "remotive",
          title: j.title,
          company: j.company_name,
          location: j.candidate_required_location || "Remote",
          remote: true,
          url: j.url,
          postedAt: j.publication_date,
          salary: j.salary || undefined,
          tags: j.tags ?? [],
          description: htmlToText(j.description ?? ""),
          locationRestrictions: j.candidate_required_location ? [j.candidate_required_location] : [],
        });
      }
    }
    return out;
  },
};

/* --------------------------- Himalayas --------------------------- */
const himalayas: JobSource = {
  name: "himalayas",
  description: "Himalayas (vagas remotas, API pública com restrição de país)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const data = await getJson<{ jobs: any[] }>(
        `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(q)}&sort=recent`,
      );
      for (const j of data.jobs ?? []) {
        const salary =
          j.minSalary && j.maxSalary ? `${j.currency ?? ""} ${j.minSalary}–${j.maxSalary}/${j.salaryPeriod ?? ""}` : undefined;
        out.push({
          source: "himalayas",
          title: j.title,
          company: j.companyName,
          location: (j.locationRestrictions ?? []).join(", ") || "Remote (worldwide)",
          remote: true,
          url: j.applicationLink || j.guid,
          postedAt: isoFromUnix(j.pubDate),
          salary,
          tags: [...(j.categories ?? []), ...(j.seniority ?? [])],
          description: htmlToText(j.description ?? j.excerpt ?? ""),
          locationRestrictions: j.locationRestrictions ?? [],
        });
      }
    }
    return out;
  },
};

/* --------------------------- Remote OK --------------------------- */
// Termos de uso: citar "Remote OK" como fonte e linkar a vaga.
const remoteok: JobSource = {
  name: "remoteok",
  description: "Remote OK (vagas remotas, API pública por tag)",
  async fetch(ctx) {
    const tags = new Set(
      ctx.queries.flatMap((q) => q.toLowerCase().split(/\s+/)).filter((t) => /^[a-z.+#-]{2,}$/.test(t)),
    );
    const out: RawJob[] = [];
    for (const tag of [...tags].slice(0, 6)) {
      const data = await getJson<any[]>(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`);
      for (const j of data.slice(1)) {
        if (!j?.position) continue;
        out.push({
          source: "remoteok",
          title: j.position,
          company: j.company,
          location: j.location || "Remote",
          remote: true,
          url: j.url,
          applyUrl: j.apply_url,
          postedAt: j.date,
          salary: j.salary_min ? `USD ${j.salary_min}–${j.salary_max}` : undefined,
          tags: j.tags ?? [],
          description: htmlToText(j.description ?? ""),
          locationRestrictions: j.location ? [j.location] : [],
        });
      }
    }
    return out;
  },
};

/* --------------------------- Arbeitnow --------------------------- */
const arbeitnow: JobSource = {
  name: "arbeitnow",
  description: "Arbeitnow (Europa/remoto, API pública)",
  async fetch(ctx) {
    const data = await getJson<{ data: any[] }>("https://www.arbeitnow.com/api/job-board-api");
    const terms = ctx.queries.map((q) => q.toLowerCase());
    return (data.data ?? [])
      .filter((j) => terms.some((t) => `${j.title} ${(j.tags ?? []).join(" ")}`.toLowerCase().includes(t.split(" ")[0])))
      .map((j) => ({
        source: "arbeitnow",
        title: j.title,
        company: j.company_name,
        location: j.location || (j.remote ? "Remote" : ""),
        remote: Boolean(j.remote),
        url: j.url,
        postedAt: isoFromUnix(j.created_at),
        tags: j.tags ?? [],
        description: htmlToText(j.description ?? ""),
      }));
  },
};

/* ------------------ Greenhouse / Lever / Ashby ------------------ */
// Páginas de carreira de empresas específicas (configure em preferences.json → companyBoards).
const greenhouse: JobSource = {
  name: "greenhouse",
  description: "Greenhouse (empresas configuradas em companyBoards.greenhouse)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const board of ctx.companyBoards.greenhouse) {
      const data = await getJson<{ jobs: any[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
      );
      for (const j of data.jobs ?? []) {
        out.push({
          source: "greenhouse",
          title: j.title,
          company: j.company_name || board,
          location: j.location?.name ?? "",
          remote: /remote/i.test(j.location?.name ?? "") ? true : null,
          url: j.absolute_url,
          postedAt: j.updated_at,
          tags: (j.departments ?? []).map((d: any) => d.name),
          description: htmlToText(j.content ?? ""),
        });
      }
    }
    return out;
  },
};

const lever: JobSource = {
  name: "lever",
  description: "Lever (empresas configuradas em companyBoards.lever)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const board of ctx.companyBoards.lever) {
      const data = await getJson<any[]>(`https://api.lever.co/v0/postings/${board}?mode=json`);
      for (const j of data) {
        const lists = (j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content ?? "")}`).join("\n\n");
        out.push({
          source: "lever",
          title: j.text,
          company: board,
          location: j.categories?.location ?? "",
          remote: j.workplaceType ? j.workplaceType === "remote" : null,
          url: j.hostedUrl,
          applyUrl: j.applyUrl,
          postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
          tags: [j.categories?.team, j.categories?.commitment].filter(Boolean),
          description: `${j.descriptionPlain ?? ""}\n\n${lists}\n\n${j.additionalPlain ?? ""}`.trim(),
        });
      }
    }
    return out;
  },
};

const ashby: JobSource = {
  name: "ashby",
  description: "Ashby (empresas configuradas em companyBoards.ashby)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const board of ctx.companyBoards.ashby) {
      const data = await getJson<{ jobs: any[] }>(
        `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
      );
      for (const j of data.jobs ?? []) {
        out.push({
          source: "ashby",
          title: j.title,
          company: board,
          location: [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean).join(" / "),
          remote: typeof j.isRemote === "boolean" ? j.isRemote : null,
          url: j.jobUrl,
          applyUrl: j.applyUrl,
          postedAt: j.publishedAt,
          salary: j.compensation?.compensationTierSummary || undefined,
          tags: [j.department, j.team, j.employmentType].filter(Boolean),
          description: j.descriptionPlain || htmlToText(j.descriptionHtml ?? ""),
        });
      }
    }
    return out;
  },
};

export const SOURCES: Record<string, JobSource> = {
  "github-br": githubBr,
  getonbrd,
  jobicy,
  weworkremotely,
  remotive,
  himalayas,
  remoteok,
  arbeitnow,
  greenhouse,
  lever,
  ashby,
};
