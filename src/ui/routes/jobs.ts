import fs from "node:fs";
import path from "node:path";
import { autopilot } from "../../auto.js";
import { hasProfile, paths, setEnvVar, settings } from "../../config.js";
import { canWebSearch } from "../../llm.js";
import { loadPreferences } from "../../profile.js";
import { activeProviderId, detectProviders, getProvider, normalizeProviderId, providerInfo, type ProviderId } from "../../providers/index.js";
import { addJob, searchJobs, searchSummary } from "../../jobs/search.js";
import { CHECKABLE, checkJobOpen, checkOpenJobs, closedSummary, OPEN_ICON, recordOpenCheck } from "../../jobs/open.js";
import { APPLY_CHANNELS, changeStatus, guessApplyVia, isApplyVia, isStatus, SENDABLE, STATUS_LABELS } from "../../jobs/status.js";
import { findJob, loadJobs, markNotDuplicate } from "../../jobs/store.js";
import { triageJobs } from "../../jobs/triage.js";
import type { Job } from "../../schemas.js";
import { profileChangedAt } from "../../onboarding/update.js";
import { researchJob } from "../../jobs/research.js";
import { interviewGuide, rerender, tailorJob, type TailorOptions } from "../../tailor/index.js";
import { openExternal } from "../../util/open.js";
import { cleanJobText } from "../../jobs/page.js";
import { answerQuestion, deleteAnswer, refineAnswer } from "../../writers/answers.js";
import { applicationSheet } from "../../writers/applicationSheet.js";
import { applicationDraft, DRAFT_FILE, gmailComposeUrl, parseEmails, writeApplicationDraft } from "../../writers/emailDraft.js";
import { clamp, fileUrl, HttpError, isHttp, str, strList, type App, type Ctx, type Route } from "../http.js";

/** Vagas, tarefas longas (busca, triagem, pacotes) e escolha da IA. */

/** Tradutor da chamada (c.t): nome e resultado da tarefa saem no idioma de quem pediu. */
type Tr = Ctx["t"];

/** Situação da IA na tela: "encontrado em <caminho>" e "endpoint <url>" levam o valor junto. */
function providerDetail(t: Tr, detail: string): string {
  const found = /^encontrado em (.+)$/.exec(detail);
  if (found) return t("encontrado em {path}", { path: found[1] });
  return detail.startsWith("endpoint ") ? detail : t(detail);
}

function packageDir(j: Job): string | undefined {
  return j.outputDir && fs.existsSync(j.outputDir) ? j.outputDir : undefined;
}

/** Pacote pronto ou de baixa aderência gerado antes da última mudança no perfil. Enviados não contam. */
function packageOutdated(j: Job, dir: string | undefined, changedAt: number): boolean {
  if (!dir || !["tailored", "low_fit"].includes(j.status)) return false;
  try {
    return fs.statSync(path.join(dir, "LEIA-ME.md")).mtimeMs < changedAt;
  } catch {
    return false;
  }
}

export function jobSummary(j: Job, changedAt = profileChangedAt()) {
  const dir = packageDir(j);
  const has = (f: string) => Boolean(dir && fs.existsSync(path.join(dir, f)));
  return {
    id: j.id,
    title: j.title,
    company: j.company,
    location: j.location,
    remote: j.remote,
    source: j.source,
    status: j.status,
    statusLabel: STATUS_LABELS[j.status],
    url: isHttp(j.applyUrl) ? j.applyUrl : isHttp(j.url) ? j.url : undefined,
    salary: j.salary,
    postedAt: j.postedAt,
    addedAt: j.addedAt,
    appliedAt: j.appliedAt,
    appliedVia: j.appliedVia,
    appliedViaLabel: j.appliedVia ? APPLY_CHANNELS[j.appliedVia] : undefined,
    // Canal provável, para já vir marcado no "Já me candidatei".
    applyGuess: SENDABLE.includes(j.status) ? guessApplyVia(j) : undefined,
    notes: j.notes,
    rating: j.rating,
    atsScore: j.atsScore,
    triage: j.triage && {
      score: j.triage.score,
      fit: j.triage.fit,
      reason: j.triage.reason,
      market: j.triage.market,
      seniority: j.triage.seniority,
      recommendation: j.triage.recommendation,
      scam: j.triage.scamSignals,
    },
    research: j.research && {
      verdict: j.research.verdict,
      postingUrl: isHttp(j.research.postingUrl) ? j.research.postingUrl : undefined,
      companySite: isHttp(j.research.companySite) ? j.research.companySite : undefined,
      notes: j.research.notes,
      at: j.research.at,
    },
    pkg: dir
      ? {
          resume: fileUrl(j.files?.resume),
          cover: fileUrl(j.files?.coverLetter),
          emails: has("emails.md"),
          interview: has("interview_prep.md"),
          folder: path.relative(paths.outputDir, dir).split(path.sep).join("/"),
          outdated: packageOutdated(j, dir, changedAt),
        }
      : null,
    duplicateOf: j.duplicateOf,
    reopenedFrom: j.reopenedFrom,
    openCheck: j.openCheck,
  };
}

// O parser de emails.md mora em writers/emailDraft.ts (o rascunho .eml usa o mesmo); exportado aqui para os testes.
export { parseEmails };

function jobDetail(j: Job) {
  const dir = packageDir(j);
  const read = (f: string) => (dir && fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : null);
  const files = dir
    ? fs
        .readdirSync(dir)
        .filter((f) => /\.(pdf|md|docx)$/i.test(f))
        .map((f) => ({ name: f, url: fileUrl(path.join(dir, f))! }))
    : [];
  // E-mail de candidatura do pacote: o .eml com anexo e o link do Gmail (destinatário, assunto, texto).
  const draft = dir ? applicationDraft(j) : null;
  const emails = parseEmails(read("emails.md"));
  let sheet = null;
  try {
    sheet = applicationSheet(j);
  } catch {
    /* sem perfil: sem ficha */
  }
  return {
    ...jobSummary(j),
    // Vagas antigas guardaram a página inteira: limpa menus, "Vagas semelhantes" e botões na hora de mostrar.
    description: cleanJobText(j.description),
    evidence: j.triage?.evidence ?? [],
    gaps: j.triage?.mustHaveGaps ?? [],
    answers: j.answers ?? [],
    files,
    sheet,
    apply: draft ? { to: draft.to, attachments: draft.attachments.map((f) => path.basename(f)), gmail: gmailComposeUrl(draft) } : null,
    docs: {
      readme: read("LEIA-ME.md"),
      emails: emails && {
        ...emails,
        // Com o rascunho com anexo, o link antigo (mailto, sem anexo) e o aviso do .eml só confundem: o quadro de envio já cobre.
        intro: draft
          ? emails.intro
              .split("\n")
              .filter((l) => !/\]\(mailto:/.test(l) && !/^\*\*Rascunho com o currículo/.test(l))
              .join("\n")
              .trim()
          : emails.intro,
        // Seções com assunto são e-mails (candidatura, follow-up, agradecimento): ganham o "Abrir no Gmail".
        sections: emails.sections.map((s) => ({ ...s, gmail: s.subjects.length ? gmailComposeUrl({ to: draft?.to ?? "", subject: s.subjects[0], body: s.message }) : undefined })),
      },
      interview: read("interview_prep.md"),
      ats: read("ats_report.md"),
      rating: read("rating_report.md"),
      coverage: read("coverage_review.md"),
    },
  };
}

export function providerState() {
  let active: ProviderId | null = null;
  let error: string | undefined;
  try {
    active = activeProviderId();
  } catch (e) {
    error = (e as Error).message;
  }
  return { active, label: active ? providerInfo(active).label : null, error };
}

const jobFrom = (id: string) => {
  try {
    return findJob(loadJobs(), id);
  } catch (e) {
    throw new HttpError(404, (e as Error).message);
  }
};

function requireProfileForTasks() {
  if (!hasProfile()) throw new HttpError(409, "Monte o seu perfil primeiro (aba Perfil).");
}

/** Vagas com uma resposta de formulário sendo escrita agora (uma por vaga). */
const writing = new Set<string>();
async function answering<T>(jobId: string, run: () => Promise<T>): Promise<T> {
  if (writing.has(jobId)) throw new HttpError(409, "Já estou escrevendo uma resposta para esta vaga.");
  writing.add(jobId);
  try {
    return await run();
  } finally {
    writing.delete(jobId);
  }
}

const MARKETS = ["BR", "US", "CA", "UK", "EU", "LATAM", "GLOBAL"] as const;

/** Opções do pacote vindas da interface (as mesmas do `ajf tailor`). Vazio = automático. */
function tailorOptions(b: Record<string, any>): TailorOptions {
  const pick = <T extends string>(v: unknown, list: readonly T[]) => (list as readonly unknown[]).includes(v) ? (v as T) : undefined;
  return {
    interview: Boolean(b.interview),
    lang: pick(b.lang, ["pt-BR", "en"] as const),
    paper: pick(b.paper, ["A4", "Letter"] as const),
    market: pick(b.market, MARKETS),
    cover: b.cover === "sim" ? true : b.cover === "nao" ? false : undefined,
    ignoreClosed: Boolean(b.ignoreClosed),
  };
}

/** Resumo dos motivos de descarte do filtro (o `-v` do `ajf search`), para o log da busca. */
function droppedSummary(dropped: { reason: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const d of dropped) {
    const reason = d.reason.replace(/^presencial\/híbrida em .*/, "presencial/híbrida fora das cidades aceitas").replace(/^restrita a .*/, "restrita a outra região");
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([r, n]) => `   ${n}× ${r}`);
}

export function jobRoutes(app: App): Route[] {
  const { queue } = app;

  const enqueueTailor = (t: Tr, job: Job, opts: TailorOptions = {}) => {
    requireProfileForTasks();
    if (queue.has("tailor", job.id)) throw new HttpError(409, "O pacote dessa vaga já está na fila.");
    return queue.add(
      "tailor",
      t("Pacote: {job}", { job: `${job.company} — ${job.title}` }),
      async () => {
        const r = await tailorJob(job.id, opts);
        r.violations.forEach((v) => console.log(`❌ ${v}`));
        const verdict = r.ready ? t("✅ pronto para enviar") : r.violations.length ? t("❌ violou as travas, leia coverage_review.md") : t("⚠ baixa aderência");
        return t("nota {rating} · ATS {ats}% · {verdict}", { rating: r.rating, ats: r.ats, verdict });
      },
      job.id,
    );
  };

  const enqueueTriage = (t: Tr, ids?: string[], research = false) => {
    requireProfileForTasks();
    if (!ids && queue.has("triage")) throw new HttpError(409, "A triagem já está na fila.");
    return queue.add(
      "triage",
      ids?.length !== 1 ? t("Avaliar vagas novas") : research ? t("Pesquisar e avaliar a vaga colada") : t("Avaliar a vaga colada"),
      async () => {
        // Vaga recebida sem link: primeiro a pesquisa na web, para a triagem já ver o anúncio oficial.
        if (research && ids?.length === 1) {
          try {
            await researchJob(ids[0]);
          } catch (e) {
            console.log(`⚠ Pesquisa na web: ${(e as Error).message}`);
          }
        }
        const done = await triageJobs(ids ? { ids } : {});
        return t("{n} avaliada(s) · {top} recomendada(s)", { n: done.length, top: done.filter((j) => j.status === "shortlisted").length });
      },
      ids?.length === 1 ? ids[0] : undefined,
    );
  };

  const noSearchRunning = () => {
    requireProfileForTasks();
    if (queue.has("search") || queue.has("auto")) throw new HttpError(409, "Já tem uma busca na fila.");
  };

  return [
    [
      "GET",
      /^\/api\/state$/,
      () => ({
        hasProfile: hasProfile(),
        jobs: (() => {
          const changedAt = profileChangedAt();
          return loadJobs().map((j) => jobSummary(j, changedAt));
        })(),
        settings: { minRating: settings.minRating, minTriageScore: settings.minTriageScore, repeatWindowDays: settings.repeatWindowDays },
        applyChannels: APPLY_CHANNELS,
        provider: providerState(),
        webSearch: canWebSearch(),
        webDefault: loadPreferences().webSearchByDefault,
        tasks: queue.list(),
      }),
    ],

    [
      "GET",
      /^\/api\/providers$/,
      (c) => ({
        ...providerState(),
        providers: detectProviders().map((d) => ({
          id: d.info.id,
          label: c.t(d.info.label),
          kind: d.info.kind,
          webSearch: d.info.webSearch,
          ready: d.ready,
          detail: providerDetail(c.t, d.detail),
          setup: c.t(d.info.setup),
        })),
      }),
    ],
    [
      "POST",
      /^\/api\/providers$/,
      async (c) => {
        const id = normalizeProviderId(str((await c.body()).id, 40));
        if (!id) throw new HttpError(400, "IA desconhecida.");
        const det = detectProviders().find((d) => d.info.id === id);
        if (!det?.ready) throw new HttpError(400, "Essa IA não está pronta nesta máquina: {detail}", { detail: providerDetail(c.t, det?.detail ?? "") });
        setEnvVar("AJF_PROVIDER", id);
        return providerState();
      },
    ],
    [
      "POST",
      /^\/api\/providers\/test$/,
      async () => {
        // O mesmo teste do `ajf ia --testar`: uma chamada curta.
        const { z } = await import("zod");
        const t0 = Date.now();
        try {
          const r = await getProvider().structured(z.object({ ok: z.boolean(), reply: z.string() }), {
            label: "ping",
            effort: "low",
            system: ["Responda em JSON."],
            user: 'Devolva ok=true e reply="pong".',
          });
          return { ok: r.ok, reply: r.reply, seconds: Math.round((Date.now() - t0) / 100) / 10 };
        } catch (e) {
          throw new HttpError(502, "A IA não respondeu: {error}", { error: (e as Error).message });
        }
      },
    ],
    [
      "GET",
      /^\/api\/doctor$/,
      () => ({
        // O mesmo do `ajf doctor`.
        chrome: settings.chromePath ?? null,
        home: paths.home,
        files: [paths.profileTruth, paths.baseResume("pt-BR"), paths.baseResume("en"), paths.preferences, paths.rules].map((f) => ({
          name: path.relative(paths.home, f).split(path.sep).join("/"),
          ok: fs.existsSync(f),
        })),
        settings: { targetRating: settings.targetRating, minRating: settings.minRating, minTriageScore: settings.minTriageScore, maxRevisions: settings.maxRevisions },
      }),
    ],

    [
      "POST",
      /^\/api\/search$/,
      async (c) => {
        const body = await c.body();
        const web = Boolean(body.web) && canWebSearch();
        const webHint = str(body.hint, 500) || undefined;
        noSearchRunning();
        return {
          task: queue.add("search", web ? c.t("Buscar vagas (sites + web com IA)") : c.t("Buscar vagas"), async () => {
            const s = await searchJobs({ web, webHint });
            console.log(searchSummary(s));
            if (s.dropped.length) console.log(`Cortadas pelo filtro das preferências:\n${droppedSummary(s.dropped).join("\n")}`);
            s.errors.forEach((e) => console.log(`⚠ ${e}`));
            const done = await triageJobs();
            return c.t("{n} vaga(s) nova(s) · {top} recomendada(s)", { n: s.added.length, top: done.filter((j) => j.status === "shortlisted").length });
          }),
        };
      },
    ],
    [
      "POST",
      /^\/api\/auto$/,
      async (c) => {
        const body = await c.body();
        const web = Boolean(body.web) && canWebSearch();
        const max = Math.max(0, Math.min(15, Number(body.max ?? 3) || 0));
        noSearchRunning();
        return {
          task: queue.add("auto", c.t("Piloto automático (até {max} pacote(s))", { max }), async () => {
            const r = await autopilot({ web, maxPackages: max, interview: Boolean(body.interview) });
            const ready = r.results.filter((x) => x.ready).length;
            return c.t("{n} vaga(s) nova(s) · {packages} pacote(s), {ready} pronto(s) para enviar", { n: r.search.added.length, packages: r.results.length, ready });
          }),
        };
      },
    ],
    ["POST", /^\/api\/triage$/, (c) => ({ task: enqueueTriage(c.t) })],
    [
      "POST",
      /^\/api\/paste$/,
      async (c) => {
        requireProfileForTasks();
        const body = await c.body();
        const text = str(body.text, 60_000);
        const company = str(body.company, 120);
        const title = str(body.title, 200);
        const location = str(body.location, 120);
        const link = str(body.url, 1000);
        if (link && !isHttp(link)) throw new HttpError(400, "O link precisa começar com http:// ou https://.");
        // Como no `ajf add`: o texto colado, ou só o link (o agente lê a página; LinkedIn exige colar o texto).
        if (text.length < 80 && !link) throw new HttpError(400, "Cole o texto completo da vaga ou informe o link.");
        if (text && text.length < 80) throw new HttpError(400, "Cole o texto completo da vaga (o que veio é curto demais).");
        let job: Job;
        try {
          job = await addJob({ text: text || undefined, company: company || undefined, title: title || undefined, location: location || undefined, url: link || undefined });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        app.jobsChanged(job.id);
        return { job: jobSummary(job), task: enqueueTriage(c.t, [job.id], Boolean(body.research) && canWebSearch()) };
      },
    ],

    [
      "DELETE",
      /^\/api\/tasks\/(\d+)$/,
      (c) => {
        if (!queue.remove(Number(c.params[0]))) throw new HttpError(409, "Essa tarefa já começou ou não existe.");
        return { ok: true };
      },
    ],
    [
      "POST",
      /^\/api\/tasks\/clear$/,
      () => {
        queue.clearFinished();
        return { ok: true };
      },
    ],

    ["GET", /^\/api\/jobs\/([\w-]+)$/, (c) => jobDetail(jobFrom(c.params[0]))],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/status$/,
      async (c) => {
        const job = jobFrom(c.params[0]);
        const body = await c.body();
        const status = str(body.status, 20);
        if (!isStatus(status)) throw new HttpError(400, "Status '{status}' não existe.", { status });
        const updated = changeStatus(job, status, str(body.note, 300), undefined, isApplyVia(body.via) ? body.via : undefined);
        app.jobsChanged(job.id);
        return { job: jobSummary(updated), previous: job.status };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/tailor$/,
      async (c) => ({ task: enqueueTailor(c.t, jobFrom(c.params[0]), tailorOptions(await c.body())) }),
    ],
    [
      "POST",
      /^\/api\/tailor-many$/,
      async (c) => {
        // "Gerar pacotes para várias de uma vez" do menu.
        requireProfileForTasks();
        const ids = strList((await c.body()).ids, { max: 15 });
        if (!ids.length) throw new HttpError(400, "Escolha pelo menos uma vaga.");
        const jobs = ids.map(jobFrom).filter((j) => !queue.has("tailor", j.id));
        return { tasks: jobs.map((j) => enqueueTailor(c.t, j)) };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/triage$/,
      (c) => {
        // "Avaliar de novo" (o `ajf triage --id`).
        const job = jobFrom(c.params[0]);
        // Só antes do pacote: a triagem muda o status, e uma vaga pronta ou enviada não pode voltar para "recomendada".
        if (!["new", "triaged", "shortlisted", "discarded"].includes(job.status))
          throw new HttpError(409, "Só dá para avaliar de novo vagas que ainda não têm pacote nem candidatura.");
        if (queue.has("triage", job.id)) throw new HttpError(409, "Essa vaga já está na fila da triagem.");
        requireProfileForTasks();
        return {
          task: queue.add(
            "triage",
            c.t("Avaliar de novo: {company}", { company: job.company }),
            async () => {
              const [done] = await triageJobs({ ids: [job.id] });
              return done?.triage ? c.t("triagem {score} · {status}", { score: done.triage.score, status: c.t(STATUS_LABELS[done.status]) }) : c.t("avaliada");
            },
            job.id,
          ),
        };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/email-draft$/,
      (c) => {
        // "Abrir no programa de e-mail": grava o .eml com o currículo anexado e abre. Quem envia é a pessoa.
        const file = writeApplicationDraft(jobFrom(c.params[0]));
        if (!file) throw new HttpError(400, "Esta vaga ainda não tem pacote com o e-mail de candidatura.");
        openExternal(file);
        return { file: path.basename(file), name: DRAFT_FILE };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/not-duplicate$/,
      (c) => {
        // "Não é a mesma vaga": tira a marca de repetida (vaga com pacote ou colada; descartada usa "Reabrir").
        const job = markNotDuplicate(jobFrom(c.params[0]).id);
        app.jobsChanged(job.id);
        return { job: jobSummary(job) };
      },
    ],
    [
      "POST",
      /^\/api\/check-open$/,
      (c) => {
        // "Conferir se ainda estão abertas" (o `ajf conferir`): todas as vagas que ainda não foram enviadas.
        if (queue.has("check")) throw new HttpError(409, "A conferência já está na fila.");
        if (!loadJobs().some((j) => CHECKABLE.includes(j.status))) throw new HttpError(400, "Nenhuma vaga para conferir: todas já foram enviadas ou encerradas.");
        return {
          task: queue.add("check", c.t("Conferir se as vagas ainda estão abertas"), async () => {
            const r = await checkOpenJobs();
            console.log(`\n${closedSummary(r)}`);
            return c.t("{open} aberta(s) · {closed} encerrada(s) · {unknown} sem confirmação", { open: r.open, closed: r.closed.length, unknown: r.unknown });
          }),
        };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/check-open$/,
      (c) => {
        const job = jobFrom(c.params[0]);
        if (queue.has("check", job.id)) throw new HttpError(409, "Essa vaga já está na fila.");
        return {
          task: queue.add(
            "check",
            c.t("Conferir se está aberta: {company}", { company: job.company }),
            async () => {
              const { check } = await checkJobOpen(job);
              const updated = recordOpenCheck(job, check);
              return `${OPEN_ICON[check.verdict]} ${check.reason}${updated.status !== job.status ? ` · ${c.t("movida para Encerradas")}` : ""}`;
            },
            job.id,
          ),
        };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/research$/,
      (c) => {
        // "Pesquisar na web": anúncio oficial, site da empresa, detalhes e verificação de golpe.
        requireProfileForTasks();
        if (!canWebSearch()) throw new HttpError(400, "A IA escolhida não faz busca na web.");
        const job = jobFrom(c.params[0]);
        if (queue.has("research", job.id) || queue.has("triage", job.id)) throw new HttpError(409, "Essa vaga já está na fila.");
        return {
          task: queue.add(
            "research",
            c.t("Pesquisar na web: {job}", { job: job.company || job.title }),
            async () => {
              const updated = await researchJob(job.id);
              // Antes do pacote, a triagem é refeita com o que foi achado.
              if (["new", "triaged", "shortlisted"].includes(updated.status)) await triageJobs({ ids: [job.id] });
              const v = updated.research?.verdict;
              return v === "confirmada" ? c.t("anúncio oficial encontrado") : v === "suspeita" ? c.t("🚩 sinais de golpe") : c.t("anúncio oficial não encontrado");
            },
            job.id,
          ),
        };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/answers$/,
      async (c) => {
        // Pergunta do formulário de candidatura. Fora da fila: é uma conversa, e a fila pode estar
        // ocupada com um pacote de vários minutos. Uma por vaga de cada vez.
        requireProfileForTasks();
        const job = jobFrom(c.params[0]);
        const body = await c.body();
        const question = str(body.question, 2000);
        if (question.length < 5) throw new HttpError(400, "Escreva a pergunta do formulário.");
        const limit = body.limit ? clamp(body.limit, 50, 20000, 0) || undefined : undefined;
        return { answer: await answering(job.id, () => answerQuestion(job.id, { question, limit, context: str(body.context, 4000) })) };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/answers\/([\w-]+)\/refine$/,
      async (c) => {
        requireProfileForTasks();
        const job = jobFrom(c.params[0]);
        const body = await c.body();
        const instruction = str(body.instruction, 1000);
        if (!instruction) throw new HttpError(400, "Diga o que ajustar (ex.: mais curto, cite o projeto X).");
        return { answer: await answering(job.id, () => refineAnswer(job.id, c.params[1], { instruction })) };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/answers\/([\w-]+)\/delete$/,
      (c) => {
        const job = jobFrom(c.params[0]);
        if (writing.has(job.id)) throw new HttpError(409, "Espere a resposta desta vaga terminar.");
        deleteAnswer(job.id, c.params[1]);
        return { ok: true };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/render$/,
      (c) => {
        // O `ajf render`: PDF de novo depois de editar resume.json / cover_letter.json à mão.
        const job = jobFrom(c.params[0]);
        const dir = packageDir(job);
        if (!dir || !fs.existsSync(path.join(dir, "resume.json"))) throw new HttpError(404, "Essa vaga não tem pacote com resume.json.");
        if (queue.has("render", job.id)) throw new HttpError(409, "Já está na fila.");
        return {
          task: queue.add(
            "render",
            c.t("PDF de novo: {company}", { company: job.company }),
            async () => {
              const r = await rerender(dir);
              r.guards.violations.forEach((v) => console.log(`❌ ${v}`));
              r.guards.warnings.forEach((v) => console.log(`⚠ ${v}`));
              const guards = r.guards.violations.length ? c.t("❌ {n} violação(ões) das travas", { n: r.guards.violations.length }) : c.t("travas ok");
              return c.t("{pages} página(s) · {guards}", { pages: r.pages, guards });
            },
            job.id,
          ),
        };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/interview$/,
      (c) => {
        requireProfileForTasks();
        const job = jobFrom(c.params[0]);
        if (queue.has("interview", job.id)) throw new HttpError(409, "O guia dessa vaga já está na fila.");
        return {
          task: queue.add(
            "interview",
            c.t("Guia de entrevista: {company}", { company: job.company }),
            async () => {
              await interviewGuide(job.id);
              return c.t("guia de entrevista pronto");
            },
            job.id,
          ),
        };
      },
    ],
    [
      "POST",
      /^\/api\/jobs\/([\w-]+)\/open-folder$/,
      (c) => {
        const dir = packageDir(jobFrom(c.params[0]));
        if (!dir) throw new HttpError(404, "Essa vaga ainda não tem pasta de pacote.");
        openExternal(dir);
        return { ok: true };
      },
    ],
  ];
}
