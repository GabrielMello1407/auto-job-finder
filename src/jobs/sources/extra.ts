import { settings } from "../../config.js";
import { decodeEntities, htmlToText } from "../../util/text.js";
import type { JobSource, RawJob } from "./index.js";

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": settings.userAgent, ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} em ${url}`);
  return res;
}

/* ---------------------- Repositórios de vagas BR no GitHub ---------------------- */
// Comunidades brasileiras publicam vagas como issues: backend-br, frontendbr, react-brasil.
// Sem token: 60 req/h (suficiente). Com GITHUB_TOKEN no .env: 5000 req/h.
const GITHUB_BOARDS = ["backend-br/vagas", "frontendbr/vagas", "react-brasil/vagas"];

function parseGithubTitle(title: string): { location: string; title: string; company: string } {
  const loc = title.match(/^\s*\[([^\]]+)\]/)?.[1] ?? "";
  let rest = title.replace(/^\s*(\[[^\]]+\]\s*)+/, "").trim();
  let company = "";
  const na = rest.match(/\s+(?:na|no|@|at)\s+([^|—–-]+?)(?:\s*[|—–-].*)?$/i);
  if (na) {
    company = na[1].trim();
    rest = rest.slice(0, na.index).trim();
  } else {
    // "Desenvolvedor Fullstack Pleno - Java & Angular - DB1" → empresa = último trecho curto
    const parts = rest.split(/\s+[-–—|]\s+/);
    const last = parts[parts.length - 1];
    if (parts.length >= 2 && last.length <= 30 && !/pleno|s[eê]nior|j[uú]nior|remoto|h[ií]brido/i.test(last)) {
      company = last.replace(/^\(|\)$/g, "").trim();
      rest = parts.slice(0, -1).join(" - ");
    }
  }
  return { location: loc, title: rest.replace(/\s*[|—–]\s*$/, ""), company };
}

export const _test = { parseGithubTitle };

export const githubBr: JobSource = {
  name: "github-br",
  description: "Vagas das comunidades brasileiras no GitHub (backend-br, frontendbr, react-brasil)",
  async fetch() {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const out: RawJob[] = [];
    for (const repo of GITHUB_BOARDS) {
      const issues = (await (await get(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100&since=${since}`, headers)).json()) as any[];
      for (const i of issues) {
        if (i.pull_request) continue;
        const labels: string[] = (i.labels ?? []).map((l: any) => l.name);
        const p = parseGithubTitle(i.title);
        const remote = labels.some((l) => /remoto/i.test(l)) || /remoto|remote/i.test(p.location);
        out.push({
          source: `github:${repo.split("/")[0]}`,
          title: p.title,
          company: p.company || "(ver na vaga)",
          location: p.location || "Brasil",
          remote,
          url: i.html_url,
          postedAt: i.created_at,
          tags: labels,
          description: `${i.title}\nEtiquetas: ${labels.join(", ")}\n\n${i.body ?? ""}`.slice(0, 20000),
        });
      }
    }
    return out;
  },
};

/* ---------------------- Get on Board (América Latina) ---------------------- */
export const getonbrd: JobSource = {
  name: "getonbrd",
  description: "Get on Board (vagas de tecnologia na América Latina, muitas remotas)",
  async fetch(ctx) {
    const out: RawJob[] = [];
    for (const q of ctx.queries) {
      const data = (await (
        await get(`https://www.getonbrd.com/api/v0/search/jobs?query=${encodeURIComponent(q)}&per_page=50&expand=%5B%22company%22%5D`)
      ).json()) as { data: any[] };
      for (const j of data.data ?? []) {
        const a = j.attributes;
        const countries: string[] = a.countries ?? [];
        const desc = [a.description, a.functions_headline, a.functions, a.desirable_headline, a.desirable, a.benefits]
          .filter(Boolean)
          .map((x: string) => htmlToText(x))
          .join("\n\n");
        out.push({
          source: "getonbrd",
          title: a.title,
          company: a.company?.data?.attributes?.name ?? "(ver na vaga)",
          location: countries.join(", ") || (a.remote ? "Remote" : ""),
          remote: Boolean(a.remote),
          url: j.links?.public_url,
          postedAt: a.published_at ? new Date(Number(a.published_at) * 1000).toISOString() : undefined,
          salary: a.min_salary ? `USD ${a.min_salary}–${a.max_salary}/mês` : undefined,
          tags: [a.remote_modality, a.lang].filter(Boolean),
          description: desc,
          locationRestrictions: a.remote_modality === "fully_remote" && countries.includes("Remote") ? [] : countries,
        });
      }
    }
    return out;
  },
};

/* ---------------------- Jobicy (remoto) ---------------------- */
// Termos de uso: creditar Jobicy e candidatar pelo link original (guardamos o link).
export const jobicy: JobSource = {
  name: "jobicy",
  description: "Jobicy (vagas remotas, API pública)",
  async fetch(ctx) {
    const tags = [...new Set(ctx.queries.flatMap((q) => q.toLowerCase().split(/\s+/)).filter((t) => /^[a-z.+#-]{3,}$/.test(t)))];
    const out: RawJob[] = [];
    for (const tag of tags.slice(0, 6)) {
      const data = (await (await get(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`)).json()) as { jobs?: any[] };
      for (const j of data.jobs ?? []) {
        out.push({
          source: "jobicy",
          title: decodeEntities(j.jobTitle),
          company: j.companyName,
          location: j.jobGeo || "Remote",
          remote: true,
          url: j.url,
          postedAt: j.pubDate,
          salary: j.annualSalaryMin ? `${j.salaryCurrency ?? ""} ${j.annualSalaryMin}–${j.annualSalaryMax}/ano` : undefined,
          tags: [...(j.jobIndustry ?? []), j.jobLevel].filter(Boolean),
          description: htmlToText(j.jobDescription ?? j.jobExcerpt ?? ""),
          locationRestrictions: j.jobGeo && !/anywhere/i.test(j.jobGeo) ? String(j.jobGeo).split(/,\s*/) : [],
        });
      }
    }
    return out;
  },
};

/* ---------------------- We Work Remotely (RSS) ---------------------- */
const WWR_FEEDS = [
  "remote-full-stack-programming-jobs",
  "remote-back-end-programming-jobs",
  "remote-front-end-programming-jobs",
];

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : "";
}

export const weworkremotely: JobSource = {
  name: "weworkremotely",
  description: "We Work Remotely (RSS de full stack, back-end e front-end)",
  async fetch() {
    const out: RawJob[] = [];
    for (const feed of WWR_FEEDS) {
      const xml = await (await get(`https://weworkremotely.com/categories/${feed}.rss`)).text();
      for (const item of xml.split("<item>").slice(1)) {
        const rawTitle = decodeEntities(tag(item, "title"));
        const [company, ...rest] = rawTitle.split(":");
        const region = decodeEntities(tag(item, "region"));
        out.push({
          source: "weworkremotely",
          title: rest.join(":").trim() || rawTitle,
          company: rest.length ? company.trim() : "(ver na vaga)",
          location: region || "Remote",
          remote: true,
          url: tag(item, "link"),
          postedAt: tag(item, "pubDate") ? new Date(tag(item, "pubDate")).toISOString() : undefined,
          tags: [],
          description: htmlToText(decodeEntities(tag(item, "description"))),
          locationRestrictions: region && !/anywhere/i.test(region) ? region.split(/,\s*/) : [],
        });
      }
    }
    return out;
  },
};
