import { settings } from "./config.js";
import { canWebSearch } from "./llm.js";
import { loadPreferences } from "./profile.js";
import { handledTwin } from "./jobs/dedupe.js";
import { priorityOf } from "./jobs/priority.js";
import { recordOpenCheck } from "./jobs/open.js";
import { searchJobs, searchSummary } from "./jobs/search.js";
import { STATUS_LABELS } from "./jobs/status.js";
import { loadJobs, setStatus, updateJob } from "./jobs/store.js";
import { track } from "./tracker.js";
import { triageJobs } from "./jobs/triage.js";
import { writeDashboard } from "./dashboard.js";
import type { Job } from "./schemas.js";
import { JobClosedError, tailorJob } from "./tailor/index.js";

export interface AutoOptions {
  /** Busca na web via IA. Vazio = preferences.json → webSearchByDefault (se a IA suportar). */
  web?: boolean;
  /** Quantos pacotes gerar no máximo nesta rodada. */
  maxPackages?: number;
  interview?: boolean;
  log?: (msg: string) => void;
}

/**
 * Vagas que merecem pacote: recomendadas pela triagem, nota ≥ mínimo, sem sinal de golpe, ainda sem
 * pacote, não repetidas. Na ordem de prioridade (aderência, frescor, vaga fantasma, eliminatórios:
 * src/jobs/priority.ts), para as mais recentes ganharem pacote primeiro.
 */
export function candidatesForPackage(jobs = loadJobs(), now = Date.now()): Job[] {
  return jobs
    .filter(
      (j) =>
        j.status === "shortlisted" &&
        (j.triage?.score ?? 0) >= settings.minTriageScore &&
        !(j.triage?.scamSignals.length ?? 0) &&
        !j.duplicateOf,
    )
    .sort((a, b) => priorityOf(b, now) - priorityOf(a, now));
}

/**
 * Piloto automático: busca → triagem → pacotes para as melhores vagas → painel.
 * Nada é enviado: no fim você só revisa os pacotes com nota ≥ mínimo.
 */
export async function autopilot(opts: AutoOptions = {}) {
  const log = opts.log ?? console.log;
  const max = opts.maxPackages ?? 3;

  const web = opts.web ?? (loadPreferences().webSearchByDefault && canWebSearch());
  log(`🔎 Buscando vagas${web ? " (APIs + busca na web com IA)" : ""}...`);
  const s = await searchJobs({ web });
  log(`   ${searchSummary(s)}`);
  s.errors.forEach((e) => log(`   ⚠ ${e}`));

  log("🧠 Triagem por IA...");
  const triaged = await triageJobs();
  log(`   ${triaged.length} avaliadas · ${triaged.filter((j) => j.status === "shortlisted").length} recomendadas`);

  const candidates = candidatesForPackage();
  if (!candidates.length) log(`   Nenhuma vaga nova com nota de triagem ≥ ${settings.minTriageScore}.`);

  // Vaga encerrada não conta: vai para "Encerradas" e o pacote passa para a próxima da lista.
  const results: { job: Job; rating: number; ready: boolean; dir: string }[] = [];
  let tries = 0;
  for (const job of candidates) {
    if (tries >= max) break;
    // Rede de segurança: a mesma vaga já tem pacote ou candidatura (veio de outro site, ou foi salva antes da checagem).
    const twin = handledTwin(job, loadJobs());
    if (twin) {
      updateJob(job.id, { duplicateOf: twin.id });
      track(setStatus(job.id, "discarded"), "discarded", "", `repetida de ${twin.company} — ${twin.title} (${twin.id})`);
      log(`🔁 ${job.company} — ${job.title}: é a mesma vaga que você já tem (${STATUS_LABELS[twin.status]}). Descartada, indo para a próxima.`);
      continue;
    }
    log(`📦 Pacote ${tries + 1}/${Math.min(max, candidates.length)}: ${job.company} — ${job.title}`);
    try {
      const r = await tailorJob(job.id, { interview: opts.interview });
      results.push({ job, rating: r.rating, ready: r.ready, dir: r.dir });
      log(`   nota ${r.rating} ${r.ready ? "✅ pronto" : "⚠ baixa aderência"}`);
    } catch (e) {
      if (e instanceof JobClosedError) {
        recordOpenCheck(e.job, e.check);
        log(`   🔒 vaga encerrada (${e.check.reason}): descartada, indo para a próxima`);
        continue;
      }
      log(`   ❌ ${(e as Error).message}`);
    }
    tries++;
  }

  const dashboard = writeDashboard();
  const ready = results.filter((r) => r.ready);
  log(`\n✅ ${ready.length} pacote(s) pronto(s) para revisar · painel: ${dashboard}`);
  return { search: s, triaged, results, dashboard };
}
