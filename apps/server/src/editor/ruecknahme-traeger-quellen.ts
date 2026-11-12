import type {
    InhalteTraegerArt,
    InhalteTraegerQuellenArt,
    MapHistoryEntry,
    MapHistoryObjectKind,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Queryable } from "../database.ts";
import { aktualisiereKanon, type BeruehrteTraeger } from "../inhalte/kanon-folgen.ts";
import type { ExakteVerwendungen } from "../inhalte/quellen-schreiben.ts";
import { PROTOKOLL, eintrag, type QuelleZeile } from "../inhalte/traeger-quellen-stand.ts";
import {
    leseVerknuepfungen,
    sichtAlsZeile,
    sperreStrasse,
    wegEintrag,
    type StrassenLage,
    type Verknuepfung,
} from "../inhalte/traeger-quellen-weg.ts";
import { TRAEGER } from "../inhalte/traeger.ts";
import { protokollEintrag, type LinkZeile } from "../inhalte/verknuepfung-schreiben.ts";
import { fasseWegQuelleZusammen } from "../inhalte/weg-sicht.ts";
import { readEditorPathStreet } from "./path-list.ts";
import type { MapAuditEntry } from "./map-operation.ts";
import type { SchreibErgebnis } from "./ruecknahme-ablauf.ts";
import { gleichWert, mitGrund, nichtRuecknehmbar } from "./ruecknahme-inhalte.ts";
import type { VorKonflikt, Vorpruefung } from "./ruecknahme.ts";

/**
 * Die Quellen eines Kartenobjekts zurücknehmen (WI-0265 B6g3; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` B.2, C.2, C.3, F.1): EIN Kern für beide Wege, die
 * Verwendungen einer Quelle an einem Träger zu schreiben. Er gehört weder zu einer Familie noch zur Quelle allein:
 *
 * - **Vom Träger her** (`traeger.sources`, die Klappbox der Karteneditoren): Der Adapter des Orts, des Gebiets, der Derographie und des Wegs nimmt die Operation neben seinen Feldern an (Entscheidung
 *   Claudia 2026-10-31: Sie teilt die Serie ihres Trägers, also geht eine Serie aus „Felder geändert“ und „Quellen geändert“ in EINER Rücknahme ganz oder gar nicht zurück). Das Protokoll steht
 *   am Träger (`<art>.sources_changed`, `changes.quellen` vorher und nachher je Quelle), ohne Revision des Trägers.
 * - **Von der Quelle her** (`source.update` mit `links`): Der Adapter der Quelle (`ruecknahme-quelle.ts`) nimmt die Verwendungen mit zurück. Das Protokoll steht an der Quelle (`changes.links`,
 *   je Verwendung Art, Kennung und Stand vorher und nachher) und beim Weg zusätzlich als `path.sources_changed` am Anker der Straße (dieselbe Information, darum liest dieser Kern nur `links`).
 *
 * 🔴 **Was das Protokoll festhält und damit zurückgeht:** je Verwendung (Träger und Quelle) der Stand vor und nach der Serie: Zustand (`active`, `retired`, `suppressed`, `none` bei neu) und die
 * Angaben (Art des Belegs, Seiten, Notiz). Die Rücknahme setzt jede Zeile der Verknüpfung auf den Stand VOR dem ersten Mitglied, das sie berührt (C.3). Eine Zeile, die die Serie anlegte, wird still
 * gelegt (`retired`), nie gelöscht; eine gelöste oder unterdrückte wird belebt.
 *
 * 🔴 **Ein exakter Setter, nicht die Vorwärts-Operation:** Die Vorwärts-Operationen (`schreibeVerwendung`) fragen den Stand ab und lehnen ab, wo er nicht passt („schon angehängt“, „schon gelöst“);
 * die Rücknahme weiß den Zielzustand aus dem Protokoll und setzt ihn direkt (Zustand, `is_active`, `retired_*` und die Angaben in EINER Anweisung), mit `source_system = 'editor'` (Bestandsschutz: der Legacy-Zug
 * fasst die Zeile nie an, der WikiSync wertet sie als von Hand) und, wo sie still gelegt wird, `retired_origin = 'editor'` (das Protokoll kennt die frühere Herkunft der Stilllegung nicht) und `updated_at = now()` (der Stempel von Infopanel und Suche). Danach rechnet sie das Etikett der Träger neu (Kanon), wie das Vorwärts-Schreiben.
 * Folgen sonst: keine. `traeger.sources` und `source.update` lösen weder Auftrag noch Ableitung noch Ereignis `map.changed` aus (`inhalteOperation`); eine Rücknahme nur der Quellen geht darum über dieselbe
 * Naht (`nahtDerQuellen`), eine mit Feldern über die der Karte. Die Infopanels sehen die Änderung, weil die Leser-Revision der Subjects `max(map_operation.seq)` folgt.
 *
 * 🔴 **Beim Weg ist die Verwendung die der ganzen Straße** (Betreiber 2026-10-28): Das Protokoll hält die zusammengefasste Sicht über die Abschnitte fest (`fasseWegQuelleZusammen`), nicht jede Zeile für
 * sich. Zurück geht die Straße so, dass die Sicht wieder dem Stand davor entspricht: War die Quelle vorher aktiv, trägt jeder Abschnitt sie danach aktiv mit den Angaben von damals (fehlende Zeilen
 * werden angelegt); war sie es nicht, wird jeder Abschnitt, der sie aktiv trägt, gelöst oder unterdrückt. 🪤 Grenze der Genauigkeit: War die Quelle vorher nur an einem Teil der Abschnitte, kommt sie
 * nicht auf genau diesen Teil zurück, sondern auf alle. Das Wege-Fenster und das Protokoll kennen Abschnitte nicht (Betreiber: „einzelne abschnitte sind technische details von uns“).
 *
 * **Bedingung** (streng, alles oder nichts): Der Stand jeder Verwendung heute ist gleich dem nach dem letzten Mitglied (Zustand und Angaben; beim Weg die Sicht der Straße). Das fängt die Änderung
 * ohne Operation am Träger ab: Eine Verwendung, die jemand von der Quelle her änderte (`source.update` schreibt am Ort, Gebiet oder der Landschaft keinen Eintrag), steht nicht in der Serie des Trägers.
 * Dazu die Ziele, auf die die Rücknahme zurückgeht: Soll eine Verwendung wieder aktiv werden, muss der Träger aktiv und die Quelle nicht stillgelegt sein (wie `traeger.sources` es verlangte).
 */

/** Die Aktion im Fachprotokoll, mit der `traeger.sources` und die Rücknahme die Quellen am Träger festhalten. */
const AKTION = {
    place: "place.sources_changed",
    territory: "territory.sources_changed",
    area: "region.sources_changed",
    peak: "peak.sources_changed",
    path: "path.sources_changed",
} as const satisfies Record<InhalteTraegerQuellenArt, string>;
const QUELLEN_AKTIONEN: ReadonlySet<string> = new Set(Object.values(AKTION));

/** Die Art des Gegenstands im Verlauf („Änderungen“): die Landschaft heißt dort `landscape`. */
const OBJEKT_ART: Readonly<Record<InhalteTraegerArt, MapHistoryObjectKind>> = {
    place: "place",
    territory: "territory",
    area: "landscape",
    peak: "peak",
    path: "path",
};

/** Die Aktion, die die Quellen der Art am Träger festhält (`place.sources_changed` …). */
export const quellenAktion = (kind: InhalteTraegerQuellenArt): string => AKTION[kind];

/** Ob eine Aktion die Quellen eines Trägers festhält (gleich welcher Art). */
export const istQuellenAktion = (aktion: string): boolean => QUELLEN_AKTIONEN.has(aktion);

/**
 * Ob ein Mitglied allein aus den Quellen dieses Trägers besteht: die Operation gehört dazu (`traeger.sources`, oder eine Rücknahme) und jeder ihrer Einträge ist die Aktion der Art. Eine Rücknahme
 * von Feldern UND Quellen (`place.restore_series` mit `place.updated` und `place.sources_changed`) ist es nicht; sie ist ein Mitglied der Felder, das auch Quellen trägt.
 */
export const nurQuellen = (
    kind: InhalteTraegerQuellenArt,
    operationen: ReadonlySet<string>,
    operation: string,
    aktionen: readonly string[],
): boolean => operationen.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => aktion === AKTION[kind]);

/** Ob ein Mitglied außer seinen Feldern auch Quellen dieses Trägers festhält. */
export const traegtQuellen = (kind: InhalteTraegerQuellenArt, aktionen: readonly string[]): boolean =>
    aktionen.some((aktion) => aktion === AKTION[kind]);

/** Ob ein offenes Mitglied der Vorprüfung Quellen dieses Trägers führt (dann liest die Sperre der Zeilen die Einträge, sonst nicht). */
export const hatQuellen = (vor: Pick<Vorpruefung, "mitglieder">, kind: InhalteTraegerQuellenArt): boolean =>
    vor.mitglieder.some(
        (mitglied) =>
            mitglied.offen &&
            traegtQuellen(
                kind,
                mitglied.gegenstaende.map((gegenstand) => gegenstand.action),
            ),
    );

/**
 * Die Naht der Schreibnaht (`RuecknahmeFamilie.naht`): Besteht jedes offene Mitglied nur aus Quellen von Trägern, geht die Rücknahme über die Naht der Inhalte (kein Ereignis `map.changed`, keine
 * Ableitung: es ändert sich weder Linie noch Fläche noch Name); sonst über die der Karte.
 */
export const nahtDerQuellen = (vor: Vorpruefung): "karte" | "inhalte" => {
    const offen = vor.mitglieder.filter((mitglied) => mitglied.offen);
    return offen.length > 0 &&
        offen.every(
            (mitglied) =>
                mitglied.gegenstaende.length > 0 &&
                mitglied.gegenstaende.every((gegenstand) => istQuellenAktion(gegenstand.action)),
        )
        ? "inhalte"
        : "karte";
};

// --- Der Plan ---------------------------------------------------------------------------------------------------------------

export type Zustand = "active" | "retired" | "suppressed";
const ZUSTAENDE: ReadonlySet<string> = new Set<Zustand>(["active", "retired", "suppressed"]);

/** Der Stand einer Verwendung, wie das Protokoll ihn führt: `none` heißt, es gab die Zeile nicht. */
export interface ZeilenStand {
    state: Zustand | "none";
    referenceKind: string | null;
    pages: string | null;
    note: string | null;
}

/** Was eine Verwendung (ein Träger, eine Quelle) über die Serie hinweg erlebt hat: der Stand vor dem ersten und nach dem letzten Mitglied, das sie berührt. */
export interface QuellenZiel {
    kind: InhalteTraegerArt;
    /** Die öffentliche Kennung des Trägers; beim Weg der Anker der Straße. */
    carrierId: string;
    /** Die öffentliche Kennung der Quelle. */
    sourceId: string;
    /** Der Titel der Quelle, wie das Protokoll ihn nennt (nur zur Auskunft). */
    titel?: string;
    vorher: ZeilenStand;
    nachher: ZeilenStand;
}

/** Schlüssel: `<Art>|<Träger>|<Quelle>`. */
export type QuellenPlan = Map<string, QuellenZiel>;

const zielSchluessel = (kind: string, carrierId: string, sourceId: string): string =>
    `${kind}|${carrierId}|${sourceId}`;
export const traegerSchluessel = (kind: string, carrierId: string): string => `${kind}|${carrierId}`;

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);
const istTextOderLeer = (wert: unknown): boolean => wert === undefined || wert === null || typeof wert === "string";

/** Der Stand aus einem Eintrag des Protokolls; `undefined`, wenn er so nicht lesbar ist. */
function alsStand(wert: unknown): ZeilenStand | undefined {
    if (!istObjekt(wert)) return undefined;
    const state = wert["state"];
    if (typeof state !== "string" || (state !== "none" && !ZUSTAENDE.has(state))) return undefined;
    if (!istTextOderLeer(wert["referenceKind"]) || !istTextOderLeer(wert["pages"]) || !istTextOderLeer(wert["note"]))
        return undefined;
    return {
        state: state as ZeilenStand["state"],
        referenceKind: (wert["referenceKind"] as string | null | undefined) ?? null,
        pages: (wert["pages"] as string | null | undefined) ?? null,
        note: (wert["note"] as string | null | undefined) ?? null,
    };
}

const KEIN_LESEN = (feld: string) => nichtRuecknehmbar("den Quellen", feld);

/** Die Liste einer Seite des Protokolls (`before` oder `after`); fehlt sie, ist sie leer. */
function alsListe(wert: unknown, feld: string): Record<string, unknown>[] {
    if (wert === undefined || wert === null) return [];
    if (!Array.isArray(wert) || !wert.every(istObjekt)) throw KEIN_LESEN(feld);
    return wert as Record<string, unknown>[];
}

/** Legt ein Ziel in den Plan oder führt es mit dem früheren zusammen: der Stand vor dem ersten bleibt, der nach dem letzten gilt. */
function falte(plan: QuellenPlan, ziel: QuellenZiel, feld: string): void {
    if (ziel.nachher.state === "none") throw KEIN_LESEN(feld);
    const schluessel = zielSchluessel(ziel.kind, ziel.carrierId, ziel.sourceId);
    const bisher = plan.get(schluessel);
    if (bisher === undefined) plan.set(schluessel, ziel);
    else {
        bisher.nachher = ziel.nachher;
        if (ziel.titel !== undefined) bisher.titel = ziel.titel;
    }
}

/**
 * Der Plan aus den Protokolleinträgen am Träger (`<art>.sources_changed`, `changes.quellen`): je Quelle der Stand vor dem ersten und nach dem letzten Mitglied. Nur Gegenstände der Art `kind`
 * zählen; alles andere gehört den Feldern der Familie.
 */
export function planAusTraeger(eintraege: readonly MapHistoryEntry[], kind: InhalteTraegerQuellenArt): QuellenPlan {
    const plan: QuellenPlan = new Map();
    for (const eintragImVerlauf of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintragImVerlauf.objects) {
            if (gegenstand.action !== AKTION[kind]) continue;
            const wechsel = gegenstand.changes["quellen"];
            if (wechsel === undefined || wechsel.omitted === true) throw KEIN_LESEN("quellen");
            const davor = new Map<string, ZeilenStand>();
            for (const zeile of alsListe(wechsel.before, "quellen")) {
                const stand = alsStand(zeile);
                if (typeof zeile["sourceId"] !== "string" || stand === undefined) throw KEIN_LESEN("quellen");
                davor.set(zeile["sourceId"], stand);
            }
            for (const zeile of alsListe(wechsel.after, "quellen")) {
                const nachher = alsStand(zeile);
                const sourceId = zeile["sourceId"];
                if (typeof sourceId !== "string" || nachher === undefined) throw KEIN_LESEN("quellen");
                const vorher = davor.get(sourceId);
                if (vorher === undefined) throw KEIN_LESEN("quellen");
                falte(
                    plan,
                    {
                        kind,
                        carrierId: gegenstand.id,
                        sourceId,
                        ...(typeof zeile["title"] === "string" ? { titel: zeile["title"] } : {}),
                        vorher,
                        nachher,
                    },
                    "quellen",
                );
            }
        }
    return plan;
}

/**
 * Der Plan aus den Protokolleinträgen an der Quelle (`source.updated`, `changes.links`): je Verwendung (Art und Kennung des Trägers) der Stand vor dem ersten und nach dem letzten Mitglied. Die Einträge
 * `path.sources_changed` am Anker der Straße, die dieselbe Operation neben `source.updated` schreibt, sagen dasselbe und werden nicht noch einmal gelesen.
 */
export function planAusQuelle(eintraege: readonly MapHistoryEntry[]): QuellenPlan {
    const plan: QuellenPlan = new Map();
    for (const eintragImVerlauf of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintragImVerlauf.objects) {
            if (gegenstand.kind !== "source" || gegenstand.action !== "source.updated") continue;
            const wechsel = gegenstand.changes["links"];
            if (wechsel === undefined) continue;
            if (wechsel.omitted === true) throw KEIN_LESEN("links");
            const davor = new Map<string, ZeilenStand>();
            for (const zeile of alsListe(wechsel.before, "links")) {
                const stand = alsStand(zeile);
                if (typeof zeile["kind"] !== "string" || typeof zeile["carrierId"] !== "string" || stand === undefined)
                    throw KEIN_LESEN("links");
                davor.set(traegerSchluessel(zeile["kind"], zeile["carrierId"]), stand);
            }
            for (const zeile of alsListe(wechsel.after, "links")) {
                const nachher = alsStand(zeile);
                const kind = zeile["kind"];
                const carrierId = zeile["carrierId"];
                if (typeof kind !== "string" || typeof carrierId !== "string" || nachher === undefined)
                    throw KEIN_LESEN("links");
                if (!Object.hasOwn(TRAEGER, kind)) throw KEIN_LESEN("links");
                const vorher = davor.get(traegerSchluessel(kind, carrierId));
                if (vorher === undefined) throw KEIN_LESEN("links");
                falte(
                    plan,
                    {
                        kind: kind as InhalteTraegerArt,
                        carrierId,
                        sourceId: gegenstand.id,
                        ...(gegenstand.name !== undefined ? { titel: gegenstand.name } : {}),
                        vorher,
                        nachher,
                    },
                    "links",
                );
            }
        }
    return plan;
}

/** Der Zustand, auf den eine Verwendung zurückgeht: der vor der Serie; eine Zeile, die es vor ihr nicht gab, wird still gelegt (`retired`, nie gelöscht). */
const zielZustand = (vorher: ZeilenStand): Zustand => (vorher.state === "none" ? "retired" : vorher.state);

/** Die Angaben, auf die eine Zeile zurückgeht; fehlt der Stand davor (neu angelegt), bleiben sie, wie sie sind. */
const zielAngaben = (
    vorher: ZeilenStand,
): { referenceKind: string | null; pages: string | null; note: string | null } | undefined =>
    vorher.state === "none"
        ? undefined
        : { referenceKind: vorher.referenceKind, pages: vorher.pages, note: vorher.note };

const gleichAngaben = (
    zeile: Pick<LinkZeile, "reference_kind" | "pages" | "note">,
    angaben: { referenceKind: string | null; pages: string | null; note: string | null } | undefined,
): boolean =>
    angaben === undefined ||
    (gleichWert(zeile.reference_kind, angaben.referenceKind) &&
        gleichWert(zeile.pages, angaben.pages) &&
        gleichWert(zeile.note, angaben.note));

// --- Der heutige Stand ------------------------------------------------------------------------------------------------------

/** Ein Träger heute. */
export interface TraegerIst {
    name: string;
    /** Beim Weg: die Straße ist auf der Karte. */
    aktiv: boolean;
    revision: number | null;
    /** Die internen Nummern (für das Etikett): ein Träger, beim Weg alle Abschnitte der Straße. */
    ids: string[];
    /** Beim Weg: Die Straße unter diesem Anker besteht nicht mehr so (geteilt, verbunden, umbenannt): Sie ist nicht dieselbe wie damals. */
    verwandelt?: true;
}

/** Eine Quelle heute. */
export interface QuelleIst {
    id: string;
    title: string;
    is_active: boolean;
    revision: number;
}

/** Eine Verwendung heute: die Zeilen der Verknüpfung (beim Weg je Abschnitt eine, sonst höchstens eine) und ihr Stand, so wie das Protokoll ihn führt (beim Weg die Sicht der Straße). */
export interface ZeilenIst {
    zeilen: Verknuepfung[];
    stand: ZeilenStand | undefined;
}

export interface QuellenIst {
    traeger: Map<string, TraegerIst | undefined>;
    quellen: Map<string, QuelleIst | undefined>;
    ziele: Map<string, ZeilenIst>;
}

const alsZeilenStand = (zeile: Pick<LinkZeile, "state" | "reference_kind" | "pages" | "note">): ZeilenStand => ({
    state: zeile.state as Zustand,
    referenceKind: zeile.reference_kind,
    pages: zeile.pages,
    note: zeile.note,
});

const gruppiert = <T>(liste: readonly T[], schluessel: (eines: T) => string): Map<string, T[]> => {
    const gruppen = new Map<string, T[]>();
    for (const eines of liste) {
        const key = schluessel(eines);
        gruppen.set(key, [...(gruppen.get(key) ?? []), eines]);
    }
    return gruppen;
};

/** Der heutige Stand aller Quellen, Träger und Zeilen, die der Plan nennt. Was es nicht gibt, fehlt (`undefined`). */
export async function leseQuellenIst(db: Queryable, plan: QuellenPlan): Promise<QuellenIst> {
    const ziele = [...plan.values()];
    const ist: QuellenIst = { traeger: new Map(), quellen: new Map(), ziele: new Map() };

    const sourceIds = [...new Set(ziele.map((ziel) => ziel.sourceId))];
    const quellen = new Map<string, QuelleIst & { public_id: string }>();
    if (sourceIds.length > 0)
        for (const zeile of await db<(QuelleIst & { public_id: string })[]>`
            SELECT public_id::text AS public_id, id::text AS id, title, is_active, revision::int AS revision
              FROM feature_source WHERE public_id = ANY(${sourceIds}::uuid[])
        `)
            quellen.set(zeile.public_id, zeile);
    for (const id of sourceIds) ist.quellen.set(id, quellen.get(id));

    for (const [kind, zielDerArt] of gruppiert(ziele, (ziel) => ziel.kind)) {
        const carrierIds = [...new Set(zielDerArt.map((ziel) => ziel.carrierId))];
        if (kind === "path") {
            for (const carrierId of carrierIds) {
                const strasse = await readEditorPathStreet(db, carrierId);
                const key = traegerSchluessel("path", carrierId);
                if (strasse === undefined) {
                    ist.traeger.set(key, undefined);
                    continue;
                }
                const kennungen = strasse.segments.map((abschnitt) => abschnitt.id);
                const abschnitte = await db<{ id: string; public_id: string }[]>`
                    SELECT id::text AS id, public_id::text AS public_id FROM path WHERE public_id = ANY(${kennungen}::uuid[])
                `;
                const folge = new Map(kennungen.map((id, index) => [id, index] as const));
                ist.traeger.set(key, {
                    name: strasse.name,
                    aktiv: strasse.offMap !== true && strasse.deleted !== true,
                    revision: Math.max(...strasse.segments.map((abschnitt) => abschnitt.revision)),
                    ids: abschnitte.map((abschnitt) => abschnitt.id),
                    ...(strasse.id !== carrierId ? { verwandelt: true as const } : {}),
                });
                for (const ziel of zielDerArt.filter((eines) => eines.carrierId === carrierId)) {
                    const quelle = quellen.get(ziel.sourceId);
                    const zeilen =
                        quelle === undefined ? [] : await leseVerknuepfungen(db as Sql, kennungen, quelle.id, false);
                    ist.ziele.set(zielSchluessel("path", carrierId, ziel.sourceId), {
                        zeilen,
                        stand:
                            zeilen.length === 0
                                ? undefined
                                : alsZeilenStand(sichtAlsZeile(fasseWegQuelleZusammen(zeilen, folge))!),
                    });
                }
            }
            continue;
        }
        const t = TRAEGER[kind as InhalteTraegerArt];
        const traeger = await db.unsafe<
            { public_id: string; id: string; name: string; is_active: boolean; revision: number }[]
        >(
            `SELECT public_id::text AS public_id, id::text AS id, name, is_active, revision::int AS revision FROM ${t.carrier} WHERE public_id = ANY($1::uuid[])`,
            [carrierIds] as never[],
        );
        const traegerVon = new Map(traeger.map((zeile) => [zeile.public_id, zeile] as const));
        for (const carrierId of carrierIds) {
            const zeile = traegerVon.get(carrierId);
            ist.traeger.set(
                traegerSchluessel(kind, carrierId),
                zeile === undefined
                    ? undefined
                    : { name: zeile.name, aktiv: zeile.is_active, revision: zeile.revision, ids: [zeile.id] },
            );
        }
        const zeilen = await db.unsafe<(Verknuepfung & { carrier: string; quelle: string })[]>(
            `SELECT l.id::text AS id, c.public_id::text AS carrier, f.public_id::text AS quelle, l.state, l.is_active, l.reference_kind,
                    l.pages, l.note, l.source_system, l.updated_at
               FROM ${t.link} l
               JOIN ${t.carrier} c ON c.id = l.${t.foreignKey}
               JOIN feature_source f ON f.id = l.source_id
              WHERE c.public_id = ANY($1::uuid[]) AND f.public_id = ANY($2::uuid[])`,
            [carrierIds, [...new Set(zielDerArt.map((ziel) => ziel.sourceId))]] as never[],
        );
        const nachSchluessel = new Map(
            zeilen.map((zeile) => [zielSchluessel(kind, zeile.carrier, zeile.quelle), zeile] as const),
        );
        for (const ziel of zielDerArt) {
            const zeile = nachSchluessel.get(zielSchluessel(kind, ziel.carrierId, ziel.sourceId));
            ist.ziele.set(zielSchluessel(kind, ziel.carrierId, ziel.sourceId), {
                zeilen: zeile === undefined ? [] : [{ ...zeile, carrier_id: zeile.carrier }],
                stand: zeile === undefined ? undefined : alsZeilenStand(zeile),
            });
        }
    }
    return ist;
}

// --- Die Bedingung ----------------------------------------------------------------------------------------------------------

type Grund = "anders" | "fehlt" | "traeger_still" | "quelle_still" | "strasse";

/** Eine Verwendung, die so nicht zurückgehen kann, und warum. */
export interface Abweichung {
    ziel: QuellenZiel;
    grund: Grund;
    traeger: TraegerIst | undefined;
    quelle: QuelleIst | undefined;
}

const SATZ: Readonly<Record<Grund, string>> = {
    anders: "Heute anders als nach dem letzten Schritt",
    fehlt: "Das Objekt oder seine Verknüpfung gibt es nicht mehr",
    traeger_still: "Das Objekt ist still, die Quelle lässt sich nicht wieder anhängen",
    quelle_still: "Die Quelle ist stillgelegt, sie lässt sich nicht wieder anhängen",
    strasse: "Die Straße besteht nicht mehr so wie damals oder ist nicht auf der Karte",
};

const gleichStand = (heute: ZeilenStand | undefined, soll: ZeilenStand): boolean =>
    heute !== undefined &&
    heute.state === soll.state &&
    gleichWert(heute.referenceKind, soll.referenceKind) &&
    gleichWert(heute.pages, soll.pages) &&
    gleichWert(heute.note, soll.note);

/**
 * Die Verwendungen, die heute nicht so stehen, wie die Serie sie hinterließ, oder deren Ziel es nicht (mehr) gibt. Leer heißt: Es kann alles zurück. Liest nur.
 *
 * `belebt` nennt die Träger (`traegerSchluessel`), die dieselbe Rücknahme auf die Karte zurückholt (WI-0265 B8c: die Rücknahme einer Rücknahme, die eine angelegte Fläche samt ihren Quellen belebt): Sie sind
 * heute still, aber vor den Quellen wieder aktiv, darum ist ein stiller Träger dort kein Grund.
 */
export async function pruefeQuellen(
    db: Queryable,
    plan: QuellenPlan,
    belebt: ReadonlySet<string> = new Set(),
): Promise<Abweichung[]> {
    if (plan.size === 0) return [];
    const ist = await leseQuellenIst(db, plan);
    const abweichungen: Abweichung[] = [];
    for (const ziel of plan.values()) {
        const traeger = ist.traeger.get(traegerSchluessel(ziel.kind, ziel.carrierId));
        const quelle = ist.quellen.get(ziel.sourceId);
        const heute = ist.ziele.get(zielSchluessel(ziel.kind, ziel.carrierId, ziel.sourceId));
        const melde = (grund: Grund): void => {
            abweichungen.push({ ziel, grund, traeger, quelle });
        };
        if (traeger === undefined || quelle === undefined) melde("fehlt");
        else if (ziel.kind === "path" && (traeger.verwandelt === true || !traeger.aktiv)) melde("strasse");
        else if (!gleichStand(heute?.stand, ziel.nachher)) melde(heute?.stand === undefined ? "fehlt" : "anders");
        // Soll die Verwendung wieder aktiv werden, gilt, was `traeger.sources` verlangte: ein aktiver Träger und eine Quelle, die nicht stillgelegt ist.
        else if (
            zielZustand(ziel.vorher) === "active" &&
            !traeger.aktiv &&
            !belebt.has(traegerSchluessel(ziel.kind, ziel.carrierId))
        )
            melde("traeger_still");
        else if (zielZustand(ziel.vorher) === "active" && !quelle.is_active) melde("quelle_still");
    }
    return abweichungen;
}

/** Die Abweichungen als Konflikte der Art `wert`, einer je Träger (die Familien des Trägers): Gegenstand ist der Träger, das Feld `quellen`. */
export function konflikteAmTraeger(abweichungen: readonly Abweichung[]): VorKonflikt[] {
    const konflikte: VorKonflikt[] = [];
    for (const [, gruppe] of gruppiert(abweichungen, (a) => traegerSchluessel(a.ziel.kind, a.ziel.carrierId))) {
        const erste = gruppe[0]!;
        const name = erste.traeger?.name;
        konflikte.push({
            art: "wert",
            kind: OBJEKT_ART[erste.ziel.kind],
            id: erste.ziel.carrierId,
            ...(name === undefined ? {} : { name }),
            ...(erste.traeger?.revision != null ? { currentRevision: erste.traeger.revision } : {}),
            felder: ["quellen"],
            abweichung: { was: "felder" },
            detail: `${[...new Set(gruppe.map((a) => SATZ[a.grund]))].join(". ")}: quellen.`,
        });
    }
    return konflikte;
}

/** Die Abweichungen als Konflikte der Art `wert`, einer je Quelle (die Familie der Quelle): Gegenstand ist die Quelle, das Feld `links`. */
export function konflikteAnDerQuelle(abweichungen: readonly Abweichung[]): VorKonflikt[] {
    const konflikte: VorKonflikt[] = [];
    for (const [, gruppe] of gruppiert(abweichungen, (a) => a.ziel.sourceId)) {
        const erste = gruppe[0]!;
        const name = erste.quelle?.title ?? erste.ziel.titel;
        konflikte.push({
            art: "wert",
            kind: "source",
            id: erste.ziel.sourceId,
            ...(name === undefined ? {} : { name }),
            ...(erste.quelle !== undefined ? { currentRevision: erste.quelle.revision } : {}),
            felder: ["links"],
            abweichung: { was: "felder" },
            detail: `${[...new Set(gruppe.map((a) => SATZ[a.grund]))].join(". ")}: links.`,
        });
    }
    return konflikte;
}

// --- Sperren ----------------------------------------------------------------------------------------------------------------

/**
 * Sperrt die Träger und ihre Zeilen in fester Folge, bevor die Vorprüfung unter den Sperren wiederholt wird: erst eine Transaktionssperre je Träger (aufsteigend nach Art und Kennung; dieselbe wie
 * `traeger.sources`, beim Weg auf den Anker der Straße), dann die Zeilen der Verknüpfung (`FOR UPDATE`, nie der Träger: die App-Rolle hat am Träger keine Rechte für eine Zeilensperre und die
 * Revision des Trägers steigt durch Quellen nicht).
 */
export async function sperreQuellen(tx: Queryable, plan: QuellenPlan): Promise<void> {
    if (plan.size === 0) return;
    const ziele = [...plan.values()];
    const traeger = [...new Set(ziele.map((ziel) => traegerSchluessel(ziel.kind, ziel.carrierId)))].sort();
    for (const schluessel of traeger) {
        const i = schluessel.indexOf("|");
        await tx`SELECT pg_advisory_xact_lock(hashtext('traeger_quellen:schreiben'), hashtext(${`${schluessel.slice(0, i)}:${schluessel.slice(i + 1)}`}))`;
    }
    const sourceIds = [...new Set(ziele.map((ziel) => ziel.sourceId))].sort();
    for (const [kind, zielDerArt] of [...gruppiert(ziele, (ziel) => ziel.kind)].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const t = TRAEGER[kind as InhalteTraegerArt];
        const carrierIds = [...new Set(zielDerArt.map((ziel) => ziel.carrierId))].sort();
        if (kind === "path") {
            const kennungen: string[] = [];
            for (const carrierId of carrierIds) {
                const strasse = await readEditorPathStreet(tx, carrierId);
                if (strasse !== undefined) kennungen.push(...strasse.segments.map((abschnitt) => abschnitt.id));
            }
            if (kennungen.length > 0)
                await tx`
                    SELECT v.id FROM path_source v JOIN path p ON p.id = v.path_id JOIN feature_source f ON f.id = v.source_id
                     WHERE p.public_id = ANY(${kennungen}::uuid[]) AND f.public_id = ANY(${sourceIds}::uuid[])
                     ORDER BY v.id FOR UPDATE OF v
                `;
            continue;
        }
        await tx.unsafe(
            `SELECT l.id FROM ${t.link} l JOIN ${t.carrier} c ON c.id = l.${t.foreignKey} JOIN feature_source f ON f.id = l.source_id
              WHERE c.public_id = ANY($1::uuid[]) AND f.public_id = ANY($2::uuid[])
              ORDER BY l.id FOR UPDATE OF l`,
            [carrierIds, sourceIds] as never[],
        );
    }
}

// --- Schreiben --------------------------------------------------------------------------------------------------------------

/** Eine Zeile der Verknüpfung, wie sie vor und nach der Rücknahme im Protokoll steht (`protokollEintrag`). */
export interface GeschriebeneZeile {
    ziel: QuellenZiel;
    /** Die Katalogquelle, wie sie heute heißt (für den Eintrag im Protokoll). */
    quelle: QuelleZeile;
    vorher: Record<string, unknown>;
    nachher: Record<string, unknown>;
}

/** Was die Rücknahme an EINEM Träger geschrieben hat. */
export interface TraegerAenderung {
    kind: InhalteTraegerArt;
    carrierId: string;
    name: string;
    zeilen: GeschriebeneZeile[];
    /** Die internen Nummern der Träger, deren Etikett sich ändern kann (beim Weg alle Abschnitte). */
    ids: string[];
    /** Die Gegenstände für die Quittung: der Träger mit seiner Revision, beim Weg jeder Abschnitt. */
    affected: { kind: string; id: string; revision: number }[];
    /** Beim Weg: die gesperrte Straße (für den Eintrag am Anker). */
    lage?: StrassenLage;
}

type Angaben = { referenceKind: string | null; pages: string | null; note: string | null } | undefined;

/** Setzt eine Zeile der Verknüpfung auf Zustand und Angaben (wie das Lösen und Holen der Vorwärts-Operationen; `angaben` fehlt, wo nur der Zustand zurückgeht). */
async function setzeZeile(tx: Sql, link: string, id: string, zustand: Zustand, angaben: Angaben): Promise<void> {
    const mitAngaben = angaben === undefined ? "" : ", reference_kind = $3, pages = $4, note = $5";
    const parameter: unknown[] =
        angaben === undefined ? [id, zustand] : [id, zustand, angaben.referenceKind, angaben.pages, angaben.note];
    if (zustand === "active")
        await tx.unsafe(
            `UPDATE ${link} SET state = $2, is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()${mitAngaben} WHERE id = $1::bigint`,
            parameter as never[],
        );
    else
        await tx.unsafe(
            `UPDATE ${link} SET state = $2, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor', updated_at = now()${mitAngaben} WHERE id = $1::bigint`,
            parameter as never[],
        );
}

/** Legt die Zeile an einem Abschnitt an, der die Quelle noch nicht führte (wie das Anhängen); nur beim Weg nötig, wenn die Quelle vorher an der Straße stand. */
async function legeZeileAn(
    tx: Sql,
    link: string,
    foreignKey: string,
    traegerPk: string,
    quelleId: string,
    angaben: Angaben,
): Promise<void> {
    await tx.unsafe(
        `INSERT INTO ${link} (${foreignKey}, source_id, reference_kind, pages, note, position, state, is_active, source_system)
         VALUES ($1::bigint, $2::bigint, $3, $4, $5,
                 (SELECT coalesce(max(position) + 1, 0) FROM ${link} WHERE ${foreignKey} = $1::bigint),
                 'active', TRUE, 'editor')`,
        [traegerPk, quelleId, angaben?.referenceKind ?? null, angaben?.pages ?? null, angaben?.note ?? null] as never[],
    );
}

/**
 * Schreibt die Verwendungen des Plans auf den Stand vor der Serie (Träger gesperrt, `sperreQuellen`; die Werte hat die Vorprüfung eben geprüft). Gibt je Träger zurück, was geändert wurde; Verwendungen, die
 * schon so stehen, fehlen. Der Träger kommt in fester Folge (Art, Kennung), die Quellen je Träger nach Kennung.
 */
export async function schreibeQuellen(tx: Sql, plan: QuellenPlan): Promise<TraegerAenderung[]> {
    const ziele = [...plan.values()];
    const ist = await leseQuellenIst(tx, plan);
    const ergebnis: TraegerAenderung[] = [];
    const nachTraeger = [...gruppiert(ziele, (ziel) => traegerSchluessel(ziel.kind, ziel.carrierId))].sort(
        ([a], [b]) => (a < b ? -1 : 1),
    );
    for (const [schluessel, zieleDesTraegers] of nachTraeger) {
        const erstes = zieleDesTraegers[0]!;
        const traeger = ist.traeger.get(schluessel);
        if (traeger === undefined) throw nichtRuecknehmbar("den Quellen");
        const t = TRAEGER[erstes.kind];
        const geaendert: GeschriebeneZeile[] = [];
        const sortiert = [...zieleDesTraegers].sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1));

        if (erstes.kind !== "path") {
            for (const ziel of sortiert) {
                const heute = ist.ziele.get(zielSchluessel(ziel.kind, ziel.carrierId, ziel.sourceId));
                const zeile = heute?.zeilen[0];
                const katalog = ist.quellen.get(ziel.sourceId);
                if (zeile === undefined || katalog === undefined) throw nichtRuecknehmbar("den Quellen");
                const zustand = zielZustand(ziel.vorher);
                const angaben = zielAngaben(ziel.vorher);
                if (zeile.state === zustand && gleichAngaben(zeile, angaben)) continue;
                await setzeZeile(tx, t.link, zeile.id, zustand, angaben);
                geaendert.push({
                    ziel,
                    quelle: { id: katalog.id, title: katalog.title, is_active: katalog.is_active },
                    vorher: protokollEintrag(ziel.kind, ziel.carrierId, zeile),
                    nachher: protokollEintrag(ziel.kind, ziel.carrierId, {
                        state: zustand,
                        reference_kind: angaben === undefined ? zeile.reference_kind : angaben.referenceKind,
                        pages: angaben === undefined ? zeile.pages : angaben.pages,
                        note: angaben === undefined ? zeile.note : angaben.note,
                    }),
                });
            }
            if (geaendert.length === 0) continue;
            ergebnis.push({
                kind: erstes.kind,
                carrierId: erstes.carrierId,
                name: traeger.name,
                zeilen: geaendert,
                ids: traeger.ids,
                affected: [{ kind: OBJEKT_ART[erstes.kind], id: erstes.carrierId, revision: traeger.revision ?? 0 }],
            });
            continue;
        }

        // Die Straße: gesperrt, der Anker geprüft (409, wo sie sich verwandelt hat), dann jede Quelle auf allen Abschnitten.
        const lage = await sperreStrasse(tx, erstes.carrierId);
        for (const ziel of sortiert) {
            const quelle = ist.quellen.get(ziel.sourceId);
            if (quelle === undefined) throw nichtRuecknehmbar("den Quellen");
            const zeilen = await leseVerknuepfungen(tx, lage.kennungen, quelle.id, false);
            const sichtVorher = zeilen.length === 0 ? undefined : fasseWegQuelleZusammen(zeilen, lage.folge);
            const zustand = zielZustand(ziel.vorher);
            const angaben = zielAngaben(ziel.vorher);
            let geschrieben = false;
            if (zustand === "active") {
                // Danach trägt jeder Abschnitt die Quelle aktiv, mit den Angaben von damals; fehlt die Zeile, wird sie angelegt.
                for (const abschnitt of lage.entlang) {
                    const zeile = zeilen.find((eine) => eine.carrier_id === abschnitt.public_id);
                    if (zeile === undefined) {
                        await legeZeileAn(tx, t.link, t.foreignKey, abschnitt.id, quelle.id, angaben);
                        geschrieben = true;
                    } else if (zeile.state !== "active" || !gleichAngaben(zeile, angaben)) {
                        await setzeZeile(tx, t.link, zeile.id, "active", angaben);
                        geschrieben = true;
                    }
                }
            } else {
                // Gelöst oder unterdrückt wird jeder Abschnitt, der die Quelle aktiv trägt; wer sie schon gelöst hat oder nie trug, bleibt.
                for (const zeile of zeilen.filter((eine) => eine.state === "active")) {
                    await setzeZeile(tx, t.link, zeile.id, zustand, angaben);
                    geschrieben = true;
                }
            }
            if (!geschrieben) continue;
            const danach = await leseVerknuepfungen(tx, lage.kennungen, quelle.id, false);
            const sichtDanach = danach.length === 0 ? undefined : fasseWegQuelleZusammen(danach, lage.folge);
            geaendert.push({
                ziel,
                quelle: { id: quelle.id, title: quelle.title, is_active: quelle.is_active },
                vorher: protokollEintrag("path", lage.strasse.id, sichtAlsZeile(sichtVorher)),
                nachher: protokollEintrag("path", lage.strasse.id, sichtAlsZeile(sichtDanach)),
            });
        }
        if (geaendert.length === 0) continue;
        ergebnis.push({
            kind: "path",
            carrierId: erstes.carrierId,
            name: lage.strasse.name,
            zeilen: geaendert,
            ids: lage.abschnitte.map((abschnitt) => abschnitt.id),
            affected: lage.strasse.segments.map((abschnitt) => ({
                kind: "path",
                id: abschnitt.id,
                revision: abschnitt.revision,
            })),
            lage,
        });
    }
    return ergebnis;
}

/** Das Etikett der berührten Träger neu rechnen (Kanon, Rang 1 bis 3), in derselben Transaktion wie die Zeilen. */
export async function rechneKanonNeu(tx: Sql, aenderungen: readonly TraegerAenderung[]): Promise<void> {
    const beruehrt: Partial<Record<InhalteTraegerArt, Set<string>>> = {};
    for (const aenderung of aenderungen) {
        const menge = beruehrt[aenderung.kind] ?? new Set<string>();
        for (const id of aenderung.ids) menge.add(id);
        beruehrt[aenderung.kind] = menge;
    }
    await aktualisiereKanon(tx, beruehrt as BeruehrteTraeger);
}

// --- Die beiden Wege hinein -------------------------------------------------------------------------------------------------

/** Was die Rücknahme der Quellen an Trägern schreibt, für den Adapter der Familie. */
export interface TraegerQuellenErgebnis {
    affected: OperationReceipt["affected"];
    entries: MapAuditEntry[];
    /** Der Name des Trägers (der erste), für den Satz in der Liste. */
    name: string;
}

/**
 * Die Quellen eines Trägers zurücknehmen, für den Adapter der Familie (`kind`: Ort, Gebiet, Landschaft, Weg): Plan aus den Einträgen, exakter Setter, Etikett, und je Träger EIN Eintrag
 * `<art>.sources_changed` mit `changes.quellen` (vorher und nachher, dieselbe Form wie das Original, damit die Rücknahme der Rücknahme sie wieder liest). `undefined`, wo die Einträge keine Quellen
 * des Trägers führen.
 */
export async function schreibeTraegerQuellenZurueck(
    tx: Sql,
    eintraege: readonly MapHistoryEntry[],
    kind: InhalteTraegerQuellenArt,
    grund: string | undefined,
): Promise<TraegerQuellenErgebnis | undefined> {
    const plan = planAusTraeger(eintraege, kind);
    if (plan.size === 0) return undefined;
    const aenderungen = await schreibeQuellen(tx, plan);
    const entries: MapAuditEntry[] = [];
    const affected: OperationReceipt["affected"] = [];
    for (const aenderung of aenderungen) {
        entries.push(
            mitGrund(
                {
                    action: AKTION[kind],
                    ...PROTOKOLL[kind].ziel(aenderung.carrierId),
                    changes: {
                        quellen: {
                            before: aenderung.zeilen.map((zeile) =>
                                eintrag(zeile.quelle, zeile.ziel.sourceId, zeile.vorher),
                            ),
                            after: aenderung.zeilen.map((zeile) =>
                                eintrag(zeile.quelle, zeile.ziel.sourceId, zeile.nachher),
                            ),
                        },
                    },
                },
                grund,
            ),
        );
        affected.push(...aenderung.affected);
    }
    if (aenderungen.length > 0) await rechneKanonNeu(tx, aenderungen);
    return { affected, entries, name: aenderungen[0]?.name ?? [...plan.values()][0]?.titel ?? "" };
}

/**
 * Die Hand des Adapters der Quelle: schreibt die Verwendungen des Plans (alle mit dieser Quelle) in der Transaktion von `schreibeQuelleAendern`, in der die Quelle schon gesperrt ist und ihre Revision
 * genau einmal zählt. Gibt zurück, was `source.updated` als `changes.links` und der Weg als `path.sources_changed` festhält, und die berührten Träger für das Etikett (das `schreibeQuelleAendern` selbst
 * rechnet). `traeger` sammelt, was die Quittung nennen soll.
 */
export function exakteVerwendungen(
    plan: QuellenPlan,
    traeger: TraegerAenderung[],
): (tx: Sql, quelle: QuelleZeile & { publicId: string }) => Promise<ExakteVerwendungen> {
    return async (tx, quelle) => {
        const eigene: QuellenPlan = new Map([...plan].filter(([, ziel]) => ziel.sourceId === quelle.publicId));
        const aenderungen = await schreibeQuellen(tx, eigene);
        const vorher: Record<string, unknown>[] = [];
        const nachher: Record<string, unknown>[] = [];
        const beruehrt: Partial<Record<InhalteTraegerArt, Set<string>>> = {};
        const eintraegeWege: MapAuditEntry[] = [];
        for (const aenderung of aenderungen) {
            traeger.push(aenderung);
            const menge = beruehrt[aenderung.kind] ?? new Set<string>();
            for (const id of aenderung.ids) menge.add(id);
            beruehrt[aenderung.kind] = menge;
            for (const zeile of aenderung.zeilen) {
                // Die Quelle nennt die Straße mit ihrem Namen; die Straße schreibt der Eintrag am Anker (Verlauf des Wegeditors).
                const mitName = aenderung.kind === "path" ? { name: aenderung.name } : {};
                vorher.push({ ...zeile.vorher, ...mitName });
                nachher.push({ ...zeile.nachher, ...mitName });
                if (aenderung.lage !== undefined)
                    eintraegeWege.push(
                        wegEintrag(
                            aenderung.lage,
                            [eintrag(quelle, quelle.publicId, zeile.vorher)],
                            [eintrag(quelle, quelle.publicId, zeile.nachher)],
                        ),
                    );
            }
        }
        return { vorher, nachher, beruehrt, eintraegeWege };
    };
}

// --- Ergebnisse mischen -----------------------------------------------------------------------------------------------------

const satzDerAnzahl = (n: number): string => (n === 1 ? "1 Änderung" : `${String(n)} Änderungen`);

/**
 * Das Ergebnis der Familie, wenn eine Rücknahme Felder UND Quellen eines Trägers enthält: eine Quittung, die Einträge beider, ein Satz für die Liste. Hat die Rücknahme keine Felder, ist es allein
 * die der Quellen. `mitglieder` ist die Zahl der zurückgenommenen Operationen.
 */
export function mischeErgebnis(
    felder: SchreibErgebnis | undefined,
    quellen: TraegerQuellenErgebnis | undefined,
    mitglieder: number,
): SchreibErgebnis {
    if (quellen === undefined) {
        if (felder === undefined) throw nichtRuecknehmbar("den Quellen");
        return felder;
    }
    if (felder === undefined)
        return {
            receipt: { affected: quellen.affected, derivedWork: [], warnings: [] },
            summary: `Quellen von „${quellen.name}“: ${satzDerAnzahl(mitglieder)} zurückgenommen`,
            entries: quellen.entries,
        };
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    for (const eines of [...felder.receipt.affected, ...quellen.affected])
        affected.set(`${eines.kind}:${eines.id}`, eines);
    return {
        ...felder,
        receipt: { ...felder.receipt, affected: [...affected.values()] },
        summary: `${quellen.name}: ${satzDerAnzahl(mitglieder)} zurückgenommen`,
        entries: [...felder.entries, ...quellen.entries],
    };
}
