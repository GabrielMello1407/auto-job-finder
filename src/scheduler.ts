import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Busca automática diária no agendador do próprio sistema, para rodar com o app fechado:
 * - Windows: Agendador de Tarefas (`schtasks`, tarefa em XML com "rodar assim que possível" se o PC estava desligado);
 * - macOS: launchd (`~/Library/LaunchAgents`);
 * - Linux: timer do systemd do usuário (`Persistent=true` roda o atraso) ou, sem systemd, o crontab.
 * Os comandos rodam sem shell. O texto de cada agendador sai das funções puras abaixo, testadas sem mexer no sistema.
 */

export type SchedulerKind = "windows" | "launchd" | "systemd" | "cron";

export const SCHEDULER_LABELS: Record<SchedulerKind, string> = {
  windows: "Agendador de Tarefas do Windows",
  launchd: "launchd do macOS",
  systemd: "timer do systemd",
  cron: "crontab",
};

/** O que o agendador precisa para rodar `ajf rotina --agendada`. */
export interface ScheduleSpec {
  /** "HH:MM", 24 h. */
  time: string;
  /** AJF_HOME: a pasta dos dados da pessoa. */
  home: string;
  /** Pasta do projeto (onde fica bin/ajf.mjs). */
  root: string;
  /** Caminho completo do Node. */
  node: string;
  /** bin/ajf.mjs. */
  script: string;
  /** Arquivo de log da busca automática. */
  log: string;
  /** PATH da sessão atual (para achar as CLIs de IA). */
  pathEnv: string;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** O programa não existe nesta máquina. */
  missing?: boolean;
}
export type Runner = (cmd: string, args: string[], input?: string) => CommandResult;

/** Roda um programa sem shell (nada é interpretado: caminhos com espaço ou aspas vão como estão). */
export const runCommand: Runner = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const err = r.error as NodeJS.ErrnoException | undefined;
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", missing: err?.code === "ENOENT" };
};

/** "08:00" → { h: 8, m: 0 }; inválido → null. */
export function parseTime(time: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? { h, m: min } : null;
}
const two = (n: number) => String(n).padStart(2, "0");

/** Identificador estável por pasta de dados: duas pastas (AJF_HOME) não brigam pelo mesmo agendamento. */
export const scheduleId = (home: string) => crypto.createHash("sha1").update(path.resolve(home).toLowerCase()).digest("hex").slice(0, 8);

/** Qual agendador usar nesta máquina (null: nenhum disponível). */
export function schedulerKind(platform: NodeJS.Platform = process.platform, run: Runner = runCommand): SchedulerKind | null {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "launchd";
  const systemd = run("systemctl", ["--user", "show-environment"]);
  if (!systemd.missing && systemd.code === 0) return "systemd";
  const cron = run("crontab", ["-l"]);
  return cron.missing ? null : "cron";
}

/* ------------------------------------------------------------------ Windows */

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Texto entre aspas simples no PowerShell. */
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function windowsTask(spec: ScheduleSpec): { name: string; xml: string } {
  const t = parseTime(spec.time)!;
  const name = `\\auto-job-finder\\busca-diaria-${scheduleId(spec.home)}`;
  // PowerShell só para definir AJF_HOME e esconder a janela; o próprio ajf escreve o log (sem a codificação do PowerShell).
  const command = `$env:AJF_HOME=${psQuote(spec.home)}; & ${psQuote(spec.node)} ${psQuote(spec.script)} rotina --agendada`;
  const args = `-NoProfile -NonInteractive -WindowStyle Hidden -Command "${command}"`;
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>auto-job-finder: busca diária de vagas</Description></RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T${two(t.h)}:${two(t.m)}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>${xmlEsc(args)}</Arguments>
      <WorkingDirectory>${xmlEsc(spec.root)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
  return { name, xml };
}

/* ------------------------------------------------------------------ macOS */

export function launchdAgent(spec: ScheduleSpec, homeDir = os.homedir()): { label: string; file: string; plist: string } {
  const t = parseTime(spec.time)!;
  const label = `com.auto-job-finder.busca.${scheduleId(spec.home)}`;
  const s = (v: string) => `<string>${xmlEsc(v)}</string>`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${s(label)}
  <key>ProgramArguments</key>
  <array>${s(spec.node)}${s(spec.script)}${s("rotina")}${s("--agendada")}</array>
  <key>EnvironmentVariables</key>
  <dict><key>AJF_HOME</key>${s(spec.home)}<key>PATH</key>${s(spec.pathEnv)}</dict>
  <key>WorkingDirectory</key>${s(spec.root)}
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${t.h}</integer><key>Minute</key><integer>${t.m}</integer></dict>
  <key>StandardOutPath</key>${s(spec.log)}
  <key>StandardErrorPath</key>${s(spec.log)}
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`;
  return { label, file: path.join(homeDir, "Library", "LaunchAgents", `${label}.plist`), plist };
}

/* ------------------------------------------------------------------ Linux */

/** Valor entre aspas para o systemd (barra invertida e aspas escapadas). */
const sdQuote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function systemdUnits(spec: ScheduleSpec, homeDir = os.homedir()): { name: string; dir: string; service: string; timer: string } {
  const t = parseTime(spec.time)!;
  const name = `auto-job-finder-busca-${scheduleId(spec.home)}`;
  const service = `[Unit]
Description=auto-job-finder: busca diária de vagas

[Service]
Type=oneshot
WorkingDirectory=${spec.root}
Environment=${sdQuote(`AJF_HOME=${spec.home}`)}
Environment=${sdQuote(`PATH=${spec.pathEnv}`)}
ExecStart=${sdQuote(spec.node)} ${sdQuote(spec.script)} rotina --agendada
StandardOutput=append:${spec.log}
StandardError=append:${spec.log}
`;
  const timer = `[Unit]
Description=auto-job-finder: busca diária de vagas

[Timer]
OnCalendar=*-*-* ${two(t.h)}:${two(t.m)}:00
Persistent=true

[Install]
WantedBy=timers.target
`;
  return { name, dir: path.join(homeDir, ".config", "systemd", "user"), service, timer };
}

/** Texto entre aspas simples no sh. */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const cronMarker = (home: string) => `# auto-job-finder:${scheduleId(home)}`;

export function cronLine(spec: ScheduleSpec): string {
  const t = parseTime(spec.time)!;
  // No crontab, "%" vira quebra de linha: escapa.
  const cmd = `cd ${shQuote(spec.root)} && AJF_HOME=${shQuote(spec.home)} PATH=${shQuote(spec.pathEnv)} ${shQuote(spec.node)} ${shQuote(spec.script)} rotina --agendada >> ${shQuote(spec.log)} 2>&1`;
  return `${t.m} ${t.h} * * * ${cmd.replace(/%/g, "\\%")} ${cronMarker(spec.home)}`;
}

/** O crontab com a linha desta pasta trocada (ou removida, com `line` null); as outras linhas ficam. */
export function withCronLine(existing: string, home: string, line: string | null): string {
  const kept = existing.split(/\r?\n/).filter((l) => !l.includes(cronMarker(home)));
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  if (line) kept.push(line);
  return kept.length ? `${kept.join("\n")}\n` : "";
}

/* ------------------------------------------------------------- instalar e remover */

function must(r: CommandResult, what: string) {
  if (r.missing) throw new Error(`${what}: o programa não existe nesta máquina.`);
  if (r.code !== 0) throw new Error(`${what} falhou: ${(r.stderr || r.stdout).trim().slice(0, 300) || `código ${r.code}`}`);
}

function readCrontab(run: Runner): string {
  const r = run("crontab", ["-l"]);
  if (r.missing) throw new Error("crontab: o programa não existe nesta máquina.");
  // Sem crontab ainda, o `crontab -l` sai com erro ("no crontab for ..."): começa vazio.
  return r.code === 0 ? r.stdout : "";
}

/** Cria (ou troca) a busca diária no agendador do sistema. */
export function installSchedule(spec: ScheduleSpec, kind: SchedulerKind, run: Runner = runCommand, homeDir = os.homedir()): string {
  if (!parseTime(spec.time)) throw new Error(`Horário inválido: ${spec.time} (use HH:MM, por exemplo 08:00).`);
  fs.mkdirSync(path.dirname(spec.log), { recursive: true });
  if (kind === "windows") {
    const { name, xml } = windowsTask(spec);
    const file = path.join(path.dirname(spec.log), `busca_automatica_${scheduleId(spec.home)}.xml`);
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]));
    try {
      must(run("schtasks", ["/Create", "/TN", name, "/XML", file, "/F"]), "schtasks");
    } finally {
      fs.rmSync(file, { force: true });
    }
    return name;
  }
  if (kind === "launchd") {
    const { file, plist } = launchdAgent(spec, homeDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    run("launchctl", ["unload", file]);
    fs.writeFileSync(file, plist);
    must(run("launchctl", ["load", "-w", file]), "launchctl");
    return file;
  }
  if (kind === "systemd") {
    const { name, dir, service, timer } = systemdUnits(spec, homeDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.service`), service);
    fs.writeFileSync(path.join(dir, `${name}.timer`), timer);
    must(run("systemctl", ["--user", "daemon-reload"]), "systemctl");
    must(run("systemctl", ["--user", "enable", "--now", `${name}.timer`]), "systemctl");
    return `${name}.timer`;
  }
  const next = withCronLine(readCrontab(run), spec.home, cronLine(spec));
  must(run("crontab", ["-"], next), "crontab");
  return "crontab";
}

/** Tira a busca diária do agendador. Não reclama se ela já não existia. */
export function removeSchedule(spec: Pick<ScheduleSpec, "home">, kind: SchedulerKind, run: Runner = runCommand, homeDir = os.homedir()): void {
  if (kind === "windows") {
    const name = `\\auto-job-finder\\busca-diaria-${scheduleId(spec.home)}`;
    const r = run("schtasks", ["/Delete", "/TN", name, "/F"]);
    if (r.missing) throw new Error("schtasks: o programa não existe nesta máquina.");
    return;
  }
  if (kind === "launchd") {
    const file = path.join(homeDir, "Library", "LaunchAgents", `com.auto-job-finder.busca.${scheduleId(spec.home)}.plist`);
    run("launchctl", ["unload", "-w", file]);
    fs.rmSync(file, { force: true });
    return;
  }
  if (kind === "systemd") {
    const name = `auto-job-finder-busca-${scheduleId(spec.home)}`;
    const dir = path.join(homeDir, ".config", "systemd", "user");
    run("systemctl", ["--user", "disable", "--now", `${name}.timer`]);
    fs.rmSync(path.join(dir, `${name}.timer`), { force: true });
    fs.rmSync(path.join(dir, `${name}.service`), { force: true });
    run("systemctl", ["--user", "daemon-reload"]);
    return;
  }
  const current = readCrontab(run);
  const next = withCronLine(current, spec.home, null);
  if (next !== current) must(run("crontab", ["-"], next), "crontab");
}
