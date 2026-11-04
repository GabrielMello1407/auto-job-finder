import fs from "node:fs";
import { ensureDir, paths } from "./config.js";
import type { Job } from "./schemas.js";
import { today } from "./util/text.js";

const HEADER = "data,id,empresa,vaga,fonte,mercado,link,pasta,status,proximo_passo,observacoes";

const csv = (v: string | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`;

/** Registra eventos no tracker.csv (abre no Excel/Sheets). Uma linha por evento. */
export function track(job: Job, status: string, nextStep = "", notes = "") {
  ensureDir(paths.outputDir);
  if (!fs.existsSync(paths.tracker)) fs.writeFileSync(paths.tracker, "﻿" + HEADER + "\n");
  const row = [
    today(),
    job.id,
    job.company,
    job.title,
    job.source,
    job.triage?.market ?? "",
    job.applyUrl ?? job.url,
    job.outputDir ?? "",
    status,
    nextStep,
    notes,
  ]
    .map(csv)
    .join(",");
  fs.appendFileSync(paths.tracker, row + "\n");
}
