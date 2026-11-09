import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { guessApplyVia } from "../src/jobs/status.js";
import { loadBaseResume, withoutTranslatedTitles } from "../src/profile.js";
import type { Job, Resume } from "../src/schemas.js";
import { fitText, sheetFromResume, sheetMarkdown } from "../src/writers/applicationSheet.js";
import { emlText, gmailComposeUrl } from "../src/writers/emailDraft.js";

const pt = loadBaseResume("pt-BR");
const en = loadBaseResume("en");

/* ------------------------------ cargo em dois idiomas ------------------------------ */

test("currículo em português sem o cargo repetido em inglês", () => {
  const company = pt.experience[0].company;
  const english: Resume = { ...en, experience: [{ ...en.experience[0], company, title: "Developer Analyst" }] };
  const withTranslation: Resume = { ...pt, experience: [{ ...pt.experience[0], title: "Analista Desenvolvedor (Developer Analyst)" }, ...pt.experience.slice(1)] };
  assert.equal(withoutTranslatedTitles(withTranslation, english).experience[0].title, "Analista Desenvolvedor");
  // Parênteses que não são o cargo em inglês ficam.
  const level: Resume = { ...pt, experience: [{ ...pt.experience[0], title: "Analista (Pleno)" }] };
  assert.equal(withoutTranslatedTitles(level, english).experience[0].title, "Analista (Pleno)");
  // Tradução parecida (não idêntica) e empresa com o nome traduzido entre parênteses.
  const founderEn: Resume = { ...en, experience: [{ ...en.experience[0], company: "FlunexApp (own SaaS)", title: "Founder and Lead Software Engineer", start: "04/2026" }] };
  const founderPt: Resume = { ...pt, experience: [{ ...pt.experience[0], company: "FlunexApp (SaaS próprio)", title: "Fundador e Engenheiro de Software Líder (Founder & Lead Engineer)", start: "04/2026" }] };
  assert.equal(withoutTranslatedTitles(founderPt, founderEn).experience[0].title, "Fundador e Engenheiro de Software Líder");
  // Uma palavra só entre parênteses (nível, regime) nunca sai, mesmo que esteja no cargo em inglês.
  const seniorEn: Resume = { ...en, experience: [{ ...en.experience[0], company, title: "Senior Developer" }] };
  const seniorPt: Resume = { ...pt, experience: [{ ...pt.experience[0], title: "Desenvolvedor (Sênior)" }] };
  assert.equal(withoutTranslatedTitles(seniorPt, seniorEn).experience[0].title, "Desenvolvedor (Sênior)");
  // O resume em inglês não muda.
  const enWith: Resume = { ...english, experience: [{ ...english.experience[0], title: "Developer Analyst (Analista Desenvolvedor)" }] };
  assert.equal(withoutTranslatedTitles(enWith, english).experience[0].title, "Developer Analyst (Analista Desenvolvedor)");
});

/* ------------------------------ ficha de candidatura ------------------------------ */

test("resumo em tamanhos: frases inteiras, sem passar do limite", () => {
  const text = "Primeira frase curta. Segunda frase um pouco maior que a primeira. Terceira frase fecha o texto.";
  assert.equal(fitText(text, 30), "Primeira frase curta.");
  assert.equal(fitText(text, 70), "Primeira frase curta. Segunda frase um pouco maior que a primeira.");
  assert.equal(fitText(text, 500), text);
  // "Node.js" e "10.5" não são fim de frase.
  assert.equal(fitText("Trabalho com Node.js e React há 10.5 anos. Outra frase longa que não cabe aqui de jeito nenhum.", 45), "Trabalho com Node.js e React há 10.5 anos.");
  // Uma frase só, maior que o limite: corta na última palavra inteira.
  const cut = fitText("Palavra ".repeat(20).trim() + ".", 30);
  assert.ok(cut.length <= 30 && !cut.endsWith(" "), cut);
});

test("ficha: dados, resumo, cada experiência e competências do currículo, nada novo", () => {
  const sheet = sheetFromResume(pt, "base");
  const field = (label: string) => sheet.sections.flatMap((s) => s.fields).find((f) => f.label === label)?.value;
  assert.equal(field("Nome completo"), pt.name);
  assert.equal(field("E-mail"), pt.contact.email);
  if (pt.contact.phone) assert.match(field("Telefone (só números)") ?? "", /^\d+$/);
  for (const e of pt.experience) assert.ok(sheet.sections.some((s) => s.title.includes(e.company)), e.company);
  const shortSummary = field("Resumo curto (até 300 caracteres)");
  if (shortSummary) assert.ok(shortSummary.length <= 300);
  // Todo valor da ficha vem do currículo: cada pedaço (separado por linha, " · " ou ", ") está nele.
  const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
  const resumeText = strings(pt).join("\n");
  for (const f of sheet.sections.flatMap((s) => s.fields)) {
    if (/^(Sim|Não)$/.test(f.value) || f.label.includes("só números")) continue;
    const pieces = f.value.split(/\n| · |, /).map((p) => p.replace(/^• /, "").replace(/^Tecnologias: /, "").trim()).filter(Boolean);
    for (const p of pieces) assert.ok(resumeText.includes(p), `${f.label}: "${p}" não está no currículo`);
  }
  assert.match(sheetMarkdown(sheet), /^# Ficha de candidatura/);
  assert.equal(sheetFromResume(en).sections[0].title, "Personal details");
});

/* ------------------------------ rascunho de e-mail ------------------------------ */

test("rascunho .eml: abre como e-mail novo, com acento no assunto e o PDF anexado", () => {
  const eml = emlText(
    { to: "rh@empresa.com.br", subject: "Candidatura — Analista de Dados\nBcc: outro@x.com", body: "Olá,\nsegue meu currículo.", attachments: [{ name: "Ana_Currículo.pdf", data: Buffer.from("%PDF-1.4 teste") }] },
    "LIMITE",
  );
  assert.match(eml, /^X-Unsent: 1\r\n/);
  assert.match(eml, /\r\nTo: rh@empresa\.com\.br\r\n/);
  // Quebra de linha no assunto não vira cabeçalho novo (nada de "Bcc:" injetado).
  assert.doesNotMatch(eml, /\r\nBcc:/);
  const subject = eml.match(/\r\nSubject: =\?UTF-8\?B\?([^?]+)\?=/)?.[1];
  assert.equal(Buffer.from(subject!, "base64").toString("utf8"), "Candidatura — Analista de Dados Bcc: outro@x.com");
  const body = eml.split("Content-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--LIMITE")[0].replace(/\r\n/g, "");
  assert.equal(Buffer.from(body, "base64").toString("utf8"), "Olá,\r\nsegue meu currículo.");
  assert.match(eml, /Content-Type: application\/pdf; name="=\?UTF-8\?B\?/);
  assert.match(eml, /Content-Disposition: attachment;/);
  assert.match(eml, /\r\n--LIMITE--\r\n$/);
  // Destinatário inválido fica de fora (a pessoa preenche).
  assert.doesNotMatch(emlText({ to: "(sem e-mail)", subject: "x", body: "y", attachments: [] }), /\r\nTo:/);
});

test("link do Gmail com destinatário, assunto e texto", () => {
  const url = new URL(gmailComposeUrl({ to: "rh@empresa.com", subject: "Vaga & Cia", body: "Olá!\nLinha 2" }));
  assert.equal(url.origin, "https://mail.google.com");
  assert.equal(url.searchParams.get("view"), "cm");
  assert.equal(url.searchParams.get("to"), "rh@empresa.com");
  assert.equal(url.searchParams.get("su"), "Vaga & Cia");
  assert.equal(url.searchParams.get("body"), "Olá!\nLinha 2");
  assert.equal(new URL(gmailComposeUrl({ to: "", subject: "a", body: "b" })).searchParams.has("to"), false);
});

/* ------------------------------ canal da candidatura ------------------------------ */

test("canal provável da candidatura pelo link da vaga", () => {
  const job = (url: string) => ({ url }) as Job;
  assert.equal(guessApplyVia(job("https://br.linkedin.com/jobs/view/123")), "linkedin");
  assert.equal(guessApplyVia(job("https://empresa.gupy.io/jobs/123")), "plataforma");
  assert.equal(guessApplyVia(job("https://objective.inhire.app/vagas/abc")), "plataforma");
  assert.equal(guessApplyVia(job("https://empresa.com.br/trabalhe-conosco")), undefined);
});
