import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withoutDashesResume, withoutTranslatedTitles } from "../profile.js";
import { htmlToPdf } from "../render/pdf.js";
import { resumeHtml } from "../render/resumeHtml.js";
import type { Resume } from "../schemas.js";
import { buildBaseResume, reviseBaseResume } from "./build.js";
import { currentMarket, mentions, type MarketKeyword } from "./marketKeywords.js";

/**
 * Conferência do currículo-base sem IA: o que um recrutador estranharia (tópicos demais, nota interna,
 * prefixo repetido, contador de commits, mais de 2 páginas). Achou problema: a IA revisa uma vez só esses
 * pontos (build.ts#reviseBaseResume). As regras completas estão em build.ts#RESUME_CURATION.
 */

/** Tópicos por posição: só a principal (a que tem mais projetos) pode passar de MAX_BULLETS, até MAX_MAIN_BULLETS. */
export const MAX_BULLETS = 6;
export const MAX_MAIN_BULLETS = 8;
/** O prompt pede de 12 a 16 tópicos no total; a conferência aponta a partir daqui. */
export const MAX_TOTAL_BULLETS = 18;
/** Palavras do mercado que faltam e que a revisão tenta encaixar (as mais pedidas primeiro). */
const MAX_MISSING_KEYWORDS = 8;
const MAX_BULLET_CHARS = 300;
const MAX_SUMMARY_CHARS = 750;
const MAX_SKILL_GROUPS = 8;
const MAX_SKILLS_PER_GROUP = 15;
export const MAX_PAGES = 2;

/** De onde o número veio, ou uma nota para a pessoa: fica no perfil, nunca no currículo. */
const INTERNAL_NOTE =
  /autodeclarad|auto-declarad|conforme relato|segundo (o |a )?relato|segundo estimativa|estimativa autodeclarada|levantamento (feito )?(em|de) \d|\ba confirmar\b|\[(estimado|medido|sem n[uú]mero)\]|self-reported|as reported (by|on)|to be confirmed|\bTBC\b/i;
/** Contadores do trabalho em si (não são resultado para quem contrata). */
const WORK_COUNTER = /\b\d[\d.,]*\s*(mil\s+|k\s+)?(commits?|pull requests?|PRs\b|linhas de (c[oó]digo|typescript|javascript|python)|lines of (code|typescript)|migrations?)\b/i;
/** Pendência que nunca é conteúdo de currículo. */
const PENDING = /\ba confirmar\b|\bto be confirmed\b/i;

const cut = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Os problemas do currículo-base, em frases que vão para a revisão da IA e para o log. Com `market` (as palavras
 * do mercado que o perfil comprova, marketKeywords.ts), aponta as mais pedidas que o currículo não mostra. Puro.
 */
export function baseResumeIssues(r: Resume, pages?: number, market: MarketKeyword[] = []): string[] {
  const out: string[] = [];
  const total = r.experience.reduce((n, e) => n + e.bullets.length, 0);
  // A posição com mais tópicos é a principal: ela pode ir até 8; as outras, até 6.
  const main = r.experience.reduce((best, e, i) => (e.bullets.length > r.experience[best].bullets.length ? i : best), 0);
  r.experience.forEach((e, i) => {
    const where = `${e.title} (${e.company})`;
    const max = i === main ? MAX_MAIN_BULLETS : MAX_BULLETS;
    if (e.bullets.length > max)
      out.push(`${where}: ${e.bullets.length} tópicos; o máximo é ${max}${i === main ? " (posição principal)" : ` (só a posição principal passa de ${MAX_BULLETS})`}`);
    const prefixes = new Map<string, number>();
    for (const b of e.bullets) {
      if (b.length > MAX_BULLET_CHARS) out.push(`${where}: tópico longo demais (${b.length} caracteres; até cerca de 250): "${cut(b)}"`);
      const note = b.match(INTERNAL_NOTE);
      if (note) out.push(`${where}: nota interna do perfil no tópico ("${note[0]}"): "${cut(b)}"`);
      const counter = b.match(WORK_COUNTER);
      if (counter) out.push(`${where}: contador de trabalho que não é resultado ("${counter[0]}"): "${cut(b)}"`);
      const prefix = b.match(/^([^:.]{3,45}):\s/)?.[1].trim().toLowerCase();
      if (prefix) prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
    for (const [prefix, n] of prefixes) if (n >= 3) out.push(`${where}: o prefixo "${prefix}:" se repete em ${n} tópicos`);
  });
  if (total > MAX_TOTAL_BULLETS) out.push(`${total} tópicos de experiência no total; mire em 12 a 16`);
  const text = JSON.stringify(r);
  const missing = market.filter((k) => !mentions(text, k.term)).slice(0, MAX_MISSING_KEYWORDS);
  if (missing.length)
    out.push(
      `palavras que as vagas analisadas pedem, que o perfil comprova e que o currículo não mostra: ${missing.map((k) => `"${k.term}" (${k.jobs} vagas)`).join(", ")}. Use as que forem verdade onde couberem, com essa grafia`,
    );
  if (r.summary.length > MAX_SUMMARY_CHARS) out.push(`resumo longo demais (${r.summary.length} caracteres; até cerca de 600)`);
  if (INTERNAL_NOTE.test(r.summary)) out.push(`nota interna do perfil no resumo`);
  if (r.skills.length > MAX_SKILL_GROUPS) out.push(`${r.skills.length} categorias de competências; use de 4 a 7`);
  for (const g of r.skills) if (g.items.length > MAX_SKILLS_PER_GROUP) out.push(`competências "${g.category}": ${g.items.length} itens; até cerca de 12`);
  for (const p of r.projects) if (INTERNAL_NOTE.test(p.description)) out.push(`projeto ${p.name}: nota interna do perfil na descrição`);
  if (pages && pages > MAX_PAGES) out.push(`o PDF ficou com ${pages} páginas; o máximo é ${MAX_PAGES}`);
  return out;
}

/** Tira os tópicos que são pendência ("A confirmar: ..."): isso nunca vai para o currículo. Puro. */
export function withoutPendingNotes(r: Resume): Resume {
  return { ...r, experience: r.experience.map((e) => ({ ...e, bullets: e.bullets.filter((b) => !PENDING.test(b)) })) };
}

/** Páginas do PDF (precisa do navegador; sem ele, não conta). */
async function pageCount(r: Resume): Promise<number | undefined> {
  const file = path.join(os.tmpdir(), `ajf-base-${process.pid}-${Date.now()}.pdf`);
  try {
    return await htmlToPdf(resumeHtml(r, "A4"), file, "A4");
  } catch {
    return undefined;
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Dados que a IA não pode inventar e que fazem falta para quem contrata: só a pessoa resolve (no perfil ou numa
 * novidade). Vão para o log da atualização, não para a IA. Puro.
 */
export function resumeHints(r: Resume): string[] {
  const out: string[] = [];
  const en = r.language === "en";
  if (!r.contact.phone?.trim())
    out.push(en ? "No phone number: many recruiters call and most forms ask for one." : "Sem telefone: muitos recrutadores ligam ou chamam no WhatsApp, e os formulários pedem.");
  for (const e of r.education)
    if (!e.period?.trim()) out.push(en ? `Education without a date: "${e.degree}". Add the year or period.` : `Formação sem período: "${e.degree}". Informe o ano ou o período, senão pode parecer um curso não concluído.`);
  const current = r.experience.filter((e) => /^(atual|present|current|presente|hoje)$/i.test(e.end.trim()));
  if (current.length >= 3)
    out.push(
      en
        ? `${current.length} current roles at the same time: check that they are all still current.`
        : `${current.length} cargos atuais ao mesmo tempo: confira se todos continuam atuais (cargos demais em paralelo levantam dúvida sobre disponibilidade).`,
    );
  return out;
}

/** Confere e, se precisar, revisa uma vez. Devolve o currículo e o que ainda ficou (só aviso). */
export async function polishBaseResume(
  truth: string,
  draft: Resume,
  log: (m: string) => void = console.log,
  market: MarketKeyword[] = [],
): Promise<{ resume: Resume; issues: string[] }> {
  let resume = withoutPendingNotes(draft);
  const issues = baseResumeIssues(resume, await pageCount(resume), market);
  if (!issues.length) return { resume, issues };
  log(`   revisando o currículo (${issues.length} ponto(s): ${cut(issues.join("; "), 160)})`);
  try {
    resume = withoutPendingNotes(await reviseBaseResume(truth, resume, issues, market));
  } catch (e) {
    log(`   ⚠ a revisão não deu certo (${(e as Error).message}); fica a versão sem revisão.`);
    return { resume, issues };
  }
  return { resume, issues: baseResumeIssues(resume, await pageCount(resume), market) };
}

/**
 * Os dois currículos-base (PT e EN) a partir do perfil, conferidos e revisados. Com `previous`, atualiza o
 * currículo atual em vez de montar do zero. Usado pelo cadastro (`ajf init`) e pela atualização do perfil.
 * As palavras do mercado (marketKeywords.ts) vêm das vagas que a pessoa já analisou; sem vagas, não há.
 */
export async function buildBaseResumes(truth: string, previous?: Resume, log: (m: string) => void = console.log): Promise<{ pt: Resume; en: Resume; issues: string[] }> {
  const market = currentMarket(truth);
  if (market.proven.length) log(`Palavras do seu mercado: ${market.proven.length} termo(s) que o perfil comprova, de ${market.total} vaga(s) analisada(s).`);
  log("Montando o currículo-base em português...");
  const pt = await polishBaseResume(truth, await buildBaseResume(truth, "pt-BR", undefined, previous, market.proven), log, market.proven);
  log("Montando o currículo-base em inglês...");
  const en = await polishBaseResume(truth, await buildBaseResume(truth, "en", pt.resume), log);
  // Cargo em inglês só no currículo em inglês; nos dois, sem travessão como pontuação.
  const issues = [...pt.issues.map((i) => `PT: ${i}`), ...en.issues.map((i) => `EN: ${i}`)];
  for (const i of issues) log(`   ⚠ ${i}`);
  for (const h of resumeHints(pt.resume)) log(`💡 ${h}`);
  if (market.gaps.length)
    log(`📚 O seu mercado pede e o seu perfil não mostra (lacunas para estudar, nunca vão para o currículo): ${market.gaps.slice(0, 8).map((k) => `${k.term} (${k.jobs})`).join(", ")}.`);
  return { pt: withoutDashesResume(withoutTranslatedTitles(pt.resume, en.resume)), en: withoutDashesResume(en.resume), issues };
}
