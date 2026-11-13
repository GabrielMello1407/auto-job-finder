import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { paths } from "../config.js";
import { structured } from "../llm.js";
import { loadPreferences } from "../profile.js";
import type { Resume } from "../schemas.js";
import { withoutDashes } from "../util/text.js";

/**
 * Números que faltam: tópicos de experiência sem nenhum resultado medido. Para cada um, a IA diz o que
 * dá para medir e faz a pergunta certa (sem nunca sugerir o valor); a pessoa informa o número real ou
 * aproximado, e isso vira uma proposta de atualização do perfil, que ela confere antes de salvar
 * (src/onboarding/update.ts). Resultado com número pesa na leitura do recrutador (ver
 * docs/how-it-works.md, "Research behind the features"); o agente nunca inventa o número.
 */

export interface BulletRef {
  company: string;
  title: string;
  bullet: string;
}

/** Quanto um número muda o tópico: alto = vira um resultado concreto; baixo = soaria forçado. */
export type NumberWorth = "alto" | "medio" | "baixo";

export interface NumberHint {
  worth: NumberWorth;
  /** O que dá para medir, em poucas palavras (ex.: "alcance: quantas pessoas usam"). */
  measure: string;
  /** A pergunta para a pessoa, que ela responde com um número. */
  question: string;
  /** Formatos de resposta, com N no lugar dos números. */
  examples: string[];
  /** Por que um número pesa aqui (ou por que não). */
  why: string;
}

export type BulletWithHint = BulletRef & { hint?: NumberHint };

/** Tópicos sem número, dos cargos mais recentes primeiro. Curtos demais (menos de 25 letras) ficam de fora. */
export function bulletsWithoutNumbers(resume: Resume, max = 10): BulletRef[] {
  return resume.experience
    .flatMap((e) => e.bullets.map((bullet) => ({ company: e.company, title: e.title, bullet: bullet.trim() })))
    .filter((b) => b.bullet.length >= 25 && !/\d/.test(b.bullet))
    .slice(0, max);
}

/* ------------------------------------------------------------------ análise */

const hintsFile = () => path.join(paths.profileDir, "numeros_que_faltam.json");

/** Análises já feitas, por texto do tópico (mudou o texto, analisa de novo). */
export function loadNumberHints(): Record<string, NumberHint> {
  try {
    const raw = JSON.parse(fs.readFileSync(hintsFile(), "utf8"));
    return raw && typeof raw.hints === "object" && raw.hints ? raw.hints : {};
  } catch {
    return {};
  }
}

function saveNumberHints(hints: Record<string, NumberHint>) {
  fs.mkdirSync(path.dirname(hintsFile()), { recursive: true });
  fs.writeFileSync(hintsFile(), JSON.stringify({ updatedAt: new Date().toISOString(), hints }, null, 2));
}

const ORDER: Record<NumberWorth, number> = { alto: 0, medio: 1, baixo: 3 };

/** Junta as análises salvas e põe primeiro os tópicos em que um número pesa mais (sem análise fica no meio). */
export function withHints(items: BulletRef[], hints: Record<string, NumberHint> = loadNumberHints()): BulletWithHint[] {
  return items
    .map((b, i) => ({ b: { ...b, hint: hints[b.bullet] }, i }))
    .sort((x, y) => (x.b.hint ? ORDER[x.b.hint.worth] : 2) - (y.b.hint ? ORDER[y.b.hint.worth] : 2) || x.i - y.i)
    .map((x) => x.b);
}

/** Os exemplos mostram o formato da resposta, nunca um valor: qualquer número vira "N". */
export const withoutFigures = (s: string) => s.replace(/\d+(?:[.,]\d+)*/g, "N");

/**
 * Algumas IAs põem os exemplos dentro da pergunta ("... por mês? Exemplos: “N pessoas”; “N a N”.") e deixam
 * a lista vazia: separa os dois.
 */
export function splitExamples(question: string, examples: string[]): { question: string; examples: string[] } {
  const m = question.match(/^(.*?)\s*\(?\b(?:exemplos?|ex\.)\s*:\s*(.+?)\)?\s*$/is);
  if (!m) return { question, examples };
  const found = m[2]
    .split(/[;|]|\s+ou\s+(?=[“"'])/)
    .map((x) => x.replace(/^[\s“”"'.,]+|[\s“”"'.,]+$/g, ""))
    .filter(Boolean);
  return { question: m[1].trim(), examples: examples.length ? examples : found };
}

const tidy = (s: string, max: number) => withoutDashes(s.replace(/\s+/g, " ").trim()).slice(0, max);

const HintsSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().describe("O número do tópico na lista"),
      worth: z
        .enum(["alto", "medio", "baixo"])
        .describe("alto: o número mostraria impacto ou escala que importa para os cargos buscados; medio: ajuda, mas o tópico já se sustenta; baixo: só daria para contar esforço, ou o tópico é uma prática ou responsabilidade em que um número soaria forçado"),
      measure: z.string().describe("O tipo de número e o que ele mede, em poucas palavras (ex.: 'alcance: quantas pessoas usam')"),
      question: z.string().describe("Uma pergunta direta pelo impacto, que a pessoa responde com um número sem precisar pesquisar"),
      examples: z.array(z.string()).describe("Obrigatório: 2 ou 3 formatos curtos de resposta para esta pergunta, com N no lugar de qualquer número (ex.: 'cerca de N mil acessos por mês')"),
      why: z.string().describe("Uma frase curta: por que um número aqui pesa para quem contrata, ou por que não pesa"),
    }),
  ),
});

const SYSTEM = `Você ajuda uma pessoa a completar o próprio currículo com números reais. Quem contrata dá mais peso a resultados medidos: quanto, quantos, em quanto tempo, para quantas pessoas, quanto economizou ou trouxe.

Para cada tópico da lista, diga o que dá para medir ali e faça a pergunta que a pessoa precisa responder.

Pergunte pelo impacto, não pelo esforço. O número que pesa mostra quem foi atingido, o que mudou e quanto: pessoas ou clientes atendidos, tempo ganho, erros que caíram, dinheiro que entrou ou deixou de sair. Contar o próprio trabalho (quantas tarefas, quantas peças, quantos arquivos, quantas horas) quase nunca impressiona; só use contagem quando o volume é o próprio resultado (vendas fechadas, atendimentos, pacientes, alunos formados).
- Ruim: "Quantos relatórios você fez?" Bom: "Quantas horas por mês a equipe deixou de gastar com isso?"
- Ruim: "Quantas visitas a clientes você fez?" Bom: "Quanto a sua carteira cresceu, em clientes ou em vendas?"
- Ruim: "Quantas telas você desenvolveu?" Bom: "Quantas pessoas usam o sistema por mês?"

Regras:
- Nunca sugira um valor, nem suponha um fato que o tópico não diz. Nos exemplos, use N no lugar de qualquer número (ex.: "cerca de N usuários por mês", "de N horas para N minutos").
- A pergunta precisa ser respondida por quem fez o trabalho, de memória ou com uma conta simples. Uma pergunta por tópico, específica para ele: nada de "qual foi o resultado?".
- Pense no que pesa para os cargos que a pessoa busca. Tipos de número: alcance (pessoas, clientes, unidades, locais), volume (itens, pedidos, atendimentos, mensagens, registros), tempo (antes e depois, prazo), qualidade (erros, retrabalho, disponibilidade, nota), dinheiro (receita, custo, economia) e equipe (quantas pessoas, quantos times).
- Se o tópico já diz o tamanho em palavras ("todos os campi", "toda a empresa"), pergunte o número por trás disso.
- Se a pergunta tiver duas partes, a pessoa responde as duas ou só a que souber; não junte mais que duas.
- Os exemplos são obrigatórios e vão no campo examples, não dentro da pergunta: 2 ou 3 jeitos de responder, com N no lugar dos números.
- Vale para qualquer profissão. Escreva em português do Brasil, em frases curtas, sem travessão.`;

/**
 * Analisa os tópicos que ainda não têm análise (ou todos, com `force`) numa chamada só e guarda o resultado.
 * Análises de tópicos que saíram do currículo são descartadas.
 */
export async function analyzeNumbers(items: BulletRef[], force = false, ask: typeof structured = structured): Promise<Record<string, NumberHint>> {
  const saved = loadNumberHints();
  const hints: Record<string, NumberHint> = {};
  for (const b of items) if (!force && saved[b.bullet]) hints[b.bullet] = saved[b.bullet];
  const todo = items.filter((b) => !hints[b.bullet]);
  if (todo.length) {
    const roles = loadPreferences().targetRoles.filter(Boolean);
    const r = await ask(HintsSchema, {
      label: "profile:numbers",
      // Esforço baixo: 12 tópicos em cerca de meio minuto com a mesma qualidade; o médio levava minutos.
      effort: "low",
      timeoutMs: 180_000,
      system: [SYSTEM],
      user: `${roles.length ? `Cargos que a pessoa busca: ${roles.join("; ")}.\n\n` : ""}Tópicos do currículo sem nenhum número:

${todo.map((b, i) => `${i + 1}. [${b.company}, ${b.title}] ${b.bullet}`).join("\n")}

Responda um item para cada tópico, com o mesmo número da lista.`,
    });
    for (const it of r.items) {
      const b = todo[it.index - 1];
      if (!b || hints[b.bullet]) continue;
      const split = splitExamples(it.question.trim(), it.examples.map((e) => e.trim()).filter(Boolean));
      const question = tidy(split.question, 220);
      if (!question) continue;
      hints[b.bullet] = {
        worth: it.worth,
        measure: tidy(it.measure, 140),
        question,
        // Os exemplos entram depois de "ex.:", então começam com minúscula (sigla como "NPS" fica como está).
        examples: split.examples
          .map((e) => withoutFigures(tidy(e, 90)).replace(/[\s.;,]+$/, ""))
          .map((e) => (/^\p{Lu}\p{Ll}/u.test(e) ? e[0].toLowerCase() + e.slice(1) : e))
          .filter(Boolean)
          .slice(0, 3),
        why: tidy(it.why, 220),
      };
    }
  }
  saveNumberHints(hints);
  return hints;
}

/* --------------------------------------------------------------- respostas */

/** O texto da novidade para a proposta de atualização, só com os tópicos que ganharam número. */
export function numbersNews(items: (BulletRef & { value: string; question?: string })[]): string {
  const filled = items.filter((i) => i.value.trim());
  if (!filled.length) return "";
  return `Números que eu informei para resultados que já estão no meu currículo. Use exatamente como escrevi: se eu disse "cerca de" ou "aproximadamente", mantenha assim; não arredonde nem aumente.

${filled
  .map((i) => `- Em ${i.company} (${i.title}), no resultado "${i.bullet}"${i.question ? `, à pergunta "${i.question}", respondi` : ""}: ${i.value.trim()}`)
  .join("\n")}`;
}
