import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { paths } from "../config.js";
import type { Lang } from "./i18n.js";
import type { TaskQueue } from "./tasks.js";

/** Peças compartilhadas pelas rotas da interface local. */

/**
 * Erro com status HTTP. A mensagem é a chave de tradução (texto em português, com {variáveis}):
 * o servidor responde no idioma da página (src/ui/i18n.ts).
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public vars?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** O que as rotas podem usar do servidor. */
export interface App {
  queue: TaskQueue;
  /** Avisa as páginas abertas (Server-Sent Events). */
  broadcast(event: string, data: unknown): void;
  /** Vagas mudaram: regenera o painel.html e avisa as páginas. */
  jobsChanged(jobId?: string): void;
}

export interface Ctx {
  req: http.IncomingMessage;
  /** Idioma da página que chamou (cabeçalho x-ajf-lang). */
  lang: Lang;
  /** Texto no idioma da página: o português é a chave (src/ui/i18n.ts). */
  t(text: string, vars?: Record<string, unknown>): string;
  res: http.ServerResponse;
  url: URL;
  /** Grupos capturados pela expressão da rota. */
  params: string[];
  app: App;
  /** Corpo JSON (limite de 2 MB). */
  body(): Promise<Record<string, any>>;
  /** Corpo bruto (upload de arquivo). */
  raw(limit: number): Promise<Buffer>;
}

/** [método, caminho, função]. A função devolve o JSON da resposta (ou responde sozinha e devolve undefined). */
export type Route = [method: string, pattern: RegExp, handler: (c: Ctx) => unknown];

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string, extra: http.OutgoingHttpHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...extra,
  });
  res.end(body);
}

export const sendJson = (res: http.ServerResponse, data: unknown, status = 200) => send(res, status, JSON.stringify(data), CONTENT_TYPES[".json"]);

export async function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new HttpError(413, "Arquivo grande demais (máximo {mb} MB).", { mb: Math.round(limit / 1_000_000) });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: http.IncomingMessage): Promise<Record<string, any>> {
  const buf = await readRaw(req, 2_000_000);
  if (!buf.length) return {};
  try {
    const data = JSON.parse(buf.toString("utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

export function serveFile(res: http.ServerResponse, file: string) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, "Arquivo não encontrado.");
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  send(res, 200, fs.readFileSync(file), type, { "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` });
}

export const inside = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/** Link /files/... para um arquivo dentro de output/ (a página em http:// não abre file://). */
export function fileUrl(abs?: string): string | undefined {
  if (!abs || !fs.existsSync(abs) || !inside(abs, paths.outputDir)) return undefined;
  return "/files/" + path.relative(paths.outputDir, abs).split(path.sep).map(encodeURIComponent).join("/");
}

export const isHttp = (u?: string) => Boolean(u && /^https?:\/\//i.test(u));

/** Lista de textos vinda do formulário: sem vazios, sem repetidos, com limite. */
export function strList(v: unknown, opts: { max?: number; lower?: boolean } = {}): string[] {
  if (!Array.isArray(v)) return [];
  const out = v.map((x) => String(x ?? "").trim()).filter(Boolean).map((x) => (opts.lower ? x.toLowerCase() : x));
  return [...new Set(out)].slice(0, opts.max ?? 80);
}

export const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

export function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
