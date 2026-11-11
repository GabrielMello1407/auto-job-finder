import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../config.js";
import { cleanJobText } from "../jobs/page.js";
import { findJob, loadJobs, updateJob } from "../jobs/store.js";
import { canWebSearch, structured } from "../llm.js";
import { IMAGE_MAX_BYTES, imageMime, type ImageInput } from "../providers/images.js";
import { forbiddenPatterns, profileTruthEvidence } from "../profile.js";
import { profileSystem } from "../prompts.js";
import type { Job, JobAnalysis, JobAnswer } from "../schemas.js";
import { norm, truncate, withoutDashes } from "../util/text.js";

/**
 * Perguntas do formulário de candidatura ("Por que você quer trabalhar aqui?", "Fale de um projeto
 * de que se orgulha"). A IA responde com os fatos do perfil e o que a vaga diz da empresa; a pessoa
 * pede ajustes, que valem também como fatos contados por ela. As respostas ficam na vaga
 * (data/jobs.json) e em perguntas_e_respostas.md, na pasta do pacote.
 */

export const AnswerSchema = z.object({
  answer: z.string().describe("A resposta pronta para colar no formulário, em primeira pessoa"),
  needsYou: z
    .array(z.string())
    .describe("O que só a pessoa sabe e deixaria a resposta mais forte (motivação pessoal, opinião sobre o produto, pretensão salarial). Uma pergunta curta por item; vazio se nada"),
});

export const ANSWERS_FILE = "perguntas_e_respostas.md";
const MAX_HISTORY = 6;

/** Perfil e currículos-base: as mesmas fontes das travas do currículo (sem importar src/tailor, que importa este arquivo). */
function profileSources(): string {
  const base = (["pt-BR", "en"] as const).map((l) => (fs.existsSync(paths.baseResume(l)) ? fs.readFileSync(paths.baseResume(l), "utf8") : ""));
  return [profileTruthEvidence(), ...base].join("\n\n");
}

function jobBlock(job: Job): string {
  const head = [`Cargo: ${job.title}`, `Empresa: ${job.company}`, job.location ? `Local: ${job.location}` : ""].filter(Boolean);
  return `${head.join("\n")}\n\n${truncate(cleanJobText(job.description), 12000)}`;
}

/** Currículo enviado para esta vaga (resume.json do pacote), se houver. */
function tailoredResume(job: Job): string | null {
  const file = job.outputDir && path.join(job.outputDir, "resume.json");
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

/** Análise da vaga feita no pacote (analysis.json): o que a empresa valoriza, obrigatórios, diferenciais. */
function packageAnalysis(job: Job): Partial<JobAnalysis> | null {
  const file = job.outputDir && path.join(job.outputDir, "analysis.json");
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).analysis ?? null;
  } catch {
    return null;
  }
}

const list = (items: string[] | undefined, max = 12) => (items?.length ? items.slice(0, max).join("; ") : "");

/**
 * O foco da resposta: o que a vaga pede e a empresa valoriza (análise do pacote), o que a triagem ligou
 * ao perfil e as lacunas, e a missão e os valores da página oficial (pesquisa na web, com a fonte).
 */
export function jobFocus(job: Job): string {
  const a = packageAnalysis(job);
  const tri = job.triage;
  const culture = job.research?.culture ?? [];
  const lines = [
    a?.companyContext ? `O que a empresa faz e valoriza, segundo a vaga: ${a.companyContext}` : "",
    list(a?.mustHave) ? `Requisitos obrigatórios: ${list(a?.mustHave)}` : "",
    list(a?.niceToHave) ? `Diferenciais: ${list(a?.niceToHave)}` : "",
    list(a?.responsibilities) ? `Responsabilidades: ${list(a?.responsibilities)}` : "",
    list(tri?.evidence) ? `Provas do perfil que a triagem ligou à vaga: ${list(tri?.evidence)}` : "",
    list(tri?.mustHaveGaps) ? `Obrigatórios sem evidência no perfil (lacunas: a pessoa não tem, não afirme): ${list(tri?.mustHaveGaps)}` : "",
    culture.length ? `Missão, valores e cultura, da página oficial da empresa:\n${culture.map((c) => `- ${c.text} (fonte: ${c.source})`).join("\n")}` : "",
  ].filter(Boolean);
  return truncate(lines.join("\n"), 5000);
}

/**
 * Pergunta sobre a empresa (por que ela, cultura, valores, missão, o produto "de vocês")? Pistas em
 * português, inglês e espanhol, ou o nome da empresa na pergunta. Sem IA.
 */
/** Sempre sobre a empresa que contrata: cultura, valores, missão, "o nosso produto". */
const ABOUT_COMPANY = [
  /\b(cultura|culture|valores|values|missao|mission|mision|proposito|purpose|visao|vision)\b/,
  /\b(nosso|nossa|nossos|nossas|our|ours|nuestro|nuestra|nuestros|nuestras)\b/,
];
/** Sobre a empresa, a não ser que a pergunta seja sobre sair do emprego atual ("por que quer sair da empresa?"). */
const WHY_HERE = [
  /\b(empresa|companhia|organizacao|company|organi[sz]ation|compania)\b(?! (atual|anterior|passada|current|previous|last|actual))/,
  /\btrabalhar (aqui|conosco|com a gente|com voces|na |no |nessa|nesta|nesse|neste|em nossa|em nosso)/,
  /\b(work|working) (here|with us|for us|at |for )/,
  /\bjoin(ing)? (us|our|the team|this team)\b/,
  /\bfazer parte (do|da|de nosso|de nossa|desse|dessa|deste|desta)\b/,
  /\bwhy (do|would) you want\b/,
  /\bpor ?que (voce |vc )?(quer|gostaria|deseja|escolheu)\b/,
  /\bpor que (nos|a gente)\b|\bwhy us\b/,
  /\bpor que (quieres?|te gustaria)\b|\bpor que nosotros\b|\btrabajar (aqui|con nosotros|en )/,
];
const LEAVING = /\b(sair|deixar|leave|leaving|salir|dejar)\b/;
const GENERIC_NAME = new Set(["empresa", "company", "grupo", "group", "brasil", "brazil", "tecnologia", "technology", "digital", "solucoes", "solutions", "servicos", "services", "exemplo", "example", "ltda"]);

export function isCompanyQuestion(question: string, company = ""): boolean {
  const q = ` ${norm(question).replace(/[^a-z0-9]+/g, " ")} `;
  if (ABOUT_COMPANY.some((re) => re.test(q))) return true;
  if (!LEAVING.test(q) && WHY_HERE.some((re) => re.test(q))) return true;
  const words = norm(company)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !GENERIC_NAME.has(w));
  return words.some((w) => q.includes(` ${w} `));
}

/**
 * Vale sugerir a pesquisa na web antes de responder: a pergunta é sobre a empresa, a IA pesquisa na
 * web e a vaga ainda não tem a missão e os valores da página oficial pesquisados (nunca pesquisada,
 * ou pesquisada antes de a pesquisa guardar isso). Pesquisada sem achar nada: não sugere de novo.
 */
export function shouldSuggestResearch(job: Job, question: string, webSearch = canWebSearch()): boolean {
  return webSearch && isCompanyQuestion(question, job.company) && job.research?.culture === undefined;
}

/* ----------------------------------------- pergunta lida de um print ----------------------------------------- */

const ImageQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("A pergunta exatamente como está escrita na imagem, completa, sem o texto de ajuda do campo"),
        limit: z.number().describe("Limite de caracteres que a imagem mostra para essa pergunta (ex.: 'máximo 500 caracteres'); 0 se não mostra"),
      }),
    )
    .describe("Perguntas do formulário que pedem uma resposta escrita pela pessoa, na ordem em que aparecem; vazio se não há nenhuma"),
  unreadable: z.string().describe("O que apareceu cortado ou ilegível na imagem; vazio se deu para ler tudo"),
});
export interface ImageQuestion {
  question: string;
  limit?: number;
}

/**
 * Lê as perguntas de um print do formulário de candidatura (só transcreve: nada do perfil vai junto).
 * A pessoa confere o texto lido antes de responder.
 */
export async function readQuestionsFromImage(image: ImageInput): Promise<{ questions: ImageQuestion[]; unreadable: string }> {
  if (fs.statSync(image.path).size > IMAGE_MAX_BYTES) throw new Error("Imagem grande demais (máximo 5 MB). Recorte o print só na pergunta.");
  const r = await structured(ImageQuestionsSchema, {
    label: "read:question-image",
    effort: "low",
    system: [
      "Você lê prints de formulários de candidatura a vagas de emprego e transcreve as perguntas. Copie o texto como está na imagem, no idioma dela, sem traduzir, corrigir ou completar. Não invente pergunta que não está na imagem.",
    ],
    user: "Liste as perguntas deste formulário que pedem uma resposta escrita pela pessoa (abertas ou curtas), com o limite de caracteres quando a imagem mostrar. Não inclua campos de dados pessoais (nome, e-mail, telefone, endereço, LinkedIn, CPF), botões nem menus.",
    images: [image],
  });
  return { questions: cleanImageQuestions(r.questions), unreadable: r.unreadable.trim() };
}

/** Perguntas lidas da imagem: sem espaços sobrando, sem repetidas, limite 0 = sem limite, no máximo 10. */
export function cleanImageQuestions(raw: { question: string; limit: number }[]): ImageQuestion[] {
  const seen = new Set<string>();
  return raw
    .map((q) => ({ question: q.question.replace(/\s+/g, " ").trim(), limit: q.limit > 0 ? Math.min(20000, Math.round(q.limit)) : undefined }))
    .filter((q) => q.question.length >= 5 && !seen.has(norm(q.question)) && Boolean(seen.add(norm(q.question))))
    .slice(0, 10);
}

/** Caminho de imagem digitado ou arrastado no terminal ("C:\print.png", 'print.png', & 'print.png'), se existir. */
export function imageFile(typed: string): string | null {
  const p = typed
    .trim()
    .replace(/^&\s+/, "")
    .replace(/^(['"])(.*)\1$/, "$2");
  return /\.(png|jpe?g|webp|gif)$/i.test(p) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
}

/** Imagem de um arquivo, conferindo o tipo pelos primeiros bytes. */
export function imageFromFile(file: string): ImageInput {
  const mime = imageMime(fs.readFileSync(file).subarray(0, 16));
  if (!mime) throw new Error(`${path.basename(file)} não é uma imagem PNG, JPG, WEBP ou GIF.`);
  return { path: file, mime };
}

const NUM_RE = /\d+(?:[.,]\d+)*/g;
const nums = (t: string) => new Set((t.match(NUM_RE) ?? []).map((n) => n.replace(/[.,]/g, "")));

/** Travas do texto: número sem fonte (perfil, vaga ou o que a pessoa contou) e frases de "nunca afirmar". */
export function answerViolations(answer: string, sources: string): string[] {
  const known = nums(sources);
  const orphan = [...nums(answer)].filter((n) => !known.has(n));
  return [
    ...(orphan.length ? [`números sem fonte: ${orphan.join(", ")}`] : []),
    ...forbiddenPatterns()
      .filter((f) => f.re.test(answer))
      .map((f) => f.msg),
  ];
}

interface Draft {
  question: string;
  limit?: number;
  context?: string;
  /** Ajustes pedidos antes, que continuam valendo. */
  adjustments?: string[];
  /** Ajuste pedido agora sobre a resposta anterior. */
  refine?: { previous: string; instruction: string };
}

const block = (tag: string, body: string | null | undefined) => (body?.trim() ? `\n<${tag}>\n${body.trim()}\n</${tag}>\n` : "");

async function write(job: Job, d: Draft): Promise<{ answer: string; needsYou: string[]; warnings: string[] }> {
  const resume = tailoredResume(job);
  const others = (job.answers ?? []).filter((a) => a.question !== d.question).slice(-MAX_HISTORY);
  // O que a pessoa escreve nos ajustes também é fato contado por ela (ex.: "uso o app há um ano").
  const told = [d.context ?? "", ...(d.adjustments ?? []), d.refine?.instruction ?? ""].filter((t) => t.trim());
  const focus = jobFocus(job);
  const sources = [profileSources(), job.description, focus, d.question, ...told, resume ?? ""].join("\n");

  const prompt = `${block("vaga", jobBlock(job))}${block("analise_da_vaga", focus)}${block("curriculo_enviado_para_esta_vaga", resume)}${block("o_que_a_pessoa_contou", d.context)}${block(
    "ajustes_pedidos_antes",
    d.adjustments?.map((a) => `- ${a}`).join("\n"),
  )}${block("respostas_ja_dadas_nesta_candidatura", others.map((a) => `P: ${a.question}\nR: ${a.answer}`).join("\n\n"))}
Pergunta do formulário de candidatura: "${d.question}"
${d.limit ? `Limite: ${d.limit} caracteres, contando espaços. Conte e fique abaixo.` : "Sem limite informado: 80 a 180 palavras."}
${
  d.refine
    ? `\nResposta anterior:\n"""\n${d.refine.previous}\n"""\nAjuste pedido pela pessoa agora: ${d.refine.instruction}\nFaça o ajuste e mantenha o resto. Os <ajustes_pedidos_antes> continuam valendo.\n`
    : ""
}
Escreva a resposta que a pessoa vai colar no formulário:
- Primeira pessoa, no idioma da pergunta, tom humano e direto. Sem clichês ("sou apaixonado por", "proativo", "vestir a camisa") e sem bajular a empresa.
- Sobre a pessoa, só fatos das fontes (profile_truth, currículos-base, currículo enviado) e do que ela contou: <o_que_a_pessoa_contou> e os ajustes, que podem trazer fatos como "uso o app há um ano". Ligue a pergunta a 1 ou 2 provas concretas que combinam com a vaga.
- Use a <analise_da_vaga> para escolher essas provas: prefira as que atendem um requisito obrigatório ou o que a empresa valoriza. O que está nas lacunas a pessoa não tem: não afirme nem insinue.
- Sobre a empresa, só o que está na <vaga> e na <analise_da_vaga> (inclusive a pesquisa na web e a missão e os valores da página oficial, se houver). Se citar um valor ou a missão da empresa, use as palavras da página e ligue a uma prova concreta da pessoa, sem bajular. Não invente produto, valores, notícias, clientes ou números da empresa.
- Coerente com <respostas_ja_dadas_nesta_candidatura>, sem repetir as mesmas provas se der para variar.
- Se a pergunta pede algo que só a pessoa sabe (motivação pessoal, opinião sobre o produto ou o app, pretensão salarial, disponibilidade, por que quer sair do emprego), escreva a melhor resposta verdadeira possível com as fontes, sem inventar sentimentos ou experiências, e diga em needsYou o que ela precisa contar. Nunca invente valor de salário, documento ou endereço.`;

  const ask = (extra = "") => structured(AnswerSchema, { label: "write:answer", effort: "medium", system: profileSystem(), user: prompt + extra });
  let r = await ask();
  const problems = () => [
    ...answerViolations(r.answer, sources),
    ...(d.limit && r.answer.trim().length > d.limit ? [`a resposta tem ${r.answer.trim().length} caracteres e o limite é ${d.limit}`] : []),
  ];
  let issues = problems();
  if (issues.length) {
    // Uma rodada de correção, como no loop do currículo.
    r = await ask(`\n\nA versão anterior foi barrada pelas travas: ${issues.join("; ")}. Corrija: tire o que não tem fonte e respeite o limite.`);
    issues = problems();
  }
  // Sem travessão como pontuação: soa como texto de IA no formulário.
  return { answer: withoutDashes(r.answer.trim()), needsYou: r.needsYou, warnings: issues };
}

/** Responde uma pergunta nova do formulário e salva na vaga. */
export async function answerQuestion(id: string, opts: { question: string; limit?: number; context?: string }): Promise<JobAnswer> {
  const job = findJob(loadJobs(), id);
  const r = await write(job, opts);
  const now = new Date().toISOString();
  const item: JobAnswer = {
    id: crypto.randomUUID().slice(0, 8),
    question: opts.question.trim(),
    answer: r.answer,
    limit: opts.limit,
    context: opts.context?.trim() || undefined,
    needsYou: r.needsYou,
    warnings: r.warnings,
    createdAt: now,
    updatedAt: now,
  };
  // Salva sobre a versão atual da vaga: ela pode ter mudado enquanto a IA escrevia.
  saveAnswers(job.id, [...(findJob(loadJobs(), job.id).answers ?? []), item]);
  return item;
}

/** Ajusta uma resposta ("mais curto", "cite o projeto X", "em inglês", ou o que a IA pediu para contar). */
export async function refineAnswer(id: string, answerId: string, opts: { instruction: string }): Promise<JobAnswer> {
  const job = findJob(loadJobs(), id);
  const current = (job.answers ?? []).find((a) => a.id === answerId);
  if (!current) throw new Error("Essa resposta não existe mais.");
  const instruction = opts.instruction.trim();
  const r = await write(job, {
    question: current.question,
    limit: current.limit,
    context: current.context,
    adjustments: current.adjustments,
    refine: { previous: current.answer, instruction },
  });
  const item: JobAnswer = {
    ...current,
    answer: r.answer,
    needsYou: r.needsYou,
    warnings: r.warnings,
    adjustments: [...(current.adjustments ?? []), instruction],
    updatedAt: new Date().toISOString(),
  };
  saveAnswers(job.id, (findJob(loadJobs(), job.id).answers ?? []).map((a) => (a.id === answerId ? item : a)));
  return item;
}

export function deleteAnswer(id: string, answerId: string) {
  const job = findJob(loadJobs(), id);
  saveAnswers(job.id, (job.answers ?? []).filter((a) => a.id !== answerId));
}

function saveAnswers(id: string, answers: JobAnswer[]) {
  writeAnswersFile(updateJob(id, { answers }));
}

export function answersMarkdown(job: Job): string {
  const items = (job.answers ?? []).map((a) => {
    const count = `_${a.answer.length} caracteres${a.limit ? ` (limite ${a.limit})` : ""}_`;
    const needs = a.needsYou.length ? `\n\nPara ficar com a sua cara, conte:\n${a.needsYou.map((n) => `- ${n}`).join("\n")}` : "";
    const warn = a.warnings?.length ? `\n\n⚠ Confira: ${a.warnings.join("; ")}` : "";
    return `## ${a.question}\n\n${a.answer}\n\n${count}${needs}${warn}\n`;
  });
  return `# Perguntas da candidatura — ${job.company}\n\n${job.title}\n\n> Respostas preparadas pelo agente com o seu perfil e a vaga. Revise antes de colar no formulário.\n\n${items.join("\n")}`;
}

/** Grava (ou apaga, se não houver respostas) o perguntas_e_respostas.md na pasta da vaga, quando ela existe. */
export function writeAnswersFile(job: Job) {
  if (!job.outputDir || !fs.existsSync(job.outputDir)) return;
  const file = path.join(job.outputDir, ANSWERS_FILE);
  if (job.answers?.length) fs.writeFileSync(file, answersMarkdown(job));
  else fs.rmSync(file, { force: true });
}
