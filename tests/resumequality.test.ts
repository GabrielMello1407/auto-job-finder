import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { marketBlock, RESUME_CURATION } from "../src/onboarding/build.js";
import { countKeywords, mentions, minJobs, splitMarket } from "../src/onboarding/marketKeywords.js";
import { baseResumeIssues, MAX_BULLETS, MAX_MAIN_BULLETS, MAX_TOTAL_BULLETS, resumeHints, withoutPendingNotes } from "../src/onboarding/resumeQuality.js";
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
  for (const rule of [
    /SELEÇÃO do perfil/,
    /duas posições atuais e relevantes valem igual/,
    /pode chegar a 8 quando reúne projetos ou frentes diferentes/,
    /de 12 a 16 tópicos de experiência/,
    /cada um que for relevante ganha um tópico antes de outro ganhar o segundo/,
    /não junte duas realizações sem relação/,
    /Sem adjetivos genéricos/,
    /contadores internos de trabalho/,
    /autodeclarado/,
    /A confirmar/,
    /cerca de 250 caracteres/,
    /Nunca use um termo que o perfil não comprova/,
  ])
    assert.match(RESUME_CURATION, rule);
});

test("limite total de tópicos: a conferência aponta acima de 18", () => {
  const many: Resume = { ...base, experience: [job(Array.from({ length: 6 }, (_, i) => `A${i}.`)), job(Array.from({ length: 6 }, (_, i) => `B${i}.`)), job(Array.from({ length: 7 }, (_, i) => `C${i}.`))] };
  assert.equal(MAX_TOTAL_BULLETS, 18);
  assert.ok(baseResumeIssues(many, 2).some((i) => /19 tópicos de experiência no total; mire em 12 a 16/.test(i)));
});

/* ------------------------------ palavras do mercado da própria pessoa ------------------------------ */

test("palavras do mercado: contam as vagas, só entram as que o perfil comprova, lacunas ficam de fora", () => {
  // Vale para qualquer área: aqui, vagas de enfermagem.
  const lists = [
    ["UTI", "SAE", "COREN ativo", "Excel"],
    ["UTI", "sae", "Ventilação mecânica"],
    ["UTI", "SAE", "COREN ativo", "Ventilação mecânica"],
    ["UTI", "Ventilação mecânica", "Excel", "UTI"],
    ["Pediatria"],
  ];
  const market = countKeywords(lists);
  assert.deepEqual(market.slice(0, 3), [
    { term: "UTI", jobs: 4 },
    { term: "SAE", jobs: 3 },
    { term: "Ventilação mecânica", jobs: 3 },
  ], "cada vaga conta uma vez por termo, sem diferença de maiúsculas");
  assert.equal(minJobs(5), 3);
  assert.equal(minJobs(100), 5);

  const truth = `# Perfil\n## Experiência\n### Enfermeira, Hospital X\n- Plantões na UTI adulto com SAE e ventilação mecânica.\n## Lacunas conhecidas\n- Sem COREN ativo no momento.\n`;
  const { proven, gaps } = splitMarket(market, truth, lists.length);
  assert.deepEqual(proven.map((k) => k.term), ["UTI", "SAE", "Ventilação mecânica"]);
  assert.deepEqual(gaps.map((k) => k.term), [], "COREN e Excel estão em só 2 vagas; abaixo do mínimo");
  const gaps2 = splitMarket(countKeywords([...lists, ["COREN ativo"]]), truth, 6).gaps;
  assert.deepEqual(gaps2.map((k) => k.term), ["COREN ativo"], "o que só aparece em Lacunas é lacuna, não prova");

  assert.ok(mentions("Atuei com Node.js e CI/CD.", "node.js"));
  assert.ok(mentions("Atuei com Node.js e CI/CD.", "CI/CD"));
  assert.ok(!mentions("Javascript", "Java"), "palavra inteira");
  assert.ok(mentions("Participo de code review.", "code reviews"), "o plural da vaga casa com o singular do perfil");
});

test("palavras do mercado: vão para o prompt e a conferência aponta as que faltam no currículo", () => {
  assert.equal(marketBlock([]), "");
  assert.match(marketBlock([{ term: "UTI", jobs: 4 }]), /<palavras_do_mercado>\n- UTI \(em 4 vagas analisadas\)\n<\/palavras_do_mercado>/);
  const r: Resume = { ...base, experience: [job(["Plantões na UTI adulto."])] };
  const issues = baseResumeIssues(r, 2, [
    { term: "UTI", jobs: 4 },
    { term: "SAE", jobs: 3 },
  ]);
  assert.ok(issues.some((i) => /currículo não mostra: "SAE" \(3 vagas\)/.test(i)));
  assert.ok(!issues.some((i) => /"UTI"/.test(i)), "o que já está no currículo não é apontado");
});

test("avisos para a pessoa: telefone, formação sem período, cargos atuais demais", () => {
  const r: Resume = {
    ...base,
    contact: { ...base.contact, phone: "" },
    education: [{ degree: "Extensão em Algo", institution: "Universidade", period: "" }],
    experience: [job(["A."]), job(["B."]), job(["C."])],
  };
  const hints = resumeHints(r);
  assert.ok(hints.some((h) => /Sem telefone/.test(h)));
  assert.ok(hints.some((h) => /Formação sem período: "Extensão em Algo"/.test(h)));
  assert.ok(hints.some((h) => /3 cargos atuais ao mesmo tempo/.test(h)));
  assert.deepEqual(resumeHints({ ...base, contact: { ...base.contact, phone: "(11) 90000-0000" }, education: [], experience: [job(["A."])] }), []);
});

test("PDF: título da seção e cabeçalho do cargo nunca ficam sozinhos no fim da página", () => {
  const html = resumeHtml({ ...base, experience: [job(["A.", "B.", "C.", "D."])] }, "A4");
  assert.match(html, /\.keep \{ break-inside: avoid-page; \}/);
  assert.match(html, /<div class="keep"><h2>[^<]+<\/h2><div class="job-title">Desenvolvedora<\/div>[\s\S]*?<ul class="lead"><li>A\.<\/li><li>B\.<\/li><\/ul><\/div>\s*<ul class="rest"><li>C\.<\/li><li>D\.<\/li><\/ul>/);
  assert.doesNotMatch(html, /\.job \{ break-inside/, "o cargo inteiro não é mais indivisível (deixava meia página em branco)");
});
