import fs from "node:fs";
import { hasProfile } from "../../config.js";
import { profileChangedAt } from "../../onboarding/update.js";
import { linkedinCheck, linkedinHistory, linkedinPlan, readLinkedinFile } from "../../writers/linkedin.js";
import { fileUrl, HttpError, str, type App, type Route } from "../http.js";
import { saveUpload } from "./profile.js";

/**
 * LinkedIn: plano (o que mudar no perfil) e conferência (o que já está certo, o que do plano falta e o
 * que está inconsistente). O agente não acessa o LinkedIn: a pessoa manda o PDF exportado ou o texto.
 */

function docView(d: { kind: string; file: string; date: string } | undefined) {
  if (!d) return null;
  return { kind: d.kind, file: fileUrl(d.file)!, date: d.date, markdown: fs.readFileSync(d.file, "utf8") };
}

export function linkedinRoutes(app: App): Route[] {
  const { queue } = app;
  const requireProfile = () => {
    if (!hasProfile()) throw new HttpError(409, "Monte o seu perfil primeiro.");
  };

  return [
    [
      "GET",
      /^\/api\/linkedin$/,
      () => {
        const history = linkedinHistory();
        const plan = history.find((d) => d.kind === "plano");
        const check = history.find((d) => d.kind === "conferencia");
        const changed = profileChangedAt();
        return {
          plan: docView(plan),
          check: docView(check),
          // O perfil mudou depois do plano: o plano pode estar citando coisa antiga.
          planOutdated: Boolean(plan && changed > Date.parse(plan.date)),
          history: history.map((d) => ({ kind: d.kind, date: d.date, file: fileUrl(d.file) })),
        };
      },
    ],
    [
      "POST",
      /^\/api\/linkedin\/upload$/,
      async (c) => {
        // PDF do LinkedIn ("Mais → Salvar como PDF") ou texto: devolve o texto para a página mostrar.
        const file = await saveUpload(c);
        try {
          const text = await readLinkedinFile(file);
          return { text: text.slice(0, 40_000) };
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      },
    ],
    [
      "POST",
      /^\/api\/linkedin$/,
      async (c) => {
        requireProfile();
        if (queue.has("linkedin")) throw new HttpError(409, "O plano já está sendo gerado.");
        const current = str((await c.body()).current, 40_000);
        return {
          task: queue.add("linkedin", "Plano de LinkedIn", async () => {
            await linkedinPlan({ current: current.length > 40 ? current : undefined });
            app.broadcast("profile", {});
            return "plano pronto";
          }),
        };
      },
    ],
    [
      "POST",
      /^\/api\/linkedin\/check$/,
      async (c) => {
        requireProfile();
        if (queue.has("linkedin-check")) throw new HttpError(409, "A conferência já está rodando.");
        const current = str((await c.body()).current, 40_000);
        if (current.length < 200) throw new HttpError(400, "Mande o PDF do seu LinkedIn ou cole o texto do perfil: sem ele não há o que conferir.");
        return {
          task: queue.add("linkedin-check", "Conferindo o seu LinkedIn", async () => {
            await linkedinCheck(current);
            app.broadcast("profile", {});
            return "conferência pronta";
          }),
        };
      },
    ],
  ];
}
