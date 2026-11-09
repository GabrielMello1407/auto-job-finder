import fs from "node:fs";
import path from "node:path";
import { checkbox, confirm, editor, input, number, select, Separator } from "@inquirer/prompts";
import { autopilot, candidatesForPackage } from "./auto.js";
import { hasProfile, settings } from "./config.js";
import { canWebSearch } from "./llm.js";
import { runInit, runProfileUpdate } from "./onboarding/index.js";
import { rebuildBaseResumes } from "./onboarding/update.js";
import { chooseProvider, printProviders } from "./onboarding/provider.js";
import { loadPreferences } from "./profile.js";
import { writeDashboard } from "./dashboard.js";
import { addJob, searchJobs, searchSummary } from "./jobs/search.js";
import { checkJobOpen, checkOpenJobs, closedSummary, jobFlags, OPEN_ICON, recordOpenCheck } from "./jobs/open.js";
import { researchJob, researchLines, withoutResearch } from "./jobs/research.js";
import { findJob, loadJobs, markNotDuplicate } from "./jobs/store.js";
import { changeStatus, markApplied } from "./jobs/status.js";
import { triageJobs } from "./jobs/triage.js";
import type { Job, JobStatus } from "./schemas.js";
import { interviewGuide, JobClosedError, tailorJob } from "./tailor/index.js";
import { openExternal } from "./util/open.js";
import { linkedinCheck, linkedinPlan, readLinkedinFile } from "./writers/linkedin.js";
import { ANSWERS_FILE, answerQuestion, refineAnswer } from "./writers/answers.js";
import { applicationSheet, sheetMarkdown } from "./writers/applicationSheet.js";
import { writeApplicationDraft } from "./writers/emailDraft.js";
import type { JobAnswer } from "./schemas.js";

const BACK = "__back__";
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function label(j: Job): string {
  const score = j.rating != null ? `nota ${j.rating}` : j.triage ? `triagem ${j.triage.score}` : "sem triagem";
  return `${score.padEnd(12)} ${(j.triage?.market ?? "").padEnd(3)} ${cut(j.company, 22).padEnd(22)}  ${cut(j.title, 60)}`;
}

function refresh() {
  try {
    writeDashboard();
  } catch {
    /* painel é opcional */
  }
}

function printDetails(j: Job) {
  console.log(`\n${j.title} — ${j.company}\n${j.location} · ${j.source} · status: ${j.status}\n${j.applyUrl ?? j.url}`);
  if (j.triage) {
    const t = j.triage;
    console.log(`\nTriagem: ${t.fit} (${t.score}) → ${t.recommendation} · ${t.market} · ${t.seniority}\n${t.reason}`);
    if (t.evidence.length) console.log(`Evidências:\n${t.evidence.map((e) => `  + ${e}`).join("\n")}`);
    if (t.mustHaveGaps.length) console.log(`Lacunas:\n${t.mustHaveGaps.map((e) => `  - ${e}`).join("\n")}`);
    if (t.scamSignals.length) console.log(`🚩 ${t.scamSignals.join("; ")}`);
  }
  const research = researchLines(j);
  if (research.length) console.log(`\n${research.join("\n")}`);
  const extra = jobFlags(j);
  if (extra.length) console.log(`\n${extra.join("\n")}`);
  console.log(`\n${withoutResearch(j.description).slice(0, 1200)}${j.description.length > 1200 ? "\n[...]" : ""}\n`);
}

function printAnswer(a: JobAnswer) {
  console.log(`\n💬 ${a.question}\n\n${a.answer}\n\n(${a.answer.length} caracteres${a.limit ? ` de ${a.limit}` : ""})`);
  if (a.warnings?.length) console.log(`⚠ Confira: ${a.warnings.join("; ")}`);
  if (a.needsYou.length) console.log(`Para ficar com a sua cara, conte:\n${a.needsYou.map((n) => `  - ${n}`).join("\n")}`);
}

/** Pergunta do formulário de candidatura: responde e deixa ajustar até a pessoa dar Enter. Também usado pelo `ajf responder`. */
export async function answerFlow(job: Job, given?: { question: string; limit?: number; context?: string }) {
  const question = given?.question ?? (await input({ message: "Pergunta do formulário:", required: true }));
  const limit = given ? given.limit : Number(await input({ message: "Limite de caracteres (Enter se não tiver):" })) || undefined;
  const context = given ? given.context : await input({ message: "Algo que só você sabe para esta resposta (motivação, opinião sobre o produto; Enter para pular):" });
  console.log("✍️ Escrevendo...");
  let a = await answerQuestion(job.id, { question, limit, context });
  for (;;) {
    printAnswer(a);
    if (!process.stdin.isTTY) break;
    const instruction = await input({ message: "Ajustar? (ex.: mais curto, cite o projeto X, ou responda o que falta; Enter para terminar)" });
    if (!instruction.trim()) break;
    console.log("✍️ Ajustando...");
    a = await refineAnswer(job.id, a.id, { instruction });
  }
  const dir = findJob(loadJobs(), job.id).outputDir;
  console.log(dir ? `\nSalvo em ${path.join(dir, ANSWERS_FILE)}` : "\nSalvo na vaga. O arquivo entra na pasta da vaga quando o pacote for gerado.");
}

function emailSection(j: Job, heading: string): string | null {
  if (!j.outputDir) return null;
  const file = path.join(j.outputDir, "emails.md");
  if (!fs.existsSync(file)) return null;
  const md = fs.readFileSync(file, "utf8");
  const start = md.indexOf(heading);
  if (start < 0) return null;
  const next = md.indexOf("\n## ", start + 3);
  return md.slice(start, next < 0 ? undefined : next).trim();
}

async function makePackages(jobs: Job[]) {
  const interview = await confirm({ message: "Gerar também o guia de entrevista?", default: false });
  for (const [i, j] of jobs.entries()) {
    console.log(`\n📦 ${i + 1}/${jobs.length}: ${j.company} — ${j.title}`);
    try {
      let r;
      try {
        r = await tailorJob(j.id, { interview });
      } catch (e) {
        if (!(e instanceof JobClosedError)) throw e;
        console.log(`   🔒 A vaga parece encerrada: ${e.check.reason}.`);
        if (!(await confirm({ message: "Ela ainda está aberta? Gerar o pacote mesmo assim?", default: false }))) continue;
        r = await tailorJob(j.id, { interview, ignoreClosed: true });
      }
      console.log(`   nota ${r.rating} · ATS ${r.ats}% · ${r.pages} pág. → ${r.ready ? "✅ pronto para revisar" : "⚠ baixa aderência"}`);
    } catch (e) {
      console.log(`   ❌ ${(e as Error).message}`);
    }
  }
  refresh();
}

/** Confere uma vaga; sem pacote e encerrada, ela vai para "Encerradas". */
async function checkOneFlow(job: Job) {
  console.log("🔒 Conferindo...");
  const { check } = await checkJobOpen(job);
  const updated = recordOpenCheck(job, check);
  console.log(`${OPEN_ICON[check.verdict]} ${check.reason}${updated.status !== job.status ? ' — vaga movida para "Encerradas" (dá para reabrir)' : ""}`);
  refresh();
}

/* ------------------------------ fluxos ------------------------------ */

async function autopilotFlow() {
  const web = canWebSearch() && (await confirm({ message: "Incluir busca na web com IA (LinkedIn, Gupy, Indeed)? Mais lento.", default: loadPreferences().webSearchByDefault }));
  const max = (await number({ message: "Quantos pacotes gerar no máximo?", default: 3, min: 0, max: 15 })) ?? 3;
  const interview = await confirm({ message: "Gerar guia de entrevista em cada pacote?", default: false });
  const r = await autopilot({ web, maxPackages: max, interview });
  if (r.results.some((x) => x.ready) && (await confirm({ message: "Abrir o painel no navegador?", default: true })))
    openExternal(r.dashboard);
}

async function searchFlow() {
  const web = canWebSearch() && (await confirm({ message: "Incluir busca na web com IA (LinkedIn, Gupy, Indeed)?", default: loadPreferences().webSearchByDefault }));
  const s = await searchJobs({ web });
  console.log(`   ${searchSummary(s)}`);
  s.errors.forEach((e) => console.log(`   ⚠ ${e}`));
  if (loadJobs().some((j) => j.status === "new")) {
    console.log("🧠 Triagem...");
    const t = await triageJobs();
    console.log(`   ${t.filter((j) => j.status === "shortlisted").length} recomendadas de ${t.length}`);
  }
  refresh();
}

async function recommendedFlow() {
  for (;;) {
    const jobs = loadJobs()
      .filter((j) => j.status === "shortlisted" || j.status === "triaged")
      .sort((a, b) => (b.triage?.score ?? 0) - (a.triage?.score ?? 0));
    if (!jobs.length) return console.log("Nenhuma vaga recomendada. Rode a busca primeiro.");
    const pick = await select({
      message: "Vagas recomendadas (⭐ = triagem ≥ " + settings.minTriageScore + ")",
      pageSize: 15,
      choices: [
        { name: "📦 Gerar pacotes para várias de uma vez…", value: "__multi__" },
        { name: "⬅ Voltar", value: BACK },
        new Separator(),
        ...jobs.map((j) => ({ name: `${(j.triage?.score ?? 0) >= settings.minTriageScore ? "⭐" : "  "} ${label(j)}`, value: j.id })),
      ],
    });
    if (pick === BACK) return;
    if (pick === "__multi__") {
      const ids = await checkbox({
        message: "Marque com ESPAÇO e confirme com ENTER",
        pageSize: 15,
        choices: jobs.map((j) => ({ name: label(j), value: j.id, checked: candidatesForPackage(jobs).slice(0, 3).some((c) => c.id === j.id) })),
      });
      if (ids.length) await makePackages(ids.map((id) => findJob(loadJobs(), id)));
      continue;
    }
    const job = findJob(loadJobs(), pick);
    const action = await select({
      message: `${job.company} — ${cut(job.title, 60)}`,
      choices: [
        { name: "📦 Gerar pacote (currículo, cover letter, e-mails)", value: "tailor" },
        { name: "🔍 Ver detalhes e lacunas", value: "details" },
        { name: "📝 Responder pergunta do formulário", value: "answer" },
        { name: "📋 Ficha de candidatura (campos do formulário para copiar)", value: "sheet" },
        { name: "🔗 Abrir a vaga no navegador", value: "open" },
        { name: "🔒 Conferir se a vaga ainda está aberta", value: "check" },
        ...(job.duplicateOf ? [{ name: "🔁 Não é a mesma vaga (tirar a marca de repetida)", value: "notdup" }] : []),
        ...(canWebSearch()
          ? [{ name: job.research ? "🔎 Pesquisar de novo na web" : "🔎 Pesquisar a vaga e a empresa na web", value: "research" }]
          : []),
        { name: "✅ Já me candidatei (marcar como enviada)", value: "applied" },
        { name: "🗑 Descartar", value: "discard" },
        { name: "⬅ Voltar", value: BACK },
      ],
    });
    if (action === "tailor") await makePackages([job]);
    if (action === "details") printDetails(job);
    if (action === "answer") await answerFlow(job);
    if (action === "research") {
      await researchJob(job.id);
      await triageJobs({ ids: [job.id] });
      printDetails(findJob(loadJobs(), job.id));
    }
    if (action === "open") openExternal(job.applyUrl ?? job.url);
    if (action === "check") await checkOneFlow(job);
    if (action === "sheet") console.log("\n" + sheetMarkdown(applicationSheet(job), `Ficha de candidatura — ${job.company}`));
    if (action === "notdup") {
      markNotDuplicate(job.id);
      console.log("Marca de repetida tirada.");
    }
    if (action === "applied") {
      await markApplied(job.id);
      refresh();
    }
    if (action === "discard") {
      changeStatus(job, "discarded");
      refresh();
    }
  }
}

async function packagesFlow() {
  for (;;) {
    const jobs = loadJobs()
      .filter((j) => j.status === "tailored" || j.status === "low_fit")
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (!jobs.length) return console.log("Nenhum pacote gerado ainda.");
    const pick = await select({
      message: `Meus pacotes (✅ nota ≥ ${settings.minRating} · ⚠ baixa aderência)`,
      pageSize: 15,
      choices: [
        { name: "⬅ Voltar", value: BACK },
        new Separator(),
        ...jobs.map((j) => ({ name: `${j.status === "tailored" ? "✅" : "⚠ "} ${label(j)}`, value: j.id })),
      ],
    });
    if (pick === BACK) return;
    const job = findJob(loadJobs(), pick);
    for (;;) {
      const action = await select({
        message: `${job.company} — ${cut(job.title, 50)} (nota ${job.rating ?? "?"})`,
        choices: [
          { name: "📄 Abrir currículo (PDF)", value: "pdf" },
          ...(job.files?.coverLetter ? [{ name: "✉️ Abrir cover letter (PDF)", value: "cover" }] : []),
          { name: "✉️ Abrir o e-mail de candidatura no programa de e-mail (com o currículo anexado)", value: "draft" },
          { name: "📧 Mostrar e-mail de candidatura", value: "email" },
          { name: "📋 Ficha de candidatura (campos do formulário para copiar)", value: "sheet" },
          { name: "💬 Mostrar mensagens de LinkedIn", value: "linkedin" },
          { name: "📝 Responder pergunta do formulário", value: "answer" },
          { name: "🔗 Abrir a vaga para me candidatar", value: "apply" },
          { name: "🔒 Conferir se a vaga ainda está aberta", value: "check" },
          ...(job.duplicateOf ? [{ name: "🔁 Não é a mesma vaga (tirar a marca de repetida)", value: "notdup" }] : []),
          { name: "📁 Abrir pasta do pacote", value: "folder" },
          { name: "✅ Marcar como enviado", value: "applied" },
          { name: "🔄 Gerar de novo", value: "redo" },
          { name: "🗑 Descartar", value: "discard" },
          { name: "⬅ Voltar", value: BACK },
        ],
      });
      if (action === BACK) break;
      if (action === "pdf" && job.files?.resume) openExternal(job.files.resume);
      if (action === "cover" && job.files?.coverLetter) openExternal(job.files.coverLetter);
      if (action === "folder" && job.outputDir) openExternal(job.outputDir);
      if (action === "apply") openExternal(job.applyUrl ?? job.url);
      if (action === "check") await checkOneFlow(job);
      if (action === "draft") {
        const file = writeApplicationDraft(job);
        if (file) {
          openExternal(file);
          console.log(`✉️ Abrindo ${file}. Confira e clique em Enviar. (No Gmail pelo navegador: interface → aba E-mails → "Abrir no Gmail".)`);
        } else console.log("Este pacote não tem o e-mail de candidatura.");
      }
      if (action === "sheet") console.log("\n" + sheetMarkdown(applicationSheet(job), `Ficha de candidatura — ${job.company}`));
      if (action === "notdup") {
        Object.assign(job, markNotDuplicate(job.id));
        console.log("Marca de repetida tirada.");
      }
      if (action === "answer") await answerFlow(job);
      if (action === "email") console.log("\n" + (emailSection(job, "## 1.") ?? "emails.md não encontrado") + "\n");
      if (action === "linkedin")
        console.log("\n" + [emailSection(job, "## 2."), emailSection(job, "## 3.")].filter(Boolean).join("\n\n") + "\n");
      if (action === "redo") {
        await makePackages([job]);
        break;
      }
      if (action === "applied") await markApplied(job.id);
      if (action === "discard") {
        changeStatus(job, "discarded");
        console.log("Descartada.");
      }
      if (action === "applied" || action === "discard") {
        refresh();
        break;
      }
    }
  }
}

async function activeFlow() {
  const jobs = loadJobs()
    .filter((j) => ["applied", "interview", "offer"].includes(j.status))
    .sort((a, b) => (b.appliedAt ?? "").localeCompare(a.appliedAt ?? ""));
  if (!jobs.length) return console.log("Nenhuma candidatura enviada ainda.");
  const pick = await select({
    message: "Candidaturas em andamento",
    pageSize: 15,
    choices: [
      { name: "⬅ Voltar", value: BACK },
      new Separator(),
      ...jobs.map((j) => {
        const days = j.appliedAt ? Math.floor((Date.now() - Date.parse(j.appliedAt)) / 86400_000) : null;
        const flag = j.status === "applied" && days != null && days >= 7 ? " ⏰ follow-up!" : "";
        return { name: `${j.status.padEnd(10)} ${days != null ? `${days}d` : ""}  ${cut(j.company, 22)} — ${cut(j.title, 50)}${flag}`, value: j.id };
      }),
    ],
  });
  if (pick === BACK) return;
  const job = findJob(loadJobs(), pick);
  const action = await select({
    message: `${job.company} — ${cut(job.title, 50)}`,
    choices: [
      { name: "⏰ Mostrar e-mail de follow-up", value: "followup" },
      { name: "🙏 Mostrar agradecimento pós-entrevista", value: "thanks" },
      { name: "📝 Responder pergunta do formulário", value: "answer" },
      { name: "🎤 Fui chamado para entrevista", value: "interview" },
      { name: "🎉 Recebi oferta", value: "offer" },
      { name: "❌ Fui recusado", value: "rejected" },
      { name: "📁 Abrir pasta do pacote", value: "folder" },
      { name: "⬅ Voltar", value: BACK },
    ],
  });
  if (action === "followup") console.log("\n" + (emailSection(job, "## 4.") ?? "emails.md não encontrado") + "\n");
  if (action === "thanks") console.log("\n" + (emailSection(job, "## 5.") ?? "emails.md não encontrado") + "\n");
  if (action === "folder" && job.outputDir) openExternal(job.outputDir);
  if (action === "answer") await answerFlow(job);
  if (action === "interview" || action === "offer" || action === "rejected") {
    changeStatus(job, action);
    refresh();
    if (action === "interview" && (await confirm({ message: "Gerar/atualizar o guia de entrevista agora?", default: true })))
      console.log(`🎤 Guia salvo em ${await interviewGuide(job.id)}`);
  }
}

async function pasteFlow() {
  const text = await editor({
    message: "Vou abrir o editor: cole a descrição completa da vaga, salve e feche.",
    postfix: ".md",
    waitForUserInput: false,
  });
  if (!text.trim()) return console.log("Nada colado.");
  const company = await input({ message: "Empresa:", required: true });
  const title = await input({ message: "Cargo:", required: true });
  const url = await input({ message: "Link da vaga (Enter para pular):" });
  const research =
    canWebSearch() &&
    (await confirm({
      message: "Pesquisar a vaga e a empresa na web (anúncio oficial, o que faltou no texto, se é real)?",
      default: !url.trim(),
    }));
  const job = await addJob({ text, company, title, url: url || undefined });
  if (research) await researchJob(job.id).catch((e) => console.log(`⚠ Pesquisa na web: ${e instanceof Error ? e.message : e}`));
  console.log("🧠 Triagem...");
  await triageJobs({ ids: [job.id] });
  const j = findJob(loadJobs(), job.id);
  printDetails(j);
  if (await confirm({ message: "Gerar o pacote agora?", default: j.status === "shortlisted" })) await makePackages([j]);
  refresh();
}

/** O LinkedIn atual: caminho do PDF exportado ou texto colado no editor. */
async function askCurrentLinkedin(required: boolean): Promise<string> {
  const how = await select({
    message: "Como mandar o seu LinkedIn de hoje? (o agente não acessa o LinkedIn)",
    choices: [
      { name: "📄 PDF do perfil (no LinkedIn: Mais → Salvar como PDF)", value: "pdf" },
      { name: "📝 Colar o texto do perfil", value: "text" },
      ...(required ? [] : [{ name: "Pular", value: "skip" }]),
    ],
  });
  if (how === "skip") return "";
  if (how === "pdf") return readLinkedinFile((await input({ message: "Caminho do PDF (pode arrastar o arquivo para o terminal):" })).trim().replace(/^["']|["']$/g, ""));
  return (await editor({ message: "Vou abrir o editor: cole o texto do seu LinkedIn, salve e feche.", waitForUserInput: false })).trim();
}

async function linkedinFlow() {
  const action = await select({
    message: "LinkedIn",
    choices: [
      { name: "✅ Conferir meu LinkedIn (o que está certo, o que falta do plano, o que corrigir)", value: "check" },
      { name: "✨ Gerar um plano novo", value: "plan" },
      { name: "⬅ Voltar", value: BACK },
    ],
  });
  if (action === BACK) return;
  if (action === "check") console.log(`Conferência salva em ${await linkedinCheck(await askCurrentLinkedin(true))}`);
  if (action === "plan") {
    const current = await askCurrentLinkedin(false);
    console.log(`Plano salvo em ${await linkedinPlan({ current: current || undefined })}`);
  }
}

async function profileFlow() {
  const action = await select({
    message: "Atualizar meu perfil",
    choices: [
      { name: "➕ Contar uma novidade (projeto, emprego, curso, resultado)", value: "update" },
      { name: "🔄 Refazer os currículos-base a partir do profile_truth.md (depois de editar à mão)", value: "rebuild" },
      { name: "🧭 Montar o perfil do zero (novo currículo, LinkedIn, portfólio)", value: "init" },
      { name: "⬅ Voltar", value: BACK },
    ],
  });
  if (action === "update") await runProfileUpdate({});
  if (action === "rebuild") await rebuildBaseResumes();
  if (action === "init") await runInit();
  refresh();
}

/* ------------------------------ menu principal ------------------------------ */

export async function mainMenu() {
  if (!hasProfile()) {
    console.log("\n👋 Bem-vindo! Primeiro vou montar seu perfil (currículo, LinkedIn, portfólio ou perguntas).");
    try {
      await runInit();
    } catch (e) {
      if ((e as Error).name === "ExitPromptError") return;
      console.log(`\n❌ ${(e as Error).message}`);
    }
    if (!hasProfile()) return;
  }
  refresh();
  for (;;) {
    const jobs = loadJobs();
    const count = (...s: JobStatus[]) => jobs.filter((j) => s.includes(j.status)).length;
    const due = jobs.filter(
      (j) => j.status === "applied" && j.appliedAt && Date.now() - Date.parse(j.appliedAt) >= 7 * 86400_000,
    ).length;
    console.log("");
    const choice = await select({
      message: "auto-job-finder — o que vamos fazer?",
      pageSize: 14,
      choices: [
        { name: "🤖 Piloto automático (buscar → triar → gerar pacotes)", value: "auto" },
        { name: `⭐ Vagas recomendadas (${count("shortlisted")} + ${count("triaged")} para decidir)`, value: "recommended" },
        { name: `📦 Meus pacotes (${count("tailored")} prontos, ${count("low_fit")} baixa aderência)`, value: "packages" },
        { name: "✅ Já me candidatei a uma vaga (marcar como enviada)", value: "sent" },
        { name: `📨 Candidaturas em andamento (${count("applied", "interview", "offer")})${due ? ` — ⏰ ${due} follow-up` : ""}`, value: "active" },
        { name: "➕ Colar uma vaga (LinkedIn, Gupy, indicação)", value: "paste" },
        { name: "🔎 Só buscar e triar vagas novas", value: "search" },
        { name: "🔒 Conferir se as vagas ainda estão abertas", value: "check" },
        { name: "🌐 Abrir painel no navegador", value: "dashboard" },
        { name: "🔗 LinkedIn: plano ou conferência", value: "linkedin" },
        { name: "🧭 Atualizar meu perfil (novidade, currículos-base ou do zero)", value: "init" },
        { name: "🤖 Escolher a IA (Claude, ChatGPT/Codex, Gemini, APIs)", value: "ia" },
        { name: "Sair", value: "exit" },
      ],
    });
    try {
      if (choice === "exit") return;
      if (choice === "auto") await autopilotFlow();
      if (choice === "recommended") await recommendedFlow();
      if (choice === "packages") await packagesFlow();
      if (choice === "sent") {
        await markApplied();
        refresh();
      }
      if (choice === "active") await activeFlow();
      if (choice === "paste") await pasteFlow();
      if (choice === "search") await searchFlow();
      if (choice === "check") {
        console.log("🔒 Conferindo as vagas que você ainda não enviou...");
        console.log(closedSummary(await checkOpenJobs()));
        refresh();
      }
      if (choice === "dashboard") openExternal(writeDashboard());
      if (choice === "linkedin") await linkedinFlow();
      if (choice === "init") await profileFlow();
      if (choice === "ia") {
        await chooseProvider();
        printProviders();
      }
    } catch (e) {
      if ((e as Error).name === "ExitPromptError") return;
      console.log(`\n❌ ${(e as Error).message}`);
    }
  }
}
