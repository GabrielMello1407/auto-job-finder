import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { prefilter } from "../src/jobs/filter.js";
import { _test } from "../src/jobs/sources/extra.js";
import type { RawJob } from "../src/jobs/sources/index.js";
import { loadBaseResume, loadPreferences } from "../src/profile.js";
import type { Job, Resume, Review } from "../src/schemas.js";
import { atsReport } from "../src/tailor/ats.js";
import { runGuards } from "../src/tailor/guards.js";
import { refine } from "../src/tailor/refine.js";
import { sourcesText } from "../src/tailor/index.js";
import { marketProfile } from "../src/market.js";
import { fixMojibake, htmlToText } from "../src/util/text.js";
import { forbiddenPatterns } from "../src/profile.js";
import { extractJson, strictJsonSchema, structuredViaText } from "../src/providers/jsonText.js";
import { activeProviderId, normalizeProviderId } from "../src/providers/index.js";
import { which } from "../src/providers/spawn.js";
import { isStatus, matchJobs } from "../src/jobs/status.js";
import { relocatePackage } from "../src/jobs/folders.js";
import { parseEmails } from "../src/ui/routes/jobs.js";
import { pendingItems } from "../src/ui/routes/profile.js";
import { diffStats, lineDiff } from "../src/util/diff.js";
import { applyRuleChanges, missingHeadings, truthHash } from "../src/onboarding/update.js";
import { researchBlock, withoutResearch } from "../src/jobs/research.js";
import { paths } from "../src/config.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { looksLikeLinkedinExport } from "../src/onboarding/sources.js";
import { z } from "zod";

const base = loadBaseResume("en");
const sources = sourcesText();
const clone = (r: Resume): Resume => structuredClone(r);

test("currículos-base passam nas travas", () => {
  for (const lang of ["pt-BR", "en"] as const) {
    const r = loadBaseResume(lang);
    assert.deepEqual(runGuards(r, r, sources).violations, []);
  }
});

test("trava: número inventado", () => {
  const r = clone(base);
  r.experience[0].bullets[0] += " Improved performance by 37%.";
  const g = runGuards(r, base, sources);
  assert.ok(g.violations.some((v) => v.includes("37")), g.violations.join("\n"));
});

test("trava: posição removida e datas alteradas", () => {
  const r = clone(base);
  r.experience = r.experience.slice(0, 2);
  r.experience[0].start = "01/2024";
  const g = runGuards(r, base, sources);
  assert.ok(g.violations.some((v) => v.includes("posição removida")));
  assert.ok(g.violations.some((v) => v.includes("datas alteradas")));
});

test("trava: AWS Certified e inglês fluente", () => {
  const r = clone(base);
  r.summary += " AWS Certified developer with fluent English.";
  const g = runGuards(r, base, sources);
  assert.ok(g.violations.some((v) => v.includes("AWS")));
  assert.ok(g.violations.some((v) => v.includes("inglês")));
});

test("trava: aceita reordenação e números das fontes (5,235 = 5.235)", () => {
  const r = clone(base);
  r.experience[0].bullets.reverse();
  r.skills.reverse();
  r.summary = "Full Stack Engineer who migrated 5.235 documents (4,2 GB) and cut ETP generation from 3 hours to under 10 minutes.";
  assert.deepEqual(runGuards(r, base, sources).violations, []);
});

const review = (rating: number): Review => ({
  rating,
  ratingRationale: "",
  strengths: [],
  gaps: [],
  missingKeywordsCoverable: [],
  presentation: [],
});

test("loop: para ao atingir a meta", async () => {
  const ratings = [7, 8.6];
  let i = 0;
  const r = await refine({
    initial: base,
    target: 8.5,
    maxRevisions: 3,
    guard: () => ({ violations: [], warnings: [] }),
    evaluate: async () => review(ratings[i++]),
    revise: async (x) => clone(x),
  });
  assert.equal(r.stopReason, "target_reached");
  assert.equal(r.best.rating, 8.6);
});

test("loop: para sem melhora e restaura a melhor versão", async () => {
  const ratings = [7.5, 7.0];
  let i = 0;
  const r = await refine({
    initial: base,
    target: 8.5,
    maxRevisions: 3,
    guard: () => ({ violations: [], warnings: [] }),
    evaluate: async () => review(ratings[i++]),
    revise: async (x) => clone(x),
  });
  assert.equal(r.stopReason, "no_improvement");
  assert.equal(r.best.rating, 7.5);
  assert.equal(r.restored, true);
});

test("loop: versão limpa vence versão com violação mesmo com nota menor", async () => {
  const ratings = [9.0, 8.0, 7.9];
  const viol = [1, 0, 0];
  let i = 0;
  let g = 0;
  const r = await refine({
    initial: base,
    target: 8.5,
    maxRevisions: 3,
    guard: () => ({ violations: Array(viol[g++]).fill("x"), warnings: [] }),
    evaluate: async () => review(ratings[i++]),
    revise: async (x) => clone(x),
  });
  assert.equal(r.best.rating, 8.0);
  assert.equal(r.best.violations, 0);
});

test("filtro: restrição geográfica, título e senioridade", () => {
  const prefs = loadPreferences();
  const job = (title: string, restrictions: string[] = []): RawJob => ({
    source: "t",
    title,
    company: "Acme",
    location: "",
    remote: true,
    url: `https://x/${title}`,
    tags: [],
    description: "",
    locationRestrictions: restrictions,
  });
  const { kept, dropped } = prefilter(
    [
      job("Senior Full Stack Engineer", ["United States"]),
      job("Full Stack Developer", ["Brazil"]),
      job("Senior React Developer", ["LATAM"]),
      job("Staff Software Engineer"),
      job("Java Developer"),
      job("Desenvolvedor Fullstack Node/React"),
      job("JavaScript Engineer"),
    ],
    prefs,
  );
  assert.deepEqual(
    kept.map((k) => k.title),
    ["Full Stack Developer", "Senior React Developer", "Desenvolvedor Fullstack Node/React", "JavaScript Engineer"],
  );
  assert.equal(dropped.length, 3);
});

test("ATS: separa coberto, cobrível e lacuna real", () => {
  const r = atsReport(
    base,
    {
      roleTitle: "Full Stack Engineer",
      company: "Acme",
      market: "US",
      mustHave: [],
      niceToHave: [],
      atsKeywords: ["Node.js", "PostgreSQL", "Socket.io", "Kubernetes"],
      responsibilities: [],
      companyContext: "",
      recruiterName: "",
      recruiterEmail: "",
      applyChannel: "desconhecido",
      applyInstructions: "",
    },
    sources,
    { pages: 2, market: marketProfile("US"), fileName: "Ana_Souza_Resume_Acme.pdf" },
  );
  assert.deepEqual(r.covered, ["Node.js", "PostgreSQL"]);
  assert.deepEqual(r.coverable, ["Socket.io"]);
  assert.deepEqual(r.gaps, ["Kubernetes"]);
});

test("ATS: termos curtos exigem palavra inteira (Go ≠ Django)", () => {
  const r = atsReport(
    base,
    {
      roleTitle: "Engineer",
      company: "Acme",
      market: "BR",
      mustHave: [],
      niceToHave: [],
      atsKeywords: ["SQL", "Go", "RAG"],
      responsibilities: [],
      companyContext: "",
      recruiterName: "",
      recruiterEmail: "",
      applyChannel: "email",
      applyInstructions: "",
    },
    sources,
    { pages: 1, market: marketProfile("BR"), fileName: "a.pdf" },
  );
  assert.deepEqual(r.covered, ["SQL", "RAG"]);
  assert.deepEqual(r.gaps, ["Go"]);
});

test("trava: projeto sem fonte e projeto real", () => {
  const r = clone(base);
  r.projects = [
    { name: "Orbita", description: "Open source project delivery dashboard.", tech: ["Next.js"], url: "" },
    { name: "CryptoBot Pro", description: "Trading bot.", tech: [], url: "" },
  ];
  const v = runGuards(r, base, sources).violations;
  assert.ok(v.some((x) => x.includes("CryptoBot")));
  assert.ok(!v.some((x) => x.includes("Orbita")));
});

test("github-br: extrai local, cargo e empresa do título", () => {
  const p = _test.parseGithubTitle;
  assert.deepEqual(p("[Remoto] Desenvolvedor(a) Full Stack Sênior — AI & Agents na WeatherWise | 4 dias / 32h"), {
    location: "Remoto",
    title: "Desenvolvedor(a) Full Stack Sênior — AI & Agents",
    company: "WeatherWise",
  });
  assert.deepEqual(p("[Remoto] Desenvolvedor Fullstack Pleno - Java & Angular - DB1"), {
    location: "Remoto",
    title: "Desenvolvedor Fullstack Pleno - Java & Angular",
    company: "DB1",
  });
});

test("filtro: presencial só nas cidades aceitas", () => {
  const prefs = loadPreferences();
  const job = (location: string, remote: boolean | null): RawJob => ({
    source: "t", title: "Full Stack Developer", company: "Acme", location, remote, url: `https://x/${location}`, tags: [], description: "",
  });
  const { kept } = prefilter([job("Joinville/SC", false), job("Londrina, PR", false), job("Híbrido", false), job("Brasil", true)], prefs);
  assert.deepEqual(kept.map((k) => k.location), ["Londrina, PR", "Híbrido", "Brasil"]);
});

test("util: html e mojibake", () => {
  assert.equal(htmlToText("<p>Olá &amp; <b>bem-vindo</b></p><ul><li>React</li></ul>"), "Olá & bem-vindo\n\n- React");
  assert.equal(fixMojibake("SÃ£o Paulo"), "São Paulo");
});

test("regras: frase literal de rules.json não pega pedaço de palavra", () => {
  const [f] = forbiddenPatterns({ neverClaim: [{ phrase: "PMP certificado", message: "x" }] });
  assert.ok(f.re.test("Profissional PMP certificado desde 2020"));
  assert.ok(!f.re.test("PMP certificados"));
});

test("provedores: aliases e AJF_PROVIDER", () => {
  assert.equal(normalizeProviderId("api"), "anthropic");
  assert.equal(normalizeProviderId("ChatGPT"), "codex");
  assert.equal(normalizeProviderId("xyz"), undefined);
  process.env.AJF_PROVIDER = "gemini";
  assert.equal(activeProviderId(), "gemini");
  process.env.AJF_PROVIDER = "nao-existe";
  assert.throws(() => activeProviderId(), /não existe/);
  delete process.env.AJF_PROVIDER;
});

test("provedores: which acha CLI no PATH, por caminho explícito e ignora atalho sh sem extensão no Windows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-which-"));
  const oldPath = process.env.PATH;
  try {
    fs.writeFileSync(path.join(dir, "ajf-fake-cli"), "#!/bin/sh\n");
    if (process.platform === "win32") fs.writeFileSync(path.join(dir, "ajf-fake-cli.cmd"), "@echo off\n");
    const expected = path.join(dir, process.platform === "win32" ? "ajf-fake-cli.cmd" : "ajf-fake-cli");
    process.env.PATH = dir;
    assert.equal(which("ajf-fake-cli"), expected);
    assert.equal(which(expected), expected);
    assert.equal(which(path.join(dir, "nao-existe")), null);
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("status: acha vaga por ID, começo do ID ou parte da empresa/cargo sem acento", () => {
  const job = (id: string, company: string, title: string) => ({ id, company, title }) as Job;
  const jobs = [job("a1b2c3d4", "Grupo Boticário", "Pessoa Desenvolvedora Fullstack"), job("ffee0011", "Cogfy", "Full Stack Developer")];
  assert.deepEqual(matchJobs(jobs, "a1b2").map((j) => j.id), ["a1b2c3d4"]);
  assert.deepEqual(matchJobs(jobs, "boticario").map((j) => j.id), ["a1b2c3d4"]);
  assert.deepEqual(matchJobs(jobs, "cogfy full").map((j) => j.id), ["ffee0011"]);
  assert.equal(matchJobs(jobs, "nubank").length, 0);
  assert.equal(matchJobs(jobs, "").length, 2);
  assert.ok(isStatus("applied") && !isStatus("enviada"));
});

test("pastas: pacote vai para a subpasta do status e os caminhos dos PDFs acompanham", () => {
  const hadOutput = fs.existsSync(paths.outputDir);
  const old = path.join(paths.outputDir, `ajf-teste-${process.pid}`);
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, "cv.pdf"), "x");
  const job = { id: "t1", company: "X", status: "applied", outputDir: old, files: { resume: path.join(old, "cv.pdf") } } as Job;
  try {
    const moved = relocatePackage(job)!;
    assert.equal(moved.outputDir, path.join(paths.outputDir, "2-em-andamento", path.basename(old)));
    assert.ok(fs.existsSync(moved.files!.resume!) && !fs.existsSync(old));
    assert.equal(relocatePackage({ ...job, ...moved }), null);
    // Caminho salvo desatualizado (pasta já movida por outro comando): reencontra a pasta.
    const healed = relocatePackage(job)!;
    assert.equal(healed.outputDir, moved.outputDir);
    assert.equal(healed.files!.resume, moved.files!.resume);
    assert.equal(relocatePackage({ ...job, outputDir: os.tmpdir() }), null); // fora de output/: não mexe
  } finally {
    fs.rmSync(old, { recursive: true, force: true });
    fs.rmSync(path.join(paths.outputDir, "2-em-andamento", path.basename(old)), { recursive: true, force: true });
    if (!hadOutput) fs.rmSync(paths.outputDir, { recursive: true, force: true }); // pasta criada só pelo teste
  }
});

test("interface: pontos a confirmar e e-mails separados para copiar", () => {
  const truth = "# Perfil\n\n## ⚠️ A confirmar\n\n- [x] **Datas:** resolvido\n- [ ] **Telefone:** não informado\n\n## Experiência\n\n- [ ] não é pendência\n";
  assert.deepEqual(pendingItems(truth), ["Telefone: não informado"]);

  const emails = parseEmails(
    "# E-mails\n\n**Anexos:** cv.pdf\n\n## 1. E-mail de candidatura\n**Assunto (escolha um):**\n- Assunto A\n- Assunto B\n\n```text\nOlá, [Nome],\nMensagem.\n```\n\n## 4. Follow-up\n**Assunto:** Assunto C\n```text\nOi de novo.\n```\n",
  )!;
  assert.equal(emails.intro, "**Anexos:** cv.pdf");
  assert.deepEqual(emails.sections[0].subjects, ["Assunto A", "Assunto B"]);
  assert.equal(emails.sections[0].message, "Olá, [Nome],\nMensagem.");
  assert.deepEqual(emails.sections[1].subjects, ["Assunto C"]);
  assert.equal(emails.sections[1].message, "Oi de novo.");
});

test("atualizar perfil: antes e depois linha a linha e seções que não podem sumir", () => {
  const before = "# Perfil\n## Experiência\n- A\n## Projetos\n- P1\n## A confirmar\n- (nada)\n";
  const after = "# Perfil\n## Experiência\n- B\n- A\n## Projetos\n- P1\n- P2\n## A confirmar\n- (nada)\n";
  const diff = lineDiff(before, after);
  assert.deepEqual(
    diff.filter((l) => l.type !== "same").map((l) => `${l.type}:${l.text}`),
    ["add:- B", "add:- P2"],
  );
  assert.deepEqual(diffStats(diff), { added: 2, removed: 0 });
  assert.deepEqual(lineDiff("a\nb\n", "a\nc\n").filter((l) => l.type !== "same").map((l) => l.type), ["del", "add"]);
  // Quebras de linha do Windows não contam como mudança.
  assert.equal(lineDiff("a\r\nb", "a\nb").every((l) => l.type === "same"), true);

  assert.deepEqual(missingHeadings(before, after), []);
  assert.deepEqual(missingHeadings(before, "# Perfil\n## Experiência\n- A\n"), ["## Projetos", "## A confirmar"]);
  assert.equal(truthHash("x\r\ny\n"), truthHash("x\ny"));
  assert.notEqual(truthHash("x"), truthHash("y"));
});

test("JSON: extrai de resposta com cercas e valida com nova tentativa", async () => {
  assert.deepEqual(extractJson('Aqui está:\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('texto {"a": {"b": 2}} fim'), { a: { b: 2 } });
  const schema = z.object({ ok: z.boolean() });
  const replies = ['{"ok": "sim"}', '{"ok": true}'];
  let calls = 0;
  const r = await structuredViaText(schema, "t", async () => replies[calls++]);
  assert.deepEqual(r, { ok: true });
  assert.equal(calls, 2);
});

test("JSON schema strict: objetos fechados e todas as chaves obrigatórias", () => {
  const js = strictJsonSchema(z.object({ a: z.string(), b: z.object({ c: z.number().optional() }) })) as any;
  assert.equal(js.additionalProperties, false);
  assert.deepEqual(js.required, ["a", "b"]);
  assert.deepEqual(js.properties.b.required, ["c"]);
});

test("LinkedIn: reconhece o PDF exportado do perfil", () => {
  assert.ok(looksLikeLinkedinExport("Contato\nwww.linkedin.com/in/fulano (LinkedIn)\nPrincipais competências\nVendas"));
  assert.ok(!looksLikeLinkedinExport("Currículo\nFulano de Tal\nExperiência\nVendedor"));
  assert.ok(!looksLikeLinkedinExport("Fulano · linkedin.com/in/fulano\nContato\nExperiência\nVendedor"));
});

test("filtro: sem palavras obrigatórias aceita qualquer área", () => {
  const prefs = { ...loadPreferences(), titleMustInclude: [], titleExclude: [] };
  const job = (title: string): RawJob => ({ source: "t", title, company: "Acme", location: "", remote: true, url: `https://x/${title}`, tags: [], description: "" });
  const { kept } = prefilter([job("Enfermeira Assistencial"), job("Analista de Marketing Digital")], prefs);
  assert.equal(kept.length, 2);
});

test("pesquisa da vaga: bloco no fim da descrição, sai inteiro ao pesquisar de novo", () => {
  const received = "Vaga de Analista Financeiro na Empresa X.\nCurrículo para vagas@empresax.com.br";
  const block = researchBlock({
    postingFound: false,
    postingUrl: "",
    companySite: "https://empresax.com.br",
    companySummary: "",
    extraDetails: [],
    applyInstructions: "E-mail para vagas@empresax.com.br",
    officialEmailDomains: ["empresax.com.br"],
    verdict: "nao_encontrada",
    notes: ["O e-mail de contato bate com o domínio da empresa."],
    sources: [],
  });
  assert.match(block, /^## Pesquisa na web/);
  assert.match(block, /anúncio oficial não encontrado/);
  assert.match(block, /Domínios de e-mail da empresa: empresax\.com\.br/);
  const description = `${received}\n\n---\n\n${block}`;
  assert.equal(withoutResearch(description), received);
  assert.equal(withoutResearch(received), received);
  // Um "---" do próprio texto da vaga não é confundido com a pesquisa.
  assert.equal(withoutResearch(`a\n\n---\n\nb`), `a\n\n---\n\nb`);
});

test("atualizar perfil: regras de nunca afirmar saem e entram sem mexer nas outras", () => {
  const rules = {
    neverClaim: [
      { phrase: "ISO 27001", message: "Norma não citada." },
      { phrase: "inglês fluente", message: "Só TOEIC." },
      { regex: "certifica(do|ção) PMP", message: "Só curso." },
    ],
  };
  const out = applyRuleChanges(rules, {
    remove: ["iso 27001", "regra que não existe"],
    add: [
      { phrase: "certificação CyberOps", message: "É curso." },
      { phrase: "Inglês Fluente", message: "Duplicada: já existe." },
      { phrase: " ", message: "Vazia: ignorada." },
    ],
  });
  assert.deepEqual(
    out.neverClaim.map((r) => r.phrase ?? r.regex),
    ["inglês fluente", "certifica(do|ção) PMP", "certificação CyberOps"],
  );
});
