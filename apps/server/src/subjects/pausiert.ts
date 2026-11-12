import {
    PANEL_SECTION_SWITCH,
    loreSwitchKey,
    type LoreKind,
    type LoreRowView,
    type SubjectCitymapsSection,
    type SubjectLiteratureSection,
    type SubjectLoreSection,
    type SubjectReviewsSection,
    type SubjectSection,
} from "@avesmaps3d/shared";

/**
 * Die Inhaltsschalter des Infopanels (WI-0127 SYS-10, SYS-0001 §3.4): Ein ausgeblendeter Abschnitt antwortet in seiner gewohnten Form, aber
 * leer und mit `paused`; eine ausgeblendete Vorkommensart fehlt in `rows` und steht in `pausedKinds`. So verlässt kein ausgeblendeter
 * Inhalt den Server, und der Client zeigt an der Stelle seinen Satz. Rein: den Stand gibt der Aufrufer mit (`isOff`).
 *
 * 🪤 Ausblenden ist keine Zugriffskontrolle (AGENTS.md): Eine Antwort im kurzen Cache des Browsers bleibt bis zu ihrem Ablauf stehen.
 */
export function pausiereAbschnitt(section: SubjectSection, result: unknown, isOff: (key: string) => boolean): unknown {
    if (result === null || typeof result !== "object") return result;
    const key = PANEL_SECTION_SWITCH[section];
    if (key !== undefined) {
        if (!isOff(key)) return result;
        if (section === "literature") return { ...(result as SubjectLiteratureSection), works: [], paused: true };
        if (section === "citymaps") return { ...(result as SubjectCitymapsSection), maps: [], paused: true };
        const { subject, revision } = result as SubjectReviewsSection;
        return { subject, revision, count: 0, reviews: [], paused: true } satisfies SubjectReviewsSection;
    }
    if (section !== "lore") return result;
    const lore = result as SubjectLoreSection;
    const { rows, pausedKinds } = pausiereVorkommen(lore.rows, isOff);
    return pausedKinds.length === 0 ? lore : { ...lore, rows, pausedKinds };
}

/**
 * Was ein Editor sieht (`use_editor_menu` mit `?editor=true`, WI-0127 SYS-11; SYS-0001 §3.4): den Abschnitt echt, mit dem Vermerk
 * `publicHidden` beziehungsweise `publicHiddenKinds`, wo ein Schalter ihn für Besucher ausblendet. Bilder bleiben auch hier zurückgehalten
 * (der Resolver fragt keinen Editor), das echte Bild zeigt das MAM.
 */
export function markiereOeffentlichAusgeblendet(
    section: SubjectSection,
    result: unknown,
    isOff: (key: string) => boolean,
): unknown {
    if (result === null || typeof result !== "object") return result;
    const key = PANEL_SECTION_SWITCH[section];
    if (key !== undefined) return isOff(key) ? { ...(result as object), publicHidden: true } : result;
    if (section !== "lore") return result;
    const lore = result as SubjectLoreSection;
    const { pausedKinds } = pausiereVorkommen(lore.rows, isOff);
    return pausedKinds.length === 0 ? lore : { ...lore, publicHiddenKinds: pausedKinds };
}

/** Die Vorkommenszeilen ohne die ausgeblendeten Arten; auch für die Antwort einer freien Kartenstelle. */
export function pausiereVorkommen(
    rows: readonly LoreRowView[],
    isOff: (key: string) => boolean,
): { rows: LoreRowView[]; pausedKinds: LoreKind[] } {
    const pausedKinds = [...new Set(rows.map((row) => row.kind))].filter((kind) => isOff(loreSwitchKey(kind)));
    return { rows: rows.filter((row) => !pausedKinds.includes(row.kind)), pausedKinds };
}
