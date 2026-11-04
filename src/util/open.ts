import { spawn } from "node:child_process";

/** Abre arquivo, pasta ou URL no programa padrão do sistema (PDF no leitor, link no navegador). */
export function openExternal(target: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  spawn(cmd, args as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}
