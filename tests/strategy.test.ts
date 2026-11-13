import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { paths } from "../src/config.js";
import { defaultStage, followUpDue, funnel, insightText, isNoReply, lagGroup, resultOf, sourceGroup } from "../src/jobs/funnel.js";
import { ageDays, applyKnockouts, freshness, ghostSignals, priorityOf } from "../src/jobs/priority.js";
import { referralLinks, referralOverdue } from "../src/jobs/referral.js";
import { changeStatus, recordFollowUp } from "../src/jobs/status.js";
import { loadJobs, saveJobs } from "../src/jobs/store.js";
import { analyzeNumbers, bulletsWithoutNumbers, loadNumberHints, numbersNews, splitExamples, withHints, withoutFigures } from "../src/onboarding/numbers.js";
import type { Job, Resume, Triage } from "../src/schemas.js";
import { withTimeout } from "../src/llm.js";
import { skimFeedback, skimTest } from "../src/tailor/skim.js";
import { extraSections } from "../src/writers/applicationSheet.js";

/* ------------------------- candidatura estratégica: funil, prioridade, indicação ------------------------- */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-13T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const LONG = "Requisitos: Node.js, TypeScript, PostgreSQL. Responsabilidades: construir APIs, revisar código, cuidar de produção. ".repeat(6);

let n = 0;
const job = (extra: Partial<Job> = {}): Job =>
  ({ id: `j${++n}`, source: "remotive", title: "Dev", company: "Acme", location: "", remote: true, url: `https://acme.com/${n}`, tags: [], description: LONG, addedAt: ago(1), status: "applied", ...extra }) as Job;

test("resultado de cada candidatura: resposta, entrevista, sem retorno, aguardando", () => {
  assert.deepEqual(resultOf(job({ appliedAt: ago(3) }), NOW, 30), { replied: false, interviewed: false, noReply: false, pending: true });
  assert.deepEqual(resultOf(job({ appliedAt: ago(40) }), NOW, 30), { replied: false, interviewed: false, noReply: true, pending: false });
  assert.deepEqual(resultOf(job({ status: "interview", appliedAt: ago(10) }), NOW), { replied: true, interviewed: true, noReply: false, pending: false });
  const rejected = (stage: Job["outcome"]) => resultOf(job({ status: "rejected", appliedAt: ago(10), outcome: stage }), NOW);
  assert.deepEqual(rejected({ stage: "triagem", at: ago(2) }), { replied: true, interviewed: false, noReply: false, pending: false });
  assert.deepEqual(rejected({ stage: "tecnica", at: ago(2) }), { replied: true, interviewed: true, noReply: false, pending: false });
  assert.deepEqual(rejected({ stage: "sem_resposta", at: ago(2) }), { replied: false, interviewed: false, noReply: true, pending: false });
  assert.deepEqual(rejected(undefined), { replied: true, interviewed: false, noReply: false, pending: false }, "recusa sem etapa conta como resposta");
  assert.equal(isNoReply(job({ appliedAt: ago(31) }), NOW, 30), true);
  assert.equal(isNoReply(job({ status: "interview", appliedAt: ago(31) }), NOW, 30), false);
  // Etapa sugerida ao registrar a recusa: a pessoa confirma.
  assert.equal(defaultStage(job({ appliedAt: ago(5) }), NOW, 30), "triagem");
  assert.equal(defaultStage(job({ appliedAt: ago(40) }), NOW, 30), "sem_resposta", "sem retorno há muito tempo");
  assert.equal(defaultStage(job({ status: "interview", appliedAt: ago(40) }), NOW, 30), "tecnica");
  assert.equal(defaultStage(job({ status: "rejected", outcome: { stage: "rh", at: ago(1) } }), NOW, 30), "rh", "a etapa já registrada fica");
});

test("follow-up: o 1º depois de 7 dias, o 2º 7 dias depois do 1º, no máximo 2", () => {
  assert.equal(followUpDue(job({ appliedAt: ago(3) }), NOW, 7, 30), 0);
  assert.equal(followUpDue(job({ appliedAt: ago(8) }), NOW, 7, 30), 1);
  assert.equal(followUpDue(job({ appliedAt: ago(12), followUps: [ago(4)] }), NOW, 7, 30), 0);
  assert.equal(followUpDue(job({ appliedAt: ago(16), followUps: [ago(8)] }), NOW, 7, 30), 2);
  assert.equal(followUpDue(job({ appliedAt: ago(25), followUps: [ago(16), ago(8)] }), NOW, 7, 30), 0);
  assert.equal(followUpDue(job({ appliedAt: ago(40) }), NOW, 7, 30), 0, "sem retorno: não pede mais follow-up");
  assert.equal(followUpDue(job({ appliedAt: ago(10), respondedAt: ago(2) }), NOW, 7, 30), 0);
  assert.equal(followUpDue(job({ status: "interview", appliedAt: ago(10) }), NOW, 7, 30), 0);
});

test("funil: taxas sem contar as que aguardam, cortes e conclusões", () => {
  const sent = [
    // Indicação: 3 de 3 responderam, 2 com entrevista; enviadas cedo.
    job({ appliedVia: "indicacao", postedAt: ago(20), appliedAt: ago(18), status: "interview", respondedAt: ago(12) }),
    job({ appliedVia: "indicacao", postedAt: ago(20), appliedAt: ago(19), status: "rejected", outcome: { stage: "tecnica", at: ago(5) }, respondedAt: ago(10) }),
    job({ appliedVia: "indicacao", postedAt: ago(30), appliedAt: ago(28), status: "rejected", outcome: { stage: "triagem", at: ago(20) }, respondedAt: ago(24) }),
    // Plataforma: 0 de 4 responderam; enviadas tarde.
    ...[45, 50, 55].map((d) => job({ appliedVia: "plataforma", postedAt: ago(d + 15), appliedAt: ago(d) })),
    job({ appliedVia: "plataforma", postedAt: ago(60), appliedAt: ago(40), status: "rejected", outcome: { stage: "sem_resposta", at: ago(5) } }),
    // Recusas na triagem e sem etapa; uma sem canal; uma aguardando.
    job({ postedAt: ago(14), appliedAt: ago(12), status: "rejected", outcome: { stage: "triagem", at: ago(6) }, respondedAt: ago(6) }),
    job({ appliedVia: "email", status: "rejected", appliedAt: ago(20) }),
    job({ appliedVia: "email", appliedAt: ago(2) }),
  ];
  const f = funnel([...sent, job({ status: "tailored" })], NOW, 30);
  assert.equal(f.totals.sent, 10, "a vaga com pacote pronto não foi enviada: fica de fora");
  assert.equal(f.totals.pending, 1);
  assert.equal(f.totals.replied, 5);
  assert.equal(f.totals.interviewed, 2);
  assert.equal(f.totals.noReply, 4);
  assert.equal(f.totals.replyRate, Math.round((5 / 9) * 100), "a que está aguardando não entra na conta");
  const ind = f.byChannel.find((g) => g.key === "indicacao")!;
  assert.deepEqual([ind.sent, ind.replyRate, ind.interviewRate], [3, 100, 67]);
  assert.equal(f.byChannel.find((g) => g.key === "plataforma")!.replyRate, 0);
  assert.deepEqual(f.missingChannel.length, 1);
  assert.deepEqual(f.missingOutcome.length, 1);
  assert.equal(f.medianDaysToReply, 6);
  const codes = f.insights.map((i) => i.code);
  assert.ok(codes.includes("best_channel"), "indicação responde muito mais que plataforma");
  assert.ok(codes.includes("early_better"));
  assert.ok(codes.includes("missing_outcome") && codes.includes("missing_channel") && codes.includes("small_sample"));
  assert.ok(f.insights.every((i) => insightText(i).length > 20));
  assert.deepEqual(f.stages[0], { stage: "triagem", label: "na triagem, antes de qualquer conversa", count: 2 });
  assert.deepEqual(sourceGroup("web:linkedin jobs"), ["web", "busca na web"]);
  assert.deepEqual(sourceGroup("manual"), ["manual", "colada"]);
  assert.deepEqual(lagGroup({ postedAt: ago(10), appliedAt: ago(5) }), ["4-7", "4 a 7 dias"]);
  assert.deepEqual(lagGroup({ appliedAt: ago(5) }), ["?", "sem data de publicação"]);
});

test("funil: muitas recusas na triagem e nenhuma entrevista viram conclusões", () => {
  const many = Array.from({ length: 16 }, (_, i) =>
    job({ appliedVia: "plataforma", appliedAt: ago(40 + i), status: "rejected", outcome: { stage: i < 12 ? "triagem" : "rh", at: ago(5) }, respondedAt: ago(30) }),
  );
  const codes = funnel(many.map((j) => (j.outcome?.stage === "rh" ? { ...j, outcome: { ...j.outcome, stage: "triagem" as const } } : j)), NOW, 30).insights.map((i) => i.code);
  assert.ok(codes.includes("screening"));
  assert.ok(codes.includes("no_interviews"));
});

test("prioridade: vaga nova sobe; antiga, fantasma e eliminatória descem; indicação sobe", () => {
  const tri = (score: number, knockouts: Triage["knockouts"] = []): Triage =>
    ({ fit: "alta", score, evidence: [], mustHaveGaps: [], scamSignals: [], recommendation: "candidatar", market: "BR", jobLanguage: "pt-BR", seniority: "pleno", reason: "", knockouts }) as Triage;
  assert.equal(ageDays({ postedAt: ago(5) }, NOW), 5);
  assert.equal(ageDays({ postedAt: "não é data" }, NOW), null);
  assert.deepEqual([freshness({ postedAt: ago(2) }, NOW), freshness({ postedAt: ago(10) }, NOW), freshness({ postedAt: ago(20) }, NOW), freshness({}, NOW)], ["nova", "recente", "antiga", null]);

  const fresh = job({ status: "shortlisted", postedAt: ago(1), triage: tri(80) });
  const old = job({ status: "shortlisted", postedAt: ago(25), triage: tri(85) });
  const failing = job({ status: "shortlisted", postedAt: ago(1), triage: tri(90, [{ requirement: "5 anos de Java", kind: "experiencia", meets: "nao", evidence: "" }]) });
  const referred = job({ status: "shortlisted", postedAt: ago(10), triage: tri(75), referral: { status: "recebida", at: ago(1) } });
  assert.ok(priorityOf(fresh, NOW) > priorityOf(old, NOW), "nova com 80 passa a antiga com 85");
  assert.ok(priorityOf(fresh, NOW) > priorityOf(failing, NOW), "eliminatório que não atende desce");
  assert.ok(priorityOf(referred, NOW) > priorityOf(job({ status: "shortlisted", postedAt: ago(10), triage: tri(75) }), NOW));

  assert.deepEqual(ghostSignals({ postedAt: ago(45), description: LONG, title: "Dev" }, NOW), ["antiga"]);
  assert.deepEqual(ghostSignals({ description: `Cadastre-se no nosso banco de talentos. ${LONG}`, title: "Dev" }, NOW), ["banco_de_talentos"]);
  assert.deepEqual(ghostSignals({ description: "Vaga de dev. Mande o currículo.", title: "Dev", reopenedFrom: "x" }, NOW), ["republicada", "sem_detalhes"]);
  assert.deepEqual(ghostSignals({ description: "[Resumo da busca web] Vaga de dev.", title: "Dev" }, NOW), [], "resumo da busca na web é curto de propósito");
  assert.deepEqual(ghostSignals({ description: "Vaga de dev. Mande o currículo.", title: "Dev", source: "manual" }, NOW), [], "vaga colada (indicação) é curta por natureza");

  assert.equal(applyKnockouts(tri(90, [{ requirement: "inglês fluente", kind: "idioma", meets: "nao", evidence: "" }])).recommendation, "decidir");
  assert.equal(applyKnockouts(tri(90, [{ requirement: "inglês fluente", kind: "idioma", meets: "incerto", evidence: "" }])).recommendation, "candidatar");
  assert.equal(applyKnockouts({ ...tri(40), recommendation: "descartar" }).recommendation, "descartar");
});

const resume = (r: Partial<Resume>): Resume =>
  ({
    language: "pt-BR",
    name: "Ana",
    headline: "",
    contact: { location: "", email: "", phone: "", linkedin: "", github: "", portfolio: "", availability: "" },
    summary: "",
    skills: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    languages: "",
    ...r,
  }) as Resume;

test("teste dos primeiros segundos: cargo no título e palavras-chave no topo", () => {
  const analysis = { roleTitle: "Desenvolvedora Back-end Node.js Pleno", mustHave: [], atsKeywords: ["Node.js", "PostgreSQL", "Docker", "Kubernetes", "TypeScript", "RabbitMQ"] };
  const exp = { title: "Desenvolvedora", company: "X", location: "", mode: "", start: "2023", end: "Atual", bullets: ["Criei APIs.", "Reduzi o tempo de resposta em 40%.", "Usei Docker, RabbitMQ e TypeScript no dia a dia."] };
  const weak = skimTest(resume({ headline: "Desenvolvedora Full Stack", summary: "Faço APIs com PostgreSQL.", experience: [exp] }), analysis);
  assert.equal(weak.titleMatch, false);
  assert.deepEqual(weak.foundTop, ["PostgreSQL"]);
  assert.deepEqual(weak.missingTop, ["Docker", "TypeScript", "RabbitMQ"], "só as que o currículo comprova; Kubernetes e Node.js não estão nele");
  assert.deepEqual(weak.measurable, { withNumber: 1, total: 3 });
  assert.equal(weak.pass, false);
  assert.match(skimFeedback(weak, analysis.roleTitle), /título.*não mostra o cargo/);
  assert.match(skimFeedback(weak, analysis.roleTitle), /Docker, TypeScript, RabbitMQ/);

  const strong = skimTest(resume({ headline: "Desenvolvedora Back-end Node.js | TypeScript | Docker", summary: "APIs com Node.js, PostgreSQL e RabbitMQ.", experience: [exp] }), analysis);
  assert.equal(strong.titleMatch, true);
  assert.equal(strong.pass, true);
  assert.equal(skimFeedback(strong, analysis.roleTitle), "");
});

test("números que faltam: tópicos sem número viram a novidade da atualização", () => {
  const r = resume({
    experience: [
      { title: "Dev", company: "A", location: "", mode: "", start: "", end: "", bullets: ["Migrei 5.235 documentos do sistema legado.", "Automatizei os relatórios técnicos da equipe.", "Curto."] },
      { title: "Estagiária", company: "B", location: "", mode: "", start: "", end: "", bullets: ["Criei testes automatizados com Jest para o produto."] },
    ],
  });
  const items = bulletsWithoutNumbers(r);
  assert.deepEqual(items.map((i) => i.bullet), ["Automatizei os relatórios técnicos da equipe.", "Criei testes automatizados com Jest para o produto."]);
  assert.equal(numbersNews(items.map((i) => ({ ...i, value: "" }))), "");
  const news = numbersNews([{ ...items[0], value: "de 3 horas para 10 minutos" }, { ...items[1], value: "  " }]);
  assert.match(news, /mantenha assim; não arredonde nem aumente/);
  assert.match(news, /Em A \(Dev\), no resultado "Automatizei os relatórios técnicos da equipe\.": de 3 horas para 10 minutos/);
  assert.doesNotMatch(news, /Jest/);
  // Com a pergunta da análise, a resposta curta ("15 mil") não fica ambígua.
  assert.match(numbersNews([{ ...items[0], value: "15 mil", question: "Quantos relatórios por mês?" }]), /à pergunta "Quantos relatórios por mês\?", respondi: 15 mil/);
});

test("chamada à IA com limite de tempo: desiste e explica", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
  assert.equal(await withTimeout(Promise.resolve(7), undefined), 7, "sem limite, segue igual");
  await assert.rejects(withTimeout(new Promise(() => {}), 20), /não respondeu em 0 s/);
});

test("números que faltam: a IA diz o que medir, sem sugerir valor, e a análise fica guardada", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-num-"));
  const old = paths.profileDir;
  paths.profileDir = tmp;
  try {
    const items = [
      { company: "A", title: "Dev", bullet: "Mantenho sistemas usados por todos os campi da universidade." },
      { company: "A", title: "Dev", bullet: "Participo de code review e de decisões de arquitetura." },
      { company: "B", title: "Dev", bullet: "Automatizei o fechamento mensal da equipe financeira." },
    ];
    let calls = 0;
    let prompt = "";
    let callOpts: { effort?: string; timeoutMs?: number } = {};
    const fake = (async (_schema: unknown, opts: { user: string; effort?: string; timeoutMs?: number }) => {
      calls++;
      prompt = opts.user;
      callOpts = opts;
      return {
        items: [
          { index: 1, worth: "alto", measure: "alcance: quantas pessoas usam", question: "Quantas pessoas usam esses sistemas — e em quantos campi?", examples: ["Cerca de 15 mil alunos em 7 campi", "NPS de 70"], why: "Mostra a escala." },
          { index: 2, worth: "baixo", measure: "", question: "Quantos code reviews por semana?", examples: [], why: "É uma prática, não um resultado." },
          { index: 3, worth: "medio", measure: "tempo", question: "Quanto tempo levava antes e depois?", examples: ["de 2,5 dias para 4 horas."], why: "" },
          { index: 9, worth: "alto", measure: "x", question: "fora da lista", examples: [], why: "" },
        ],
      };
    }) as unknown as Parameters<typeof analyzeNumbers>[2];

    const hints = await analyzeNumbers(items, false, fake);
    assert.equal(calls, 1);
    assert.match(prompt, /1\. \[A, Dev\] Mantenho sistemas/);
    assert.equal(callOpts.effort, "low", "esforço baixo: meio minuto em vez de minutos");
    assert.equal(callOpts.timeoutMs, 180_000, "não fica carregando para sempre");
    assert.equal(Object.keys(hints).length, 3, "índice fora da lista é ignorado");
    const campi = hints[items[0].bullet];
    assert.deepEqual(campi.examples, ["cerca de N mil alunos em N campi", "NPS de N"], "exemplo nunca traz um valor; minúscula depois de \"ex.:\", sigla fica");
    assert.doesNotMatch(campi.question, /—/, "sem travessão");
    assert.deepEqual(hints[items[2].bullet].examples, ["de N dias para N horas"]);
    assert.equal(withoutFigures("de 3 h para 10 min, 1.500 pedidos"), "de N h para N min, N pedidos");
    // Exemplos que a IA pôs dentro da pergunta vão para a lista.
    assert.deepEqual(splitExamples("Quantas pessoas usavam por mês? Exemplos: “N pessoas por mês”; “entre N e N pessoas”.", []), {
      question: "Quantas pessoas usavam por mês?",
      examples: ["N pessoas por mês", "entre N e N pessoas"],
    });
    assert.deepEqual(splitExamples("Quantas pessoas usam? (ex.: N pessoas; N mil)", []), { question: "Quantas pessoas usam?", examples: ["N pessoas", "N mil"] });
    assert.deepEqual(splitExamples("Quantos exemplos de código você revisou?", []), { question: "Quantos exemplos de código você revisou?", examples: [] });
    assert.deepEqual(splitExamples("Quantas pessoas usam? Exemplo: N.", ["cerca de N"]).examples, ["cerca de N"], "a lista da IA tem prioridade");

    // Ordem: o que pesa muito primeiro, o que ajuda pouco por último.
    assert.deepEqual(withHints(items, hints).map((i) => i.hint?.worth), ["alto", "medio", "baixo"]);
    assert.deepEqual(loadNumberHints(), hints, "a análise fica salva");

    // Já analisados: não chama de novo. Tópico que saiu do currículo some do arquivo.
    await analyzeNumbers(items.slice(0, 2), false, fake);
    assert.equal(calls, 1);
    assert.deepEqual(Object.keys(loadNumberHints()), [items[0].bullet, items[1].bullet]);
    // "Analisar de novo" refaz tudo.
    await analyzeNumbers(items.slice(0, 1), true, fake);
    assert.equal(calls, 2);
  } finally {
    paths.profileDir = old;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("indicação: buscas no LinkedIn e o prazo para seguir pela plataforma", () => {
  const l = referralLinks("Nuvem Azul & Cia");
  assert.match(l.network, /^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=%22Nuvem%20Azul%20%26%20Cia%22&network=%5B%22F%22%2C%22S%22%5D/);
  assert.match(decodeURIComponent(l.recruiters), /"Nuvem Azul & Cia" \(recruiter OR recrutador OR recrutadora OR "talent acquisition"\)/);
  assert.equal(referralOverdue({ referral: { status: "pedida", at: new Date(Date.now() - 4 * DAY).toISOString() } }), true);
  assert.equal(referralOverdue({ referral: { status: "pedida", at: new Date(Date.now() - DAY).toISOString() } }), false);
  assert.equal(referralOverdue({ referral: { status: "recebida", at: new Date(Date.now() - 9 * DAY).toISOString() } }), false);
  assert.equal(referralOverdue({}), false);
});

test("mudança de status guarda a etapa da recusa, a primeira resposta e os follow-ups", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-status-"));
  const saved = { ...paths };
  Object.assign(paths, { dataDir: path.join(dir, "data"), jobsDb: path.join(dir, "data", "jobs.json"), outputDir: path.join(dir, "output"), tracker: path.join(dir, "output", "tracker.csv") });
  try {
    saveJobs([job({ id: "s1", appliedAt: ago(10) }), job({ id: "s2", appliedAt: ago(10) })]);
    const [a, b] = loadJobs();
    const up = recordFollowUp(a);
    assert.equal(up.followUps?.length, 1);
    const rejected = changeStatus(up, "rejected", "", undefined, undefined, { stage: "triagem", reason: " vaga preenchida " });
    assert.deepEqual([rejected.outcome?.stage, rejected.outcome?.reason], ["triagem", "vaga preenchida"]);
    assert.ok(rejected.respondedAt, "a recusa é a primeira resposta");
    const reopened = changeStatus(rejected, "applied");
    assert.equal(reopened.outcome, undefined, "reabrir tira a etapa da recusa");
    const silent = changeStatus(b, "rejected", "", undefined, undefined, { stage: "sem_resposta" });
    assert.equal(silent.respondedAt, undefined, "sem resposta não é resposta");
    assert.match(fs.readFileSync(paths.tracker, "utf8"), /etapa: triagem \(vaga preenchida\)/);
  } finally {
    Object.assign(paths, saved);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ficha: mensagem curta do pacote e respostas fixas das Preferências", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-sheet-"));
  try {
    fs.writeFileSync(
      path.join(dir, "emails.md"),
      "# E-mails\n\n## 1. E-mail de candidatura\n```text\noi\n```\n\n## 6. Mensagem curta de apresentação (40/600 caracteres)\nPara o campo.\n```text\nSou dev back-end — e entrego APIs estáveis.\n```\n",
    );
    const facts = { salaryExpectation: "R$ 9.000", availability: "imediata", noticePeriod: "", relocation: "não", workAuthorization: "" };
    const pt = extraSections(job({ outputDir: dir }), false, facts);
    assert.deepEqual(pt.map((s) => s.title), ["Mensagem de apresentação", "Perguntas frequentes"]);
    assert.equal(pt[0].fields[0].value, "Sou dev back-end, e entrego APIs estáveis.", "sem travessão");
    assert.deepEqual(pt[1].fields.map((f) => `${f.label}: ${f.value}`), ["Pretensão salarial: R$ 9.000", "Disponibilidade para começar: imediata", "Mudança de cidade: não"]);
    const en = extraSections(job({ outputDir: dir }), true, facts);
    assert.deepEqual(en.map((s) => s.title), ["Short cover message", "Common questions"]);
    assert.equal(extraSections(job(), false, { salaryExpectation: "", availability: "", noticePeriod: "", relocation: "", workAuthorization: "" }).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
