/**
 * Die Adresse einer Stelle in den Hinweisen: `<origin>/?hinweis=<kennung>`. Ein Query-Parameter, weil der Hash der Kamera gehört und unberührt bleibt. Eigene kleine Datei, weil `app.vue` nur das Lesen
 * braucht und das Fenster erst beim ersten Öffnen nachlädt.
 */
const PARAMETER = "hinweis";

/** Immer die Karte, nie `/edit`: Ein geteilter Link gehört zu den Besuchern. */
export function hinweisAdresse(origin: string, kennung: string): string {
    return `${origin}/?${PARAMETER}=${encodeURIComponent(kennung)}`;
}

export function hinweisAusSuche(suche: string): string | null {
    const wert = new URLSearchParams(suche).get(PARAMETER);
    return wert === null || wert === "" ? null : wert;
}

export function sucheOhneHinweis(suche: string): string {
    const parameter = new URLSearchParams(suche);
    parameter.delete(PARAMETER);
    const rest = parameter.toString();
    return rest === "" ? "" : `?${rest}`;
}
