import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { settings } from "../config.js";
import { loadPreferences } from "../profile.js";
import { ResumeSchema, type Job, type JobAnalysis, type Resume, type ResumeStats } from "../schemas.js";
import { skimTest } from "../tailor/skim.js";
import { funnel, SENT_STATUSES } from "./funnel.js";
import { loadJobs, updateJob } from "./store.js";

/**
 * Versões do currículo, para os resultados mostrarem qual currículo dá resposta (sem IA).
 * Cada pacote guarda um retrato do currículo (`Job.resumeStats`): de qual versão do currículo-base ele saiu
 * (muda quando o perfil é atualizado) e como está o topo, o que o recrutador lê primeiro (src/tailor/skim.ts).
 */

/** Versão do currículo-base: um hash curto do conteúdo. Muda a cada atualização do perfil ou edição. */
export function baseVersion(base: Resume): string {
  return crypto.createHash("sha1").update(JSON.stringify(base)).digest("hex").slice(0, 8);
}

/** Retrato de um currículo de pacote. Puro. */
export function resumeStats(
  resume: Resume,
  analysis: Pick<JobAnalysis, "roleTitle" | "mustHave" | "atsKeywords">,
  opts: { cover: boolean; base?: string; at?: string },
): ResumeStats {
  const s = skimTest(resume, analysis);
  return {
    at: opts.at ?? new Date().toISOString(),
    ...(opts.base ? { base: opts.base } : {}),
    language: resume.language,
    titleMatch: s.titleMatch,
    topKeywords: { found: s.foundTop.length, total: s.foundTop.length + s.missingTop.length },
    measurable: s.measurable,
    cover: opts.cover,
  };
}

/** Retrato a partir da pasta do pacote (resume.json e analysis.json). Sem os arquivos, nada. */
export function statsFromPackage(dir: string, base?: string): ResumeStats | null {
  const file = path.join(dir, "resume.json");
  const meta = path.join(dir, "analysis.json");
  if (!fs.existsSync(file) || !fs.existsSync(meta)) return null;
  try {
    const resume = ResumeSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    const { analysis } = JSON.parse(fs.readFileSync(meta, "utf8")) as { analysis: JobAnalysis };
    return resumeStats(resume, analysis, { cover: fs.existsSync(path.join(dir, "cover_letter.json")), base, at: fs.statSync(file).mtime.toISOString() });
  } catch {
    return null;
  }
}

/**
 * Candidaturas enviadas antes deste registro: o retrato sai da pasta do pacote (sem a versão do
 * currículo-base, que não dá para saber depois). Grava, para não ler as pastas de novo.
 */
export function withResumeStats(jobs: Job[] = loadJobs()): Job[] {
  let changed = false;
  for (const j of jobs) {
    if (j.resumeStats || !j.outputDir || !SENT_STATUSES.includes(j.status)) continue;
    const stats = statsFromPackage(j.outputDir);
    if (!stats) continue;
    j.resumeStats = stats;
    updateJob(j.id, { resumeStats: stats });
    changed = true;
  }
  return changed ? loadJobs() : jobs;
}

/** O funil de agora, com as versões do currículo se a opção estiver ligada (UI, terminal e painel). */
export function currentFunnel(jobs: Job[] = loadJobs(), now = Date.now()) {
  const resumes = loadPreferences().results.compareResumes;
  return funnel(resumes ? withResumeStats(jobs) : jobs, now, settings.noReplyDays, { resumes });
}
