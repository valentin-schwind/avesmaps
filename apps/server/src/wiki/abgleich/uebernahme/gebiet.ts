import { GEBIET_FELDER } from "../../infobox/gebiet.ts";
import type { Queryable } from "../../../database.ts";
import type { Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Herrschaftsgebiete (WI-0253 D-2). Ein Objekt ist ein Gebiet (`territory`) mit einem Satz Einzelheiten (`territory_detail`, wirksame Werte mit Herkunft je Feld in
 * `territory_detail_field_origin`: `wiki` | `override`) und einem Wiki-Stand (`wiki_territory_snapshot`, einer je Artikel, gelesen über `territory.wiki_key`). Geschrieben werden:
 *
 * - **Wirksam** die 14 Detailfelder des Abgleichs und der Kontinent (aus dem Wiki-Teil), an jedem Gebiet, dessen Wert dem Wiki FOLGT (Herkunft `wiki`; ein bewusster Leerwert oder ein
 *   Redaktionstext `override` bleibt). Ein Wert, der entfällt, nimmt seinen Vermerk mit (ein Feld ohne Wert hat keinen); ein Satz ohne ein einziges Feld wird still gelegt
 *   (`state = 'retired'`, `retired_origin = 'editor'`, wie `territory-details-write.ts`), ein stillgelegter mit Wert lebt auf. Einen Satz legt die Übernahme nie an: Ohne Satz gibt es keinen
 *   eigenen Wert, dem etwas folgt; der Leser zeigt dann den Wiki-Wert. Ein Satz im Zustand `suppressed` gehört der Redaktion (der Plan nennt ihn `unterdrückt`).
 * - **Der Wiki-Wert** (↺) derselben Felder. Ein Wert, den der Wiki-Stand als UNBEKANNT führte (Legacy lieferte ihn nie: ein Override verdeckte ihn; die 286 Felder, die auf diesen Abgleich warten),
 *   ist danach bekannt: Die Marke in `wiki_territory_snapshot_unknown` fällt, die Rücknahme setzt sie wieder.
 *
 * Name, Kürzel und Obergebiet, Farbe und Fläche des Gebiets sind keine Felder dieses Abgleichs. Die Detailfelder gehen in keine Ableitung ein (die Gebietsableitung rechnet Grenzen und
 * Obergebiete): kein Auftrag danach. Die Sperre ist die des Editors (`FOR NO KEY UPDATE` auf dem Gebiet): Ein gleichzeitiges Speichern wartet und scheitert danach an der Revision (409).
 */

const FELDER = [...GEBIET_FELDER, "continent"] as const;
const SPALTEN = Object.fromEntries(FELDER.map((feld) => [feld, feld])) as Readonly<Record<string, string>>;

export const gebietSchreiber: Schreiber = {
    bereich: "gebiet",
    protokollArt: "territory",
    objektArt: "territory",
    affectedArt: "territory",
    eintragZiel: (id) => ({ territoryId: id }),
    zielSpalte: "territory_public_id",
    wirksameSpalten: SPALTEN,
    schnappschussSpalten: SPALTEN,
    unbekanntFelder: new Set<string>(FELDER),
    leitetAb: () => false,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM territory
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR NO KEY UPDATE
        `;
        await tx`
            SELECT s.id
              FROM wiki_territory_snapshot s
             WHERE s.is_active AND s.wiki_key IN (
                       SELECT t.wiki_key FROM territory t WHERE t.public_id = ANY(${[...ids]}::uuid[]) AND t.wiki_key IS NOT NULL
                   )
             ORDER BY s.id
               FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; snapshot: string }[]>`
            SELECT t.public_id::text AS id, s.id::text AS snapshot
              FROM territory t
              JOIN wiki_territory_snapshot s ON s.wiki_key = t.wiki_key AND s.is_active
             WHERE t.public_id = ANY(${[...ids]}::uuid[]) AND t.is_active
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.snapshot]));
    },

    pruefe(_tx, schritte) {
        return Promise.resolve({ schritte: [...schritte], befunde: [] });
    },

    async schreibeObjekt(tx, id, spalten) {
        const [gebiet] = await tx<{ id: string }[]>`
            SELECT id::text AS id FROM territory WHERE public_id = ${id}::uuid AND is_active
        `;
        if (gebiet === undefined) throw new Error(`Gebiet ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        if (Object.keys(spalten).length > 0) await schreibeDetails(tx, gebiet.id, spalten);
        // Auch ohne eigene Spalte zählt das Gebiet (sie sind seine Felder, T44 (4)): `revision = revision` zählt der Trigger.
        const [zeile] = await tx<{ revision: number }[]>`
            UPDATE territory SET revision = revision WHERE id = ${gebiet.id}::bigint RETURNING revision::int AS revision
        `;
        return zeile!.revision;
    },

    async schreibeSchnappschuss(tx, schnappschussId, spalten, marken) {
        const namen = Object.keys(spalten);
        if (namen.length > 0) {
            await tx`
                UPDATE wiki_territory_snapshot
                   SET ${tx(spalten as Record<string, string | null>, ...namen)}, updated_at = now()
                 WHERE id = ${schnappschussId}::bigint
            `;
        }
        if (marken !== undefined && marken.bekannt.length > 0) {
            await tx`
                DELETE FROM wiki_territory_snapshot_unknown
                 WHERE snapshot_id = ${schnappschussId}::bigint AND field = ANY(${[...marken.bekannt]}::text[])
            `;
        }
        if (marken !== undefined && marken.unbekannt.length > 0) {
            await tx`
                INSERT INTO wiki_territory_snapshot_unknown (snapshot_id, field)
                SELECT ${schnappschussId}::bigint, f FROM unnest(${[...marken.unbekannt]}::text[]) AS f
                ON CONFLICT (snapshot_id, field) DO NOTHING
            `;
        }
    },
};

/**
 * Die Einzelheiten eines Gebiets nach der Übernahme: Wert und Vermerk je Feld, der Satz still gelegt, wenn kein Feld mehr einen Wert trägt. Es gibt nichts zu schreiben, wo das Gebiet keinen Satz
 * hat. Der Zustand `suppressed` bleibt, wie er ist (der Plan lässt ihn nie zur Übernahme zu).
 */
async function schreibeDetails(
    tx: Queryable,
    gebietZeile: string,
    felder: Readonly<Record<string, string | null>>,
): Promise<void> {
    const [satz] = await tx<(Record<string, string | null> & { id: string; state: string })[]>`
        SELECT d.*, d.id::text AS id FROM territory_detail d WHERE d.territory_id = ${gebietZeile}::bigint FOR UPDATE
    `;
    if (satz === undefined || satz.state === "suppressed") return;
    const werte = Object.fromEntries(FELDER.map((feld) => [feld, satz[feld] ?? null])) as Record<string, string | null>;
    const geaendert: string[] = [];
    for (const [feld, wert] of Object.entries(felder)) {
        if (!(FELDER as readonly string[]).includes(feld)) continue;
        const text = wert === null || wert.trim() === "" ? null : wert;
        if (werte[feld] === text) continue;
        werte[feld] = text;
        geaendert.push(feld);
    }
    // Die Spalten `political` und `trade_zone` liest der Abgleich nicht, sie zählen aber zum Satz (eine aktive Zeile trägt mindestens ein Feld).
    const traegt =
        FELDER.some((feld) => werte[feld] !== null) || satz["political"] !== null || satz["trade_zone"] !== null;
    if (geaendert.length > 0) {
        const neu = Object.fromEntries(geaendert.map((feld) => [feld, werte[feld]]));
        await tx`
            UPDATE territory_detail
               SET ${tx(neu, ...geaendert)},
                   is_active = ${traegt}, state = ${traegt ? "active" : "retired"},
                   retired_at = ${traegt ? null : new Date()}, retired_origin = ${traegt ? null : "editor"},
                   updated_at = now()
             WHERE id = ${satz.id}::bigint
        `;
    }
    for (const feld of geaendert) {
        if (werte[feld] === null) {
            await tx`DELETE FROM territory_detail_field_origin WHERE territory_detail_id = ${satz.id}::bigint AND field = ${feld}`;
        } else {
            await tx`
                INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
                VALUES (${satz.id}::bigint, ${feld}, 'wiki')
                ON CONFLICT (territory_detail_id, field) DO NOTHING
            `;
        }
    }
}
