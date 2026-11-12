import type { PlaceRemovalKraftlinie, PlaceRemovalStaette, PlaceTakeOffMapBody } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import type { PlaceRow } from "./place-edit.ts";

/**
 * Was „Ort entfernen“ sperrt (WI-0128 E22), an EINER Stelle für Abnehmen (`place-edit.ts`) und Löschen (`place-removal.ts`): eine
 * Kraftlinie am Ort (D20, wie Legacy) und bis E18 alles, was Stätten bewegt. Ohne Laufzeitabhängigkeit zu `place-edit.ts` (nur der Typ).
 *
 * 🔴 ZWEI BINDUNGEN, GETRENNT GEHALTEN (Qualitätsreview 2026-10-12, Befund Q-01; Handover „Mit dem Kennungsmodell abgleichen …
 * Identitäten getrennt halten.“). Eine Stätte hängt am Ort über
 *
 * 1. den **gefalteten Siedlungsnamen** (`settlement_place.settlement_key`, 0078) — Legacys einzige Bindung für die große Mehrheit
 *    (Stand 2026-10-12: 3.793 Zeilen an 384 Orten) und weiter die Quelle der heutigen Leser (0099: „erweitern, nicht umstellen“);
 * 2. **Legacys gespeicherte Kennung der Siedlung** (`site_settlement`, 0099, WI-0134) — die feste Bindung, die ein Umbenennen
 *    überlebt und gleichnamige Orte auseinanderhält.
 *
 * 🪤 Die Namensregel allein reichte nicht: Vier Stätten im Stand vom 2026-10-12 sind über die Kennung an „Fuchswalden (Bärenau)“ und
 * „Siebeneichen (Bärenau)“ gebunden, ihr `settlement_key` („fuchswalden (siebeneichen)“, „siebeneichen (dorf)“) trifft dagegen
 * KEINEN Ort. Die Vorschau sagte dort „keine Stätten“, und der Server ließ das Entfernen zu. Beide Regeln gelten darum zusammen; die
 * Kennungsregel überspringt, was die Namensregel am selben Ort schon nennt. Kein Ort verliert dadurch Schutz.
 */

const KRAFTLINIE_SPERRT = "Am Ort endet eine Kraftlinie. Erst die Kraftlinie lösen.";
const E10B = "heißt, ihn aus seiner Stadt zu lösen; das ist eine eigene Operation (E10b)";

export interface StaettenStand {
    /** Die Stätten über den gefalteten Siedlungsnamen (0078). */
    eigene: number;
    /** Zusätzlich die über Legacys gespeicherte Kennung gebundenen (0099), die der Name am selben Ort nicht schon nennt. */
    ueberKennung: number;
    innerortsVon: string | null;
}

/**
 * Die Stätten am Ort für das Blatt „Ort entfernen“: erst die über den Namen gebundenen (Legacys Reihenfolge), dann die nur über die
 * Kennung gebundenen. Eine Stätte steht genau einmal da.
 *
 * Die Kennungsregel (0099) trifft den Ort über Legacys gespeicherte Kennung der Siedlung oder über die vom Menschen gesetzte
 * Beziehung (`site_settlement.place_id`, Herkunft `editor`). Über die `public_id` gilt sie auch für einen Ort ohne Lage, der gar
 * keine `place.id` hat.
 */
export async function staettenAm(
    sql: Queryable,
    row: Pick<PlaceRow, "name" | "public_id">,
): Promise<PlaceRemovalStaette[]> {
    const zeilen = await sql<{ name: string; art: string | null }[]>`
        SELECT z.name, z.art FROM (
            SELECT sp.name, sp.place_type AS art, 0 AS quelle FROM settlement_place sp
             WHERE sp.is_active AND sp.state = 'active' AND sp.settlement_key = lower(btrim(${row.name}))
            UNION ALL
            SELECT s.name, s.site_type AS art, 1 AS quelle
              FROM site s JOIN site_settlement ss ON ss.site_id = s.id
             WHERE s.is_active AND ss.is_active
               AND (ss.settlement_legacy_public_id = ${row.public_id}::uuid
                    OR ss.place_id = (SELECT p.id FROM place p WHERE p.public_id = ${row.public_id}::uuid))
               AND NOT EXISTS (SELECT 1 FROM settlement_place sp
                                WHERE sp.is_active AND sp.state = 'active'
                                  AND sp.settlement_key = lower(btrim(${row.name})) AND sp.name = s.name)
        ) z
         ORDER BY z.quelle, lower(z.name), z.name
    `;
    return zeilen.map((zeile) => ({
        name: zeile.name,
        ...(zeile.art !== null && zeile.art !== "" ? { art: zeile.art } : {}),
    }));
}

/** Die Stätten am Ort (beide Bindungen, je für sich gezählt) und, ob er selbst ein innerorts-Punkt einer Stadt ist. */
export async function staettenStand(sql: Queryable, row: Pick<PlaceRow, "name" | "public_id">): Promise<StaettenStand> {
    const [stand] = await sql<StaettenStand[]>`
        SELECT (SELECT count(*)::int FROM settlement_place sp
                 WHERE sp.is_active AND sp.state = 'active' AND sp.settlement_key = lower(btrim(${row.name}))) AS eigene,
               (SELECT count(*)::int
                  FROM site s JOIN site_settlement ss ON ss.site_id = s.id
                 WHERE s.is_active AND ss.is_active
                   AND (ss.settlement_legacy_public_id = ${row.public_id}::uuid
                        OR ss.place_id = (SELECT p.id FROM place p WHERE p.public_id = ${row.public_id}::uuid))
                   AND NOT EXISTS (SELECT 1 FROM settlement_place sp
                                    WHERE sp.is_active AND sp.state = 'active'
                                      AND sp.settlement_key = lower(btrim(${row.name})) AND sp.name = s.name)) AS "ueberKennung",
               (SELECT sp.settlement_name FROM settlement_place sp
                 WHERE sp.is_active AND sp.on_map AND sp.legacy_public_id = ${row.public_id}::uuid
                 ORDER BY sp.settlement_name LIMIT 1) AS "innerortsVon"
    `;
    return stand ?? { eigene: 0, ueberKennung: 0, innerortsVon: null };
}

/** Die Kraftlinien, die am Ort enden, je Name und Gegenüber einmal (eine Linie hat viele Abschnitte). */
export async function kraftlinienAm(sql: Queryable, publicId: string): Promise<PlaceRemovalKraftlinie[]> {
    const linien = await sql<{ name: string; gegenueber: string | null }[]>`
        SELECT DISTINCT pl.name, coalesce(o.name, ou.name, k.name) AS gegenueber
          FROM powerline pl
          LEFT JOIN place o ON o.is_active
               AND o.public_id = CASE WHEN pl.from_public_id = ${publicId}::uuid THEN pl.to_public_id ELSE pl.from_public_id END
          LEFT JOIN place_unplaced ou ON o.id IS NULL AND ou.is_active
               AND ou.public_id = CASE WHEN pl.from_public_id = ${publicId}::uuid THEN pl.to_public_id ELSE pl.from_public_id END
          LEFT JOIN terrain_peak k ON o.id IS NULL AND ou.id IS NULL AND k.is_active
               AND k.public_id = CASE WHEN pl.from_public_id = ${publicId}::uuid THEN pl.to_public_id ELSE pl.from_public_id END
         WHERE pl.is_active AND (pl.from_public_id = ${publicId}::uuid OR pl.to_public_id = ${publicId}::uuid)
         ORDER BY pl.name, gegenueber
    `;
    return linien.map((linie) => ({
        name: linie.name,
        ...(linie.gegenueber !== null ? { gegenueber: linie.gegenueber } : {}),
    }));
}

/** Kraftlinie und das Verlagern einer Stätte: die Gründe, aus denen der Server ein Entfernen ablehnt. */
export async function pruefeEntfernen(
    tx: Sql,
    row: PlaceRow,
    weg: "abnehmen" | "loeschen",
    staetten: PlaceTakeOffMapBody["staetten"],
): Promise<void> {
    if ((await kraftlinienAm(tx, row.public_id)).length > 0)
        throw new ApiError(400, "validation_failed", KRAFTLINIE_SPERRT, { field: "kraftlinien" });
    await pruefeStaetten(tx, row, weg, staetten);
}

/** Was vom Entfernen bleibt, wenn die Kraftlinien mitgehen: Die Umwandlung in eine Landmarke (WI-0271 §17) hängt sie um, statt an ihnen zu scheitern. */
export async function pruefeStaetten(
    tx: Sql,
    row: PlaceRow,
    weg: "abnehmen" | "loeschen",
    staetten: PlaceTakeOffMapBody["staetten"],
): Promise<void> {
    const stand = await staettenStand(tx, row);
    if (stand.innerortsVon !== null)
        throw new ApiError(
            400,
            "validation_failed",
            `Dieser Ort ist ein innerorts-Punkt von ${stand.innerortsVon}; ihn zu entfernen ${E10B}.`,
            { field: "staetten" },
        );
    // Beide Bindungen zusammen: der gefaltete Name (0078) und Legacys gespeicherte Kennung (0099). Siehe Kopf der Datei.
    const am = stand.eigene + stand.ueberKennung;
    // 🔴 Löschen geht jetzt MIT Stätten (E22 G2): Die Beziehungen gehen in derselben Transaktion still und kommen mit
    // `place.restore` zurück (`stillgelegteStaetten`). Abnehmen fragt weiter, was mit ihnen geschieht.
    if (am > 0 && weg === "abnehmen" && staetten !== "bleiben")
        throw new ApiError(
            400,
            "validation_failed",
            `An diesem Ort hängen ${String(am)} Stätten; das Blatt „Ort entfernen“ fragt, was mit ihnen geschieht.`,
            { field: "staetten" },
        );
}

/**
 * E22 G2: Mit der Siedlung gehen ihre belegten Innerorts-Beziehungen still - in DERSELBEN Transaktion und umkehrbar. Gibt die
 * Kennungen der stillgelegten Zeilen zurück; sie stehen im Fachprotokoll, und nur sie holt `place.restore` zurück.
 *
 * 🔴 Die Zeilen werden gesperrt, bevor sie gelesen werden (`FOR UPDATE`): Vorschau und Operation sollen dieselbe Menge sehen, und
 * eine gleichzeitige Zuordnung derselben Stätte darf nicht halb durchkommen. Die Transaktion der Operation umschließt beides.
 *
 * 🪤 Legacys Zeilen über den gefalteten Namen (`settlement_place`, 0078) werden NICHT angefasst: Sie tragen keinen Bezug auf
 * diesen Ort, sondern auf seinen Namen. Sie verschwinden von selbst aus jedem Leser, weil der die aktiven Orte fragt - und sie
 * gehören weiter zu einem gleichnamigen Ort, falls es einen gibt.
 */
export async function stillegeStaetten(tx: Sql, row: Pick<PlaceRow, "public_id">): Promise<string[]> {
    // 🔴 DIESELBE Bedingung wie die Vorschau (`staettenAm`, `staettenStand`): über Legacys gespeicherte Kennung ODER über die
    // gesetzte `place_id`. Ein Ort ohne Lage hat keine `place.id`, seine Stätten hängen allein an der `public_id`; mit einem
    // bloßen Join über `place` hätte das Löschen sie stehen lassen, obwohl die Vorschau sie nannte (gemessen).
    const zeilen = await tx<{ id: string }[]>`
        SELECT ss.id::text AS id
          FROM site_settlement ss
         WHERE ss.is_active
           AND (ss.settlement_legacy_public_id = ${row.public_id}::uuid
                OR ss.place_id = (SELECT p.id FROM place p WHERE p.public_id = ${row.public_id}::uuid))
         ORDER BY ss.id
           FOR UPDATE OF ss
    `;
    const ids = zeilen.map((zeile) => zeile.id);
    if (ids.length > 0)
        await tx`
            UPDATE site_settlement
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
             WHERE id = ANY(${ids}::bigint[])
        `;
    return ids;
}

/**
 * ↺ eines `place.delete`: Genau die Beziehungen zurück, die damals mitgingen - und nur, solange sie seitdem niemand angefasst
 * hat (`retired_origin = 'editor'`). Gibt zurück, wie viele wirklich zurückkamen; eine Lücke ist ein Befund, kein Fehler.
 */
export async function holeStaettenZurueck(tx: Sql, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const zurueck = await tx<{ id: string }[]>`
        UPDATE site_settlement
           SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
         WHERE id = ANY(${[...ids]}::bigint[]) AND NOT is_active AND retired_origin = 'editor'
        RETURNING id::text AS id
    `;
    return zurueck.length;
}
