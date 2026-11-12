import {
    MAP_HISTORY_PAGE,
    comNummer,
    type MapHistoryEntry,
    type MapHistoryObject,
    type MapHistoryObjectKind,
    type MapHistoryPage,
    type MapHistorySeries,
    type MapHistoryStatus,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { type Serie, SerienLeser, mitgliederHash, scopeSchluessel, zerlegeScope } from "./arbeitsserie.ts";
import { akteurVon, ladeZustaende } from "./history-status.ts";
import { RUECKNEHMBARE_OPERATIONEN_LISTE, WIKISYNC_OPERATIONEN, WIKISYNC_QUELLE } from "./ruecknahme-arten.ts";

/**
 * Verlauf und „Änderungen“ lesen (WI-0128 E17; Vertrag `shared/editor-history.ts`): aus der Schreibnaht (`map_operation`,
 * `map_audit_event`, 0091), neueste zuerst, seitenweise über `seq`.
 *
 * - Ein Eintrag ist eine Operation mit ALLEN ihren Gegenständen (Ort und mitgenommene Wegenden): Der Verlauf eines Orts braucht die Wege
 *   seiner Operation, um ein Verschieben samt Wegenden zurückzunehmen.
 * - Wer: die Person mit ihrem Anzeigenamen (`avesmaps_auth.person`, ohne Fremdschlüssel) und ihrer stabilen Kennung `actor.id`, ein Agent mit dem Verweis auf
 *   die Freigabe, System und Kommandozeile mit ihrer Bezeichnung. `self` markiert die Person der Sitzung („Meine“).
 * - Die Namen sind die heutigen (Ort auch ohne Lage, Weg, Abschnitt einer Kraftlinie); ein Gegenstand, den es nicht mehr gibt, steht
 *   ohne Namen da. Ein Kraftlinienpunkt hat keinen.
 * - Der Verlauf einer Kraftlinie (WI-0205, gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`) ist jede Operation an einem ihrer heutigen
 *   Abschnitte; welche das sind, sagt der Schreibweg der Kraftlinie (`linienAbschnitte`).
 * - Der Verlauf eines Herrschaftsgebiets (WI-0209 D5) ist jede Operation, deren Protokoll das Gebiet nennt: an ihm selbst oder an einer
 *   seiner Flächen (deren Zeilen tragen das Gebiet mit). Eine Fläche heißt wie ihr Gebiet. Ebenso die Sprache (WI-0261 S5d) und ihre Teilflächen.
 * - Die Suche der „Änderungen“ (`q`) trifft eine Operation, wenn ein Gegenstand so heißt (heute oder laut Feld `name` vorher und
 *   nachher; jede Art, die ein Eintrag nennt, mit denselben Namen wie die Einträge: Ort, Weg, Kraftlinie, Derographie-Fläche samt
 *   Teilfläche und Beschriftung, Herrschaftsgebiet samt Fläche), ein geändertes Feld so heißt (Schlüssel oder, über `qFelder`, sein angezeigter Name), die Person oder Bezeichnung des
 *   Handelnden oder die Zusammenfassung den Text enthält.
 *
 * Seit WI-0265 B2a (Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md`), alles additiv und für jede Liste dasselbe (U12):
 *
 * - Jeder Eintrag trägt `status`, `revertedBy` und bei einer Rücknahme `reverts` (`history-status.ts`, aus der Link-Tafel abgeleitet) und, wenn er in einer Arbeitsserie
 *   steht, `series` (`arbeitsserie.ts`, zur Lesezeit berechnet). Die Seite trägt dazu `series[]` mit allen Mitgliedern.
 * - Die globale Liste (`mapChanges`) filtert auf dem Server (Person, Zeitraum, Art, Gegenstand, Zustand, dazu `mine` und die Suche), liefert keine Geometrie
 *   (`omitted`; die Nutzlast liefert `mapChange`, lazy) und schneidet ihre Seite an der Grenze einer Arbeitsserie (siehe dort). Die Verläufe der Gegenstände
 *   liefern die Nutzlast wie bisher: ihr ↺ braucht sie.
 */

interface OperationRow {
    operation_id: string;
    seq: string;
    at: Date;
    action: string;
    source: MapHistoryEntry["source"];
    summary: string | null;
    actor_kind: MapHistoryEntry["actor"]["kind"];
    actor_person_id: string | null;
    actor_label: string | null;
    approval_ref: string | null;
    display_name: string | null;
}

interface EventRow {
    operation_id: string;
    action: string;
    place_public_id: string | null;
    path_public_id: string | null;
    powerline_public_id: string | null;
    nodix_public_id: string | null;
    region_public_id: string | null;
    region_area_public_id: string | null;
    map_label_public_id: string | null;
    territory_public_id: string | null;
    territory_area_public_id: string | null;
    peak_public_id: string | null;
    source_public_id: string | null;
    work_public_id: string | null;
    lore_public_id: string | null;
    corpus_public_id: string | null;
    sprache_artikel_public_id: string | null;
    landmarke_artikel_public_id: string | null;
    region_artikel_public_id: string | null;
    ort_artikel_public_id: string | null;
    sprache_public_id: string | null;
    sprache_flaeche_public_id: string | null;
    revision_before: string | null;
    revision_after: string | null;
    changes: Record<string, { before?: unknown; after?: unknown; omitted?: true }>;
    name: string | null;
}

const zahl = (wert: string | null): number | null => (wert === null ? null : Number(wert));

/** Felder, deren Wert die Liste der „Änderungen“ nie trägt: Geometrie (Ringe, Linien) und das Netz des Gebirges. Sie stehen im Detail. */
const FELDER_OHNE_WERT = ["geometry", "gebirge"];
/** Ein Wert über dieser Größe (jsonb, Bytes) bleibt in der Liste weg; die Feldnamen bleiben (`omitted`). */
const WERT_GROESSE_MAX = 2048;
/** Die Felder, die eine Form tragen: Fehlt ihre alte Fassung, meldet das Detail `formFehlt`. */
const FORMFELDER = ["geometry", "gebirge", "position"];

const alsKandidat = (zeile: OperationRow) => ({
    operationId: zeile.operation_id,
    seq: Number(zeile.seq),
    at: zeile.at,
    source: zeile.source,
    action: zeile.action,
    personId: zeile.actor_person_id,
});

type Nutzlast = "voll" | "liste" | "felder";

interface EintraegeOptionen {
    /** Die Person der Sitzung (`self`). */
    personId: string | undefined;
    /**
     * Was von den Feldern kommt: `voll` (das Detail und die Verläufe der Gegenstände), `liste` (die Liste der „Änderungen“: keine Geometrie, kein Netz, keine großen
     * Werte, `omitted`) oder `felder` (nur die Namen der Felder, jedes `omitted`; die Vorprüfung der Rücknahme).
     */
    nutzlast: Nutzlast;
    /** Der Leser der Arbeitsserien dieser Anfrage (er merkt sich, was ein Nachladen schon gelesen hat). */
    leser: SerienLeser;
    /** Serien, deren passende Mitglieder außerhalb der Seite liegen, weil das Nachladen an seiner Obergrenze endete. */
    fortsetzung?: ReadonlySet<string>;
}

/**
 * Die Herkunft aus einem Community-Vorgang (WI-0268 C7, Migration 0272), je Operation der Seite in der Form `COM-000123`; eine Operation ohne Vorgang (NULL) fehlt in der Antwort.
 * Eine Abfrage je Seite, über den Teilindex `map_operation_community` nur dort, wo es einen gibt.
 */
async function leseCommunityVorgaenge(database: Queryable, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<{ operation_id: string; community_vorgang: string }[]>`
        SELECT operation_id::text AS operation_id, community_vorgang::text AS community_vorgang
          FROM map_operation
         WHERE operation_id = ANY(${ids as string[]}::uuid[]) AND community_vorgang IS NOT NULL
    `;
    return new Map(zeilen.map((zeile) => [zeile.operation_id, comNummer(zeile.community_vorgang)] as const));
}

/** Die Einträge zu den gelesenen Operationen: mit ihren Gegenständen, ihrem Zustand und ihrer Arbeitsserie; ohne Zuschnitt und ohne Cursor. */
async function baueEintraege(
    database: Queryable,
    seite: readonly OperationRow[],
    optionen: EintraegeOptionen,
): Promise<{ entries: MapHistoryEntry[]; series: MapHistorySeries[] }> {
    const ids = seite.map((zeile) => zeile.operation_id);
    const ereignisse =
        ids.length === 0
            ? []
            : await database<EventRow[]>`
                  SELECT e.operation_id::text AS operation_id, e.action, e.place_public_id::text AS place_public_id,
                         e.path_public_id::text AS path_public_id, e.powerline_public_id::text AS powerline_public_id,
                         e.nodix_public_id::text AS nodix_public_id, e.region_public_id::text AS region_public_id,
                         e.region_area_public_id::text AS region_area_public_id,
                         e.map_label_public_id::text AS map_label_public_id, e.territory_public_id::text AS territory_public_id,
                         e.territory_area_public_id::text AS territory_area_public_id, e.peak_public_id::text AS peak_public_id,
                         e.source_public_id::text AS source_public_id, e.work_public_id::text AS work_public_id, e.lore_public_id::text AS lore_public_id,
                         e.corpus_public_id::text AS corpus_public_id, e.sprache_artikel_public_id::text AS sprache_artikel_public_id,
                         e.landmarke_artikel_public_id::text AS landmarke_artikel_public_id, e.region_artikel_public_id::text AS region_artikel_public_id,
                         e.ort_artikel_public_id::text AS ort_artikel_public_id,
                         e.sprache_public_id::text AS sprache_public_id, e.sprache_flaeche_public_id::text AS sprache_flaeche_public_id,
                         e.revision_before::text AS revision_before, e.revision_after::text AS revision_after,
                         CASE ${optionen.nutzlast}::text
                              WHEN 'liste'
                              THEN (SELECT coalesce(jsonb_object_agg(t.k, CASE WHEN t.k = ANY(${FELDER_OHNE_WERT}::text[])
                                                                                   OR pg_column_size(t.v) > ${WERT_GROESSE_MAX}
                                                                               THEN '{"omitted": true}'::jsonb ELSE t.v END), '{}'::jsonb)
                                      FROM jsonb_each(e.changes) AS t(k, v))
                              WHEN 'felder'
                              THEN (SELECT coalesce(jsonb_object_agg(k, '{"omitted": true}'::jsonb), '{}'::jsonb)
                                      FROM jsonb_object_keys(e.changes) AS k)
                              ELSE e.changes END AS changes,
                         coalesce(p.name, u.name, w.name, nullif(k.name, ''), r.name, g.name, t.name, fs.title, av.title, lo.name,
                                  nullif(sc.label, ''), sc.corpus_key, sa.titel, la.titel, ra.name, oa.title, sp.name) AS name
                    FROM map_audit_event e
                    LEFT JOIN place p ON p.public_id = e.place_public_id
                    LEFT JOIN place_unplaced u ON p.id IS NULL AND u.public_id = e.place_public_id
                    LEFT JOIN path w ON w.public_id = e.path_public_id
                    LEFT JOIN powerline k ON k.public_id = e.powerline_public_id
                    LEFT JOIN region r ON r.public_id = e.region_public_id
                    LEFT JOIN territory g ON g.public_id = e.territory_public_id
                    LEFT JOIN terrain_peak t ON t.public_id = e.peak_public_id
                    LEFT JOIN feature_source fs ON fs.public_id = e.source_public_id
                    LEFT JOIN adventure av ON av.public_id = e.work_public_id
                    LEFT JOIN lore_entry lo ON lo.public_id = e.lore_public_id
                    LEFT JOIN source_corpus sc ON sc.public_id = e.corpus_public_id
                    LEFT JOIN wiki_sprache_artikel sa ON sa.public_id = e.sprache_artikel_public_id
                    LEFT JOIN wiki_landmarke_artikel la ON la.public_id = e.landmarke_artikel_public_id
                    LEFT JOIN wiki_region_snapshot ra ON ra.public_id = e.region_artikel_public_id
                    LEFT JOIN wiki_settlement_registry oa ON oa.public_id = e.ort_artikel_public_id
                    LEFT JOIN sprache sp ON sp.public_id = e.sprache_public_id
                   WHERE e.operation_id = ANY(${ids}::uuid[])
                   ORDER BY e.id
              `;
    const jeOperation = new Map<string, MapHistoryObject[]>();
    // Der Name des Gegenstands einer Serie steht an dem Protokolleintrag, dessen Scope sie ist (eine Teilfläche trägt den Namen ihrer Fläche).
    const scopeNamen = new Map<string, string>();
    for (const ereignis of ereignisse) {
        // Die Teilfläche und die Beschriftung tragen auch ihre Fläche (`region_public_id`): Sie gehen vor.
        const kind: MapHistoryObject["kind"] =
            ereignis.place_public_id !== null
                ? "place"
                : ereignis.powerline_public_id !== null
                  ? "powerline"
                  : ereignis.nodix_public_id !== null
                    ? "nodix"
                    : ereignis.region_area_public_id !== null
                      ? "area"
                      : ereignis.map_label_public_id !== null
                        ? "label"
                        : ereignis.region_public_id !== null
                          ? "landscape"
                          : ereignis.territory_area_public_id !== null
                            ? "territory_area"
                            : ereignis.territory_public_id !== null
                              ? "territory"
                              : ereignis.peak_public_id !== null
                                ? "peak"
                                : ereignis.source_public_id !== null
                                  ? "source"
                                  : ereignis.work_public_id !== null
                                    ? "work"
                                    : ereignis.lore_public_id !== null
                                      ? "lore"
                                      : ereignis.corpus_public_id !== null
                                        ? "corpus"
                                        : ereignis.sprache_artikel_public_id !== null
                                          ? "sprache_artikel"
                                          : ereignis.landmarke_artikel_public_id !== null
                                            ? "landmarke_artikel"
                                            : ereignis.region_artikel_public_id !== null
                                              ? "region_artikel"
                                              : ereignis.ort_artikel_public_id !== null
                                                ? "ort_artikel"
                                                : ereignis.sprache_flaeche_public_id !== null
                                                  ? "sprache_flaeche"
                                                  : ereignis.sprache_public_id !== null
                                                    ? "sprache"
                                                    : "path";
        const gegenstand: MapHistoryObject = {
            kind,
            id:
                ereignis.place_public_id ??
                ereignis.powerline_public_id ??
                ereignis.nodix_public_id ??
                ereignis.region_area_public_id ??
                ereignis.map_label_public_id ??
                ereignis.region_public_id ??
                ereignis.territory_area_public_id ??
                ereignis.territory_public_id ??
                ereignis.peak_public_id ??
                ereignis.source_public_id ??
                ereignis.work_public_id ??
                ereignis.lore_public_id ??
                ereignis.corpus_public_id ??
                ereignis.sprache_artikel_public_id ??
                ereignis.landmarke_artikel_public_id ??
                ereignis.region_artikel_public_id ??
                ereignis.ort_artikel_public_id ??
                ereignis.sprache_flaeche_public_id ??
                ereignis.sprache_public_id ??
                ereignis.path_public_id ??
                "",
            ...(ereignis.name !== null ? { name: ereignis.name } : {}),
            // Die Teilfläche und die Beschriftung tragen ihre Landschaft (`region_public_id`); deren Name steht an `name`, weil keine Tafel für sie einen eigenen liefert (WI-0265 B5d).
            ...((kind === "area" || kind === "label") && ereignis.region_public_id !== null
                ? {
                      landscape: {
                          id: ereignis.region_public_id,
                          ...(ereignis.name !== null ? { name: ereignis.name } : {}),
                      },
                  }
                : {}),
            // Die Fläche eines Gebiets trägt ihr Gebiet (`territory_public_id`); deren Name steht an `name` (die Tafel `territory` liefert ihn für beide).
            ...(kind === "territory_area" && ereignis.territory_public_id !== null
                ? {
                      territory: {
                          id: ereignis.territory_public_id,
                          ...(ereignis.name !== null ? { name: ereignis.name } : {}),
                      },
                  }
                : {}),
            // Die Teilfläche einer Sprache trägt ihre Sprache (`sprache_public_id`); deren Name steht an `name` (WI-0265 B6e).
            ...(kind === "sprache_flaeche" && ereignis.sprache_public_id !== null
                ? {
                      sprache: {
                          id: ereignis.sprache_public_id,
                          ...(ereignis.name !== null ? { name: ereignis.name } : {}),
                      },
                  }
                : {}),
            action: ereignis.action,
            revisionBefore: zahl(ereignis.revision_before),
            revisionAfter: zahl(ereignis.revision_after),
            changes: ereignis.changes,
        };
        jeOperation.set(ereignis.operation_id, [...(jeOperation.get(ereignis.operation_id) ?? []), gegenstand]);
        const scope = scopeSchluessel(ereignis);
        if (scope !== undefined && ereignis.name !== null) scopeNamen.set(scope, ereignis.name);
    }
    const zustaende = await ladeZustaende(
        database,
        seite.map((zeile) => ({ operationId: zeile.operation_id, source: zeile.source, operation: zeile.action })),
        optionen.personId,
    );
    const stellen = await optionen.leser.laden(seite.map(alsKandidat));
    const herkunft = await leseCommunityVorgaenge(database, ids);
    const geliefert = new Map<string, number>();
    const entries = seite.map((zeile): MapHistoryEntry => {
        const zustand = zustaende.get(zeile.operation_id) ?? {};
        const stelle = stellen.get(zeile.operation_id);
        if (stelle !== undefined) geliefert.set(stelle.serie.id, (geliefert.get(stelle.serie.id) ?? 0) + 1);
        return {
            operationId: zeile.operation_id,
            seq: Number(zeile.seq),
            at: zeile.at.toISOString(),
            operation: zeile.action,
            source: zeile.source,
            ...(zeile.summary !== null ? { summary: zeile.summary } : {}),
            actor: akteurVon(zeile, optionen.personId),
            objects: jeOperation.get(zeile.operation_id) ?? [],
            ...zustand,
            ...(stelle !== undefined
                ? { series: { id: stelle.serie.id, position: stelle.position, size: stelle.serie.mitglieder.length } }
                : {}),
            ...(herkunft.has(zeile.operation_id) ? { communityVorgang: herkunft.get(zeile.operation_id)! } : {}),
        };
    });
    const serienKoepfe = new Map<string, MapHistorySeries>();
    for (const stelle of stellen.values()) {
        const serie: Serie = stelle.serie;
        if (serienKoepfe.has(serie.id)) continue;
        const ziel = zerlegeScope(serie.scope);
        const name = scopeNamen.get(serie.scope);
        const mitglieder = serie.mitglieder.map((m) => m.operationId);
        serienKoepfe.set(serie.id, {
            id: serie.id,
            size: mitglieder.length,
            delivered: geliefert.get(serie.id) ?? 0,
            members: mitglieder,
            membersHash: mitgliederHash(mitglieder),
            scope: { kind: ziel.kind, id: ziel.id, ...(name !== undefined ? { name } : {}) },
            ...(optionen.fortsetzung?.has(serie.id) ? { continues: true as const } : {}),
        });
    }
    return { entries, series: [...serienKoepfe.values()] };
}

async function eintraege(
    database: Queryable,
    operationen: readonly OperationRow[],
    personId: string | undefined,
    limit: number,
): Promise<MapHistoryPage> {
    const seite = operationen.slice(0, limit);
    const { entries, series } = await baueEintraege(database, seite, {
        personId,
        nutzlast: "voll",
        leser: new SerienLeser(database),
    });
    const letzte = seite.at(-1);
    return {
        entries,
        ...(operationen.length > limit && letzte ? { next: Number(letzte.seq) } : {}),
        ...(series.length > 0 ? { series } : {}),
    };
}

/** Der Verlauf eines Orts: jede Operation, die ihn berührte, neueste zuerst. */
export async function placeHistory(
    database: Queryable,
    publicId: string,
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e WHERE e.operation_id = o.operation_id AND e.place_public_id = ${publicId}::uuid)
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/** Der Verlauf einer Kraftlinie: jede Operation an einem ihrer Abschnitte (`abschnitte`), neueste zuerst. */
export async function powerlineHistory(
    database: Queryable,
    abschnitte: readonly string[],
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e
                        WHERE e.operation_id = o.operation_id AND e.powerline_public_id = ANY(${[...abschnitte]}::uuid[]))
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/**
 * Der Verlauf einer Fläche der Derographie (WI-0178 D3): jede Operation, die sie, eine ihrer Teilflächen oder Beschriftungen berührte
 * (deren Ereignisse tragen die Fläche mit, `region_public_id`), neueste zuerst. Mitgezogene Ecken einer Nachbarin stehen in deren Verlauf.
 */
export async function landscapeHistory(
    database: Queryable,
    regionId: string,
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e
                        WHERE e.operation_id = o.operation_id AND e.region_public_id = ${regionId}::uuid)
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/**
 * Der Verlauf eines Gipfels oder Vulkans („Gipfel entfernen …“, Editor-Orchestrierung 2026-10-19): jede Operation, deren Protokoll ihn nennt
 * (`peak.update`, `peak.retire`, die Höhe aus der Gipfelliste des Gebirges, die Mehrfachauswahl), neueste zuerst.
 */
export async function peakHistory(
    database: Queryable,
    peakId: string,
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e
                        WHERE e.operation_id = o.operation_id
                          AND (e.peak_public_id = ${peakId}::uuid
                               -- Der Verlauf des Orts, aus dem die Landmarke entstand (WI-0271 L8): Er bleibt am Ort und gehört zu ihrer Geschichte.
                               OR e.place_public_id IN (SELECT b.ziel_public_id FROM terrain_peak_bezug b
                                                          JOIN terrain_peak t ON t.id = b.terrain_peak_id
                                                         WHERE t.public_id = ${peakId}::uuid AND b.is_active
                                                           AND b.ziel_art = 'place' AND b.rolle = 'umgewandelt_aus')))
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/** Der Verlauf eines Herrschaftsgebiets (WI-0209 D5): jede Operation, deren Protokoll das Gebiet nennt, neueste zuerst. */
export async function territoryHistory(
    database: Queryable,
    publicId: string,
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e
                        WHERE e.operation_id = o.operation_id AND e.territory_public_id = ${publicId}::uuid)
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/**
 * Der Verlauf einer Sprache (WI-0261 S5d): jede Operation, deren Protokoll die Sprache nennt (an ihr selbst, an einer ihrer Teilflächen, oder als Sprache, der ein
 * Wiki-Artikel weggenommen wurde), neueste zuerst. Eine Teilfläche heißt wie ihre Sprache.
 */
export async function spracheHistory(
    database: Queryable,
    publicId: string,
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e
                        WHERE e.operation_id = o.operation_id AND e.sprache_public_id = ${publicId}::uuid)
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/**
 * Der Verlauf einer Straße (WI-0177, EDIT-0003 T54): jede Operation an einem ihrer Abschnitte (`abschnitte`, wie das Wege-Fenster sie
 * gruppiert, `readEditorPathStreet`), neueste zuerst. Auch eine gelöschte Straße hat ihn: Aus ihm holt ↺ sie zurück.
 */
export async function pathHistory(
    database: Queryable,
    abschnitte: readonly string[],
    optionen: { before?: number | undefined; limit?: number | undefined; personId?: string | undefined },
): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const operationen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE EXISTS (SELECT 1 FROM map_audit_event e
                        WHERE e.operation_id = o.operation_id AND e.path_public_id = ANY(${[...abschnitte]}::uuid[]))
           AND o.seq < ${optionen.before ?? Number.MAX_SAFE_INTEGER}
         ORDER BY o.seq DESC
         LIMIT ${limit + 1}
    `;
    return eintraege(database, operationen, optionen.personId, limit);
}

/** Die Filter der „Änderungen“, wie die Abfrage sie braucht (`baueFilter`). */
interface Filter {
    mapDomainId: string;
    /** „Meine“: die Person der Sitzung. */
    nurPerson: string | null;
    person: string | null;
    /** Der Sammelwert `geloescht`: Personen, deren Konto es nicht mehr gibt (Fachvertrag F.3). */
    geloeschte: boolean;
    von: Date | null;
    bis: Date | null;
    kind: string | null;
    objektArt: string | null;
    objektId: string | null;
    status: MapHistoryStatus | null;
    muster: string | null;
    felder: string[];
}

/** Wo gelesen wird: Operationen unterhalb von `before` (ausschließlich), ab `ab` (einschließlich), nur diese `ids`, höchstens `limit`. */
interface Ort {
    before?: number | undefined;
    ab?: number | undefined;
    ids?: readonly string[] | undefined;
    limit?: number | undefined;
}

/**
 * Ob ein Mitglied einer Serie zu den Treffern gehört, ohne nachzufragen: Alle Mitglieder einer Serie haben dieselbe Person, und `mine` und `person` fragen
 * nur danach. Zeitraum, Art, Gegenstand, Zustand und Suche können Mitglieder trennen.
 */
const istSchlicht = (filter: Filter): boolean =>
    filter.von === null &&
    filter.bis === null &&
    filter.kind === null &&
    filter.objektArt === null &&
    filter.status === null &&
    filter.muster === null;

/**
 * Die Operationen, die der Filter trifft, neueste zuerst. Der Zustand wird hier nur grob vorgefiltert (`waehle` prüft ihn genau). `nicht_ruecknehmbar` ist dagegen exakt: die Quelle
 * (Import, Testwelt) oder die Art, die der Katalog (`ruecknahme-arten.ts`) keiner Familie zuschreibt (WI-0265 B6f), beim WikiSync alles außer der Übernahme (WI-0265 B8d); `ruecknehmbar` schließt die Arten aus, wie `ladeZustaende`.
 * Die Übernahmen des WikiSync stehen in beiden Zuständen `ruecknehmbar` und `bereits_zurueckgenommen` in der groben Auswahl; `waehle` entscheidet an `zurueckgenommen_am`.
 */
function leseOperationen(database: Queryable, filter: Filter, ort: Ort): Promise<OperationRow[]> {
    const { kind, objektArt, objektId, muster, status } = filter;
    return database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.map_domain_id = ${filter.mapDomainId}
           AND (${filter.nurPerson}::uuid IS NULL OR o.actor_person_id = ${filter.nurPerson}::uuid)
           AND (${filter.person}::uuid IS NULL OR o.actor_person_id = ${filter.person}::uuid)
           AND (NOT ${filter.geloeschte}::boolean OR (o.actor_kind = 'person' AND p.id IS NULL))
           AND (${filter.von}::timestamptz IS NULL OR o.at >= ${filter.von}::timestamptz)
           AND (${filter.bis}::timestamptz IS NULL OR o.at < ${filter.bis}::timestamptz)
           AND (${kind}::text IS NULL OR EXISTS (
                SELECT 1 FROM map_audit_event ek
                 WHERE ek.operation_id = o.operation_id
                   AND CASE ${kind}::text
                           WHEN 'place' THEN ek.place_public_id IS NOT NULL
                           WHEN 'path' THEN ek.path_public_id IS NOT NULL
                           WHEN 'powerline' THEN ek.powerline_public_id IS NOT NULL
                           WHEN 'nodix' THEN ek.nodix_public_id IS NOT NULL
                           WHEN 'landscape' THEN ek.region_public_id IS NOT NULL
                           WHEN 'area' THEN ek.region_area_public_id IS NOT NULL
                           WHEN 'label' THEN ek.map_label_public_id IS NOT NULL
                           WHEN 'territory' THEN ek.territory_public_id IS NOT NULL
                           WHEN 'territory_area' THEN ek.territory_area_public_id IS NOT NULL
                           WHEN 'peak' THEN ek.peak_public_id IS NOT NULL
                           WHEN 'source' THEN ek.source_public_id IS NOT NULL
                           WHEN 'work' THEN ek.work_public_id IS NOT NULL
                           WHEN 'lore' THEN ek.lore_public_id IS NOT NULL
                           WHEN 'corpus' THEN ek.corpus_public_id IS NOT NULL
                           WHEN 'sprache_artikel' THEN ek.sprache_artikel_public_id IS NOT NULL
                           WHEN 'landmarke_artikel' THEN ek.landmarke_artikel_public_id IS NOT NULL
                           WHEN 'region_artikel' THEN ek.region_artikel_public_id IS NOT NULL
                           WHEN 'ort_artikel' THEN ek.ort_artikel_public_id IS NOT NULL
                           WHEN 'sprache' THEN ek.sprache_public_id IS NOT NULL
                           WHEN 'sprache_flaeche' THEN ek.sprache_flaeche_public_id IS NOT NULL
                           ELSE FALSE
                       END))
           AND (${objektArt}::text IS NULL OR EXISTS (
                SELECT 1 FROM map_audit_event eo
                 WHERE eo.operation_id = o.operation_id
                   AND CASE ${objektArt}::text
                           WHEN 'place' THEN eo.place_public_id = ${objektId}::uuid
                           WHEN 'path' THEN eo.path_public_id = ${objektId}::uuid
                           WHEN 'powerline' THEN eo.powerline_public_id = ${objektId}::uuid
                           WHEN 'nodix' THEN eo.nodix_public_id = ${objektId}::uuid
                           WHEN 'landscape' THEN eo.region_public_id = ${objektId}::uuid
                           WHEN 'area' THEN eo.region_area_public_id = ${objektId}::uuid
                           WHEN 'label' THEN eo.map_label_public_id = ${objektId}::uuid
                           WHEN 'territory' THEN eo.territory_public_id = ${objektId}::uuid
                           WHEN 'territory_area' THEN eo.territory_area_public_id = ${objektId}::uuid
                           WHEN 'peak' THEN eo.peak_public_id = ${objektId}::uuid
                           WHEN 'source' THEN eo.source_public_id = ${objektId}::uuid
                           WHEN 'work' THEN eo.work_public_id = ${objektId}::uuid
                           WHEN 'lore' THEN eo.lore_public_id = ${objektId}::uuid
                           WHEN 'corpus' THEN eo.corpus_public_id = ${objektId}::uuid
                           WHEN 'sprache_artikel' THEN eo.sprache_artikel_public_id = ${objektId}::uuid
                           WHEN 'landmarke_artikel' THEN eo.landmarke_artikel_public_id = ${objektId}::uuid
                           WHEN 'region_artikel' THEN eo.region_artikel_public_id = ${objektId}::uuid
                           WHEN 'ort_artikel' THEN eo.ort_artikel_public_id = ${objektId}::uuid
                           WHEN 'sprache' THEN eo.sprache_public_id = ${objektId}::uuid
                           WHEN 'sprache_flaeche' THEN eo.sprache_flaeche_public_id = ${objektId}::uuid
                           ELSE FALSE
                       END))
           AND (${status}::text IS NULL
                OR (${status}::text = 'nicht_ruecknehmbar'
                    AND (o.source NOT IN ('editor', 'restore', ${WIKISYNC_QUELLE})
                         OR (o.source = ${WIKISYNC_QUELLE} AND o.action <> ALL(${[...WIKISYNC_OPERATIONEN]}::text[]))
                         OR (o.source IN ('editor', 'restore')
                             AND o.action <> ALL(${RUECKNEHMBARE_OPERATIONEN_LISTE as string[]}::text[])
                             AND NOT EXISTS (SELECT 1 FROM map_operation_revert_link l WHERE l.reverted_operation_id = o.operation_id))))
                OR (${status}::text = 'ruecknehmbar'
                    AND ((o.source IN ('editor', 'restore') AND o.action = ANY(${RUECKNEHMBARE_OPERATIONEN_LISTE as string[]}::text[]))
                         OR (o.source = ${WIKISYNC_QUELLE} AND o.action = ANY(${[...WIKISYNC_OPERATIONEN]}::text[]))))
                OR (${status}::text = 'bereits_zurueckgenommen'
                    AND ((o.source IN ('editor', 'restore')
                          AND EXISTS (SELECT 1 FROM map_operation_revert_link l WHERE l.reverted_operation_id = o.operation_id))
                         OR (o.source = ${WIKISYNC_QUELLE} AND o.action = ANY(${[...WIKISYNC_OPERATIONEN]}::text[])))))
           AND (${muster}::text IS NULL
                OR o.summary ILIKE ${muster} ESCAPE '\\'
                OR p.display_name ILIKE ${muster} ESCAPE '\\'
                OR o.actor_label ILIKE ${muster} ESCAPE '\\'
                OR EXISTS (
                    SELECT 1
                      FROM map_audit_event e
                      LEFT JOIN place pl ON pl.public_id = e.place_public_id
                      LEFT JOIN place_unplaced u ON pl.id IS NULL AND u.public_id = e.place_public_id
                      LEFT JOIN path w ON w.public_id = e.path_public_id
                      LEFT JOIN powerline k ON k.public_id = e.powerline_public_id
                      LEFT JOIN region r ON r.public_id = e.region_public_id
                      LEFT JOIN territory g ON g.public_id = e.territory_public_id
                      LEFT JOIN feature_source fs ON fs.public_id = e.source_public_id
                      LEFT JOIN adventure av ON av.public_id = e.work_public_id
                      LEFT JOIN lore_entry lo ON lo.public_id = e.lore_public_id
                      LEFT JOIN source_corpus sc ON sc.public_id = e.corpus_public_id
                      LEFT JOIN wiki_sprache_artikel sa ON sa.public_id = e.sprache_artikel_public_id
                      LEFT JOIN wiki_landmarke_artikel la ON la.public_id = e.landmarke_artikel_public_id
                    LEFT JOIN wiki_region_snapshot ra ON ra.public_id = e.region_artikel_public_id
                      LEFT JOIN wiki_settlement_registry oa ON oa.public_id = e.ort_artikel_public_id
                      LEFT JOIN sprache sp ON sp.public_id = e.sprache_public_id
                     WHERE e.operation_id = o.operation_id
                       AND (coalesce(pl.name, u.name, w.name, nullif(k.name, ''), r.name, g.name, fs.title, av.title, lo.name,
                                     nullif(sc.label, ''), sc.corpus_key, sa.titel, la.titel, ra.name, oa.title, sp.name) ILIKE ${muster} ESCAPE '\\'
                            OR e.changes -> 'name' ->> 'before' ILIKE ${muster} ESCAPE '\\'
                            OR e.changes -> 'name' ->> 'after' ILIKE ${muster} ESCAPE '\\'
                            OR EXISTS (
                                SELECT 1 FROM jsonb_object_keys(e.changes) k
                                 WHERE k ILIKE ${muster} ESCAPE '\\' OR k = ANY(${filter.felder}::text[])))))
           AND o.seq < ${ort.before ?? Number.MAX_SAFE_INTEGER}
           AND o.seq >= ${ort.ab ?? 0}
           AND (${ort.ids === undefined ? null : [...ort.ids]}::uuid[] IS NULL
                OR o.operation_id = ANY(${ort.ids === undefined ? null : [...ort.ids]}::uuid[]))
         ORDER BY o.seq DESC
         LIMIT ${ort.limit ?? null}
    `;
}

/** So viele Operationen prüft der genaue Zustandsfilter je Stapel, und so viele Stapel höchstens, bevor er mit `gedeckeltBei` aufhört. */
const STATUS_STAPEL = 200;
const STATUS_RUNDEN = 25;

/**
 * Die Treffer des Filters. Der Zustand `ruecknehmbar` und `bereits_zurueckgenommen` hängt an der ganzen Kette der Rücknahmen (eine Rücknahme einer Rücknahme hebt
 * die erste auf) und ist in SQL nicht ausdrückbar; die Abfrage grenzt grob ein, und hier wird stapelweise genau geprüft, derselbe Weg wie die Einträge (`ladeZustaende`),
 * damit Filter und Anzeige nie auseinanderlaufen. Reicht der Deckel nicht (selten: sehr viele Operationen ohne Treffer), meldet `gedeckeltBei` die kleinste
 * gelesene `seq`: Darunter kann es weitere Treffer geben, der Cursor der Seite zeigt dorthin.
 */
async function waehle(
    database: Queryable,
    filter: Filter,
    ort: Ort,
    personId: string | undefined,
): Promise<{ zeilen: OperationRow[]; gedeckeltBei?: number }> {
    if (filter.status !== "ruecknehmbar" && filter.status !== "bereits_zurueckgenommen")
        return { zeilen: await leseOperationen(database, filter, ort) };
    const treffer: OperationRow[] = [];
    let bis = ort.before;
    for (let runde = 0; runde < STATUS_RUNDEN; runde += 1) {
        const stapel = await leseOperationen(database, filter, { ...ort, before: bis, limit: STATUS_STAPEL });
        const zustaende = await ladeZustaende(
            database,
            stapel.map((zeile) => ({ operationId: zeile.operation_id, source: zeile.source, operation: zeile.action })),
            personId,
        );
        for (const zeile of stapel) {
            if (zustaende.get(zeile.operation_id)?.status !== filter.status) continue;
            treffer.push(zeile);
            if (ort.limit !== undefined && treffer.length >= ort.limit) return { zeilen: treffer };
        }
        if (stapel.length < STATUS_STAPEL) return { zeilen: treffer };
        bis = Number(stapel[stapel.length - 1]!.seq);
    }
    return { zeilen: treffer, ...(bis !== undefined ? { gedeckeltBei: bis } : {}) };
}

/** So oft lädt eine Seite Mitglieder nach, bevor sie eine Serie als „setzt sich fort“ markiert (jede Runde kann neue Serien hereinziehen, die über den neuen Rand reichen). */
const SERIEN_RUNDEN = 6;

export interface MapChangesOptionen {
    mapDomainId: string;
    personId: string;
    mine?: boolean | undefined;
    before?: number | undefined;
    limit?: number | undefined;
    q?: string | undefined;
    qFelder?: string | undefined;
    /** `actor.id` oder `geloescht`. */
    person?: string | undefined;
    /** Zeitraum mit Zeitzone: `from` einschließlich, `to` ausschließlich. */
    from?: string | undefined;
    to?: string | undefined;
    kind?: MapHistoryObjectKind | undefined;
    /** `<art>:<kennung>`. */
    object?: string | undefined;
    status?: MapHistoryStatus | undefined;
}

function baueFilter(optionen: MapChangesOptionen): Filter {
    const trenner = optionen.object?.indexOf(":") ?? -1;
    return {
        mapDomainId: optionen.mapDomainId,
        nurPerson: optionen.mine === true ? optionen.personId : null,
        person: optionen.person === undefined || optionen.person === "geloescht" ? null : optionen.person,
        geloeschte: optionen.person === "geloescht",
        von: optionen.from === undefined ? null : new Date(optionen.from),
        bis: optionen.to === undefined ? null : new Date(optionen.to),
        kind: optionen.kind ?? null,
        objektArt: optionen.object === undefined ? null : optionen.object.slice(0, trenner),
        objektId: optionen.object === undefined ? null : optionen.object.slice(trenner + 1),
        status: optionen.status ?? null,
        muster: optionen.q === undefined ? null : likeMuster(optionen.q),
        felder: optionen.q === undefined || optionen.qFelder === undefined ? [] : optionen.qFelder.split(","),
    };
}

/**
 * „Änderungen“: alle Operationen der Domäne oder nur die der Person, neueste zuerst, mit den Filtern des Servers (Person, Zeitraum, Art, Gegenstand, Zustand,
 * Suche; alle kombinierbar).
 *
 * 🔴 **Die Seitengrenze** (Fachvertrag B.4): Die Seite ist ein zusammenhängender Bereich der Treffer in der Reihenfolge `seq`, der Cursor `next` die kleinste gelieferte
 * `seq`, die nächste Seite beginnt darunter (`before`): nichts fehlt, nichts steht doppelt (U1). Eine Arbeitsserie, die über den unteren Rand reicht, wird bis zu ihrem
 * ältesten passenden Mitglied NACHGELADEN (der Rand rückt nach unten, die Seite wird länger als `limit`): Eine Serie steht nie auf zwei Seiten. Das Nachladen kann
 * weitere Serien über den neuen Rand ziehen; nach `SERIEN_RUNDEN` Runden hört es auf, und die Serien, die dann noch hinüberreichen, tragen `continues` („setzt sich fort“).
 * Die Mitglieder einer Serie sind immer alle bekannt (`series[].members`), auch die, die der Filter nicht trifft; geliefert werden die Treffer (`delivered`).
 * `limit` zählt Operationen, nicht Serien: Die Antwort bleibt so berechenbar, und der Cursor hängt nur an `seq`. Eine Serie wächst nur nach vorn; die Kennung ihres
 * ältesten Mitglieds ändert sich nicht, wenn später ein Eintrag dazukommt (U14).
 *
 * Die Liste trägt keine Geometrie (`omitted`): `mapChange` liefert sie lazy.
 */
export async function mapChanges(database: Queryable, optionen: MapChangesOptionen): Promise<MapHistoryPage> {
    const limit = optionen.limit ?? MAP_HISTORY_PAGE;
    const filter = baueFilter(optionen);
    const personId = optionen.personId;
    const erste = await waehle(database, filter, { before: optionen.before, limit: limit + 1 }, personId);
    let zeilen = erste.zeilen.slice(0, limit);
    let offen = erste.zeilen.length > limit;
    let schnitt: number | undefined = zeilen.length > 0 ? Number(zeilen[zeilen.length - 1]!.seq) : undefined;
    if (erste.gedeckeltBei !== undefined) {
        schnitt = Math.min(schnitt ?? erste.gedeckeltBei, erste.gedeckeltBei);
        offen = true;
    }

    // Die Serien an der Grenze vollständig machen.
    const leser = new SerienLeser(database);
    const treffer = new Map<string, number[]>();
    const trefferVon = async (serien: readonly Serie[]): Promise<void> => {
        const neu = serien.filter((serie) => !treffer.has(serie.id));
        if (neu.length === 0) return;
        if (istSchlicht(filter)) {
            for (const serie of neu)
                treffer.set(
                    serie.id,
                    serie.mitglieder.map((m) => m.seq),
                );
            return;
        }
        const gefunden = await waehle(
            database,
            filter,
            { ids: neu.flatMap((serie) => serie.mitglieder.map((m) => m.operationId)) },
            personId,
        );
        const passend = new Set(gefunden.zeilen.map((zeile) => zeile.operation_id));
        for (const serie of neu)
            treffer.set(
                serie.id,
                serie.mitglieder.filter((m) => passend.has(m.operationId)).map((m) => m.seq),
            );
    };
    const serienDerSeite = async (): Promise<Serie[]> => {
        const stellen = await leser.laden(zeilen.map(alsKandidat));
        return [...new Map([...stellen.values()].map((stelle) => [stelle.serie.id, stelle.serie] as const)).values()];
    };
    let serien = await serienDerSeite();
    for (let runde = 0; offen && schnitt !== undefined && runde < SERIEN_RUNDEN; runde += 1) {
        await trefferVon(serien);
        let tiefster = schnitt;
        for (const serie of serien) for (const seq of treffer.get(serie.id) ?? []) tiefster = Math.min(tiefster, seq);
        if (tiefster >= schnitt) break;
        const nach = await waehle(database, filter, { ab: tiefster, before: schnitt }, personId);
        zeilen = [...zeilen, ...nach.zeilen];
        schnitt = nach.gedeckeltBei === undefined ? tiefster : Math.max(tiefster, nach.gedeckeltBei);
        serien = await serienDerSeite();
    }
    const fortsetzung = new Set<string>();
    let mehr = false;
    if (offen && schnitt !== undefined) {
        const rand = schnitt;
        await trefferVon(serien);
        for (const serie of serien)
            if ((treffer.get(serie.id) ?? []).some((seq) => seq < rand)) fortsetzung.add(serie.id);
        const weiter = await waehle(database, filter, { before: schnitt, limit: 1 }, personId);
        mehr = weiter.zeilen.length > 0 || weiter.gedeckeltBei !== undefined;
    }
    const { entries, series } = await baueEintraege(database, zeilen, {
        personId,
        nutzlast: "liste",
        leser,
        fortsetzung,
    });
    return {
        entries,
        ...(mehr && schnitt !== undefined ? { next: schnitt } : {}),
        ...(series.length > 0 ? { series } : {}),
    };
}

/**
 * Eine Operation mit ihrer vollen Nutzlast (`GET /api/editor/changes/:operationId`): Felder und Geometrie so, wie das Protokoll sie führt. Fehlt die frühere Form
 * (nur `after` bei einem Gegenstand, den es schon gab; oder nur die bewegten Punkte einer mitgezogenen Fläche), steht das Feld in `formFehlt` des Gegenstands:
 * Das Detail rekonstruiert nie ein „Vorher“ aus dem heutigen Stand (Fachvertrag Gate 4, U11).
 */
export async function mapChange(
    database: Queryable,
    operationId: string,
    optionen: { mapDomainId: string; personId: string },
): Promise<MapHistoryEntry | undefined> {
    const zeilen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.operation_id = ${operationId}::uuid AND o.map_domain_id = ${optionen.mapDomainId}
    `;
    if (zeilen.length === 0) return undefined;
    const { entries } = await baueEintraege(database, zeilen, {
        personId: optionen.personId,
        nutzlast: "voll",
        leser: new SerienLeser(database),
    });
    const eintrag = entries[0];
    if (eintrag === undefined) return undefined;
    return {
        ...eintrag,
        objects: eintrag.objects.map((gegenstand) => {
            const fehlend = FORMFELDER.filter((feld) => {
                const aenderung = gegenstand.changes[feld];
                if (aenderung === undefined) return false;
                if (gegenstand.action.endsWith(".carried")) return true;
                return !("before" in aenderung) && gegenstand.revisionBefore !== null;
            });
            return fehlend.length > 0 ? { ...gegenstand, formFehlt: fehlend } : gegenstand;
        }),
    };
}

/**
 * Die Einträge zu Operationen nach Kennung, neueste zuerst, mit Gegenständen, Zustand und Arbeitsserie wie die Listen (die Vorprüfung der Rücknahme, `ruecknahme.ts`).
 * `felder` lässt von den Feldern nur die Namen kommen (`omitted`): Eine Vorprüfung vergleicht Revisionen, nicht Netze. Eine Kennung, die es nicht gibt, fehlt in der Antwort.
 */
export async function eintraegeNachKennung(
    database: Queryable,
    operationIds: readonly string[],
    optionen: { personId: string | undefined; nutzlast?: Nutzlast },
): Promise<{ entries: MapHistoryEntry[]; series: MapHistorySeries[] }> {
    if (operationIds.length === 0) return { entries: [], series: [] };
    const zeilen = await database<OperationRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.action, o.source, o.summary, o.actor_kind,
               o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.operation_id = ANY(${[...operationIds]}::uuid[])
         ORDER BY o.seq DESC
    `;
    return baueEintraege(database, zeilen, {
        personId: optionen.personId,
        nutzlast: optionen.nutzlast ?? "voll",
        leser: new SerienLeser(database),
    });
}
