import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withoutDashesResume, withoutTranslatedTitles } from "../profile.js";
import { contentFill, htmlToPdf } from "../render/pdf.js";
import { PAGE_MARGIN_MM, resumeHtml } from "../render/resumeHtml.js";
import { mainRoleFirst, pageLimit, professionalMonths } from "../career.js";
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
/**
 * A conferência só cobra as palavras do topo da lista. As do fim (pedidas por poucas vagas) a IA usa se
 * couberem; cobrá-las vira enchimento ("pull requests" como competência).
 */
export const MARKET_CHECK_TOP = 30;
const MAX_BULLET_CHARS = 300;
const MAX_SUMMARY_CHARS = 750;
const MAX_SKILL_GROUPS = 8;
const MAX_SKILLS_PER_GROUP = 15;
export const MAX_PAGES = 2;
/** Linhas de texto que cabem numa página do modelo (corpo 9,6 pt, entrelinha 1,32, área útil do A4). */
const LINES_PER_PAGE = 60;

/**
 * Limites pelo tempo de carreira (src/career.ts): até 3 anos de experiência com datas, 1 página e menos
 * tópicos; daí em diante, até 2 páginas. Puro.
 */
export function resumeLimits(r: Pick<Resume, "experience">) {
  const pages = pageLimit(professionalMonths(r));
  return pages === 1
    ? { pages, bullets: 5, mainBullets: 6, total: 12, aim: "8 a 11" }
    : { pages, bullets: MAX_BULLETS, mainBullets: MAX_MAIN_BULLETS, total: MAX_TOTAL_BULLETS, aim: "12 a 16" };
}

/** De onde o número veio, ou uma nota para a pessoa: fica no perfil, nunca no currículo. */
const INTERNAL_NOTE =
  /autodeclarad|auto-declarad|conforme relato|segundo (o |a )?relato|segundo estimativa|estimativa autodeclarada|levantamento (feito )?(em|de) \d|\ba confirmar\b|\[(estimado|medido|sem n[uú]mero)\]|self-reported|as reported (by|on)|to be confirmed|\bTBC\b/i;
/** Contadores do trabalho em si (não são resultado para quem contrata). */
const WORK_COUNTER = /\b\d[\d.,]*\s*(mil\s+|k\s+)?(commits?|pull requests?|PRs\b|linhas de (c[oó]digo|typescript|javascript|python)|lines of (code|typescript)|migrations?)\b/i;
/** Pendência que nunca é conteúdo de currículo. */
const PENDING = /\ba confirmar\b|\bto be confirmed\b/i;

export const isPageIssue = (issue: string) => /^o PDF ficou com \d+ páginas/.test(issue);

const cut = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Os problemas do currículo-base, em frases que vão para a revisão da IA e para o log. Com `market` (as palavras
 * do mercado que o perfil comprova, marketKeywords.ts), aponta as mais pedidas que o currículo não mostra. Puro.
 */
export function baseResumeIssues(r: Resume, pages?: number, market: MarketKeyword[] = [], fill?: number): string[] {
  const out: string[] = [];
  const lim = resumeLimits(r);
  const total = r.experience.reduce((n, e) => n + e.bullets.length, 0);
  // A posição com mais tópicos é a principal: ela pode ir um pouco além das outras.
  const main = r.experience.reduce((best, e, i) => (e.bullets.length > r.experience[best].bullets.length ? i : best), 0);
  r.experience.forEach((e, i) => {
    const where = `${e.title} (${e.company})`;
    const max = i === main ? lim.mainBullets : lim.bullets;
    if (e.bullets.length > max)
      out.push(`${where}: ${e.bullets.length} tópicos; o máximo é ${max}${i === main ? " (posição principal)" : ` (só a posição principal passa de ${lim.bullets})`}`);
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
  if (total > lim.total) out.push(`${total} tópicos de experiência no total; mire em ${lim.aim}`);
  const text = JSON.stringify(r);
  const missing = market
    .slice(0, MARKET_CHECK_TOP)
    .filter((k) => !mentions(text, k.term))
    .slice(0, MAX_MISSING_KEYWORDS);
  if (missing.length)
    out.push(
      `palavras que as vagas analisadas pedem, que o perfil comprova e que o currículo não mostra: ${missing.map((k) => `"${k.term}" (${k.jobs} vagas)`).join(", ")}. Use as que forem verdade onde couberem, com essa grafia (as maiúsculas seguem o padrão do currículo)`,
    );
  if (r.summary.length > MAX_SUMMARY_CHARS) out.push(`resumo longo demais (${r.summary.length} caracteres; até cerca de 600)`);
  if (INTERNAL_NOTE.test(r.summary)) out.push(`nota interna do perfil no resumo`);
  if (r.skills.length > MAX_SKILL_GROUPS) out.push(`${r.skills.length} categorias de competências; use de 4 a 7`);
  for (const g of r.skills) if (g.items.length > MAX_SKILLS_PER_GROUP) out.push(`competências "${g.category}": ${g.items.length} itens; até cerca de 12`);
  for (const p of r.projects) if (INTERNAL_NOTE.test(p.description)) out.push(`projeto ${p.name}: nota interna do perfil na descrição`);
  if (pages && pages > lim.pages)
    out.push(
      lim.pages === 1
        ? `o PDF ficou com ${pages} páginas; com menos de 3 anos de experiência com datas, o currículo cabe em 1 página${
            fill && fill > 1
              ? ` (o conteúdo ocupa ${Math.round(fill * 100)}% de uma página: corte cerca de ${Math.ceil((fill - 1) * LINES_PER_PAGE) + 2} linhas, encurtando competências, resumo e tópicos)`
              : ""
          }`
        : `o PDF ficou com ${pages} páginas; o máximo é ${lim.pages}`,
    );
  return out;
}

/** Tira os tópicos que são pendência ("A confirmar: ..."): isso nunca vai para o currículo. Puro. */
export function withoutPendingNotes(r: Resume): Resume {
  return { ...r, experience: r.experience.map((e) => ({ ...e, bullets: e.bullets.filter((b) => !PENDING.test(b)) })) };
}

/** Páginas do PDF (precisa do navegador; sem ele, não conta). */
/** Páginas do PDF e quanto de uma página o conteúdo ocupa (render/pdf.ts#contentFill). */
async function measure(r: Resume): Promise<{ pages?: number; fill?: number }> {
  try {
    return { pages: await pageCount(r), fill: await contentFill(resumeHtml(r, "A4"), "A4", PAGE_MARGIN_MM) };
  } catch {
    return { pages: await pageCount(r) };
  }
}

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
  let resume = mainRoleFirst(withoutPendingNotes(draft));
  const check = async (r: Resume) => {
    const m = await measure(r);
    return baseResumeIssues(r, m.pages, market, m.fill);
  };
  let issues = await check(resume);
  // Até duas revisões: a segunda só quando ainda passa do limite de páginas (a IA não vê o PDF; a medida diz quanto cortar).
  for (let round = 0; round < 2 && issues.length && (round === 0 || issues.some(isPageIssue)); round++) {
    log(`   revisando o currículo (${issues.length} ponto(s): ${cut(issues.join("; "), 160)})`);
    try {
      resume = mainRoleFirst(withoutPendingNotes(await reviseBaseResume(truth, resume, issues, market, resumeLimits(resume).pages)));
    } catch (e) {
      log(`   ⚠ a revisão não deu certo (${(e as Error).message}); fica a versão anterior.`);
      return { resume, issues };
    }
    issues = await check(resume);
  }
  return { resume, issues };
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
