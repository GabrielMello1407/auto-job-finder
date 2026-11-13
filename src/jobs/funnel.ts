import { z } from "zod";
import { settings } from "../config.js";
import { structured } from "../llm.js";
import type { Job, JobStatus, RejectionStage } from "../schemas.js";
import { truncate } from "../util/text.js";
import { APPLY_CHANNELS } from "./status.js";

/**
 * Funil das candidaturas: o que aconteceu com cada uma e o que funciona melhor (canal, fonte, quanto
 * tempo depois da publicação, nota da triagem). Sem IA, só com o que a pessoa registrou.
 * Sem esse retorno não dá para saber o que mudar (ver docs/how-it-works.md, "Research behind the features").
 */

const DAY = 86_400_000;
const days = (from: string | undefined, to: string | number | undefined) => {
  const a = from ? Date.parse(from) : NaN;
  const b = typeof to === "number" ? to : to ? Date.parse(to) : NaN;
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.floor((b - a) / DAY));
};

export const SENT_STATUSES: JobStatus[] = ["applied", "interview", "offer", "rejected"];

export const REJECTION_STAGES: Record<RejectionStage, string> = {
  sem_resposta: "sem resposta",
  triagem: "na triagem, antes de qualquer conversa",
  rh: "depois da conversa com o RH",
  tecnica: "depois do teste ou da entrevista técnica",
  final: "depois da entrevista final",
  desconhecida: "etapa desconhecida",
};
export const isRejectionStage = (s: unknown): s is RejectionStage => typeof s === "string" && s in REJECTION_STAGES;
const INTERVIEW_STAGES: RejectionStage[] = ["rh", "tecnica", "final"];

/** Etapa provável de uma recusa, pelo que já se sabe da vaga (a pessoa confirma). */
export function defaultStage(job: Job, now = Date.now(), noReplyDays = settings.noReplyDays): RejectionStage {
  if (job.outcome?.stage) return job.outcome.stage;
  if (job.status === "interview" || job.status === "offer") return "tecnica";
  return isNoReply(job, now, noReplyDays) ? "sem_resposta" : "triagem";
}

/** O que aconteceu com uma candidatura enviada. */
export interface Result {
  /** A empresa respondeu (entrevista, oferta ou recusa com retorno). */
  replied: boolean;
  /** Chegou a ter conversa ou entrevista. */
  interviewed: boolean;
  /** Nenhuma resposta depois de `noReplyDays`, ou marcada como sem resposta. */
  noReply: boolean;
  /** Enviada há pouco: ainda não dá para dizer. */
  pending: boolean;
}

export function resultOf(job: Job, now = Date.now(), noReplyDays = settings.noReplyDays): Result {
  const stage = job.outcome?.stage;
  if (job.status === "interview" || job.status === "offer") return { replied: true, interviewed: true, noReply: false, pending: false };
  if (job.status === "rejected") {
    const noReply = stage === "sem_resposta";
    return { replied: !noReply, interviewed: Boolean(stage && INTERVIEW_STAGES.includes(stage)), noReply, pending: false };
  }
  const old = (days(job.appliedAt, now) ?? 0) >= noReplyDays;
  return { replied: false, interviewed: false, noReply: old, pending: !old };
}

/** Candidatura sem resposta há mais de `noReplyDays` (a página mostra "sem retorno" e sugere fechar). */
export const isNoReply = (job: Job, now = Date.now(), noReplyDays = settings.noReplyDays) =>
  job.status === "applied" && resultOf(job, now, noReplyDays).noReply;

/** Follow-up pendente: o 1º depois de `followUpDays` da candidatura, o 2º depois de mais `followUpDays`; no máximo 2. */
export function followUpDue(job: Job, now = Date.now(), every = settings.followUpDays, noReplyDays = settings.noReplyDays): 0 | 1 | 2 {
  if (job.status !== "applied" || job.respondedAt || isNoReply(job, now, noReplyDays)) return 0;
  const sent = job.followUps ?? [];
  if (sent.length >= 2) return 0;
  const since = days(sent.at(-1) ?? job.appliedAt, now);
  return since != null && since >= every ? ((sent.length + 1) as 1 | 2) : 0;
}

/* ------------------------------------------------------------------ números */

export interface Group {
  key: string;
  label: string;
  sent: number;
  replied: number;
  interviewed: number;
  noReply: number;
  pending: number;
  /** % de resposta entre as que já dá para avaliar (sem contar as que estão aguardando). null sem base. */
  replyRate: number | null;
  interviewRate: number | null;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

function group(key: string, label: string, jobs: Job[], now: number, noReplyDays: number): Group {
  const r = jobs.map((j) => resultOf(j, now, noReplyDays));
  const count = (f: (x: Result) => boolean) => r.filter(f).length;
  const pending = count((x) => x.pending);
  const decided = jobs.length - pending;
  const replied = count((x) => x.replied);
  const interviewed = count((x) => x.interviewed);
  return { key, label, sent: jobs.length, replied, interviewed, noReply: count((x) => x.noReply), pending, replyRate: pct(replied, decided), interviewRate: pct(interviewed, decided) };
}

function groupBy(jobs: Job[], keyOf: (j: Job) => [string, string], now: number, noReplyDays: number, order?: string[]): Group[] {
  const map = new Map<string, { label: string; jobs: Job[] }>();
  for (const j of jobs) {
    const [key, label] = keyOf(j);
    if (!map.has(key)) map.set(key, { label, jobs: [] });
    map.get(key)!.jobs.push(j);
  }
  const groups = [...map].map(([key, g]) => group(key, g.label, g.jobs, now, noReplyDays));
  return order ? groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : groups.sort((a, b) => b.sent - a.sent);
}

/** Fonte agrupada: as buscas na web viram uma só, a vaga colada é "colada". */
export function sourceGroup(source: string): [string, string] {
  if (source.startsWith("web")) return ["web", "busca na web"];
  if (source === "manual") return ["manual", "colada"];
  if (source.startsWith("github")) return ["github", "comunidades no GitHub"];
  return [source, source];
}

/** Quantos dias depois da publicação a candidatura foi enviada. */
export function lagGroup(job: Pick<Job, "postedAt" | "appliedAt">): [string, string] {
  const d = days(job.postedAt, job.appliedAt);
  if (d == null) return ["?", "sem data de publicação"];
  return d <= 3 ? ["0-3", "até 3 dias"] : d <= 7 ? ["4-7", "4 a 7 dias"] : d <= 14 ? ["8-14", "8 a 14 dias"] : ["15+", "15 dias ou mais"];
}

function scoreGroup(job: Job): [string, string] {
  const s = job.triage?.score;
  return s == null ? ["?", "sem triagem"] : s >= 85 ? ["85+", "85 ou mais"] : s >= 70 ? ["70-84", "70 a 84"] : ["<70", "abaixo de 70"];
}

/** Uma conclusão tirada dos números, com as variáveis para o texto (a interface traduz). */
export interface Insight {
  code: "missing_outcome" | "missing_channel" | "best_channel" | "early_better" | "screening" | "no_interviews" | "small_sample";
  vars: Record<string, string | number>;
}

export interface Funnel {
  totals: Group;
  byChannel: Group[];
  bySource: Group[];
  byLag: Group[];
  byScore: Group[];
  stages: { stage: RejectionStage | "sem_etapa"; label: string; count: number }[];
  medianDaysToReply: number | null;
  /** Recusadas sem a etapa registrada e enviadas sem o canal: o que falta para os números ficarem bons. */
  missingOutcome: string[];
  missingChannel: string[];
  followUpsDue: string[];
  insights: Insight[];
}

/** Grupo com base suficiente para comparar. */
const MIN = 3;

export function funnel(all: Job[], now = Date.now(), noReplyDays = settings.noReplyDays): Funnel {
  const sent = all.filter((j) => SENT_STATUSES.includes(j.status) && j.appliedAt);
  const g = (keyOf: (j: Job) => [string, string], order?: string[]) => groupBy(sent, keyOf, now, noReplyDays, order);
  const totals = group("all", "todas", sent, now, noReplyDays);
  const byChannel = g((j) => (j.appliedVia ? [j.appliedVia, APPLY_CHANNELS[j.appliedVia]] : ["?", "sem canal"]));
  const bySource = g((j) => sourceGroup(j.source));
  const byLag = g(lagGroup, ["0-3", "4-7", "8-14", "15+", "?"]);
  const byScore = g(scoreGroup, ["85+", "70-84", "<70", "?"]);

  const rejected = sent.filter((j) => j.status === "rejected");
  const stageCount = new Map<RejectionStage | "sem_etapa", number>();
  for (const j of rejected) stageCount.set(j.outcome?.stage ?? "sem_etapa", (stageCount.get(j.outcome?.stage ?? "sem_etapa") ?? 0) + 1);
  const stages = [...stageCount].map(([stage, count]) => ({ stage, label: stage === "sem_etapa" ? "etapa não registrada" : REJECTION_STAGES[stage], count })).sort((a, b) => b.count - a.count);

  const waits = sent.map((j) => days(j.appliedAt, j.respondedAt)).filter((d): d is number => d != null).sort((a, b) => a - b);
  const medianDaysToReply = waits.length ? waits[Math.floor(waits.length / 2)] : null;

  const missingOutcome = rejected.filter((j) => !j.outcome).map((j) => j.id);
  const missingChannel = sent.filter((j) => !j.appliedVia).map((j) => j.id);
  const followUpsDue = sent.filter((j) => followUpDue(j, now, settings.followUpDays, noReplyDays)).map((j) => j.id);

  const insights: Insight[] = [];
  const decided = totals.sent - totals.pending;
  if (missingOutcome.length) insights.push({ code: "missing_outcome", vars: { n: missingOutcome.length } });
  if (missingChannel.length) insights.push({ code: "missing_channel", vars: { n: missingChannel.length } });
  if (decided < 10) insights.push({ code: "small_sample", vars: { n: decided } });

  const comparable = byChannel.filter((c) => c.key !== "?" && c.sent - c.pending >= MIN && c.replyRate != null);
  if (comparable.length >= 2) {
    const sorted = [...comparable].sort((a, b) => b.replyRate! - a.replyRate!);
    const [best, worst] = [sorted[0], sorted.at(-1)!];
    if (best.replyRate! - worst.replyRate! >= 15)
      insights.push({ code: "best_channel", vars: { best: best.label, bestRate: best.replyRate!, worst: worst.label, worstRate: worst.replyRate! } });
  }

  const early = sent.filter((j) => ["0-3", "4-7"].includes(lagGroup(j)[0]));
  const late = sent.filter((j) => ["8-14", "15+"].includes(lagGroup(j)[0]));
  const ge = group("early", "", early, now, noReplyDays);
  const gl = group("late", "", late, now, noReplyDays);
  if (ge.sent - ge.pending >= MIN && gl.sent - gl.pending >= MIN && ge.replyRate != null && gl.replyRate != null && ge.replyRate - gl.replyRate >= 10)
    insights.push({ code: "early_better", vars: { early: ge.replyRate, late: gl.replyRate } });

  const known = rejected.filter((j) => j.outcome && j.outcome.stage !== "sem_resposta" && j.outcome.stage !== "desconhecida");
  const screening = known.filter((j) => j.outcome!.stage === "triagem").length;
  if (known.length >= MIN && screening / known.length >= 0.5) insights.push({ code: "screening", vars: { n: screening, total: known.length } });

  if (decided >= 15 && totals.interviewed === 0) insights.push({ code: "no_interviews", vars: { n: decided } });

  return { totals, byChannel, bySource, byLag, byScore, stages, medianDaysToReply, missingOutcome, missingChannel, followUpsDue, insights };
}

/** Texto de cada conclusão para o terminal e o painel (a interface usa as chaves do dicionário). */
export function insightText(i: Insight): string {
  const v = i.vars;
  switch (i.code) {
    case "missing_outcome":
      return `${v.n} recusa(s) sem a etapa registrada. Registre até onde chegou: é o que mostra onde o processo trava.`;
    case "missing_channel":
      return `${v.n} candidatura(s) sem o canal registrado. Sem ele não dá para comparar os canais.`;
    case "small_sample":
      return `Ainda são poucas candidaturas com resultado (${v.n}). As comparações ficam mais confiáveis a partir de umas 10 por grupo.`;
    case "best_channel":
      return `Por ${v.best}, ${v.bestRate}% das candidaturas tiveram resposta; por ${v.worst}, ${v.worstRate}%. Priorize o canal que responde mais.`;
    case "early_better":
      return `Enviadas até 7 dias depois da publicação: ${v.early}% de resposta. Depois disso: ${v.late}%. Candidate-se cedo.`;
    case "screening":
      return `${v.n} de ${v.total} recusas vieram na triagem, antes de qualquer conversa. Confira os critérios eliminatórios e o topo do currículo (cargo e palavras-chave da vaga).`;
    case "no_interviews":
      return `${v.n} candidaturas com resultado e nenhuma entrevista ainda. Tente indicação e vagas mais recentes, e confira se a senioridade das vagas bate com a sua.`;
  }
}

const rate = (r: number | null) => (r == null ? "-" : `${r}%`);

/** Tabela de um corte do funil (terminal). */
function table(title: string, groups: Group[]): string {
  if (!groups.length) return "";
  const w = Math.max(...groups.map((g) => g.label.length), 10);
  const rows = groups.map(
    (g) =>
      `  ${g.label.padEnd(w)}  ${String(g.sent).padStart(7)}  ${rate(g.replyRate).padStart(8)}  ${rate(g.interviewRate).padStart(10)}${g.sent - g.pending < MIN ? "  (poucas)" : ""}`,
  );
  return `${title}\n  ${"".padEnd(w)}  enviadas  resposta  entrevista\n${rows.join("\n")}`;
}

/** O funil inteiro em texto (ajf resultados). */
export function funnelText(f: Funnel): string {
  const t = f.totals;
  if (!t.sent) return "Nenhuma candidatura enviada ainda. Marque as que você enviou com 'ajf enviei'.";
  const head = `📊 ${t.sent} candidatura(s) enviada(s): ${t.replied} com resposta (${rate(t.replyRate)}), ${t.interviewed} com entrevista (${rate(t.interviewRate)}), ${t.noReply} sem retorno, ${t.pending} aguardando.${
    f.medianDaysToReply != null ? ` Tempo de resposta (mediana): ${f.medianDaysToReply} dia(s).` : ""
  }\n   As % contam só as que já têm resultado; as que estão aguardando ficam de fora.`;
  const stages = f.stages.length ? `Onde as recusas aconteceram:\n${f.stages.map((s) => `  ${String(s.count).padStart(3)}  ${s.label}`).join("\n")}` : "";
  const ins = f.insights.length ? `O que os números dizem:\n${f.insights.map((i) => `  • ${insightText(i)}`).join("\n")}` : "";
  return [head, ins, stages, table("Por canal", f.byChannel), table("Por fonte", f.bySource), table("Dias entre a publicação e o envio", f.byLag), table("Nota da triagem", f.byScore)]
    .filter(Boolean)
    .join("\n\n");
}

/* ------------------------------------------------------------- e-mail de recusa */

const RejectionReadSchema = z.object({
  stage: z.enum(["sem_resposta", "triagem", "rh", "tecnica", "final", "desconhecida"]).describe("Até onde o processo chegou, segundo o e-mail"),
  reason: z.string().describe("O motivo da recusa, só se o e-mail disser; vazio se não diz"),
  automated: z.boolean().describe("true se parece mensagem automática, genérica, sem nada sobre a pessoa"),
});

/**
 * Lê o e-mail de recusa que a pessoa colou: etapa, motivo (só se o e-mail disser) e se é automático.
 * Nada do perfil vai junto.
 */
export async function readRejectionEmail(text: string, job: Pick<Job, "status" | "title" | "company">) {
  const r = await structured(RejectionReadSchema, {
    label: "read:rejection",
    effort: "low",
    system: ["Você lê e-mails de recusa de processos seletivos. Registre só o que o e-mail diz. Não invente motivo."],
    user: `Vaga: ${job.title} na ${job.company}. Antes da recusa, a candidatura estava como: ${job.status === "interview" ? "em entrevista" : "enviada, sem entrevista"}.

<email>
${truncate(text, 6000)}
</email>

Diga até onde o processo chegou (triagem = recusa antes de qualquer conversa; rh = depois de conversar com recrutador ou RH; tecnica = depois de teste ou entrevista técnica; final = depois da entrevista final; desconhecida = o e-mail não deixa claro) e o motivo, só se o e-mail disser.`,
  });
  return { stage: r.stage, reason: r.reason.trim(), automated: r.automated };
}
