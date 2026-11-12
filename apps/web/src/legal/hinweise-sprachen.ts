import { LEGAL_NOTICES, type HinweiseDokument } from "@avesmaps3d/shared";
import type { Locale } from "../i18n/i18n";

/**
 * Die Hinweise in der Sprache des Lesers (Betreiber 2026-11-04: „mach die sprachen“). Deutsch steht im Bündel der Rechtstexte und ist die maßgebliche Fassung; jede andere Sprache liegt in
 * `config/legal/hinweise/<sprache>.json` und kommt erst, wenn sie gebraucht wird: Sie mitzuladen kostete jeden Besucher acht Fassungen. Aufbau, Kennungen und Verweise sind in jeder Sprache dieselben, das hält
 * `apps/web/test/hinweise-sprachen.test.ts`. Eine Sprache, die nicht kommt, zeigt die deutsche Fassung.
 */

export interface HinweiseFassung {
    dokument: HinweiseDokument;
    /** Der Satz, dass es eine Übersetzung ist und die deutsche Fassung gilt; im Deutschen leer. */
    uebersetzung: string;
}

type HinweiseDatei = HinweiseDokument & { uebersetzung: string };

const LADER: Readonly<Record<Exclude<Locale, "de">, () => Promise<{ default: unknown }>>> = {
    en: () => import("../../../../config/legal/hinweise/en.json"),
    fr: () => import("../../../../config/legal/hinweise/fr.json"),
    nl: () => import("../../../../config/legal/hinweise/nl.json"),
    it: () => import("../../../../config/legal/hinweise/it.json"),
    es: () => import("../../../../config/legal/hinweise/es.json"),
    pl: () => import("../../../../config/legal/hinweise/pl.json"),
    da: () => import("../../../../config/legal/hinweise/da.json"),
    sv: () => import("../../../../config/legal/hinweise/sv.json"),
};

const DEUTSCH: HinweiseFassung = { dokument: LEGAL_NOTICES.hinweise, uebersetzung: "" };

export async function ladeHinweise(sprache: Locale): Promise<HinweiseFassung> {
    if (sprache === "de") return DEUTSCH;
    try {
        const { uebersetzung, ...dokument } = (await LADER[sprache]()).default as HinweiseDatei;
        return { dokument, uebersetzung };
    } catch {
        return DEUTSCH;
    }
}
