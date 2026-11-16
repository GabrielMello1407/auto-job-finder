import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { RESUME_CURATION } from "../src/onboarding/build.js";
import { baseResumeIssues, MAX_BULLETS, MAX_MAIN_BULLETS, withoutPendingNotes } from "../src/onboarding/resumeQuality.js";
import { loadBaseResume } from "../src/profile.js";
import { resumeHtml } from "../src/render/resumeHtml.js";
import type { Resume } from "../src/schemas.js";

/* ------------------------- currículo-base como um recrutador leria (sem IA) ------------------------- */

const base = loadBaseResume("pt-BR");
const job = (bullets: string[]): Resume["experience"][number] => ({ title: "Desenvolvedora", company: "Acme", location: "", mode: "", start: "01/2024", end: "Atual", bullets });

test("currículo-base do exemplo passa na conferência", () => {
  assert.deepEqual(baseResumeIssues(base, 2), []);
});

test("conferência: tópicos demais, notas internas, contadores, prefixo repetido, páginas", () => {
  const bloated: Resume = {
    ...base,
    experience: [
      job([
        ...Array.from({ length: MAX_MAIN_BULLETS }, (_, i) => `Implementei a funcionalidade ${i + 1} com Node.js.`),
        "Registra cerca de 26 mil mensagens em 30 dias, volumes estimados e autodeclarados em 11/2026.",
        "Levantamento de 16/11/2026: 928 commits e cerca de 220 mil linhas de TypeScript.",
      ]),
      job(["Projeto X: fiz A.", "Projeto X: fiz B.", "Projeto X: fiz C.", `Tópico ${"muito ".repeat(60)}longo.`, "E.", "F.", "G."]),
    ],
  };
  const issues = baseResumeIssues(bloated, 4);
  const has = (re: RegExp) => assert.ok(issues.some((i) => re.test(i)), `faltou: ${re}\n${issues.join("\n")}`);
  has(/10 tópicos; o máximo é 8 \(posição principal\)/);
  has(/7 tópicos; o máximo é 6 \(só a posição principal passa de 6\)/);
  has(/nota interna do perfil no tópico \("autodeclarad/);
  has(/nota interna do perfil no tópico \("Levantamento de 1/);
  has(/contador de trabalho que não é resultado \("928 commits"\)/);
  has(/o prefixo "projeto x:" se repete em 3 tópicos/);
  has(/tópico longo demais/);
  has(/o PDF ficou com 4 páginas/);
  assert.ok(!issues.some((i) => /26 mil mensagens/.test(i) && /contador/.test(i)), "volume de uso não é contador de trabalho");
});

test("a posição principal pode ter até 8 tópicos quando reúne projetos diferentes; as outras, até 6", () => {
  const ok: Resume = { ...base, experience: [job(Array.from({ length: MAX_MAIN_BULLETS }, (_, i) => `Entreguei o projeto ${i + 1}.`)), job(Array.from({ length: MAX_BULLETS }, (_, i) => `Fiz ${i + 1}.`))] };
  assert.deepEqual(baseResumeIssues(ok, 2), []);
});

test("pendência nunca vai para o currículo", () => {
  const r = withoutPendingNotes({ ...base, experience: [job(["Criei a API.", "Desenvolvimento desde 03/2026. A confirmar: a data de início."])] });
  assert.deepEqual(r.experience[0].bullets, ["Criei a API."]);
});

test("regras do currículo-base: seleção, limites e números que ajudam", () => {
  for (const rule of [/SELEÇÃO do perfil/, /até 8 quando reúne projetos diferentes/, /nunca mais de 6/, /Use o espaço: o limite é 2 páginas, não 1/, /contadores internos de trabalho/, /autodeclarado/, /A confirmar/, /cerca de 250 caracteres/])
    assert.match(RESUME_CURATION, rule);
});

test("PDF: título da seção e cabeçalho do cargo nunca ficam sozinhos no fim da página", () => {
  const html = resumeHtml({ ...base, experience: [job(["A.", "B.", "C.", "D."])] }, "A4");
  assert.match(html, /\.keep \{ break-inside: avoid-page; \}/);
  assert.match(html, /<div class="keep"><h2>[^<]+<\/h2><div class="job-title">Desenvolvedora<\/div>[\s\S]*?<ul class="lead"><li>A\.<\/li><li>B\.<\/li><\/ul><\/div>\s*<ul class="rest"><li>C\.<\/li><li>D\.<\/li><\/ul>/);
  assert.doesNotMatch(html, /\.job \{ break-inside/, "o cargo inteiro não é mais indivisível (deixava meia página em branco)");
});
