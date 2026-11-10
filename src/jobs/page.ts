import { htmlToText, tidyText } from "../util/text.js";

/**
 * Texto de uma vaga a partir da página dela, sem o resto do site (menu, rodapé, "vagas parecidas").
 *
 * 1. JobPosting em JSON-LD: o formato que os sites de vaga publicam para o Google (Gupy, Greenhouse,
 *    Lever, Workday, Wellfound, Indeed...). Traz a descrição limpa, a empresa, o local e o salário.
 * 2. Sem isso, o conteúdo principal da página (<main>, ou <article>), sem cabeçalho, menu, rodapé e formulários.
 */
/** Primeira linha da descrição das vagas da busca na web: o texto é um resumo escrito pela IA, não o da vaga. */
export const WEB_SUMMARY_HEADER = "[Resumo da busca web — confira a vaga completa no link]";
export const isWebSummary = (description: string) => description.startsWith("[Resumo da busca web");

export function jobPageText(html: string): string {
  return postingText(html) ?? gupyText(html) ?? linkedinText(html) ?? cleanJobText(htmlToText(mainContent(html)));
}

/*
 * Sobras da página no texto da vaga: o "conteúdo principal" de sites de vagas (LinkedIn, Indeed...)
 * traz também "Vagas semelhantes", "Pesquisas semelhantes" e botões. O mesmo vem quando a pessoa
 * copia a página inteira e cola. Nada disso é a vaga: atrapalha a triagem, o ATS e o pacote.
 */

/** Títulos de seção que começam o resto da página (o que vem depois não é a vaga). */
const PAGE_TAIL =
  /^(vagas? (semelhantes|similares|relacionadas|parecidas|recomendadas)|outras vagas|mais vagas\b.*|as pessoas também (visualizaram|viram|se candidataram)|pesquisas (semelhantes|relacionadas)|vagas que podem te interessar|similar (jobs|searches)|related (jobs|searches)|more jobs\b.*|other jobs\b.*|people also (viewed|applied)|jobs you (may|might) (like|be interested in)|you (may|might) also like|explore (more|related) jobs|empleos (similares|relacionados)|búsquedas (similares|relacionadas)|otras ofertas)$/i;

/** Linhas de interface do site, não da vaga (botões, contadores, convites para entrar). */
const PAGE_NOISE = [
  /^(salvar|save|compartilhar|share|candidatar-se|candidatura simplificada|easy apply|apply( now)?|inscreva-se|denunciar( esta vaga)?|report this job|reportar vaga)$/i,
  /^(mostrar|exibir|ver) (mais|menos)$/i,
  /^show (more|less)$/i,
  /^há (\d+|um|uma) (minutos?|horas?|dias?|semanas?|m[eê]s(es)?)$/i,
  /^(reposted |posted )?\d+ (minutes?|hours?|days?|weeks?|months?) ago$/i,
  /^(mais de |over )?[\d.,]+ (candidaturas?|candidatos?|applicants?|inscritos?)$/i,
  /^veja quem (a |o )?.{1,80} contratou para este cargo$/i,
  /^see who .{1,80} (has )?hired for this role$/i,
  /^as indicações dobram suas chances/i,
  /^referrals increase your chances/i,
  /^veja quem você conhece$/i,
  /^see who you know$/i,
  /^receba alertas de novas vagas/i,
  /^get notified about new/i,
  /^entre para criar um alerta/i,
  /^sign in to (create|set) job alert/i,
  // Menu, busca e tela de login do site (páginas de vaga abertas sem login).
  /^(linkedin|vagas|pessoas|learning|jobs|people|entrar|sign in|join now|cadastre-se( agora)?|limpar texto|clear text|expandir pesquisa|fechar|close|ou|or|configurar alerta|set alert|e-mail ou telefone|email or phone|senha|password|esqueceu a senha\??|forgot password\??|continuar com o google|continue with google|lembrar de mim|remember me)$/i,
  /^(pular|ir) para (o )?conteúdo principal$/i,
  /^skip to (main )?content$/i,
  /^este botão exibe o tipo de pesquisa/i,
  /^this button displays the currently selected search type/i,
  /^(cadastre-se|entre|faça login)( ou entre)? para /i,
  /^(sign in|sign up|join|log in)( or (sign in|join))? to /i,
  /^receba um alerta quando/i,
  /^get (an? )?(alert|e-?mail|notified) when/i,
  /^nunca usou o linkedin/i,
  /^new to linkedin/i,
  /^ao clicar em (continuar|entrar|cadastrar)/i,
  /^by clicking (continue|agree|sign in)/i,
  /\|\s*linkedin( jobs)?$/i,
  /^vagas de .{1,60}$/i,
  /^(exibir|view|entrar com (o )?e-?mail|sign in with e-?mail)$/i,
  // Ofertas do próprio site ("use a IA para avaliar seu perfil").
  /^use (a )?ia para avaliar/i,
  /^use ai to assess/i,
  /^receba aconselhamentos/i,
  /^(meu perfil é adequado para esta vaga\??|personalize meu currículo|am i a good fit( for this job)?\??|tailor my resume)$/i,
];

const RESEARCH_BLOCK = "\n\n---\n\n## Pesquisa na web";

/**
 * Texto da vaga sem as sobras da página: corta no começo de "Vagas semelhantes" e afins, tira as linhas
 * de interface e o cabeçalho repetido. Não mexe no bloco "Pesquisa na web". Pode rodar mais de uma vez.
 */
export function cleanJobText(text: string): string {
  const at = text.indexOf(RESEARCH_BLOCK);
  const [main, research] = at >= 0 ? [text.slice(0, at), text.slice(at)] : [text, ""];
  let lines = main.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const bare = (l: string) => l.replace(/^[-•*]\s*/, "");
  // 1. Corta no começo do resto da página (só depois do começo do texto, para não cortar tudo).
  const tail = lines.findIndex((l, i) => i >= 3 && bare(l).length <= 60 && PAGE_TAIL.test(bare(l)));
  if (tail >= 0) lines = lines.slice(0, tail);
  // 2. Linhas de interface.
  lines = lines.filter((l) => !PAGE_NOISE.some((re) => re.test(bare(l))));
  // 3. Cabeçalho repetido no topo ("Cargo / Empresa / Local" mais de uma vez): no começo da página,
  //    cada linha curta fica só na primeira vez.
  const seen = new Set<string>();
  let count = 0;
  lines = lines.filter((l) => {
    if (!l || count++ >= 20 || bare(l).length > 120) return true;
    const key = bare(l).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const clean = tidyText(lines.join("\n"));
  return research ? `${clean}${research}` : clean;
}

/**
 * Página de vaga do LinkedIn (visitante): a descrição fica num bloco próprio, separado das "vagas
 * semelhantes". Sem esse bloco, segue para o conteúdo principal (já limpo por `cleanJobText`).
 */
function linkedinText(html: string): string | null {
  const desc = html.match(/class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!desc) return null;
  const description = htmlToText(desc);
  if (description.length < 200) return null;
  const pick = (re: RegExp) => htmlToText(html.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const title = pick(/class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  const company = pick(/class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  const place = pick(/class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const criteria = [...html.matchAll(/class="[^"]*description__job-criteria-subheader[^"]*"[^>]*>([\s\S]*?)<\/h3>\s*<span[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((m) => `${htmlToText(m[1]).trim()}: ${htmlToText(m[2]).replace(/\s+/g, " ").trim()}`)
    .filter((l) => !l.startsWith(":"));
  const meta = [company && `Empresa: ${company}`, place && `Local: ${place}`, ...criteria].filter(Boolean).join("\n");
  return [title && `# ${title}`, meta, description].filter(Boolean).join("\n\n");
}

/** Dados que páginas feitas em Next.js mandam junto (`<script id="__NEXT_DATA__">`). */
export function nextData(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** A vaga da página de uma vaga da Gupy (`empresa.gupy.io/jobs/123`), se for uma. */
export function gupyJobData(html: string): Obj | null {
  const job = nextData(html)?.props?.pageProps?.job;
  return isObj(job) && str(job.name) ? job : null;
}

export const GUPY_WORKPLACE: Record<string, string> = { remote: "Remoto", hybrid: "Híbrido", "on-site": "Presencial" };
export const GUPY_JOB_TYPE: Record<string, string> = {
  vacancy_type_effective: "Efetivo (CLT)",
  vacancy_legal_entity: "PJ",
  vacancy_type_internship: "Estágio",
  vacancy_type_temporary: "Temporário",
  vacancy_type_apprentice: "Jovem aprendiz",
  vacancy_type_trainee: "Trainee",
  vacancy_type_talent_pool: "Banco de talentos (não é uma vaga aberta agora)",
};

/** Página de vaga da Gupy: não tem JSON-LD; a descrição, as responsabilidades e os requisitos vêm separados. */
function gupyText(html: string): string | null {
  const job = gupyJobData(html);
  if (!job) return null;
  const career = isObj(job.careerPage) ? str(job.careerPage.name) : "";
  const place = [str(job.addressCity), str(job.addressState), str(job.addressCountry)].filter(Boolean).join(", ");
  const meta = [
    ["Empresa", career],
    ["Local", [GUPY_WORKPLACE[str(job.workplaceType)] ?? "", place].filter(Boolean).join(" · ")],
    ["Tipo", GUPY_JOB_TYPE[str(job.jobType)] ?? ""],
    ["Inscrições até", str(job.registerEndDate).slice(0, 10)],
  ].filter(([, v]) => v);
  const sections = [
    ["Descrição", job.description],
    ["Responsabilidades e atribuições", job.responsibilities],
    ["Requisitos e qualificações", job.prerequisites],
    ["Informações adicionais", job.relevantExperiences],
  ]
    .map(([h, v]) => [h, htmlToText(str(v))])
    .filter(([, v]) => v)
    .map(([h, v]) => `## ${h}\n\n${v}`);
  if (!sections.length) return null;
  return [`# ${str(job.name)}`, meta.map(([k, v]) => `${k}: ${v}`).join("\n"), ...sections].filter(Boolean).join("\n\n");
}

/** O bloco JobPosting (JSON-LD) da página, se houver. */
export function jobPostingLd(html: string): Obj | null {
  return ldObjects(html).find((o) => list(o["@type"]).some((t) => str(t).toLowerCase() === "jobposting")) ?? null;
}

/** Texto visível do conteúdo principal da página (sem scripts, menu e rodapé). */
export function visibleText(html: string): string {
  return htmlToText(mainContent(html));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const nameOf = (v: unknown) => (isObj(v) ? str(v.name) : str(v));

/** Todos os objetos dos blocos JSON-LD da página (inclusive dentro de listas e de @graph). */
function ldObjects(html: string): Obj[] {
  const out: Obj[] = [];
  const visit = (v: unknown) => {
    for (const item of list(v)) {
      if (!isObj(item)) continue;
      out.push(item);
      if (item["@graph"]) visit(item["@graph"]);
    }
  };
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1].trim()));
    } catch {
      /* bloco inválido: ignora */
    }
  }
  return out;
}

function place(v: unknown): string {
  if (!isObj(v)) return str(v);
  const a = isObj(v.address) ? v.address : v;
  return [a.addressLocality, a.addressRegion, nameOf(a.addressCountry)].map((x) => (typeof x === "string" ? x.trim() : nameOf(x))).filter(Boolean).join(", ");
}

function salary(v: unknown): string {
  if (!isObj(v)) return str(v);
  const value = isObj(v.value) ? v.value : v;
  const amount = [str(value.minValue), str(value.maxValue)].filter(Boolean).join("–") || str(value.value);
  if (!amount) return "";
  const unit = { HOUR: "por hora", DAY: "por dia", WEEK: "por semana", MONTH: "por mês", YEAR: "por ano" }[str(value.unitText).toUpperCase()] ?? "";
  return [str(v.currency), amount, unit].filter(Boolean).join(" ");
}

function postingText(html: string): string | null {
  const p = ldObjects(html).find((o) => list(o["@type"]).some((t) => str(t).toLowerCase() === "jobposting"));
  if (!p) return null;
  const description = htmlToText(str(p.description));
  if (description.length < 200) return null;
  const remote = str(p.jobLocationType).toUpperCase() === "TELECOMMUTE";
  const locations = list(p.jobLocation).map(place).filter(Boolean);
  const countries = list(p.applicantLocationRequirements).map(nameOf).filter(Boolean);
  const months = isObj(p.experienceRequirements) ? str(p.experienceRequirements.monthsOfExperience) : "";
  const meta = [
    ["Empresa", nameOf(p.hiringOrganization)],
    ["Local", [remote ? "Remoto" : "", ...locations].filter(Boolean).join(" · ")],
    ["Aceita candidatos de", countries.length > 12 ? `${countries.slice(0, 12).join(", ")} e mais ${countries.length - 12}` : countries.join(", ")],
    ["Tipo", list(p.employmentType).map(str).filter((t) => t && t.toUpperCase() !== "OTHER").join(", ")],
    ["Salário", salary(p.baseSalary)],
    ["Experiência", months ? `${months} meses` : str(p.experienceRequirements)],
    ["Publicada em", str(p.datePosted).slice(0, 10)],
    ["Inscrições até", str(p.validThrough).slice(0, 10)],
  ].filter(([, v]) => v);
  const title = str(p.title);
  return [title && `# ${title}`, meta.map(([k, v]) => `${k}: ${v}`).join("\n"), description].filter(Boolean).join("\n\n");
}

/** O conteúdo principal da página, sem cabeçalho, menu, rodapé, barras laterais e formulários. */
function mainContent(html: string): string {
  const clean = html
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(header|nav|footer|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, " ");
  const pick = (tag: string) => clean.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`, "i"))?.[1];
  return pick("main") ?? pick("article") ?? pick("body") ?? clean;
}
