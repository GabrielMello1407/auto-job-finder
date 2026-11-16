import fs from "node:fs";
import { hasProfile, paths } from "./config.js";
import { ResumeSchema, type Resume } from "./schemas.js";
import { withoutDashes } from "./util/text.js";

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
  /**
   * De onde a pessoa pode trabalhar: o país dela e regiões que o incluem (latam, americas, worldwide). Vaga
   * remota restrita a um lugar fora desta lista é descartada no filtro. Não é "de onde pode ser a empresa".
   */
  acceptedRegions: string[];
  /** Aceita vagas presenciais/híbridas nestas cidades. */
  onsiteCities: string[];
  /**
   * Aceita se mudar para outro país se a empresa patrocinar o visto e a mudança. Com isso, vagas presenciais ou
   * híbridas no exterior passam pelo filtro e a triagem confere o patrocínio (src/jobs/abroad.ts).
   */
  relocateAbroad: boolean;
  /** Países para onde aceita se mudar (vazio = qualquer um). Só vale com relocateAbroad. */
  relocationCountries: string[];
  /** Busca automática (src/routine.ts): ao abrir o app e/ou todo dia num horário, pelo agendador do sistema. */
  autoSearch: AutoSearch;
  /** Empresas que a pessoa segue (src/jobs/follow.ts): sobem na lista e entram na busca na web. */
  followedCompanies: FollowedCompany[];
  /** Fonte Google for Jobs (src/jobs/sources/googlejobs.ts): quantos termos de busca por rodada (cada um gasta uma busca da cota). A chave fica no .env (SERPAPI_KEY). */
  googleJobs: { maxQueries: number };
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
  /**
   * Respostas que os formulários sempre pedem e que não são fatos da carreira (pretensão, disponibilidade...).
   * Entram na ficha, nas respostas do formulário e na triagem (critérios eliminatórios). Vazio = não informado.
   */
  applicationFacts: ApplicationFacts;
  /** Modo candidatura (src/jobs/applyQueue.ts): a fila guiada dos pacotes prontos. */
  applyMode: { referralStep: boolean };
  /** Resultados (src/jobs/funnel.ts): comparar as versões do currículo (src/jobs/resumeStats.ts). */
  results: { compareResumes: boolean };
  /** Preencher formulários com o favorito do navegador (src/autofill/): ligado e quais grupos de campos. */
  autofill: AutofillPrefs;
}

export interface AutofillPrefs {
  enabled: boolean;
  /** Nome, e-mail e telefone. */
  contact: boolean;
  /** LinkedIn, GitHub e site. */
  links: boolean;
  /** Cidade. */
  location: boolean;
  /** Empresa e cargo atuais. */
  current: boolean;
  /** A mensagem curta do pacote, no campo de mensagem ou carta. */
  message: boolean;
  /** As respostas fixas (pretensão, disponibilidade, aviso prévio, mudança, visto). */
  facts: boolean;
}

export interface AutoSearch {
  /** Busca sozinha quando o app abre, se a última busca automática tiver mais de `onOpenHours`. */
  onOpen: boolean;
  onOpenHours: number;
  /** Busca todo dia no horário `time` (HH:MM), pelo agendador do sistema (Windows, macOS ou Linux). */
  daily: boolean;
  time: string;
  /** Inclui a busca na web com IA (mais vagas, mas mais lenta e cara). */
  web: boolean;
  /** Avalia as vagas novas com a IA logo depois da busca. */
  triage: boolean;
}

export interface FollowedCompany {
  name: string;
  /** Página de carreira achada no link de uma vaga (passa a ser monitorada). */
  board?: { type: "greenhouse" | "lever" | "ashby"; id: string };
}

export interface ApplicationFacts {
  salaryExpectation: string;
  availability: string;
  noticePeriod: string;
  relocation: string;
  workAuthorization: string;
}

/** Nome de cada resposta fixa (português e inglês), na ordem em que aparece. */
export const APPLICATION_FACT_LABELS: Record<keyof ApplicationFacts, [string, string]> = {
  salaryExpectation: ["Pretensão salarial", "Salary expectation"],
  availability: ["Disponibilidade para começar", "Availability to start"],
  noticePeriod: ["Aviso prévio", "Notice period"],
  relocation: ["Mudança de cidade", "Relocation"],
  workAuthorization: ["Autorização de trabalho / visto", "Work authorization / visa"],
};

/** As respostas fixas preenchidas, como "Nome: valor" (uma por linha). Vazio se nenhuma. */
export function applicationFactsText(facts: ApplicationFacts, lang: "pt-BR" | "en" = "pt-BR"): string {
  return (Object.keys(APPLICATION_FACT_LABELS) as (keyof ApplicationFacts)[])
    .filter((k) => facts[k]?.trim())
    .map((k) => `${APPLICATION_FACT_LABELS[k][lang === "en" ? 1 : 0]}: ${facts[k].trim()}`)
    .join("\n");
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
  relocateAbroad: false,
  relocationCountries: [],
  autoSearch: { onOpen: false, onOpenHours: 12, daily: false, time: "08:00", web: false, triage: true },
  followedCompanies: [],
  googleJobs: { maxQueries: 3 },
  excludedCompanies: [],
  companyBoards: { greenhouse: [], lever: [], ashby: [] },
  defaultSources: ["remotive", "himalayas", "jobicy", "arbeitnow"],
  webSearchByDefault: true,
  maxAgeDays: 30,
  webSearchHints: "",
  applicationFacts: { salaryExpectation: "", availability: "", noticePeriod: "", relocation: "", workAuthorization: "" },
  applyMode: { referralStep: true },
  results: { compareResumes: true },
  autofill: { enabled: false, contact: true, links: true, location: true, current: true, message: true, facts: false },
};

function requireProfile() {
  if (!hasProfile())
    throw new Error("Perfil ainda não configurado. Rode 'ajf init' (ou abra 'ajf' e escolha 'Configurar meu perfil').");
}

export function loadPreferences(): Preferences {
  const raw = fs.existsSync(paths.preferences) ? JSON.parse(fs.readFileSync(paths.preferences, "utf8")) : {};
  return {
    ...DEFAULT_PREFERENCES,
    ...raw,
    companyBoards: { ...DEFAULT_PREFERENCES.companyBoards, ...raw.companyBoards },
    applicationFacts: { ...DEFAULT_PREFERENCES.applicationFacts, ...raw.applicationFacts },
    autoSearch: { ...DEFAULT_PREFERENCES.autoSearch, ...raw.autoSearch },
    followedCompanies: Array.isArray(raw.followedCompanies) ? raw.followedCompanies : [],
    googleJobs: { ...DEFAULT_PREFERENCES.googleJobs, ...raw.googleJobs },
    applyMode: { ...DEFAULT_PREFERENCES.applyMode, ...raw.applyMode },
    results: { ...DEFAULT_PREFERENCES.results, ...raw.results },
    autofill: { ...DEFAULT_PREFERENCES.autofill, ...raw.autofill },
  };
}

/** Grava as preferências (a interface, o terminal e o cadastro usam o mesmo arquivo). */
export function savePreferences(prefs: Preferences): void {
  fs.writeFileSync(paths.preferences, JSON.stringify(prefs, null, 2) + "\n");
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

/**
 * Currículo sem travessão como pontuação (soa como texto de IA): títulos ganham parênteses, textos
 * ganham vírgula (`util/text.ts#withoutDashes`). Datas e links não mudam. Sem IA; pode rodar de novo.
 */
export function withoutDashesResume(r: Resume): Resume {
  const t = (s: string) => withoutDashes(s, "text");
  const h = (s: string) => withoutDashes(s, "title");
  return {
    ...r,
    headline: withoutDashes(r.headline, "headline"),
    contact: { ...r.contact, location: t(r.contact.location), availability: t(r.contact.availability) },
    summary: t(r.summary),
    skills: r.skills.map((s) => ({ category: h(s.category), items: s.items.map(t) })),
    experience: r.experience.map((e) => ({ ...e, title: h(e.title), company: h(e.company), location: t(e.location), mode: t(e.mode), start: t(e.start), end: t(e.end), bullets: e.bullets.map(t) })),
    projects: r.projects.map((p) => ({ ...p, name: h(p.name), description: t(p.description), tech: p.tech.map(t) })),
    education: r.education.map((e) => ({ ...e, degree: h(e.degree), institution: h(e.institution), period: t(e.period) })),
    certifications: r.certifications.map((c) => ({ ...c, name: h(c.name), issuer: t(c.issuer), date: t(c.date) })),
    languages: t(r.languages),
  };
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
  // Sem travessão: a IA parte de um currículo sem ele, e as travas comparam com a mesma forma.
  return withoutDashesResume(ResumeSchema.parse(raw));
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
