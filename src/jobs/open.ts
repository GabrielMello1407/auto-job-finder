import { settings } from "../config.js";
import type { Job, JobStatus, OpenCheck } from "../schemas.js";
import { track } from "../tracker.js";
import { norm } from "../util/text.js";
import { gupyJobData, jobPageText, jobPostingLd, visibleText } from "./page.js";
import { STATUS_LABELS } from "./status.js";
import { loadJobs, setStatus, updateJob } from "./store.js";

/*
 * A vaga ainda aceita candidaturas? Antes de gastar alguns minutos de IA num pacote (e antes de você
 * se candidatar), o agente abre o link da vaga e procura sinais de que ela acabou: página que não
 * existe mais, prazo de inscrição vencido, "vaga encerrada" escrito na página, link que agora leva
 * para a lista de vagas. Sem certeza, diz que não deu para conferir e segue: nunca bloqueia no escuro.
 */

type Verdict = Pick<OpenCheck, "verdict" | "reason">;
const open = (reason: string): Verdict => ({ verdict: "aberta", reason });
const closed = (reason: string): Verdict => ({ verdict: "encerrada", reason });
const unknown = (reason: string): Verdict => ({ verdict: "sem_confirmacao", reason });

/** Frases que dizem que a vaga acabou (comparadas sem acento e em minúsculas), com o texto mostrado a quem usa. */
const CLOSED_PHRASES: [RegExp, string][] = [
  [/\bvaga (foi )?(encerrada|expirada|fechada|finalizada)\b/, "vaga encerrada"],
  [/\bvaga nao (esta mais |se encontra mais )?(disponivel|encontrada)\b/, "vaga não está mais disponível"],
  [/\b(esta|essa) (vaga|oportunidade) nao esta mais\b/, "esta vaga não está mais disponível"],
  [/\b(inscricoes|candidaturas) (estao |foram )?encerradas\b/, "inscrições encerradas"],
  [/\bnao (esta mais )?(aceitando|aceita mais|recebendo) (novas )?candidaturas\b/, "não aceita mais candidaturas"],
  [/\bprocesso seletivo (foi )?encerrado\b/, "processo seletivo encerrado"],
  [/\boportunidade (foi )?encerrada\b/, "oportunidade encerrada"],
  [/\bno longer (accepting|taking|receiving) applications\b/, "no longer accepting applications"],
  [/\b(job|position|posting|vacancy|role|opening) (is |has been )?(no longer available|closed|filled|expired)\b/, "job closed"],
  [/\b(this|the) job (posting )?(has )?expired\b/, "job expired"],
  [/\bjob not found\b/, "job not found"],
  [/\bya no (esta|se encuentra) disponible\b/, "ya no está disponible"],
  [/\b(oferta|vacante|postulaciones?) (esta |estan )?(cerradas?|finalizadas?|expiradas?)\b/, "oferta cerrada"],
];

const brDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const DAY = 86_400_000;
const past = (iso: unknown, now: number) => typeof iso === "string" && iso.trim() !== "" && Date.parse(iso) + DAY < now;

function redirectVerdict(requested: string, final: string): Verdict | null {
  if (!final || final === requested) return null;
  let a: URL;
  let b: URL;
  try {
    a = new URL(requested);
    b = new URL(final);
  } catch {
    return null;
  }
  if (/[?&]error=/.test(b.search)) return closed("o link da vaga agora leva para a lista de vagas da empresa");
  if (/sign-?in|login|authwall|entrar/i.test(b.pathname)) return unknown("o site pediu login para mostrar a vaga");
  if (a.pathname.length > 1 && (b.pathname === "/" || b.pathname === "")) return closed("o link da vaga agora leva para a página inicial do site");
  return null;
}

/** Decide pela resposta do site (função pura, testada offline). */
export function pageVerdict(page: { status: number; requestedUrl: string; finalUrl: string; html: string }, now = Date.now()): Verdict {
  if (page.status === 404 || page.status === 410) return closed(`a página da vaga não existe mais (erro ${page.status})`);
  if (!page.status || page.status >= 400) return unknown(`o site não deixou conferir (erro ${page.status || "de conexão"})`);
  const moved = redirectVerdict(page.requestedUrl, page.finalUrl);
  if (moved) return moved;

  const gupy = gupyJobData(page.html);
  if (gupy && typeof gupy.status === "string") {
    if (gupy.status !== "published") return closed("a Gupy mostra a vaga como encerrada");
    if (past(gupy.registerEndDate, now)) return closed(`as inscrições terminaram em ${brDate(String(gupy.registerEndDate))}`);
    return open("a vaga está publicada na Gupy");
  }

  const posting = jobPostingLd(page.html);
  if (posting && past(posting.validThrough, now)) return closed(`as inscrições terminaram em ${brDate(String(posting.validThrough))}`);

  const title = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const text = norm(`${title}\n${visibleText(page.html).slice(0, 6000)}`);
  const phrase = CLOSED_PHRASES.find(([re]) => re.test(text));
  if (phrase) return closed(`a página diz “${phrase[1]}”`);
  if (posting) return open("a página da vaga está no ar");
  if (text.length < 300) return unknown("a página só mostra a vaga com login ou JavaScript");
  return open("a página da vaga está no ar");
}

/** O link que mostra a vaga: o da fonte, ou o anúncio oficial achado pela pesquisa na web. */
export function checkUrl(job: Job): string | undefined {
  return [job.url, job.research?.postingUrl, job.applyUrl].find((u) => typeof u === "string" && /^https?:\/\//i.test(u));
}

async function githubIssueVerdict(owner: string, repo: string, n: string): Promise<Verdict> {
  const headers: Record<string, string> = { "User-Agent": settings.userAgent, Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${n}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404 || res.status === 410) return closed("a vaga foi apagada do GitHub");
  if (!res.ok) return unknown(`o GitHub não deixou conferir (erro ${res.status})`);
  const issue = (await res.json()) as { state?: string };
  return issue.state === "closed" ? closed("a vaga foi fechada no repositório do GitHub") : open("a vaga continua aberta no repositório do GitHub");
}

/**
 * Abre o link da vaga e diz se ela ainda aceita candidaturas. Também devolve o texto da página
 * (o pacote usa para completar a descrição de vagas que chegaram só com um resumo).
 */
export async function checkJobOpen(job: Job): Promise<{ check: OpenCheck; pageText?: string }> {
  const at = new Date().toISOString();
  const url = checkUrl(job);
  if (!url) return { check: { at, ...unknown("a vaga não tem link para conferir") } };
  try {
    const gh = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (gh) return { check: { at, ...(await githubIssueVerdict(gh[1], gh[2], gh[3])) } };
    const res = await fetch(url, {
      headers: { "User-Agent": settings.userAgent, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const html = res.ok ? await res.text() : "";
    const verdict = pageVerdict({ status: res.status, requestedUrl: url, finalUrl: res.url, html });
    return { check: { at, ...verdict }, pageText: verdict.verdict === "aberta" ? jobPageText(html) : undefined };
  } catch (e) {
    const why = (e as Error).name === "TimeoutError" ? "o site demorou demais para responder" : `não consegui abrir o link (${(e as Error).message})`;
    return { check: { at, ...unknown(why) } };
  }
}

/** Vagas em que ainda faz sentido conferir: antes de se candidatar. */
export const CHECKABLE: JobStatus[] = ["new", "triaged", "shortlisted", "tailored", "low_fit"];
/** Sem pacote ainda: se a vaga acabou, sai de "Para decidir". Com pacote, só fica marcada. */
const DISCARD_WHEN_CLOSED: JobStatus[] = ["new", "triaged", "shortlisted"];

export const OPEN_ICON: Record<OpenCheck["verdict"], string> = { aberta: "✓", encerrada: "🔒", sem_confirmacao: "?" };

/** Guarda a conferência na vaga; sem pacote e encerrada, a vaga é descartada (dá para reabrir). */
export function recordOpenCheck(job: Job, check: OpenCheck, { discard = true } = {}): Job {
  let updated = updateJob(job.id, { openCheck: check });
  if (discard && check.verdict === "encerrada" && DISCARD_WHEN_CLOSED.includes(updated.status)) {
    updated = setStatus(job.id, "discarded");
    track(updated, "discarded", "", `vaga encerrada: ${check.reason}`);
  }
  return updated;
}

/**
 * Confere várias vagas (o `ajf conferir`): por padrão, todas que ainda não foram enviadas.
 * Algumas de cada vez, para não demorar nem sobrecarregar os sites.
 */
export async function checkOpenJobs(opts: { ids?: string[]; log?: (msg: string) => void } = {}) {
  const log = opts.log ?? console.log;
  const jobs = loadJobs().filter((j) => (opts.ids?.length ? opts.ids.includes(j.id) : CHECKABLE.includes(j.status)));
  const results: { job: Job; check: OpenCheck }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const { check } = await checkJobOpen(job);
      const updated = recordOpenCheck(job, check);
      results.push({ job: updated, check });
      log(`  ${OPEN_ICON[check.verdict]} ${job.company} — ${job.title}: ${check.reason}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  const count = (v: OpenCheck["verdict"]) => results.filter((r) => r.check.verdict === v).length;
  return {
    results,
    open: count("aberta"),
    closed: results.filter((r) => r.check.verdict === "encerrada").map((r) => r.job),
    unknown: count("sem_confirmacao"),
  };
}

/** "você se candidatou a uma vaga igual em 05/11/2026 (recusada)" ou "você gerou um pacote para uma vaga igual em ...". */
export function reopenedText(old: Job): string {
  const sent = ["applied", "interview", "offer", "rejected"].includes(old.status);
  const when = new Date(old.appliedAt ?? old.addedAt).toLocaleDateString("pt-BR");
  return `${sent ? "você se candidatou a uma vaga igual" : "você gerou um pacote para uma vaga igual"} em ${when} (${STATUS_LABELS[old.status]})`;
}

const OPEN_LABEL: Record<OpenCheck["verdict"], string> = { aberta: "aberta", encerrada: "parece encerrada", sem_confirmacao: "sem confirmação" };

/** Linhas de "vaga repetida" e "vaga encerrada" para os detalhes no terminal (`ajf show`, menu). */
export function jobFlags(job: Job, all: Job[] = loadJobs()): string[] {
  const out: string[] = [];
  const same = job.duplicateOf ? all.find((j) => j.id === job.duplicateOf) : undefined;
  if (same) out.push(`🔁 Parece a mesma vaga que ${same.company} — ${same.title} (${STATUS_LABELS[same.status]}, ${same.source}, ID ${same.id})`);
  const old = job.reopenedFrom ? all.find((j) => j.id === job.reopenedFrom) : undefined;
  if (old) out.push(`📨 Vaga reaberta: ${reopenedText(old)} (ID ${old.id}). Como foi há tempo, conta como vaga nova.`);
  const c = job.openCheck;
  if (c) out.push(`${OPEN_ICON[c.verdict]} Conferida em ${new Date(c.at).toLocaleDateString("pt-BR")}: ${OPEN_LABEL[c.verdict]} — ${c.reason}`);
  return out;
}

/** Resumo do `checkOpenJobs` para o terminal e para o log da interface. */
export function closedSummary(r: Awaited<ReturnType<typeof checkOpenJobs>>): string {
  const lines = [`${r.open} aberta(s) · ${r.closed.length} encerrada(s) · ${r.unknown} sem confirmação`];
  const kept = r.closed.filter((j) => j.status !== "discarded");
  if (r.closed.length > kept.length) lines.push(`As encerradas sem pacote foram para "Encerradas" (dá para reabrir).`);
  if (kept.length) lines.push(`Com pacote, ficaram onde estavam, marcadas como encerradas: ${kept.map((j) => j.company).join(", ")}.`);
  return lines.join("\n");
}
