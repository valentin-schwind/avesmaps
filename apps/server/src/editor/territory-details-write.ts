import {
    EDITOR_TERRITORY_DETAIL_FIELDS,
    type EditorTerritoryDetailField,
    type FeldHerkunft,
    type TerritoryDetailChanges,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import type { MapChange } from "./map-operation.ts";
import { leseWikiStand } from "./territories.ts";

/**
 * Die 17 Detailfelder eines Herrschaftsgebiets schreiben (WI-0209 G6; Wiki-Feld WI-0225, Modell c; Vertrag `TerritoryDetailChanges`;
 * Speicher Migration 0076, Schnappschuss 0162). Ein Teil von `territory.update`: in derselben Transaktion, gegen dieselbe Revision.
 *
 * - **`{ value }`** ist ein eigener Wert: getrimmt, Herkunft `override` (im Protokoll und im Wiki-Feld „manual“). `""` ist der bewusste
 *   Leerwert, der den Wiki-Wert verdeckt (0076: nur mit `override`). **`{ value: null }`** ist kein Wert und kein Vermerk (↺ im Verlauf
 *   an einem Feld, das vorher keinen Wert hatte).
 * - **`{ revert: "wiki" }`** holt den Wert aus `wiki_territory_snapshot`: ein Text mit Herkunft `wiki`; kennt das Wiki keinen Wert, hat
 *   das Feld danach keinen (ohne Vermerk, „kein Wert hat keinen Vermerk“); ist der Wiki-Wert unbekannt (`wiki_territory_snapshot_unknown`,
 *   kein Artikel oder kein Schnappschuss), 400 mit Satz. Die 286 Felder ohne Wiki-Wert warten so auf den Wiki-Abgleich.
 * - **Die Zeile** `territory_detail` entsteht mit dem ersten Wert (`source_system = 'avesmaps3d'`), legt sich still, wenn kein Feld mehr
 *   einen Wert trägt (`retired_origin = 'editor'`, wie der Import mit `import`), und lebt wieder auf. Die Vermerke in
 *   `territory_detail_field_origin` folgen je Feld; ein Feld ohne Wert verliert seinen.
 * - **Protokoll:** je geändertem Feld der Wert vorher und nachher und `<feld>Origin` (`wiki` oder `manual`, wie der Ort), damit ↺ im
 *   Verlauf einen Wert, der dem Wiki folgte, als Wiki-Wert zurückholt (`wikiRuecknahme`, `fenster/entwurf-verlauf.ts`).
 */

interface DetailZeile {
    id: string;
    is_active: boolean;
    werte: Record<EditorTerritoryDetailField, string | null>;
    herkunft: Map<EditorTerritoryDetailField, "override" | "wiki">;
}

const ungueltig = (satz: string, details?: Record<string, unknown>): ApiError =>
    new ApiError(400, "validation_failed", satz, details);

/** Herkunft im Wortschatz des Wiki-Felds (`FeldHerkunft`): `override` ist manual. */
const alsHerkunft = (origin: "override" | "wiki" | undefined): FeldHerkunft | null =>
    origin === undefined ? null : origin === "wiki" ? "wiki" : "manual";

async function leseDetail(tx: Sql, territoryRowId: string): Promise<DetailZeile | undefined> {
    const [zeile] = await tx<(Record<string, string | null> & { id: string; is_active: boolean })[]>`
        SELECT d.*, d.id::text AS id FROM territory_detail d WHERE d.territory_id = ${territoryRowId}::bigint FOR UPDATE
    `;
    if (zeile === undefined) return undefined;
    const herkunft = new Map<EditorTerritoryDetailField, "override" | "wiki">();
    for (const v of await tx<{ field: EditorTerritoryDetailField; origin: "override" | "wiki" }[]>`
        SELECT field, origin FROM territory_detail_field_origin WHERE territory_detail_id = ${zeile.id}::bigint
    `)
        herkunft.set(v.field, v.origin);
    const werte = Object.fromEntries(
        EDITOR_TERRITORY_DETAIL_FIELDS.map((f) => [f, zeile[f] ?? null]),
    ) as DetailZeile["werte"];
    return { id: zeile.id, is_active: zeile.is_active, werte, herkunft };
}

/**
 * Schreibt die Detailfelder in der Transaktion `tx` und gibt die Änderungen fürs Fachprotokoll zurück (leer, wenn sich nichts änderte).
 * `wikiKey` ist der Artikel des Gebiets (`territory.wiki_key`), aus dessen Schnappschuss ↺ liest.
 */
export async function schreibeDetails(
    tx: Sql,
    territoryRowId: string,
    wikiKey: string | null,
    details: TerritoryDetailChanges,
): Promise<Record<string, MapChange>> {
    const felder = EDITOR_TERRITORY_DETAIL_FIELDS.filter((f) => details[f] !== undefined);
    if (felder.length === 0) return {};
    const alt = await leseDetail(tx, territoryRowId);
    const stand = felder.some((f) => details[f] !== undefined && "revert" in details[f]!)
        ? await leseWikiStand(tx, wikiKey)
        : undefined;
    const werte = {
        ...(alt?.werte ?? Object.fromEntries(EDITOR_TERRITORY_DETAIL_FIELDS.map((f) => [f, null]))),
    } as DetailZeile["werte"];
    const herkunft = new Map(alt?.herkunft ?? []);
    const changes: Record<string, MapChange> = {};
    const geaendert: EditorTerritoryDetailField[] = [];
    for (const feld of felder) {
        const aenderung = details[feld]!;
        let wert: string | null;
        let origin: "override" | "wiki" | undefined;
        if ("revert" in aenderung) {
            if (stand === undefined || !stand.has(feld))
                throw ungueltig(
                    "Den Wiki-Wert dieses Felds kennt der Editor noch nicht; ↺ geht hier erst mit dem Wiki-Abgleich.",
                    {
                        field: feld,
                        reason: "wiki_unbekannt",
                    },
                );
            wert = stand.get(feld) ?? null;
            origin = wert === null ? undefined : "wiki";
        } else if (aenderung.value === null) {
            wert = null;
            origin = undefined;
        } else {
            wert = aenderung.value.trim();
            origin = "override";
        }
        const wertVorher = werte[feld];
        const vorher = herkunft.get(feld);
        if (wertVorher === wert && vorher === origin) continue;
        geaendert.push(feld);
        werte[feld] = wert;
        if (origin === undefined) herkunft.delete(feld);
        else herkunft.set(feld, origin);
        if (wertVorher !== wert) changes[feld] = { before: wertVorher, after: wert };
        changes[`${feld}Origin`] = { before: alsHerkunft(vorher), after: alsHerkunft(origin) };
    }
    if (geaendert.length === 0) return {};

    const traegt = EDITOR_TERRITORY_DETAIL_FIELDS.some((f) => werte[f] !== null);
    let detailId = alt?.id;
    if (alt === undefined) {
        if (!traegt) return changes;
        const neu = Object.fromEntries(geaendert.map((f) => [f, werte[f]]));
        const [zeile] = await tx<{ id: string }[]>`
            INSERT INTO territory_detail ${tx({ territory_id: territoryRowId, source_system: "avesmaps3d", ...neu })}
            RETURNING id::text AS id
        `;
        detailId = zeile!.id;
    } else {
        const neu = Object.fromEntries(geaendert.map((f) => [f, werte[f]]));
        await tx`
            UPDATE territory_detail
               SET ${tx(neu, ...geaendert)},
                   is_active = ${traegt}, state = ${traegt ? "active" : "retired"},
                   retired_at = ${traegt ? null : new Date()}, retired_origin = ${traegt ? null : "editor"},
                   updated_at = now()
             WHERE id = ${alt.id}::bigint
        `;
    }
    for (const feld of geaendert) {
        const origin = herkunft.get(feld);
        if (origin === undefined)
            await tx`DELETE FROM territory_detail_field_origin WHERE territory_detail_id = ${detailId!}::bigint AND field = ${feld}`;
        else
            await tx`
                INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
                VALUES (${detailId!}::bigint, ${feld}, ${origin})
                ON CONFLICT (territory_detail_id, field) DO UPDATE SET origin = EXCLUDED.origin
            `;
    }
    return changes;
}
