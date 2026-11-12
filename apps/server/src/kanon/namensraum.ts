import { wikiNamespaceAusTitel, wikiNamespaceName, type WikiNamespaceTafel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";
import { leseNamespaceTafelImSchnitt } from "./tafel.ts";

/**
 * Der Namensraum einer Wiki-Zuweisung (WI-0253 B-2): Er kommt aus dem Präfix des Titels hinter der gespeicherten Wiki-Adresse, gelesen über
 * die Namensraum-Tafel der Umgebung, NIE aus dem Slug eines Schlüssels geraten (`wiki-link-targets.yaml`, `namensraum`: „`elf-volk` ist
 * ‚Elf (Volk)‘ im Hauptraum oder ‚Elf:Volk‘ in 220“).
 *
 * 🔴 Ohne Wiki-Adresse gibt es keinen Raum: Eine Eigenkennung (nur ein gespeicherter Key) und eine fremde Adresse (eine Briefspielseite)
 * ergeben \`ns: null\`, nicht den Hauptraum (Vali 2026-10-25: Eigenkennungen „gelten unsere lokalen Daten“; Legacy `…FromWikiUrlMitHauptraum`
 * prüft den Wirt auf Suffix-Grenze). Ein Titel ohne bekanntes Präfix ist der Hauptraum (0), sein Wort ist leer.
 */
export interface ZuweisungsRaum {
    ns: number | null;
    /** Das Wort des Raums (`Inoffiziell`, im Hauptraum leer); `null` zusammen mit `ns: null`. */
    nsName: string | null;
}

export const OHNE_RAUM: ZuweisungsRaum = { ns: null, nsName: null };

/** Rein: der Raum zu einer Adresse nach einer Tafel. */
export function raumDerAdresse(adresse: string | null | undefined, tafel: WikiNamespaceTafel): ZuweisungsRaum {
    const titel = titelAusWikiAdresse(adresse ?? null);
    if (titel === null) return OHNE_RAUM;
    const ns = wikiNamespaceAusTitel(titel, tafel);
    return { ns, nsName: wikiNamespaceName(tafel, ns) ?? "" };
}

/** Der Raum zu einer Adresse nach der Tafel der Umgebung; für Schreibwege in einer Transaktion. */
export async function raumDerAdresseInUmgebung(
    db: Queryable,
    adresse: string | null | undefined,
): Promise<ZuweisungsRaum> {
    if (titelAusWikiAdresse(adresse ?? null) === null) return OHNE_RAUM;
    return raumDerAdresse(adresse, await leseNamespaceTafelImSchnitt(db));
}
