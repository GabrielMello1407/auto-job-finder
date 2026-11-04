import { structured } from "../llm.js";
import { loadExcluded, loadPreferences } from "../profile.js";
import { profileSystem } from "../prompts.js";
import { TriageBatchSchema, type Job } from "../schemas.js";
import { today, truncate } from "../util/text.js";
import { loadJobs, saveJobs } from "./store.js";

const BATCH = 6;

function jobBlock(j: Job): string {
  return `<job id="${j.id}">
Título: ${j.title}
Empresa: ${j.company}
Local: ${j.location} | Remoto: ${j.remote ?? "?"} | Fonte: ${j.source} | Publicada: ${j.postedAt ?? "?"}
Salário: ${j.salary ?? "não informado"}
Link: ${j.url}
Descrição:
${truncate(j.description, 5000)}
</job>`;
}

/** Triagem por IA: aderência, lacunas obrigatórias, sinais de golpe e mercado (BR/US/...). */
export async function triageJobs(opts: { limit?: number; ids?: string[] } = {}) {
  const jobs = loadJobs();
  let pending = jobs.filter((j) => (opts.ids?.length ? opts.ids.includes(j.id) : j.status === "new"));
  if (opts.limit) pending = pending.slice(0, opts.limit);
  if (!pending.length) return [];

  const system = profileSystem();
  const prefs = loadPreferences();
  const excluded = loadExcluded();
  const done: Job[] = [];

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    process.stdout.write(`  triagem ${i + 1}–${i + batch.length} de ${pending.length}...\n`);
    const result = await structured(TriageBatchSchema, {
      label: "triage",
      tier: "fast",
      effort: "medium",
      system,
      user: `Hoje é ${today()}. Avalie cada vaga abaixo contra o profile_truth.

Para cada vaga devolva um item em "results" com o mesmo jobId.
Critérios:
- fit "alta" só se TODOS os requisitos obrigatórios têm evidência no perfil; "media" se falta 1–2 obrigatórios contornáveis; "baixa" caso contrário.
- score 0–100 coerente com o fit.
- evidence: cite trechos curtos do perfil. mustHaveGaps: requisitos obrigatórios sem evidência (escreva "sem evidência", não suponha).
- scamSignals: domínio de e-mail estranho, pedido de documento/pagamento, teste que exige baixar e rodar código, salário irreal, vaga vaga demais.
- market: país do empregador/contratação (BR se empresa brasileira contratando no Brasil; US se empresa americana, mesmo remota).
- recommendation: "candidatar" (fit alta/média sem golpe), "decidir" (dúvida real), "descartar".
- ${prefs.onsiteCities.length ? `Vaga presencial ou híbrida só serve nestas cidades/região: ${prefs.onsiteCities.join(", ")}. Fora delas, sem opção remota → "descartar".` : "O candidato não informou cidades para trabalho presencial: vaga só presencial/híbrida sem opção remota → \"decidir\"."}
- Cargos-alvo do candidato: ${prefs.targetRoles.join("; ") || "(ver perfil)"}. Senioridade buscada: ${prefs.seniority || "(ver perfil)"}.
- Considere o nível de idioma declarado no perfil quando a vaga exigir fluência: isso é lacuna, não descarte automático.

Vagas/empresas que o candidato excluiu:
${excluded || "(nenhuma)"}

${batch.map(jobBlock).join("\n\n")}`,
    });

    for (const r of result.results) {
      const job = jobs.find((j) => j.id === r.jobId);
      if (!job) continue;
      const { jobId: _ignored, ...triage } = r;
      job.triage = triage;
      job.status = triage.recommendation === "descartar" ? "discarded" : triage.recommendation === "candidatar" ? "shortlisted" : "triaged";
      done.push(job);
    }
    saveJobs(jobs);
  }
  return done;
}
