import type { Resume, Review } from "../schemas.js";
import type { GuardReport } from "./guards.js";

export type StopReason = "target_reached" | "no_improvement" | "max_revisions";

export interface Round {
  rating: number;
  violations: number;
  review: Review;
  resume: Resume;
}

export interface RefineResult {
  best: Round;
  rounds: Round[];
  stopReason: StopReason;
  restored: boolean;
}

/**
 * Loop Gerente de Contratação ⇄ Editor (ideia do meu-emprego-novo), com duas mudanças:
 * - a nota vem de saída estruturada (sem regex em texto livre);
 * - travas determinísticas (guards) entram na escolha: versão com violação nunca vence uma limpa.
 *
 * Para quando: nota ≥ alvo sem violações; uma revisão não melhora (insistir numa lacuna real só
 * empurra o modelo a inventar); ou atinge o limite de revisões. Fica sempre a melhor versão.
 */
export async function refine(params: {
  initial: Resume;
  evaluate: (r: Resume) => Promise<Review>;
  revise: (r: Resume, review: Review, guards: GuardReport) => Promise<Resume>;
  guard: (r: Resume) => GuardReport;
  target: number;
  maxRevisions: number;
  onRound?: (round: Round, index: number) => void;
}): Promise<RefineResult> {
  const better = (a: Round, b: Round) =>
    a.violations === 0 && b.violations > 0 ? true : a.violations > 0 && b.violations === 0 ? false : a.rating > b.rating;

  const rounds: Round[] = [];
  let current = params.initial;
  let best: Round | null = null;
  let stopReason: StopReason = "max_revisions";

  for (let i = 0; ; i++) {
    const guards = params.guard(current);
    const review = await params.evaluate(current);
    const round: Round = { rating: review.rating, violations: guards.violations.length, review, resume: current };
    rounds.push(round);
    params.onRound?.(round, i);

    const improved = !best || better(round, best);
    if (improved) best = round;

    if (round.rating >= params.target && round.violations === 0) {
      stopReason = "target_reached";
      break;
    }
    if (!improved) {
      stopReason = "no_improvement";
      break;
    }
    if (i >= params.maxRevisions) {
      stopReason = "max_revisions";
      break;
    }
    current = await params.revise(current, review, guards);
  }

  return { best: best!, rounds, stopReason, restored: best!.resume !== rounds[rounds.length - 1].resume };
}

export function ratingReport(r: RefineResult, target: number): string {
  const reasons: Record<StopReason, string> = {
    target_reached: "nota-alvo atingida sem violações",
    no_improvement: "a última revisão não melhorou (lacuna real não se resolve editando)",
    max_revisions: "limite de revisões atingido",
  };
  const rev = r.best.review;
  return `# Relatório de avaliação

- Nota-alvo: ${target}
- Notas por rodada: ${r.rounds.map((x, i) => `#${i + 1}: ${x.rating}${x.violations ? ` (${x.violations} violação/ões)` : ""}`).join(" · ")}
- **Nota final: ${r.best.rating}**
- Parou porque: ${reasons[r.stopReason]}
${r.restored ? "- A versão de melhor nota foi restaurada como final.\n" : ""}
> Ficar abaixo da meta é um resultado válido: a nota é a opinião do modelo e pode refletir uma lacuna real.

## Justificativa
${rev.ratingRationale}

## Pontos fortes
${rev.strengths.map((s) => `- ${s}`).join("\n")}

## Lacunas
${rev.gaps.map((g) => `- **${g.requirement}** ${g.truthfullyCoverable ? "(dá para mostrar com fatos reais)" : "(lacuna real)"} — ${g.why}${g.truthfullyCoverable ? ` → ${g.suggestion}` : ""}`).join("\n") || "- (nenhuma)"}

## Apresentação
${rev.presentation.map((s) => `- ${s}`).join("\n") || "- (sem observações)"}
`;
}
