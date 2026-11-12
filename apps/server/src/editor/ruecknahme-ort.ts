import {
    EDITOR_PLACE_TEXT_FIELDS,
    type Capability,
    type EditorPathEnd,
    type EditorPlaceTextChange,
    type MapHistoryEntry,
    type MapHistoryObject,
    type OperationReceipt,
    type PlaceUpdateBody,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor, MapAuditEntry } from "./map-operation.ts";
import {
    aendereOrt,
    nimmOrtVonDerKarteIn,
    ownValue,
    pathEndsAt,
    placeUnplaced,
    pruefeFremdeOrtssperre,
    readPlace,
    verschiebeOrtIn,
    type PlaceRow,
} from "./place-edit.ts";
import { holeOrtZurueck, loescheOrt } from "./place-removal.ts";
import { kraftlinienAm, pruefeEntfernen } from "./place-removal-regeln.ts";
import {
    ORT_ABNEHMEN_OPERATIONEN,
    ORT_ANLEGEN_OPERATION,
    ORT_FELDER_OPERATIONEN,
    ORT_LOESCHEN_OPERATIONEN,
    ORT_QUELLEN_OPERATIONEN,
    ORT_VERSCHIEBEN_OPERATIONEN,
    ORT_WIEDERHERSTELLEN_OPERATIONEN,
    RUECKNAHME_ORT_OPERATION,
} from "./ruecknahme-arten.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeSchreiben,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import {
    hatQuellen,
    konflikteAmTraeger,
    mischeErgebnis,
    nahtDerQuellen,
    nurQuellen,
    planAusTraeger,
    pruefeQuellen,
    schreibeTraegerQuellenZurueck,
    sperreQuellen,
    traegtQuellen,
} from "./ruecknahme-traeger-quellen.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, Vorpruefung, VorMitglied } from "./ruecknahme.ts";

/**
 * Orte zurücknehmen (WI-0265 B4; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3 „Mehrscope“, F.1, Gate 2 und 3; Testvertrag U4, U6, U7, U8, U9):
 * der Adapter des Ortes für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `place.restore_series` (Quelle `restore`, `reverts` = die offenen
 * Mitglieder in Serienfolge, EIN `deriveAfter`; Ablauf, Fehler und Sperren in `ruecknahme-ablauf.ts`). Die Route hängt an EINEM Ort (`:id`); jedes Mitglied berührt ihn.
 *
 * Vier Arten Mitglied, nach den Protokolleinträgen, nicht nach dem Namen der Operation:
 *
 * - **Felder** (`place.update`, Aktion `place.updated`; auch eine frühere Rücknahme): die Felder des Orts (Name, Ortsgröße, Art, die sieben Merkmale Verborgen, Ruine, Seehafen, Nodix,
 *   **Unterirdisch, Entrückt und Ungefähre Lage** wie jedes andere Merkmal) und die vier Texte samt Herkunft. Mehrere zusammen sind eine Arbeitsserie (derselbe Ort, dieselbe Person):
 *   je Feld der Wert VOR dem ersten Mitglied, das es berührt, in EINEM `place.updated`. Folgte ein Wert vorher dem Wiki, kommt er als `revert: "wiki"` zurück, sonst als eigener Wert
 *   (C.3, wie das ↺ im Verlauf des Orts). Bedingung: Revision und Feldwerte heute gleich dem Stand nach dem letzten Mitglied.
 * - **Verschieben** (`place.move` samt Wegenden, Aktionen `place.moved` und `path.endpoint_moved`): geht nur allein und nur, wenn der Ort UND JEDES mitgezogene Wegende noch am Endstand
 *   stehen (Mehrscope, U7); sonst `edit_conflict` mit der Liste der abweichenden Enden (Art `wert`, Gegenstand der Weg). Der Ort und alle Enden gehen in einer Operation zurück,
 *   über denselben Schreibweg wie das Verschieben (`verschiebeOrtIn`): die gezeichnete Kurve, die Höhen an Flüssen, die Kraftlinien, Wegeprofile und Routing über die Schreibnaht.
 * - **Löschen** (`place.delete`, einzeln oder für mehrere, Aktion `place.deleted`/`place.deleted_unplaced`): geht nur allein. ALLE Orte der Operation kommen in EINER Operation zurück
 *   oder keiner (die Mehrfachauswahl „Ganz löschen“ ohne Schleife des Clients); die Stätten, die mit diesem Löschen stillgelegt wurden, kommen mit.
 *
 * - **Quellen** (`traeger.sources`, Aktion `place.sources_changed`; WI-0265 B6g3): die Klappbox des Ortseditors. Sie teilen die Serie des Orts (derselbe Ort, dieselbe Person) und gehen mit den Feldern in
 *   EINER Rücknahme ganz oder gar nicht zurück: Jede Verknüpfung auf Zustand und Angaben vor der Serie, eine neue still gelegt, das Etikett neu gerechnet (`ruecknahme-traeger-quellen.ts`). Das Recht dazu
 *   ist das der Vorwärts-Operation (`manage_sources`); eine Serie aus Feldern und Quellen verlangt beide Rechte. Der Ort bekommt dadurch keine Revision, das Protokoll führt sie als Eintrag ohne.
 *   Nur Quellen gehen über die Naht der Inhalte (kein Ereignis `map.changed`, keine Ableitung), wie das Original.
 *
 * - **Mehrfachbearbeitung** (`place.sammel`, WI-0265 B8a): EINE Operation über mehrere Orte, ein `place.updated` je Ort. Sie ist eine Art `felder` und geht über ALLE Orte zusammen oder gar nicht
 *   (prüfen und schreiben über alle Gegenstände; ein Ort, den seither jemand anders änderte, hält alle an). Die Route hängt an EINEM der Orte.
 * - **Anlegen** (`place.create`, WI-0265 B8a): zurücknehmen heißt **stilllegen**, über denselben Weg wie „Ganz löschen“ (`loescheOrt`, samt `pruefeEntfernen` und den Stätten); die Rücknahme davon
 *   (`loeschen`) belebt den Ort wieder. Eine Serie darf mit dem Anlegen beginnen (Felder, Quellen, Verschieben, Abnehmen und Setzen danach) und geht als Ganzes zurück: stillgelegt wird der Ort, die Felder
 *   davor sind dann ohne Belang. Streng: Hat seither jemand etwas an den Ort gehängt (ein Weg, dessen Ende dort liegt und der nach dem Anlegen gezeichnet oder geändert wurde, eine Kraftlinie, eine
 *   andere Wiki-Zuordnung als beim Anlegen) oder ihn geändert, geht nichts zurück (409, `abweichung`).
 * - **Wiederherstellen** (`place.restore`, und die Rücknahme eines Löschens): zurücknehmen heißt wieder stilllegen; die Stätten gehen wie beim Löschen mit.
 * - **Von der Karte nehmen** (`place.take_off_map`) und sein Gegenstück **Setzen auf die Karte** (`place.move` mit Aktion `place.placed`): jedes ist die Inverse des anderen. Zurück auf die Karte geht an die
 *   Lage davor (`placeUnplaced`, derselbe Weg wie das Setzen), von der Karte nehmen über `nimmOrtVonDerKarteIn`; beides mit den Prüfungen des Vorwärts.
 *
 * Nicht rücknehmbar (Grund `art`): die Stätten des Orts und ein Löschen oder Verschieben ZUSAMMEN mit anderen Mitgliedern (erst das Löschen zurück, dann die Felder).
 */

type Art =
    "felder" | "verschieben" | "loeschen" | "quellen" | "anlegen" | "wiederherstellen" | "abnehmen" | "aufsetzen";

// Die Namen der Operationen stehen im Katalog (`ruecknahme-arten.ts`, WI-0265 B6f): Liste, Zustandsfilter und dieser Adapter sagen so dasselbe.

/** Welche Art Mitglied eine Operation ist, nach ihrem Namen und den Aktionen ihrer Protokolleinträge; `undefined`, wenn keine, die die Rücknahme kennt. */
function artVon(operation: string, aktionen: readonly string[]): Art | undefined {
    if (aktionen.length === 0) return undefined;
    // Felder, auch zusammen mit den Quellen des Orts (eine Rücknahme von Feldern und Quellen trägt beides).
    if (
        ORT_FELDER_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "place.updated" || aktion === "place.sources_changed") &&
        aktionen.some((aktion) => aktion === "place.updated")
    )
        return "felder";
    if (nurQuellen("place", ORT_QUELLEN_OPERATIONEN, operation, aktionen)) return "quellen";
    if (
        ORT_VERSCHIEBEN_OPERATIONEN.has(operation) &&
        aktionen.filter((aktion) => aktion === "place.moved").length === 1 &&
        aktionen.every((aktion) => aktion === "place.moved" || aktion === "path.endpoint_moved")
    )
        return "verschieben";
    // Das Löschen, und die Rücknahme eines Anlegens oder Wiederherstellens (sie stilllegt mit demselben Weg und schreibt `place.deleted`).
    if (
        ORT_LOESCHEN_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "place.deleted" || aktion === "place.deleted_unplaced")
    )
        return "loeschen";
    // Anlegen: `place.create`; `place.update` nur, wenn es zugleich einen Ort anlegt (Aktion `place.created`).
    if (
        (operation === ORT_ANLEGEN_OPERATION || operation === "place.update") &&
        aktionen.filter((aktion) => aktion === "place.created").length === 1 &&
        aktionen.every(
            (aktion) => aktion === "place.created" || aktion === "place.updated" || aktion === "place.sources_changed",
        )
    )
        return "anlegen";
    if (ORT_WIEDERHERSTELLEN_OPERATIONEN.has(operation) && aktionen.every((aktion) => aktion === "place.restored"))
        return "wiederherstellen";
    if (ORT_ABNEHMEN_OPERATIONEN.has(operation) && aktionen.every((aktion) => aktion === "place.taken_off_map"))
        return "abnehmen";
    if (
        ORT_VERSCHIEBEN_OPERATIONEN.has(operation) &&
        aktionen.length === 1 &&
        aktionen.every((aktion) => aktion === "place.placed")
    )
        return "aufsetzen";
    return undefined;
}

/** Was eine Serie mit einem Anlegen enthalten darf: Danach ist der Ort nur noch stillzulegen, und keine dieser Änderungen ändert daran etwas. */
const IN_ANLEGEN_SERIE: ReadonlySet<Art | undefined> = new Set<Art | undefined>([
    "anlegen",
    "felder",
    "quellen",
    "verschieben",
    "abnehmen",
    "aufsetzen",
]);

const artDes = (mitglied: Pick<VorMitglied, "operation" | "gegenstaende">): Art | undefined =>
    artVon(
        mitglied.operation,
        mitglied.gegenstaende.map((gegenstand) => gegenstand.action),
    );
const artDesEintrags = (eintrag: MapHistoryEntry): Art | undefined =>
    artVon(
        eintrag.operation,
        eintrag.objects.map((gegenstand) => gegenstand.action),
    );

/** Die Felder des Orts, die ein `place.update` schreibt, mit ihrer Spalte in `PlaceRow`; die Texte kommen aus den Einzelheiten. */
const EINFACH = [
    "name",
    "subtype",
    "kind",
    "hidden",
    "ruined",
    "seaport",
    "nodix",
    "underground",
    "withdrawn",
    "approximate",
] as const;
type EinfachFeld = (typeof EINFACH)[number];
const TEXTE: readonly string[] = EDITOR_PLACE_TEXT_FIELDS;
const ISTWERT: Readonly<Record<EinfachFeld, (row: PlaceRow) => unknown>> = {
    name: (row) => row.name,
    subtype: (row) => row.subtype,
    kind: (row) => row.place_kind,
    hidden: (row) => row.is_hidden,
    ruined: (row) => row.is_ruined,
    seaport: (row) => row.is_seaport,
    nodix: (row) => row.is_nodix,
    underground: (row) => row.is_underground,
    withdrawn: (row) => row.is_withdrawn,
    approximate: (row) => row.is_approximate,
};
const istFeld = (row: PlaceRow, feld: string): unknown =>
    feld in ISTWERT
        ? ISTWERT[feld as EinfachFeld](row)
        : ownValue(row, feld as (typeof EDITOR_PLACE_TEXT_FIELDS)[number]);
const leer = (wert: unknown): unknown => wert ?? null;

/** Was ein Feld über die Serie hinweg erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt (C.3), und die Herkunft vor dem ersten, das sie änderte. */
interface FeldZiel {
    feld: string;
    vorher: unknown;
    nachher: unknown;
    herkunftVorher?: unknown;
}
interface OrtPlan {
    name?: string;
    felder: Map<string, FeldZiel>;
}

/** Die Felder der Mitglieder (`place.updated`) je Ort; die Einträge brauchen die volle Nutzlast. */
function planAusEintraegen(eintraege: readonly MapHistoryEntry[]): Map<string, OrtPlan> {
    const plan = new Map<string, OrtPlan>();
    const herkunft = new Map<string, Map<string, unknown>>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq)) {
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "place" || gegenstand.action !== "place.updated") continue;
            let ort = plan.get(gegenstand.id);
            if (ort === undefined) {
                ort = { felder: new Map(), ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}) };
                plan.set(gegenstand.id, ort);
            }
            for (const [schluessel, wechsel] of Object.entries(gegenstand.changes)) {
                // Der Grund einer Rücknahme (Gate 2) ist kein Feld des Orts; er steht an den Einträgen jeder Rücknahme (`place.restore_series`) und würde beim Zurücknehmen der Rücknahme
                // als unbekanntes Feld die ganze Rücknahme verweigern (WI-0265 B6a2).
                if (schluessel === "restoreReason") continue;
                // Die Herkunft (`nameOrigin`, `einwohnerOrigin` …) gilt dem Feld; ihr Wert VOR dem ersten Mitglied, das sie änderte, ist die Herkunft vor der ganzen Kette.
                if (schluessel.endsWith("Origin")) {
                    const feld = schluessel.slice(0, -"Origin".length);
                    const jeFeld = herkunft.get(gegenstand.id) ?? new Map<string, unknown>();
                    herkunft.set(gegenstand.id, jeFeld);
                    if (!jeFeld.has(feld)) jeFeld.set(feld, wechsel.before ?? null);
                    continue;
                }
                const bisher = ort.felder.get(schluessel);
                if (bisher === undefined)
                    ort.felder.set(schluessel, {
                        feld: schluessel,
                        vorher: wechsel.before ?? null,
                        nachher: wechsel.after ?? null,
                    });
                else bisher.nachher = wechsel.after ?? null;
            }
        }
    }
    for (const [id, jeFeld] of herkunft)
        for (const [feld, wert] of jeFeld) {
            const ziel = plan.get(id)?.felder.get(feld);
            if (ziel !== undefined) ziel.herkunftVorher = wert;
        }
    return plan;
}

/** Die Felder, die die Rücknahme der Felder versteht; ein anderes im Protokoll hält sie an, statt es zu übergehen. */
const BEKANNT: ReadonlySet<string> = new Set([...EINFACH, ...TEXTE]);

/** ↺ eines Textes (wie `textZurueck` im Verlauf des Orts): folgte er vorher dem Wiki, kommt er als Wiki-Wert zurück, sonst als eigener Wert. */
function textZurueck(feld: string, ziel: FeldZiel): EditorPlaceTextChange {
    if (feld !== "description" && ziel.herkunftVorher === "wiki") return { revert: "wiki" };
    return { value: typeof ziel.vorher === "string" && ziel.vorher.trim() !== "" ? ziel.vorher : null };
}

/** Die Änderung am Ort, die ihn auf die Werte VOR den Mitgliedern bringt (`PlaceUpdateBody["changes"]`); `aendereOrt` lässt aus, was heute schon so steht. */
function aenderungAus(plan: OrtPlan): PlaceUpdateBody["changes"] {
    const changes: Record<string, unknown> = {};
    for (const ziel of plan.felder.values()) {
        const { feld, vorher } = ziel;
        if (!BEKANNT.has(feld))
            throw new ApiError(400, "not_revertable", "Diese Änderung am Ort lässt sich nicht zurücknehmen.", {
                reason: "art",
                field: feld,
            });
        if (TEXTE.includes(feld)) changes[feld] = textZurueck(feld, ziel);
        else if (feld === "name" || feld === "subtype") {
            // War der Wert vorher der des Wiki (`nameOrigin`, `subtypeOrigin`), kommt er als solcher zurück.
            if (typeof vorher !== "string" || vorher === "")
                throw new ApiError(400, "not_revertable", "Diese Änderung am Ort lässt sich nicht zurücknehmen.", {
                    reason: "art",
                    field: feld,
                });
            changes[feld] = ziel.herkunftVorher === "wiki" ? { revert: "wiki" } : vorher;
        } else if (feld === "kind") changes[feld] = typeof vorher === "string" && vorher !== "" ? vorher : null;
        else changes[feld] = vorher === true;
    }
    return changes as PlaceUpdateBody["changes"];
}

interface Punkt {
    x: number;
    y: number;
}
const punkt = (wert: unknown): Punkt | undefined =>
    Array.isArray(wert) && typeof wert[0] === "number" && typeof wert[1] === "number"
        ? { x: wert[0], y: wert[1] }
        : undefined;

interface Ende {
    pathId: string;
    end: "start" | "end";
    vorher: Punkt;
    nachher: Punkt;
}
interface Verschiebung {
    ortId: string;
    ortName?: string;
    vorher: Punkt;
    nachher: Punkt;
    enden: Ende[];
}

/** Die Verschiebung aus dem Protokoll: der Ort vorher und nachher, jedes mitgezogene Wegende vorher und nachher. */
function verschiebungAus(eintrag: MapHistoryEntry): Verschiebung | undefined {
    const ort = eintrag.objects.find(
        (gegenstand) => gegenstand.kind === "place" && gegenstand.action === "place.moved",
    );
    const lage = ort?.changes["position"];
    const vorher = punkt(lage?.before);
    const nachher = punkt(lage?.after);
    if (ort === undefined || vorher === undefined || nachher === undefined) return undefined;
    const enden: Ende[] = [];
    for (const weg of eintrag.objects) {
        if (weg.kind !== "path" || weg.action !== "path.endpoint_moved") continue;
        const davor = listeDerEnden(weg.changes["geometry"]?.before);
        for (const danach of listeDerEnden(weg.changes["geometry"]?.after)) {
            const frueher = davor.find((ende) => ende.end === danach.end);
            if (frueher !== undefined)
                enden.push({
                    pathId: weg.id,
                    end: danach.end,
                    vorher: { x: frueher.x, y: frueher.y },
                    nachher: { x: danach.x, y: danach.y },
                });
        }
    }
    return {
        ortId: ort.id,
        ...(ort.name !== undefined ? { ortName: ort.name } : {}),
        vorher,
        nachher,
        enden,
    };
}
export function listeDerEnden(wert: unknown): { end: "start" | "end"; x: number; y: number }[] {
    if (!Array.isArray(wert)) return [];
    return wert.filter(
        (ende): ende is { end: "start" | "end"; x: number; y: number } =>
            (ende?.end === "start" || ende?.end === "end") && typeof ende.x === "number" && typeof ende.y === "number",
    );
}

/** Beide Enden der genannten Wege, wie sie HEUTE liegen (Revision, Lage, Nachbarpunkt): die Wegenden, die die Rücknahme verschiebt, brauchen sie. */
export async function wegenden(database: Queryable, wegIds: readonly string[]): Promise<EditorPathEnd[]> {
    if (wegIds.length === 0) return [];
    return database<EditorPathEnd[]>`
        SELECT w.public_id::text AS "pathId", w.name, e.end_name AS "end", w.revision::int AS revision,
               ST_X(e.pt) AS x, ST_Y(e.pt) AS y, json_build_object('x', ST_X(e.next), 'y', ST_Y(e.next)) AS neighbor
          FROM path w
         CROSS JOIN LATERAL (VALUES ('start', ST_StartPoint(w.geom), ST_PointN(w.geom, 2)),
                                    ('end', ST_EndPoint(w.geom), ST_PointN(w.geom, ST_NPoints(w.geom) - 1))) AS e(end_name, pt, next)
         WHERE w.public_id = ANY(${wegIds as string[]}::uuid[])
         ORDER BY w.public_id, e.end_name DESC
    `;
}

const nahe = (a: Punkt, b: Punkt): boolean => a.x === b.x && a.y === b.y;
const alsText = (p: Punkt): string => `(${String(p.x)} | ${String(p.y)})`;

/** Der Adapter des Ortes für `vorpruefen` (siehe Kopf der Datei). */
export const ORT_ADAPTER: RuecknahmeAdapter = {
    familie: "ort",
    // Das Recht der Vorwärtsoperation: Die Lage zu ändern verlangt `edit_map_geometry` (wie `POST …/move`), auch wenn die Verschiebung selbst eine Rücknahme war
    // (`place.restore_series`); Felder und Löschen verlangen `edit_map_objects`.
    // Die Quellen verlangen `manage_sources` (`POST …/inhalte/traeger/place/:id/quellen`); eine Rücknahme von Feldern und Quellen verlangt beide Rechte.
    // Anlegen: wie `POST /api/editor/places` (ein Ort mit Lage braucht beide Rechte); von der Karte nehmen und Setzen sind Eingriffe in die Lage wie das Verschieben.
    recht(operation, aktionen, felder) {
        const art = artVon(operation, aktionen);
        if (art === "verschieben" || art === "abnehmen" || art === "aufsetzen") return "edit_map_geometry";
        if (art === "quellen") return "manage_sources";
        const rechte: Capability[] = ["edit_map_objects"];
        if (art === "anlegen" && felder?.includes("position") === true) rechte.push("edit_map_geometry");
        if (traegtQuellen("place", aktionen)) rechte.push("manage_sources");
        return rechte.length === 1 ? rechte[0]! : rechte;
    },
    pruefeArt: (operation, aktionen) =>
        artVon(operation, aktionen) === undefined ? { ok: false, reason: "art" } : { ok: true },
    pruefeListe(offen) {
        // Mehrere Mitglieder sind eine Arbeitsserie: nur Felder und Quellen. Ein Verschieben oder Löschen geht allein. Beginnt die Serie mit einem Anlegen, geht sie als Ganzes zurück (stillgelegt),
        // und es dürfen auch Verschieben, Abnehmen und Setzen darin stehen (WI-0265 B8a); ein Löschen oder Wiederherstellen nicht (der Ort wäre schon stillgelegt).
        const verworfen = new Map<string, "art">();
        if (offen.length <= 1) return verworfen;
        const mitAnlegen = offen.some((mitglied) => artDes(mitglied) === "anlegen");
        for (const mitglied of offen) {
            const art = artDes(mitglied);
            const erlaubt = mitAnlegen ? IN_ANLEGEN_SERIE.has(art) : art === "felder" || art === "quellen";
            if (!erlaubt) verworfen.set(mitglied.operationId, "art");
        }
        return verworfen;
    },
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const eintraege = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((m) => m.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries;
        const konflikte: VorKonflikt[] = [];
        // Beginnt die Serie mit einem Anlegen, ist nur der Ort stillzulegen: Die Felder davor sind ohne Belang, es zählt, dass seither nichts an ihm hängt (WI-0265 B8a).
        const anlegen = eintraege.filter((eintrag) => artDesEintrags(eintrag) === "anlegen");
        if (anlegen.length > 0) return pruefeAnlegen(database, anlegen);
        const felder = eintraege.filter((eintrag) => artDesEintrags(eintrag) === "felder");
        for (const [id, ort] of planAusEintraegen(felder)) {
            const row = await readPlace(database, id, false);
            const name = ort.name === undefined ? {} : { name: ort.name };
            if (row === undefined || (!row.unplaced && !row.is_active)) {
                konflikte.push({
                    art: "wert",
                    kind: "place",
                    id,
                    ...name,
                    felder: ["active"],
                    abweichung: { was: "ort_geloescht" },
                    detail: "Der Ort ist gelöscht.",
                });
                continue;
            }
            const abweichend = [...ort.felder.values()]
                .filter((ziel) => BEKANNT.has(ziel.feld))
                .filter((ziel) => leer(istFeld(row, ziel.feld)) !== leer(ziel.nachher));
            if (abweichend.length > 0)
                konflikte.push({
                    art: "wert",
                    kind: "place",
                    id,
                    ...name,
                    currentRevision: row.revision,
                    felder: abweichend.map((ziel) => ziel.feld),
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.map((ziel) => ziel.feld).join(", ")}.`,
                });
        }
        for (const eintrag of eintraege.filter((e) => artDesEintrags(e) === "verschieben")) {
            const verschiebung = verschiebungAus(eintrag);
            if (verschiebung === undefined) continue;
            const name = verschiebung.ortName === undefined ? {} : { name: verschiebung.ortName };
            const row = await readPlace(database, verschiebung.ortId, false);
            const lage =
                row === undefined || row.unplaced || row.x === null || row.y === null
                    ? undefined
                    : { x: row.x, y: row.y };
            if (lage === undefined || !nahe(lage, verschiebung.nachher))
                konflikte.push({
                    art: "wert",
                    kind: "place",
                    id: verschiebung.ortId,
                    ...name,
                    felder: ["position"],
                    abweichung:
                        lage === undefined
                            ? { was: "ort_nicht_auf_karte" }
                            : { was: "ort_lage", heute: lage, erwartet: verschiebung.nachher },
                    detail:
                        lage === undefined
                            ? "Der Ort steht nicht mehr auf der Karte."
                            : `Der Ort liegt bei ${alsText(lage)} statt bei ${alsText(verschiebung.nachher)}.`,
                });
            // Jedes mitgezogene Wegende am Endstand; die abweichenden Enden stehen einzeln in der Liste (Gegenstand ist der Weg).
            const heute = await wegenden(database, [...new Set(verschiebung.enden.map((ende) => ende.pathId))]);
            for (const ende of verschiebung.enden) {
                const jetzt = heute.find((h) => h.pathId === ende.pathId && h.end === ende.end);
                if (jetzt !== undefined && nahe({ x: jetzt.x, y: jetzt.y }, ende.nachher)) continue;
                konflikte.push({
                    art: "wert",
                    kind: "path",
                    id: ende.pathId,
                    ...(jetzt === undefined ? {} : { name: jetzt.name }),
                    felder: [ende.end],
                    abweichung:
                        jetzt === undefined
                            ? { was: "weg_fehlt" }
                            : {
                                  was: ende.end === "start" ? "weg_anfang" : "weg_ende",
                                  heute: { x: jetzt.x, y: jetzt.y },
                                  erwartet: ende.nachher,
                              },
                    detail:
                        jetzt === undefined
                            ? "Der Weg gibt es nicht mehr."
                            : `Das ${ende.end === "start" ? "Anfangs" : "End"}punkt des Wegs liegt bei ${alsText({ x: jetzt.x, y: jetzt.y })} statt bei ${alsText(ende.nachher)}.`,
                });
            }
        }
        // Wiederherstellen, Abnehmen und Setzen: Der Ort steht noch so, wie die Operation ihn hinterließ (die Revision prüft der Kern), und das Gegenstück ist erlaubt (WI-0265 B8a).
        for (const eintrag of eintraege) {
            const art = artDesEintrags(eintrag);
            if (art === "wiederherstellen" || art === "abnehmen" || art === "aufsetzen")
                konflikte.push(...(await pruefeStand(database, eintrag, art)));
        }
        // Die Quellen des Orts: Jede Verknüpfung steht heute so, wie die Serie sie hinterließ (auch eine, die jemand von der Quelle her änderte), und ihr Ziel gibt es noch.
        konflikte.push(...konflikteAmTraeger(await pruefeQuellen(database, planAusTraeger(eintraege, "place"))));
        return konflikte;
    },
};

const ortGeloescht = (gegenstand: Pick<MapHistoryObject, "id" | "name">): VorKonflikt => ({
    art: "wert",
    kind: "place",
    id: gegenstand.id,
    ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}),
    felder: ["active"],
    abweichung: { was: "ort_geloescht" },
    detail: "Der Ort ist gelöscht.",
});

/** Eine Kraftlinie, die seither am Ort endet, hält das Stilllegen und das Abnehmen an (`pruefeEntfernen`): als Konflikt vor dem Schreiben, nicht als Fehler danach. */
async function kraftlinienKonflikte(database: Queryable, row: PlaceRow): Promise<VorKonflikt[]> {
    if ((await kraftlinienAm(database, row.public_id)).length === 0) return [];
    return [
        {
            art: "wert",
            kind: "place",
            id: row.public_id,
            name: row.name,
            abweichung: { was: "ort_kraftlinie" },
            detail: "Am Ort endet eine Kraftlinie.",
        },
    ];
}

/**
 * Das Anlegen zurücknehmen heißt den Ort stilllegen: Das geht nur, wenn seither nichts an ihm hängt (WI-0265 B8a, streng, Fachvertrag C.3). Die Revision und jede spätere Operation am Ort prüft der
 * Kern; hier steht, was keine Operation am Ort ist:
 *
 * - ein **Weg**, dessen Ende am Ort liegt und der seit dem Anlegen gezeichnet, geändert oder zurückgeholt wurde (ein Weg, den es vorher schon gab und der unberührt blieb, stört nicht: das Anlegen
 *   auf einem Wegende ist üblich);
 * - eine **Kraftlinie** am Ort;
 * - eine **Wiki-Zuordnung**, die der Ort beim Anlegen nicht hatte (oder eine andere).
 */
async function pruefeAnlegen(database: Queryable, eintraege: readonly MapHistoryEntry[]): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    for (const eintrag of eintraege) {
        const angelegt = eintrag.objects.find((o) => o.kind === "place" && o.action === "place.created");
        if (angelegt === undefined) continue;
        const row = await readPlace(database, angelegt.id, false);
        if (row === undefined || (!row.unplaced && !row.is_active)) {
            konflikte.push(ortGeloescht(angelegt));
            continue;
        }
        konflikte.push(...(await kraftlinienKonflikte(database, row)));
        if (row.unplaced) continue;
        const enden = await pathEndsAt(database, row);
        for (const wegId of [...new Set(enden.map((ende) => ende.pathId))]) {
            const [spaeter] = await database<{ da: boolean }[]>`
                SELECT TRUE AS da
                  FROM map_audit_event e JOIN map_operation o ON o.operation_id = e.operation_id
                 WHERE e.path_public_id = ${wegId}::uuid AND o.seq > ${eintrag.seq}
                   AND (e.changes ? 'geometry' OR e.changes ? 'active')
                 LIMIT 1
            `;
            if (spaeter === undefined) continue;
            const name = enden.find((ende) => ende.pathId === wegId)?.name;
            konflikte.push({
                art: "wert",
                kind: "path",
                id: wegId,
                ...(name !== undefined ? { name } : {}),
                abweichung: { was: "weg_am_ort" },
                detail: "Seit dem Anlegen endet ein Weg an diesem Ort.",
            });
        }
        // Die Wiki-Zuordnung beim Anlegen (`wiki` im Protokoll, aus „Nicht auf der Karte“) ist die einzige, die der Ort tragen darf.
        const wiki = angelegt.changes["wiki"]?.after;
        const erwartet = typeof wiki === "string" ? wiki : undefined;
        const schluessel = await database<{ wiki_key: string }[]>`
            SELECT wiki_key FROM wiki_key_assignment
             WHERE object_public_id = ${row.public_id}::uuid AND legacy_art = 'siedlung' AND is_active
        `;
        const adressen = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM place_wiki_assignment WHERE place_id = ${row.id}::bigint AND is_active
        `;
        const abweichend =
            erwartet === undefined
                ? schluessel.length > 0 || (adressen[0]?.n ?? 0) > 0
                : schluessel.length !== 1 || schluessel[0]!.wiki_key !== erwartet || (adressen[0]?.n ?? 0) > 1;
        if (abweichend)
            konflikte.push({
                art: "wert",
                kind: "place",
                id: row.public_id,
                name: row.name,
                felder: ["wiki"],
                abweichung: { was: "zuordnung" },
                detail: "Der Ort hat seit dem Anlegen eine andere Wiki-Zuordnung.",
            });
    }
    return konflikte;
}

/** Wiederherstellen (zurück: stilllegen), Abnehmen (zurück: auf die Karte) und Setzen (zurück: abnehmen): Der Ort muss dafür in dem Stand sein, den die Operation hinterließ. */
async function pruefeStand(
    database: Queryable,
    eintrag: MapHistoryEntry,
    art: "wiederherstellen" | "abnehmen" | "aufsetzen",
): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    for (const gegenstand of eintrag.objects.filter((o) => o.kind === "place")) {
        const row = await readPlace(database, gegenstand.id, false);
        if (row === undefined || (!row.unplaced && !row.is_active)) {
            konflikte.push(ortGeloescht(gegenstand));
            continue;
        }
        if (art === "abnehmen" && !row.unplaced)
            konflikte.push({
                art: "wert",
                kind: "place",
                id: row.public_id,
                name: row.name,
                felder: ["position"],
                abweichung: { was: "ort_auf_karte" },
                detail: "Der Ort steht inzwischen wieder auf der Karte.",
            });
        else if (art === "aufsetzen" && row.unplaced)
            konflikte.push({
                art: "wert",
                kind: "place",
                id: row.public_id,
                name: row.name,
                felder: ["position"],
                abweichung: { was: "ort_nicht_auf_karte" },
                detail: "Der Ort steht nicht mehr auf der Karte.",
            });
        else if (art !== "abnehmen") konflikte.push(...(await kraftlinienKonflikte(database, row)));
    }
    return konflikte;
}

/**
 * Die Karte des Orts, auch eines stillgelegten (gelöschten oder abgenommenen, auch ohne Lage): Die Rücknahme eines Anlegens oder Löschens hängt an einem Ort, den es danach nicht mehr
 * aktiv gibt (WI-0265 B8a). `domainOf` kennt nur aktive Orte ohne Lage.
 */
async function karteDesOrts(database: Database, ortId: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM place WHERE public_id = ${ortId}::uuid
        UNION ALL
        SELECT map_domain_id FROM place_unplaced WHERE public_id = ${ortId}::uuid
        LIMIT 1
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
    return zeile.map_domain_id;
}

const familieVon = (ortId: string, mapDomainId: string): RuecknahmeFamilie => ({
    operation: RUECKNAHME_ORT_OPERATION,
    scope: `place:${ortId}`,
    adapter: ORT_ADAPTER,
    mapDomainId,
    // Nur Quellen gehen über die Naht der Inhalte wie das Original; mit Feldern über die der Karte.
    naht: nahtDerQuellen,
});

/** `POST …/restore-series/preview` am Ort: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauOrt(
    database: Database,
    ortId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const domain = await karteDesOrts(database, ortId);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: domain, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(ortId, domain),
    );
    // Ein Ort wirkt nicht aufs Gelände; was die Rücknahme berührt, sind Orte (und die Wege ihrer Enden), die Wegeprofile und das Routing folgen über die Schreibnaht.
    return {
        ...vor,
        folgen: { gegenstaende: vor.gegenstaende.filter((g) => g.kind === "place").length, gelaende: "keines" },
    } as RuecknahmePruefung;
}

const reihenfolgeNachId = (ids: readonly string[]): string[] => [...ids].sort();

/** Die Zeilen der Orte (beide Tafeln) und der Wege der Mitglieder in fester Reihenfolge sperren: erst die Orte, dann die Wege, je nach Kennung. */
async function sperreOrteUndWege(tx: Queryable, vorab: Vorpruefung): Promise<void> {
    const orte = reihenfolgeNachId(vorab.gegenstaende.filter((g) => g.kind === "place").map((g) => g.id));
    const wege = reihenfolgeNachId(vorab.gegenstaende.filter((g) => g.kind === "path").map((g) => g.id));
    if (orte.length > 0) {
        await tx`SELECT id FROM place WHERE public_id = ANY(${orte}::uuid[]) ORDER BY public_id FOR UPDATE`;
        await tx`SELECT id FROM place_unplaced WHERE public_id = ANY(${orte}::uuid[]) ORDER BY public_id FOR UPDATE`;
    }
    if (wege.length > 0)
        await tx`SELECT id FROM path WHERE public_id = ANY(${wege}::uuid[]) ORDER BY public_id FOR UPDATE`;
}

/** Der Grund steht an jedem Eintrag der Rücknahme, der einen Ort nennt (Positivliste `place`). */
const mitGrund = (entry: MapAuditEntry, grund: string | undefined): MapAuditEntry =>
    grund === undefined ? entry : { ...entry, changes: { ...entry.changes, restoreReason: { after: grund } } };

/** Felder: die Werte vor dem ersten Mitglied in EINEM `place.updated`. */
async function schreibeFelder(
    tx: RuecknahmeSchreiben["tx"],
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const plan = planAusEintraegen(eintraege);
    const affected: OperationReceipt["affected"] = [];
    const warnings: OperationReceipt["warnings"] = [];
    const entries: MapAuditEntry[] = [];
    let name = "";
    for (const id of reihenfolgeNachId([...plan.keys()])) {
        const row = await readPlace(tx, id, true);
        if (row === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
        name = row.name;
        const geaendert = await aendereOrt(tx, row, aenderungAus(plan.get(id)!));
        if (geaendert === undefined) continue;
        affected.push({ kind: "place", id, revision: geaendert.revision });
        warnings.push(...geaendert.warnings.filter((w) => !warnings.some((x) => x.code === w.code)));
        entries.push(
            mitGrund(
                {
                    action: "place.updated",
                    placeId: id,
                    revisionBefore: row.revision,
                    revisionAfter: geaendert.revision,
                    changes: geaendert.changes,
                },
                grund,
            ),
        );
    }
    return {
        receipt: { affected, derivedWork: [], warnings },
        summary: `${name}: ${eintraege.length === 1 ? "1 Änderung" : `${String(eintraege.length)} Änderungen`} zurückgenommen`,
        entries,
    };
}

/** Verschieben: der Ort und jedes mitgezogene Wegende zurück an die Lage davor, über den Schreibweg des Verschiebens. */
async function schreibeVerschiebung(
    tx: RuecknahmeSchreiben["tx"],
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const verschiebung = verschiebungAus(eintrag);
    if (verschiebung === undefined)
        throw new ApiError(400, "not_revertable", "Diese Verschiebung lässt sich nicht zurücknehmen.", {
            reason: "art",
        });
    const row = await readPlace(tx, verschiebung.ortId, true);
    if (row === undefined || row.unplaced)
        throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht auf der Karte.");
    const heute = await wegenden(tx, [...new Set(verschiebung.enden.map((ende) => ende.pathId))]);
    // Genau die Enden, die damals mitgingen, gelten als „am Ort hängend“: Ein Ende an einem Einrastpunkt liegt nicht am Ort und geht trotzdem zurück.
    const enden = verschiebung.enden.map((ende) => {
        const jetzt = heute.find((h) => h.pathId === ende.pathId && h.end === ende.end);
        if (jetzt === undefined) throw new ApiError(404, "not_found", "Ein Weg der Verschiebung gibt es nicht mehr.");
        return jetzt;
    });
    const ergebnis = await verschiebeOrtIn(
        tx,
        row,
        {
            baseRevision: row.revision,
            reverts: eintrag.operationId,
            to: verschiebung.vorher,
            pathEnds: verschiebung.enden.map((ende, i) => ({
                pathId: ende.pathId,
                end: ende.end,
                baseRevision: enden[i]!.revision,
                to: ende.vorher,
            })),
        },
        enden,
    );
    return {
        ...ergebnis,
        entries: ergebnis.entries.map((entry) => (entry.placeId === undefined ? entry : mitGrund(entry, grund))),
    };
}

/** Löschen: ALLE Orte der Operation kommen zurück oder keiner; die Stätten, die mit diesem Löschen stillgelegt wurden, kommen mit. */
async function schreibeLoeschen(
    tx: RuecknahmeSchreiben["tx"],
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const geloescht = eintrag.objects
        .filter((gegenstand): gegenstand is MapHistoryObject => gegenstand.kind === "place")
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const affected: OperationReceipt["affected"] = [];
    const warnings: OperationReceipt["warnings"] = [];
    const derivedWork: OperationReceipt["derivedWork"] = [];
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    let staetten = 0;
    for (const gegenstand of geloescht) {
        const vorher = (gegenstand.changes["staetten"]?.before ?? []) as unknown;
        const staettenZurueck = Array.isArray(vorher) ? vorher.filter((x): x is string => typeof x === "string") : [];
        const zurueck = await holeOrtZurueck(tx, gegenstand.id, {
            ohneLage: gegenstand.action === "place.deleted_unplaced",
            staettenZurueck,
            revisionAfter: gegenstand.revisionAfter,
        });
        affected.push(...zurueck.receipt.affected);
        for (const arbeit of zurueck.receipt.derivedWork)
            if (!derivedWork.some((x) => x.kind === arbeit.kind)) derivedWork.push(arbeit);
        for (const befund of zurueck.receipt.warnings)
            if (!warnings.some((x) => x.code === befund.code)) warnings.push(befund);
        entries.push(...zurueck.entries.map((entry) => mitGrund(entry, grund)));
        namen.push(gegenstand.name ?? gegenstand.id);
        staetten += staettenZurueck.length;
    }
    return {
        receipt: { affected, derivedWork, warnings },
        summary:
            geloescht.length === 1
                ? `${namen[0]!} wiederhergestellt`
                : `${String(geloescht.length)} Orte wiederhergestellt${staetten > 0 ? `, ${String(staetten)} Stätten zurück` : ""}`,
        entries,
    };
}

/**
 * Anlegen und Wiederherstellen zurück: ALLE Orte der Operation werden stillgelegt wie bei „Ganz löschen“ (`loescheOrt` samt `pruefeEntfernen`), alle oder keiner. Der Eintrag heißt `place.deleted`
 * (`…_unplaced` für einen Ort ohne Lage): So ist die Rücknahme dieser Rücknahme das Zurückholen des Löschens (`schreibeLoeschen`), mit denselben Stätten.
 */
async function schreibeStilllegen(
    tx: RuecknahmeSchreiben["tx"],
    ids: readonly string[],
    grund: string | undefined,
    satz: "anlegen" | "wiederherstellen",
): Promise<SchreibErgebnis> {
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    let staetten = 0;
    let aufDerKarte = false;
    for (const id of reihenfolgeNachId([...new Set(ids)])) {
        const row = await readPlace(tx, id, true);
        if (row === undefined || (!row.unplaced && !row.is_active))
            throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht (mehr).");
        await pruefeEntfernen(tx, row, "loeschen", undefined);
        const { revision, stillgelegt, entry } = await loescheOrt(tx, row);
        affected.push({ kind: "place", id, revision });
        entries.push(mitGrund(entry, grund));
        namen.push(row.name);
        staetten += stillgelegt;
        aufDerKarte ||= !row.unplaced;
    }
    const ende = satz === "anlegen" ? "Anlegen zurückgenommen" : "wieder gelöscht";
    return {
        receipt: {
            affected,
            derivedWork: aufDerKarte ? [{ kind: "routing", state: "pending" }] : [],
            warnings: [],
        },
        summary:
            namen.length === 1
                ? `${namen[0]!}: ${ende}${staetten > 0 ? `, ${String(staetten)} Stätten mit stillgelegt` : ""}`
                : `${String(namen.length)} Orte: ${ende}`,
        entries,
    };
}

/** Von der Karte nehmen zurück: der Ort wieder auf die Karte, an die Lage davor (derselbe Schreibweg wie „Auf die Karte setzen“). */
async function schreibeAbnehmenZurueck(
    tx: RuecknahmeSchreiben["tx"],
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const gegenstand = eintrag.objects.find((o) => o.kind === "place" && o.action === "place.taken_off_map");
    const lage = punkt(gegenstand?.changes["position"]?.before);
    if (gegenstand === undefined || lage === undefined)
        throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", { reason: "art" });
    const row = await readPlace(tx, gegenstand.id, true);
    if (row === undefined || !row.unplaced) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht ohne Lage.");
    const ergebnis = await placeUnplaced(tx, row, { to: lage, pathEnds: [] });
    return {
        ...ergebnis,
        summary: `${row.name}: Abnehmen zurückgenommen`,
        entries: ergebnis.entries.map((entry) => mitGrund(entry, grund)),
    };
}

/** Auf die Karte setzen zurück: der Ort wieder von der Karte (derselbe Schreibweg und dieselben Prüfungen wie „Von der Karte nehmen“, die Stätten bleiben am Namen). */
async function schreibeAufsetzenZurueck(
    tx: RuecknahmeSchreiben["tx"],
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const gegenstand = eintrag.objects.find((o) => o.kind === "place" && o.action === "place.placed");
    if (gegenstand === undefined)
        throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", { reason: "art" });
    const row = await readPlace(tx, gegenstand.id, true);
    if (row === undefined || row.unplaced)
        throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht auf der Karte.");
    const ergebnis = await nimmOrtVonDerKarteIn(tx, row, "bleiben");
    return {
        ...ergebnis,
        summary: `${row.name}: Setzen zurückgenommen`,
        entries: ergebnis.entries.map((entry) => mitGrund(entry, grund)),
    };
}

/**
 * `POST …/restore-series` am Ort: nimmt die Mitglieder (Felder einer Serie, auch die Mehrfachbearbeitung mehrerer Orte, EINE Verschiebung, EIN Löschen oder Anlegen oder Wiederherstellen, auch für
 * mehrere Orte, EIN Abnehmen oder Setzen) in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was den Ort ausmacht: die Fremdsperre der Orte, die Sperre der Zeilen und die Inverse je Art.
 */
export async function ruecknehmenOrt(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    ortId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const domain = await karteDesOrts(database, ortId);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieVon(ortId, domain),
        body,
        haken: {
            pruefeFremdeSperre: (db, akteur, scopes) =>
                pruefeFremdeOrtssperre(
                    db,
                    akteur,
                    [...scopes]
                        .filter((scope) => scope.startsWith("place:"))
                        .map((scope) => scope.slice("place:".length)),
                ),
            async sperreZeilen(tx, vorab) {
                await sperreOrteUndWege(tx, vorab);
                if (hatQuellen(vorab, "place"))
                    await sperreQuellen(
                        tx,
                        planAusTraeger(
                            (
                                await eintraegeNachKennung(tx, vorab.offen, {
                                    personId: leser.personId,
                                    nutzlast: "voll",
                                })
                            ).entries,
                            "place",
                        ),
                    );
            },
            async schreibe({ tx, offen, grund }) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                // Beginnt die Serie mit einem Anlegen, wird der Ort stillgelegt; was danach in der Serie stand (Felder, Quellen, Lage), bleibt, wie es ist (ohne Belang für einen stillgelegten Ort).
                if (eintraege.some((eintrag) => artDesEintrags(eintrag) === "anlegen"))
                    return schreibeStilllegen(
                        tx,
                        eintraege.flatMap((eintrag) =>
                            eintrag.objects
                                .filter((o) => o.kind === "place" && o.action === "place.created")
                                .map((o) => o.id),
                        ),
                        grund,
                        "anlegen",
                    );
                const art = artDesEintrags(eintraege[0]!);
                if (art === "wiederherstellen")
                    return schreibeStilllegen(
                        tx,
                        eintraege.flatMap((eintrag) =>
                            eintrag.objects.filter((o) => o.kind === "place").map((o) => o.id),
                        ),
                        grund,
                        "wiederherstellen",
                    );
                if (art === "abnehmen") return schreibeAbnehmenZurueck(tx, eintraege[0]!, grund);
                if (art === "aufsetzen") return schreibeAufsetzenZurueck(tx, eintraege[0]!, grund);
                if (art === "felder" || art === "quellen") {
                    // Felder und Quellen des Orts in EINER Operation; eine Rücknahme nur der Quellen schreibt keine Felder.
                    const felder =
                        planAusEintraegen(eintraege).size > 0 ? await schreibeFelder(tx, eintraege, grund) : undefined;
                    const quellen = await schreibeTraegerQuellenZurueck(tx, eintraege, "place", grund);
                    return mischeErgebnis(felder, quellen, eintraege.length);
                }
                if (art === "verschieben") return schreibeVerschiebung(tx, eintraege[0]!, grund);
                if (art === "loeschen") return schreibeLoeschen(tx, eintraege[0]!, grund);
                throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", {
                    reason: "art",
                });
            },
        },
    });
}
