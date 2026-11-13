import { z } from "zod";
import { structured } from "../llm.js";
import { profileTruthEvidence } from "../profile.js";
import { profileSystem } from "../prompts.js";
import type { Job, JobReferral } from "../schemas.js";
import { truncate, withoutDashes } from "../util/text.js";
import { answerViolations } from "../writers/answers.js";
import { cleanJobText } from "./page.js";
import { findJob, loadJobs, updateJob } from "./store.js";

/**
 * Pedir indicação antes de se candidatar pela plataforma. Indicação é a fonte que mais vira contratação
 * nos dados de recrutamento (Lever: 1 em 16 indicados é contratado, contra 1 em 152 pelo anúncio; ver
 * docs/how-it-works.md, "Research behind the features").
 *
 * O agente nunca entra no LinkedIn: monta os links de busca (que a pessoa abre logada) e escreve as
 * mensagens só com fatos do perfil, sem inventar vínculo com ninguém. Quem envia é a pessoa.
 */

const LINKEDIN_PEOPLE = "https://www.linkedin.com/search/results/people/";

/** Buscas no LinkedIn: pessoas da empresa na sua rede (1º e 2º grau) e quem recruta na empresa. */
export function referralLinks(company: string): { network: string; recruiters: string } {
  const q = (keywords: string, extra = "") => `${LINKEDIN_PEOPLE}?keywords=${encodeURIComponent(keywords)}${extra}&origin=GLOBAL_SEARCH_HEADER`;
  const name = company.replace(/\s+/g, " ").trim();
  return {
    network: q(`"${name}"`, `&network=${encodeURIComponent('["F","S"]')}`),
    recruiters: q(`"${name}" (recruiter OR recrutador OR recrutadora OR "talent acquisition")`),
  };
}

/** Dias depois de pedir a indicação para seguir pela plataforma (chegar cedo pesa mais que esperar). */
export const REFERRAL_WAIT_DAYS = 3;

export function referralOverdue(job: Pick<Job, "referral">, now = Date.now()): boolean {
  const r = job.referral;
  return Boolean(r?.status === "pedida" && r.at && now - Date.parse(r.at) >= REFERRAL_WAIT_DAYS * 86_400_000);
}

export function setReferral(id: string, status: NonNullable<JobReferral["status"]>): Job {
  const job = findJob(loadJobs(), id);
  return updateJob(id, { referral: { ...job.referral, status, at: new Date().toISOString() } });
}

const MessagesSchema = z.object({
  warm: z.string().describe("Para alguém da empresa que já conhece a pessoa (até 600 caracteres)"),
  cold: z.string().describe("Convite de conexão para alguém da empresa que não conhece a pessoa (até 300 caracteres, limite do LinkedIn)"),
});

/** Escreve (ou devolve as já escritas) as mensagens de pedido de indicação. */
export async function referralMessages(id: string, force = false): Promise<{ warm: string; cold: string }> {
  const job = findJob(loadJobs(), id);
  if (job.referral?.messages && !force) return job.referral.messages;
  const en = job.triage?.jobLanguage === "en";
  const link = [job.applyUrl, job.url].find((u) => u && /^https?:\/\//i.test(u));
  const user = `<vaga>
Cargo: ${job.title}
Empresa: ${job.company}
${link ? `Link: ${link}\n` : ""}${truncate(cleanJobText(job.description), 5000)}
</vaga>

Escreva, em ${en ? "inglês" : "português do Brasil"}, duas mensagens curtas de LinkedIn para pedir indicação para esta vaga:
- warm: para alguém da empresa que já conhece a pessoa. Até 600 caracteres. Diga a vaga${link ? " (com o link)" : ""}, 1 ou 2 provas do perfil ligadas ao que a vaga pede e peça, com leveza, a indicação ou o contato de quem recruta.
- cold: convite de conexão para alguém da empresa que NÃO conhece a pessoa. No máximo 300 caracteres (conte). Não peça indicação de cara: diga a vaga e 1 prova, e peça 10 minutos de conversa ou uma dica sobre o time.

Regras: só fatos das fontes; não invente vínculo, conversa anterior nem nome de ninguém (use [Nome]); tom humano, sem bajulação nem clichês; sem travessão como pontuação.`;
  const sources = [profileTruthEvidence(), job.description].join("\n");
  const fix = (m: { warm: string; cold: string }) => ({ warm: withoutDashes(m.warm.trim()), cold: withoutDashes(m.cold.trim()) });
  const problems = (m: { warm: string; cold: string }) => [
    ...answerViolations(`${m.warm}\n${m.cold}`, sources),
    ...(m.cold.length > 300 ? [`o convite tem ${m.cold.length} caracteres (máximo 300)`] : []),
    ...(m.warm.length > 600 ? [`a mensagem tem ${m.warm.length} caracteres (máximo 600)`] : []),
  ];
  let m = fix(await structured(MessagesSchema, { label: "write:referral", effort: "medium", system: profileSystem(), user }));
  const issues = problems(m);
  if (issues.length)
    m = fix(await structured(MessagesSchema, { label: "write:referral", effort: "medium", system: profileSystem(), user: `${user}\n\nA versão anterior foi barrada: ${issues.join("; ")}. Corrija.` }));
  updateJob(id, { referral: { ...findJob(loadJobs(), id).referral, messages: m } });
  return m;
}
