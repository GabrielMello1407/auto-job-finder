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
  const saved = job.outputDir;
  if (!saved || !inside(saved, paths.outputDir)) return null;
  // Caminho salvo desatualizado (pasta movida por outro comando): procura a pasta nas subpastas de status.
  const from = fs.existsSync(saved) ? saved : findMoved(path.basename(saved));
  if (!from) return null;
  let to = path.join(paths.outputDir, STATUS_FOLDER[job.status], path.basename(from));
  const remap = (p?: string) => (p && inside(p, saved) ? path.join(to, path.relative(saved, p)) : p);
  if (path.resolve(from) !== path.resolve(to)) {
    if (fs.existsSync(to)) to = `${to}-${job.id}`;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } else if (from === saved) return null;
  return { outputDir: to, files: job.files && { resume: remap(job.files.resume), coverLetter: remap(job.files.coverLetter) } };
}

function findMoved(name: string): string | null {
  for (const folder of new Set(Object.values(STATUS_FOLDER))) {
    const dir = path.join(paths.outputDir, folder, name);
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/** Mensagem amigável quando o Windows não deixa mover (arquivo aberto no leitor de PDF, Explorer etc.). */
export function moveError(job: Job, e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  const busy = code === "EPERM" || code === "EBUSY" || code === "EACCES";
  return `⚠ Não consegui mover a pasta de ${job.company}${busy ? " (algum arquivo dela está aberto?)" : `: ${(e as Error).message}`}. Tento de novo no próximo comando.`;
}
