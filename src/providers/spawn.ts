import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";

/** Procura um executável no PATH (sem rodar nada). Devolve o caminho completo ou null. */
export function which(bin: string): string | null {
  if (path.isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) return fs.existsSync(bin) ? bin : null;
  const exts = IS_WIN ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").toLowerCase().split(";"), ".ps1"] : [""];
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  // Instalações comuns que nem sempre estão no PATH de terminais já abertos.
  const home = os.homedir();
  dirs.push(path.join(home, ".local", "bin"), path.join(home, ".claude", "local"));
  if (IS_WIN && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* não existe */
      }
    }
  }
  return null;
}

/**
 * No Windows, CLIs instaladas via npm são atalhos .cmd/.ps1 que o Node não executa sem shell.
 * Em vez de passar pelo cmd.exe (e brigar com aspas), lemos o atalho e rodamos `node <script.js>`.
 */
export function resolveCommand(bin: string): { command: string; prefix: string[]; shell: boolean } {
  const found = which(bin) ?? bin;
  if (!IS_WIN) return { command: found, prefix: [], shell: false };
  const ext = path.extname(found).toLowerCase();
  if (ext === ".cmd" || ext === ".bat" || ext === ".ps1") {
    try {
      const shim = fs.readFileSync(found, "utf8");
      const m = shim.match(/["']?(?:%~?dp0%?|\$basedir)[\\/]+([^"'\s]+\.(?:c|m)?js)["']?/i);
      if (m) {
        const script = path.resolve(path.dirname(found), m[1].replace(/\\/g, path.sep));
        if (fs.existsSync(script)) return { command: process.execPath, prefix: [script], shell: false };
      }
    } catch {
      /* cai no shell */
    }
    return { command: found, prefix: [], shell: true };
  }
  return { command: found, prefix: [], shell: false };
}

const quoteForCmd = (a: string) => (/^[\w\-.,:=/\\@]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

export interface CliRun {
  bin: string;
  args: string[];
  stdin?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Nome amigável para mensagens de erro. */
  name: string;
  installHint: string;
}

/** Roda uma CLI de IA e devolve stdout/stderr. Lança erro com dica de instalação se não achar o binário. */
export function runCli(run: CliRun): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const { command, prefix, shell } = resolveCommand(run.bin);
  const args = [...prefix, ...run.args];
  const timeoutMs = run.timeoutMs ?? 900_000;
  return new Promise((resolve, reject) => {
    const opts = { cwd: run.cwd, env: { ...process.env, ...run.env }, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"], windowsHide: true };
    // Último recurso (atalho .cmd que não deu para ler): uma linha de comando única pelo cmd.exe.
    const child = shell
      ? spawn([command, ...args].map(quoteForCmd).join(" "), { ...opts, shell: true })
      : spawn(command, args, opts);
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${run.name} excedeu ${Math.round(timeoutMs / 60000)} min`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Não consegui executar '${run.bin}' (${e.message}). ${run.installHint}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code });
    });
    child.stdin.on("error", () => {
      /* processo fechou antes de ler tudo: o erro aparece no close */
    });
    child.stdin.end(run.stdin ?? "", "utf8");
  });
}

/** Pasta vazia e isolada para as CLIs rodarem (sem AGENTS.md/CLAUDE.md/GEMINI.md do projeto). */
export function isolatedDir(name: string): string {
  const dir = path.join(os.tmpdir(), `ajf-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Arquivo temporário apagado depois do uso. */
export function tempFile(dir: string, prefix: string, ext: string, content?: string): string {
  const file = path.join(dir, `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
  if (content != null) fs.writeFileSync(file, content);
  return file;
}
