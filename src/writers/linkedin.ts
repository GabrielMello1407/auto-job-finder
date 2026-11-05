import fs from "node:fs";
import path from "node:path";
import { ensureDir, paths } from "../config.js";
import { structured } from "../llm.js";
import { readFileSource } from "../onboarding/sources.js";
import { loadBaseResume, loadPreferences } from "../profile.js";
import { profileSystem } from "../prompts.js";
import { LinkedinCheckSchema, LinkedinPlanSchema, type LinkedinCheck, type LinkedinPlan } from "../schemas.js";
import { today } from "../util/text.js";

/**
 * Plano de LinkedIn (headline, Sobre PT/EN, experiências, competências, destaques, "Open to Work") e
 * conferência do LinkedIn atual. O agente não acessa o LinkedIn: ele só sabe como o perfil está lá
 * pelo texto ou pelo PDF exportado que a pessoa manda. Nada é alterado no site.
 */

const linkedinDir = () => path.join(paths.outputDir, "linkedin");

/** Texto do LinkedIn atual a partir de um arquivo: PDF exportado ("Salvar como PDF"), DOCX, TXT ou MD. */
export async function readLinkedinFile(file: string): Promise<string> {
  return /\.(pdf|docx)$/i.test(file) ? (await readFileSource(file)).text : fs.readFileSync(file, "utf8");
}

export interface LinkedinDoc {
  kind: "plano" | "conferencia";
  file: string;
  date: string;
}

/** Planos e conferências já gerados, do mais novo para o mais antigo. */
export function linkedinHistory(): LinkedinDoc[] {
  const dir = linkedinDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => ({ f, m: f.match(/^(plano|conferencia)_linkedin_.*\.md$/i) }))
    .filter((x) => x.m)
    .map(({ f, m }) => {
      const file = path.join(dir, f);
      return { kind: m![1].toLowerCase() as LinkedinDoc["kind"], file, date: fs.statSync(file).mtime.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function latestPlanJson(): { plan: LinkedinPlan; date: string } | null {
  const md = linkedinHistory().find((d) => d.kind === "plano");
  const json = md && md.file.replace(/\.md$/i, ".json");
  if (!json || !fs.existsSync(json)) return null;
  try {
    return { plan: JSON.parse(fs.readFileSync(json, "utf8")), date: md!.date };
  } catch {
    return null;
  }
}

function save(base: string, data: unknown, md: string): string {
  ensureDir(linkedinDir());
  fs.writeFileSync(path.join(linkedinDir(), `${base}.json`), JSON.stringify(data, null, 2));
  const file = path.join(linkedinDir(), `${base}.md`);
  fs.writeFileSync(file, md);
  return file;
}

export async function linkedinPlan(opts: { current?: string; currentProfileFile?: string; families?: string[] }) {
  const current = opts.current ?? (opts.currentProfileFile ? await readLinkedinFile(opts.currentProfileFile) : "");
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

  return save(`plano_linkedin_${today()}`, plan, linkedinMarkdown(plan, Boolean(current)));
}

/**
 * Confere o LinkedIn atual (texto ou PDF exportado) contra o perfil e contra o último plano:
 * o que está certo, o que do plano ainda falta e o que está inconsistente. Mais leve que um plano novo.
 */
export async function linkedinCheck(current: string): Promise<string> {
  if (current.trim().length < 200) throw new Error("Mande o texto ou o PDF do seu LinkedIn atual: sem ele não há o que conferir.");
  const last = latestPlanJson();
  const check = await structured(LinkedinCheckSchema, {
    label: "write:linkedin-check",
    effort: "medium",
    system: profileSystem(),
    user: `<current_linkedin_text>
${current}
</current_linkedin_text>

${
  last
    ? `<ultimo_plano data="${last.date.slice(0, 10)}">
${JSON.stringify({ headlines: last.plan.headlines, aboutPt: last.plan.aboutPt, topSkills: last.plan.topSkills, featured: last.plan.featured, openToWork: last.plan.openToWork, checklist: last.plan.checklist, inconsistencies: last.plan.inconsistencies }, null, 2)}
</ultimo_plano>`
    : "(ainda não há plano de LinkedIn)"
}

Confira o LinkedIn atual da pessoa:
- issues: tudo o que no LinkedIn contradiz o profile_truth — datas, cargos, empresas, números, nível de idioma, curso apresentado como certificação, algo que está em <never_claim>. Para cada um, a correção exata.
- pending: o que do último plano ainda não aparece no LinkedIn (headline no espírito de uma das opções, "Sobre", competências fixadas, destaques, Open to Work, itens do checklist que dá para ver no texto). Itens que não dá para conferir pelo texto (ex.: foto, banner, URL personalizada) não entram.
- ok: o que já está certo ou já foi aplicado do plano.
Seja específico e curto. Não peça para incluir nada que não esteja no profile_truth.`,
  });
  return save(`conferencia_linkedin_${today()}`, check, checkMarkdown(check, last?.date));
}

function checkMarkdown(c: LinkedinCheck, planDate?: string): string {
  return `# Conferência do LinkedIn — ${today()}

> Comparado com o seu perfil${planDate ? ` e com o plano de ${planDate.slice(0, 10)}` : ""}. Nada foi alterado no LinkedIn.

${c.summary}

## ⚠️ Para corrigir
${c.issues.map((i) => `- [ ] **${i.problem}** — ${i.fix}`).join("\n") || "- nada: o LinkedIn bate com o seu perfil"}

## ⏳ Do plano, ainda falta
${c.pending.map((p) => `- [ ] ${p}`).join("\n") || (planDate ? "- nada: o plano já foi aplicado" : "- (ainda não há plano de LinkedIn)")}

## ✅ Já está certo
${c.ok.map((o) => `- ${o}`).join("\n") || "- (nada confirmado)"}
`;
}

function linkedinMarkdown(p: LinkedinPlan, hadCurrent: boolean): string {
  return `# Plano de LinkedIn — ${today()}

> Nada foi alterado no LinkedIn. Revise e aplique você mesmo o que aprovar.${hadCurrent ? "" : " Este plano não recebeu o seu LinkedIn atual: as inconsistências são só o que conferir."}

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
