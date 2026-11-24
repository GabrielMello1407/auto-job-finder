import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

/**
 * O comando que abre o alvo em cada sistema. Puro (testado).
 * - No Windows NÃO usa `cmd /c start`: links de vagas vêm de sites de terceiros e o cmd interpreta
 *   `&`, `|` e `^` como comandos (link quebrado ou, no pior caso, um comando executado). O explorer.exe
 *   recebe o alvo como um argumento só, sem shell.
 * - Sem `windowsHide`: o explorer.exe repassa o "abrir escondido" para a janela que cria, e a pasta abria
 *   invisível. Ele é um programa de janela, não abre console, então não há o que esconder.
 * - Caminho no Windows vai com barras invertidas: com "/" o explorer.exe abre a pasta Documentos.
 */
export function openCommand(target: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[]; options: SpawnOptions } {
  const options: SpawnOptions = { detached: true, stdio: "ignore" };
  if (platform === "win32") {
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target);
    return { cmd: "explorer.exe", args: [isUrl ? target : path.win32.normalize(target)], options };
  }
  return { cmd: platform === "darwin" ? "open" : "xdg-open", args: [target], options };
}

/** Abre arquivo, pasta ou URL no programa padrão do sistema (PDF no leitor, link no navegador, pasta no gerenciador). */
export function openExternal(target: string) {
  const { cmd, args, options } = openCommand(target);
  const child = spawn(cmd, args, options);
  child.on("error", () => {
    /* sem programa para abrir: a interface/terminal já mostram o caminho */
  });
  child.unref();
}
