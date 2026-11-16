import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { paths } from "../src/config.js";
import { boardFromUrl, companyKey, follow, isFollowed, sameCompany, unfollow } from "../src/jobs/follow.js";
import { extractJobLinks, looksLikeJob, unwrapLink } from "../src/jobs/links.js";
import { jobPageMeta } from "../src/jobs/page.js";
import { priorityOf } from "../src/jobs/priority.js";
import { statusAfterTriage } from "../src/jobs/triage.js";
import { DEFAULT_PREFERENCES, type AutoSearch, type Preferences } from "../src/profile.js";
import { dueOnOpen, loadRoutineState, syncSchedule } from "../src/routine.js";
import {
  cronLine,
  installSchedule,
  launchdAgent,
  parseTime,
  removeSchedule,
  scheduleId,
  schedulerKind,
  systemdUnits,
  windowsTask,
  withCronLine,
  type CommandResult,
  type Runner,
  type ScheduleSpec,
} from "../src/scheduler.js";
import type { Job } from "../src/schemas.js";

/* ------------------------------ busca automática: agendador de cada sistema ------------------------------ */

const spec = (extra: Partial<ScheduleSpec> = {}): ScheduleSpec => ({
  time: "08:30",
  home: "/home/ana/ajf dados",
  root: "/opt/auto-job-finder",
  node: "/usr/local/bin/node",
  script: "/opt/auto-job-finder/bin/ajf.mjs",
  log: "/home/ana/ajf dados/data/busca_automatica.log",
  pathEnv: "/usr/local/bin:/usr/bin",
  ...extra,
});

/** Runner falso: grava as chamadas e responde conforme `answers` (por programa). */
function fakeRunner(answers: Record<string, Partial<CommandResult>> = {}) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const run: Runner = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    return { code: 0, stdout: "", stderr: "", ...answers[cmd] };
  };
  return { run, calls };
}

test("agendador: horário, identificador e qual agendador cada sistema usa", () => {
  assert.deepEqual(parseTime("08:30"), { h: 8, m: 30 });
  assert.deepEqual(parseTime("7:05"), { h: 7, m: 5 });
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("8h"), null);
  assert.equal(scheduleId("/a/b"), scheduleId("/a/b"));
  assert.notEqual(scheduleId("/a/b"), scheduleId("/a/c"), "duas pastas de dados, dois agendamentos");

  assert.equal(schedulerKind("win32"), "windows");
  assert.equal(schedulerKind("darwin"), "launchd");
  assert.equal(schedulerKind("linux", fakeRunner().run), "systemd");
  assert.equal(schedulerKind("linux", fakeRunner({ systemctl: { missing: true } }).run), "cron");
  assert.equal(schedulerKind("linux", fakeRunner({ systemctl: { code: 1 } }).run), "cron", "sem sessão do systemd");
  assert.equal(schedulerKind("linux", fakeRunner({ systemctl: { missing: true }, crontab: { missing: true } }).run), null);
});

test("agendador: o texto de cada sistema, com caminhos que têm espaço, aspas e &", () => {
  const win = windowsTask(spec({ home: "C:\\Users\\O'Neil & Cia\\ajf", node: "C:\\Program Files\\nodejs\\node.exe", script: "C:\\ajf\\bin\\ajf.mjs", root: "C:\\ajf" }));
  assert.match(win.name, /^\\auto-job-finder\\busca-diaria-[0-9a-f]{8}$/);
  assert.match(win.xml, /<StartBoundary>2026-01-01T08:30:00<\/StartBoundary>/);
  assert.match(win.xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/, "PC desligado no horário: roda quando ligar");
  assert.match(win.xml, /<Command>powershell\.exe<\/Command>/);
  assert.match(win.xml, /\$env:AJF_HOME='C:\\Users\\O''Neil &amp; Cia\\ajf'/, "aspas simples dobradas e & escapado no XML");
  assert.match(win.xml, /-WindowStyle Hidden/);
  assert.match(win.xml, /rotina --agendada/);

  const mac = launchdAgent(spec({ home: "/Users/ana/R&D" }), "/Users/ana");
  assert.equal(mac.file, path.join("/Users/ana", "Library", "LaunchAgents", `${mac.label}.plist`));
  assert.match(mac.plist, /<key>Hour<\/key><integer>8<\/integer><key>Minute<\/key><integer>30<\/integer>/);
  assert.match(mac.plist, /<string>rotina<\/string><string>--agendada<\/string>/);
  assert.match(mac.plist, /<string>\/Users\/ana\/R&amp;D<\/string>/);

  const sd = systemdUnits(spec({ time: "7:05", node: '/opt/node "v22"/bin/node' }), "/home/ana");
  assert.equal(sd.dir, path.join("/home/ana", ".config", "systemd", "user"));
  assert.match(sd.timer, /OnCalendar=\*-\*-\* 07:05:00/);
  assert.match(sd.timer, /Persistent=true/, "roda o atraso se o PC estava desligado");
  assert.match(sd.service, /ExecStart="\/opt\/node \\"v22\\"\/bin\/node" "\/opt\/auto-job-finder\/bin\/ajf\.mjs" rotina --agendada/);
  assert.match(sd.service, /Environment="AJF_HOME=\/home\/ana\/ajf dados"/);

  const line = cronLine(spec({ home: "/home/ana/it's 100%" }));
  assert.match(line, /^30 8 \* \* \* /);
  assert.match(line, /AJF_HOME='\/home\/ana\/it'\\''s 100\\%'/, "aspas do sh e % escapado para o cron");
  assert.match(line, /# auto-job-finder:[0-9a-f]{8}$/);
});

test("agendador: o crontab troca só a linha desta pasta", () => {
  const home = "/home/ana/ajf";
  const mine = cronLine(spec({ home }));
  const other = "0 3 * * * /usr/bin/backup";
  const first = withCronLine(`${other}\n`, home, mine);
  assert.equal(first, `${other}\n${mine}\n`);
  const moved = cronLine(spec({ home, time: "09:00" }));
  assert.equal(withCronLine(first, home, moved), `${other}\n${moved}\n`, "trocou o horário, sem duplicar");
  assert.equal(withCronLine(first, home, null), `${other}\n`, "tirou só a nossa");
  assert.equal(withCronLine(mine, home, null), "");
});

test("agendador: cria e tira a busca em cada sistema, sem shell", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-sched-"));
  try {
    const s = spec({ home: tmp, log: path.join(tmp, "data", "busca_automatica.log") });

    const win = fakeRunner();
    installSchedule(s, "windows", win.run, tmp);
    assert.equal(win.calls[0].cmd, "schtasks");
    assert.deepEqual(win.calls[0].args.slice(0, 2), ["/Create", "/TN"]);
    const xmlFile = win.calls[0].args[win.calls[0].args.indexOf("/XML") + 1];
    assert.equal(fs.existsSync(xmlFile), false, "o XML temporário é apagado");
    removeSchedule(s, "windows", win.run, tmp);
    assert.deepEqual(win.calls[1].args.slice(0, 1), ["/Delete"]);

    const mac = fakeRunner();
    const plist = installSchedule(s, "launchd", mac.run, tmp);
    assert.ok(fs.existsSync(plist));
    assert.deepEqual(mac.calls.at(-1)!.args, ["load", "-w", plist]);
    removeSchedule(s, "launchd", mac.run, tmp);
    assert.equal(fs.existsSync(plist), false);

    const sd = fakeRunner();
    installSchedule(s, "systemd", sd.run, tmp);
    const { dir, name } = systemdUnits(s, tmp);
    assert.ok(fs.existsSync(path.join(dir, `${name}.timer`)));
    assert.deepEqual(sd.calls.at(-1)!.args, ["--user", "enable", "--now", `${name}.timer`]);
    removeSchedule(s, "systemd", sd.run, tmp);
    assert.equal(fs.existsSync(path.join(dir, `${name}.service`)), false);

    let crontab = "0 3 * * * /usr/bin/backup\n";
    const cron: Runner = (cmd, args, input) => {
      if (args[0] === "-l") return { code: 0, stdout: crontab, stderr: "" };
      crontab = input ?? "";
      return { code: 0, stdout: "", stderr: "" };
    };
    installSchedule(s, "cron", cron, tmp);
    assert.match(crontab, /backup\n30 8 \* \* \* .*rotina --agendada/);
    removeSchedule(s, "cron", cron, tmp);
    assert.equal(crontab, "0 3 * * * /usr/bin/backup\n");

    // Sem crontab ainda: começa vazio. Falha do programa vira erro legível.
    let empty = "";
    installSchedule(s, "cron", (cmd, args, input) => (args[0] === "-l" ? { code: 1, stdout: "", stderr: "no crontab for ana" } : ((empty = input ?? ""), { code: 0, stdout: "", stderr: "" })), tmp);
    assert.match(empty, /^30 8 \* \* \* /);
    assert.throws(() => installSchedule(s, "windows", fakeRunner({ schtasks: { code: 1, stderr: "Acesso negado." } }).run, tmp), /schtasks falhou: Acesso negado/);
    assert.throws(() => installSchedule({ ...s, time: "25:00" }, "cron", cron, tmp), /Horário inválido/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("busca automática: o agendador acompanha as preferências", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ajf-routine-"));
  const old = { dataDir: paths.dataDir, home: paths.home };
  Object.assign(paths, { dataDir: path.join(tmp, "data"), home: tmp });
  try {
    const auto = (extra: Partial<AutoSearch> = {}): AutoSearch => ({ ...DEFAULT_PREFERENCES.autoSearch, ...extra });
    let crontab = "";
    const calls: string[] = [];
    const run: Runner = (cmd, args, input) => {
      calls.push(`${cmd} ${args[0]}`);
      if (cmd === "systemctl") return { code: 0, stdout: "", stderr: "", missing: true };
      if (args[0] === "-l") return { code: 0, stdout: crontab, stderr: "" };
      crontab = input ?? "";
      return { code: 0, stdout: "", stderr: "" };
    };
    assert.deepEqual(syncSchedule(auto(), { run, platform: "linux" }), { kind: null, changed: false }, "desligada e nada agendado");
    assert.deepEqual(syncSchedule(auto({ daily: true, time: "07:00" }), { run, platform: "linux" }), { kind: "cron", changed: true });
    assert.match(crontab, /^0 7 \* \* \* /);
    assert.equal(loadRoutineState().schedule?.time, "07:00");
    assert.equal(syncSchedule(auto({ daily: true, time: "07:00" }), { run, platform: "linux" }).changed, false, "mesmo horário: não mexe");
    syncSchedule(auto({ daily: true, time: "09:15" }), { run, platform: "linux" });
    assert.match(crontab, /^15 9 \* \* \* /);
    assert.equal(crontab.split("\n").filter(Boolean).length, 1);
    assert.equal(syncSchedule(auto({ daily: false }), { run, platform: "linux" }).changed, true);
    assert.equal(crontab, "");
    assert.equal(loadRoutineState().schedule, undefined);
  } finally {
    Object.assign(paths, old);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("busca automática: ao abrir o app só quando ligada e a última é velha", () => {
  const NOW = Date.parse("2026-11-16T12:00:00Z");
  const auto = { ...DEFAULT_PREFERENCES.autoSearch, onOpen: true, onOpenHours: 12 };
  const run = (hoursAgo: number) => ({ at: new Date(NOW - hoursAgo * 3_600_000).toISOString(), trigger: "abrir" as const, ok: true, added: 0, recommended: 0, summary: "", errors: [] });
  assert.equal(dueOnOpen(auto, null, NOW), true, "nunca rodou");
  assert.equal(dueOnOpen(auto, run(13), NOW), true);
  assert.equal(dueOnOpen(auto, run(2), NOW), false);
  assert.equal(dueOnOpen({ ...auto, onOpen: false }, null, NOW), false, "desligada");
});

/* ---------------------------------- vários links de uma vez ---------------------------------- */

test("links: acha as vagas num e-mail de alerta e ignora o resto", () => {
  const email = `Novas vagas para você
Desenvolvedor Full Stack - Acme
https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&amp;refId=xyz
Engenheiro de Software - Beta (o mesmo, com outro rastreio)
https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=def
Back-end Node - Gama
https://br.indeed.com/rc/clk?jk=a1b2c3d4e5&from=ja&tk=xyz
Vaga na Gupy: https://empresa.gupy.io/jobs/9988776?jobBoardSource=gupy_public_page.
Página de carreira: https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F5551234&data=05
Ver todas: https://www.linkedin.com/jobs/search/?keywords=node
Cancelar alertas: https://www.linkedin.com/comm/psettings/job-alerts?unsubscribe=1
Logo: https://static.licdn.com/aero-v1/logo.png
Perfil: https://www.linkedin.com/in/ana-souza`;
  assert.deepEqual(extractJobLinks(email), [
    "https://linkedin.com/jobs/view/4012345678",
    "https://br.indeed.com/viewjob?jk=a1b2c3d4e5",
    "https://empresa.gupy.io/jobs/9988776",
    "https://boards.greenhouse.io/acme/jobs/5551234",
  ]);
  assert.equal(unwrapLink("https://www.google.com/url?q=https://jobs.lever.co/acme/123-abc&sa=D"), "https://jobs.lever.co/acme/123-abc");
  assert.equal(looksLikeJob("https://jobs.lever.co/acme"), false, "página da empresa, não uma vaga");
  assert.equal(looksLikeJob("https://jobs.ashbyhq.com/acme/0d6c-11"), true);
  assert.equal(looksLikeJob("https://jobs.workable.com/view/cfvXAfx/full-stack-developer"), true);
  assert.equal(looksLikeJob("https://apply.workable.com/acme/j/EAE33061D1/"), true);
  assert.equal(looksLikeJob("https://acme.com/careers/backend-engineer"), true);
  assert.equal(looksLikeJob("https://acme.com/sobre"), false);
  assert.equal(extractJobLinks(Array.from({ length: 40 }, (_, i) => `https://acme.com/jobs/vaga-${i}`).join("\n")).length, 30, "no máximo 30");
});

test("links: cargo, empresa e local vêm da página da vaga, não da primeira linha", () => {
  const ld = `<html><head><title>Voltar para vagas</title><script type="application/ld+json">{"@type":"JobPosting","title":"Engenheira de Software","hiringOrganization":{"name":"Acme Ltda"},"jobLocationType":"TELECOMMUTE","jobLocation":{"address":{"addressLocality":"Curitiba","addressCountry":"BR"}}}</script></head><body>Voltar para vagas</body></html>`;
  assert.deepEqual(jobPageMeta(ld, "https://job-boards.greenhouse.io/acme/jobs/1"), { title: "Engenheira de Software", company: "Acme Ltda", location: "Remoto · Curitiba, BR" });
  const li = `<h1 class="top-card-layout__title">Software Engineer</h1><a class="topcard__org-name-link" href="#">StompAI</a><span class="topcard__flavor topcard__flavor--bullet">Brazil</span><meta property="og:site_name" content="LinkedIn">`;
  assert.deepEqual(jobPageMeta(li, "https://www.linkedin.com/jobs/view/1"), { title: "Software Engineer", company: "StompAI", location: "Brazil" });
  // Sem dados estruturados: o cargo do título da página e a empresa do link.
  assert.deepEqual(jobPageMeta(`<title>Backend Developer - Rd Station</title>`, "https://jobs.lever.co/rd-station/abc"), { title: "Backend Developer", company: "Rd Station" });
  assert.deepEqual(jobPageMeta(`<meta property="og:site_name" content="Indeed"><title>Dev</title>`, "https://br.indeed.com/viewjob?jk=1"), { title: "Dev" }, "site de vagas não vira empresa");
});

/* ---------------------------------------- seguir empresa ---------------------------------------- */

test("seguir empresa: página de carreira pelo link, nome sem sufixo e prioridade", () => {
  assert.deepEqual(boardFromUrl("https://boards.greenhouse.io/acme/jobs/123"), { type: "greenhouse", id: "acme" });
  assert.deepEqual(boardFromUrl("https://job-boards.greenhouse.io/acme/jobs/123"), { type: "greenhouse", id: "acme" });
  assert.deepEqual(boardFromUrl("https://boards.greenhouse.io/embed/job_app?for=acme&token=1"), { type: "greenhouse", id: "acme" });
  assert.deepEqual(boardFromUrl("https://jobs.lever.co/Beta/abc-123"), { type: "lever", id: "beta" });
  assert.deepEqual(boardFromUrl("https://jobs.ashbyhq.com/gama/uuid"), { type: "ashby", id: "gama" });
  assert.equal(boardFromUrl("https://acme.gupy.io/jobs/1"), null);
  assert.equal(companyKey("Acme Inc."), "acme");
  assert.equal(sameCompany("ACME Ltda", "Acme"), true);
  assert.equal(sameCompany("Acme", "Acme Health"), false, "nome diferente não conta");

  const base: Preferences = { ...DEFAULT_PREFERENCES, companyBoards: { greenhouse: ["ja-tinha"], lever: [], ashby: [] }, defaultSources: ["remotive"] };
  const job = { company: "Acme Inc.", url: "https://boards.greenhouse.io/acme/jobs/123" };
  const on = follow(base, job);
  assert.deepEqual(on.followedCompanies, [{ name: "Acme Inc.", board: { type: "greenhouse", id: "acme" } }]);
  assert.deepEqual(on.companyBoards.greenhouse, ["ja-tinha", "acme"]);
  assert.ok(on.defaultSources.includes("greenhouse"), "a fonte é ligada");
  assert.equal(follow(on, job), on, "seguir de novo não duplica");
  const off = unfollow(on, "ACME");
  assert.deepEqual(off.followedCompanies, []);
  assert.deepEqual(off.companyBoards.greenhouse, ["ja-tinha"], "a página que a pessoa pôs à mão fica");
  const manual = follow({ ...base, companyBoards: { greenhouse: ["acme"], lever: [], ashby: [] } }, job);
  assert.deepEqual(manual.followedCompanies, [{ name: "Acme Inc." }], "página já monitorada: não anota para tirar depois");

  const NOW = Date.parse("2026-11-16T12:00:00Z");
  const j = { id: "a", source: "t", title: "Dev", company: "Acme", location: "", remote: true, url: "https://x/1", tags: [], description: "x".repeat(600), addedAt: new Date(NOW).toISOString(), status: "triaged", triage: { score: 70 } } as unknown as Job;
  assert.equal(priorityOf(j, NOW, on.followedCompanies) - priorityOf(j, NOW, []), 8);
  assert.equal(isFollowed("acme", on.followedCompanies), true);
});

test("triagem: vaga colada não é descartada sozinha", () => {
  assert.equal(statusAfterTriage("descartar", "remotive"), "discarded");
  assert.equal(statusAfterTriage("descartar", "manual"), "triaged");
  assert.equal(statusAfterTriage("descartar", "manual:linkedin"), "triaged");
  assert.equal(statusAfterTriage("candidatar", "manual"), "shortlisted");
  assert.equal(statusAfterTriage("decidir", "gupy"), "triaged");
});
