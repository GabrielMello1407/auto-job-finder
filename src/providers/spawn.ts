import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";

/** Pastas onde as CLIs costumam ficar mesmo quando não estão no PATH deste processo. */
function commonDirs(): string[] {
  const env = process.env;
  const home = os.homedir();
  const dirs = [
    path.dirname(process.execPath), // npm -g com nvm/fnm/volta instala ao lado do node em uso
    path.join(home, ".local", "bin"), // instalador nativo do Claude Code (Windows, macOS e Linux)
    path.join(home, ".claude", "local"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".bun", "bin"),
  ];
  for (const v of [env.NVM_BIN, env.PNPM_HOME]) if (v) dirs.push(v);
  if (env.npm_config_prefix) dirs.push(IS_WIN ? env.npm_config_prefix : path.join(env.npm_config_prefix, "bin"));
  if (IS_WIN) {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"), path.join(env.LOCALAPPDATA, "pnpm"));
    if (env.NVM_SYMLINK) dirs.push(env.NVM_SYMLINK);
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", path.join(home, "Library", "pnpm"), path.join(home, ".local", "share", "pnpm"));
  }
  return dirs;
}

let freshPath: string[] | undefined;

/**
 * PATH atual do usuário, lido fora deste processo: o terminal (ou a IDE) pode ter sido aberto antes da
 * instalação, ou não carregar o perfil do shell (nvm, asdf, Homebrew). Roda uma vez e fica em cache.
 */
function userPathDirs(): string[] {
  if (freshPath) return freshPath;
  freshPath = [];
  try {
    if (IS_WIN) {
      const reg = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
      for (const key of ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"]) {
        const r = spawnSync(reg, ["query", key, "/v", "Path"], { encoding: "utf8", timeout: 4000, windowsHide: true });
        const m = r.stdout?.match(/\bPath\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
        if (m) freshPath.push(...m[1].trim().split(";").map((d) => d.replace(/%([^%]+)%/g, (all, v) => process.env[v] ?? all)));
      }
    } else {
      const shell = process.env.SHELL || "/bin/sh";
      const r = spawnSync(shell, ["-ilc", `printf '__AJF__%s__AJF__' "$PATH"`], { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
      const m = r.stdout?.match(/__AJF__(.*?)__AJF__/s);
      if (m) freshPath.push(...m[1].split(":"));
    }
  } catch {
    /* sem shell ou sem reg.exe: fica só com o que já foi procurado */
  }
  freshPath = freshPath.filter(Boolean);
  return freshPath;
}

function findIn(dirs: string[], bin: string): string | null {
  // No Windows, o arquivo sem extensão que o npm cria é um script sh que o Windows não executa: só serve com extensão.
  const exts = IS_WIN && !path.extname(bin) ? [...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").toLowerCase().split(";").filter(Boolean), ".ps1"] : [""];
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
 * Procura um executável (sem rodar o executável). Ordem: PATH deste processo, pastas de instalação comuns
 * e, por último, o PATH atual do usuário (registro do Windows ou shell de login). Devolve o caminho completo ou null.
 */
export function which(bin: string): string | null {
  if (path.isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) {
    const full = path.resolve(bin);
    return findIn([path.dirname(full)], path.basename(full));
  }
  const envDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return findIn([...envDirs, ...commonDirs()], bin) ?? findIn(userPathDirs(), bin);
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
