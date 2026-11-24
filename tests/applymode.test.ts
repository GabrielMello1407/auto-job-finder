import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applicationNote, applyQueue, markdownSection } from "../src/jobs/applyQueue.js";
import { comparable, funnel, funnelText, insightText } from "../src/jobs/funnel.js";
import { baseVersion, resumeStats, statsFromPackage } from "../src/jobs/resumeStats.js";
import type { Job, Resume, ResumeStats } from "../src/schemas.js";

/* ------------------------------- modo candidatura e versões do currículo ------------------------------- */

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();

let n = 0;
const job = (extra: Partial<Job> = {}): Job =>
  ({ id: `a${++n}`, source: "remotive", title: "Dev", company: `Empresa ${n}`, location: "", remote: true, url: `https://acme.com/${n}`, tags: [], description: "", addedAt: ago(1), status: "tailored", ...extra }) as Job;

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

test("modo candidatura: só os prontos, na ordem de prioridade e depois da nota", () => {
  const fresh = job({ triage: { score: 80 } as Job["triage"], postedAt: ago(1), rating: 7.5 });
  const old = job({ triage: { score: 80 } as Job["triage"], postedAt: ago(25), rating: 9.5 });
  const tie1 = job({ triage: { score: 70 } as Job["triage"], rating: 8 });
  const tie2 = job({ triage: { score: 70 } as Job["triage"], rating: 9 });
  const others = [job({ status: "low_fit" }), job({ status: "applied" }), job({ status: "shortlisted" })];
  const q = applyQueue([old, tie1, ...others, fresh, tie2], NOW);
  assert.deepEqual(q.map((j) => j.id), [fresh.id, tie2.id, tie1.id, old.id], "a vaga recente sobe; no empate, a nota maior");
});

test("modo candidatura: como se candidatar (LEIA-ME) e a mensagem curta (emails.md)", () => {
  const readme = "# Pacote: Dev — Acme\r\n\r\n✅ Pronto\r\n\r\n## Como se candidatar\r\n🧾 **Pela plataforma** (https://x): envie o PDF.\r\n\r\n> Instruções da vaga: código 123\r\n\r\n## Arquivos\r\n- a.pdf\r\n";
  assert.equal(markdownSection(readme, "Como se candidatar"), "🧾 **Pela plataforma** (https://x): envie o PDF.\n\n> Instruções da vaga: código 123");
  assert.equal(markdownSection(readme, "Não existe"), null);
  assert.equal(markdownSection(null, "Como se candidatar"), null);

  const emails = `# E-mails\n\n## 1. E-mail de candidatura\n**Assunto:** Dev\n\`\`\`text\nOlá\n\`\`\`\n\n## 5. Agradecimento\n\`\`\`text\nObrigada\n\`\`\`\n\n## 6. Mensagem curta de apresentação (120/600 caracteres)\nPara o campo "mensagem".\n\`\`\`text\nSou dev back-end e entrego APIs.\n\`\`\`\n`;
  assert.equal(applicationNote(emails), "Sou dev back-end e entrego APIs.");
  assert.equal(applicationNote(emails.split("## 6.")[0]), null, "pacote antigo, sem o item 6");
  assert.equal(applicationNote(null), null);
});

const ANALYSIS = { roleTitle: "Desenvolvedora Back-end Node.js", mustHave: [], atsKeywords: ["Node.js", "PostgreSQL", "Docker", "TypeScript"] };
const EXP = { title: "Desenvolvedora", company: "X", location: "", mode: "", start: "2023", end: "Atual", bullets: ["Criei APIs com Docker.", "Reduzi o tempo de resposta em 40%."] };

test("versões do currículo: retrato do topo e versão do currículo-base, sem IA", () => {
  const r = resume({ headline: "Desenvolvedora Back-end Node.js", summary: "APIs com Node.js e PostgreSQL.", experience: [EXP] });
  const s = resumeStats(r, ANALYSIS, { cover: true, base: "abc12345", at: ago(2) });
  assert.deepEqual(s, {
    at: ago(2),
    base: "abc12345",
    language: "pt-BR",
    titleMatch: true,
    // Docker está no cargo atual (parte do topo); TypeScript não está no currículo, então não conta.
    topKeywords: { found: 3, total: 3 },
    measurable: { withNumber: 1, total: 2 },
    cover: true,
  });
  assert.equal(resumeStats(r, ANALYSIS, { cover: false }).base, undefined, "pacote sem versão registrada");

  // A versão muda com qualquer mudança no currículo-base e é a mesma para o mesmo conteúdo.
  const v1 = baseVersion(r);
  assert.match(v1, /^[0-9a-f]{8}$/);
  assert.equal(baseVersion(resume({ ...r })), v1);
  assert.notEqual(baseVersion({ ...r, summary: `${r.summary} Docker.` }), v1);

  // Pacotes de antes: o retrato sai da pasta (resume.json e analysis.json).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-pkg-"));
  try {
    assert.equal(statsFromPackage(dir), null, "pasta sem os arquivos");
    fs.writeFileSync(path.join(dir, "resume.json"), JSON.stringify(r));
    fs.writeFileSync(path.join(dir, "analysis.json"), JSON.stringify({ analysis: ANALYSIS }));
    const p = statsFromPackage(dir);
    assert.equal(p?.titleMatch, true);
    assert.equal(p?.cover, false);
    assert.equal(p?.base, undefined);
    fs.writeFileSync(path.join(dir, "cover_letter.json"), "{}");
    assert.equal(statsFromPackage(dir, "v1")?.cover, true);
    assert.equal(statsFromPackage(dir, "v1")?.base, "v1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resultados: qual currículo dá resposta (título, versão) e só com a opção ligada", () => {
  const stats = (s: Partial<ResumeStats>): ResumeStats => ({ at: ago(30), language: "pt-BR", titleMatch: true, topKeywords: { found: 3, total: 4 }, measurable: { withNumber: 1, total: 2 }, cover: false, ...s });
  const replied = (s: Partial<ResumeStats>) => job({ status: "interview", appliedAt: ago(20), resumeStats: stats(s) });
  const silent = (s: Partial<ResumeStats>) => job({ status: "rejected", appliedAt: ago(20), outcome: { stage: "sem_resposta", at: ago(1) }, resumeStats: stats(s) });
  const v1 = { base: "v1v1v1v1", at: ago(60), titleMatch: false };
  const v2 = { base: "v2v2v2v2", at: ago(25) };
  const jobs = [
    silent(v1), silent(v1), silent(v1), replied({ ...v1, at: ago(50) }),
    replied(v2), replied(v2), silent({ ...v2, at: ago(24) }),
    replied({ at: ago(90) }), // pacote de antes do registro
    job({ status: "applied", appliedAt: ago(20) }), // enviada sem pacote
  ];

  assert.equal(funnel(jobs, NOW, 30).byResume, undefined, "opção desligada: sem a comparação");
  const f = funnel(jobs, NOW, 30, { resumes: true });
  const r = f.byResume!;
  const by = (groups: typeof r.title) => Object.fromEntries(groups.map((g) => [g.key, [g.sent, g.replyRate]]));
  assert.deepEqual(by(r.title), { sim: [4, 75], nao: [4, 25], "?": [1, null] });
  // Versões em ordem de data, com a data do primeiro pacote de cada uma.
  assert.deepEqual(r.base.map((g) => [g.key, g.label]), [["v1v1v1v1", ago(60)], ["v2v2v2v2", ago(25)], ["antiga", "antes do registro de versões"], ["?", "sem pacote"]]);
  assert.deepEqual(by(r.base).v2v2v2v2, [3, 67]);

  const codes = f.insights.map((i) => i.code);
  assert.ok(codes.includes("resume_title"));
  assert.ok(codes.includes("resume_version"));
  const version = f.insights.find((i) => i.code === "resume_version")!;
  assert.deepEqual([version.vars.bestRate, version.vars.worstRate], [67, 25]);
  // Data e hora: duas versões do mesmo dia não ficam com o mesmo rótulo.
  assert.match(insightText(version), /^A versão de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} do currículo teve 67% de resposta/);
  assert.match(funnelText(f), /Currículo: versão do currículo-base\n.*\n  versão de \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);

  // Um corte com um grupo só (todos sem carta) não compara nada.
  assert.deepEqual(comparable(r.cover), []);
  assert.doesNotMatch(funnelText(f), /carta de apresentação/);
});
