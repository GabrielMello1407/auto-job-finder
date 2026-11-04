import path from "node:path";
import { fileURLToPath } from "node:url";

// Os testes usam o perfil fictício de examples/ — nunca os dados reais de quem usa o agente.
// Este módulo precisa ser o PRIMEIRO import dos testes (antes de qualquer coisa que leia src/config.ts).
process.env.AJF_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "examples");
delete process.env.AJF_PROVIDER;
