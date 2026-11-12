import { createHash } from "node:crypto";
import { WEGFINDUNG_NETZ, WEGFINDUNG_VON_SELBST, type TravelModel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Revision der Daten, aus denen der Routing-Worker rechnet - die Naht für die Routing-Invalidierung
 * (Hardening Review 2026-09-28, M6; Kap. 6.15, 6.48, 6.50). Sie ist **keine** Editor-Invalidierung: Sie
 * benennt nur, woraus ein Stand besteht, damit Phase 6 gezielt invalidieren und ein Ergebnis auf einen
 * reproduzierbaren Stand zurückführen kann.
 *
 * Jeder Teil steht für eine Gruppe von Tabellen, die ein Loader liest:
 *
 * - **Inhalts-Identität, wo es sie gibt.** Die abgeleiteten Tabellen tragen den Fingerabdruck ihrer Eingaben
 *   (`terrain_raster.fingerprint`, `terrain_path_profile.height_fingerprint`, `climate_band.source_fingerprint`,
 *   `sea_route_graph.source_fingerprint`); ihre Ableitungen schreiben nur bei geändertem Fingerabdruck. Er ist
 *   damit die Identität des Inhalts und stimmt zwischen Umgebungen überein, wo die Daten dieselben sind.
 * - **Änderungsmelder sonst.** Redaktionelle Tabellen ohne Inhalts-Hash (Orte, Wege, Flächen, Gipfel, Regler)
 *   stehen als Anzahl und `max(updated_at)`; zwischen Umgebungen weicht er ab, weil Importzeitpunkte eingehen.
 * - **`null` heißt: der Teil fehlt** (nichts abgeleitet). Das Erscheinen eines Teils ist eine Änderung.
 */
export interface RoutingDataRevision {
    /** Orte, Wege, Regionen und Flächen (Anzahl und letzte Änderung); seit WI-0132 Release N ohne Kreuzungen. */
    map: string;
    /** Das Reisemodell, mit dem Flüsse, Böden und das Gelände geladen wurden (`travelModelVersion`). */
    travelModel: string;
    /**
     * Gebirgsraster (Inhalts-Identität), dazu Gipfel, Regler und die Flächen, gegen die die freien Gipfel geprüft
     * werden; null ohne abgeleitetes Gelände. Die Flächen stehen auch in `map`: Eine Ortsänderung lässt das Gelände
     * stehen, eine Flächenänderung nicht.
     */
    terrain: string | null;
    /** Die Höhenprofile der Wege (Inhalts-Identität); null ohne Profile. */
    pathProfiles: string | null;
    /** Der Seegraph der freien Seefahrt: Algorithmus und Fingerabdruck seiner Quellen; null ohne Seegraph. */
    seaGraph: string | null;
    /** Die abgeleiteten Klimabänder (Inhalts-Identität); null ohne Bänder. */
    climate: string | null;
    /**
     * Die Zollgebiete (WI-0065): die Ableitung der Herrschaftsgebiete (`territory_state.derived_revision`, der
     * Inhalts-Fingerabdruck samt Anzeigejahr) und die Gebiete selbst; null ohne Ableitung (dann ist der Zoll nicht
     * ermittelbar). Sie steht nicht im Korpus-Gate: Kosten ändern keinen Weg.
     */
    territories: string | null;
    /**
     * Die FREIGEGEBENEN Kenngrößen, die am Knopf hängen (WI-0153 Schnitt 6, Tafel `routing_setting_applied`, Folge
     * `netz`, `WEGFINDUNG_NETZ`): Inhalts-Identität aus Anzahl und Hash über Kennung und Zahl. `null`, solange die Tafel
     * fehlt (vor Migration 0135) — dann gelten die Vorgaben des Registers. Die freigegebenen Werte der Folge `seegraph`
     * stehen nicht hier: Sie wirken über den neuen Graphen (Teil `seaGraph`, WI-0153 7c).
     *
     * 🔴 **Für diese Kennungen nicht die gespeicherten Werte.** Sonst holte sich jeder Worker eine Änderung binnen
     * fünf Sekunden von selbst, und der Knopf über den Panelen wäre Zierde; „gilt erst nach dem Neuberechnen“ wäre
     * eine Lüge. Sie kosten einen Netzaufbau, und darum entscheidet ein Mensch, wann er stattfindet.
     */
    settings: string | null;
    /**
     * Die GESPEICHERTEN Kenngrößen, die ohne Knopf gelten (Tafel `routing_setting`, Folge `sofort` und `zeichnung`):
     * dieselbe Inhalts-Identität, nur aus der anderen Tafel und über die anderen Kennungen.
     *
     * 🔴 **Hier ist der gespeicherte Stand richtig.** Diese Werte baut niemand; der Dienst liest sie je Anfrage oder
     * beim Zusammenstellen des nächsten Stands. Sie an den Knopf zu hängen hieße, 39 Zeilen zu einer Aufforderung zu
     * machen, die sie nicht brauchen — der Betreiber hat die vier Wirkungsklassen genau so gutgeheißen.
     *
     * 🪤 Kein Bestandteil des Datenstands hängt an diesem Teil (`DATA_PART_INPUTS`): Eine Änderung lädt nichts neu,
     * sie wechselt nur den Stand und stellt die Zahlen um (`setzeWerte`, gemessen 0,4 bis 0,55 s fürs Vorbereiten).
     */
    settingsLive: string | null;
}

/** Die Teile in fester Reihenfolge: Sie bestimmt den Schlüssel und die Ausgabe von `changedParts`. */
export const ROUTING_REVISION_PARTS = [
    "map",
    "travelModel",
    "terrain",
    "pathProfiles",
    "seaGraph",
    "climate",
    "territories",
    "settings",
    "settingsLive",
] as const satisfies readonly (keyof RoutingDataRevision)[];

export type RoutingRevisionPart = (typeof ROUTING_REVISION_PARTS)[number];

const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 12);

/** Die Version des Reisemodells: ein Hash über seinen Inhalt (`travel_model_version` im Ergebnis). */
export function travelModelVersion(model: TravelModel): string {
    return shortHash(JSON.stringify(model));
}

/**
 * Der Kurzschlüssel einer Revision, zwölf Hexzeichen: das ist die `routing_graph_revision` im Ergebnis. Gleiche
 * Teile geben denselben Schlüssel, jeder andere Teil einen anderen; `null` und der Text „null“ unterscheiden sich.
 */
export function revisionKey(revision: RoutingDataRevision): string {
    return shortHash(JSON.stringify(ROUTING_REVISION_PARTS.map((part) => revision[part])));
}

/**
 * Der Kurzschlüssel eines einzelnen Teils (12 Hexzeichen) für das Ergebnis - `map_revision` und
 * `terrain_revision` (Plan 6.48): Woran hing eine Route, wenn sie sich zwischen zwei Anfragen ändert? Null bleibt
 * null (Teil fehlt). Wie die `routing_graph_revision` nur innerhalb einer Umgebung vergleichbar, denn `map` und die
 * Gipfel/Regler im Teil `terrain` zählen Anzahl und letzte Änderung.
 */
export function partKey(part: string | null): string | null {
    return part === null ? null : shortHash(part);
}

/**
 * Welche Teile sich zwischen zwei Revisionen unterscheiden, in der Reihenfolge von `ROUTING_REVISION_PARTS`.
 * Ohne Vorgänger (erstes Laden) ist alles neu.
 */
export function changedParts(before: RoutingDataRevision | null, after: RoutingDataRevision): RoutingRevisionPart[] {
    return ROUTING_REVISION_PARTS.filter((part) => before === null || before[part] !== after[part]);
}

/** Die geladenen Bestandteile eines Datenstands (`RoutingData` ohne Revision und Seegraph, der erst auf Verlangen kommt). */
export type RoutingDataPart =
    "network" | "water" | "land" | "rivers" | "ground" | "climate" | "heights" | "territories";

/**
 * Von welchen Teilen der Revision jeder Bestandteil abhängt - nach den Tabellen seines Loaders. Ändert sich keiner
 * dieser Teile, ist der Bestandteil derselbe, und ein neuer Stand übernimmt den alten, statt ihn zu laden (Hardening
 * Review, Nachtrag zu M6: das Gelände allein hält 8,9 MB, und zwei Stände hielten es gleichzeitig).
 *
 * 🔴 Diese Tafel muss stimmen: Ein Bestandteil, der eine Tabelle liest, deren Teil hier fehlt, bliebe nach einer
 * Änderung dort auf dem alten Stand. `routing-fingerprint-coverage.test.ts` prüft sie gegen die Loader.
 */
export const DATA_PART_INPUTS: Readonly<Record<RoutingDataPart, readonly RoutingRevisionPart[]>> = {
    // 🔴 `settings` (WI-0153): Die Topologiewerte (Fangradius, Ortskasten, exakter Treffer) und der Maßstab gehen in
    // den Netzaufbau; eine FREIGEGEBENE Zahl muss das Netz neu bauen, sonst wirkt sie nie. `settingsLive` steht hier
    // mit Absicht NICHT: Diese Werte baut niemand, ihr Wechsel kostet nur das Vorbereiten.
    network: ["map", "pathProfiles", "settings"],
    water: ["map"],
    land: ["map"],
    rivers: ["map", "travelModel"],
    ground: ["map", "travelModel"],
    climate: ["climate"],
    // `settings` auch hier: `relief.ts` rechnet mit Meilen und Schritt je Karteneinheit. 🪤 Ein veraltetes Gelände
    // kostet wenig, solange der Fingerabdruck des Rasters derselbe ist — `terrain-load.ts` liest es dann nicht neu.
    heights: ["terrain", "travelModel", "settings"],
    territories: ["territories"],
};

/** Die Bestandteile in der Reihenfolge, in der der Dienst sie lädt. */
export const ROUTING_DATA_PARTS = Object.keys(DATA_PART_INPUTS) as RoutingDataPart[];

/**
 * Die Abschnitte des Teils `map`, je Tabelle Anzahl und letzte Änderung, in der Reihenfolge von `readRoutingRevision`
 * (dort mit `|` verbunden). `routing-fingerprint-coverage.test.ts` hält die Reihenfolge gegen die Abfrage.
 */
export const MAP_SEGMENTS = ["place", "path", "region", "region_area"] as const;
export type MapSegment = (typeof MAP_SEGMENTS)[number];

/**
 * Welche Abschnitte von `map` jeder Bestandteil liest, der an `map` hängt (WI-0298, Production-Server 2026-11-10: bei jeder
 * Editoränderung 1,3 bis 1,4 GB RSS). Vorher lud eine Ortsänderung auch Wasser, Land, Flüsse und Boden neu, hielt sie
 * beim Wechsel doppelt und baute die Graphen ohne die Merkzettel am Wasser (`wetChords`): gemessen 5,5 s statt 2,2 s
 * und 205 statt 172 MB lebend beim Wechsel. Jetzt lädt ein Ort nur das Netz, ein Weg Netz und Flüsse, eine Region oder
 * Fläche Wasser, Land und Boden.
 *
 * 🔴 Wie `DATA_PART_INPUTS` nach den Tabellen der Loader; `routing-fingerprint-coverage.test.ts` prüft sie dagegen.
 * Die Zwischenspeicher, die an Wasser, Sperre und Flüssen hängen, rechnen mit Koordinaten, nicht mit Kennungen: Ein
 * verschobener Ort trifft dort nie einen alten Eintrag.
 */
export const MAP_SEGMENT_INPUTS: Readonly<Partial<Record<RoutingDataPart, readonly MapSegment[]>>> = {
    network: ["place", "path"],
    water: ["region", "region_area"],
    land: ["region", "region_area"],
    rivers: ["path"],
    ground: ["region", "region_area"],
};

/** Welche Abschnitte von `map` sich geändert haben; `null`, wenn eine Seite nicht die heutige Form hat (dann gilt alles). */
function changedMapSegments(before: string, after: string): Set<MapSegment> | null {
    const a = before.split("|");
    const b = after.split("|");
    if (a.length !== MAP_SEGMENTS.length || b.length !== MAP_SEGMENTS.length) return null;
    return new Set(MAP_SEGMENTS.filter((_segment, index) => a[index] !== b[index]));
}

/**
 * Welche Bestandteile neu geladen werden müssen, wenn der Stand von `before` zu `after` wechselt. Ohne Vorgänger
 * alle; ändert sich das Reisemodell, ebenfalls alle (es steht in keiner Tabelle, aber in jedem Loader).
 */
export function staleDataParts(before: RoutingDataRevision | null, after: RoutingDataRevision): Set<RoutingDataPart> {
    const changed = new Set(changedParts(before, after));
    const everything = before === null || changed.has("travelModel");
    // Hat sich `map` geändert, zählt je Bestandteil nur, ob einer SEINER Abschnitte anders ist (`MAP_SEGMENT_INPUTS`).
    const segments = before !== null && changed.has("map") ? changedMapSegments(before.map, after.map) : null;
    const touches = (part: RoutingDataPart, input: RoutingRevisionPart): boolean => {
        if (!changed.has(input)) return false;
        if (input !== "map") return true;
        const reads = MAP_SEGMENT_INPUTS[part];
        return segments === null || reads === undefined || reads.some((segment) => segments.has(segment));
    };
    return new Set(
        ROUTING_DATA_PARTS.filter((part) => everything || DATA_PART_INPUTS[part].some((input) => touches(part, input))),
    );
}

/** Die Kennung eines Seegraphen: Algorithmus und Fingerabdruck seiner Quellen (`sea_route_graph`). */
export function seaGraphIdentity(algorithm: string, fingerprint: string): string {
    return `${algorithm}:${fingerprint}`;
}

/**
 * Liest die Revision aus der Datenbank: eine Anweisung, je Teil eine Spalte. Günstig genug für jede Prüffrist
 * des Workers; in einer Transaktion gelesen, gehört sie zu genau den Daten, die dieselbe Transaktion lädt.
 *
 * 🔴 Diese Anweisung muss jede Tabelle nennen, die ein Loader von `databaseRoutingSource` liest - sonst rechnet
 * der Worker nach einer Änderung dort bis zum Neustart mit dem alten Stand. `routing-fingerprint-coverage.test.ts`
 * prüft das aus dem Text. Das Routing liest `terrain_raster`, nicht das Höhenmodell der Kacheln.
 *
 * - **Gelände:** das Raster als Inhalts-Identität (der Fingerabdruck je Gebirge), dazu Gipfel, Regler und Flächen.
 *   `relief.ts` liest sie alle; `terrain_control` bestimmt per Flächen-Join (`region_area`), welche Gipfel als frei
 *   zählen. Ohne Raster liest der Loader weder Gipfel noch Regler, dann fehlt der ganze Teil.
 * - **Wegprofile:** Fingerabdruck der Höhen und Geometrie je Weg. Ein neuer `derive:terrain` lädt die Steigung neu;
 *   ein geänderter Weg macht sein Profil ungültig (Geometrie-Hash im Loader, Änderung im Teil `map`).
 * - **Zollgebiete** (WI-0065): die Revision der Ableitung samt Anzeigejahr, dazu Zahl und letzte Änderung der Gebiete
 *   und die Zahl der Wurzeln im Band 0. Ohne Ableitung (`derived_revision` leer) fehlt der Teil: Ein Import entwertet sie,
 *   und bis `derive:territories` gelaufen ist, gibt es keine Gebiete statt alter.
 */
export async function readRoutingRevision(
    database: Queryable,
    mapDomainId: string,
    modelVersion: string,
): Promise<RoutingDataRevision> {
    const [row] = await database<
        {
            map: string;
            terrain: string | null;
            path_profiles: string | null;
            sea_graph: string | null;
            climate: string | null;
            territories: string | null;
        }[]
    >`
        SELECT
            concat_ws('|',
                (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                 FROM place WHERE map_domain_id = ${mapDomainId}),
                (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                 FROM path WHERE map_domain_id = ${mapDomainId}),
                (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                 FROM region WHERE map_domain_id = ${mapDomainId}),
                (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                 FROM region_area WHERE map_domain_id = ${mapDomainId})
            ) AS map,
            (SELECT concat_ws('|', t.fingerprint, d.revision,
                        (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                         FROM region WHERE map_domain_id = ${mapDomainId}),
                        (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                         FROM region_area WHERE map_domain_id = ${mapDomainId}))
                FROM terrain_domain_raster t JOIN terrain_dem d ON d.map_domain_id = t.map_domain_id AND d.domain_fingerprint = t.fingerprint
                WHERE t.map_domain_id = ${mapDomainId} AND d.is_current
                ORDER BY d.is_current DESC, t.derived_at DESC, d.created_at DESC LIMIT 1) AS terrain,
            (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
                        count(*) || '/' || md5(string_agg(
                            path_id || ':' || height_fingerprint || ':' || geometry_md5, ',' ORDER BY path_id))
                    END
             FROM terrain_path_profile WHERE map_domain_id = ${mapDomainId}) AS path_profiles,
            (SELECT algorithm_version || ':' || source_fingerprint
             FROM sea_route_graph WHERE map_domain_id = ${mapDomainId}) AS sea_graph,
            (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE
                        count(*) || '/' || md5(string_agg(type_key || ':' || source_fingerprint, ',' ORDER BY type_key))
                    END
             FROM climate_band) AS climate,
            (SELECT CASE WHEN s.derived_revision IS NULL OR s.derived_year_bf IS NULL THEN NULL ELSE concat_ws('|',
                        s.derived_revision || '@' || s.derived_year_bf,
                        (SELECT count(*) FILTER (WHERE is_active) || '/' || coalesce(max(updated_at)::text, '-')
                         FROM territory WHERE map_domain_id = ${mapDomainId}),
                        (SELECT count(*)
                         FROM territory_shape sh JOIN territory t ON t.id = sh.territory_id
                         WHERE sh.band = 0 AND sh.parent_id IS NULL AND t.map_domain_id = ${mapDomainId})
                    ) END
             FROM territory_state s WHERE s.map_domain_id = ${mapDomainId}) AS territories
    `;
    if (!row) throw new Error("Die Routing-Revision ist nicht lesbar");
    return {
        map: row.map,
        travelModel: modelVersion,
        terrain: row.terrain,
        pathProfiles: row.path_profiles,
        seaGraph: row.sea_graph,
        climate: row.climate,
        territories: row.territories,
        settings: await readSettingsPart(database),
        settingsLive: await readLiveSettingsPart(database),
    };
}

/**
 * Der Teil `settings` (WI-0153): Anzahl und Hash der verstellten Kenngrößen, also die Inhalts-Identität der Tafel.
 *
 * 🪤 **Eine eigene Anweisung, nicht ein Unterausdruck der großen.** Eine Anweisung, die `routing_setting` nennt,
 * scheitert schon beim Parsen, solange die Tafel fehlt (vor Migration 0132) — und dann bekäme der Worker gar keine
 * Revision mehr. So fällt nur dieser Teil auf `null`, und der Rest bleibt lesbar. Dieselbe Transaktion, also
 * derselbe Schnappschuss.
 */
/**
 * Gibt es diese Tafel? 🔴 Erst fragen, nicht auf den Fehler warten: Die Revision wird in DERSELBEN Transaktion
 * gelesen wie die Daten (`SNAPSHOT_TRANSACTION`), und eine gescheiterte Anweisung bricht dort die ganze Transaktion ab
 * — ein `catch` auf 42P01 hilft dann nichts mehr, der nächste Lesevorgang scheitert auch. Gemessen am 2026-10-15:
 * Der Routing-Worker der Entwicklungsumgebung fiel aus, weil `routing_setting_applied` vor der Migration fehlte.
 */
const tafelDa = async (database: Queryable, name: string): Promise<boolean> => {
    const [row] = await database<{ da: boolean }[]>`SELECT to_regclass(${name}) IS NOT NULL AS da`;
    return row?.da ?? false;
};

async function readSettingsPart(database: Queryable): Promise<string | null> {
    if (!(await tafelDa(database, "public.routing_setting_applied"))) return null;
    try {
        // 🪤 Die Tabelle steht VOR dem Spaltennamen, wie bei jeder anderen Spalte: Der Deckungstest
        // (`routing-fingerprint-coverage.test.ts`) liest den Text zwischen zwei Spalten und schreibt jede gefundene
        // Tabelle dem vorderen Teil zu. 🪤 Auch ein Kommentar, der den Spaltennamen nennt, verschiebt diese Grenze.
        const [row] = await database<{ settings: string | null }[]>`
            SELECT (SELECT CASE WHEN count(*) = 0 THEN '0' ELSE
                            count(*) || '/' || md5(string_agg(key || ':' || value, ',' ORDER BY key))
                        END
                      FROM routing_setting_applied
                     WHERE key = ANY(${WEGFINDUNG_NETZ as readonly string[]}::text[])) AS settings
        `;
        return row?.settings ?? "0";
    } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "42P01") return null;
        throw error;
    }
}

/**
 * Der Teil `settingsLive` (WI-0153 Schnitt 6): dasselbe für die Kennungen, die ohne Knopf gelten — aus dem
 * GESPEICHERTEN Stand. Auch das eine eigene Anweisung, aus demselben Grund: Fehlt die Tafel (vor Migration 0132),
 * fällt nur dieser Teil auf `null`, und der Worker bekommt weiter eine Revision.
 */
async function readLiveSettingsPart(database: Queryable): Promise<string | null> {
    if (!(await tafelDa(database, "public.routing_setting"))) return null;
    try {
        const [row] = await database<{ settings_live: string | null }[]>`
            SELECT (SELECT CASE WHEN count(*) = 0 THEN '0' ELSE
                            count(*) || '/' || md5(string_agg(key || ':' || value, ',' ORDER BY key))
                        END
                      FROM routing_setting
                     WHERE key = ANY(${WEGFINDUNG_VON_SELBST as readonly string[]}::text[])) AS settings_live
        `;
        return row?.settings_live ?? "0";
    } catch (error) {
        if ((error as { code?: unknown } | null)?.code === "42P01") return null;
        throw error;
    }
}
