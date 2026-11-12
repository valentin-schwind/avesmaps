import type { OperationReceipt } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { resolveTerrainRecipe } from "../terrain/auswahl.ts";
import { footprintOf, footprintRingOf } from "../terrain/domain/footprint.ts";
import {
    areaIndex,
    objectKind,
    peakIndex,
    readInputIndex,
    riverIndex,
    type IndexEntry,
    type InputChange,
} from "../terrain/domain/input-index.ts";
import { istRegional } from "../terrain/hoehenmodell.ts";

/**
 * Das Gelände im Umkreis einer Änderung als Folge der Schreibnaht (WI-0223 Schritt 1; Betreiber 2026-10-18 „Geländerechnung: A“,
 * 2026-10-10 wörtlich „… beim neuen lokal die bereiche gerendert werden, die geändert wurden (das , was wir wollten)“; SYS-0001
 * §9c.11, JOBS-0001 Etappe 3).
 *
 * - **Was zählt:** genau, was in den Eingabeindex des Masters eingeht (`terrain/domain/input-index.ts`): Flächen der Topographie,
 *   der Vegetation und der Kontinent (`area`), die Gebirge mit ihrer Saat (`mountain`), Gipfel (`peak`) und Flüsse (`river`). Die
 *   Operation meldet sie unter `affected` als Teilfläche (`area`), Landschaft (`landscape`, dann zählen ihre Teilflächen), Weg
 *   (`path`), Gipfel (`peak`) oder Gebirgswerte (`terrain_control`, Kennung der Gebirgsfläche).
 * - **Nur wenn sich ein Eintrag wirklich ändert:** Der heutige Eintrag wird mit dem des geltenden Masters verglichen, mit derselben
 *   Rechnung wie im lokalen Job. Eine neue Beschriftung oder ein umbenannter Weg rechnet kein Gelände. Gebirgswerte ändern die Saat;
 *   ihr Fingerabdruck wäre hier zu teuer, sie zählen darum immer.
 * - **Nur unter einer Fassung mit regionaler Rückverteilung** (§9c.11): Unter Fassung 17 wirkt jede Änderung über die ganze Karte;
 *   dort bleibt es beim Hinweis „Gelände veraltet“ und „Gelände neu rechnen“.
 * - **Bereich:** der Fußabdruck wie im Job (`footprintOf`, Frage 7 B: Kacheln um den Rahmen vorher und nachher plus Ring). Er
 *   ist die Sperre für die Reihenfolge je Bereich; was der Job rechnet, bestimmt er beim Start aus dem Index selbst.
 * - **Zusammenfassen:** `terrain_local_enqueue` (Migrationen 0169, 0202) nimmt jede weitere Speicherung in den wartenden Lauf und
 *   schiebt seinen Start auf `GELAENDE_LOKAL_RUHE_S` nach der jüngsten Speicherung, höchstens auf `GELAENDE_LOKAL_HOECHSTENS_S` nach
 *   der ersten. Danach `dem_publish`, `routing_reload` und die Höhenlinien; `dem_publish` meldet `area.changed`.
 */

/** So heißen Gipfel und Gebirgswerte unter `affected` (für die Schreibwege der Topographie). */
export const GIPFEL_ART = "peak";
export const GEBIRGSWERTE_ART = "terrain_control";

/**
 * Warten, bis Ruhe ist (Betreiber 2026-10-18 über Claudio, wörtlich „1. A, warten bis Ruhe ist (empfohlen)“,
 * `2026-10-18-betreiber-antworten-gelaende-pruefungen-an-claudia.md` §1): gerechnet wird, wenn 60 Sekunden niemand eine Fläche, einen
 * Fluss oder einen Gipfel gespeichert hat, spätestens aber 15 Minuten nach der ersten Speicherung der Sammlung. Laufende Rechnungen bricht
 * nichts ab. Bei langer Arbeit ist das Gelände so höchstens etwa 20 Minuten alt; eine einzelne Speicherung rechnet nach einer Minute.
 *
 * Bis 2026-11-06 drei Minuten. Vali wählte 60 s auf die Frage, wie lange das Gelände nach der letzten Speicherung warten soll (WI-0283 §5c, Knopftext von Claudia).
 */
export const GELAENDE_LOKAL_RUHE_S = 60;
export const GELAENDE_LOKAL_HOECHSTENS_S = 900;

export const GELAENDE_LOKAL_JOB_KIND = "terrain_local";
export const GELAENDE_PUBLISH_JOB_KIND = "dem_publish";

type Arbeit = OperationReceipt["derivedWork"][number];

const ohneHash = (entry: IndexEntry): IndexEntry => ["", entry[1], entry[2], entry[3], entry[4]];

/**
 * Reiht nach einer Operation das Gelände im Umkreis ein, wenn sie etwas geändert hat, das ins Gelände eingeht, und gibt die Arbeit für
 * die Quittung zurück: `terrain_local` und sein `dem_publish` (den verfolgt der Editor bis zum Ende); sonst nichts. In der Transaktion
 * der Operation.
 */
export async function gelaendeNachOperation(
    tx: Queryable,
    actorRef: string,
    mapDomainId: string,
    affected: OperationReceipt["affected"],
): Promise<Arbeit[]> {
    const ids = (kind: string): string[] => [
        ...new Set(affected.filter((entity) => entity.kind === kind).map((entity) => entity.id)),
    ];
    const landschaften = ids("landscape");
    const gipfel = ids(GIPFEL_ART);
    const wege = ids("path");
    const gebirgswerte = ids(GEBIRGSWERTE_ART);
    let flaechen = ids("area");
    if (flaechen.length + landschaften.length + gipfel.length + wege.length + gebirgswerte.length === 0) return [];

    if (landschaften.length > 0) {
        const teile = await tx<{ id: string }[]>`
            SELECT a.public_id::text AS id FROM region_area a JOIN region r ON r.id = a.region_id
             WHERE a.map_domain_id = ${mapDomainId} AND r.public_id::text = ANY(${landschaften}::text[])
        `;
        flaechen = [...new Set([...flaechen, ...teile.map((teil) => teil.id)])];
    }
    // Nur Flüsse gehen ins Gelände ein; ein gewöhnlicher Weg endet hier, ohne den Master zu lesen.
    const flussKennungen =
        wege.length === 0
            ? []
            : await tx<{ id: string }[]>`
                  SELECT id::text FROM path
                   WHERE map_domain_id = ${mapDomainId} AND subtype = 'Flussweg' AND public_id::text = ANY(${wege}::text[])
              `;
    const schluessel = [
        ...flaechen.map((id) => `area:${id}`),
        ...gipfel.map((id) => `peak:${id}`),
        ...flussKennungen.map((row) => `river:${row.id}`),
        ...[...new Set([...flaechen, ...gebirgswerte])].map((id) => `mountain:${id}`),
    ];
    if (flaechen.length + gipfel.length + flussKennungen.length + gebirgswerte.length === 0) return [];
    const recipe = await resolveTerrainRecipe(tx, mapDomainId);
    if (!istRegional(recipe)) return [];

    // Vom geltenden Master nur die Einträge dieser Objekte, nicht den ganzen Index (der Haken läuft bei jeder Operation).
    const eintraege = await tx<{ v: number | null; key: string | null; value: IndexEntry | null }[]>`
        SELECT (t.input_index ->> 'v')::int AS v, e.key, e.value
          FROM terrain_dem d
          JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
          LEFT JOIN LATERAL jsonb_each(t.input_index -> 'objects') e ON e.key = ANY(${schluessel}::text[])
         WHERE d.map_domain_id = ${mapDomainId} AND d.is_current
    `;
    // Ohne Master mit Index gibt es nichts zu vergleichen: Das Gelände rechnet dann nur der volle Lauf.
    const base = readInputIndex(
        eintraege[0]?.v == null
            ? null
            : {
                  v: eintraege[0].v,
                  objects: Object.fromEntries(
                      eintraege.filter((row) => row.key !== null).map((row) => [row.key, row.value]),
                  ),
              },
    );
    if (base === null) return [];
    const heute: Record<string, IndexEntry> = {
        ...(await areaIndex(tx, mapDomainId, [...new Set([...flaechen, ...gebirgswerte])])),
        ...(await peakIndex(tx, mapDomainId, gipfel)),
        ...(await riverIndex(tx, mapDomainId, wege)),
    };

    const changes: InputChange[] = [];
    const vergleiche = (key: string): void => {
        const before = base.objects[key] ?? null;
        const after = heute[key] ?? null;
        if (before === null && after === null) return;
        if (before !== null && after !== null && before[0] === after[0]) return;
        changes.push({ key, kind: objectKind(key), before, after });
    };
    for (const id of flaechen) vergleiche(`area:${id}`);
    for (const id of gipfel) vergleiche(`peak:${id}`);
    for (const row of flussKennungen) vergleiche(`river:${row.id}`);
    // Ein Gebirge, dessen Fläche sich änderte oder dessen Werte gespeichert wurden: seine Saat, mit dem Rand der Gebirge.
    const geaenderteFlaechen = new Set(
        changes.filter((change) => change.kind === "area").map((change) => change.key.slice(5)),
    );
    for (const id of new Set([...geaenderteFlaechen, ...gebirgswerte])) {
        const before = base.objects[`mountain:${id}`] ?? null;
        const flaeche = heute[`area:${id}`];
        if (before === null && (flaeche === undefined || !gebirgswerte.includes(id))) continue;
        changes.push({
            key: `mountain:${id}`,
            kind: "mountain",
            before,
            after: flaeche === undefined ? null : ohneHash(flaeche),
        });
    }
    if (changes.length === 0) return [];

    const { tiles } = footprintOf(changes, footprintRingOf(recipe));
    const [kette] = await tx<{ local_job: string; publish_job: string | null }[]>`
        SELECT local_job::text, publish_job::text
          FROM terrain_local_enqueue(
              ${mapDomainId}, ${actorRef}, ${tiles}::smallint[], ${GELAENDE_LOKAL_RUHE_S}::int, ${GELAENDE_LOKAL_HOECHSTENS_S}::int
          )
    `;
    return [
        { kind: GELAENDE_LOKAL_JOB_KIND, jobId: kette!.local_job, state: "queued" },
        ...(kette!.publish_job === null
            ? []
            : [{ kind: GELAENDE_PUBLISH_JOB_KIND, jobId: kette!.publish_job, state: "queued" }]),
    ];
}
