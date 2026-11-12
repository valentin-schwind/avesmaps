import {
    EDITOR_LOCK_KINDS,
    EDITOR_LOCK_TIMEOUT_MINUTES,
    type Capability,
    type MapHistoryActor,
    type MapHistoryEntry,
    type MapHistoryObject,
    type MapHistoryObjectKind,
    type MapHistoryStatus,
    type RuecknahmeKonflikt,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { SerienLeser, mitgliederHash, spalteVon, trifftGegenstaende, zerlegeScope } from "./arbeitsserie.ts";
import { eintraegeNachKennung } from "./history.ts";

/**
 * Die Vorprüfung einer Rücknahme (WI-0265 B2b; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.1 bis C.3, F.1; Gate 2 und 3
 * abgenommen 2026-10-31). 🔴 **Nur lesend:** Sie schreibt nichts und stellt keinen Auftrag ein. Sie ist der Kern, den die Routen je Objektfamilie
 * (`POST …/restore-series/preview`, B3 Gebirge, B4 Ort) mit ihrem Adapter aufrufen; eine Route und eine Schreibung gibt es hier noch nicht. Die
 * Rücknahme wiederholt diese Prüfungen in ihrer Transaktion (der Preflight ist keine Zusage, C.2 Schritt 3).
 *
 * **Eingabe:** die ausdrückliche Mitgliederliste (`operationId`s) einer Arbeitsserie oder EINE Einzeloperation, dazu optional die Prüfsumme, die der Aufrufer zu
 * seiner Liste hat (`series.membersHash` der Liste), und den Grund. Die Liste einer Serie ist die GANZE Serie (auch ihre schon zurückgenommenen Mitglieder);
 * die Rücknahme betrifft nur die noch offenen. Der Server weitet nie still aus: Ist die Serie seit dem Öffnen gewachsen, antwortet die Vorprüfung
 * `series_changed` mit der neuen Liste.
 *
 * **Ausgabe:** `Vorpruefung` mit dem Ergebnis (der erste Grund in der Reihenfolge unten) und allem, was das Bestätigungsblatt braucht: die Mitglieder mit
 * Zustand und Gegenständen, je Gegenstand die Ist-Revision gegen die Revision nach dem letzten Mitglied, die Konflikte (Fremdoperationen seit dem letzten
 * Mitglied: wer, wann, `seq`, Felder), die Fremdsperren, die Ausschlüsse, ob eine fremde Person betroffen ist (dann Pflichtgrund, `reasonRequired`) und die
 * Prüfsumme der Liste.
 *
 * **Reihenfolge der Ergebnisse** (U9; Recht und Sperre vor allem anderen, sonst die Reihenfolge des Fachvertrags C.2): `forbidden` (das Recht der Vorwärtsoperation
 * fehlt; dann wird nichts weiter ausgewertet) → `object_locked` (eine fremde Sperre auf einem Gegenstand) → `invalid_members` (unbekannte Kennung, Prüfsumme
 * passt nicht zur Liste, mehrere Mitglieder, die keine gemeinsame Serie sind) → `not_revertable` (Quelle oder Art ausgeschlossen) → `series_changed` →
 * `already_reverted` (alle Mitglieder schon zurückgenommen) → `edit_conflict` → `ok`.
 *
 * **Konfliktregel „streng“, alles oder nichts** (Gate 3, C.3): Für jeden Gegenstand der offenen Mitglieder vergleicht die Vorprüfung die Ist-Revision mit der Revision
 * nach dem LETZTEN Mitglied an ihm, und jede spätere Operation an ihm, die nicht von einer späteren Rücknahme aufgehoben wurde, ist ein Konflikt, gleich von wem
 * (eigene spätere Änderungen eingeschlossen). Eine Operation und ihre geltende Rücknahme, beide nach dem letzten Mitglied, heben einander auf: So lässt sich
 * eine Serie von hinten Schritt für Schritt zurücknehmen (U4). Einzeln darf nur das LETZTE OFFENE Mitglied einer Serie zurückgenommen werden; ein überholtes
 * trägt `ueberholtDurch` („überholt durch Schritt 6“, U5), auch wenn der spätere Schritt andere Gegenstände berührt. „Feldgenau“ ist eine spätere Erweiterung.
 *
 * **Der gemeinsame Ablauf** der Routen (Wiederholung, Sperren, Fehler, Schreibnaht) steht in `ruecknahme-ablauf.ts`; die Adapter liegen in `ruecknahme-gebirge.ts` (B3) und `ruecknahme-ort.ts` (B4).
 *
 * **Der Adapter** einer Objektfamilie sagt, was die Familie weiß und der Kern nicht: das Recht der Vorwärtsoperation (F.1), welche Aktionen nicht rücknehmbar sind
 * (Anlegen der übrigen Arten, Form, Gipfelfelder, Inhalte-Stammdaten …; Grund `art` oder `bereich`) und, wo Revisionen nicht reichen, den Vergleich der Werte (Gebirge:
 * das Ist-Netz gleich dem Netz nach dem letzten Mitglied; Ort verschieben: alle Wegenden noch am Endstand).
 */

/** Wer fragt: die Person der Sitzung und ihre Rechte (`capabilitiesFor` samt `rechteHier`, wie `demand`). */
export interface RuecknahmeLeser {
    personId: string;
    rechte: ReadonlySet<Capability>;
}

export type AusschlussGrund = "quelle" | "art" | "bereich";

export type ArtErgebnis = { ok: true } | { ok: false; reason: Exclude<AusschlussGrund, "quelle"> };

/** Ein Gegenstand eines Mitglieds, wie das Protokoll ihn führt (nur die Namen der Felder: die Vorprüfung vergleicht Revisionen, nicht Netze). */
export interface VorGegenstandEintrag {
    kind: MapHistoryObjectKind;
    id: string;
    name?: string;
    /** Was ihm geschah (`place.moved`, `area.gebirge`). */
    action: string;
    revisionBefore: number | null;
    revisionAfter: number | null;
    felder: string[];
}

export interface VorMitglied {
    operationId: string;
    seq: number;
    at: string;
    operation: string;
    source: MapHistoryEntry["source"];
    actor: MapHistoryActor;
    /** Der Zustand der Liste (`MAP_HISTORY_STATUS`). */
    status: MapHistoryStatus;
    /** Bei `nicht_ruecknehmbar`: der Grund der Liste (`quelle` oder `art`; WI-0265 B6f). */
    statusReason?: MapHistoryEntry["statusReason"];
    /** Das Mitglied nimmt die Rücknahme mit: nicht schon zurückgenommen und nicht ausgeschlossen. */
    offen: boolean;
    ausschluss?: { grund: AusschlussGrund };
    gegenstaende: VorGegenstandEintrag[];
    /** Die Stelle in der Serie, wenn es in einer steht. */
    series?: { id: string; position: number; size: number };
    /** Nur bei einer Einzelrücknahme in einer Serie: das nächste spätere OFFENE Mitglied, das dieses überholt (streng, U5). */
    ueberholtDurch?: { operationId: string; seq: number; position: number };
}

/** Ein Gegenstand der offenen Mitglieder mit seiner Revision gestern (nach dem letzten Mitglied) und heute. */
export interface VorGegenstand {
    kind: MapHistoryObjectKind;
    id: string;
    name?: string;
    /** Die Revision nach dem letzten Mitglied (oder der letzten aufgehobenen Operation danach) an ihm; `null`, wenn das Protokoll keine führt. */
    erwarteteRevision: number | null;
    /** Die Revision heute; `null`, wenn der Gegenstand keine führt. */
    istRevision: number | null;
    /** Es gibt den Gegenstand nicht mehr. */
    fehlt?: true;
}

/** Der Konflikt in der Form von `409 edit_conflict` (Fachvertrag C.2): Objekt, Revision, wer, wann. */
export interface VorKonflikt {
    /**
     * - `spaeter`: eine spätere Operation (fremd oder eigen) an einem Gegenstand, die keine geltende Rücknahme aufhob.
     * - `ueberholt`: das Mitglied ist nicht das letzte offene seiner Serie.
     * - `revision`: die Revision stimmt nicht, ohne dass das Protokoll eine Operation dazu kennt (etwa ein Import).
     * - `geloescht`: es gibt den Gegenstand nicht mehr.
     * - `wert`: der Vergleich der Werte des Adapters (Netz, Wegenden) fand eine Abweichung.
     */
    art: "spaeter" | "ueberholt" | "revision" | "geloescht" | "wert";
    kind: MapHistoryObjectKind;
    id: string;
    name?: string;
    currentRevision?: number | null;
    erwarteteRevision?: number | null;
    /** Wer die spätere Operation schrieb, und wann. */
    changedBy?: MapHistoryActor;
    changedAt?: string;
    operationId?: string;
    seq?: number;
    felder?: string[];
    /** Die spätere Operation stammt von derselben Person wie die Mitglieder (eine spätere eigene Änderung). */
    eigene?: boolean;
    /** Bei `ueberholt`: der spätere offene Schritt der Serie. */
    ueberholtDurch?: { operationId: string; position: number };
    /** Bei `wert`: was abweicht, als Schlüssel mit den Angaben dazu (vom Adapter); die Oberfläche schreibt den Satz in der Sprache der Person (WI-0265 B5d). */
    abweichung?: NonNullable<RuecknahmeKonflikt["abweichung"]>;
    /** Bei `wert`: derselbe Befund als deutscher Satz, nur als Hinweis beim Überfahren und für Protokolle (vom Adapter). */
    detail?: string;
}

export interface VorSperre {
    kind: string;
    id: string;
    person: { id: string; name: string };
    part: string;
    since: string;
}

export type VorpruefungErgebnis =
    | "ok"
    | "forbidden"
    | "object_locked"
    | "invalid_members"
    | "not_revertable"
    | "series_changed"
    | "already_reverted"
    | "edit_conflict";

export interface Vorpruefung {
    ergebnis: VorpruefungErgebnis;
    /** Die Prüfsumme der Liste, wie sie eingegangen ist (`mitgliederHash`). */
    membersHash: string;
    /** Die Mitglieder, das älteste zuerst. */
    mitglieder: VorMitglied[];
    /** Die offenen Mitglieder (`operationId`s): die Rücknahme betrifft genau diese. */
    offen: string[];
    gegenstaende: VorGegenstand[];
    konflikte: VorKonflikt[];
    sperren: VorSperre[];
    fehlendeRechte: Capability[];
    /** Die Handelnden offener Mitglieder, die nicht die fragende Person sind (Gate 2). */
    fremdePersonen: { kind: MapHistoryActor["kind"]; id?: string; name?: string }[];
    /** Eine fremde Person ist betroffen: Die Rücknahme verlangt einen Grund, der im Eintrag sichtbar bleibt. */
    reasonRequired: boolean;
    /** Bei `series_changed`: die neue Liste der Serie und ihre Prüfsumme. */
    neueMitglieder?: string[];
    neuerHash?: string;
    /** Bei `invalid_members`: warum (`unbekannt`, `leer`, `hash`, `keine_serie`). */
    ungueltig?: "unbekannt" | "leer" | "hash" | "keine_serie";
}

export interface VorpruefungEingabe {
    mapDomainId: string;
    mitglieder: readonly string[];
    /** Die Prüfsumme zur Liste (`series.membersHash`); weicht sie von der Liste ab, ist die Anfrage zerbrochen. */
    membersHash?: string | undefined;
}

/** Was der Adapter für den Vergleich der Werte bekommt. */
export interface WertKontext {
    mitglieder: readonly VorMitglied[];
    offen: readonly VorMitglied[];
    leser: RuecknahmeLeser;
}

export interface RuecknahmeAdapter {
    /** Die Objektfamilie (Anzeige und Fehlersuche). */
    readonly familie: string;
    /**
     * Das Recht der Vorwärtsoperation (Fachvertrag F.1: `edit_map_objects`, `edit_map_geometry`, `manage_sources`). `aktionen` sind die Aktionen der Protokolleinträge des Mitglieds:
     * Eine Rücknahme heißt anders als ihr Vorwärts (`place.restore_series` für eine Verschiebung), das Recht folgt darum der Art des Mitglieds, nicht nur dem Namen. `felder` sind die Namen der
     * Felder, die das Mitglied berührt (WI-0265 B6b: an der Kraftlinie verlangen Bogen und Enden `edit_map_geometry`, die Felder der Linie nur `edit_map_objects`; beide heißen `powerline.updated`).
     * Ein Mitglied, das zwei Arten schreibt (WI-0265 B6g3: eine Rücknahme von Feldern UND Quellen eines Orts, `place.restore_series`), nennt beide Rechte als Liste; die Rücknahme braucht dann beide.
     */
    recht(
        operation: string,
        aktionen: readonly string[],
        felder?: readonly string[],
    ): Capability | readonly Capability[];
    /** Ob die Operation rücknehmbar ist (Anlegen, Form … nicht); `aktionen` sind die Aktionen ihrer Protokolleinträge. */
    pruefeArt(operation: string, aktionen: readonly string[]): ArtErgebnis;
    /**
     * Ob die offenen Mitglieder ZUSAMMEN eine Rücknahme ergeben (Ort: eine Verschiebung oder ein Löschen geht nur allein, mit Änderungen der Felder zusammen nur diese). Liefert die
     * Mitglieder, die dann ausgeschlossen sind, mit dem Grund; leer heißt: passt. Ohne Haken gilt jede Liste.
     */
    pruefeListe?(offen: readonly VorMitglied[]): ReadonlyMap<string, Exclude<AusschlussGrund, "quelle">>;
    /**
     * Wo ein Gegenstand seine Felder in einem Sammelfeld führt (Gebirge: das Feld `gebirge` mit der Tafel der Spalten), die Namen der Felder darin, die sich wirklich änderten. Der Kern liest
     * dafür die volle Nutzlast der späteren Operationen (nur im Konfliktfall und höchstens `FEIN_MAX`) und nennt sie als `felder` einer späteren Änderung; `undefined` heißt: die Schlüssel
     * des Protokolls gelten.
     */
    feinFelder?(gegenstand: MapHistoryObject): string[] | undefined;
    /** Wo Revisionen nicht reichen: der Vergleich der Werte heute gegen den Endstand der Kette. Liefert Konflikte der Art `wert`. */
    pruefeWerte?(database: Queryable, kontext: WertKontext): Promise<readonly VorKonflikt[]>;
}

const schluessel = (kind: string, id: string): string => `${kind}:${id}`;

/** Eine Aktion, die den Gegenstand ändert, ohne seine Revision zu zählen: die Quellen eines Trägers (`place.sources_changed` …, WI-0254 §12). */
const ohneRevision = (aktion: string): boolean => aktion.endsWith(".sources_changed");

/** So viele spätere Operationen liest der Kern höchstens mit voller Nutzlast, um die Felder eines Konflikts fein zu benennen (`feinFelder`); darüber gelten die Schlüssel des Protokolls. */
const FEIN_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

interface RevisionZeile {
    id: string;
    revision: string | null;
}

/** Die Revision heute je Art; eine Art ohne Eintrag führt keine (die Sprachartikel des WikiSync). */
const REVISION_QUELLEN: Partial<
    Record<MapHistoryObjectKind, (database: Queryable, ids: string[]) => Promise<RevisionZeile[]>>
> = {
    place: async (db, ids) => [
        ...(await db<RevisionZeile[]>`
            SELECT public_id::text AS id, revision::text AS revision FROM place WHERE public_id = ANY(${ids}::uuid[])
        `),
        // Ein Ort ohne Lage ist da, führt aber keine Revision.
        ...(await db<RevisionZeile[]>`
            SELECT public_id::text AS id, NULL::text AS revision FROM place_unplaced
             WHERE public_id = ANY(${ids}::uuid[])
               AND NOT EXISTS (SELECT 1 FROM place p WHERE p.public_id = place_unplaced.public_id)
        `),
    ],
    path: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM path WHERE public_id = ANY(${ids}::uuid[])`,
    landscape: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM region WHERE public_id = ANY(${ids}::uuid[])`,
    area: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM region_area WHERE public_id = ANY(${ids}::uuid[])`,
    label: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM map_label WHERE public_id = ANY(${ids}::uuid[])`,
    powerline: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM powerline WHERE public_id = ANY(${ids}::uuid[])`,
    nodix: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM nodix WHERE public_id = ANY(${ids}::uuid[])`,
    territory: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM territory WHERE public_id = ANY(${ids}::uuid[])`,
    territory_area: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM territory_area WHERE public_id = ANY(${ids}::uuid[])`,
    peak: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM terrain_peak WHERE public_id = ANY(${ids}::uuid[])`,
    // Die Sprache und ihre Teilflächen (WI-0261 S2, Migration 0254; WI-0265 B6e): der Trigger zählt ihre Revision wie bei den übrigen Karten-Arten.
    sprache: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM sprache WHERE public_id = ANY(${ids}::uuid[])`,
    sprache_flaeche: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM sprache_flaeche WHERE public_id = ANY(${ids}::uuid[])`,
    // Quelle, Werk und Korpus der Inhalte (WI-0254, Migrationen 0232, 0233, 0236; WI-0265 B6g1): die Fachrevision zählt jede Änderung einer redaktionellen Spalte, auch eine ohne Operation (das Durchschreiben eines Korpus auf seine Quellen).
    source: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM feature_source WHERE public_id = ANY(${ids}::uuid[])`,
    work: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM adventure WHERE public_id = ANY(${ids}::uuid[])`,
    corpus: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM source_corpus WHERE public_id = ANY(${ids}::uuid[])`,
    // Das Vorkommen (WI-0254, Migration 0234; WI-0265 B6g2): der Trigger zählt jede Änderung einer Spalte des Eintrags, `lore.update` und `lore.rules_text` zählen sie ausdrücklich, auch bei einer Änderung nur der Zeilen darunter.
    lore: (db, ids) =>
        db<
            RevisionZeile[]
        >`SELECT public_id::text AS id, revision::text AS revision FROM lore_entry WHERE public_id = ANY(${ids}::uuid[])`,
};

/**
 * Die Revision heute je Gegenstand. Fehlt der Gegenstand in seiner Tafel, steht `fehlt`; führt seine Art keine Revision, steht `revision: null`. Nur Arten mit
 * Revision werden gefragt (`REVISION_QUELLEN`); für die übrigen gilt `revision: null`, `fehlt` bleibt aus.
 */
export async function leseIstRevisionen(
    database: Queryable,
    gegenstaende: readonly { kind: MapHistoryObjectKind; id: string }[],
): Promise<Map<string, { revision: number | null; fehlt: boolean }>> {
    const ergebnis = new Map<string, { revision: number | null; fehlt: boolean }>();
    const jeArt = new Map<MapHistoryObjectKind, string[]>();
    for (const { kind, id } of gegenstaende) {
        ergebnis.set(schluessel(kind, id), { revision: null, fehlt: false });
        if (REVISION_QUELLEN[kind] !== undefined) jeArt.set(kind, [...(jeArt.get(kind) ?? []), id]);
    }
    for (const [kind, ids] of jeArt) {
        const lese = REVISION_QUELLEN[kind]!;
        const gefunden = new Map((await lese(database, ids)).map((zeile) => [zeile.id, zeile.revision] as const));
        for (const id of ids)
            ergebnis.set(
                schluessel(kind, id),
                gefunden.has(id)
                    ? { revision: gefunden.get(id) === null ? null : Number(gefunden.get(id)), fehlt: false }
                    : { revision: null, fehlt: true },
            );
    }
    return ergebnis;
}

interface BeruehrungRow {
    operation_id: string;
    seq: string;
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
    sprache_public_id: string | null;
    sprache_flaeche_public_id: string | null;
}

/**
 * Die Operationen nach `nachSeq` (ausschließlich), die einen der Gegenstände berühren, mit den Gegenständen, die sie berühren (Schlüssel `<art>:<kennung>`). Berührt
 * heißt: Eine Zielspalte des Protokolleintrags nennt den Gegenstand; eine Teilfläche oder Beschriftung berührt damit auch ihre Fläche (wie der Verlauf der Fläche).
 */
async function spaetereOperationen(
    database: Queryable,
    gegenstaende: readonly { kind: MapHistoryObjectKind; id: string }[],
    nachSeq: number,
): Promise<Map<string, { seq: number; gegenstaende: Set<string> }>> {
    const jeArt: Partial<Record<MapHistoryObjectKind, string[]>> = {};
    for (const { kind, id } of gegenstaende) (jeArt[kind] ??= []).push(id);
    const zeilen = await database<BeruehrungRow[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq,
               e.place_public_id::text AS place_public_id, e.path_public_id::text AS path_public_id,
               e.powerline_public_id::text AS powerline_public_id, e.nodix_public_id::text AS nodix_public_id,
               e.region_public_id::text AS region_public_id, e.region_area_public_id::text AS region_area_public_id,
               e.map_label_public_id::text AS map_label_public_id, e.territory_public_id::text AS territory_public_id,
               e.territory_area_public_id::text AS territory_area_public_id, e.peak_public_id::text AS peak_public_id,
               e.source_public_id::text AS source_public_id, e.work_public_id::text AS work_public_id,
               e.lore_public_id::text AS lore_public_id, e.corpus_public_id::text AS corpus_public_id,
               e.sprache_artikel_public_id::text AS sprache_artikel_public_id, e.sprache_public_id::text AS sprache_public_id,
               e.sprache_flaeche_public_id::text AS sprache_flaeche_public_id
          FROM map_audit_event e
          JOIN map_operation o ON o.operation_id = e.operation_id
         WHERE (${trifftGegenstaende(database, (art) => jeArt[art] ?? [])}) AND o.seq > ${nachSeq}
    `;
    const ergebnis = new Map<string, { seq: number; gegenstaende: Set<string> }>();
    for (const zeile of zeilen) {
        const eintrag = ergebnis.get(zeile.operation_id) ?? { seq: Number(zeile.seq), gegenstaende: new Set<string>() };
        ergebnis.set(zeile.operation_id, eintrag);
        for (const { kind, id } of gegenstaende)
            if (zeile[spalteVon(kind)] === id) eintrag.gegenstaende.add(schluessel(kind, id));
    }
    return ergebnis;
}

/**
 * Die Revisionen, die die Quittung einer Operation für die Gegenstände nennt (`affected`), je Gegenstand (`<art>:<kennung>`). Der Kern liest sie für Operationen, die einen Gegenstand nur über ein Kind
 * berühren und keinen Eintrag an ihm führen (WI-0265 B8c: Eine Beschriftung anlegen oder löschen zählt die Revision ihrer Landschaft hoch, damit ein offenes Fenster der Landschaft den Stand der
 * Beschriftungen nicht verpasst; im Fachprotokoll steht nur die Beschriftung). Ohne diese Quittung läse die Prüfung die Revision der Landschaft als Änderung ohne Operation.
 */
async function quittungsRevisionen(database: Queryable, operationId: string): Promise<Map<string, number>> {
    const [zeile] = await database<{ affected: unknown }[]>`
        SELECT receipt -> 'affected' AS affected FROM map_operation WHERE operation_id = ${operationId}::uuid
    `;
    const ergebnis = new Map<string, number>();
    if (!Array.isArray(zeile?.affected)) return ergebnis;
    for (const eines of zeile.affected as { kind?: unknown; id?: unknown; revision?: unknown }[])
        if (typeof eines.kind === "string" && typeof eines.id === "string" && typeof eines.revision === "number")
            ergebnis.set(schluessel(eines.kind, eines.id), eines.revision);
    return ergebnis;
}

interface SperreRow {
    object_kind: string;
    object_id: string;
    part: string;
    person_id: string;
    person_name: string;
    since: Date;
}

/** Die geltenden Sperren (Herzschlag in den letzten Minuten) anderer Personen auf den Gegenständen; die eigene zählt nicht (wie `pruefeFremdeSperre`). */
async function fremdeSperren(
    database: Queryable,
    ziele: readonly { kind: string; id: string }[],
    personId: string,
): Promise<VorSperre[]> {
    if (ziele.length === 0) return [];
    const zeilen = await database<SperreRow[]>`
        SELECT l.object_kind, l.object_id::text AS object_id, l.part, l.person_id::text AS person_id, l.person_name, l.since
          FROM editor_lock l
          JOIN unnest(${ziele.map((z) => z.kind)}::text[], ${ziele.map((z) => z.id)}::uuid[]) AS t(kind, id)
            ON l.object_kind = t.kind AND l.object_id = t.id
         WHERE l.heartbeat_at >= now() - make_interval(mins => ${EDITOR_LOCK_TIMEOUT_MINUTES})
           AND l.person_id <> ${personId}::uuid
         ORDER BY l.since, l.object_id
    `;
    return zeilen.map((zeile) => ({
        kind: zeile.object_kind,
        id: zeile.object_id,
        person: { id: zeile.person_id, name: zeile.person_name },
        part: zeile.part,
        since: zeile.since.toISOString(),
    }));
}

const alsMitglied = (eintrag: MapHistoryEntry): VorMitglied => ({
    operationId: eintrag.operationId,
    seq: eintrag.seq,
    at: eintrag.at,
    operation: eintrag.operation,
    source: eintrag.source,
    actor: eintrag.actor,
    status: eintrag.status ?? "ruecknehmbar",
    ...(eintrag.statusReason !== undefined ? { statusReason: eintrag.statusReason } : {}),
    offen: false,
    gegenstaende: eintrag.objects.map((gegenstand) => ({
        kind: gegenstand.kind,
        id: gegenstand.id,
        ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}),
        action: gegenstand.action,
        revisionBefore: gegenstand.revisionBefore,
        revisionAfter: gegenstand.revisionAfter,
        felder: Object.keys(gegenstand.changes),
    })),
    ...(eintrag.series !== undefined ? { series: eintrag.series } : {}),
});

/**
 * Die Vorprüfung (siehe Kopf der Datei). Liest nur. `adapter` ist der der Objektfamilie der Mitglieder (eine Serie mischt nie Familien, Fachvertrag C.1).
 */
export async function vorpruefen(
    database: Queryable,
    eingabe: VorpruefungEingabe,
    leser: RuecknahmeLeser,
    adapter: RuecknahmeAdapter,
): Promise<Vorpruefung> {
    const ids = [...new Set(eingabe.mitglieder.map((id) => id.toLowerCase()))];
    const hash = mitgliederHash(ids);
    const leer = (ergebnis: VorpruefungErgebnis, extra: Partial<Vorpruefung> = {}): Vorpruefung => ({
        ergebnis,
        membersHash: hash,
        mitglieder: [],
        offen: [],
        gegenstaende: [],
        konflikte: [],
        sperren: [],
        fehlendeRechte: [],
        fremdePersonen: [],
        reasonRequired: false,
        ...extra,
    });
    if (ids.length === 0) return leer("invalid_members", { ungueltig: "leer" });
    // Eine zerbrochene Kennung erreicht die Abfrage nie (sie würde als Datenbankfehler enden).
    if (!ids.every((id) => UUID.test(id))) return leer("invalid_members", { ungueltig: "unbekannt" });

    // 1. Die Mitglieder laden: Gegenstände, Zustand und Serie wie die Liste (dieselbe Autorität).
    const geladen = await eintraegeNachKennung(database, ids, { personId: leser.personId, nutzlast: "felder" });
    const dieseDomaene = await database<{ operation_id: string }[]>`
        SELECT operation_id::text AS operation_id FROM map_operation
         WHERE operation_id = ANY(${ids}::uuid[]) AND map_domain_id = ${eingabe.mapDomainId}
    `;
    if (geladen.entries.length !== ids.length || dieseDomaene.length !== ids.length)
        return leer("invalid_members", { ungueltig: "unbekannt" });
    const mitglieder = geladen.entries.map(alsMitglied).sort((a, b) => a.seq - b.seq);

    // 2. 🔴 Das Recht der Vorwärtsoperation geht vor allem anderen (U9): Wer es nicht hat, erfährt sonst nichts.
    const noetig = new Set<Capability>(
        mitglieder.flatMap((m) =>
            [
                adapter.recht(
                    m.operation,
                    m.gegenstaende.map((g) => g.action),
                    m.gegenstaende.flatMap((g) => g.felder),
                ),
            ].flat(),
        ),
    );
    const fehlendeRechte = [...noetig].filter((recht) => !leser.rechte.has(recht));
    if (fehlendeRechte.length > 0) return leer("forbidden", { mitglieder, fehlendeRechte });

    // 3. Ausschlüsse: Quelle (Import, WikiSync, Testwelt) und Art (die Liste kennt die Art am Namen der Operation, `ruecknahme-arten.ts`; der Adapter prüft zusätzlich die Aktionen der
    // Einträge); offen ist, was gilt und nicht ausgeschlossen ist.
    for (const m of mitglieder) {
        if (m.status === "nicht_ruecknehmbar") m.ausschluss = { grund: m.statusReason ?? "quelle" };
        else if (m.status === "ruecknehmbar") {
            const art = adapter.pruefeArt(
                m.operation,
                m.gegenstaende.map((g) => g.action),
            );
            if (!art.ok) m.ausschluss = { grund: art.reason };
        }
        m.offen = m.status === "ruecknehmbar" && m.ausschluss === undefined;
    }
    // Ob die offenen Mitglieder zusammen gehen (der Adapter der Familie): Wer nicht passt, ist ausgeschlossen (Grund art).
    if (adapter.pruefeListe !== undefined) {
        const verworfen = adapter.pruefeListe(mitglieder.filter((m) => m.offen));
        for (const m of mitglieder) {
            const grund = verworfen.get(m.operationId);
            if (grund === undefined) continue;
            m.ausschluss = { grund };
            m.offen = false;
        }
    }
    const offen = mitglieder.filter((m) => m.offen);
    const offenIds = new Set(offen.map((m) => m.operationId));

    // 4. Fremdsperren: die Gegenstände (Scopes) der offenen Mitglieder, soweit es dafür Sperren gibt.
    const scopes = await new SerienLeser(database).scopes([...offenIds]);
    const sperrZiele = [...new Set(offen.flatMap((m) => scopes.get(m.operationId) ?? []))]
        .map(zerlegeScope)
        .filter((ziel) => (EDITOR_LOCK_KINDS as readonly string[]).includes(ziel.kind));
    const sperren = await fremdeSperren(database, sperrZiele, leser.personId);

    // 5. Die Liste: Prüfsumme und Serie (mehrere Mitglieder sind genau eine Serie; ein Mitglied allein ist eine Einzelrücknahme).
    let ungueltig: Vorpruefung["ungueltig"];
    let neueMitglieder: string[] | undefined;
    let neuerHash: string | undefined;
    if (eingabe.membersHash !== undefined && eingabe.membersHash.toLowerCase() !== hash) ungueltig = "hash";
    if (ids.length >= 2) {
        const serienIds = new Set(mitglieder.map((m) => m.series?.id));
        const serienId = [...serienIds][0];
        if (serienIds.size !== 1 || serienId === undefined) ungueltig ??= "keine_serie";
        else {
            const kopf = geladen.series.find((serie) => serie.id === serienId);
            if (kopf !== undefined && kopf.size > ids.length) {
                neueMitglieder = kopf.members;
                neuerHash = kopf.membersHash;
            }
        }
    }

    // 6. Gegenstände, Ist-Revision, spätere Operationen und Konflikte der offenen Mitglieder.
    const konflikte: VorKonflikt[] = [];
    const gegenstaende: VorGegenstand[] = [];
    if (offen.length > 0) {
        interface Ziel {
            kind: MapHistoryObjectKind;
            id: string;
            name?: string;
            letzteSeq: number;
            erwartet: number | null;
        }
        const ziele = new Map<string, Ziel>();
        for (const m of offen)
            for (const g of m.gegenstaende) {
                const vorher = ziele.get(schluessel(g.kind, g.id));
                ziele.set(schluessel(g.kind, g.id), {
                    kind: g.kind,
                    id: g.id,
                    ...((g.name ?? vorher?.name) !== undefined ? { name: (g.name ?? vorher?.name)! } : {}),
                    letzteSeq: m.seq,
                    // Die Quellen eines Trägers führen keine Revision des Trägers (`<art>.sources_changed`, WI-0265 B6g3): Der Stand nach einem früheren Mitglied gilt weiter.
                    erwartet:
                        g.revisionAfter ??
                        (vorher !== undefined && (vorher.letzteSeq === m.seq || ohneRevision(g.action))
                            ? vorher.erwartet
                            : null),
                });
            }
        const zielListe = [...ziele.values()];
        const ist = await leseIstRevisionen(database, zielListe);
        const beruehrt = await spaetereOperationen(database, zielListe, Math.min(...zielListe.map((z) => z.letzteSeq)));
        const spaeterIds = [...beruehrt.keys()].filter((id) => !offenIds.has(id));
        const spaeter = await eintraegeNachKennung(database, spaeterIds, {
            personId: leser.personId,
            nutzlast: "felder",
        });
        const eintragVon = new Map(spaeter.entries.map((e) => [e.operationId, e] as const));
        // Die Rücknahmen, die spätere Operationen aufhoben, und was sie ihrerseits zurücknehmen: für die Aufhebung (sie müssen NACH dem letzten Mitglied liegen).
        const fehlend = [
            ...new Set(
                spaeter.entries.flatMap((e) =>
                    e.revertedBy !== undefined && !eintragVon.has(e.revertedBy.operationId)
                        ? [e.revertedBy.operationId]
                        : [],
                ),
            ),
        ];
        for (const e of (
            await eintraegeNachKennung(database, fehlend, { personId: leser.personId, nutzlast: "felder" })
        ).entries)
            eintragVon.set(e.operationId, e);
        const zurueckGenommene = [...new Set([...eintragVon.values()].flatMap((e) => e.reverts ?? []))];
        const seqVon = new Map<string, number>();
        if (zurueckGenommene.length > 0)
            for (const zeile of await database<{ operation_id: string; seq: string }[]>`
                SELECT operation_id::text AS operation_id, seq::text AS seq FROM map_operation WHERE operation_id = ANY(${zurueckGenommene}::uuid[])
            `)
                seqVon.set(zeile.operation_id, Number(zeile.seq));

        // Streng: Einzeln darf nur das letzte OFFENE Mitglied einer Serie zurückgenommen werden; ein überholtes nennt den Schritt, der es überholt.
        const ueberholer = new Map<string, { operationId: string; position: number }>();
        const einzel = mitglieder.length === 1 ? mitglieder[0] : undefined;
        if (einzel?.series !== undefined && einzel.offen) {
            const kopf = geladen.series.find((serie) => serie.id === einzel.series!.id);
            const weitere = (kopf?.members ?? []).filter((id) => id !== einzel.operationId);
            const weitereEintraege = (
                await eintraegeNachKennung(database, weitere, { personId: leser.personId, nutzlast: "felder" })
            ).entries;
            const folgende = weitereEintraege
                .filter((e) => e.seq > einzel.seq && e.status === "ruecknehmbar")
                .sort((a, b) => a.seq - b.seq);
            for (const e of folgende)
                ueberholer.set(e.operationId, { operationId: e.operationId, position: e.series?.position ?? 0 });
            const erster = folgende[0];
            if (erster !== undefined) {
                einzel.ueberholtDurch = {
                    operationId: erster.operationId,
                    seq: erster.seq,
                    position: erster.series?.position ?? 0,
                };
                if (kopf !== undefined)
                    konflikte.push({
                        art: "ueberholt",
                        kind: kopf.scope.kind,
                        id: kopf.scope.id,
                        ...(kopf.scope.name !== undefined ? { name: kopf.scope.name } : {}),
                        changedBy: erster.actor,
                        changedAt: erster.at,
                        operationId: erster.operationId,
                        seq: erster.seq,
                        eigene: true,
                        ueberholtDurch: { operationId: erster.operationId, position: erster.series?.position ?? 0 },
                    });
            }
        }

        const personen = new Set(offen.map((m) => (m.actor.kind === "person" ? m.actor.id : undefined)));
        for (const ziel of zielListe) {
            const key = schluessel(ziel.kind, ziel.id);
            const spaeterAn = [...beruehrt]
                .filter(([id, b]) => b.gegenstaende.has(key) && b.seq > ziel.letzteSeq && !offenIds.has(id))
                .map(([id, b]) => ({ id, seq: b.seq }))
                .sort((a, b) => a.seq - b.seq);
            // Eine Rücknahme gilt als „Aufhebung“, wenn sie selbst gilt und nur Operationen NACH dem letzten Mitglied zurücknimmt.
            const hebtAuf = (e: MapHistoryEntry | undefined): boolean =>
                e !== undefined &&
                e.source === "restore" &&
                e.status !== "bereits_zurueckgenommen" &&
                (e.reverts ?? []).length > 0 &&
                (e.reverts ?? []).every((id) => (seqVon.get(id) ?? 0) > ziel.letzteSeq);
            const aufgehoben = new Set<string>();
            for (const { id } of spaeterAn) {
                const e = eintragVon.get(id);
                if (hebtAuf(e)) aufgehoben.add(id);
                if (
                    e?.status === "bereits_zurueckgenommen" &&
                    e.revertedBy !== undefined &&
                    hebtAuf(eintragVon.get(e.revertedBy.operationId))
                )
                    aufgehoben.add(id);
            }
            // Die letzte Revision, die das Protokoll an diesem Gegenstand kennt: nach dem letzten Mitglied oder nach der letzten aufgehobenen Operation danach.
            let erwartet = ziel.erwartet;
            for (const { id } of spaeterAn) {
                if (!aufgehoben.has(id)) continue;
                const gegenstand = eintragVon.get(id)?.objects.find((o) => o.kind === ziel.kind && o.id === ziel.id);
                if (gegenstand?.revisionAfter !== null && gegenstand?.revisionAfter !== undefined)
                    erwartet = gegenstand.revisionAfter;
                else if (erwartet !== null) {
                    // Eine aufgehobene Operation, die den Gegenstand nur über ein Kind berührte (Beschriftung anlegen): Ihre Quittung nennt seine Revision.
                    const revision = (await quittungsRevisionen(database, id)).get(key);
                    if (revision !== undefined && revision > erwartet) erwartet = revision;
                }
            }
            // Dasselbe für ein offenes Mitglied NACH dem letzten Eintrag am Gegenstand, das ihn nur über ein Kind berührt (Serie aus Fläche ändern und Beschriftung anlegen): Es zählte die Revision ohne Eintrag an ihm.
            if (erwartet !== null)
                for (const [id] of [...beruehrt]
                    .filter(([id, b]) => offenIds.has(id) && b.gegenstaende.has(key) && b.seq > ziel.letzteSeq)
                    .sort((a, b) => a[1].seq - b[1].seq)) {
                    const revision = (await quittungsRevisionen(database, id)).get(key);
                    if (revision !== undefined && revision > erwartet) erwartet = revision;
                }
            const heute = ist.get(key) ?? { revision: null, fehlt: false };
            gegenstaende.push({
                kind: ziel.kind,
                id: ziel.id,
                ...(ziel.name !== undefined ? { name: ziel.name } : {}),
                erwarteteRevision: erwartet,
                istRevision: heute.revision,
                ...(heute.fehlt ? { fehlt: true as const } : {}),
            });
            if (heute.fehlt) {
                konflikte.push({
                    art: "geloescht",
                    kind: ziel.kind,
                    id: ziel.id,
                    ...(ziel.name !== undefined ? { name: ziel.name } : {}),
                    erwarteteRevision: erwartet,
                });
                continue;
            }
            // Was nach dem letzten Mitglied geschah und nicht aufgehoben wurde, erklärt eine abweichende Revision; ein überholender Schritt der Serie ist keine eigene Meldung.
            const unerklaert = spaeterAn.filter(({ id }) => !aufgehoben.has(id));
            const uebrig = unerklaert.filter(({ id }) => !ueberholer.has(id));
            // Die feinen Namen der Felder (Gebirge: die Spalten statt `gebirge`) brauchen die volle Nutzlast der wenigen Operationen, die einen Konflikt melden.
            const fein =
                adapter.feinFelder !== undefined && uebrig.length > 0 && uebrig.length <= FEIN_MAX
                    ? new Map(
                          (
                              await eintraegeNachKennung(
                                  database,
                                  uebrig.map(({ id }) => id),
                                  { personId: leser.personId, nutzlast: "voll" },
                              )
                          ).entries.map((e) => [e.operationId, e] as const),
                      )
                    : undefined;
            for (const { id, seq } of uebrig) {
                const e = eintragVon.get(id);
                const dort = e?.objects.filter((o) => o.kind === ziel.kind && o.id === ziel.id) ?? [];
                const vollDort = fein?.get(id)?.objects.filter((o) => o.kind === ziel.kind && o.id === ziel.id) ?? [];
                const felder = [
                    ...new Set(
                        vollDort.length > 0
                            ? vollDort.flatMap((o) => adapter.feinFelder?.(o) ?? Object.keys(o.changes))
                            : (dort.length > 0 ? dort : (e?.objects ?? [])).flatMap((o) => Object.keys(o.changes)),
                    ),
                ];
                konflikte.push({
                    art: "spaeter",
                    kind: ziel.kind,
                    id: ziel.id,
                    ...(ziel.name !== undefined ? { name: ziel.name } : {}),
                    currentRevision: heute.revision,
                    erwarteteRevision: erwartet,
                    ...(e !== undefined ? { changedBy: e.actor, changedAt: e.at } : {}),
                    operationId: id,
                    seq,
                    felder,
                    eigene: e?.actor.kind === "person" && personen.has(e.actor.id),
                });
            }
            // Die Revision stimmt nicht, und das Protokoll kennt keine Operation dazu (ein Import, ein Eingriff am Rand der Schreibnaht).
            if (unerklaert.length === 0 && heute.revision !== null && erwartet !== null && heute.revision !== erwartet)
                konflikte.push({
                    art: "revision",
                    kind: ziel.kind,
                    id: ziel.id,
                    ...(ziel.name !== undefined ? { name: ziel.name } : {}),
                    currentRevision: heute.revision,
                    erwarteteRevision: erwartet,
                });
        }
        if (adapter.pruefeWerte !== undefined)
            konflikte.push(...(await adapter.pruefeWerte(database, { mitglieder, offen, leser })));
    }

    // 7. Eine fremde Person ist betroffen (Gate 2): Die Rücknahme verlangt einen Grund.
    const fremd = new Map<string, { kind: MapHistoryActor["kind"]; id?: string; name?: string }>();
    for (const m of offen) {
        if (m.actor.kind === "person" && m.actor.id === leser.personId) continue;
        fremd.set(m.actor.id ?? `${m.actor.kind}:${m.actor.name ?? ""}`, {
            kind: m.actor.kind,
            ...(m.actor.id !== undefined ? { id: m.actor.id } : {}),
            ...(m.actor.name !== undefined ? { name: m.actor.name } : {}),
        });
    }

    const ergebnis: VorpruefungErgebnis =
        sperren.length > 0
            ? "object_locked"
            : ungueltig !== undefined
              ? "invalid_members"
              : mitglieder.some((m) => m.ausschluss !== undefined)
                ? "not_revertable"
                : neueMitglieder !== undefined
                  ? "series_changed"
                  : mitglieder.every((m) => m.status === "bereits_zurueckgenommen")
                    ? "already_reverted"
                    : konflikte.length > 0
                      ? "edit_conflict"
                      : "ok";
    return {
        ergebnis,
        membersHash: hash,
        mitglieder,
        offen: offen.map((m) => m.operationId),
        gegenstaende,
        konflikte,
        sperren,
        fehlendeRechte: [],
        fremdePersonen: [...fremd.values()],
        reasonRequired: fremd.size > 0,
        ...(ungueltig !== undefined ? { ungueltig } : {}),
        ...(neueMitglieder !== undefined && neuerHash !== undefined ? { neueMitglieder, neuerHash } : {}),
    };
}
