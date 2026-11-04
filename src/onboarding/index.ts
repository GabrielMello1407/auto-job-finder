import fs from "node:fs";
import path from "node:path";
import { checkbox, confirm, editor, input, select } from "@inquirer/prompts";
import { ensureDir, hasProfile, paths } from "../config.js";
import { DEFAULT_PREFERENCES, loadPreferences, type Preferences } from "../profile.js";
import { renderBaseResumes } from "../render/base.js";
import { slugify } from "../util/text.js";
import { buildBaseResume, buildProfile, readIntake, type Intake, type PreferenceAnswers } from "./build.js";
import { chooseProvider } from "./provider.js";
import { LINKEDIN_EXPORT_HELP, readSource, type SourceDoc } from "./sources.js";

/**
 * `ajf init`: monta o perfil de QUALQUER pessoa a partir do que ela tiver — currículo (PDF/DOCX),
 * PDF exportado do LinkedIn, portfólio/site, GitHub, texto colado ou respostas a perguntas.
 * Gera profile/profile_truth.md, base_resume.pt/en.json, preferences.json e rules.json.
 */

const TECH_SOURCES = ["github-br", "getonbrd", "remotive", "himalayas", "remoteok", "jobicy", "weworkremotely"];
const GENERAL_SOURCES = ["remotive", "himalayas", "jobicy", "arbeitnow"];

const split = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Currículos/portfólios soltos na pasta de trabalho (ex.: o PDF que a pessoa copiou para cá). */
function findLocalDocs(): string[] {
  const dirs = [paths.home, path.join(paths.profileDir, "entrada")];
  const out: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (/\.(pdf|docx)$/i.test(f)) out.push(path.join(dir, f));
  }
  return out;
}

async function addSource(sources: SourceDoc[], value: string) {
  try {
    process.stdout.write(`   lendo ${value}...\n`);
    const doc = await readSource(value);
    sources.push(doc);
    console.log(`   ✅ ${doc.label} (${doc.text.length.toLocaleString("pt-BR")} caracteres)${doc.kind === "linkedin" ? " — reconheci o PDF do LinkedIn" : ""}`);
  } catch (e) {
    console.log(`   ⚠ ${(e as Error).message}`);
  }
}

/** Respostas da entrevista guiada (terminal ou interface) para quem não tem currículo pronto. */
export interface InterviewAnswers {
  name?: string;
  city?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  portfolio?: string;
  goal?: string;
  experiences?: { company?: string; title?: string; start?: string; end?: string; description?: string }[];
  education?: string;
  courses?: string;
  skills?: string;
  languages?: string;
  achievements?: string;
}

const INTERVIEW_LABELS: [keyof InterviewAnswers, string][] = [
  ["name", "Nome"],
  ["city", "Cidade"],
  ["email", "E-mail"],
  ["phone", "Telefone"],
  ["linkedin", "LinkedIn"],
  ["portfolio", "Portfólio/site"],
  ["goal", "Objetivo"],
];
const INTERVIEW_TAIL: [keyof InterviewAnswers, string][] = [
  ["education", "Formação"],
  ["courses", "Cursos e certificações"],
  ["skills", "Ferramentas e competências"],
  ["languages", "Idiomas"],
  ["achievements", "Resultados"],
];

export function interviewSource(a: InterviewAnswers, origin = "ajf init"): SourceDoc {
  const lines: string[] = [];
  const add = ([key, label]: [keyof InterviewAnswers, string]) => {
    const v = String(a[key] ?? "").trim();
    if (v) lines.push(`${label}: ${v}`);
  };
  INTERVIEW_LABELS.forEach(add);
  (a.experiences ?? [])
    .filter((e) => e.company?.trim() || e.title?.trim())
    .forEach((e, i) => lines.push(`\nExperiência ${i + 1}: ${e.title ?? ""} — ${e.company ?? ""} (${e.start ?? "?"} – ${e.end ?? "?"})\n${(e.description ?? "").trim()}`));
  INTERVIEW_TAIL.forEach(add);
  return { kind: "respostas", label: "Entrevista guiada", origin, text: lines.join("\n") };
}

/** Entrevista guiada no terminal. */
async function guidedInterview(): Promise<SourceDoc> {
  console.log("\nVamos montar do zero. Responda com suas palavras; Enter pula a pergunta.\n");
  const a: InterviewAnswers = { experiences: [] };
  const ask = async (key: keyof InterviewAnswers, message: string) => {
    (a as Record<string, unknown>)[key] = (await input({ message })).trim();
  };
  await ask("name", "Nome completo:");
  await ask("city", "Cidade/UF (ex.: Londrina, PR):");
  await ask("email", "E-mail profissional:");
  await ask("phone", "Telefone/WhatsApp (opcional):");
  await ask("linkedin", "Link do LinkedIn (opcional):");
  await ask("portfolio", "Portfólio, site ou GitHub (opcional):");
  await ask("goal", "Qual cargo/área você quer?");

  while (
    await confirm({
      message: a.experiences!.length ? "Adicionar outra experiência?" : "Adicionar uma experiência profissional (emprego, estágio, freela, voluntariado)?",
      default: a.experiences!.length === 0,
    })
  ) {
    a.experiences!.push({
      company: await input({ message: "  Empresa/organização:" }),
      title: await input({ message: "  Cargo:" }),
      start: await input({ message: "  Início (MM/AAAA):" }),
      end: await input({ message: "  Fim (MM/AAAA ou 'Atual'):" }),
      description: await editor({
        message: "  O que você fazia e quais resultados? (vou abrir o editor; use números reais se tiver; salve e feche)",
        waitForUserInput: false,
      }),
    });
  }
  await ask("education", "Formação (curso, instituição, período):");
  await ask("courses", "Cursos e certificações (diga quais são certificações oficiais):");
  await ask("skills", "Ferramentas, sistemas e competências que você usa:");
  await ask("languages", "Idiomas e nível (ex.: inglês intermediário):");
  await ask("achievements", "Algum resultado ou conquista que você se orgulha (com números, se tiver)?");
  return interviewSource(a);
}

async function collectSources(prefilled: string[]): Promise<SourceDoc[]> {
  const sources: SourceDoc[] = [];
  for (const v of prefilled) await addSource(sources, v);

  const local = findLocalDocs().filter((f) => !prefilled.some((p) => path.resolve(p) === f));
  if (local.length) {
    const picks = await checkbox({
      message: "Encontrei estes arquivos na pasta. Quais são seus (currículo, portfólio, PDF do LinkedIn)? ESPAÇO marca, ENTER confirma",
      choices: local.map((f) => ({ name: path.relative(paths.home, f), value: f, checked: true })),
    });
    for (const f of picks) await addSource(sources, f);
  }

  for (;;) {
    const action = await select({
      message: sources.length ? `Fontes: ${sources.length}. Quer adicionar mais alguma?` : "O que você tem para eu montar seu perfil?",
      choices: [
        { name: "📄 Currículo ou portfólio (PDF, DOCX, TXT)", value: "file" },
        { name: "💼 PDF do LinkedIn (perfil → Mais → Salvar como PDF)", value: "linkedin" },
        { name: "🌐 Link: portfólio, site pessoal ou GitHub", value: "link" },
        { name: "📝 Colar texto (perfil do LinkedIn, descrição da carreira)", value: "paste" },
        { name: "🗣  Não tenho currículo: responder perguntas", value: "interview" },
        ...(sources.length ? [{ name: "✅ Pronto, continuar", value: "done" }] : []),
      ],
    });
    if (action === "done") return sources;
    if (action === "file" || action === "linkedin") {
      if (action === "linkedin") console.log(`   ${LINKEDIN_EXPORT_HELP}`);
      const v = await input({ message: "Caminho do arquivo (pode arrastar o arquivo para o terminal):" });
      if (v.trim()) await addSource(sources, v);
    }
    if (action === "link") {
      const v = await input({ message: "Link (ex.: https://meusite.com ou https://github.com/usuario):" });
      if (v.trim()) await addSource(sources, v);
    }
    if (action === "paste") {
      const text = await editor({ message: "Vou abrir o editor: cole o texto, salve e feche.", postfix: ".md", waitForUserInput: false });
      if (text.trim().length > 40) {
        sources.push({ kind: "texto", label: "Texto colado", origin: "colado no ajf init", text: text.trim() });
        console.log("   ✅ texto adicionado");
      }
    }
    if (action === "interview") sources.push(await guidedInterview());
  }
}

function backupProfile(): string | null {
  const files = ["profile_truth.md", "base_resume.pt.json", "base_resume.en.json", "preferences.json", "rules.json"]
    .map((f) => path.join(paths.profileDir, f))
    .filter((f) => fs.existsSync(f));
  if (!files.length) return null;
  const dir = path.join(paths.profileDir, `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);
  ensureDir(dir);
  for (const f of files) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  return dir;
}

export function saveSources(sources: SourceDoc[]) {
  ensureDir(paths.sourcesDir);
  sources.forEach((s, i) =>
    fs.writeFileSync(path.join(paths.sourcesDir, `${String(i + 1).padStart(2, "0")}-${s.kind}-${slugify(s.label, 40)}.txt`), `# ${s.label}\n# origem: ${s.origin}\n\n${s.text}\n`),
  );
}

/** Escolhas da pessoa sobre as vagas que quer (perguntadas no terminal ou na interface). */
export interface ProfileChoices {
  targetRoles: string[];
  seniority: string;
  /** "remoto" = só remoto; "remoto+regiao" = remoto ou presencial/híbrido nas cidades; "qualquer" = qualquer modalidade nas cidades. */
  mode: "remoto" | "remoto+regiao" | "qualquer";
  onsiteCities: string[];
  country: string;
  timezone: string;
  international: boolean;
}

export const WORK_MODES: Record<ProfileChoices["mode"], string> = {
  remoto: "só remoto",
  "remoto+regiao": "remoto, ou híbrido/presencial nas cidades informadas",
  qualquer: "qualquer modalidade nas cidades informadas",
};

/**
 * Monta e grava o perfil: profile_truth.md, currículos-base PT/EN, preferences.json e rules.json.
 * O perfil anterior vai para um backup. Usado pelo `ajf init` e pela interface.
 */
export async function buildAndSaveProfile(p: {
  sources: SourceDoc[];
  answers: { question: string; answer: string }[];
  choices: ProfileChoices;
  intake: Intake;
}): Promise<{ backup: string | null }> {
  const { sources, answers, choices, intake } = p;
  const onsiteCities = choices.mode === "remoto" ? [] : choices.onsiteCities;
  const prefsAnswers: PreferenceAnswers = {
    targetRoles: choices.targetRoles.length ? choices.targetRoles : intake.suggestedTargetRoles,
    seniority: choices.seniority,
    workModes: WORK_MODES[choices.mode],
    onsiteCities,
    international: choices.international,
    country: choices.country,
  };

  console.log("\n🛠  Montando seu perfil (pode levar alguns minutos)...");
  const built = await buildProfile({ sources, answers, prefs: prefsAnswers, intake });
  console.log("   currículo-base em português...");
  const pt = await buildBaseResume(built.profileTruth, "pt-BR");
  console.log("   currículo-base em inglês...");
  const en = await buildBaseResume(built.profileTruth, "en", pt);

  const backup = backupProfile();
  ensureDir(paths.profileDir);
  const old = fs.existsSync(paths.preferences) ? loadPreferences() : DEFAULT_PREFERENCES;
  const { country, international, seniority } = choices;
  const countryRegions = [country.toLowerCase(), ...(/brasil|brazil/i.test(country) ? ["brazil", "brasil"] : [])];
  const prefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    targetRoles: prefsAnswers.targetRoles,
    area: intake.area,
    seniority,
    country,
    timezone: choices.timezone,
    queries: built.queries,
    titleMustInclude: built.titleMustInclude.map((t) => t.toLowerCase()),
    titleExclude: [...new Set([...DEFAULT_PREFERENCES.titleExclude, ...built.titleExclude.map((t) => t.toLowerCase())])],
    acceptedRegions: international ? [...new Set([...countryRegions, ...DEFAULT_PREFERENCES.acceptedRegions])] : [...new Set(countryRegions)],
    onsiteCities,
    excludedCompanies: old.excludedCompanies,
    companyBoards: old.companyBoards,
    defaultSources: intake.isTech ? TECH_SOURCES : GENERAL_SOURCES,
    webSearchByDefault: !intake.isTech || !international,
    webSearchHints: `Priorize vagas de ${prefsAnswers.targetRoles.join(", ")} (${seniority}) — ${prefsAnswers.workModes}${onsiteCities.length ? ` (${onsiteCities.join(", ")})` : ""}. Mora em ${country}.${international ? " Aceita empresas de fora que contratam pessoas de " + country + "." : ""}`,
  };

  fs.writeFileSync(paths.profileTruth, built.profileTruth.trim() + "\n");
  fs.writeFileSync(paths.baseResume("pt-BR"), JSON.stringify(pt, null, 2) + "\n");
  fs.writeFileSync(paths.baseResume("en"), JSON.stringify(en, null, 2) + "\n");
  fs.writeFileSync(paths.preferences, JSON.stringify(prefs, null, 2) + "\n");
  fs.writeFileSync(paths.rules, JSON.stringify({ neverClaim: built.neverClaim }, null, 2) + "\n");
  if (!fs.existsSync(paths.excluded))
    fs.writeFileSync(paths.excluded, "# Empresas e vagas que você não quer\n\n<!-- Uma por linha, ex.: - Empresa X — motivo -->\n");

  console.log(`\n✅ Perfil salvo em ${paths.profileDir}${backup ? ` (backup do anterior em ${backup})` : ""}`);
  try {
    await renderBaseResumes((m) => console.log(`   ${m}`));
  } catch (e) {
    console.log(`   ⚠ Não gerei o PDF de conferência: ${(e as Error).message}`);
  }
  return { backup };
}

export async function runInit(opts: { inputs?: string[] } = {}) {
  console.log("\n🧭 Configurar perfil — funciona para qualquer área e qualquer vaga.\n");
  if (hasProfile() && !(await confirm({ message: "Já existe um perfil. Montar de novo? (o atual vai para um backup)", default: false }))) return;

  const provider = await chooseProvider();
  if (!provider) return;

  const sources = await collectSources(opts.inputs ?? []);
  saveSources(sources);

  console.log("\n🧠 Lendo suas fontes...");
  const intake = await readIntake(sources);
  console.log(`\nEntendi assim: ${intake.understood}\n`);

  const answers: { question: string; answer: string }[] = [];
  if (intake.questions.length) {
    console.log("Algumas perguntas para o currículo ficar completo e verdadeiro (Enter pula):\n");
    for (const [i, q] of intake.questions.entries()) {
      const answer = await input({ message: `(${i + 1}/${intake.questions.length}) ${q.question}` });
      answers.push({ question: q.question, answer });
    }
  }

  console.log("\n🎯 Que vagas você quer?");
  const roles = intake.suggestedTargetRoles.length
    ? await checkbox({
        message: "Cargos-alvo (ESPAÇO marca/desmarca, ENTER confirma)",
        choices: intake.suggestedTargetRoles.map((r) => ({ name: r, value: r, checked: true })),
      })
    : [];
  const extraRoles = split(await input({ message: "Outros cargos (separados por vírgula; Enter para pular):" }));
  const targetRoles = [...roles, ...extraRoles];
  const seniority = await input({ message: "Senioridade que você busca:", default: intake.seniority });
  const mode = await select<ProfileChoices["mode"]>({
    message: "Modalidade:",
    choices: [
      { name: "Só remoto", value: "remoto" },
      { name: "Remoto, ou híbrido/presencial na minha região", value: "remoto+regiao" },
      { name: "Qualquer modalidade, na minha região", value: "qualquer" },
    ],
  });
  const onsiteCities = mode === "remoto" ? [] : split(await input({ message: "Cidades onde aceita trabalhar presencial/híbrido (vírgula):" }));
  const country = await input({ message: "País onde você mora:", default: "Brasil" });
  const timezone = await input({ message: "Fuso horário:", default: /brasil|brazil/i.test(country) ? "UTC-3" : "" });
  const international = await confirm({ message: "Aceita vagas de empresas de fora do país (processo em inglês)?", default: false });

  await buildAndSaveProfile({
    sources,
    answers,
    intake,
    choices: { targetRoles, seniority, mode, onsiteCities, country, timezone, international },
  });
  console.log(`
Próximos passos:
  1. Abra profile/profile_truth.md e confira tudo — principalmente "A confirmar". Tudo o que o agente escreve sai dele.
  2. Confira o PDF do currículo-base em output/base/.
  3. Rode 'ajf' → "Piloto automático" para buscar vagas e gerar os pacotes.`);
}
