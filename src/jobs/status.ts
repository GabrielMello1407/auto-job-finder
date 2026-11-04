import { input, search } from "@inquirer/prompts";
import type { Job, JobStatus } from "../schemas.js";
import { track } from "../tracker.js";
import { norm } from "../util/text.js";
import { loadJobs, setStatus } from "./store.js";

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

/** Muda o status, registra no tracker.csv e devolve a vaga atualizada. */
export function changeStatus(job: Job, status: JobStatus, note = "", next?: string): Job {
  const updated = setStatus(job.id, status, note || undefined);
  track(updated, status, next ?? (status === "applied" ? "follow-up em 5–7 dias úteis" : ""), note);
  return updated;
}

/** Fluxo "enviei": escolhe a vaga, pergunta a observação (se não veio) e marca como enviada. */
export async function markApplied(query?: string, note?: string): Promise<Job> {
  const job = await pickJob({ query, statuses: SENDABLE, message: "Em qual vaga você se candidatou?" });
  if (job.status === "applied" || job.status === "interview" || job.status === "offer") {
    const when = job.appliedAt ? ` em ${new Date(job.appliedAt).toLocaleDateString("pt-BR")}` : "";
    console.log(`ℹ ${job.company} — ${job.title} já está como ${STATUS_LABELS[job.status]}${when}. Nada mudou (use 'ajf status' para mudar).`);
    return job;
  }
  const obs = note ?? (process.stdin.isTTY ? await input({ message: "Observação (ex.: 'via Gupy'). Enter para pular:" }) : "");
  const updated = changeStatus(job, "applied", obs);
  console.log(`✅ ${updated.company} — ${updated.title} marcada como enviada. Lembre do follow-up em 5–7 dias úteis.`);
  return updated;
}
