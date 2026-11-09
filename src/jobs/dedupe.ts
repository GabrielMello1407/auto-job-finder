import { settings } from "../config.js";
import type { Job, JobStatus } from "../schemas.js";
import { norm } from "../util/text.js";
import { isWebSummary } from "./page.js";
import type { RawJob } from "./sources/index.js";

/*
 * Vaga repetida: a mesma vaga aparece em vários sites (Remotive e We Work Remotely, dois repositórios
 * do GitHub, o site da empresa e o LinkedIn), com o título escrito de um jeito diferente em cada um.
 * Tudo aqui é comparação de texto, sem IA: barato, previsível e igual para qualquer área.
 */

/** Parâmetros de link que só dizem de onde a pessoa veio: não mudam a vaga. */
const TRACKING =
  /^(utm_\w+|ref|refid|ref_src|ref_url|referer|referrer|src|source|trk|trkinfo|trackingid|tracking_id|gh_src|lever-source|lever-origin|lever-via|fbclid|gclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|jobboardsource|origin|campaign)$/i;

/** Número da vaga dentro do token da Gupy (`/job/eyJqb2JJZCI6...` é `{"jobId":123,"source":...}` em base64). */
function gupyIdFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const json = JSON.parse(Buffer.from(decodeURIComponent(token), "base64").toString("utf8"));
    return json?.jobId ? String(json.jobId) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Link na forma que identifica a vaga: sem rastreio (utm, ref...), sem "www.", sem barra no fim,
 * com os parâmetros que importam (ex.: `jk` do Indeed). LinkedIn, Gupy e Indeed escrevem o mesmo
 * anúncio de vários jeitos; aqui todos viram um só.
 */
export function canonicalUrl(raw: string): string {
  const s = (raw ?? "").trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return s;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const id = u.searchParams.get("currentJobId") ?? u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/)?.[1];
    if (id) return `https://linkedin.com/jobs/view/${id}`;
  }
  if (host.endsWith(".gupy.io")) {
    const id = u.pathname.match(/^\/jobs\/(\d+)/)?.[1] ?? gupyIdFromToken(u.pathname.match(/^\/job\/([^/]+)/)?.[1]);
    if (id) return `https://${host}/jobs/${id}`;
  }
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    const jk = u.searchParams.get("jk") ?? u.searchParams.get("vjk");
    if (jk) return `https://${host}/viewjob?jk=${jk}`;
  }

  const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : "";
  // "#/vagas/123" é rota de página feita em JavaScript: faz parte do endereço. "#topo" não.
  const hash = /^#!?\//.test(u.hash) ? u.hash : "";
  return `https://${host}${u.pathname.replace(/\/+$/, "")}${query}${hash}`;
}

/* ------------------------------- títulos ------------------------------- */

const SENIORITY: Record<string, string> = { sr: "senior", snr: "senior", jr: "junior", pl: "pleno" };
const STOPWORDS = new Set(
  "de da do das dos e a o as os em no na nos nas para com por of the and for in at to on with y el la los las en con del".split(" "),
);

/** Palavras do título, sem acento, pontuação, marca de gênero ("Desenvolvedor(a)") e com Sr/Jr/Pl por extenso. */
export function titleTokens(title: string): string[] {
  return norm(title)
    .replace(/\((?:a|o|as|os|e|es|x)\)/g, "")
    .replace(/\/(?:a|o|as|os)\b/g, "")
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean)
    .map((t) => SENIORITY[t] ?? t)
    .filter((t) => !STOPWORDS.has(t));
}

/** "full stack" × "fullstack", "front end" × "frontend": junta os pares que o outro título escreve colados. */
function joinPairs(tokens: string[], other: Set<string>): Set<string> {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i + 1 < tokens.length && other.has(tokens[i] + tokens[i + 1])) {
      out.push(tokens[i] + tokens[i + 1]);
      i++;
    } else out.push(tokens[i]);
  }
  return new Set(out);
}

/** Palavras de nível: "Software Engineer" e "Senior Software Engineer" com o mesmo texto são vagas diferentes. */
const LEVELS = new Set(
  "junior pleno senior staff principal lead lider head trainee estagio estagiario estagiaria intern internship especialista specialist mid entry i ii iii iv v".split(" "),
);
const levels = (tokens: string[]) => [...new Set(tokens.filter((t) => LEVELS.has(t)))].sort().join(" ");

/**
 * Títulos da mesma vaga: as palavras de um estão todas no outro ("Software Engineer, AI Coding Tasks"
 * e "... (Contract)"), ou quase todas batem, e o nível é o mesmo. Sozinho não basta: a empresa e a
 * descrição confirmam.
 */
export function similarTitles(x: string, y: string): boolean {
  const a = titleTokens(x);
  const b = titleTokens(y);
  if (!a.length || !b.length || levels(a) !== levels(b)) return false;
  const A = joinPairs(a, new Set(b));
  const B = joinPairs(b, new Set(a));
  const shared = [...A].filter((t) => B.has(t)).length;
  const smaller = Math.min(A.size, B.size);
  if (shared === A.size && shared === B.size) return true;
  if (smaller >= 2 && shared === smaller) return true;
  return shared / (A.size + B.size - shared) >= 0.8;
}

const squash = (title: string) => titleTokens(title).join("");

/* ------------------------------- empresas ------------------------------- */

const COMPANY_NOISE = new Set(
  "ltda sa s a inc llc ltd limited gmbh me eireli epp corp corporation co company group grupo holding brasil brazil the plc ag bv srl spa".split(" "),
);

export function companyKey(company: string): string {
  return norm(company)
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !COMPANY_NOISE.has(t))
    .join("");
}

/** Empresa que a fonte não informou ("(ver na vaga)", "Confidencial", "(empresa a confirmar)"). */
export function isPlaceholderCompany(company: string): boolean {
  const c = norm(company).replace(/[()[\]]/g, "").trim();
  return !c || /a confirmar|confidencia|ver na vaga|nao informad|nao divulgad|undisclosed|^n\/?a$|^empresa$|^-+$/.test(c);
}

/** "Stefanini Group" × "Stefanini", "Lemon.io" × "Lemon io", "Fluence International, Inc." × "Fluence". */
export function sameCompany(x: string, y: string): boolean {
  const a = companyKey(x);
  const b = companyKey(y);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
}

/* ------------------------------- descrições ------------------------------- */

const RESEARCH_MARK = "\n\n---\n\n## Pesquisa na web";
const MIN_WORDS = 60;

/**
 * Trechos de 3 palavras seguidas da descrição: comparar trechos pega o texto copiado, não só o assunto.
 * `null` quando não dá para comparar: descrição curta, ou resumo escrito pela IA na busca na web
 * (as palavras são outras, mesmo quando a vaga é a mesma).
 */
function shingles(description: string): Set<string> | null {
  if (isWebSummary(description)) return null;
  const words = norm(description.split(RESEARCH_MARK)[0])
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .slice(0, 3000);
  if (words.length < MIN_WORDS) return null;
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/** Quanto do texto menor aparece no maior (0 a 1). `null` quando uma das descrições é curta demais para comparar. */
export function textOverlap(a: Set<string> | null, b: Set<string> | null): number | null {
  if (!a || !b) return null;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (big.has(s)) shared++;
  return shared / small.size;
}

/** Mesmo texto com pequenas edições (ou um resumo do outro). Vagas diferentes da mesma empresa ficam bem abaixo. */
const SAME_TEXT = 0.6;
/** Sem empresa conhecida, o texto precisa bater mais. */
const SAME_TEXT_NO_COMPANY = 0.75;

/* ------------------------------- busca ------------------------------- */

export interface DuplicateMatch {
  job: Job;
  /**
   * link = mesmo endereço da vaga; mesma_vaga = mesma empresa, título e texto, em outro endereço;
   * reaberta = igual a uma que você já tratou, mas de muito tempo atrás (ou publicada depois da sua
   * candidatura): é uma vaga nova da mesma empresa, e `job` é a antiga.
   */
  how: "link" | "mesma_vaga" | "reaberta";
}

export interface FinderOptions {
  /** Dias em que a mesma vaga em outro link conta como repetida (padrão: AJF_REPEAT_WINDOW_DAYS, 90). */
  windowDays?: number;
  now?: number;
}

const DAY = 86_400_000;
/** Publicada pelo menos 14 dias depois da sua candidatura: é outra abertura, não o mesmo anúncio. */
const REPOST_MARGIN = 14 * DAY;

/** Quando você viu a vaga pela última vez: a candidatura, ou o dia em que ela foi salva. */
function lastSeen(job: Job): number {
  return Math.max(...[job.appliedAt, job.addedAt].map((d) => Date.parse(d ?? "")).filter(Number.isFinite), -Infinity);
}

/** Procura, entre as vagas salvas, a mesma vaga de uma vaga recém-encontrada. */
export class DuplicateFinder {
  private byUrl = new Map<string, Job>();
  private byId = new Map<string, Job>();
  private jobs: Job[] = [];
  private texts = new Map<string, Set<string> | null>();
  private windowMs: number;
  private now: number;

  constructor(jobs: Job[] = [], opts: FinderOptions = {}) {
    this.windowMs = (opts.windowDays ?? settings.repeatWindowDays) * DAY;
    this.now = opts.now ?? Date.now();
    for (const j of jobs) this.add(j);
  }

  /** A vaga achada é outra abertura da mesma vaga: a outra é de fora da janela, ou a achada foi publicada depois. */
  private reopened(raw: { postedAt?: string }, job: Job): boolean {
    const seen = lastSeen(job);
    if (!Number.isFinite(seen)) return false;
    if (this.now - seen > this.windowMs) return true;
    const posted = Date.parse(raw.postedAt ?? "");
    return Number.isFinite(posted) && posted > seen + REPOST_MARGIN;
  }

  add(job: Job) {
    const url = canonicalUrl(job.url);
    if (url && !this.byUrl.has(url)) this.byUrl.set(url, job);
    this.byId.set(job.id, job);
    this.jobs.push(job);
  }

  private text(job: Job) {
    if (!this.texts.has(job.id)) this.texts.set(job.id, shingles(job.description));
    return this.texts.get(job.id)!;
  }

  /** A vaga original: se a achada já era repetida de outra, aponta para a primeira. */
  private root(job: Job): Job {
    return (job.duplicateOf && this.byId.get(job.duplicateOf)) || job;
  }

  find(raw: Pick<RawJob, "url" | "title" | "company" | "description" | "postedAt">): DuplicateMatch | null {
    // Mesmo link é o mesmo anúncio, não importa quando.
    const sameLink = this.byUrl.get(canonicalUrl(raw.url));
    if (sameLink) return { job: sameLink, how: "link" };

    const unknownCompany = isPlaceholderCompany(raw.company);
    let text: Set<string> | null | undefined;
    let reopenedFrom: Job | undefined;
    for (const job of this.jobs) {
      const company = unknownCompany || isPlaceholderCompany(job.company) ? null : sameCompany(raw.company, job.company);
      if (company === false || !similarTitles(raw.title, job.title)) continue;
      text ??= shingles(raw.description);
      const overlap = textOverlap(text, this.text(job));
      // Mesma empresa e o mesmo título: é a mesma vaga quando não dá para comparar o texto (curto ou
      // resumo da busca web), ou quando você já tratou a outra (pacote, candidatura, recusa) — repetir
      // uma candidatura custa mais que esconder uma vaga, que dá para reabrir.
      const same =
        (company && squash(raw.title) === squash(job.title) && (overlap == null || HANDLED.has(job.status))) ||
        (overlap != null && overlap >= (company ? SAME_TEXT : SAME_TEXT_NO_COMPANY));
      if (!same) continue;
      // A outra é de muito tempo atrás (ou a achada foi publicada depois): a empresa abriu a vaga de novo.
      if (this.reopened(raw, job)) {
        const root = this.root(job);
        if (HANDLED.has(root.status)) reopenedFrom ??= root;
        continue;
      }
      return { job: this.root(job), how: "mesma_vaga" };
    }
    return reopenedFrom ? { job: reopenedFrom, how: "reaberta" } : null;
  }
}

/** Vagas que você já tratou: com pacote, enviadas, em entrevista, com oferta ou recusadas. */
export const HANDLED = new Set<JobStatus>(["tailored", "low_fit", "applied", "interview", "offer", "rejected"]);

/**
 * A mesma vaga, entre as que você já tratou (pacote ou candidatura). O piloto automático confere de
 * novo antes de cada pacote: pega o que escapou na busca e as repetidas salvas antes desta checagem existir.
 */
export function handledTwin(job: Job, jobs: Job[], opts: FinderOptions = {}): Job | null {
  const m = handledMatch(job, jobs, opts);
  return m?.how === "reaberta" ? null : (m?.job ?? null);
}

function handledMatch(job: Job, jobs: Job[], opts: FinderOptions): DuplicateMatch | null {
  if (job.notDuplicate) return null;
  return new DuplicateFinder(jobs.filter((j) => j.id !== job.id && HANDLED.has(j.status)), opts).find(job);
}

const SENT = new Set<JobStatus>(["applied", "interview", "offer", "rejected"]);
const OPEN = new Set<JobStatus>(["new", "triaged", "shortlisted", "tailored", "low_fit"]);

/**
 * Vagas salvas (ainda não enviadas) que são a mesma de uma que você já tratou. Entre duas com pacote,
 * a mais nova é a repetida; uma já enviada é sempre a original. Quem você reabriu não entra.
 * `reopened` = é igual, mas de outra abertura (ver `DuplicateMatch.how`): só ganha o aviso.
 */
export function handledTwins(jobs: Job[], opts: FinderOptions = {}): { job: Job; twin: Job; reopened: boolean }[] {
  const out: { job: Job; twin: Job; reopened: boolean }[] = [];
  for (const job of jobs) {
    if (job.duplicateOf || job.notDuplicate || !OPEN.has(job.status)) continue;
    const m = handledMatch(job, jobs, opts);
    if (!m) continue;
    if (m.how === "reaberta") {
      if (!job.reopenedFrom) out.push({ job, twin: m.job, reopened: true });
    } else if (SENT.has(m.job.status) || m.job.addedAt < job.addedAt) out.push({ job, twin: m.job, reopened: false });
  }
  return out;
}
