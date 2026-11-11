// Idioma da interface. O texto em português é a própria chave: t("Gerar pacote") devolve a tradução do
// dicionário do idioma escolhido (locales/<idioma>.json) ou, sem tradução, o próprio texto.
// Variáveis entre chaves: t("Enviada há {n} dias", { n: 3 }). Valores de fora passam por esc() antes.

export const LANGS = { "pt-BR": "Português", en: "English" };
const KEY = "ajf.lang";
let lang = "pt-BR";
let dict = {};

/** Escolha salva neste navegador; sem ela, o idioma do sistema (português só para quem usa português). */
export function initialLang() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in LANGS) return saved;
  } catch {
    /* sem armazenamento: segue o navegador */
  }
  return /^pt\b/i.test(navigator.language || "") ? "pt-BR" : "en";
}

export function saveLang(l) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* sem armazenamento: vale só nesta página */
  }
}

/** Carrega o dicionário. Precisa terminar antes de os módulos da página montarem textos (ver boot.js). */
export async function loadLang(l) {
  lang = l in LANGS ? l : "pt-BR";
  dict = {};
  if (lang !== "pt-BR") {
    try {
      const res = await fetch(`/locales/${lang}.json`);
      if (res.ok) dict = await res.json();
    } catch {
      /* sem dicionário: mostra em português */
    }
  }
  document.documentElement.lang = lang;
}

export const getLang = () => lang;

export function t(text, vars) {
  let s = (lang !== "pt-BR" && dict[text]) || text;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Data no formato do idioma da interface. */
export const dateText = (iso) => new Date(iso).toLocaleDateString(lang === "pt-BR" ? "pt-BR" : "en-US");
