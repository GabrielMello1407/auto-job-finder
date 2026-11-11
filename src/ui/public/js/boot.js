// Ponto de entrada da página: carrega o idioma antes de qualquer módulo montar textos e só então abre a interface.
import { initialLang, loadLang } from "./i18n.js";

await loadLang(initialLang());
await import("./main.js");
