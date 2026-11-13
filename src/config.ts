import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/** Pasta do código (não depende da pasta onde o comando foi chamado). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

/**
 * Pasta de trabalho: perfil, vagas e pacotes gerados de UMA pessoa.
 * Padrão: a própria pasta do projeto. Para manter vários perfis (ou instalar o agente globalmente),
 * defina AJF_HOME=/caminho/da/pasta no .env ou no ambiente.
 */
const HOME = process.env.AJF_HOME ? path.resolve(ROOT, process.env.AJF_HOME) : ROOT;
if (HOME !== ROOT) dotenv.config({ path: path.join(HOME, ".env"), quiet: true });

export const paths = {
  root: ROOT,
  home: HOME,
  envFile: path.join(HOME, ".env"),
  profileDir: path.join(HOME, "profile"),
  profileTruth: path.join(HOME, "profile", "profile_truth.md"),
  baseResume: (lang: "pt-BR" | "en") =>
    path.join(HOME, "profile", lang === "en" ? "base_resume.en.json" : "base_resume.pt.json"),
  preferences: path.join(HOME, "profile", "preferences.json"),
  rules: path.join(HOME, "profile", "rules.json"),
  excluded: path.join(HOME, "profile", "excluded.md"),
  /** Texto extraído das fontes do perfil (currículo, LinkedIn, portfólio, respostas). */
  sourcesDir: path.join(HOME, "profile", "sources"),
  dataDir: path.join(HOME, "data"),
  jobsDb: path.join(HOME, "data", "jobs.json"),
  usageLog: path.join(HOME, "data", "usage.jsonl"),
  outputDir: path.join(HOME, "output"),
  tracker: path.join(HOME, "output", "tracker.csv"),
};

export const settings = {
  targetRating: Number(process.env.AJF_TARGET_RATING || 8.5),
  /** Nota final mínima para um pacote ser considerado "pronto para enviar". */
  minRating: Number(process.env.AJF_MIN_RATING || 7),
  /** Nota mínima da triagem (0–100) para o piloto automático gerar pacote. */
  minTriageScore: Number(process.env.AJF_MIN_TRIAGE_SCORE || 70),
  maxRevisions: Number(process.env.AJF_MAX_REVISIONS || 3),
  /**
   * Por quantos dias uma vaga igual (mesma empresa e cargo, em outro link) conta como repetida.
   * Depois disso, ou se ela foi publicada depois da sua candidatura, é uma vaga reaberta: entra normal.
   */
  repeatWindowDays: Number(process.env.AJF_REPEAT_WINDOW_DAYS || 90),
  /** Dias depois da candidatura (ou do último follow-up) para o próximo follow-up. */
  followUpDays: Number(process.env.AJF_FOLLOW_UP_DAYS || 7),
  /** Candidatura sem nenhuma resposta depois disso conta como "sem retorno" no funil. */
  noReplyDays: Number(process.env.AJF_NO_REPLY_DAYS || 30),
  /** Fallback server-side em caso de recusa do modelo (beta, só API Anthropic). Desligue com AJF_FALLBACKS=off. */
  fallbacks: (process.env.AJF_FALLBACKS || "on") !== "off",
  chromePath: process.env.CHROME_PATH || detectChrome(),
  userAgent: "auto-job-finder/0.2 (personal job search CLI)",
};

/** O perfil já foi configurado (ajf init)? */
export function hasProfile(): boolean {
  return fs.existsSync(paths.profileTruth) && fs.existsSync(paths.baseResume("pt-BR")) && fs.existsSync(paths.baseResume("en"));
}

/** Chrome, Edge, Chromium ou Brave (qualquer navegador Chromium serve para gerar o PDF). */
function detectChrome(): string | undefined {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const mac = (app: string, bin: string) => [`/Applications/${app}.app/Contents/MacOS/${bin}`, path.join(home, "Applications", `${app}.app`, "Contents", "MacOS", bin)];
  const candidates = [
    // Windows: instalação para todos e só para o usuário (comum sem permissão de administrador)
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    path.join(local, "Chromium", "Application", "chrome.exe"),
    // macOS: /Applications e ~/Applications
    ...mac("Google Chrome", "Google Chrome"),
    ...mac("Microsoft Edge", "Microsoft Edge"),
    ...mac("Chromium", "Chromium"),
    ...mac("Brave Browser", "Brave Browser"),
    // Linux (inclui o Chromium do snap, padrão no Ubuntu)
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/brave-browser",
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) return found;
  // Último recurso: o navegador está no PATH com outro caminho de instalação.
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser", "chrome", "msedge", "brave"];
  const exts = process.platform === "win32" ? [".exe"] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean))
    for (const name of names)
      for (const ext of exts) {
        const full = path.join(dir, name + ext);
        try {
          if (fs.statSync(full).isFile()) return full;
        } catch {
          /* não existe */
        }
      }
  return undefined;
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Grava/atualiza uma variável no .env da pasta de trabalho (e no processo atual). */
export function setEnvVar(key: string, value: string) {
  const file = paths.envFile;
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const line = `${key}=${value}`;
  const i = lines.findIndex((l) => new RegExp(`^\\s*#?\\s*${key}=`).test(l));
  if (i >= 0) lines[i] = line;
  else lines.push(line);
  fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
  process.env[key] = value;
}
