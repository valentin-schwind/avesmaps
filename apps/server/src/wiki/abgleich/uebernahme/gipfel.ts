import { landmarkenSchreiber } from "./landmarken.ts";
import { LANDSCHAFTS_STAND, schreibeLandschaftsStand } from "./landschafts-stand.ts";
import type { Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Landmarken auf der Karte (WI-0253, Scheibe Gipfel; die Höhe: §21; seit WI-0271 jede Art). Die Kandidaten ohne Landmarke auf der Karte schreibt `landmarkenSchreiber` im selben Bereich und in derselben Operation (`neben`). Ein Objekt ist ein Gipfel (`terrain_peak`); sein Wiki-Stand ist der Landschafts-Stand seines Artikels
 * (`wiki_region_snapshot`, über `terrain_peak_wiki_assignment.snapshot_id`), denn das Wiki beschreibt Berge und Vulkane mit `{{Infobox Region}}` (Art „Berg“, „Vulkan“), und Legacy hängte
 * ihnen dasselbe Nest an wie einer Landschaft (`avesmapsWikiRegionBuildAssignObject`, `regions.php`). Geschrieben wird:
 *
 * - **Der Wiki-Wert** (↺, das, was das Infofenster des Gipfels als Wiki-Angaben zeigt): Name, Art, Region, Staat, Einwohner, Sprache, Vegetation, Verkehrswege, Beschreibung und die
 *   acht Nachbarn, wie bei der Landschaft (die Art behält ihren Rest hinter `|`, die Nachbarn werden Zeilen je Richtung), dazu die Höhe (`wiki_region_snapshot.height_schritt`). Den Kontinent
 *   liefert dem Gipfel kein Wiki-Teil; er bleibt.
 * - 🔴 **Am Gipfel selbst genau eine Spalte: die Höhe** (`terrain_peak.height_schritt`; Vali 2026-10-27: „wir wollen auf jeden fall, dass die werte (wenn es werte gibt) vom wiki übernommen
 *   werden!“). Name, Art und Lage gehören weiter dem Editor und dem Gelände. Die Höhe folgt dem Wiki, **solange keine Hand sie gesetzt hat**: Der Editor schreibt beim Setzen den Vermerk `manual`
 *   (`gipfelSchreiben`, `field_origin`, Art `peak`); eine Höhe OHNE Vermerk folgt dem Wiki, wo es einen Wert gibt (bewusste Ausnahme von „unbelegt ist Befund“, nur für diese Höhe). Nennt das Wiki
 *   keine Höhe, bleibt die Höhe, wie sie ist. Der Schreiber setzt den Vermerk nie: Eine Übernahme macht eine Höhe nicht zur eigenen.
 * - **Das Gelände:** Die Höhe ist ein fester Punkt des Höhenmodells (Eingabeindex, `gelaende-folgen.ts`). Ändert eine Übernahme sie, meldet die Operation den Gipfel unter `affected` und löst damit über die
 *   Schreibnaht das Gelände im Umkreis aus (`terrain_local` nach der Ruhezeit, dann `dem_publish`): keine neue Kette. Eine Übernahme, die nur den Wiki-Stand schreibt, löst nichts aus (`leitetAb`).
 *   Die Rücknahme stellt die alte Höhe her, wo sie noch die der Übernahme ist, und löst es wieder aus.
 *
 * Teilt ein Gipfel seinen Artikel mit einer Landschaft (ein Massiv und sein Hauptgipfel, gemessen: vier Artikel), schreiben beide Bereiche denselben Stand. Das ist sicher: Die Sperre
 * (`FOR NO KEY UPDATE` am Stand) stellt sie hintereinander, und wer zweitens kommt, findet den Wert schon geschrieben (kein Schritt) oder, aus einem anderen Dump, einen anderen als
 * in seiner Vorschau (Befund `seit_vorschau_geaendert`, nichts überschrieben).
 */

/** Die Spalte der Höhe am Gipfel und im Wiki-Stand. */
const HOEHE = "height_schritt";

export const gipfelSchreiber: Schreiber = {
    bereich: "gipfel",
    neben: landmarkenSchreiber,
    protokollArt: "peak",
    objektArt: "peak",
    affectedArt: "peak",
    eintragZiel: (id) => ({ peakId: id }),
    zielSpalte: "peak_public_id",
    wirksameSpalten: { height: HOEHE },
    schnappschussSpalten: { ...LANDSCHAFTS_STAND, height: HOEHE },
    // Die Höhe hat keinen Rückfall auf den Wiki-Wert (kein Leser zeigt ihn an ihrer Stelle): Ein Gipfel ohne Höhe bekommt die des Wikis in der Spalte selbst.
    fuelltLeereFelder: true,
    // Nur die Höhe geht ins Gelände ein; ein Wiki-Wert allein löst nichts aus.
    leitetAb: (schritte) => schritte.some((schritt) => schritt.wirksam !== undefined),

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        // Die Gipfel sperren wie der Editor (`FOR NO KEY UPDATE`, `leseGipfel`): Ein gleichzeitiges Speichern wartet und scheitert danach an der Revision (409). Dazu die Stände, an denen sie hängen.
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM terrain_peak
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR NO KEY UPDATE
        `;
        await tx`
            SELECT s.id
              FROM wiki_region_snapshot s
             WHERE s.is_active AND s.id IN (
                       SELECT a.snapshot_id
                         FROM terrain_peak_wiki_assignment a
                         JOIN terrain_peak tp ON tp.id = a.terrain_peak_id
                        WHERE tp.public_id = ANY(${[...ids]}::uuid[]) AND a.is_active AND a.snapshot_id IS NOT NULL
                   )
             ORDER BY s.id
               FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; snapshot: string }[]>`
            SELECT tp.public_id::text AS id, s.id::text AS snapshot
              FROM terrain_peak tp
              JOIN terrain_peak_wiki_assignment a ON a.terrain_peak_id = tp.id AND a.is_active AND a.assignment_state = 'assigned'
              JOIN wiki_region_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE tp.public_id = ANY(${[...ids]}::uuid[]) AND tp.is_active
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.snapshot]));
    },

    // Der Gipfel hat keine Regel über den Wiki-Stand hinaus: Er schreibt keinen Namen, der etwas binden könnte.
    pruefe: (_tx, schritte) => Promise.resolve({ schritte: [...schritte], befunde: [] }),

    async schreibeObjekt(tx, id, spalten) {
        const fremd = Object.keys(spalten).filter((name) => name !== HOEHE);
        if (fremd.length > 0)
            throw new Error(`Gipfel ${id}: Die Übernahme schreibt am Gipfel nur die Höhe (${fremd.join(", ")})`);
        if (HOEHE in spalten) {
            // Die Revision zählt der Trigger (ein offener Entwurf im Fenster des Gipfels bekommt 409); der Vermerk der Höhe bleibt, wie er ist.
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE terrain_peak SET height_schritt = ${spalten[HOEHE] ?? null}::int
                 WHERE public_id = ${id}::uuid AND is_active
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw new Error(`Gipfel ${id}: nicht aktiv`);
            return geschrieben.revision;
        }
        const [zeile] = await tx<{ revision: number }[]>`
            SELECT revision::int AS revision FROM terrain_peak WHERE public_id = ${id}::uuid AND is_active
        `;
        if (zeile === undefined) throw new Error(`Gipfel ${id}: nicht aktiv`);
        return zeile.revision;
    },

    async schreibeSchnappschuss(tx, schnappschussId, spalten) {
        const { [HOEHE]: hoehe, ...rest } = spalten;
        if (hoehe !== undefined) {
            await tx`
                UPDATE wiki_region_snapshot SET height_schritt = ${hoehe}::int, updated_at = now() WHERE id = ${schnappschussId}::bigint
            `;
        }
        await schreibeLandschaftsStand(tx, schnappschussId, rest);
    },
};
