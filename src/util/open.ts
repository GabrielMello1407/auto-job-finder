import { spawn } from "node:child_process";

/**
 * Abre arquivo, pasta ou URL no programa padrão do sistema (PDF no leitor, link no navegador).
 * No Windows NÃO usa `cmd /c start`: links de vagas vêm de sites de terceiros e o cmd interpreta
 * `&`, `|` e `^` como comandos (link quebrado ou, no pior caso, um comando executado).
 * O explorer.exe recebe o alvo como um argumento só, sem shell.
 */
export function openExternal(target: string) {
  const [cmd, args] =
    process.platform === "win32" ? ["explorer.exe", [target]] : process.platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {
    /* sem programa para abrir: a interface/terminal já mostram o caminho */
  });
  child.unref();
}
