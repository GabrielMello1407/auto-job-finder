#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { hasProfile, paths, settings } from "./config.js";
import { autopilot } from "./auto.js";
import { writeDashboard } from "./dashboard.js";
import { answerFlow, mainMenu } from "./menu.js";
import { runInit, runProfileUpdate } from "./onboarding/index.js";
import { rebuildBaseResumes } from "./onboarding/update.js";
import { chooseProvider, printProviders } from "./onboarding/provider.js";
import { openExternal } from "./util/open.js";
import { addJob, searchJobs, searchSummary } from "./jobs/search.js";
import { checkJobOpen, checkOpenJobs, closedSummary, jobFlags, OPEN_ICON, recordOpenCheck } from "./jobs/open.js";
import { SOURCES } from "./jobs/sources/index.js";
import { applicationSheet, sheetMarkdown } from "./writers/applicationSheet.js";
import { writeApplicationDraft } from "./writers/emailDraft.js";
import { select } from "@inquirer/prompts";
import { researchJob, researchLines, withoutResearch } from "./jobs/research.js";
import { findJob, loadJobs } from "./jobs/store.js";
import { APPLY_CHANNELS, changeStatus, isStatus, markApplied, pickJob, STATUS_LABELS } from "./jobs/status.js";
import { triageJobs } from "./jobs/triage.js";
import { getProvider } from "./providers/index.js";
import { renderBaseResumes } from "./render/base.js";
import { closeBrowser } from "./render/pdf.js";
import type { Job, JobStatus } from "./schemas.js";
import { rerender, tailorJob } from "./tailor/index.js";
import { startUi } from "./ui/server.js";
import { linkedinCheck, linkedinPlan, readLinkedinFile } from "./writers/linkedin.js";

const program = new Command();
program.name("ajf").description("auto-job-finder — seu agente de candidaturas").showHelpAfterError();

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

function printJobs(jobs: Job[]) {
  if (!jobs.length) return console.log("(nenhuma vaga)");
  console.log(`${pad("ID", 9)}${pad("STATUS", 12)}${pad("FIT", 10)}${pad("MERC", 7)}${pad("EMPRESA", 24)}${pad("VAGA", 46)}FONTE`);
  for (const j of jobs) {
    const fit = j.triage ? `${j.triage.fit} ${j.triage.score}` : "-";
    console.log(
      `${pad(j.id, 9)}${pad(j.status, 12)}${pad(fit, 10)}${pad(j.triage?.market ?? "-", 7)}${pad(j.company, 24)}${pad(j.title, 46)}${j.source}`,
    );
  }
}

const byScore = (a: Job, b: Job) => (b.triage?.score ?? -1) - (a.triage?.score ?? -1);

program
  .command("init")
  .description("configura o perfil a partir do seu currículo, PDF do LinkedIn, portfólio, links ou perguntas")
  .argument("[fontes...]", "arquivos (PDF/DOCX/TXT) ou links que você já quer usar")
  .action(async (inputs: string[]) => {
    await runInit({ inputs });
  });

program
  .command("ia")
  .alias("provider")
  .description("mostra as IAs detectadas (Claude, Codex, Gemini, APIs) e escolhe qual usar")
  .option("--escolher", "pergunta qual usar e salva no .env")
  .option("--testar", "faz uma chamada curta para confirmar que a IA responde")
  .action(async (o) => {
    if (o.escolher) await chooseProvider();
    printProviders();
    if (o.testar) {
      const { z } = await import("zod");
      const t0 = Date.now();
      const r = await getProvider().structured(z.object({ ok: z.boolean(), reply: z.string() }), {
        label: "ping",
        effort: "low",
        system: ["Responda em JSON."],
        user: 'Devolva ok=true e reply="pong".',
      });
      console.log(`\n✅ Respondeu em ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(r)}`);
    }
  });

program
  .command("doctor")
  .description("confere a configuração: IA, Chrome, arquivos do perfil")
  .action(() => {
    const ok = (b: boolean) => (b ? "✅" : "❌");
    printProviders();
    console.log("");
    console.log(`${ok(Boolean(settings.chromePath))} Chrome/Edge para PDF: ${settings.chromePath ?? "não encontrado — defina CHROME_PATH"}`);
    console.log(`   pasta de trabalho: ${paths.home}`);
    for (const f of [paths.profileTruth, paths.baseResume("pt-BR"), paths.baseResume("en"), paths.preferences, paths.rules])
      console.log(`${ok(fs.existsSync(f))} ${path.relative(paths.home, f)}`);
    if (!hasProfile()) console.log("\n👉 Perfil não configurado: rode 'ajf init'.");
    console.log(`   meta: ${settings.targetRating} · nota mínima: ${settings.minRating} · triagem mínima: ${settings.minTriageScore} · revisões: ${settings.maxRevisions}`);
  });

program
  .command("atualizar")
  .description("atualiza o perfil com uma novidade (projeto, emprego, curso): mostra o antes e o depois e refaz os currículos-base")
  .argument("[fontes...]", "arquivos (currículo novo, PDF do LinkedIn) ou links com a novidade")
  .option("--texto <texto>", "a novidade com as suas palavras")
  .option("--aplicar", "aplica a proposta salva (feita antes aqui ou na interface)")
  .option("--descartar", "descarta a proposta salva")
  .option("-y, --sim", "aplica sem perguntar")
  .action(async (inputs: string[], o) => {
    await runProfileUpdate({ inputs, text: o.texto, apply: o.aplicar, discard: o.descartar, yes: o.sim });
  });

program
  .command("base")
  .description("gera os PDFs dos currículos-base (sem IA); com --refazer, refaz os currículos-base a partir do profile_truth.md")
  .option("--refazer", "refaz base_resume.pt/en.json a partir do perfil (usa IA) — depois de editar o profile_truth.md à mão")
  .action(async (o) => {
    if (o.refazer) await rebuildBaseResumes();
    else await renderBaseResumes();
  });

program
  .command("search")
  .description("busca vagas nas fontes (APIs públicas e, com --web, busca na web via IA)")
  .option("-s, --sources <lista>", `fontes separadas por vírgula: ${Object.keys(SOURCES).join(",")}`)
  .option("-q, --query <termos...>", "termos de busca (sobrescreve preferences.json)")
  .option("--web", "também busca na web com IA (LinkedIn, Gupy, Indeed...) — consome tokens")
  .option("--hint <texto>", "instrução extra para a busca web (ex.: 'só vagas em Londrina')")
  .option("-v, --verbose", "mostra as vagas descartadas pelo filtro")
  .action(async (o) => {
    const r = await searchJobs({ sources: o.sources?.split(","), queries: o.query, web: o.web, webHint: o.hint });
    console.log(`\n${searchSummary(r)}`);
    r.errors.forEach((e) => console.log(`  ⚠ ${e}`));
    if (o.verbose) {
      r.dropped.forEach((d) => console.log(`  - ${d.job.company} — ${d.job.title}: ${d.reason}`));
      const all = loadJobs();
      for (const d of r.duplicates) {
        const same = all.find((j) => j.id === d.duplicateOf);
        console.log(`  🔁 ${d.company} — ${d.title} (${d.source}) = ${same ? `${same.company} — ${same.title} (${same.source})` : d.duplicateOf}`);
      }
    }
    printJobs(r.added);
    if (r.added.length) console.log(`\nPróximo passo: ajf triage`);
  });

program
  .command("triage")
  .description("IA avalia aderência das vagas novas ao seu perfil (fit, lacunas, golpe, mercado)")
  .option("-l, --limit <n>", "máximo de vagas", (v) => Number(v))
  .option("--id <ids...>", "reavaliar vagas específicas")
  .action(async (o) => {
    const done = await triageJobs({ limit: o.limit, ids: o.id });
    printJobs(done.sort(byScore));
    for (const j of done.filter((j) => j.triage?.scamSignals.length))
      console.log(`  🚩 ${j.id} ${j.company}: ${j.triage!.scamSignals.join("; ")}`);
    const top = done.filter((j) => j.status === "shortlisted").sort(byScore)[0];
    if (top) console.log(`\nPróximo passo: ajf tailor ${top.id}  (ou só "ajf" → Vagas recomendadas)`);
  });

program
  .command("jobs")
  .description("lista vagas salvas")
  .option("--status <status>", "filtra por status (new, triaged, shortlisted, tailored, applied, interview, rejected, offer, discarded)")
  .option("-a, --all", "inclui descartadas")
  .action((o) => {
    let jobs = loadJobs();
    if (o.status) jobs = jobs.filter((j) => j.status === o.status);
    else if (!o.all) jobs = jobs.filter((j) => j.status !== "discarded");
    printJobs(jobs.sort(byScore));
  });

program
  .command("show <id>")
  .description("mostra detalhes e a triagem de uma vaga")
  .action((id) => {
    const j = findJob(loadJobs(), id);
    console.log(`${j.title} — ${j.company}\n${j.location} · ${j.source} · ${j.status}\n${j.applyUrl ?? j.url}\n`);
    if (j.triage) {
      const t = j.triage;
      console.log(`Fit: ${t.fit} (${t.score}) → ${t.recommendation} · mercado ${t.market} · ${t.seniority}\n${t.reason}`);
      console.log(`Evidências:\n${t.evidence.map((e) => `  + ${e}`).join("\n")}`);
      console.log(`Lacunas:\n${t.mustHaveGaps.map((e) => `  - ${e}`).join("\n") || "  (nenhuma)"}`);
      if (t.scamSignals.length) console.log(`🚩 ${t.scamSignals.join("; ")}`);
    }
    const research = researchLines(j);
    if (research.length) console.log(`\n${research.join("\n")}`);
    const flags = jobFlags(j);
    if (flags.length) console.log(`\n${flags.join("\n")}`);
    if (j.outputDir) console.log(`\nPacote: ${j.outputDir}`);
    const text = withoutResearch(j.description);
    console.log(`\n${text.slice(0, 1500)}${text.length > 1500 ? "\n[...]" : ""}`);
  });

program
  .command("add")
  .description("adiciona uma vaga manualmente (URL ou arquivo com a descrição colada)")
  .option("--url <url>", "link da vaga (sites com login, como LinkedIn, não funcionam: use --file)")
  .option("--file <arquivo>", "arquivo .md/.txt com o texto da vaga")
  .option("--title <título>")
  .option("--company <empresa>")
  .option("--location <local>")
  .option("--pesquisar", "pesquisa a vaga e a empresa na web antes da triagem (vaga recebida sem link, por indicação ou e-mail)")
  .option("--no-triage", "não rodar a triagem automaticamente")
  .action(async (o) => {
    const job = await addJob(o);
    console.log(`Vaga adicionada: ${job.id} — ${job.title} (${job.company})`);
    if (o.pesquisar) await researchJob(job.id).catch((e) => console.log(`⚠ Pesquisa na web: ${e instanceof Error ? e.message : e}`));
    if (o.triage) {
      await triageJobs({ ids: [job.id] });
      printJobs([findJob(loadJobs(), job.id)]);
    }
    console.log(`\nPróximo passo: ajf tailor ${job.id}`);
  });

program
  .command("pesquisar")
  .argument("[busca...]", "ID ou parte do nome da empresa/cargo (sem nada, abre a lista)")
  .description("pesquisa na web uma vaga já salva: anúncio oficial, site da empresa, o que faltou no texto e se é real")
  .option("--no-triage", "não refazer a triagem com o que foi achado")
  .action(async (busca: string[], o) => {
    const job = await pickJob({ query: busca.join(" "), message: "Qual vaga pesquisar?" });
    const updated = await researchJob(job.id);
    if (o.triage && ["new", "triaged", "shortlisted"].includes(updated.status)) {
      await triageJobs({ ids: [updated.id] });
      printJobs([findJob(loadJobs(), updated.id)]);
    }
    console.log(`\nO que foi achado está no fim da descrição da vaga: ajf show ${updated.id}`);
  });

program
  .command("ficha")
  .argument("[busca...]", "ID ou parte do nome da empresa/cargo (sem nada, abre a lista)")
  .description("mostra os campos que os formulários de candidatura pedem (dados, resumo, experiências), prontos para copiar")
  .action(async (busca: string[]) => {
    const job = await pickJob({ query: busca.join(" "), message: "Para qual vaga?" });
    console.log(sheetMarkdown(applicationSheet(job), `Ficha de candidatura — ${job.company}`));
  });

program
  .command("rascunho")
  .argument("[busca...]", "ID ou parte do nome da empresa/cargo (sem nada, abre a lista)")
  .description("abre o e-mail de candidatura no seu programa de e-mail, com o currículo anexado (quem envia é você)")
  .option("--nao-abrir", "só grava o arquivo .eml na pasta do pacote")
  .action(async (busca: string[], o) => {
    const job = await pickJob({ query: busca.join(" "), statuses: ["tailored", "low_fit", "applied", "interview"], message: "De qual vaga?" });
    const file = writeApplicationDraft(job);
    if (!file) throw new Error("Esta vaga ainda não tem pacote com o e-mail de candidatura. Gere o pacote primeiro (ajf tailor).");
    console.log(`✉️ Rascunho com o currículo anexado: ${file}`);
    console.log("   Abre no Outlook ou no programa de e-mail do computador. Confira e clique em Enviar.");
    console.log("   No Gmail pelo navegador, use \"Abrir no Gmail\" na interface (aba E-mails) e arraste o PDF.");
    if (!o.naoAbrir) openExternal(file);
  });

program
  .command("conferir")
  .argument("[busca...]", "ID ou parte do nome da empresa/cargo (sem nada, confere todas que você ainda não enviou)")
  .description('confere se as vagas ainda aceitam candidaturas (página fora do ar, prazo vencido, "vaga encerrada")')
  .action(async (busca: string[]) => {
    if (busca.length) {
      const job = await pickJob({ query: busca.join(" "), message: "Qual vaga conferir?" });
      const { check } = await checkJobOpen(job);
      const updated = recordOpenCheck(job, check);
      console.log(`${OPEN_ICON[check.verdict]} ${job.company} — ${job.title}: ${check.reason}${updated.status !== job.status ? " (descartada)" : ""}`);
      return;
    }
    console.log("🔒 Conferindo as vagas que você ainda não enviou...");
    const r = await checkOpenJobs();
    console.log(closedSummary(r));
  });

program
  .command("responder")
  .argument("[busca...]", "ID ou parte do nome da empresa/cargo (sem nada, abre a lista)")
  .description("responde uma pergunta do formulário de candidatura (ex.: por que você quer trabalhar aqui?) com o seu perfil e a vaga")
  .option("-p, --pergunta <texto>", "a pergunta do formulário (sem ela, pergunta no terminal)")
  .option("--limite <n>", "limite de caracteres do campo", (v) => Number(v))
  .option("--contexto <texto>", "algo que só você sabe para esta resposta (motivação, opinião sobre o produto)")
  .action(async (busca: string[], o) => {
    const job = await pickJob({ query: busca.join(" "), message: "Para qual vaga?" });
    await answerFlow(job, o.pergunta ? { question: o.pergunta, limit: o.limite || undefined, context: o.contexto } : undefined);
  });

program
  .command("tailor <id>")
  .description("gera o pacote da vaga: currículo ATS (PDF), cover letter, e-mails e relatórios")
  .addOption(new Option("--lang <lang>", "idioma do currículo").choices(["pt-BR", "en"]))
  .addOption(new Option("--paper <papel>", "tamanho do papel").choices(["A4", "Letter"]))
  .addOption(new Option("--market <mercado>", "força o mercado").choices(["BR", "US", "CA", "UK", "EU", "LATAM", "GLOBAL"]))
  .option("--cover", "força gerar cover letter / carta de apresentação")
  .option("--no-cover", "não gerar cover letter")
  .option("--interview", "gera também o guia de preparação para entrevista")
  .option("--max-revisions <n>", "rodadas de revisão", (v) => Number(v))
  .option("--target <nota>", "nota-alvo do hiring manager", (v) => Number(v))
  .option("--mesmo-encerrada", "gera mesmo se a página da vaga disser que ela foi encerrada")
  .action(async (id, o, cmd) => {
    const coverSource = cmd.getOptionValueSource("cover");
    const r = await tailorJob(id, {
      lang: o.lang,
      paper: o.paper,
      market: o.market,
      cover: coverSource === "cli" ? o.cover : undefined,
      interview: o.interview,
      maxRevisions: o.maxRevisions,
      target: o.target,
      ignoreClosed: o.mesmoEncerrada,
    });
    console.log(`\n✅ Pacote pronto: ${r.dir}\n   nota ${r.rating} · ATS ${r.ats}% · ${r.pages} página(s)`);
    r.violations.forEach((v) => console.log(`   ❌ ${v}`));
    console.log(`   Leia LEIA-ME.md e revise tudo antes de enviar.`);
  });

program
  .command("render <pasta-ou-id>")
  .description("gera de novo os PDFs depois de editar resume.json / cover_letter.json à mão")
  .action(async (arg: string) => {
    const dir = fs.existsSync(arg) ? path.resolve(arg) : findJob(loadJobs(), arg).outputDir;
    if (!dir) throw new Error(`A vaga '${arg}' não tem pacote gerado.`);
    const r = await rerender(dir);
    console.log(`PDF gerado (${r.pages} pág.). Violações: ${r.guards.violations.length}`);
    r.guards.violations.forEach((v) => console.log(`   ❌ ${v}`));
    r.guards.warnings.forEach((v) => console.log(`   ⚠ ${v}`));
  });

program
  .command("linkedin")
  .description("plano de LinkedIn (headline, Sobre PT/EN, competências, destaques); com --conferir, confere o LinkedIn atual")
  .option("--current <arquivo>", "o seu LinkedIn hoje: o PDF exportado (Mais → Salvar como PDF) ou o texto num .md/.txt")
  .option("--conferir", "em vez de um plano novo, confere o LinkedIn atual contra o perfil e o último plano (precisa de --current)")
  .option("--families <famílias...>", "famílias de vaga-alvo")
  .action(async (o) => {
    if (o.conferir) {
      if (!o.current) throw new Error("Para conferir, informe o LinkedIn atual: --current perfil_linkedin.pdf");
      const file = await linkedinCheck(await readLinkedinFile(o.current));
      console.log(`Conferência salva em ${file}`);
      return;
    }
    const file = await linkedinPlan({ currentProfileFile: o.current, families: o.families });
    console.log(`Plano salvo em ${file}`);
  });

program
  .command("enviei")
  .argument("[busca...]", "ID ou parte do nome da empresa/cargo (sem nada, abre a lista)")
  .description("marca que você se candidatou a uma vaga. Ex.: ajf enviei boticario")
  .option("--note <texto>", "observação, ex.: 'indicação do Fulano'")
  .addOption(new Option("--via <canal>", "por onde você se candidatou").choices(Object.keys(APPLY_CHANNELS)))
  .action(async (busca: string[], o) => {
    await markApplied(busca.join(" "), o.note, o.via);
  });

program
  .command("status")
  .argument("[busca]", "ID ou parte do nome da empresa/cargo (sem nada, abre a lista)")
  .argument("[status]", Object.keys(STATUS_LABELS).join(", "))
  .description("atualiza o status de uma vaga e registra no tracker.csv. Ex.: ajf status boticario interview")
  .option("--note <texto>")
  .option("--next <texto>", "próximo passo")
  .action(async (busca: string | undefined, status: string | undefined, o) => {
    // "ajf status interview": só o status, escolhe a vaga na lista.
    if (isStatus(busca) && !status) [busca, status] = [undefined, busca];
    if (status && !isStatus(status)) throw new Error(`Status '${status}' não existe. Opções: ${Object.keys(STATUS_LABELS).join(", ")}`);
    const job = await pickJob({ query: busca, message: "Qual vaga?" });
    const given = isStatus(status) ? status : undefined;
    const next: JobStatus =
      given ??
      (await select({
        message: `${job.company} — ${job.title} (agora: ${STATUS_LABELS[job.status]})`,
        choices: Object.entries(STATUS_LABELS).map(([value, name]) => ({ name, value: value as JobStatus })),
      }));
    const updated = changeStatus(job, next, o.note ?? "", o.next);
    console.log(`${updated.company} — ${updated.title} → ${STATUS_LABELS[next]} (registrado em ${path.relative(paths.root, paths.tracker)})`);
  });

program
  .command("auto")
  .alias("run")
  .description(`piloto automático: busca → triagem → pacotes para as melhores (triagem ≥ ${settings.minTriageScore}) → painel`)
  .option("--web", "inclui busca na web via IA (LinkedIn, Gupy, Indeed). Padrão: preferences.json → webSearchByDefault")
  .option("--no-web", "não usa busca na web nesta rodada")
  .option("--max <n>", "máximo de pacotes nesta rodada", (v) => Number(v), 3)
  .option("--interview", "gera guia de entrevista em cada pacote")
  .option("--open", "abre o painel no navegador ao final")
  .action(async (o, cmd) => {
    const web = cmd.getOptionValueSource("web") === "cli" ? o.web : undefined;
    const r = await autopilot({ web, maxPackages: o.max, interview: o.interview });
    if (o.open) openExternal(r.dashboard);
  });

program
  .command("painel")
  .description("gera e abre o painel de vagas no navegador (output/painel.html)")
  .action(() => {
    const file = writeDashboard();
    openExternal(file);
    console.log(file);
  });

program
  .command("ui", { isDefault: true })
  .alias("interface")
  .description("abre a interface no navegador para gerenciar tudo (padrão quando você roda só 'ajf')")
  .option("--port <n>", "porta local (padrão 4317 ou AJF_UI_PORT)", (v) => Number(v))
  .option("--no-open", "não abre o navegador sozinho (só mostra o link)")
  .action(async (o) => {
    // Sem perfil, a própria interface abre no cadastro.
    await startUi({ port: o.port, open: o.open });
  });

program
  .command("menu")
  .description("menu interativo no terminal")
  .action(async () => {
    await mainMenu();
  });

// Mantém o painel sempre atualizado depois de qualquer comando.
program.hook("postAction", () => {
  try {
    writeDashboard();
  } catch {
    /* painel é opcional */
  }
});

program.parseAsync().catch(async (e) => {
  await closeBrowser().catch(() => {});
  console.error(`\n❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
