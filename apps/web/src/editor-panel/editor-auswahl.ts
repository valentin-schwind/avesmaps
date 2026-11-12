/**
 * Die gelbe Auswahl eines Editors gehört zu seinem Fenster (Fund der Hauptorchestrierung auf der Stage 2026-10-20, Entscheidung der
 * Editor-Orchestrierung): Wählt jemand in der Liste der Derographie Donnerzacken, leuchtet es auf der Karte. Schloss er danach das Fenster
 * und wechselte zu den Herrschaftsgebieten, blieb Donnerzacken gelb und sah mit der Mehrfachauswahl aus wie ein angehaktes Gebiet.
 *
 * - **Schließt das letzte Fenster eines Editors** oder **verlässt jemand seine Kachel** in „Karteninhalte“, endet die Auswahl, wenn sie
 *   ein Objekt dieses Editors ist. Für alle fünf Editoren gleich, an EINER Stelle (`app.vue`).
 * - Eine Auswahl, die zu einem anderen Editor gehört, bleibt: Bringt die Suche ein Gebiet und stellt die Karte auf „Politisch“, folgt die
 *   Kachel der Ansicht, und das gefundene Gebiet bleibt gewählt.
 * - Besucher ohne Editor haben weder Fenster noch Kacheln; ihre Auswahl bleibt, wie sie ist.
 */

/** Welcher Editor ein Objekt dieser Art bearbeitet, und seine Kachel in „Karteninhalte“. */
const EDITOR_JE_ART: Readonly<Record<string, { werkzeug: string; kachel: string }>> = {
    place: { werkzeug: "ortseditor", kachel: "orte" },
    area: { werkzeug: "landschaftseditor", kachel: "regionen" },
    peak: { werkzeug: "landschaftseditor", kachel: "regionen" },
    territory: { werkzeug: "gebietseditor", kachel: "territorien" },
    path: { werkzeug: "wegeditor", kachel: "wege" },
    powerline: { werkzeug: "kraftlinieneditor", kachel: "kraftlinien" },
};

/** Gehört eine Auswahl dieser Art zu einem der Editoren, deren letztes Fenster gerade zuging? */
export function auswahlEndetMitFenster(art: string | undefined, zu: readonly string[]): boolean {
    const editor = art === undefined ? undefined : EDITOR_JE_ART[art];
    return editor !== undefined && zu.includes(editor.werkzeug);
}

/** Gehört eine Auswahl dieser Art zu dem Editor, dessen Kachel gerade verlassen wurde? */
export function auswahlEndetMitKachel(art: string | undefined, verlassen: string | undefined): boolean {
    const editor = art === undefined ? undefined : EDITOR_JE_ART[art];
    return editor !== undefined && verlassen !== undefined && editor.kachel === verlassen;
}

/** Die Editoren, von denen vorher ein Fenster offen war und jetzt keins mehr. */
export function zugegangen(vorher: readonly string[], jetzt: readonly string[]): string[] {
    return [...new Set(vorher)].filter((werkzeug) => !jetzt.includes(werkzeug));
}
