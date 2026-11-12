import { SUBJECT_LIMITS, type SubjectSprache } from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../../database.ts";
import type { TrefferArt } from "../../sprachen/treffer-auftrag.ts";
import { sprachenDerGruppe, sprachenMindestanteil } from "../../sprachen/treffer.ts";

/**
 * Die Zeile „Sprachen“ der Infoboxen von Ort, Herrschaftsgebiet, Landschaft und Weg (WI-0261 S5b; Betreiber 2026-10-30: „sprachflächen, welche mit anderen
 * objekten kollidieren, werden gelistet und kommen in den infoboxen von orten, herrschaftsgebieten, wegen, etc. zwischen "Regionen" und "Topographie" vor.
 * sprachen sind verlinkt und erhalten eine eigene infobox“).
 *
 * Gelesen wird der abgeleitete Zwischenspeicher `sprache_treffer` (S4) ab dem Mindestanteil der Karteneinstellungen (`sprachenMindestanteil`, O4); ein Ort zählt per
 * Punkt in Fläche immer. Eine Landschaft aus mehreren Regionen und ein Weg aus mehreren Abschnitten sind EIN Gegenstand: Ihr Anteil ist nach Fläche bzw. Länge der
 * Mitglieder gewichtet (`sprachenDerGruppe`).
 *
 * Eingehängt wird mit EINER Zeile je Detail (`...(await sprachenAbschnitt(...))`): Ohne Treffer fehlt das Feld, die Zeile entfällt (WI-0063 5.3). Vor dem Einspielen
 * der Sprachflächen (S6) ist das eine Abfrage über den Primärschlüssel der Tafel, die nichts findet; die Karteneinstellungen liest erst ein Treffer unter Vorbehalt.
 */
export async function sprachenAbschnitt(
    database: Database,
    art: TrefferArt,
    publicIds: readonly string[],
): Promise<{ sprachen?: SubjectSprache[] }> {
    // Alle Berührungen in der Zeitgrenze, die Schwelle danach: Ihr Leser fängt eine fehlende Tafel ab, das bräche eine laufende Transaktion ab.
    const alle = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, (tx) =>
        sprachenDerGruppe(tx, art, publicIds, 0),
    );
    if (alle.length === 0) return {};
    const schwelle = art === "place" ? 0 : await sprachenMindestanteil(database);
    const zeilen = alle.filter((zeile) => zeile.anteil >= schwelle);
    if (zeilen.length === 0) return {};
    return {
        sprachen: zeilen.map((zeile) => ({
            ref: { kind: "sprache", id: zeile.id },
            name: zeile.name,
            farbe: zeile.farbe,
            anteil: Math.min(1, Math.max(0, zeile.anteil)),
        })),
    };
}
