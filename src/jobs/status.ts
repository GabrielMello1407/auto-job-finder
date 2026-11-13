import fs from "node:fs";
import path from "node:path";
import { input, search, select } from "@inquirer/prompts";
import type { ApplyVia, Job, JobStatus, RejectionStage } from "../schemas.js";
import { track } from "../tracker.js";
import { norm } from "../util/text.js";
import { loadJobs, setStatus, updateJob } from "./store.js";

/** Todos os status, com o nome mostrado ao usuário (o Record obriga a listar todos). */
export const STATUS_LABELS: Record<JobStatus, string> = {
  new: "aguardando triagem",
  triaged: "avaliada",
  shortlisted: "recomendada",
  tailored: "pacote pronto",
  low_fit: "pacote com baixa aderência",
  applied: "enviada",
  interview: "entrevista",
  rejected: "recusada",
  offer: "oferta",
  discarded: "descartada",
};

export const isStatus = (s: string | undefined): s is JobStatus => Boolean(s && s in STATUS_LABELS);

/** Vagas em que ainda faz sentido marcar "enviei", na ordem em que aparecem na lista. */
export const SENDABLE: JobStatus[] = ["tailored", "low_fit", "shortlisted", "triaged", "new"];

/**
 * Acha vagas por ID (ou começo do ID) ou por texto: todas as palavras da busca precisam aparecer
 * na empresa ou no cargo, sem diferenciar maiúsculas e acentos.
 */
export function matchJobs(jobs: Job[], query: string): Job[] {
  const q = query.trim();
  if (!q) return jobs;
  const byId = jobs.filter((j) => j.id === q || j.id.startsWith(q));
  if (byId.length) return byId;
  const words = norm(q).split(" ").filter(Boolean);
  return jobs.filter((j) => {
    const text = norm(`${j.company} ${j.title}`);
    return words.every((w) => text.includes(w));
  });
}

const choiceName = (j: Job) => {
  const score = j.rating != null ? `nota ${j.rating}` : j.triage ? `triagem ${j.triage.score}` : "";
  return `${j.company} — ${j.title}${score ? `  (${score})` : ""}`;
};

/**
 * Escolhe uma vaga sem precisar do ID: se a busca achar uma só, usa direto; senão abre uma lista
 * em que dá para digitar parte do nome da empresa ou do cargo.
 */
export async function pickJob(opts: { query?: string; statuses?: JobStatus[]; message: string }): Promise<Job> {
  const all = loadJobs();
  const rank = (j: Job) => (opts.statuses ? opts.statuses.indexOf(j.status) : 0);
  const pool = all
    .filter((j) => !opts.statuses || opts.statuses.includes(j.status))
    .sort((a, b) => rank(a) - rank(b) || (b.rating ?? 0) - (a.rating ?? 0) || (b.triage?.score ?? 0) - (a.triage?.score ?? 0));

  let options = pool;
  if (opts.query?.trim()) {
    // Procura primeiro nas vagas da lista; se não achar, em todas (ex.: vaga já descartada).
    const found = matchJobs(pool, opts.query);
    options = found.length ? found : matchJobs(all, opts.query);
    if (options.length === 1) return options[0];
    if (!options.length) {
      console.log(`Nenhuma vaga com "${opts.query}". Escolha na lista:`);
      options = pool;
    }
  }
  if (!options.length) throw new Error("Nenhuma vaga para escolher. Rode a busca primeiro ('ajf auto').");
  if (!process.stdin.isTTY)
    throw new Error(`Mais de uma vaga encontrada. Use o ID:\n${options.slice(0, 15).map((j) => `  ${j.id}  ${choiceName(j)}`).join("\n")}`);

  return search<Job>({
    message: `${opts.message} (digite parte da empresa ou do cargo)`,
    pageSize: 15,
    source: (term) =>
      matchJobs(options, term ?? "").map((j) => ({ name: choiceName(j), value: j, description: `${STATUS_LABELS[j.status]} · ${j.id}` })),
  });
}

/** Por onde a pessoa se candidatou, com o nome mostrado ("Enviada via e-mail"). */
export const APPLY_CHANNELS: Record<ApplyVia, string> = {
  plataforma: "plataforma de vagas",
  email: "e-mail",
  linkedin: "LinkedIn",
  site: "site da empresa",
  whatsapp: "WhatsApp",
  indicacao: "indicação",
  outro: "outro canal",
};
export const isApplyVia = (s: unknown): s is ApplyVia => typeof s === "string" && s in APPLY_CHANNELS;

/** Sites de recrutamento: o link da vaga leva para um formulário de plataforma. */
const PLATFORM_HOSTS =
  /(gupy\.io|inhire\.app|quickin\.io|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|solides\.com\.br|kenoby\.com|recrutei\.com\.br|pandape|breezy\.hr|recruitee\.com|smartrecruiters\.com|myworkdayjobs\.com|teamtailor\.com|join\.com|wellfound\.com|indeed\.|catho\.com|infojobs\.|vagas\.com|programathor\.com|bamboohr\.com|jobvite\.com|icims\.com)/i;

/**
 * Canal provável da candidatura, para já vir marcado no "Já me candidatei": o que a análise da vaga
 * achou (pacote), senão o site do link da vaga.
 */
export function guessApplyVia(job: Job): ApplyVia | undefined {
  if (job.outputDir) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(job.outputDir, "analysis.json"), "utf8")) as { analysis?: { applyChannel?: string } };
      const c = meta.analysis?.applyChannel;
      if (isApplyVia(c)) return c;
    } catch {
      /* sem análise: decide pelo link */
    }
  }
  const url = job.applyUrl ?? job.research?.postingUrl ?? job.url;
  if (/linkedin\.com/i.test(url)) return "linkedin";
  if (PLATFORM_HOSTS.test(url)) return "plataforma";
  return undefined;
}

/**
 * Muda o status, registra no tracker.csv e devolve a vaga atualizada. Ao marcar como enviada, guarda o
 * canal. Na recusa guarda a etapa e o motivo (`outcome`), e a primeira resposta da empresa fica em
 * `respondedAt` (entrevista, oferta ou recusa com retorno), para o funil (src/jobs/funnel.ts).
 */
export function changeStatus(
  job: Job,
  status: JobStatus,
  note = "",
  next?: string,
  via?: ApplyVia,
  outcome?: { stage: RejectionStage; reason?: string },
): Job {
  const now = new Date().toISOString();
  const extra: Partial<Job> = {};
  if (status === "applied" && via) extra.appliedVia = via;
  if (status === "rejected") extra.outcome = { stage: outcome?.stage ?? "desconhecida", ...(outcome?.reason?.trim() ? { reason: outcome.reason.trim() } : {}), at: now };
  // Saiu de "recusada" (reabriu): a etapa da recusa não vale mais.
  else if (job.outcome) extra.outcome = undefined;
  const responded = status === "interview" || status === "offer" || (status === "rejected" && extra.outcome?.stage !== "sem_resposta");
  if (responded && job.appliedAt && !job.respondedAt) extra.respondedAt = now;
  const updated = setStatus(job.id, status, note || undefined, extra);
  const trackNote = [
    status === "applied" && via ? `via ${APPLY_CHANNELS[via]}` : "",
    status === "rejected" && extra.outcome ? `etapa: ${extra.outcome.stage}${extra.outcome.reason ? ` (${extra.outcome.reason})` : ""}` : "",
    note,
  ]
    .filter(Boolean)
    .join(" · ");
  track(updated, status, next ?? (status === "applied" ? "follow-up em 5–7 dias úteis" : ""), trackNote);
  return updated;
}

/** Registra um follow-up enviado (conta para o próximo lembrete) no jobs.json e no tracker.csv. */
export function recordFollowUp(job: Job): Job {
  const updated = updateJob(job.id, { followUps: [...(job.followUps ?? []), new Date().toISOString()] });
  track(updated, updated.status, "", `follow-up nº ${updated.followUps!.length} enviado`);
  return updated;
}

/** Fluxo "enviei": escolhe a vaga, pergunta por onde foi e a observação (se não vieram) e marca como enviada. */
export async function markApplied(query?: string, note?: string, via?: ApplyVia): Promise<Job> {
  const job = await pickJob({ query, statuses: SENDABLE, message: "Em qual vaga você se candidatou?" });
  if (job.status === "applied" || job.status === "interview" || job.status === "offer") {
    const when = job.appliedAt ? ` em ${new Date(job.appliedAt).toLocaleDateString("pt-BR")}` : "";
    console.log(`ℹ ${job.company} — ${job.title} já está como ${STATUS_LABELS[job.status]}${when}. Nada mudou (use 'ajf status' para mudar).`);
    return job;
  }
  const guess = guessApplyVia(job);
  const channel =
    via ??
    (process.stdin.isTTY
      ? await select<ApplyVia | "">({
          message: "Por onde você se candidatou?",
          default: guess ?? "",
          choices: [...(Object.entries(APPLY_CHANNELS) as [ApplyVia, string][]).map(([value, name]) => ({ name, value })), { name: "Pular", value: "" as const }],
        })
      : guess);
  const obs = note ?? (process.stdin.isTTY ? await input({ message: "Observação (ex.: 'indicação do Fulano'). Enter para pular:" }) : "");
  const updated = changeStatus(job, "applied", obs, undefined, channel || undefined);
  console.log(`✅ ${updated.company} — ${updated.title} marcada como enviada${channel ? ` via ${APPLY_CHANNELS[channel]}` : ""}. Lembre do follow-up em 5–7 dias úteis.`);
  return updated;
}
