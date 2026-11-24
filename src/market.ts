import { loadPreferences } from "./profile.js";
import type { Market } from "./schemas.js";

export interface MarketProfile {
  market: Market;
  language: "pt-BR" | "en";
  paper: "A4" | "Letter";
  /** Carta de apresentação (cover letter) esperada por padrão. */
  coverLetter: boolean;
  docName: string;
  notes: string[];
  /** Páginas do currículo pelo tempo de carreira (src/career.ts#pageLimit); sem valor, 2. */
  maxPages?: 1 | 2;
}

/** O nome do arquivo segue o idioma do documento: "Curriculo" em português; em inglês, "CV" no Reino Unido e "Resume" no resto. */
export const docNameFor = (language: "pt-BR" | "en", market: Market) => (language === "pt-BR" ? "Curriculo" : market === "UK" ? "CV" : "Resume");

/**
 * Convenções por mercado. EUA/Canadá: "resume" (1–2 páginas), papel Letter, cover letter esperada,
 * sem foto/idade/estado civil/endereço completo. Brasil: "currículo", A4, carta opcional. Vaga em inglês
 * segue o padrão internacional em qualquer mercado: "Resume" e cover letter curta.
 */
export function marketProfile(market: Market, jobLanguage?: "pt-BR" | "en" | "other"): MarketProfile {
  switch (market) {
    case "BR": {
      const language = jobLanguage === "en" ? "en" : "pt-BR";
      return {
        market,
        language,
        paper: "A4",
        coverLetter: language === "en",
        docName: docNameFor(language, market),
        notes:
          language === "en"
            ? ["Vaga em inglês: o currículo sai em inglês, como resume, com uma cover letter curta (anexe se o formulário tiver campo para ela)."]
            : ["No Brasil a carta de apresentação é opcional; prefira uma mensagem curta no e-mail ou no LinkedIn."],
      };
    }
    case "US":
    case "CA":
      return {
        market,
        language: "en",
        paper: "Letter",
        coverLetter: true,
        docName: "Resume",
        notes: [
          "Formato americano: papel Letter, sem foto, idade, estado civil, CPF ou endereço completo.",
          "Cover letter é esperada mesmo quando marcada como opcional.",
          `Deixe claro o modelo de contratação (contractor/B2B a partir de ${loadPreferences().country}) e o fuso (${loadPreferences().timezone}) se a vaga for remota.`,
        ],
      };
    case "UK":
    case "EU":
      return {
        market,
        language: "en",
        paper: "A4",
        coverLetter: true,
        docName: market === "UK" ? "CV" : "Resume",
        notes: ["Europa/Reino Unido: A4, sem foto (exceto se pedido), cover letter comum."],
      };
    case "LATAM":
    case "GLOBAL":
    default: {
      const language = jobLanguage === "pt-BR" ? "pt-BR" : "en";
      return {
        market,
        language,
        paper: "A4",
        coverLetter: language === "en",
        docName: docNameFor(language, market),
        notes: [language === "en" ? "Empresa internacional/remota: currículo em inglês e cover letter curta." : "Empresa internacional com vaga em português: currículo em português; a carta é opcional."],
      };
    }
  }
}
