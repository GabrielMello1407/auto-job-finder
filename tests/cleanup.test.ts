import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanJobText, jobPageText } from "../src/jobs/page.js";
import { loadBaseResume, withoutDashesResume } from "../src/profile.js";
import { resumeHtml } from "../src/render/resumeHtml.js";
import type { Resume } from "../src/schemas.js";
import { withoutDashes } from "../src/util/text.js";

/* ------------------------------ descrição da vaga sem o resto da página ------------------------------ */

const PAGE = `Software Engineer

StomppAI

Brasil

Software Engineer

StomppAI

Brasil

Há 14 horas

143 candidaturas

Veja quem a StomppAI contratou para este cargo

Salvar

- Denunciar esta vaga

About the Role

We are looking for an experienced Software Engineer to join our growing engineering team.

Requirements

- Strong proficiency in JavaScript, TypeScript, and React.

- Nível de experiência

Pleno-sênior

As indicações dobram suas chances de conseguir uma entrevista na StomppAI

Veja quem você conhece

Receba alertas de novas vagas de Engenheiro de software em: Brasil .

Entre para criar um alerta de vaga

Vagas semelhantes

- SOFTWARE ENGINEER PLENO

Qive

Pesquisas semelhantes

- Vagas de Desenvolvimento web

9.044 vagas`;

test("descrição colada ou baixada do LinkedIn: só a vaga, sem vagas semelhantes nem botões", () => {
  const c = cleanJobText(PAGE);
  assert.match(c, /^Software Engineer\n\nStomppAI\n\nBrasil\n\nAbout the Role/);
  assert.match(c, /Strong proficiency in JavaScript/);
  assert.match(c, /Nível de experiência\n\nPleno-sênior$/);
  for (const junk of ["Vagas semelhantes", "Qive", "Pesquisas semelhantes", "9.044 vagas", "Salvar", "Denunciar", "143 candidaturas", "Há 14 horas", "Veja quem", "Receba alertas", "As indicações"])
    assert.ok(!c.includes(junk), junk);
  // Pode rodar de novo sem mudar nada.
  assert.equal(cleanJobText(c), c);
});

test("limpeza não corta a vaga nem o bloco da pesquisa na web", () => {
  // "Vagas semelhantes" logo no começo não corta tudo; texto normal fica igual.
  const normal = "Analista de Dados\n\nRequisitos\n\n- SQL\n- Power BI\n\nBenefícios\n\n- Vale-refeição";
  assert.equal(cleanJobText(normal), normal);
  const research = `${PAGE}\n\n---\n\n## Pesquisa na web\n\n- Anúncio oficial: https://empresa.com/vaga`;
  assert.match(cleanJobText(research), /About the Role[\s\S]*\n\n---\n\n## Pesquisa na web\n\n- Anúncio oficial/);
});

test("página de vaga do LinkedIn: o bloco da descrição, sem o resto", () => {
  const html = `<html><body><main>
    <h1 class="top-card-layout__title">Software Engineer</h1>
    <a class="topcard__org-name-link" href="#">StomppAI</a><span class="topcard__flavor topcard__flavor--bullet">Brasil</span>
    <div class="show-more-less-html__markup relative overflow-hidden"><p>About the Role</p><p>${"We are looking for an experienced engineer. ".repeat(6)}</p><ul><li>TypeScript</li></ul></div>
    <section><h2>Vagas semelhantes</h2><ul><li>Outra vaga</li></ul></section></main></body></html>`;
  const t = jobPageText(html);
  assert.match(t, /^# Software Engineer\n\nEmpresa: StomppAI\nLocal: Brasil\n\nAbout the Role/);
  assert.ok(!t.includes("Outra vaga"));
});

/* ------------------------------ travessão ------------------------------ */

test("sem travessão: título com parênteses, texto com vírgula, intervalos com hífen", () => {
  assert.equal(withoutDashes("TV Box Educacional — UENP — em desenvolvimento", "title"), "TV Box Educacional (UENP, em desenvolvimento)");
  assert.equal(withoutDashes("Portal de Licitações — engenheiro único.", "text"), "Portal de Licitações, engenheiro único.");
  assert.equal(withoutDashes("Cargo — Empresa (Remoto)", "title"), "Cargo, Empresa (Remoto)");
  assert.equal(withoutDashes("Desenvolvedor Pleno — Gabriel", "subject"), "Desenvolvedor Pleno - Gabriel");
  assert.equal(withoutDashes("Dev Pleno — Node.js | React", "headline"), "Dev Pleno | Node.js | React");
  // Intervalo de datas e números: hífen comum, como uma pessoa digita.
  assert.equal(withoutDashes("Ganho de 10–20× (02/2025 – atual), 2023 – 2024", "text"), "Ganho de 10-20× (02/2025 - atual), 2023 - 2024");
  assert.equal(withoutDashes("02/2019 – 08/2022"), "02/2019 - 08/2022");
});

test("currículo e PDF sem travessão em nenhum título ou texto", () => {
  const base = loadBaseResume("pt-BR");
  const dashed: Resume = {
    ...base,
    headline: `${base.headline} — Node.js`,
    summary: `${base.summary} Atuo com dados — e automação.`,
    projects: [{ name: "TV Box Educacional — UENP — em desenvolvimento", description: "Totem — com IA.", tech: ["Next.js"], url: "" }],
    experience: base.experience.map((e) => ({ ...e, bullets: [...e.bullets, "Liderei a migração — sem perder dados."] })),
  };
  const clean = withoutDashesResume(dashed);
  assert.equal(clean.projects[0].name, "TV Box Educacional (UENP, em desenvolvimento)");
  assert.equal(clean.projects[0].description, "Totem, com IA.");
  // Nenhum "—" nem "–" em lugar nenhum do currículo, datas incluídas.
  const text = JSON.stringify(clean);
  assert.ok(!/[—–]/.test(text), text.match(/.{30}[—–].{30}/)?.[0]);
  // O PDF sai do HTML, que também passa pela limpeza (resume.json antigo ou editado à mão).
  const html = resumeHtml({ ...dashed, education: [{ degree: "Curso", institution: "Faculdade", period: "02/2019 – 08/2022" }] }, "A4");
  const visible = html.replace(/<style[\s\S]*?<\/style>/g, "");
  assert.ok(!/[—–]/.test(visible), visible.match(/.{30}[—–].{30}/)?.[0]);
  assert.match(html, /TV Box Educacional \(UENP, em desenvolvimento\)/);
  assert.match(html, /02\/2019 - 08\/2022/);
});
