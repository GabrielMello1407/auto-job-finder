import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { baseDomain, officialCulture } from "../src/jobs/research.js";
import type { Job } from "../src/schemas.js";
import { isCompanyQuestion, jobFocus, shouldSuggestResearch } from "../src/writers/answers.js";

/* ------------------------------ respostas com o contexto da empresa ------------------------------ */

test("pergunta sobre a empresa: por que ela, cultura, valores, o produto de vocês, o nome da empresa", () => {
  const yes = [
    "Por que você quer trabalhar aqui?",
    "Porque vc quer trabalhar na Acme?",
    "O que você conhece da nossa empresa?",
    "Como os nossos valores combinam com os seus?",
    "O que você acha do nosso app?",
    "Por que você gostaria de fazer parte do time?",
    "Why do you want to join Studio Nébula?",
    "Why would you like to work here?",
    "What do you think of our product?",
    "How does our mission resonate with you?",
    "¿Por qué quieres trabajar con nosotros?",
  ];
  for (const q of yes) assert.equal(isCompanyQuestion(q, "Studio Nébula"), true, q);
  assert.equal(isCompanyQuestion("O que te atrai na Clínica Bem-Estar?", "Clínica Bem-Estar Exemplo"), true, "nome da empresa");

  const no = [
    "Fale de um projeto de que você se orgulha.",
    "Qual a sua pretensão salarial?",
    "Descreva a sua experiência com React e Node.js.",
    "Tell us about a time you solved a hard bug.",
    "Por que você quer sair do seu emprego atual?",
    "Why do you want to leave your current company?",
    "Conte uma situação difícil na sua empresa anterior.",
  ];
  for (const q of no) assert.equal(isCompanyQuestion(q, "Studio Nébula"), false, q);
  // Palavra genérica do nome ("Exemplo", "Tecnologia") não faz a pergunta ser sobre a empresa.
  assert.equal(isCompanyQuestion("Dê um exemplo de liderança.", "Nuvem Azul Tecnologia Exemplo"), false);
});

const job = (extra: Partial<Job> = {}): Job =>
  ({ id: "j1", company: "Acme Pagamentos", title: "Dev", description: "", status: "triaged", source: "t", url: "https://acme.com.br/vaga", ...extra }) as Job;

test("sugerir a pesquisa: só quando a missão e os valores ainda não foram pesquisados e a IA busca na web", () => {
  const q = "Por que você quer trabalhar aqui?";
  assert.equal(shouldSuggestResearch(job(), q, true), true, "nunca pesquisada");
  const research = { at: "2026-11-01T00:00:00Z", verdict: "confirmada" as const, notes: [] };
  assert.equal(shouldSuggestResearch(job({ research }), q, true), true, "pesquisa antiga, sem missão e valores");
  assert.equal(shouldSuggestResearch(job({ research: { ...research, culture: [] } }), q, true), false, "pesquisou e a página não fala disso");
  assert.equal(shouldSuggestResearch(job({ research: { ...research, culture: [{ text: "x", source: "https://acme.com.br" }] } }), q, true), false);
  assert.equal(shouldSuggestResearch(job(), q, false), false, "IA sem busca na web");
  assert.equal(shouldSuggestResearch(job(), "Fale de um projeto de que você se orgulha.", true), false);
});

test("missão e valores: só com link de página oficial da empresa", () => {
  assert.equal(baseDomain("https://www.acme.com.br/sobre"), "acme.com.br");
  assert.equal(baseDomain("https://careers.acme.com/values"), "acme.com");
  assert.equal(baseDomain("https://acme.co.uk"), "acme.co.uk");
  assert.equal(baseDomain("ftp://acme.com"), "");
  assert.equal(baseDomain("acme.com"), "");

  const items = [
    { text: "Missão: pagamentos simples.", source: "https://www.acme.com.br/sobre" },
    { text: "Valor: dono do problema.", source: "https://acme.gupy.io/" },
    { text: "Cultura remota.", source: "https://boards.greenhouse.io/acmepagamentos" },
    { text: "Ótimo lugar para trabalhar.", source: "https://www.glassdoor.com.br/Avaliacoes/Acme-Pagamentos" },
    { text: "Valor de outra empresa.", source: "https://boards.greenhouse.io/outra" },
    { text: "Sem link.", source: "" },
    { text: "Link inválido.", source: "acme.com.br/sobre" },
    { text: "  ", source: "https://acme.com.br/vazio" },
    { text: "Perfil no LinkedIn.", source: "https://www.linkedin.com/company/acme-pagamentos" },
  ];
  const kept = officialCulture(items, "Acme Pagamentos", "https://acme.com.br", undefined).map((i) => i.text);
  assert.deepEqual(kept, ["Missão: pagamentos simples.", "Valor: dono do problema.", "Cultura remota."]);
  // Sem o site da empresa: vale o endereço que tem o nome dela.
  assert.deepEqual(officialCulture([{ text: "Missão.", source: "https://acme.example/sobre" }], "Acme"), [{ text: "Missão.", source: "https://acme.example/sobre" }]);
  assert.deepEqual(officialCulture([{ text: "Missão.", source: "https://outra.com/sobre" }], "Acme"), []);
});

test("foco da resposta: análise do pacote, provas e lacunas da triagem, missão e valores com a fonte", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-focus-"));
  try {
    fs.writeFileSync(
      path.join(dir, "analysis.json"),
      JSON.stringify({
        analysis: {
          companyContext: "Fintech de pagamentos para pequenos negócios; valoriza autonomia.",
          mustHave: ["Node.js", "PostgreSQL"],
          niceToHave: ["Filas"],
          responsibilities: ["Construir APIs de pagamento"],
        },
      }),
    );
    const focus = jobFocus(
      job({
        outputDir: dir,
        triage: { evidence: ["APIs REST em Node.js"], mustHaveGaps: ["Kubernetes"] } as unknown as Job["triage"],
        research: { at: "2026-11-01T00:00:00Z", verdict: "confirmada", notes: [], culture: [{ text: "Missão: pagamentos simples.", source: "https://acme.com.br/sobre" }] },
      }),
    );
    assert.match(focus, /O que a empresa faz e valoriza, segundo a vaga: Fintech de pagamentos/);
    assert.match(focus, /Requisitos obrigatórios: Node\.js; PostgreSQL/);
    assert.match(focus, /Diferenciais: Filas/);
    assert.match(focus, /Responsabilidades: Construir APIs de pagamento/);
    assert.match(focus, /Provas do perfil que a triagem ligou à vaga: APIs REST em Node\.js/);
    assert.match(focus, /lacunas: a pessoa não tem, não afirme\): Kubernetes/);
    assert.match(focus, /- Missão: pagamentos simples\. \(fonte: https:\/\/acme\.com\.br\/sobre\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Sem pacote, triagem nem pesquisa: nada a acrescentar.
  assert.equal(jobFocus(job()), "");
});
