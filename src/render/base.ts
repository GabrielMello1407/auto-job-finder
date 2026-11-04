import path from "node:path";
import { ensureDir, paths } from "../config.js";
import { loadBaseResume } from "../profile.js";
import { runGuards } from "../tailor/guards.js";
import { sourcesText } from "../tailor/index.js";
import { closeBrowser, htmlToPdf } from "./pdf.js";
import { resumeHtml } from "./resumeHtml.js";

/** Gera os PDFs dos currículos-base (sem IA) para conferir o perfil e o template. */
export async function renderBaseResumes(log: (m: string) => void = console.log): Promise<string[]> {
  const dir = path.join(paths.outputDir, "base");
  ensureDir(dir);
  const files: string[] = [];
  for (const lang of ["pt-BR", "en"] as const) {
    const r = loadBaseResume(lang);
    const g = runGuards(r, r, sourcesText());
    const who = r.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "Curriculo";
    const file = path.join(dir, `${who}_base_${lang}.pdf`);
    const pages = await htmlToPdf(resumeHtml(r, "A4"), file, "A4");
    log(`${file} (${pages} pág.) · travas: ${g.violations.length} violações`);
    g.violations.forEach((v) => log(`   ❌ ${v}`));
    files.push(file);
  }
  await closeBrowser();
  return files;
}
