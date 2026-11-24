import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mainRoleFirst, monthIndex, monthsText, pageLimit, pagesFor, professionalMonths } from "../src/career.js";
import { resumeCuration } from "../src/onboarding/build.js";
import { baseResumeIssues, isPageIssue, resumeLimits } from "../src/onboarding/resumeQuality.js";
import { loadBaseResume, loadPreferences } from "../src/profile.js";
import type { Resume } from "../src/schemas.js";

const NOW = new Date(2026, 10, 15); // 15/11/2026
const role = (title: string, company: string, start: string, end: string, bullets: string[] = ["Fiz A."]): Resume["experience"][number] => ({
  title,
  company,
  location: "",
  mode: "",
  start,
  end,
  bullets,
});

test("tempo de carreira: posições ao mesmo tempo não contam em dobro e voluntariado fica de fora", () => {
  assert.equal(monthIndex("03/2024", NOW), 2024 * 12 + 2);
  assert.equal(monthIndex("Atual", NOW), 2026 * 12 + 10);
  assert.equal(monthIndex("Present", NOW), 2026 * 12 + 10);
  assert.equal(monthIndex("sem data", NOW), null);
  assert.equal(monthIndex("Atual (até 01/2027)", NOW), 2026 * 12 + 10, "fim previsto não conta meses que ainda não passaram");
  assert.equal(monthIndex("12/2027", NOW), 2026 * 12 + 10);
  const early = {
    experience: [
      role("Fundador", "Acme (SaaS próprio)", "04/2026", "Atual"),
      role("Analista Desenvolvedor", "Universidade", "02/2025", "Atual"),
      role("Desenvolvedor Voluntário", "ONG", "11/2023", "Atual"),
    ],
  };
  assert.equal(professionalMonths(early, NOW), 22, "02/2025 a 11/2026; o voluntariado de 2023 não conta");
  assert.equal(monthsText(22), "1 ano e 10 meses");
  assert.equal(pageLimit(professionalMonths(early, NOW)), 1);
  // Vale para qualquer área: duas posições em sequência somam.
  const nurse = { experience: [role("Enfermeira", "Hospital B", "01/2023", "Atual"), role("Técnica de enfermagem", "Hospital A", "01/2019", "12/2022")] };
  assert.equal(professionalMonths(nurse, NOW), 95);
  assert.equal(pageLimit(professionalMonths(nurse, NOW)), 2);
});

test("ordem das posições: o emprego principal vem antes da empresa própria e do voluntariado em paralelo", () => {
  const r = {
    experience: [
      role("Fundador e Engenheiro Líder", "Acme", "04/2026", "Atual"),
      role("Analista Desenvolvedor", "Universidade", "02/2025", "Atual"),
      role("Desenvolvedor Voluntário", "ONG", "11/2023", "Atual"),
      role("Estagiário", "Loja", "01/2022", "12/2022"),
    ],
  };
  assert.deepEqual(mainRoleFirst(r).experience.map((e) => e.company), ["Universidade", "Acme", "ONG", "Loja"]);
  // Sem emprego atual de outro tipo, a empresa própria é o trabalho principal: nada muda.
  const founder = { experience: [role("Founder", "Acme", "04/2026", "Present"), role("Developer", "Shop", "01/2022", "03/2026")] };
  assert.equal(mainRoleFirst(founder), founder);
});

test("tamanho do currículo: até 2 páginas por padrão; 1 página ou automático pelas Preferências", () => {
  assert.equal(pagesFor(10), 2, "o padrão é até 2 páginas, mesmo no começo da carreira");
  assert.equal(pagesFor(120, "1"), 1);
  assert.equal(pagesFor(22, "auto"), 1);
  assert.equal(pagesFor(40, "auto"), 2);
  assert.equal(loadPreferences().resume.pages, "ate2", "sem a opção no arquivo, vale o padrão");

  const base = loadBaseResume("pt-BR"); // o exemplo tem mais de 5 anos
  assert.equal(resumeLimits(base).pages, 2);
  assert.equal(resumeLimits(base, "1").pages, 1);
  assert.deepEqual(baseResumeIssues(base, 2), []);
  const early: Resume = {
    ...base,
    experience: [role("Desenvolvedora", "Acme", "02/2025", "Atual", ["A.", "B.", "C.", "D.", "E.", "F."]), role("Voluntária", "ONG", "01/2024", "Atual", ["G."])],
  };
  assert.equal(resumeLimits(early).pages, 2, "começo de carreira com o padrão: 2 páginas, sem aviso");
  assert.ok(!baseResumeIssues(early, 2).some(isPageIssue));
  assert.equal(resumeLimits(early, "auto").pages, 1);
  const issues = baseResumeIssues(early, 2, [], undefined, "auto");
  assert.ok(issues.some((i) => /o currículo cabe em 1 página/.test(i)), issues.join("\n"));
  assert.match(resumeCuration(1), /de 8 a 11 tópicos/);
  assert.match(resumeCuration(1), /em até 1 página/);
  assert.match(resumeCuration(1), /Mantenha as competências que os cargos-alvo pedem/, "em 1 página, competências não são o primeiro corte");
  // A medida diz à IA quanto cortar (ela não vê o PDF).
  const over = baseResumeIssues(early, 2, [], 1.12, "1");
  assert.ok(over.some((i) => /ocupa 112% de uma página: corte cerca de \d+ linhas/.test(i) && isPageIssue(i)), over.join("\n"));
  assert.match(resumeCuration(2), /de 12 a 16 tópicos/);
  assert.match(resumeCuration(2), /voluntariado em paralelo a um emprego vêm depois dele/);
});

test("triagem recebe o tempo de experiência com datas e a regra de senioridade", async () => {
  const { careerLine } = await import("../src/jobs/triage.js");
  const line = careerLine();
  assert.match(line, /Experiência profissional com datas no perfil: \d+ anos?/);
  assert.match(line, /knockout "tempo de experiência" com "nao"/);
  assert.match(line, /o fit não pode ser "alta"/);
});

test("voluntariado tem 1 a 2 tópicos, mesmo atual", () => {
  const base = loadBaseResume("pt-BR");
  const r: Resume = {
    ...base,
    experience: [role("Desenvolvedora", "Acme", "01/2019", "Atual", ["A.", "B.", "C."]), role("Desenvolvedora Voluntária", "ONG", "01/2024", "Atual", ["D.", "E.", "F."])],
  };
  assert.ok(baseResumeIssues(r, 2).some((i) => /3 tópicos de voluntariado; use 1 a 2/.test(i)));
  assert.match(resumeCuration(1), /Voluntariado tem 1 a 2 tópicos/);
});
