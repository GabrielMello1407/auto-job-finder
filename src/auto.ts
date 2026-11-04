import { settings } from "./config.js";
import { canWebSearch } from "./llm.js";
import { loadPreferences } from "./profile.js";
import { searchJobs } from "./jobs/search.js";
import { loadJobs } from "./jobs/store.js";
import { triageJobs } from "./jobs/triage.js";
import { writeDashboard } from "./dashboard.js";
import type { Job } from "./schemas.js";
import { tailorJob } from "./tailor/index.js";

export interface AutoOptions {
  /** Busca na web via IA. Vazio = preferences.json → webSearchByDefault (se a IA suportar). */
  web?: boolean;
  /** Quantos pacotes gerar no máximo nesta rodada. */
  maxPackages?: number;
  interview?: boolean;
  log?: (msg: string) => void;
}

/** Vagas que merecem pacote: recomendadas pela triagem, nota ≥ mínimo, sem sinal de golpe, ainda sem pacote. */
export function candidatesForPackage(jobs = loadJobs()): Job[] {
  return jobs
    .filter(
      (j) =>
        j.status === "shortlisted" &&
        (j.triage?.score ?? 0) >= settings.minTriageScore &&
        !(j.triage?.scamSignals.length ?? 0),
    )
    .sort((a, b) => (b.triage?.score ?? 0) - (a.triage?.score ?? 0));
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
  log(`   ${s.added.length} novas (de ${s.found} encontradas; ${s.kept} passaram no filtro)`);
  s.errors.forEach((e) => log(`   ⚠ ${e}`));

  log("🧠 Triagem por IA...");
  const triaged = await triageJobs();
  log(`   ${triaged.length} avaliadas · ${triaged.filter((j) => j.status === "shortlisted").length} recomendadas`);

  const picks = candidatesForPackage().slice(0, max);
  if (!picks.length) log(`   Nenhuma vaga nova com nota de triagem ≥ ${settings.minTriageScore}.`);

  const results: { job: Job; rating: number; ready: boolean; dir: string }[] = [];
  for (const [i, job] of picks.entries()) {
    log(`📦 Pacote ${i + 1}/${picks.length}: ${job.company} — ${job.title}`);
    try {
      const r = await tailorJob(job.id, { interview: opts.interview });
      results.push({ job, rating: r.rating, ready: r.ready, dir: r.dir });
      log(`   nota ${r.rating} ${r.ready ? "✅ pronto" : "⚠ baixa aderência"}`);
    } catch (e) {
      log(`   ❌ ${(e as Error).message}`);
    }
  }

  const dashboard = writeDashboard();
  const ready = results.filter((r) => r.ready);
  log(`\n✅ ${ready.length} pacote(s) pronto(s) para revisar · painel: ${dashboard}`);
  return { search: s, triaged, results, dashboard };
}
