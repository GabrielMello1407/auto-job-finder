import fs from "node:fs";
import path from "node:path";
import { ensureDir, hasProfile, paths } from "../../config.js";
import { buildAndSaveProfile, interviewSource, saveSources, type InterviewAnswers, type ProfileChoices } from "../../onboarding/index.js";
import { readIntake, type Intake } from "../../onboarding/build.js";
import { LINKEDIN_EXPORT_HELP, readFileSource, readUrlSource, type SourceDoc } from "../../onboarding/sources.js";
import {
  applyProposal,
  discardProposal,
  loadProposal,
  proposalDiff,
  proposalOutdated,
  proposeProfileUpdate,
  rebuildBaseResumes,
} from "../../onboarding/update.js";
import { loadBaseResume, NON_EVIDENCE_HEADING } from "../../profile.js";
import { analyzeNumbers, bulletsWithoutNumbers, loadNumberHints, numbersNews, withHints } from "../../onboarding/numbers.js";
import { renderBaseResumes } from "../../render/base.js";
import { closeBrowser } from "../../render/pdf.js";
import { diffStats } from "../../util/diff.js";
import { fileUrl, HttpError, str, strList, type App, type Ctx, type Route } from "../http.js";
import type { TaskKind } from "../tasks.js";

/**
 * Perfil pela interface: montar (fontes → leitura pela IA → perguntas → montagem), atualizar com uma
 * novidade (proposta → antes e depois → aplicar), conferir e editar o profile_truth.md, refazer os
 * currículos-base e gerar os PDFs de conferência.
 */

const UPLOAD_LIMIT = 15_000_000;
const UPLOAD_EXT = /\.(pdf|docx|txt|md)$/i;

/** Salva um arquivo enviado pela interface em profile/entrada/ e devolve o caminho. */
export async function saveUpload(c: Ctx): Promise<string> {
  const name = path.basename(str(c.url.searchParams.get("name"), 160)).replace(/[^\w.\- ()À-ÿ]/g, "_");
  if (!UPLOAD_EXT.test(name)) throw new HttpError(400, "Use PDF, DOCX, TXT ou MD.");
  const buf = await c.raw(UPLOAD_LIMIT);
  if (!buf.length) throw new HttpError(400, "Arquivo vazio.");
  const dir = path.join(paths.profileDir, "entrada");
  ensureDir(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

async function readUploaded(c: Ctx): Promise<SourceDoc> {
  const file = await saveUpload(c);
  try {
    return await readFileSource(file);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

/** Rascunho do cadastro: fica na memória até o perfil ser montado. */
interface Draft {
  sources: SourceDoc[];
  intake: Intake | null;
}

function readBaseResume(): { name?: string; headline?: string; contact?: Record<string, string> } | null {
  try {
    return JSON.parse(fs.readFileSync(paths.baseResume("pt-BR"), "utf8"));
  } catch {
    return null;
  }
}

/** Itens pendentes da seção "A confirmar" do profile_truth.md (linhas "- [ ] ..."). */
export function pendingItems(truth: string): string[] {
  const section = truth.split(/^(?=## )/m).find((s) => /^## .*a confirmar/i.test(s));
  if (!section) return [];
  return [...section.matchAll(/^\s*-\s*\[ \]\s*(.+)$/gm)].map((m) => m[1].replace(/\*\*/g, "").trim());
}

function basePdfs() {
  const dir = path.join(paths.outputDir, "base");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => ({ name: f, url: fileUrl(path.join(dir, f))! }));
}

/** Tópicos sem número que a página mostra (e a IA analisa), dos cargos mais recentes primeiro. */
const NUMBERS_MAX = 12;
function safeNumbers() {
  try {
    return withHints(bulletsWithoutNumbers(loadBaseResume("pt-BR"), NUMBERS_MAX));
  } catch {
    return [];
  }
}
let analyzingNumbers: Promise<unknown> | null = null;

/** Seções obrigatórias: sem elas as travas perdem a base (ex.: "A confirmar", "Lacunas"). */
function checkTruth(text: string) {
  if (text.length < 200) throw new HttpError(400, "O texto ficou curto demais para ser o seu perfil.");
  const headings = text.match(/^## .+$/gm) ?? [];
  if (headings.length < 3) throw new HttpError(400, "Mantenha os títulos das seções (linhas que começam com '## ').");
}

export function profileRoutes(app: App): Route[] {
  const { queue } = app;
  const draft: Draft = { sources: [], intake: null };
  const draftView = () => ({
    sources: draft.sources.map((s, i) => ({ index: i, kind: s.kind, label: s.label, chars: s.text.length })),
    intake: draft.intake,
  });
  const addSource = (doc: SourceDoc) => {
    draft.sources.push(doc);
    draft.intake = null; // fontes mudaram: precisa ler de novo
    return draftView();
  };
  const busy = () => {
    if ((["profile-read", "profile-build", "profile-update", "profile-apply", "rebuild-base"] as TaskKind[]).some((k) => queue.has(k)))
      throw new HttpError(409, "O perfil já está sendo montado ou atualizado.");
  };

  /** Novidades para atualizar o perfil: ficam na memória até a proposta ser gerada. */
  let updateSources: SourceDoc[] = [];
  const updateView = () => {
    const p = loadProposal();
    const diff = p ? proposalDiff(p) : [];
    return {
      sources: updateSources.map((s, i) => ({ index: i, kind: s.kind, label: s.label, chars: s.text.length })),
      proposal: p && {
        createdAt: p.createdAt,
        sources: p.sources,
        changes: p.changes,
        toConfirm: p.toConfirm,
        outdated: proposalOutdated(p),
        stats: diffStats(diff),
        diff,
      },
    };
  };
  const addUpdateSource = (doc: SourceDoc) => {
    updateSources.push(doc);
    return updateView();
  };

  return [
    [
      "GET",
      /^\/api\/profile$/,
      () => {
        const exists = hasProfile();
        const truth = exists ? fs.readFileSync(paths.profileTruth, "utf8") : "";
        const base = exists ? readBaseResume() : null;
        return {
          hasProfile: exists,
          name: base?.name ?? "",
          headline: base?.headline ?? "",
          contact: base?.contact ?? {},
          truth,
          pending: pendingItems(truth),
          nonEvidence: truth
            .split(/^(?=## )/m)
            .map((s) => s.split("\n")[0].trim()) // trim: arquivos com quebra de linha do Windows (\r\n)
            .filter((h) => NON_EVIDENCE_HEADING.test(h))
            .map((h) => h.replace(/^## /, "")),
          basePdfs: basePdfs(),
          linkedinHelp: LINKEDIN_EXPORT_HELP,
          // Tópicos de experiência sem número, para a pessoa informar (Perfil → Números que faltam).
          numbers: exists ? safeNumbers() : [],
          draft: draftView(),
          update: exists ? updateView() : null,
        };
      },
    ],

    ["POST", /^\/api\/profile\/upload$/, async (c) => addSource(await readUploaded(c))],
    [
      "POST",
      /^\/api\/profile\/sources$/,
      async (c) => {
        const body = await c.body();
        try {
          if (body.type === "link") {
            try {
              return addSource(await readUrlSource(str(body.url, 1000)));
            } finally {
              // Sites em JavaScript abrem o Chrome: fecha, a não ser que uma tarefa esteja usando.
              if (!queue.running) await closeBrowser().catch(() => {});
            }
          }
          if (body.type === "text") {
            const text = str(body.text, 40_000);
            if (text.length < 40) throw new HttpError(400, "Cole um texto um pouco maior.");
            return addSource({ kind: "texto", label: "Texto colado", origin: "colado na interface", text });
          }
          if (body.type === "interview") {
            const doc = interviewSource((body.answers ?? {}) as InterviewAnswers, "interface");
            if (doc.text.length < 40) throw new HttpError(400, "Responda pelo menos algumas perguntas.");
            return addSource(doc);
          }
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        throw new HttpError(400, "Tipo de fonte desconhecido.");
      },
    ],
    [
      "DELETE",
      /^\/api\/profile\/sources\/(\d+)$/,
      (c) => {
        const i = Number(c.params[0]);
        if (!draft.sources[i]) throw new HttpError(404, "Fonte não encontrada.");
        draft.sources.splice(i, 1);
        draft.intake = null;
        return draftView();
      },
    ],

    [
      "POST",
      /^\/api\/profile\/read$/,
      (c) => {
        busy();
        if (!draft.sources.length) throw new HttpError(400, "Adicione pelo menos uma fonte.");
        const sources = [...draft.sources];
        return {
          task: queue.add("profile-read", c.t("Lendo suas fontes"), async () => {
            console.log(`Lendo ${sources.length} fonte(s) com a IA...`);
            const intake = await readIntake(sources);
            // Fontes mudaram enquanto a IA lia: essa leitura já não vale.
            const same = draft.sources.length === sources.length && sources.every((s, i) => draft.sources[i] === s);
            if (!same) throw new Error(c.t("As fontes mudaram durante a leitura. Clique em “Ler minhas fontes” de novo."));
            draft.intake = intake;
            app.broadcast("profile", {});
            return intake.questions.length ? c.t("{n} pergunta(s) para completar", { n: intake.questions.length }) : c.t("tudo entendido");
          }),
        };
      },
    ],

    [
      "POST",
      /^\/api\/profile\/build$/,
      async (c) => {
        busy();
        if (!draft.intake) throw new HttpError(400, "Leia as fontes primeiro.");
        const body = await c.body();
        const mode = (["remoto", "remoto+regiao", "qualquer"] as const).find((m) => m === body.mode) ?? "remoto";
        const choices: ProfileChoices = {
          targetRoles: strList(body.targetRoles, { max: 12 }),
          seniority: str(body.seniority, 60) || draft.intake.seniority,
          mode,
          onsiteCities: strList(body.onsiteCities, { max: 20 }),
          country: str(body.country, 60) || "Brasil",
          timezone: str(body.timezone, 20),
          international: Boolean(body.international),
        };
        const answers = (Array.isArray(body.answers) ? body.answers : [])
          .map((a: any) => ({ question: str(a?.question, 500), answer: str(a?.answer, 3000) }))
          .filter((a: { question: string }) => a.question);
        const sources = [...draft.sources];
        const intake = draft.intake;
        return {
          task: queue.add("profile-build", c.t("Montando seu perfil"), async () => {
            saveSources(sources);
            const { backup } = await buildAndSaveProfile({ sources, answers, choices, intake });
            draft.sources = [];
            draft.intake = null;
            app.broadcast("profile", {});
            app.jobsChanged();
            return backup ? c.t("perfil pronto (o anterior foi para um backup)") : c.t("perfil pronto");
          }),
        };
      },
    ],

    [
      "PUT",
      /^\/api\/profile\/truth$/,
      async (c) => {
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        const text = String((await c.body()).text ?? "").replace(/\r\n/g, "\n");
        checkTruth(text);
        const backupDir = path.join(paths.profileDir, "backup-edicoes");
        ensureDir(backupDir);
        fs.copyFileSync(paths.profileTruth, path.join(backupDir, `profile_truth-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`));
        fs.writeFileSync(paths.profileTruth, text.trim() + "\n");
        app.broadcast("profile", {});
        return { ok: true, pending: pendingItems(text) };
      },
    ],

    [
      "POST",
      /^\/api\/profile\/render$/,
      (c) => {
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        if (queue.has("render-base")) throw new HttpError(409, "Os PDFs já estão sendo gerados.");
        return {
          task: queue.add("render-base", c.t("PDFs do currículo-base"), async () => {
            const files = await renderBaseResumes();
            app.broadcast("profile", {});
            return c.t("{n} PDF(s) em output/base", { n: files.length });
          }),
        };
      },
    ],

    /* ------------------------------------------------ atualizar com uma novidade */

    [
      "POST",
      /^\/api\/profile\/update\/reset$/,
      () => {
        updateSources = [];
        return updateView();
      },
    ],
    ["POST", /^\/api\/profile\/update\/upload$/, async (c) => addUpdateSource(await readUploaded(c))],
    [
      "POST",
      /^\/api\/profile\/update\/sources$/,
      async (c) => {
        const body = await c.body();
        try {
          if (body.type === "link") {
            try {
              return addUpdateSource(await readUrlSource(str(body.url, 1000)));
            } finally {
              if (!queue.running) await closeBrowser().catch(() => {});
            }
          }
          if (body.type === "text") {
            const text = str(body.text, 40_000);
            if (text.length < 15) throw new HttpError(400, "Conte a novidade com um pouco mais de detalhe.");
            return addUpdateSource({ kind: "respostas", label: "Novidade contada", origin: "interface", text });
          }
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        throw new HttpError(400, "Tipo de fonte desconhecido.");
      },
    ],
    [
      "POST",
      /^\/api\/profile\/update\/propose$/,
      (c) => {
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        busy();
        if (!updateSources.length) throw new HttpError(400, "Conte a novidade: escreva, mande um arquivo ou um link.");
        const news = updateSources;
        updateSources = [];
        return {
          task: queue.add("profile-update", c.t("Preparando a atualização do perfil"), async () => {
            const p = await proposeProfileUpdate(news);
            app.broadcast("profile", {});
            return c.t("{n} mudança(s) para você conferir", { n: p.changes.length });
          }),
        };
      },
    ],
    [
      "POST",
      /^\/api\/profile\/numbers\/analyze$/,
      async (c) => {
        // Uma chamada curta, fora da fila: a fila pode estar ocupada com um pacote que leva minutos.
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        const body = await c.body();
        if (!analyzingNumbers) {
          const items = bulletsWithoutNumbers(loadBaseResume("pt-BR"), NUMBERS_MAX);
          analyzingNumbers = analyzeNumbers(items, body.force === true).finally(() => (analyzingNumbers = null));
        }
        try {
          await analyzingNumbers;
        } catch (e) {
          throw new HttpError(502, "A IA não conseguiu analisar os tópicos: {error}", { error: (e as Error).message });
        }
        app.broadcast("profile", {});
        return { numbers: safeNumbers() };
      },
    ],
    [
      "POST",
      /^\/api\/profile\/numbers$/,
      async (c) => {
        // "Números que faltam": os números que a pessoa informou viram uma proposta de atualização (ela confere antes).
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        busy();
        const body = await c.body();
        const items = (Array.isArray(body.items) ? body.items : []) as unknown[];
        const known = bulletsWithoutNumbers(loadBaseResume("pt-BR"), 30);
        const hints = loadNumberHints();
        const filled = items
          .map((x) => x as { bullet?: unknown; value?: unknown })
          .map((x) => ({ ref: known.find((k) => k.bullet === x.bullet), value: str(x.value, 200) }))
          .filter((x): x is { ref: NonNullable<typeof x.ref>; value: string } => Boolean(x.ref && x.value));
        // A pergunta vai junto: "15 mil" sozinho não diz se são usuários, pedidos ou reais.
        const text = numbersNews(filled.map((x) => ({ ...x.ref, value: x.value, question: hints[x.ref.bullet]?.question })));
        if (!text) throw new HttpError(400, "Preencha o número de pelo menos um resultado.");
        return {
          task: queue.add("profile-update", c.t("Preparando a atualização do perfil"), async () => {
            const p = await proposeProfileUpdate([{ kind: "respostas", label: "Números informados", origin: "interface", text }]);
            app.broadcast("profile", {});
            return c.t("{n} mudança(s) para você conferir", { n: p.changes.length });
          }),
        };
      },
    ],
    [
      "POST",
      /^\/api\/profile\/update\/apply$/,
      (c) => {
        busy();
        const p = loadProposal();
        if (!p) throw new HttpError(404, "Não há proposta de atualização.");
        if (proposalOutdated(p)) throw new HttpError(409, "Você editou o perfil depois da proposta. Descarte e gere de novo.");
        return {
          task: queue.add("profile-apply", c.t("Atualizando o perfil e os currículos-base"), async () => {
            await applyProposal();
            app.broadcast("profile", {});
            app.jobsChanged();
            return c.t("perfil e currículos-base atualizados");
          }),
        };
      },
    ],
    [
      "POST",
      /^\/api\/profile\/update\/discard$/,
      () => {
        discardProposal();
        app.broadcast("profile", {});
        return updateView();
      },
    ],
    [
      "POST",
      /^\/api\/profile\/rebuild-base$/,
      (c) => {
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        busy();
        if (queue.has("rebuild-base")) throw new HttpError(409, "Os currículos-base já estão sendo refeitos.");
        return {
          task: queue.add("rebuild-base", c.t("Refazendo os currículos-base"), async () => {
            await rebuildBaseResumes();
            app.broadcast("profile", {});
            app.jobsChanged();
            return c.t("currículos-base refeitos a partir do perfil");
          }),
        };
      },
    ],
  ];
}
