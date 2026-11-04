import fs from "node:fs";
import path from "node:path";
import { ensureDir, hasProfile, paths } from "../../config.js";
import { buildAndSaveProfile, interviewSource, saveSources, type InterviewAnswers, type ProfileChoices } from "../../onboarding/index.js";
import { readIntake, type Intake } from "../../onboarding/build.js";
import { LINKEDIN_EXPORT_HELP, readFileSource, readUrlSource, type SourceDoc } from "../../onboarding/sources.js";
import { NON_EVIDENCE_HEADING } from "../../profile.js";
import { renderBaseResumes } from "../../render/base.js";
import { closeBrowser } from "../../render/pdf.js";
import { linkedinPlan } from "../../writers/linkedin.js";
import { fileUrl, HttpError, str, strList, type App, type Route } from "../http.js";

/**
 * Perfil pela interface: montar (fontes → leitura pela IA → perguntas → montagem), conferir o
 * profile_truth.md, gerar os PDFs de conferência e o plano de LinkedIn.
 */

const UPLOAD_LIMIT = 15_000_000;
const UPLOAD_EXT = /\.(pdf|docx|txt|md)$/i;

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

function latestLinkedinPlan(): { file: string; markdown: string; date: string } | null {
  const dir = path.join(paths.outputDir, "linkedin");
  if (!fs.existsSync(dir)) return null;
  const md = fs
    .readdirSync(dir)
    .filter((f) => /^plano_linkedin_.*\.md$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0];
  if (!md) return null;
  const file = path.join(dir, md.f);
  return { file: fileUrl(file)!, markdown: fs.readFileSync(file, "utf8"), date: new Date(md.t).toISOString() };
}

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
    if (queue.has("profile-read") || queue.has("profile-build")) throw new HttpError(409, "O perfil já está sendo montado.");
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
            .filter((s) => NON_EVIDENCE_HEADING.test(s.split("\n")[0]))
            .map((s) => s.split("\n")[0].replace(/^## /, "")),
          basePdfs: basePdfs(),
          linkedinHelp: LINKEDIN_EXPORT_HELP,
          draft: draftView(),
        };
      },
    ],

    [
      "POST",
      /^\/api\/profile\/upload$/,
      async (c) => {
        const name = path.basename(str(c.url.searchParams.get("name"), 160)).replace(/[^\w.\- ()À-ÿ]/g, "_");
        if (!UPLOAD_EXT.test(name)) throw new HttpError(400, "Use PDF, DOCX, TXT ou MD.");
        const buf = await c.raw(UPLOAD_LIMIT);
        if (!buf.length) throw new HttpError(400, "Arquivo vazio.");
        const dir = path.join(paths.profileDir, "entrada");
        ensureDir(dir);
        const file = path.join(dir, name);
        fs.writeFileSync(file, buf);
        try {
          return addSource(await readFileSource(file));
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      },
    ],
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
            if (text.length < 40) throw new Error("Cole um texto um pouco maior.");
            return addSource({ kind: "texto", label: "Texto colado", origin: "colado na interface", text });
          }
          if (body.type === "interview") {
            const doc = interviewSource((body.answers ?? {}) as InterviewAnswers, "interface");
            if (doc.text.length < 40) throw new Error("Responda pelo menos algumas perguntas.");
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
      () => {
        busy();
        if (!draft.sources.length) throw new HttpError(400, "Adicione pelo menos uma fonte.");
        const sources = [...draft.sources];
        return {
          task: queue.add("profile-read", "Lendo suas fontes", async () => {
            console.log(`Lendo ${sources.length} fonte(s) com a IA...`);
            const intake = await readIntake(sources);
            // Fontes mudaram enquanto a IA lia: essa leitura já não vale.
            const same = draft.sources.length === sources.length && sources.every((s, i) => draft.sources[i] === s);
            if (!same) throw new Error("As fontes mudaram durante a leitura. Clique em “Ler minhas fontes” de novo.");
            draft.intake = intake;
            app.broadcast("profile", {});
            return intake.questions.length ? `${intake.questions.length} pergunta(s) para completar` : "tudo entendido";
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
          task: queue.add("profile-build", "Montando seu perfil", async () => {
            saveSources(sources);
            const { backup } = await buildAndSaveProfile({ sources, answers, choices, intake });
            draft.sources = [];
            draft.intake = null;
            app.broadcast("profile", {});
            app.jobsChanged();
            return backup ? "perfil pronto (o anterior foi para um backup)" : "perfil pronto";
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
      () => {
        if (!hasProfile()) throw new HttpError(409, "Ainda não há perfil.");
        if (queue.has("render-base")) throw new HttpError(409, "Os PDFs já estão sendo gerados.");
        return {
          task: queue.add("render-base", "PDFs do currículo-base", async () => {
            const files = await renderBaseResumes();
            app.broadcast("profile", {});
            return `${files.length} PDF(s) em output/base`;
          }),
        };
      },
    ],

    ["GET", /^\/api\/linkedin$/, () => ({ plan: latestLinkedinPlan() })],
    [
      "POST",
      /^\/api\/linkedin$/,
      async (c) => {
        if (!hasProfile()) throw new HttpError(409, "Monte o seu perfil primeiro.");
        if (queue.has("linkedin")) throw new HttpError(409, "O plano já está sendo gerado.");
        const current = str((await c.body()).current, 40_000);
        return {
          task: queue.add("linkedin", "Plano de LinkedIn", async () => {
            let currentProfileFile: string | undefined;
            if (current.length > 40) {
              const dir = path.join(paths.profileDir, "entrada");
              ensureDir(dir);
              currentProfileFile = path.join(dir, "linkedin_atual.md");
              fs.writeFileSync(currentProfileFile, current);
            }
            await linkedinPlan({ currentProfileFile });
            app.broadcast("profile", {});
            return "plano pronto";
          }),
        };
      },
    ],
  ];
}
