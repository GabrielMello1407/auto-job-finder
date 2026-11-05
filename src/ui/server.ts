import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../config.js";
import { writeDashboard } from "../dashboard.js";
import { closeBrowser } from "../render/pdf.js";
import { openExternal } from "../util/open.js";
import { CONTENT_TYPES, HttpError, inside, readJson, readRaw, send, sendJson, serveFile, type App, type Ctx, type Route } from "./http.js";
import { jobRoutes } from "./routes/jobs.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { profileRoutes } from "./routes/profile.js";
import { TaskQueue } from "./tasks.js";

/**
 * Interface local: servidor HTTP só em 127.0.0.1 que serve a página (src/ui/public) e uma API JSON
 * com as mesmas ações do menu do terminal. Só aceita quem abriu pelo link com o token secreto
 * (vira um cookie SameSite=Strict), para nenhum site aberto no navegador conseguir disparar ações.
 */

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const STATIC = /^\/(app\.css|js\/[\w-]+\.js)$/;

const FORBIDDEN_PAGE = `<!doctype html><meta charset="utf-8"><title>auto-job-finder</title>
<body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px">
<h1>Abra pelo terminal</h1><p>Por segurança, a interface só abre pelo link que o comando <code>ajf</code> mostra no terminal.
Rode <code>ajf</code> de novo para abrir.</p></body>`;

export interface UiOptions {
  port?: number;
  open?: boolean;
}

export async function startUi(opts: UiOptions = {}) {
  const token = crypto.randomBytes(24).toString("hex");
  // O Chrome do PDF é um só: fecha entre tarefas (inclusive quando uma falha no meio e não fecha sozinha).
  const queue = new TaskQueue(closeBrowser);
  const clients = new Set<(event: string, data: unknown) => void>();
  let allowedHosts = new Set<string>();
  // Cookies não separam por porta: com dois `ajf` abertos, cada um precisa do seu nome de cookie.
  let COOKIE = "ajf_ui";

  const app: App = {
    queue,
    broadcast: (event, data) => clients.forEach((push) => push(event, data)),
    jobsChanged(jobId) {
      try {
        writeDashboard();
      } catch {
        /* painel.html é opcional */
      }
      app.broadcast("jobs", { jobId });
    },
  };
  queue.on("tasks", (list) => app.broadcast("tasks", list));
  queue.on("finished", (_kind, jobId) => app.jobsChanged(jobId));

  const routes: Route[] = [...jobRoutes(app), ...profileRoutes(app), ...preferenceRoutes()];

  const cookieToken = (req: http.IncomingMessage) =>
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .find(([k]) => k === COOKIE)?.[1];
  const sameToken = (t?: string) => Boolean(t && t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token)));

  async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = req.headers.host ?? "";
    if (!allowedHosts.has(host)) return send(res, 421, "Host não permitido.", "text/plain; charset=utf-8");
    const url = new URL(req.url ?? "/", `http://${host}`);
    const method = req.method ?? "GET";

    // Primeiro acesso pelo link do terminal: troca o token da URL por um cookie e limpa a URL.
    const t = url.searchParams.get("t");
    if (url.pathname === "/" && t) {
      if (!sameToken(t)) return send(res, 403, FORBIDDEN_PAGE, CONTENT_TYPES[".html"]);
      return send(res, 302, "", "text/plain", { "Set-Cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: "/" });
    }
    if (!sameToken(cookieToken(req))) return send(res, 403, FORBIDDEN_PAGE, CONTENT_TYPES[".html"]);
    if (method !== "GET") {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${host}`) throw new HttpError(403, "Origem não permitida.");
    }

    const p = url.pathname;
    if (method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
    if (method === "GET" && STATIC.test(p)) return serveFile(res, path.join(PUBLIC_DIR, ...p.slice(1).split("/")));

    if (method === "GET" && p.startsWith("/files/")) {
      let rel: string;
      try {
        rel = p.slice("/files/".length).split("/").map(decodeURIComponent).join(path.sep);
      } catch {
        throw new HttpError(400, "Caminho inválido.");
      }
      const file = path.resolve(paths.outputDir, rel);
      if (!inside(file, paths.outputDir)) throw new HttpError(403, "Fora da pasta output.");
      return serveFile(res, file);
    }

    if (method === "GET" && p === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      const push = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      push("tasks", queue.list());
      clients.add(push);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(push);
      });
      return;
    }

    for (const [m, pattern, handler] of routes) {
      if (m !== method) continue;
      const match = p.match(pattern);
      if (!match) continue;
      const ctx: Ctx = { req, res, url, params: match.slice(1), app, body: () => readJson(req), raw: (limit) => readRaw(req, limit) };
      const data = await handler(ctx);
      if (data !== undefined && !res.headersSent) sendJson(res, data);
      return;
    }
    throw new HttpError(404, "Não encontrado.");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, { error: e instanceof Error ? e.message : String(e) }, status);
      else res.end();
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    const tryPort = (n: number) => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && n !== 0) tryPort(0);
        else reject(e);
      });
      server.listen(n, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    };
    tryPort(opts.port ?? Number(process.env.AJF_UI_PORT || 4317));
  });
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  COOKIE = `ajf_ui_${port}`;

  const link = `http://127.0.0.1:${port}/?t=${token}`;
  console.log(`\n🖥  Interface aberta no navegador: ${link}`);
  console.log("   Deixe este terminal aberto enquanto usa. Para fechar: Ctrl+C.\n");
  if (opts.open !== false) openExternal(link);

  const stop = () => {
    app.broadcast("bye", {});
    server.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return { url: link, port, close: () => server.close() };
}
