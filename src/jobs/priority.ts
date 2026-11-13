import type { Job, Knockout, Triage } from "../schemas.js";
import { cleanJobText, isWebSummary } from "./page.js";

/**
 * Ordem de prioridade das vagas, sem IA. Junta o que mais pesa no resultado de uma candidatura:
 * - aderência (nota da triagem);
 * - frescor: a maior parte das candidaturas chega nos primeiros dias, e quem chega cedo é visto
 *   antes (ver docs/how-it-works.md, "Research behind the features");
 * - critérios eliminatórios que o perfil não atende;
 * - sinais de vaga fantasma (anúncio sem contratação real);
 * - indicação recebida.
 */

const DAY = 86_400_000;

/** Dias desde a publicação da vaga (null quando a fonte não informa a data). */
export function ageDays(job: Pick<Job, "postedAt">, now = Date.now()): number | null {
  const t = job.postedAt ? Date.parse(job.postedAt) : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY));
}

/** nova: até 3 dias; recente: até 14; antiga: mais que isso. */
export type Freshness = "nova" | "recente" | "antiga";
export function freshness(job: Pick<Job, "postedAt">, now = Date.now()): Freshness | null {
  const age = ageDays(job, now);
  return age == null ? null : age <= 3 ? "nova" : age <= 14 ? "recente" : "antiga";
}

/** Sinais de vaga fantasma: anúncio que pode não ter contratação real. Só alertam e baixam a prioridade. */
export type GhostSignal = "antiga" | "republicada" | "banco_de_talentos" | "sem_detalhes";
export const GHOST_TEXT: Record<GhostSignal, string> = {
  antiga: "publicada há mais de 30 dias",
  republicada: "a mesma vaga já tinha aparecido antes (republicada)",
  banco_de_talentos: "parece banco de talentos, sem uma vaga específica",
  sem_detalhes: "anúncio com pouquíssimos detalhes",
};
const TALENT_POOL =
  /banco de talentos|cadastro reserva|talent (pool|community|network)|future opportunit|general application|candidatura espont[aâ]nea|always (hiring|looking)|bolsa de trabajo/i;

export function ghostSignals(job: Pick<Job, "postedAt" | "reopenedFrom" | "description" | "title"> & { source?: string }, now = Date.now()): GhostSignal[] {
  const out: GhostSignal[] = [];
  const age = ageDays(job, now);
  if (age != null && age > 30) out.push("antiga");
  if (job.reopenedFrom) out.push("republicada");
  if (TALENT_POOL.test(`${job.title}\n${job.description}`)) out.push("banco_de_talentos");
  // O resumo da busca na web é curto de propósito, e a vaga colada (indicação, WhatsApp) costuma ser curta
  // porque veio de uma pessoa: nenhum dos dois conta como anúncio sem detalhes.
  if (job.source !== "manual" && !isWebSummary(job.description) && cleanJobText(job.description).length < 400) out.push("sem_detalhes");
  return out;
}

/** Critérios eliminatórios que o perfil claramente não atende. */
export const failedKnockouts = (triage: Triage | undefined): Knockout[] => (triage?.knockouts ?? []).filter((k) => k.meets === "nao");

/**
 * Vaga com critério eliminatório que o perfil não atende não fica como "candidatar": vira "decidir"
 * (a pessoa decide; a IA não descarta sozinha, porque "5+ anos" com 4 às vezes passa).
 */
export function applyKnockouts<T extends Triage>(triage: T): T {
  return failedKnockouts(triage).length && triage.recommendation === "candidatar" ? { ...triage, recommendation: "decidir" } : triage;
}

/** Prioridade de 0 a ~110: quanto maior, antes a vaga aparece e antes ganha pacote no piloto automático. */
export function priorityOf(job: Job, now = Date.now()): number {
  let p = job.triage?.score ?? 40;
  const age = ageDays(job, now);
  if (age != null) p += age <= 3 ? 5 : -Math.min(30, (age - 3) * 1.5);
  p -= Math.min(20, ghostSignals(job, now).length * 10);
  if (failedKnockouts(job.triage).length) p -= 25;
  if (job.referral?.status === "recebida") p += 10;
  return Math.round(p);
}
