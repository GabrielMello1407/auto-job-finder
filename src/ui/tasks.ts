import { EventEmitter } from "node:events";

/**
 * Fila de tarefas longas da interface (busca, triagem, pacotes). Roda uma por vez: as tarefas usam a
 * mesma IA, o mesmo Chrome para PDF e o mesmo data/jobs.json. O que elas escrevem no terminal vira o log.
 */
export type TaskKind =
  | "auto"
  | "search"
  | "triage"
  | "research"
  | "check"
  | "tailor"
  | "interview"
  | "render"
  | "profile-read"
  | "profile-build"
  | "profile-update"
  | "profile-apply"
  | "rebuild-base"
  | "render-base"
  | "linkedin"
  | "linkedin-check";
export type TaskStatus = "queued" | "running" | "done" | "error";

export interface PublicTask {
  id: number;
  kind: TaskKind;
  label: string;
  jobId?: string;
  status: TaskStatus;
  log: string[];
  result?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

interface Task extends PublicTask {
  run: () => Promise<string | void>;
}

const MAX_LOG = 400;
const KEEP_FINISHED = 8;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

export class TaskQueue extends EventEmitter {
  private tasks: Task[] = [];
  private nextId = 1;
  private busy = false;

  /** `afterEach` roda (e é esperado) depois de cada tarefa, antes da próxima: ex.: fechar o Chrome do PDF. */
  constructor(private afterEach?: () => Promise<void>) {
    super();
  }

  /** Alguma tarefa rodando agora? */
  get running(): boolean {
    return this.busy;
  }

  list(): PublicTask[] {
    return this.tasks.map(({ run: _run, ...t }) => ({ ...t, log: [...t.log] }));
  }

  /** Já existe tarefa igual na fila ou rodando? (evita gerar o mesmo pacote duas vezes) */
  has(kind: TaskKind, jobId?: string): boolean {
    return this.tasks.some((t) => t.kind === kind && t.jobId === jobId && (t.status === "queued" || t.status === "running"));
  }

  add(kind: TaskKind, label: string, run: () => Promise<string | void>, jobId?: string): PublicTask {
    const task: Task = { id: this.nextId++, kind, label, jobId, status: "queued", log: [], run };
    this.tasks.push(task);
    this.changed();
    void this.pump();
    return this.list().find((t) => t.id === task.id)!;
  }

  /** Tira da fila uma tarefa que ainda não começou. */
  remove(id: number): boolean {
    const i = this.tasks.findIndex((t) => t.id === id && t.status === "queued");
    if (i < 0) return false;
    this.tasks.splice(i, 1);
    this.changed();
    return true;
  }

  /** Limpa as tarefas já terminadas. */
  clearFinished() {
    this.tasks = this.tasks.filter((t) => t.status === "queued" || t.status === "running");
    this.changed();
  }

  private changed() {
    this.emit("tasks", this.list());
  }

  private async pump() {
    if (this.busy) return;
    const task = this.tasks.find((t) => t.status === "queued");
    if (!task) return;
    this.busy = true;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.changed();

    const restore = this.capture(task);
    try {
      task.result = (await task.run()) || undefined;
      task.status = "done";
    } catch (e) {
      task.status = "error";
      task.error = e instanceof Error ? e.message : String(e);
    } finally {
      restore();
      await this.afterEach?.().catch(() => {});
      task.endedAt = new Date().toISOString();
      this.busy = false;
      this.prune();
      this.changed();
      this.emit("finished", task.kind, task.jobId);
      void this.pump();
    }
  }

  private prune() {
    const finished = this.tasks.filter((t) => t.status === "done" || t.status === "error");
    for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) this.tasks.splice(this.tasks.indexOf(old), 1);
  }

  /** Copia o que vai para o terminal (console.log, process.stdout.write) para o log da tarefa. */
  private capture(task: Task): () => void {
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    let partial = "";
    let pending: NodeJS.Timeout | undefined;
    const push = (chunk: unknown) => {
      const text = (partial + String(chunk)).replace(ANSI, "").replace(/\r(?!\n)/g, "\n");
      const lines = text.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) task.log.push(l);
      if (task.log.length > MAX_LOG) task.log.splice(0, task.log.length - MAX_LOG);
      // Agrupa várias linhas seguidas num único aviso para a interface.
      pending ??= setTimeout(() => {
        pending = undefined;
        this.changed();
      }, 150);
    };
    const wrap =
      (orig: typeof out) =>
      (chunk: any, ...rest: any[]): boolean => {
        push(chunk);
        return orig(chunk, ...rest);
      };
    process.stdout.write = wrap(out) as typeof process.stdout.write;
    process.stderr.write = wrap(err) as typeof process.stderr.write;
    return () => {
      process.stdout.write = out as typeof process.stdout.write;
      process.stderr.write = err as typeof process.stderr.write;
      if (partial.trim()) task.log.push(partial);
      if (pending) clearTimeout(pending);
    };
  }
}
