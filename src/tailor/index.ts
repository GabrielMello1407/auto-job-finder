import fs from "node:fs";
import path from "node:path";
import { ensureDir, paths, settings } from "../config.js";
import { findJob, loadJobs, updateJob } from "../jobs/store.js";
import { marketProfile, type MarketProfile } from "../market.js";
import { loadBaseResume, profileTruthEvidence } from "../profile.js";
import { coverLetterHtml, resumeHtml } from "../render/resumeHtml.js";
import { closeBrowser, htmlToPdf } from "../render/pdf.js";
import { ResumeSchema, type CoverLetter, type EmailPack, type Job, type JobAnalysis, type Market, type Resume } from "../schemas.js";
import { track } from "../tracker.js";
import { htmlToText, slugify, today } from "../util/text.js";
import { writeCoverLetter, writeEmails, writeInterviewPrep } from "../writers/documents.js";
import { analyzeJob, condenser, editor, reviewer, strategist } from "./agents.js";

const MAX_PAGES = 2;
import { atsMarkdown, atsReport } from "./ats.js";
import { runGuards, type GuardReport } from "./guards.js";
import { ratingReport, refine } from "./refine.js";

export interface TailorOptions {
  lang?: "pt-BR" | "en";
  paper?: "A4" | "Letter";
  market?: Market;
  cover?: boolean;
  interview?: boolean;
  maxRevisions?: number;
  target?: number;
}

/** Texto de evidência (sem as seções de lacunas/regras) usado pelas travas e pelo relatório ATS. */
export function sourcesText(): string {
  return [
    profileTruthEvidence(),
    fs.readFileSync(paths.baseResume("pt-BR"), "utf8"),
    fs.readFileSync(paths.baseResume("en"), "utf8"),
  ].join("\n\n");
}

function jobDescription(job: Job): string {
  return [
    `Cargo: ${job.title}`,
    `Empresa: ${job.company}`,
    `Local: ${job.location}${job.remote ? " (remoto)" : ""}`,
    job.salary ? `Salário: ${job.salary}` : "",
    `Link: ${job.url}`,
    "",
    job.description,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Vagas vindas da busca web chegam só com resumo: tenta baixar a página completa. */
async function ensureFullDescription(job: Job): Promise<Job> {
  if (!job.description.startsWith("[Resumo da busca web")) return job;
  try {
    const res = await fetch(job.url, { headers: { "User-Agent": settings.userAgent } });
    if (res.ok) {
      const text = htmlToText(await res.text());
      if (text.length > 1500) return updateJob(job.id, { description: text.slice(0, 20000) });
    }
  } catch {
    /* segue com o resumo */
  }
  console.warn(
    "  ⚠ Só tenho o resumo desta vaga. Para um currículo melhor, cole a descrição completa num arquivo e rode:\n" +
      `    ajf add --file vaga.md --title "${job.title}" --company "${job.company}"   (ou: ajf → "Colar uma vaga")`,
  );
  return job;
}

function guessLanguage(text: string): "pt-BR" | "en" {
  const pt = (text.match(/\b(você|vaga|requisitos|experiência|conhecimento|desejável|benefícios|atividades)\b/gi) ?? []).length;
  const en = (text.match(/\b(you|requirements|experience|knowledge|benefits|responsibilities|we are|our)\b/gi) ?? []).length;
  return pt > en ? "pt-BR" : "en";
}

export function fileBase(resume: Resume, mp: MarketProfile, company: string): string {
  const who = resume.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_");
  const comp = slugify(company, 30).split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join("");
  return `${who}_${mp.docName}_${comp || "Empresa"}`;
}

function coverageReview(final: Resume, base: Resume, guards: GuardReport, analysis: JobAnalysis): string {
  const rows = base.experience.map((b) => {
    const t = final.experience.find((e) => e.company === b.company);
    return `| ${b.company} | ${b.title} | ${b.start} – ${b.end} | ${b.bullets.length} | ${t ? t.bullets.length : "**REMOVIDA**"} |`;
  });
  return `# Revisão de cobertura

Fontes: profile/profile_truth.md, profile/base_resume.${final.language === "en" ? "en" : "pt"}.json

## Posições preservadas
| Empresa | Cargo | Período | Bullets na base | Bullets no final |
|---|---|---|---|---|
${rows.join("\n")}

## Travas automáticas
**Violações:** ${guards.violations.length ? "\n" + guards.violations.map((v) => `- ❌ ${v}`).join("\n") : "nenhuma ✅"}

**Alertas para você conferir:** ${guards.warnings.length ? "\n" + guards.warnings.map((v) => `- ⚠ ${v}`).join("\n") : "nenhum"}

## Requisitos obrigatórios da vaga
${analysis.mustHave.map((m) => `- ${m}`).join("\n")}

> Esta revisão não afirma que todos os requisitos obrigatórios são atendidos. Leia o currículo inteiro antes de enviar.
`;
}

function emailsMarkdown(e: EmailPack, analysis: JobAnalysis, attachments: string[]): string {
  const to = analysis.recruiterEmail;
  const mailto = to
    ? `mailto:${to}?subject=${encodeURIComponent(e.application.subjectOptions[0])}&body=${encodeURIComponent(e.application.body)}`
    : "";
  const note = e.linkedinConnectionNote;
  return `# E-mails e mensagens para o recrutador

${to ? `**Destinatário encontrado na vaga:** ${to}  \n[Abrir rascunho no seu e-mail](${mailto}) (anexe os arquivos manualmente)\n` : "_Nenhum e-mail de contato na vaga. Procure o recrutador no LinkedIn._\n"}
**Anexos:** ${attachments.join(", ")}

## 1. E-mail de candidatura
**Assunto (escolha um):**
${e.application.subjectOptions.map((s) => `- ${s}`).join("\n")}

\`\`\`text
${e.application.body}
\`\`\`

## 2. Convite de conexão no LinkedIn (${note.length}/300 caracteres${note.length > 300 ? " — ⚠ ACIMA DO LIMITE, encurte" : ""})
\`\`\`text
${note}
\`\`\`

## 3. Mensagem direta / InMail
\`\`\`text
${e.linkedinMessage}
\`\`\`

## 4. Follow-up (5–7 dias úteis depois)
**Assunto:** ${e.followUp.subject}
\`\`\`text
${e.followUp.body}
\`\`\`

## 5. Agradecimento pós-entrevista
**Assunto:** ${e.thankYou.subject}
\`\`\`text
${e.thankYou.body}
\`\`\`
`;
}

/** Passo a passo de candidatura conforme o canal que a vaga pede (e-mail, LinkedIn, plataforma...). */
function howToApply(a: JobAnalysis, job: Job, attachments: string[]): string {
  const link = job.applyUrl ?? job.url;
  const files = attachments.join(" + ");
  const steps: Record<JobAnalysis["applyChannel"], string> = {
    email: `📧 **Por e-mail**${a.recruiterEmail ? ` para **${a.recruiterEmail}**` : ""}: use o e-mail 1 de emails.md e anexe ${files}.`,
    linkedin: `💼 **Pelo LinkedIn** (${link}): use a candidatura simplificada e envie ${attachments[0]}. Depois mande o convite de conexão (emails.md, item 2) para quem publicou a vaga.`,
    plataforma: `🧾 **Pela plataforma de recrutamento** (${link}): envie ${attachments[0]}. Se pedirem texto, copie o resumo e os bullets do resume.json — não invente respostas às perguntas de triagem.`,
    site: `🌐 **Pelo site da empresa** (${link}): preencha o formulário e envie ${files}.`,
    whatsapp: `📱 **Por WhatsApp**: adapte a mensagem direta (emails.md, item 3) e envie ${attachments[0]}. Confirme antes que o número é da empresa.`,
    desconhecido: `🔗 Abra a vaga (${link}) e siga o que ela pede. Os textos prontos estão em emails.md.`,
  };
  const step = steps[a.applyChannel] ?? steps.desconhecido;
  return a.applyInstructions ? `${step}\n\n> Instruções da vaga: ${a.applyInstructions}` : step;
}

function coverMarkdown(c: CoverLetter, name: string): string {
  return `${c.subjectLine}\n\n${c.greeting}\n\n${c.paragraphs.join("\n\n")}\n\n${c.closing}\n${name}\n`;
}

/** Gera o pacote completo de candidatura para uma vaga. */
export async function tailorJob(id: string, opts: TailorOptions = {}) {
  let job = findJob(loadJobs(), id);
  job = await ensureFullDescription(job);
  const jd = jobDescription(job);

  console.log("1/6 Analisando a vaga...");
  const analysis = await analyzeJob(jd);
  const market = opts.market ?? job.triage?.market ?? analysis.market;
  const jobLang = job.triage?.jobLanguage === "other" ? undefined : (job.triage?.jobLanguage ?? guessLanguage(jd));
  const mp = { ...marketProfile(market, jobLang) };
  if (opts.lang) mp.language = opts.lang;
  if (opts.paper) mp.paper = opts.paper;
  const wantCover = opts.cover ?? mp.coverLetter;
  console.log(`   mercado ${mp.market} · idioma ${mp.language} · papel ${mp.paper} · cover letter: ${wantCover ? "sim" : "não"}`);

  const base = loadBaseResume(mp.language);
  const sources = sourcesText();
  const guard = (r: Resume) => runGuards(r, base, sources);

  console.log("2/6 Estrategista reposicionando o currículo...");
  const draft = await strategist({ jd, analysis, base, market: mp });

  console.log("3/6 Loop hiring manager ⇄ editor...");
  const target = opts.target ?? settings.targetRating;
  const result = await refine({
    initial: draft,
    target,
    maxRevisions: opts.maxRevisions ?? settings.maxRevisions,
    guard,
    evaluate: (r) => reviewer({ jd, analysis, resume: r }),
    revise: (r, review, guards) => editor({ jd, analysis, current: r, base, review, guards, market: mp }),
    onRound: (round, i) =>
      console.log(`   rodada ${i + 1}: nota ${round.rating}${round.violations ? ` · ${round.violations} violação(ões)` : ""}`),
  });
  let final = result.best.resume;

  const dir = path.join(paths.outputDir, `${today()}-${slugify(job.company, 25)}-${slugify(analysis.roleTitle, 35)}`);
  ensureDir(dir);
  const baseName = fileBase(final, mp, job.company);

  console.log("4/6 Gerando PDF do currículo...");
  const pdfName = `${baseName}.pdf`;
  const pdfPath = path.join(dir, pdfName);
  let html = resumeHtml(final, mp.paper);
  let pages = await htmlToPdf(html, pdfPath, mp.paper);

  // Passou do limite de páginas: uma passada de enxugamento. Só fica se as travas continuarem limpas.
  if (pages > MAX_PAGES) {
    console.log(`   ${pages} páginas — enxugando para ${MAX_PAGES}...`);
    const shorter = await condenser({ jd, analysis, current: final, pages, maxPages: MAX_PAGES, market: mp });
    if (guard(shorter).violations.length <= guard(final).violations.length) {
      const shortHtml = resumeHtml(shorter, mp.paper);
      const tmp = path.join(dir, "_condensed.pdf");
      const shortPages = await htmlToPdf(shortHtml, tmp, mp.paper);
      if (shortPages < pages) {
        fs.renameSync(tmp, pdfPath);
        final = shorter;
        html = shortHtml;
        pages = shortPages;
      } else fs.rmSync(tmp, { force: true });
    }
    console.log(`   ${pages} página(s)`);
  }
  const guards = guard(final);
  fs.writeFileSync(path.join(dir, "resume.json"), JSON.stringify(final, null, 2));
  fs.writeFileSync(path.join(dir, "resume.html"), html);

  const ats = atsReport(final, analysis, sources, { pages, market: mp, fileName: pdfName });
  fs.writeFileSync(path.join(dir, "job.md"), `# ${job.title} — ${job.company}\n\n${jd}\n`);
  fs.writeFileSync(path.join(dir, "analysis.json"), JSON.stringify({ analysis, market: mp, baseName, company: job.company }, null, 2));
  fs.writeFileSync(path.join(dir, "ats_report.md"), atsMarkdown(ats));
  fs.writeFileSync(path.join(dir, "rating_report.md"), ratingReport(result, target));
  fs.writeFileSync(path.join(dir, "coverage_review.md"), coverageReview(final, base, guards, analysis));

  const attachments = [pdfName];
  if (wantCover) {
    console.log("5/6 Escrevendo cover letter / carta de apresentação...");
    const letter = await writeCoverLetter({ jd, analysis, resume: final, market: mp });
    const coverName = `${baseName.replace(`_${mp.docName}_`, "_Cover_Letter_")}.pdf`;
    const coverHtml = coverLetterHtml(final, letter, {
      company: job.company,
      paper: mp.paper,
      date: new Date().toLocaleDateString(mp.language === "en" ? "en-US" : "pt-BR", { dateStyle: "long" }),
    });
    fs.writeFileSync(path.join(dir, "cover_letter.json"), JSON.stringify(letter, null, 2));
    fs.writeFileSync(path.join(dir, "cover_letter.md"), coverMarkdown(letter, final.name));
    fs.writeFileSync(path.join(dir, "cover_letter.html"), coverHtml);
    await htmlToPdf(coverHtml, path.join(dir, coverName), mp.paper);
    attachments.push(coverName);
  } else console.log("5/6 Cover letter não necessária para este mercado (use --cover para gerar).");

  console.log("6/6 Escrevendo e-mails e mensagens para o recrutador...");
  const emails = await writeEmails({ jd, analysis, resume: final, market: mp, withCoverLetter: wantCover });
  fs.writeFileSync(path.join(dir, "emails.md"), emailsMarkdown(emails, analysis, attachments));

  if (opts.interview) {
    console.log("+ Preparação para entrevista...");
    fs.writeFileSync(path.join(dir, "interview_prep.md"), await writeInterviewPrep({ jd, analysis, resume: final, market: mp }));
  }
  await closeBrowser();

  const rating = result.best.rating;
  const ready = rating >= settings.minRating && guards.violations.length === 0;
  const verdict = ready
    ? `✅ **Pronto para revisar e enviar** (nota ${rating} ≥ ${settings.minRating}).`
    : guards.violations.length
      ? `❌ **Não envie ainda:** há violações das travas (veja coverage_review.md).`
      : `⚠️ **Baixa aderência** (nota ${rating} < ${settings.minRating}). Não recomendado enviar — as lacunas estão em rating_report.md.`;

  fs.writeFileSync(
    path.join(dir, "LEIA-ME.md"),
    `# Pacote: ${analysis.roleTitle} — ${job.company}

${verdict}

- Vaga: ${job.applyUrl ?? job.url}
- Mercado: ${mp.market} · idioma ${mp.language} · papel ${mp.paper}
- Nota final: **${result.best.rating}** (meta ${target}) · ATS: **${ats.score}%** · ${pages} página(s)
- Violações das travas: ${guards.violations.length ? `**${guards.violations.length} — leia coverage_review.md**` : "nenhuma"}

## Como se candidatar
${howToApply(analysis, job, attachments)}

## Arquivos
${attachments.map((a) => `- ${a}`).join("\n")}
- emails.md — candidatura, LinkedIn, follow-up, agradecimento
- ats_report.md · rating_report.md · coverage_review.md${opts.interview ? " · interview_prep.md" : ""}
- resume.json — edite aqui e rode \`ajf render ${job.id}\` para gerar o PDF de novo

## Antes de enviar (você aprova tudo)
- [ ] Li o PDF inteiro: datas, cargos, empresas e números conferem
- [ ] Nenhuma lacuna foi "preenchida" com algo que não fiz
- [ ] Vaga existe no site oficial da empresa; e-mail do recrutador tem domínio da empresa
- [ ] Não pediram documento, pagamento ou para baixar e rodar código
- [ ] Depois de enviar: clique em "Já me candidatei" na interface (\`ajf\`) ou rode \`ajf enviei ${job.id}\` (esta pasta vai para output/2-em-andamento)

${mp.notes.map((n) => `> ${n}`).join("\n")}
`,
  );

  const status = ready ? "tailored" : "low_fit";
  const files = {
    resume: path.join(dir, pdfName),
    coverLetter: wantCover ? path.join(dir, attachments[1]) : undefined,
  };
  // updateJob move a pasta para a subpasta do status (output/1-prontas-para-enviar ou 3-baixa-aderencia).
  const updated = updateJob(job.id, { status, outputDir: dir, rating, atsScore: ats.score, files });
  track(updated, status, ready ? "revisar e enviar" : "baixa aderência — não recomendado");
  return { dir: updated.outputDir ?? dir, rating, ready, ats: ats.score, pages, violations: guards.violations };
}

/**
 * Gera ou atualiza só o guia de entrevista, sem refazer o currículo nem mudar o status da vaga.
 * Usa o currículo que foi enviado (resume.json do pacote); sem pacote, usa o currículo-base.
 */
export async function interviewGuide(id: string): Promise<string> {
  let job = findJob(loadJobs(), id);
  const pkg = job.outputDir && fs.existsSync(path.join(job.outputDir, "analysis.json")) && fs.existsSync(path.join(job.outputDir, "resume.json"));
  let analysis: JobAnalysis;
  let mp: MarketProfile;
  let resume: Resume;
  let dir: string;
  if (pkg) {
    dir = job.outputDir!;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "analysis.json"), "utf8")) as { analysis: JobAnalysis; market: MarketProfile };
    analysis = meta.analysis;
    mp = meta.market;
    resume = ResumeSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "resume.json"), "utf8")));
  } else {
    job = await ensureFullDescription(job);
    console.log("Analisando a vaga...");
    analysis = await analyzeJob(jobDescription(job));
    const jobLang = job.triage?.jobLanguage === "other" ? undefined : (job.triage?.jobLanguage ?? guessLanguage(jobDescription(job)));
    mp = marketProfile(job.triage?.market ?? analysis.market, jobLang);
    resume = loadBaseResume(mp.language);
    dir = job.outputDir ?? path.join(paths.outputDir, `${today()}-${slugify(job.company, 25)}-${slugify(analysis.roleTitle, 35)}`);
    ensureDir(dir);
    fs.writeFileSync(path.join(dir, "job.md"), `# ${job.title} — ${job.company}\n\n${jobDescription(job)}\n`);
  }
  console.log("Escrevendo o guia de entrevista...");
  fs.writeFileSync(path.join(dir, "interview_prep.md"), await writeInterviewPrep({ jd: jobDescription(job), analysis, resume, market: mp }));
  // Vaga sem pacote ganha uma pasta própria (vai para a subpasta do status).
  const final = job.outputDir === dir ? dir : (updateJob(job.id, { outputDir: dir }).outputDir ?? dir);
  return path.join(final, "interview_prep.md");
}

/** Re-renderiza PDFs a partir de resume.json / cover_letter.json editados à mão. */
export async function rerender(dir: string) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "analysis.json"), "utf8")) as {
    analysis: JobAnalysis;
    market: MarketProfile;
    baseName: string;
    company: string;
  };
  const resume = ResumeSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "resume.json"), "utf8")));
  const mp = meta.market;
  const baseName = meta.baseName;
  const html = resumeHtml(resume, mp.paper);
  fs.writeFileSync(path.join(dir, "resume.html"), html);
  const pages = await htmlToPdf(html, path.join(dir, `${baseName}.pdf`), mp.paper);
  const coverJson = path.join(dir, "cover_letter.json");
  if (fs.existsSync(coverJson)) {
    const letter = JSON.parse(fs.readFileSync(coverJson, "utf8")) as CoverLetter;
    const coverHtml = coverLetterHtml(resume, letter, {
      company: meta.company,
      paper: mp.paper,
      date: new Date().toLocaleDateString(mp.language === "en" ? "en-US" : "pt-BR", { dateStyle: "long" }),
    });
    await htmlToPdf(coverHtml, path.join(dir, `${baseName.replace(`_${mp.docName}_`, "_Cover_Letter_")}.pdf`), mp.paper);
  }
  await closeBrowser();
  const guards = runGuards(resume, loadBaseResume(resume.language), sourcesText());
  return { pages, guards };
}
