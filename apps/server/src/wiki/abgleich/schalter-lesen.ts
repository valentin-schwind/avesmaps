import {
    WIKISYNC_BEREICHE,
    wikisyncAngeschlossen,
    wikisyncBereicheDerKategorie,
    type WikisyncBereich,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";

/**
 * Wem welcher Bereich gehört (WI-0253 D-1). Bis zum Cutoff stellte ein Bereichsschalter je Umgebung (Migration 0225, Tafeln `wikisync_bereich_setting` und `wikisync_bereich_state`)
 * jeden Bereich vom Legacy-Zug auf den WikiSync um. Seit dem Cutoff 2026-11-02 liefert der Legacy-Zug nirgends mehr Kartendaten (Betreiber: „die spalte fällt weg, es gibt keinen schalter
 * mehr - macht keinen sinn wenn legacy aus ist“). Es gibt keinen Schalter, keine Spalte, kein Umschalten mehr:
 *
 * - **Fest:** Jeder Bereich, an dem die Übernahme angeschlossen ist (`wikisyncAngeschlossen`), gehört in jeder Umgebung dem WikiSync. Ein Bereich ohne Schreiber gehört ihm nicht; für ihn gibt es noch keine Übernahme.
 * - **Eine Stelle für vier Leser:** den Plan der Vorschau (der Eigentümer `legacy` eines Felds kommt von hier), die Übernahme, den Legacy-Zug (er lässt diese Bereiche aus: `abgleiche/start.ts`,
 *   `migration/powerlines.ts`, `migration/subject-details-import.ts`) und die Wiki-Box. Die Datei hat kein Fastify und keine `ApiError`, damit auch die Importe sie laden dürfen.
 * - **Die Tafeln bleiben** in der Datenbank (keine Migration), werden aber nicht mehr gelesen. Die Datenbank ist hier kein Eingang mehr: `db` bleibt nur, damit die Leser ihre Aufrufe behalten.
 */

/** Die Bereiche, die dem WikiSync gehören: alle, an denen die Übernahme angeschlossen ist. */
const WIKISYNC_GEHOERT: ReadonlySet<WikisyncBereich> = new Set(WIKISYNC_BEREICHE.filter(wikisyncAngeschlossen));

/** Die Bereiche, die dem WikiSync gehören: für den Plan, die Übernahme und den Legacy-Zug. In jeder Umgebung dieselben. */
export function wikisyncBereiche(db?: Queryable): Promise<ReadonlySet<WikisyncBereich>> {
    void db;
    return Promise.resolve(WIKISYNC_GEHOERT);
}

/**
 * Die Bereiche, die dem Legacy-Zug fehlen, wenn er diese Kategorie fährt: die der Kategorie, die dem WikiSync gehören. Leer: Der Zug fährt die Kategorie wie
 * immer. Eine Kategorie, die auch nur einen Bereich an den WikiSync abgegeben hat, fährt nicht (im Zweifel gilt die vorsichtige Seite: Ein Zug würde die
 * wiki-eigenen Felder überschreiben, die ihm nicht mehr gehören).
 */
export async function bereicheAusgelassenBeiKategorie(
    db: Queryable | undefined,
    kategorie: string,
): Promise<WikisyncBereich[]> {
    const gehoeren = await wikisyncBereiche(db);
    return wikisyncBereicheDerKategorie(kategorie).filter((bereich) => gehoeren.has(bereich));
}
