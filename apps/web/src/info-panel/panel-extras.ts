import {
    PANEL_APPROVED_EXTRAS,
    PANEL_LEGACY_ONLY,
    SUBJECT_DETAIL_KINDS,
    SUBJECT_FACT_FIELDS,
    type PanelApprovedExtras,
} from "@avesmaps3d/shared";

/**
 * Welche Zusatzfelder das Panel zeigt (WI-0063 27.8 und 27.10; Betreiber 2026-10-04: „B aber ich muss später sehen wieviel das
 * ist“, zum Abnahmeblatt: „sonst passt das mockup!“).
 *
 * - **`approved`** (jeder Besucher, immer in Produktion): Legacys Zeilen und dazu die Freigabe, EINE Liste, `PANEL_APPROVED_EXTRAS`
 *   in `@avesmaps3d/shared`.
 * - **`legacy`** (nur Entwicklung und Tests): genau Legacys Anzeige, ohne jedes Zusatzfeld.
 * - **`all`** (nur Entwicklung): alles, was der Server mitliefert, auch ein Feld, das noch nicht freigegeben ist. Dafür gibt es das
 *   Abnahmeblatt „wie Legacy“ gegen „mit allen Zusatzfeldern“ (`review/wi-0063/zusatzfelder/blatt.png`).
 *
 * 🔴 Der Schalter `globalThis.__avesmapsPanelExtras` („all“ oder „legacy“) wirkt NUR im Entwicklungsmodus (`import.meta.env.DEV`).
 * Vite ersetzt diese Konstante im Produktionsbau durch `false`; der Zweig und der Name des Schalters fallen dort heraus. Ein Wächter
 * (`info-panel-huelle.test.ts`) hält fest, dass der Name an keiner anderen Stelle steht.
 */

export type PanelMode = "approved" | "legacy" | "all";

export interface PanelRules {
    mode: PanelMode;
    /** Die Freigabe der Zusatzfelder je Art; sie allein entscheidet, was über Legacys Anzeige hinaus dasteht. */
    approved: PanelApprovedExtras;
}

const ALL: PanelApprovedExtras = Object.fromEntries(
    SUBJECT_DETAIL_KINDS.map((kind) => [
        kind,
        { fields: [...SUBJECT_FACT_FIELDS], fullDescription: true, context: true },
    ]),
) as unknown as PanelApprovedExtras;

const APPROVAL: Record<PanelMode, PanelApprovedExtras> = {
    approved: PANEL_APPROVED_EXTRAS,
    legacy: PANEL_LEGACY_ONLY,
    all: ALL,
};

export function panelRules(mode: PanelMode): PanelRules {
    return { mode, approved: APPROVAL[mode] };
}

/** Der Modus dieser Seite: Besucher sehen `approved`; nur die Entwicklung kann `all` oder `legacy` einschalten. */
export function currentPanelMode(): PanelMode {
    if (import.meta.env.DEV) {
        const wish = (globalThis as { __avesmapsPanelExtras?: unknown }).__avesmapsPanelExtras;
        if (wish === "all" || wish === "legacy") return wish;
    }
    return "approved";
}
