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
}

/**
 * Convenções por mercado. EUA/Canadá: "resume" (1–2 páginas), papel Letter, cover letter esperada,
 * sem foto/idade/estado civil/endereço completo. Brasil: "currículo", A4, carta opcional.
 */
export function marketProfile(market: Market, jobLanguage?: "pt-BR" | "en" | "other"): MarketProfile {
  switch (market) {
    case "BR":
      return {
        market,
        language: jobLanguage === "en" ? "en" : "pt-BR",
        paper: "A4",
        coverLetter: false,
        docName: "Curriculo",
        notes: [
          "No Brasil a carta de apresentação é opcional; prefira uma mensagem curta no e-mail ou no LinkedIn.",
          "Se a vaga estiver em inglês, o currículo sai em inglês.",
        ],
      };
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
    default:
      return {
        market,
        language: jobLanguage === "pt-BR" ? "pt-BR" : "en",
        paper: "A4",
        coverLetter: jobLanguage !== "pt-BR",
        docName: "Resume",
        notes: ["Empresa internacional/remota: currículo em inglês e cover letter curta."],
      };
  }
}
