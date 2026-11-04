import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import type { Job, JobStatus } from "../schemas.js";

/** Subpasta de output/ para os pacotes de cada status. O número no começo mantém a ordem no explorador de arquivos. */
export const STATUS_FOLDER: Record<JobStatus, string> = {
  new: "1-prontas-para-enviar",
  triaged: "1-prontas-para-enviar",
  shortlisted: "1-prontas-para-enviar",
  tailored: "1-prontas-para-enviar",
  applied: "2-em-andamento",
  interview: "2-em-andamento",
  offer: "2-em-andamento",
  low_fit: "3-baixa-aderencia",
  rejected: "4-encerradas",
  discarded: "4-encerradas",
};

const inside = (dir: string, parent: string) => {
  const rel = path.relative(parent, dir);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * Move a pasta do pacote para a subpasta do status atual. Devolve os campos com os caminhos novos,
 * ou null se não havia nada para mover. Só mexe em pastas dentro de output/.
 */
export function relocatePackage(job: Job): Pick<Job, "outputDir" | "files"> | null {
  const from = job.outputDir;
  if (!from || !inside(from, paths.outputDir) || !fs.existsSync(from)) return null;
  let to = path.join(paths.outputDir, STATUS_FOLDER[job.status], path.basename(from));
  if (path.resolve(from) === path.resolve(to)) return null;
  if (fs.existsSync(to)) to = `${to}-${job.id}`;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  const moved = (p?: string) => (p && inside(p, from) ? path.join(to, path.relative(from, p)) : p);
  return { outputDir: to, files: job.files && { resume: moved(job.files.resume), coverLetter: moved(job.files.coverLetter) } };
}

/** Mensagem amigável quando o Windows não deixa mover (arquivo aberto no leitor de PDF, Explorer etc.). */
export function moveError(job: Job, e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  const busy = code === "EPERM" || code === "EBUSY" || code === "EACCES";
  return `⚠ Não consegui mover a pasta de ${job.company}${busy ? " (algum arquivo dela está aberto?)" : `: ${(e as Error).message}`}. Tento de novo no próximo comando.`;
}
