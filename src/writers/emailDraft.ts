import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "../schemas.js";

/*
 * Rascunho do e-mail de candidatura com o currículo já anexado. O agente nunca envia: ele grava um
 * arquivo .eml na pasta do pacote, e o programa de e-mail abre esse arquivo como um e-mail novo
 * (o Outlook, pelo cabeçalho X-Unsent, já em modo de edição). Quem clica em Enviar é a pessoa.
 */

export const DRAFT_FILE = "rascunho_candidatura.eml";

export interface EmailSection {
  title: string;
  subjects: string[];
  message: string;
  notes: string;
}

/** Separa emails.md em seções (candidatura, LinkedIn, follow-up...) com assunto e mensagem prontos para copiar. */
export function parseEmails(md: string | null): { intro: string; sections: EmailSection[] } | null {
  if (!md) return null;
  const [head, ...parts] = md.replace(/\r/g, "").split(/^## /m);
  const sections = parts.map((part): EmailSection => {
    const [titleLine, ...rest] = part.split("\n");
    const body = rest.join("\n");
    const code = body.match(/```[a-z]*\n([\s\S]*?)```/);
    const before = (code ? body.slice(0, code.index) : body).trim();
    const subjects: string[] = [];
    const inlineSubject = before.match(/\*\*Assunto[^*]*\*\*:?[ \t]*(.*)/);
    if (inlineSubject?.[1]?.trim()) subjects.push(inlineSubject[1].trim());
    else if (/\*\*Assunto/.test(before)) for (const m of before.matchAll(/^\s*-\s+(.+)$/gm)) subjects.push(m[1].trim());
    const notes = before
      .split("\n")
      .filter((l) => !/\*\*Assunto/.test(l) && !(subjects.length && /^\s*-\s+/.test(l)))
      .join("\n")
      .trim();
    return { title: titleLine.trim(), subjects, message: code ? code[1].trim() : body.trim(), notes };
  });
  return { intro: head.replace(/^# .*\n/, "").trim(), sections };
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  /** Caminhos dos arquivos a anexar (currículo, carta). */
  attachments: string[];
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
const isEmail = (s: string) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(s);
const b64 = (s: string | Buffer) => (typeof s === "string" ? Buffer.from(s, "utf8") : s).toString("base64");
const wrap76 = (s: string) => s.match(/.{1,76}/g)?.join("\r\n") ?? "";
/** Cabeçalho com acento: "encoded-word" (RFC 2047). Texto ASCII vai como está. */
const headerText = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** O arquivo .eml (texto). `attachments` já lidos: nome e conteúdo. */
export function emlText(d: { to: string; subject: string; body: string; attachments: { name: string; data: Buffer }[] }, boundary = `ajf-${crypto.randomUUID()}`): string {
  const to = oneLine(d.to);
  const lines = [
    "X-Unsent: 1",
    ...(isEmail(to) ? [`To: ${to}`] : []),
    `Subject: ${headerText(oneLine(d.subject))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(b64(d.body.replace(/\r?\n/g, "\r\n"))),
  ];
  for (const a of d.attachments) {
    const name = headerText(oneLine(a.name).replace(/"/g, ""));
    const type = /\.pdf$/i.test(a.name) ? "application/pdf" : "application/octet-stream";
    lines.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(b64(a.data)),
    );
  }
  lines.push(`--${boundary}--`, "");
  return lines.join("\r\n");
}

/** Grava o rascunho na pasta do pacote e devolve o caminho. Anexos que não existem ficam de fora. */
export function writeDraft(dir: string, d: EmailDraft): string {
  const file = path.join(dir, DRAFT_FILE);
  const attachments = d.attachments.filter((f) => fs.existsSync(f)).map((f) => ({ name: path.basename(f), data: fs.readFileSync(f) }));
  fs.writeFileSync(file, emlText({ to: d.to, subject: d.subject, body: d.body, attachments }));
  return file;
}

/** O e-mail de candidatura do pacote de uma vaga (emails.md + e-mail de contato da vaga + PDFs). */
export function applicationDraft(job: Job): EmailDraft | null {
  if (!job.outputDir) return null;
  return draftFromDir(job.outputDir, [job.files?.resume, job.files?.coverLetter].filter((f): f is string => Boolean(f)));
}

/** O mesmo, a partir da pasta do pacote e dos PDFs a anexar. */
export function draftFromDir(dir: string, attachments: string[]): EmailDraft | null {
  if (!fs.existsSync(path.join(dir, "emails.md"))) return null;
  const emails = parseEmails(fs.readFileSync(path.join(dir, "emails.md"), "utf8"));
  const first = emails?.sections.find((s) => s.subjects.length);
  if (!first) return null;
  let to = "";
  try {
    to = JSON.parse(fs.readFileSync(path.join(dir, "analysis.json"), "utf8")).analysis?.recruiterEmail ?? "";
  } catch {
    /* sem análise: o rascunho vai sem destinatário */
  }
  return { to, subject: first.subjects[0], body: first.message, attachments };
}

/** Grava (ou refaz) o rascunho do e-mail de candidatura de uma vaga. `null` se a vaga não tem pacote com e-mails. */
export function writeApplicationDraft(job: Job): string | null {
  const draft = applicationDraft(job);
  return draft && job.outputDir ? writeDraft(job.outputDir, draft) : null;
}

/** Link que abre o Gmail no navegador com destinatário, assunto e texto preenchidos (o anexo vai à mão). */
export function gmailComposeUrl(d: { to: string; subject: string; body: string }): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", ...(isEmail(oneLine(d.to)) ? { to: oneLine(d.to) } : {}), su: oneLine(d.subject), body: d.body });
  return `https://mail.google.com/mail/?${q}`;
}
