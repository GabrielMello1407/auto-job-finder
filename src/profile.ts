import fs from "node:fs";
import { hasProfile, paths } from "./config.js";
import { ResumeSchema, type Resume } from "./schemas.js";

export interface Preferences {
  /** Cargos que a pessoa procura (ex.: "Analista de Marketing Digital", "Full Stack Developer"). */
  targetRoles: string[];
  /** Área de atuação (ex.: "tecnologia", "marketing", "finanças", "saúde"). Define as fontes padrão. */
  area: string;
  /** Senioridade buscada (ex.: "júnior", "pleno", "sênior"). */
  seniority: string;
  /** País onde a pessoa mora (define mercado "local", contratação e fuso). */
  country: string;
  /** Fuso horário (ex.: "UTC-3"), citado em vagas remotas internacionais. */
  timezone: string;
  /** Termos usados nas buscas das APIs (um por busca). */
  queries: string[];
  /** Palavras que o título PRECISA conter (pelo menos uma). Lista vazia = aceita qualquer título. */
  titleMustInclude: string[];
  /** Palavras que eliminam a vaga pelo título. */
  titleExclude: string[];
  /** Locais aceitos para vagas remotas com restrição geográfica. */
  acceptedRegions: string[];
  /** Aceita vagas presenciais/híbridas nestas cidades. */
  onsiteCities: string[];
  /** Empresas que a pessoa não quer (também lidas de excluded.md). */
  excludedCompanies: string[];
  /** Empresas com páginas Greenhouse/Lever/Ashby para monitorar. */
  companyBoards: { greenhouse: string[]; lever: string[]; ashby: string[] };
  /** Fontes ligadas por padrão no `search`. */
  defaultSources: string[];
  /** Liga a busca na web via IA (LinkedIn, Gupy, Indeed...) por padrão no piloto automático. */
  webSearchByDefault: boolean;
  /** Vagas mais antigas que isso (dias) são ignoradas. */
  maxAgeDays: number;
  /** Instruções extras para a busca via IA (web search). */
  webSearchHints: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  targetRoles: [],
  area: "",
  seniority: "",
  country: "Brasil",
  timezone: "UTC-3",
  queries: [],
  titleMustInclude: [],
  titleExclude: ["estagio", "estagiario", "intern", "trainee"],
  acceptedRegions: ["brazil", "brasil", "latam", "latin america", "south america", "americas", "worldwide", "anywhere", "global"],
  onsiteCities: [],
  excludedCompanies: [],
  companyBoards: { greenhouse: [], lever: [], ashby: [] },
  defaultSources: ["remotive", "himalayas", "jobicy", "arbeitnow"],
  webSearchByDefault: true,
  maxAgeDays: 30,
  webSearchHints: "",
};

function requireProfile() {
  if (!hasProfile())
    throw new Error("Perfil ainda não configurado. Rode 'ajf init' (ou abra 'ajf' e escolha 'Configurar meu perfil').");
}

export function loadPreferences(): Preferences {
  const raw = fs.existsSync(paths.preferences) ? JSON.parse(fs.readFileSync(paths.preferences, "utf8")) : {};
  return { ...DEFAULT_PREFERENCES, ...raw, companyBoards: { ...DEFAULT_PREFERENCES.companyBoards, ...raw.companyBoards } };
}

export function loadProfileTruth(): string {
  requireProfile();
  return fs.readFileSync(paths.profileTruth, "utf8");
}

/** Títulos de seção que NÃO são evidência (lacunas, regras, pendências). Mantenha esses nomes ao editar. */
export const NON_EVIDENCE_HEADING = /^## .*(lacuna|regras de comunica|a confirmar|nunca)/im;

/**
 * Só as seções que são EVIDÊNCIA. Lacunas, regras de comunicação e itens a confirmar mencionam
 * coisas que a pessoa NÃO tem — não podem contar como prova nas travas e no relatório ATS.
 */
export function profileTruthEvidence(): string {
  return loadProfileTruth()
    .split(/^(?=## )/m)
    .filter((section) => !NON_EVIDENCE_HEADING.test(section.split("\n")[0]))
    .join("");
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Currículo em português com o cargo repetido em inglês ("Analista Desenvolvedor (Developer Analyst)"):
 * tira o trecho entre parênteses quando ele é o cargo do currículo em inglês na mesma empresa. A tradução
 * fica só no currículo em inglês. Sem IA: vale mesmo se o modelo acrescentar a tradução de novo.
 */
export function withoutTranslatedTitles(resume: Resume, english: Resume | null): Resume {
  if (resume.language !== "pt-BR" || !english) return resume;
  const noParens = (s: string) => plain(s.replace(/\([^()]*\)/g, ""));
  const words = (s: string) => new Set(plain(s.replace(/&/g, " ")).split(" ").filter((w) => w.length > 1 && w !== "and"));
  const experience = resume.experience.map((e, i) => {
    const m = e.title.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    if (!m) return e;
    // A mesma posição no currículo em inglês: mesma empresa (o nome também pode estar traduzido entre
    // parênteses, "SaaS próprio" × "own SaaS") ou, na mesma ordem, a mesma data de início.
    const en =
      english.experience.find((x) => plain(x.company) === plain(e.company)) ??
      english.experience.find((x) => noParens(x.company) === noParens(e.company)) ??
      (english.experience[i]?.start && english.experience[i].start === e.start ? english.experience[i] : undefined);
    if (!en) return e;
    // O trecho entre parênteses é o cargo em inglês: pelo menos 2 palavras, todas no cargo do currículo em
    // inglês ("Founder & Lead Engineer" × "Founder and Lead Software Engineer"). "(Sênior)", "(PJ)" ficam.
    const inner = words(m[2]);
    const enWords = words(en.title);
    return inner.size >= 2 && [...inner].every((w) => enWords.has(w)) ? { ...e, title: m[1].trim() } : e;
  });
  return { ...resume, experience };
}

/** O currículo-base em inglês, se existir (para comparar cargos). */
export function englishBase(): Resume | null {
  try {
    return loadBaseResume("en");
  } catch {
    return null;
  }
}

export function loadBaseResume(lang: "pt-BR" | "en"): Resume {
  requireProfile();
  const raw = JSON.parse(fs.readFileSync(paths.baseResume(lang), "utf8"));
  return ResumeSchema.parse(raw);
}

/** Nome do candidato (do currículo-base). */
export function candidateName(): string {
  try {
    return loadBaseResume("pt-BR").name;
  } catch {
    return "o candidato";
  }
}

export function loadExcluded(): string {
  return fs.existsSync(paths.excluded) ? fs.readFileSync(paths.excluded, "utf8") : "";
}

/* ------------------------------------------------------------------ */
/* Regras "nunca afirmar" (profile/rules.json)                         */
/* ------------------------------------------------------------------ */

export interface NeverClaimRule {
  /** Frase literal (sem diferenciar maiúsculas). */
  phrase?: string;
  /** Ou uma expressão regular (sem barras), para casos com exceções. */
  regex?: string;
  /** Mensagem mostrada quando o texto gerado afirma isso. */
  message: string;
}

export interface Rules {
  neverClaim: NeverClaimRule[];
}

export function loadRules(): Rules {
  if (!fs.existsSync(paths.rules)) return { neverClaim: [] };
  const raw = JSON.parse(fs.readFileSync(paths.rules, "utf8")) as Partial<Rules>;
  return { neverClaim: raw.neverClaim ?? [] };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

export function forbiddenPatterns(rules = loadRules()): { re: RegExp; msg: string }[] {
  const out: { re: RegExp; msg: string }[] = [];
  for (const r of rules.neverClaim) {
    try {
      if (r.regex) out.push({ re: new RegExp(r.regex, "i"), msg: r.message });
      else if (r.phrase?.trim()) out.push({ re: new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(r.phrase.trim())}($|[^\\p{L}\\p{N}])`, "iu"), msg: r.message });
    } catch {
      /* regex inválida em rules.json: ignora essa regra */
    }
  }
  return out;
}

/** Bloco de contexto estável (vai para o cache do prompt). */
export function profileContext(): string {
  requireProfile();
  const pt = fs.readFileSync(paths.baseResume("pt-BR"), "utf8");
  const en = fs.readFileSync(paths.baseResume("en"), "utf8");
  const rules = loadRules().neverClaim.map((r) => `- ${r.message}`).join("\n");
  return [
    "<profile_truth>",
    loadProfileTruth(),
    "</profile_truth>",
    "",
    '<base_resume lang="pt-BR">',
    pt,
    "</base_resume>",
    "",
    '<base_resume lang="en">',
    en,
    "</base_resume>",
    ...(rules ? ["", "<never_claim>", rules, "</never_claim>"] : []),
  ].join("\n");
}
