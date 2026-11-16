import fs from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { searchJobs, searchSummary } from "./jobs/search.js";
import { triageJobs } from "./jobs/triage.js";
import { canWebSearch } from "./llm.js";
import { loadPreferences, type AutoSearch, type Preferences } from "./profile.js";
import { installSchedule, removeSchedule, runCommand, schedulerKind, type Runner, type ScheduleSpec, type SchedulerKind } from "./scheduler.js";

/**
 * Busca automática: a mesma busca do botão "Buscar vagas" (e a triagem, se ligada), disparada sozinha.
 * - Ao abrir o app (`dueOnOpen`), se a última busca automática tem mais de `onOpenHours`.
 * - Todo dia num horário, pelo agendador do sistema (src/scheduler.ts), que roda `ajf rotina --agendada`.
 * Chegar cedo pesa no resultado da candidatura (ver docs/how-it-works.md, "Research behind the features").
 */

export type RoutineTrigger = "agenda" | "abrir" | "manual";

export interface RoutineRun {
  at: string;
  trigger: RoutineTrigger;
  ok: boolean;
  /** Vagas novas salvas. */
  added: number;
  /** Recomendadas pela triagem. */
  recommended: number;
  summary: string;
  errors: string[];
}

export interface RoutineState {
  /** A busca diária no agendador do sistema, como foi criada pelo app. */
  schedule?: { kind: SchedulerKind; time: string; at: string };
  /** Últimas buscas automáticas, da mais nova para a mais antiga. */
  runs: RoutineRun[];
}

const stateFile = () => path.join(paths.dataDir, "busca_automatica.json");
export const routineLogFile = () => path.join(paths.dataDir, "busca_automatica.log");

export function loadRoutineState(): RoutineState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return { schedule: raw.schedule, runs: Array.isArray(raw.runs) ? raw.runs : [] };
  } catch {
    return { runs: [] };
  }
}

function saveRoutineState(state: RoutineState) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

/** A busca ao abrir o app está na hora? (Ligada, e a última busca automática é mais velha que `onOpenHours`.) */
export function dueOnOpen(auto: AutoSearch, last: RoutineRun | null, now = Date.now()): boolean {
  if (!auto.onOpen) return false;
  if (!last) return true;
  const hours = Math.max(1, auto.onOpenHours || 12);
  return now - Date.parse(last.at) >= hours * 3_600_000;
}

/** Roda a busca automática e guarda o resultado (data/busca_automatica.json e o log). */
export async function runRoutine(trigger: RoutineTrigger, prefs: Preferences = loadPreferences()): Promise<RoutineRun> {
  const run: RoutineRun = { at: new Date().toISOString(), trigger, ok: true, added: 0, recommended: 0, summary: "", errors: [] };
  try {
    const s = await searchJobs({ web: prefs.autoSearch.web && canWebSearch() });
    run.added = s.added.length;
    run.summary = searchSummary(s);
    run.errors = s.errors;
    if (prefs.autoSearch.triage && s.added.length) {
      const done = await triageJobs();
      run.recommended = done.filter((j) => j.status === "shortlisted").length;
    }
  } catch (e) {
    run.ok = false;
    run.errors.push((e as Error).message);
  }
  const state = loadRoutineState();
  state.runs = [run, ...state.runs].slice(0, 20);
  saveRoutineState(state);
  fs.appendFileSync(
    routineLogFile(),
    `[${run.at}] ${trigger}: ${run.ok ? `${run.added} nova(s), ${run.recommended} recomendada(s). ${run.summary}` : "falhou"}${run.errors.length ? ` | ${run.errors.join(" | ")}` : ""}\n`,
  );
  return run;
}

/** O comando que o agendador roda: o Node desta máquina, o bin/ajf.mjs deste projeto e a pasta de dados atual. */
export function scheduleSpec(time: string): ScheduleSpec {
  return {
    time,
    home: paths.home,
    root: paths.root,
    node: process.execPath,
    script: path.join(paths.root, "bin", "ajf.mjs"),
    log: routineLogFile(),
    pathEnv: process.env.PATH ?? "",
  };
}

/**
 * Deixa o agendador do sistema igual às preferências: cria, troca o horário ou tira a busca diária.
 * `force` recria mesmo sem mudança (depois de trocar a versão do Node ou mover o projeto, por exemplo).
 */
export function syncSchedule(auto: AutoSearch, opts: { force?: boolean; run?: Runner; platform?: NodeJS.Platform } = {}): { kind: SchedulerKind | null; changed: boolean } {
  const run = opts.run ?? runCommand;
  const state = loadRoutineState();
  const current = state.schedule;
  if (!auto.daily) {
    if (!current) return { kind: null, changed: false };
    removeSchedule({ home: paths.home }, current.kind, run);
    delete state.schedule;
    saveRoutineState(state);
    return { kind: current.kind, changed: true };
  }
  const kind = current?.kind ?? schedulerKind(opts.platform ?? process.platform, run);
  if (!kind) throw new Error("Não achei um agendador neste sistema (systemd ou crontab). Use a busca ao abrir o app.");
  if (current && current.kind === kind && current.time === auto.time && !opts.force) return { kind, changed: false };
  installSchedule(scheduleSpec(auto.time), kind, run);
  state.schedule = { kind, time: auto.time, at: new Date().toISOString() };
  saveRoutineState(state);
  return { kind, changed: true };
}
