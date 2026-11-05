import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../config.js";
import { findJob, loadJobs, updateJob } from "../jobs/store.js";
import { structured } from "../llm.js";
import { forbiddenPatterns, profileTruthEvidence } from "../profile.js";
import { profileSystem } from "../prompts.js";
import type { Job, JobAnswer } from "../schemas.js";
import { tidyText, truncate } from "../util/text.js";

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
  return `${head.join("\n")}\n\n${truncate(tidyText(job.description), 12000)}`;
}

/** Currículo enviado para esta vaga (resume.json do pacote), se houver. */
function tailoredResume(job: Job): string | null {
  const file = job.outputDir && path.join(job.outputDir, "resume.json");
  return file && fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
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
  const sources = [profileSources(), job.description, d.question, ...told, resume ?? ""].join("\n");

  const prompt = `${block("vaga", jobBlock(job))}${block("curriculo_enviado_para_esta_vaga", resume)}${block("o_que_a_pessoa_contou", d.context)}${block(
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
- Sobre a empresa, só o que está na <vaga> (inclusive a pesquisa na web, se houver). Não invente produto, valores, notícias, clientes ou números da empresa.
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
  return { answer: r.answer.trim(), needsYou: r.needsYou, warnings: issues };
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
