import fs from "node:fs";
import { ensureDir, paths } from "../config.js";
import type { Job, JobStatus } from "../schemas.js";
import { track } from "../tracker.js";
import { DuplicateFinder, handledTwins } from "./dedupe.js";
import { moveError, relocatePackage } from "./folders.js";
import { jobId, type RawJob } from "./sources/index.js";

export function loadJobs(): Job[] {
  if (!fs.existsSync(paths.jobsDb)) return [];
  return JSON.parse(fs.readFileSync(paths.jobsDb, "utf8"));
}

export function saveJobs(jobs: Job[]) {
  ensureDir(paths.dataDir);
  fs.writeFileSync(paths.jobsDb, JSON.stringify(jobs, null, 2));
}

export function findJob(jobs: Job[], idOrPrefix: string): Job {
  const matches = jobs.filter((j) => j.id === idOrPrefix || j.id.startsWith(idOrPrefix));
  if (matches.length === 0) throw new Error(`Vaga '${idOrPrefix}' não encontrada. Use 'ajf jobs' para listar.`);
  if (matches.length > 1) throw new Error(`ID '${idOrPrefix}' é ambíguo: ${matches.map((m) => m.id).join(", ")}`);
  return matches[0];
}

export interface UpsertResult {
  /** Vagas novas, para a triagem. */
  added: Job[];
  /** A mesma vaga já estava salva, vinda de outro site: entram descartadas, com `duplicateOf`. */
  duplicates: Job[];
  /** Vagas já salvas com o mesmo link (nada muda nelas). */
  known: Job[];
}

/**
 * Insere vagas novas. O mesmo link é ignorado; a mesma vaga em outro site (empresa, título e texto
 * iguais) entra descartada e marcada como repetida, para não ser avaliada nem virar outro pacote —
 * dá para reabrir. Com `keepNearDuplicates` (vaga colada pela pessoa), entra normal, só marcada.
 */
export function upsertJobs(raw: RawJob[], opts: { keepNearDuplicates?: boolean } = {}): UpsertResult {
  const jobs = loadJobs();
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const finder = new DuplicateFinder(jobs);
  const result: UpsertResult = { added: [], duplicates: [], known: [] };
  for (const r of raw) {
    if (!r.url || !r.title) continue;
    const id = jobId(r.url);
    const match = byId.has(id) ? { job: byId.get(id)!, how: "link" as const } : finder.find(r);
    if (match?.how === "link") {
      result.known.push(match.job);
      continue;
    }
    const job: Job = { ...r, id, addedAt: new Date().toISOString(), status: "new" };
    if (match?.how === "reaberta") job.reopenedFrom = match.job.id; // vaga nova da mesma empresa: entra normal, com aviso
    else if (match) {
      job.duplicateOf = match.job.id;
      if (!opts.keepNearDuplicates) job.status = "discarded";
    }
    jobs.push(job);
    byId.set(id, job);
    finder.add(job);
    (job.status === "discarded" ? result.duplicates : result.added).push(job);
  }
  saveJobs(jobs);
  return result;
}

/** "Não é a mesma vaga": tira a marca de repetida e não marca de novo. */
export function markNotDuplicate(id: string): Job {
  return updateJob(id, { duplicateOf: undefined, notDuplicate: true });
}

/**
 * Marca as vagas salvas que são a mesma de uma que você já tratou (pacote ou candidatura): pega as que
 * escaparam na busca e as salvas antes desta checagem existir. Sem pacote, vão para "Encerradas";
 * com pacote, ficam onde estão, só marcadas (a decisão é sua).
 */
export function flagHandledTwins(): { job: Job; twin: Job }[] {
  const all = handledTwins(loadJobs());
  // Igual a uma de outra abertura (muito tempo atrás): só o aviso de vaga reaberta.
  for (const { job, twin } of all.filter((t) => t.reopened)) updateJob(job.id, { reopenedFrom: twin.id });
  const found = all.filter((t) => !t.reopened);
  for (const { job, twin } of found) {
    updateJob(job.id, { duplicateOf: twin.id });
    if (job.status === "tailored" || job.status === "low_fit") continue;
    track(setStatus(job.id, "discarded"), "discarded", "", `repetida de ${twin.company} — ${twin.title} (${twin.id})`);
  }
  return found;
}

/** Tenta mover a pasta do pacote para a subpasta do status. Não falha: se não der, avisa e tenta no próximo comando. */
function placePackage(job: Job): boolean {
  try {
    const moved = relocatePackage(job);
    if (moved) Object.assign(job, moved);
    return Boolean(moved);
  } catch (e) {
    console.warn(moveError(job, e));
    return false;
  }
}

export function updateJob(id: string, patch: Partial<Job>): Job {
  const jobs = loadJobs();
  const job = findJob(jobs, id);
  Object.assign(job, patch);
  if (patch.status || patch.outputDir) placePackage(job);
  saveJobs(jobs);
  return job;
}

/** Deixa cada pasta de pacote em output/ na subpasta do seu status (organiza também as pastas antigas). */
export function organizePackages(): number {
  const jobs = loadJobs();
  let moved = 0;
  for (const job of jobs) if (placePackage(job)) moved++;
  if (moved) saveJobs(jobs);
  return moved;
}

export function setStatus(id: string, status: JobStatus, notes?: string): Job {
  const before = findJob(loadJobs(), id);
  return updateJob(id, {
    status,
    // Reabrir uma vaga marcada como repetida é dizer que ela não é repetida (e não marcar de novo).
    ...(before.status === "discarded" && status !== "discarded" && before.duplicateOf ? { duplicateOf: undefined, notDuplicate: true } : {}),
    ...(notes ? { notes } : {}),
    ...(status === "applied" ? { appliedAt: new Date().toISOString() } : {}),
  });
}
