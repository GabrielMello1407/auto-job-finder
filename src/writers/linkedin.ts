import fs from "node:fs";
import path from "node:path";
import { ensureDir, paths } from "../config.js";
import { structured } from "../llm.js";
import { loadBaseResume, loadPreferences } from "../profile.js";
import { profileSystem } from "../prompts.js";
import { LinkedinPlanSchema, type LinkedinPlan } from "../schemas.js";
import { today } from "../util/text.js";

/**
 * Plano de LinkedIn: headline, Sobre (PT e EN), experiências, competências, destaques, "Open to Work".
 * Não altera nada no site — você aplica o que aprovar.
 */
export async function linkedinPlan(opts: { currentProfileFile?: string; families?: string[] }) {
  const current = opts.currentProfileFile ? fs.readFileSync(opts.currentProfileFile, "utf8") : "";
  const prefs = loadPreferences();
  const families = opts.families?.length ? opts.families : prefs.targetRoles.length ? prefs.targetRoles : prefs.queries;
  const linkedinUrl = loadBaseResume("pt-BR").contact.linkedin;

  const plan = await structured(LinkedinPlanSchema, {
    label: "write:linkedin",
    effort: "high",
    system: profileSystem(),
    user: `Crie o plano de otimização do LinkedIn do candidato${linkedinUrl ? ` (${linkedinUrl})` : ""} para ser encontrado por recrutadores das famílias de vagas: ${families.join("; ")}.
Buscas que ele faz: ${prefs.queries.join(", ")}.

${current ? `<current_linkedin_text>\n${current}\n</current_linkedin_text>\n\nCompare com o profile_truth e liste em "inconsistencies" datas, cargos, tecnologias ou números que não batem.` : 'Não recebi o texto atual do perfil: em "inconsistencies" liste o que ele deve conferir (datas, cargos, títulos divergentes entre currículo e site).'}

Entregue:
- headlines: 3 opções (máx. 220 caracteres): cargo-alvo + 2–4 competências verdadeiras + o diferencial mais forte das fontes. Pense no que recrutadores digitam na busca.
- aboutPt e aboutEn: seção "Sobre" com 3–5 parágrafos curtos, primeira pessoa, natural, primeiras 2 linhas fortes (aparecem antes do "ver mais"), terminando com as principais competências/ferramentas e forma de contato. Inglês americano no aboutEn (o LinkedIn permite perfil secundário em outro idioma).
- experiences: descrição enxuta por posição (3–5 linhas ou bullets), PT e EN.
- topSkills: as 5 para fixar no topo. skills: 30–50 em ordem de prioridade (o LinkedIn aceita até 100).
- featured: itens para a seção Destaques com URL real das fontes (portfólio, projetos, publicações, cases) e por quê. Só URLs que existem nas fontes.
- keywordsByFamily: palavras-chave por família de vaga.
- openToWork: títulos de cargo (até 5), locais e observações (ex.: só recrutadores vs. público).
- checklist: ações práticas (URL personalizada, foto/banner, localização, e-mail de contato, recomendações a pedir, posts sobre projetos, etc.).

Regras: só fatos das fontes, respeite <never_claim>, não exagerar nível de idioma, tom natural como a pessoa falaria.`,
  });

  const dir = path.join(paths.outputDir, "linkedin");
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, `plano_linkedin_${today()}.json`), JSON.stringify(plan, null, 2));
  const md = linkedinMarkdown(plan);
  const file = path.join(dir, `plano_linkedin_${today()}.md`);
  fs.writeFileSync(file, md);
  return file;
}

function linkedinMarkdown(p: LinkedinPlan): string {
  return `# Plano de LinkedIn — ${today()}

> Nada foi alterado no LinkedIn. Revise e aplique você mesmo o que aprovar.

## 1. Inconsistências para corrigir
${p.inconsistencies.map((i) => `- [ ] ${i}`).join("\n") || "- nenhuma"}

## 2. Headline (escolha uma)
${p.headlines.map((h, i) => `${i + 1}. ${h}  _(${h.length} caracteres)_`).join("\n")}

## 3. Sobre — Português
${p.aboutPt}

## 4. About — English
${p.aboutEn}

## 5. Experiências
${p.experiences.map((e) => `### ${e.title} — ${e.company}\n**PT**\n${e.descriptionPt}\n\n**EN**\n${e.descriptionEn}`).join("\n\n")}

## 6. Competências
**Fixar no topo (5):** ${p.topSkills.join(" · ")}

${p.skills.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## 7. Destaques (Featured)
${p.featured.map((f) => `- **${f.title}** — ${f.url}\n  ${f.why}`).join("\n")}

## 8. Palavras-chave por família de vaga
${p.keywordsByFamily.map((k) => `- **${k.family}:** ${k.keywords.join(", ")}`).join("\n")}

## 9. Open to Work
- Cargos: ${p.openToWork.jobTitles.join(", ")}
- Locais: ${p.openToWork.locations.join(", ")}
- ${p.openToWork.notes}

## 10. Checklist
${p.checklist.map((c) => `- [ ] ${c}`).join("\n")}
`;
}
