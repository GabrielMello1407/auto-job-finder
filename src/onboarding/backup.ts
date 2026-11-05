import fs from "node:fs";
import path from "node:path";
import { ensureDir, paths } from "../config.js";

/** Copia os arquivos do perfil para profile/backup-<data>/ antes de trocá-los. */
export function backupProfile(): string | null {
  const files = ["profile_truth.md", "base_resume.pt.json", "base_resume.en.json", "preferences.json", "rules.json"]
    .map((f) => path.join(paths.profileDir, f))
    .filter((f) => fs.existsSync(f));
  if (!files.length) return null;
  const dir = path.join(paths.profileDir, `backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`);
  ensureDir(dir);
  for (const f of files) fs.copyFileSync(f, path.join(dir, path.basename(f)));
  return dir;
}
