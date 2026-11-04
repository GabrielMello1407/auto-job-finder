import fs from "node:fs";
import { ensureDir, paths } from "../config.js";
import type { Job, JobStatus } from "../schemas.js";
import { norm } from "../util/text.js";
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

/** Mesma vaga publicada em fontes diferentes: empresa + título normalizados. */
const dedupeKey = (j: { company: string; title: string }) => `${norm(j.company)}|${norm(j.title)}`;

/** Insere vagas novas; ignora as já conhecidas (por URL ou empresa+título). Retorna as inseridas. */
export function upsertJobs(raw: RawJob[]): Job[] {
  const jobs = loadJobs();
  const byId = new Set(jobs.map((j) => j.id));
  const byKey = new Set(jobs.map(dedupeKey));
  const added: Job[] = [];
  for (const r of raw) {
    if (!r.url || !r.title) continue;
    const id = jobId(r.url);
    const key = dedupeKey(r);
    if (byId.has(id) || byKey.has(key)) continue;
    const job: Job = { ...r, id, addedAt: new Date().toISOString(), status: "new" };
    jobs.push(job);
    added.push(job);
    byId.add(id);
    byKey.add(key);
  }
  saveJobs(jobs);
  return added;
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
  return updateJob(id, {
    status,
    ...(notes ? { notes } : {}),
    ...(status === "applied" ? { appliedAt: new Date().toISOString() } : {}),
  });
}
