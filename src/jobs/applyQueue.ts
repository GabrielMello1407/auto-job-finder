import fs from "node:fs";
import path from "node:path";
import type { FollowedCompany } from "../profile.js";
import type { Job } from "../schemas.js";
import { parseEmails } from "../writers/emailDraft.js";
import { priorityOf } from "./priority.js";

/**
 * Modo candidatura: os pacotes prontos numa fila, um de cada vez, com tudo o que o envio pede numa tela só
 * (link, como se candidatar, currículo, mensagem curta, ficha, perguntas, indicação) e o "Enviei" com o canal.
 * A pessoa envia; o agente só mostra e registra. A interface, o `ajf candidatar` e o menu usam esta fila.
 */

/** Os pacotes prontos, na mesma ordem da etapa "Prontas": prioridade, depois a nota do currículo. */
export function applyQueue(jobs: Job[], now = Date.now(), followed: FollowedCompany[] = []): Job[] {
  return jobs
    .filter((j) => j.status === "tailored")
    .map((j) => ({ j, p: priorityOf(j, now, followed) }))
    .sort((a, b) => b.p - a.p || (b.j.rating ?? 0) - (a.j.rating ?? 0))
    .map((x) => x.j);
}

/** Uma seção "## Título" de um markdown, sem o título. Sem a seção, null. */
export function markdownSection(md: string | null, heading: string): string | null {
  if (!md) return null;
  const lines = md.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").trim().toLowerCase().startsWith(heading.toLowerCase()));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##?\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim() || null;
}

/** A mensagem curta de apresentação do pacote (item 6 de emails.md). */
export function applicationNote(emailsMd: string | null): string | null {
  const s = parseEmails(emailsMd)?.sections.find((x) => /^6\./.test(x.title));
  return s?.message.trim() || null;
}

const read = (dir: string | undefined, file: string) => (dir && fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), "utf8") : null);

/** O que o envio de uma vaga pede, lido da pasta do pacote. */
export function applyKit(job: Job) {
  const dir = job.outputDir;
  return {
    link: job.applyUrl ?? job.url,
    /** "Como se candidatar" do LEIA-ME (canal, instruções da vaga). */
    howTo: markdownSection(read(dir, "LEIA-ME.md"), "Como se candidatar"),
    note: applicationNote(read(dir, "emails.md")),
    resume: job.files?.resume,
    cover: job.files?.coverLetter,
    answers: job.answers?.length ?? 0,
  };
}
