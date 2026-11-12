import {
    formtGelaende,
    ordneGefahren,
    type Capability,
    type EditorLandscapeLayer,
    type FeldHerkunft,
    type MapHistoryEntry,
    type MapHistoryObjectKind,
    type OperationReceipt,
    type PeakChanges,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { resolveTerrainRecipe } from "../terrain/auswahl.ts";
import { istRegional } from "../terrain/hoehenmodell.ts";
import { leseHerkunft } from "./feld-herkunft.ts";
import { GIPFEL_ART } from "./gelaende-folgen.ts";
import { eintraegeNachKennung } from "./history.ts";
import { pruefeFremdeSperre } from "./landscape-reshape.ts";
import { GELAENDE_VERALTET, speistGelaende } from "./landscape-update.ts";
import { LANDSCHAFT_ART, TEILFLAECHE_ART, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { gipfelSchreiben, merkmaleGeordnet, pruefeFremdeGipfelSperre } from "./peak-update.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeHaken,
} from "./ruecknahme-ablauf.ts";
import {
    FLAECHE_OPERATIONEN,
    RUECKNAHME_FLAECHE_OPERATION,
    RUECKNAHME_GIPFEL_OPERATION,
    TRAEGER_QUELLEN_OPERATION,
} from "./ruecknahme-arten.ts";
import {
    GEBIRGE_PROTOKOLL,
    feinFelderGebirge,
    konflikteGebirge,
    planAusEintraegen,
    schreibeGebirge,
    sperreGebirgswerte,
} from "./ruecknahme-gebirge.ts";
import {
    hatQuellen,
    istQuellenAktion,
    konflikteAmTraeger,
    mischeErgebnis,
    nahtDerQuellen,
    planAusTraeger,
    pruefeQuellen,
    quellenAktion,
    schreibeTraegerQuellenZurueck,
    sperreQuellen,
    traegerSchluessel,
    type TraegerQuellenErgebnis,
} from "./ruecknahme-traeger-quellen.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, Vorpruefung, VorKonflikt } from "./ruecknahme.ts";
import { geojsonAus, polygoneVon, ringe, schluessel as eckenSchluessel, type Punkt } from "./ring-form.ts";

/**
 * Die Derographie zurücknehmen (WI-0265 B6c; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, F.1; Testvertrag U2 bis U9, U13; Gate 2 und 3
 * abgenommen 2026-10-31): der Adapter für alle Arten der Landschaft, die Vorschau und die Rücknahme in EINER Operation. Das Gebirge (B3, `ruecknahme-gebirge.ts`) ist ein Teil davon.
 *
 * - **Was zurückgeht** (Parität mit dem Client-↺ des Landschaftsverlaufs, das hiermit entfällt, und mehr): die Felder der Landschaft (Name, Ebene, Art, Platz in der Ebene, Klicksperre,
 *   „für Besucher verborgen“, Kurve), die Felder der Beschriftungen (Text, Namensart, Größe, Priorität, Zoomspanne, „Auf der Karte anzeigen“, Lage), die Form der Teilflächen samt den
 *   mitgezogenen Ecken der Nachbarflächen, Stilllegen und Zurückholen (Fläche, Teilfläche, Beschriftung, Gipfel), die Werkzeuge an Flächen, die in EINER Operation schreiben („Mit anderer
 *   Fläche“, „Unterflächen“, „Zerschneiden“, „Kopieren“, „Flächen vereinigen“, die Mehrfachauswahl), das Gebirge und die Höhen der Gipfel. Seit B8c auch Anlegen (Fläche samt erster Teilfläche,
 *   Beschriftung, Gipfel oder Landmarke) und das Löschen einer Beschriftung; alles, was das Protokoll nicht trägt, bleibt `not_revertable` (Grund `art`).
 * - **Anlegen geht zurück als Stilllegen** (WI-0265 B8c, derselbe Weg wie Entfernen; nie Löschen): Ein Gegenstand, den ein Mitglied anlegte (`ANLEGEN`), kommt auf `active = false`; seine Felder
 *   danach (Name, Höhe, Lage …) bleiben, wie sie sind: Zurück heißt „nicht mehr auf der Karte“, nicht „mit dem Namen von damals“. Die Rücknahme dieser Rücknahme belebt ihn wieder. Eine Serie aus Anlegen und
 *   Folgeänderungen derselben Person geht als Ganzes zurück (`arbeitsserie.ts` fragt den Katalog). Was seither an einer angelegten Fläche hängt, meldet der Kern als spätere Operation (Teilflächen,
 *   Beschriftungen, Quellen, Wiki-Zuordnung berühren die Landschaft); eine Teilfläche, die seither in eine Sprache kopiert wurde, steht nicht in ihrem Protokoll und meldet `pruefeWerte` selbst
 *   (`konflikteSprachkopien`). Ein Gipfel mit Geländewirkung löst beim Stilllegen und Beleben genau EINE Geländekette aus, eine Landmarke ohne Gelände keine (Eingabeindex, `gelaende-folgen.ts`).
 *   Hängt das Gebirge an einer angelegten Fläche, kommen seine Werte VOR dem Stilllegen zurück und bei der Rücknahme der Rücknahme NACH dem Beleben (`gehendeGebirge`; `gebirgSchreiben` schreibt nur an einer Fläche
 *   auf der Karte). Die Quellen eines Gipfels oder einer Landmarke (`peak.sources_changed`, WI-0271 L4) gehen wie die der Landschaft in derselben Rücknahme mit; ein Träger, den die Rücknahme selbst belebt, darf beim
 *   Prüfen noch still sein (`pruefeQuellen` mit `belebt`). Die Revision einer Landschaft, die eine Beschriftung zählte (`label.create`, `label.retire`), liest der Kern aus der Quittung (`ruecknahme.ts`).
 * - **Die Inverse folgt dem Protokoll, nicht dem Vorwärtsweg:** Jede Folge einer Änderung steht als eigener Eintrag im Fachprotokoll (die Beschriftungen, deren Text dem Namen folgte; der Platz
 *   in der Ebene; die Teilflächen und Beschriftungen, die mit der Landschaft gingen). Die Vorwärtswege leiten diese Folgen aus dem Stand beim Schreiben NEU ab und kämen darum nicht auf denselben
 *   Zustand zurück (eine neue Ebene stellt die Landschaft vorn hin, nicht auf ihren alten Platz); die Rücknahme setzt darum jeden Gegenstand und jedes Feld genau auf den Wert VOR dem ersten
 *   Mitglied, das es berührt (C.3). Wo es einen Vorwärts-Schreibweg mit eigener Regel gibt, den nur dieser kennt, geht die Rücknahme durch ihn: das Gebirge (`gebirgSchreiben`) und die Höhe
 *   eines Gipfels (`gipfelSchreiben`, mit der Herkunft, die sie vorher hatte: folgte sie dem Wiki, kommt sie als Wiki-Höhe zurück).
 * - **Die Quellen der Landschaft** (`traeger.sources`, Aktion `region.sources_changed`; WI-0265 B6g3): die Klappbox des Landschaftsfensters. Sie teilen die Serie der Landschaft und gehen mit den Feldern in EINER
 *   Rücknahme ganz oder gar nicht zurück (`ruecknahme-traeger-quellen.ts`); das Recht dazu ist `manage_sources`, eine gemischte Serie verlangt beide Rechte. Nur Quellen gehen über die Naht der Inhalte (kein
 *   Ereignis `map.changed`, keine Ableitung, kein Befund zum Gelände: Eine Quelle ändert weder Form noch Art noch Ebene).
 * - **Bedingung** (`pruefeWerte`, streng und alles oder nichts): Jedes Feld, das die Mitglieder berührten, steht heute so, wie das LETZTE Mitglied es hinterließ. Dazu kommt die Vorprüfung des Kerns
 *   (Revision je Gegenstand, spätere Operationen). Eine Nachbarfläche, deren Ecken nur als Liste von Punkten ohne Ring- und Eckenindex im Protokoll stehen (`area.carried`), geht nur zurück,
 *   wenn jede mitgezogene Ecke genau einmal an ihrer Stelle liegt und kein Punkt zweifach belegt ist (`flaeche_nachbar`); sonst bleibt die ganze Rücknahme aus.
 * - **Eine Operation:** `landscape.restore_series` (an einem Gipfel `peak.restore_series`), Quelle `restore`, `reverts` = die offenen Mitglieder in der Reihenfolge der Serie; alle Zeilen in
 *   EINER Transaktion in fester Reihenfolge gesperrt (`FOR NO KEY UPDATE`, wie die Vorwärtswege), die Vorprüfung wird in ihr wiederholt; ein Ableitungslauf für alles (`deriveAfter`).
 *   Die Einträge tragen dieselben Aktionen wie die Vorwärtswege (`region.updated`, `area.reshaped`, `label.updated`, `area.retired` …) und sind darum selbst wieder zurücknehmbar.
 * - **Gelände:** Wie bei der Vorwärtsoperation bekommt das Gelände für Flächen keinen Auftrag, sondern den Befund `terrain_stale`, wenn die Fläche es speist (`speistGelaende`); ein Gebirge und
 *   ein Gipfel rechnen im Umkreis neu (die Schreibnaht reiht den Lauf ein).
 * - **Grund** (Gate 2): Betrifft die Rücknahme eine andere Person, ist `reason` Pflicht (400 `reason_required`) und steht als `restoreReason` an jedem Eintrag.
 * - **Kraftlinien:** Eine Fläche oder Beschriftung, an der seither eine Kraftlinie endet, geht nicht wieder von der Karte (409 `powerline_endpoint`, wie beim Entfernen).
 * - **Landmarken** (WI-0271 L3, Editor-Orchestrierung 2026-10-31): Art und Merkmale eines Gipfels gehen über `gipfelSchreiben` mit zurück; geht er zu einer Art ohne Gelände zurück, leert
 *   der Schreibweg die Höhe (kein Konflikt `gipfel_wert`). Das Gelände rechnet nur, wo sich die Geländewirkung ändert oder bei einer Geländeart Höhe, Lage oder Stand (Eingabeindex über die
 *   Sicht `terrain_peak_gelaende`; die Vorschau sagt dasselbe). 🔴 Ein Gipfelfeld, das diese Datei nicht kennt, macht das Mitglied `not_revertable` (Grund `art`, `pruefeListe`): Es wird
 *   nie still übergangen und als „zurückgenommen“ quittiert.
 */

type Art = "landscape" | "area" | "label" | "peak";
const ARTEN: readonly Art[] = ["landscape", "area", "label", "peak"];
const istArt = (kind: MapHistoryObjectKind): kind is Art => (ARTEN as readonly string[]).includes(kind);

/** Die Felder je Art, die das Protokoll führt und die Rücknahme setzt (Positivliste `MAP_AUDIT_FIELDS`, ohne `restoreReason`, `wiki`, `quellen`). */
const FELDER: Readonly<Record<Art, ReadonlySet<string>>> = {
    landscape: new Set(["name", "layer", "type", "order", "locked", "hidden", "hazards", "curve", "active", "offMap"]),
    area: new Set(["geometry", "active"]),
    label: new Set(["text", "textFollowsName", "type", "size", "priority", "zoom", "showName", "position", "active"]),
    peak: new Set(["name", "subtype", "merkmale", "height", "showName", "position", "active", "heightOrigin"]),
};

/** Was an einem Gipfeleintrag stehen darf, ohne ein Feld zu sein: der Grund einer Rücknahme. Jedes andere unbekannte Feld schließt das Mitglied aus (Grund `art`). */
const GIPFEL_OHNE_FELD: ReadonlySet<string> = new Set(["restoreReason"]);
const unbekannteGipfelfelder = (felder: readonly string[]): string[] =>
    felder.filter((feld) => !FELDER.peak.has(feld) && !GIPFEL_OHNE_FELD.has(feld));

/** Ändert ein Gipfel mit diesen Feldern (von Art `vorher` zu `nachher`) das Gelände? Bei Wechsel der Geländewirkung oder bei einer Geländeart an Höhe, Lage oder Stand. */
const gipfelRechnet = (felder: Iterable<string>, vorher: string, nachher: string): boolean => {
    if (formtGelaende(vorher) !== formtGelaende(nachher)) return true;
    if (!formtGelaende(vorher)) return false;
    return [...felder].some((feld) => feld === "height" || feld === "position" || feld === "active");
};

// Die Namen der Operationen dieser Familie (seit B8c auch das Anlegen einer Fläche, einer Beschriftung und eines Gipfels und das Löschen einer Beschriftung) stehen im Katalog (`ruecknahme-arten.ts`, WI-0265 B6f): Liste, Zustandsfilter und dieser Adapter sagen so dasselbe.

/** Die Aktionen der Protokolleinträge, die die Inverse kennt. */
const AKTIONEN: ReadonlySet<string> = new Set([
    "region.updated",
    "region.retired",
    "region.taken_off_map",
    "region.restored",
    "region.created",
    "area.reshaped",
    "area.carried",
    "area.boolean",
    "area.parts",
    "area.split",
    "area.merged",
    "area.copied",
    "area.created",
    "area.retired",
    "area.restored",
    GEBIRGE_PROTOKOLL,
    "label.created",
    "label.updated",
    "label.renamed",
    "label.retired",
    "label.restored",
    "peak.created",
    "peak.updated",
    "peak.retired",
    "peak.restored",
    // Flussenden, die dem Gipfel folgten (OPS-000088): Sie sind kein eigener Gegenstand der Rücknahme, sie gehen über `gipfelSchreiben` mit der Lage zurück.
    "path.endpoint_moved",
    // Die Quellen der Landschaft (`traeger.sources`, WI-0265 B6g3) und des Gipfels (WI-0271 L4; B8c: eine Serie aus Setzen und Quellen geht ganz zurück).
    quellenAktion("area"),
    quellenAktion("peak"),
]);

/** Die Träger dieser Familie, deren Quellen die Klappbox schreibt: die Landschaft (`area`) und der Gipfel oder die Landmarke (`peak`). */
const QUELLEN_ARTEN = ["area", "peak"] as const;
const istQuellenAktionHier = (aktion: string): boolean => QUELLEN_ARTEN.some((kind) => aktion === quellenAktion(kind));

/** Eine Aktion, die einen Gegenstand anlegt: Zurück geht sie als Stilllegen (`active` wird `false`). */
const ANLEGEN: ReadonlySet<string> = new Set([
    "region.created",
    "area.created",
    "area.copied",
    "label.created",
    "peak.created",
]);

/**
 * Die Operationen, die eine Fläche oder einen Gipfel anlegen und dafür Sache UND Lage verlangen (`POST /api/editor/landscapes` und `POST /api/editor/peaks`: `edit_map_objects` und `edit_map_geometry`).
 * Eine Beschriftung legt nur `edit_landscapes` an.
 */
const ANLEGEN_MIT_LAGE: ReadonlySet<string> = new Set(["landscape.create", "peak.create"]);

/**
 * Die Aktionen, deren Vorwärtsweg das Recht an der Geometrie verlangt (`routes/editor-landscapes.ts`: Fläche entfernen und zurückholen, die Werkzeuge an Flächen, die Form im „Fertig“,
 * Gipfel setzen, entfernen und verschieben). Felder der Landschaft und Beschriftungen verlangen `edit_landscapes`, das Gebirge dazu `edit_mountains`.
 */
const GEOMETRIE_AKTIONEN: ReadonlySet<string> = new Set([
    "region.retired",
    "region.taken_off_map",
    "region.restored",
    "region.created",
    "area.reshaped",
    "area.carried",
    "area.boolean",
    "area.parts",
    "area.split",
    "area.merged",
    "area.copied",
    "area.created",
    "area.retired",
    "area.restored",
    "peak.created",
    "peak.updated",
    "peak.retired",
    "peak.restored",
]);

// --- Der Plan ---------------------------------------------------------------------------------------------------------------

/** Was ein Feld über die Mitglieder hinweg erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt (C.3). */
interface FeldZiel {
    vorher: unknown;
    nachher: unknown;
    ersteSeq: number;
    letzteSeq: number;
}

/** Die Ecken einer Nachbarfläche, die eine Form mitzog (`area.carried`): vorher und nachher, parallel, ohne Ring- und Eckenindex. */
interface Mitgezogen {
    vorher: Punkt[];
    nachher: Punkt[];
}

interface PlanGegenstand {
    art: Art;
    id: string;
    name?: string;
    /** Die Landschaft einer Teilfläche oder Beschriftung (öffentliche Kennung). */
    region?: string;
    felder: Map<string, FeldZiel>;
    mitgezogen: Mitgezogen[];
    /** Ein Mitglied legte den Gegenstand an (`ANLEGEN`): Zurück heißt stillgelegt, seine späteren Felder bleiben (`zielWerte`). */
    angelegt: boolean;
}

type Plan = Map<string, PlanGegenstand>;

const schl = (art: string, id: string): string => `${art}:${id}`;

function setze(g: PlanGegenstand, feld: string, vorher: unknown, nachher: unknown, seq: number): void {
    const bisher = g.felder.get(feld);
    if (bisher === undefined) g.felder.set(feld, { vorher, nachher, ersteSeq: seq, letzteSeq: seq });
    else {
        bisher.nachher = nachher;
        bisher.letzteSeq = seq;
    }
}

const alsPunkte = (wert: unknown): Punkt[] =>
    Array.isArray(wert) ? (wert as number[][]).map(([x, y]) => [x!, y!] as const) : [];

/**
 * Der Plan aus den Protokolleinträgen der offenen Mitglieder (volle Nutzlast), in der Folge der Serie: je Gegenstand und Feld der Wert vor dem ersten und nach dem letzten Mitglied.
 * Die Gebirgswerte (`area.gebirge`) gehören dem Gebirge (`planAusEintraegen` in `ruecknahme-gebirge.ts`).
 */
export function bauePlan(eintraege: readonly MapHistoryEntry[]): Plan {
    const plan: Plan = new Map();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq)) {
        for (const o of eintrag.objects) {
            if (!istArt(o.kind)) continue;
            if (o.kind === "area" && o.action === GEBIRGE_PROTOKOLL) continue;
            const key = schl(o.kind, o.id);
            let g = plan.get(key);
            if (g === undefined) {
                const region = o.kind === "landscape" ? o.id : o.landscape?.id;
                g = {
                    art: o.kind,
                    id: o.id,
                    felder: new Map(),
                    mitgezogen: [],
                    angelegt: false,
                    ...(o.name !== undefined ? { name: o.name } : {}),
                    ...(region !== undefined ? { region } : {}),
                };
                plan.set(key, g);
            }
            if (ANLEGEN.has(o.action)) {
                // Der Gegenstand entstand in dieser Operation: Zurück bedeutet stillgelegt; Name, Ebene und Form von damals sind kein Ziel.
                g.angelegt = true;
                setze(g, "active", false, true, eintrag.seq);
                continue;
            }
            if (o.action === "area.carried") {
                const wechsel = o.changes["geometry"];
                g.mitgezogen.push({ vorher: alsPunkte(wechsel?.before), nachher: alsPunkte(wechsel?.after) });
                continue;
            }
            for (const [feld, wechsel] of Object.entries(o.changes)) {
                if (!FELDER[o.kind].has(feld)) continue;
                setze(g, feld, wechsel.before ?? null, wechsel.after ?? null, eintrag.seq);
            }
        }
    }
    return plan;
}

const ART_FOLGE: Readonly<Record<Art, number>> = { landscape: 0, area: 1, label: 2, peak: 3 };
const sortiert = (plan: Plan): PlanGegenstand[] =>
    [...plan.values()].sort((a, b) => ART_FOLGE[a.art] - ART_FOLGE[b.art] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// --- Der heutige Stand ------------------------------------------------------------------------------------------------------

interface Ist {
    /** Die Werte der Felder, wie das Protokoll sie führt (`null`, wo leer). */
    werte: Record<string, unknown>;
    revision: number;
    /** Die Zeilennummer (`id`) in der Tafel. */
    pk: string;
    /** Die Landschaft (öffentliche Kennung und Zeilennummer) einer Teilfläche oder Beschriftung, samt Ebene und Art für das Gelände. */
    region?: { id: string; pk: string; layer: string; type: string | null };
}

interface RegionRow {
    pk: string;
    id: string;
    name: string;
    layer: string;
    typ: string | null;
    platz: number;
    gesperrt: boolean;
    verborgen: boolean;
    gefahren: string[];
    kurve_an: boolean | null;
    kurve_max: number | null;
    aktiv: boolean;
    abgenommen: boolean;
    revision: number;
}
interface FlaechenRow {
    pk: string;
    id: string;
    aktiv: boolean;
    revision: number;
    geojson: string;
    region: string;
    region_pk: string;
    layer: string;
    typ: string | null;
}
interface LabelRow {
    pk: string;
    id: string;
    name: string;
    folgt: boolean | null;
    art: string | null;
    groesse: number | null;
    prioritaet: number | null;
    zoom_von: number | null;
    zoom_bis: number | null;
    anzeigen: boolean | null;
    x: number;
    y: number;
    aktiv: boolean;
    revision: number;
    region: string;
    region_pk: string;
    layer: string;
    typ: string | null;
}
interface GipfelRow {
    pk: string;
    id: string;
    name: string;
    hoehe: number | null;
    anzeigen: boolean;
    x: number;
    y: number;
    aktiv: boolean;
    revision: number;
    art: string;
    merkmale: string[];
}

/** Der heutige Stand der Gegenstände des Plans; ein Gegenstand, den es nicht (mehr) gibt, fehlt. */
async function leseIstAlle(db: Queryable, plan: Plan): Promise<Map<string, Ist>> {
    const ist = new Map<string, Ist>();
    const ids = (art: Art): string[] => [...plan.values()].filter((g) => g.art === art).map((g) => g.id);
    if (ids("landscape").length > 0)
        for (const r of await db<RegionRow[]>`
            SELECT id::text AS pk, public_id::text AS id, name, region_layer AS layer, region_type AS typ, stack_order::int AS platz,
                   is_locked AS gesperrt, is_hidden AS verborgen, hazards AS gefahren, label_curve_enabled AS kurve_an, label_curve_max AS kurve_max,
                   is_active AS aktiv, off_map AS abgenommen, revision::int AS revision
              FROM region WHERE public_id = ANY(${ids("landscape")}::uuid[]) AND region_layer <> 'klima'
        `)
            ist.set(schl("landscape", r.id), {
                pk: r.pk,
                revision: r.revision,
                werte: {
                    name: r.name,
                    layer: r.layer,
                    type: r.typ,
                    order: r.platz,
                    locked: r.gesperrt,
                    hidden: r.verborgen,
                    hazards: ordneGefahren(r.gefahren),
                    curve: { enabled: r.kurve_an, max: r.kurve_max },
                    active: r.aktiv,
                    offMap: r.abgenommen,
                },
            });
    if (ids("area").length > 0)
        for (const r of await db<FlaechenRow[]>`
            SELECT a.id::text AS pk, a.public_id::text AS id, a.is_active AS aktiv, a.revision::int AS revision,
                   ST_AsGeoJSON(a.geom, 15) AS geojson, g.public_id::text AS region, g.id::text AS region_pk,
                   g.region_layer AS layer, g.region_type AS typ
              FROM region_area a JOIN region g ON g.id = a.region_id
             WHERE a.public_id = ANY(${ids("area")}::uuid[])
        `)
            ist.set(schl("area", r.id), {
                pk: r.pk,
                revision: r.revision,
                werte: { geometry: ringe(polygoneVon(r.geojson)), active: r.aktiv },
                region: { id: r.region, pk: r.region_pk, layer: r.layer, type: r.typ },
            });
    if (ids("label").length > 0)
        for (const r of await db<LabelRow[]>`
            SELECT l.id::text AS pk, l.public_id::text AS id, l.name, l.text_follows_name AS folgt, l.subtype AS art,
                   l.label_size::float8 AS groesse, l.label_priority AS prioritaet, l.label_min_zoom AS zoom_von,
                   l.label_max_zoom AS zoom_bis, l.show_name AS anzeigen, ST_X(l.geom) AS x, ST_Y(l.geom) AS y,
                   l.is_active AS aktiv, l.revision::int AS revision, g.public_id::text AS region, g.id::text AS region_pk,
                   g.region_layer AS layer, g.region_type AS typ
              FROM map_label l JOIN region g ON g.id = l.region_id
             WHERE l.public_id = ANY(${ids("label")}::uuid[])
        `)
            ist.set(schl("label", r.id), {
                pk: r.pk,
                revision: r.revision,
                werte: {
                    text: r.name,
                    textFollowsName: r.folgt,
                    type: r.art,
                    size: r.groesse === null ? null : Number(r.groesse),
                    priority: r.prioritaet,
                    zoom: [r.zoom_von, r.zoom_bis],
                    showName: r.anzeigen,
                    position: [r.x, r.y],
                    active: r.aktiv,
                },
                region: { id: r.region, pk: r.region_pk, layer: r.layer, type: r.typ },
            });
    if (ids("peak").length > 0) {
        const herkunft = await leseHerkunft(db, "peak", ids("peak"));
        for (const r of await db<GipfelRow[]>`
            SELECT id::text AS pk, public_id::text AS id, name, height_schritt AS hoehe, show_name AS anzeigen,
                   ST_X(geom) AS x, ST_Y(geom) AS y, is_active AS aktiv, revision::int AS revision, subtype AS art, merkmale
              FROM terrain_peak WHERE public_id = ANY(${ids("peak")}::uuid[])
        `)
            ist.set(schl("peak", r.id), {
                pk: r.pk,
                revision: r.revision,
                werte: {
                    name: r.name,
                    subtype: r.art,
                    merkmale: merkmaleGeordnet(r.merkmale),
                    height: r.hoehe,
                    showName: r.anzeigen,
                    position: [r.x, r.y],
                    active: r.aktiv,
                    heightOrigin: herkunft.get(r.id)?.["height"] ?? null,
                },
            });
    }
    return ist;
}

// --- Vergleichen ------------------------------------------------------------------------------------------------------------

const runde = (zahl: number): number => Math.round(zahl * 1e6) / 1e6;

/** Ein Wert in fester Form zum Vergleichen: die Form auf fünf Nachkommastellen (wie die Vorwärtswege), Lagen auf sechs, leer als `null`. */
function norm(feld: string, wert: unknown): string {
    if (feld === "geometry")
        return JSON.stringify(
            ((wert ?? []) as number[][][][]).map((polygon) =>
                polygon.map((ring) => ring.map(([x, y]) => eckenSchluessel([x!, y!] as Punkt))),
            ),
        );
    if (feld === "curve") {
        const kurve = (wert ?? {}) as { enabled?: boolean | null; max?: number | null };
        return JSON.stringify([kurve.enabled ?? null, kurve.max ?? null]);
    }
    if (feld === "position") return JSON.stringify(Array.isArray(wert) ? (wert as number[]).map(runde) : null);
    // Die Gefahrenlage (WI-0308) als Menge: in der Folge des Katalogs, leer wie keine.
    if (feld === "hazards") return JSON.stringify(ordneGefahren(Array.isArray(wert) ? (wert as string[]) : []));
    return JSON.stringify(wert ?? null);
}
const gleich = (feld: string, a: unknown, b: unknown): boolean => norm(feld, a) === norm(feld, b);

/** Die Ecken einer Nachbarfläche zurück: jede mitgezogene Ecke (liegt genau einmal an ihrem Ort) wieder an ihre alte Stelle; `undefined`, wo das nicht eindeutig geht. */
export function eckenZurueck(
    aktuell: readonly (readonly (readonly Punkt[])[])[],
    vorher: readonly Punkt[],
    nachher: readonly Punkt[],
): Punkt[][][] | undefined {
    if (vorher.length === 0 || vorher.length !== nachher.length) return undefined;
    const ziel = new Map<string, { schluessel: string; punkt: Punkt }>();
    const soll = new Map<string, number>();
    for (const [i, nach] of nachher.entries()) {
        const von = vorher[i]!;
        const key = eckenSchluessel(nach);
        const bisher = ziel.get(key);
        if (bisher !== undefined && bisher.schluessel !== eckenSchluessel(von)) return undefined;
        ziel.set(key, { schluessel: eckenSchluessel(von), punkt: von });
        soll.set(key, (soll.get(key) ?? 0) + 1);
    }
    const hat = new Map<string, number>();
    for (const polygon of aktuell)
        for (const ring of polygon)
            for (const ecke of ring) hat.set(eckenSchluessel(ecke), (hat.get(eckenSchluessel(ecke)) ?? 0) + 1);
    for (const [key, anzahl] of soll) if (hat.get(key) !== anzahl) return undefined;
    return aktuell.map((polygon) =>
        polygon.map((ring) => ring.map((ecke) => ziel.get(eckenSchluessel(ecke))?.punkt ?? ecke)),
    );
}

const ausRingen = (wert: unknown): Punkt[][][] =>
    ((wert ?? []) as number[][][][]).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x!, y!] as const)));

/** Geht die Nachbarfläche zurück? Genau eine mitziehende Operation, keine eigene Form daneben, jede Ecke genau einmal an ihrer Stelle. */
const mitgezogenGeht = (g: PlanGegenstand, z: Ist): boolean =>
    g.mitgezogen.length === 1 &&
    !g.felder.has("geometry") &&
    eckenZurueck(ausRingen(z.werte["geometry"]), g.mitgezogen[0]!.vorher, g.mitgezogen[0]!.nachher) !== undefined;

// --- Recht und Art ----------------------------------------------------------------------------------------------------------

/**
 * Eine Teilfläche, die die Serie angelegt hat, wurde seither in eine Sprache kopiert (`sprache.flaeche_aus_landschaft`, WI-0265 B8c): Das Protokoll der Kopie nennt die Fläche der Derographie nur als Feld
 * (`kopiertAus`), nicht als Ziel seiner Zeile (sonst bekäme jede Landschaft eine spätere Operation, sobald jemand eine Sprache aus ihr zeichnet); der Kern sieht die Kopie also nicht. Beim Stilllegen der
 * angelegten Fläche wäre sie angehängt: Solange die Kopie auf der Karte steht, meldet die Rücknahme den Konflikt an der Sprache (ganz oder gar nicht). Die Kopie ist eine eigene Form und bleibt, wie sie ist.
 */
async function konflikteSprachkopien(db: Queryable, plan: Plan): Promise<VorKonflikt[]> {
    const flaechen = sortiert(plan)
        .filter((g) => g.art === "area" && g.angelegt)
        .map((g) => g.id);
    if (flaechen.length === 0) return [];
    const zeilen = await db<{ id: string; name: string }[]>`
        SELECT DISTINCT s.public_id::text AS id, s.name
          FROM sprache_flaeche f
          JOIN sprache s ON s.id = f.sprache_id
          JOIN map_audit_event e ON e.sprache_flaeche_public_id = f.public_id AND e.action = 'sprache_flaeche.copied'
         WHERE f.is_active AND s.is_active AND (e.changes #>> '{kopiertAus,after,areaId}') = ANY(${flaechen}::text[])
         ORDER BY s.name, s.public_id::text
    `;
    return zeilen.map((zeile) => ({
        art: "wert" as const,
        kind: "sprache" as const,
        id: zeile.id,
        name: zeile.name,
        felder: ["kopiertAus"],
        abweichung: { was: "felder" as const },
        detail: `Aus dieser Fläche wurde seither eine Teilfläche in die Sprache „${zeile.name}“ kopiert.`,
    }));
}

/** Der Adapter der Derographie für `vorpruefen` (siehe Kopf der Datei); derselbe für die Landschaft und den Gipfel. */
export const FLAECHE_ADAPTER: RuecknahmeAdapter = {
    familie: "derographie",
    recht(operation, aktionen): Capability | Capability[] {
        // Eine Fläche oder einen Gipfel anlegen verlangt Sache und Lage (WI-0265 B8c); die Beschriftung nur die Sache.
        if (ANLEGEN_MIT_LAGE.has(operation)) return ["edit_landscapes", "edit_landscape_form"];
        // Die Quellen verlangen `manage_sources` (`POST …/inhalte/traeger/area/:id/quellen`); eine Rücknahme von Feldern und Quellen verlangt beide Rechte.
        const quellen = aktionen.some(istQuellenAktionHier);
        if (quellen && aktionen.every(istQuellenAktionHier)) return "manage_sources";
        const felder: Capability = aktionen.some((aktion) => GEOMETRIE_AKTIONEN.has(aktion))
            ? "edit_landscape_form"
            : "edit_landscapes";
        // Das Gebirge gehört dem Topographen, auch beim Zurücknehmen (WI-0279, E2).
        const gebirge: Capability[] = aktionen.includes("area.gebirge") ? ["edit_mountains"] : [];
        const rechte: Capability[] = [felder, ...gebirge, ...(quellen ? (["manage_sources"] as const) : [])];
        return rechte.length === 1 ? rechte[0]! : rechte;
    },
    pruefeArt(operation, aktionen) {
        if (!FLAECHE_OPERATIONEN.has(operation) || aktionen.length === 0) return { ok: false, reason: "art" };
        // Unter dem Namen der Quellen (`traeger.sources`) steht nur ihre eigene Aktion, nie ein Feld der Landschaft.
        if (operation === TRAEGER_QUELLEN_OPERATION)
            return aktionen.every(istQuellenAktionHier) ? { ok: true } : { ok: false, reason: "art" };
        return aktionen.every((aktion) => AKTIONEN.has(aktion)) ? { ok: true } : { ok: false, reason: "art" };
    },
    // 🔴 Ein Gipfelfeld, das der Plan nicht kennt (`FELDER.peak`), schließt das Mitglied aus, statt still übergangen zu werden (WI-0271 L3).
    pruefeListe(offen) {
        const aus = new Map<string, "art">();
        for (const m of offen)
            if (
                m.gegenstaende.some(
                    // Die Quellen des Gipfels (`peak.sources_changed`) sind kein Feld des Gipfels: Sie gehen über den Kern der Quellen.
                    (g) =>
                        g.kind === "peak" && !istQuellenAktion(g.action) && unbekannteGipfelfelder(g.felder).length > 0,
                )
            )
                aus.set(m.operationId, "art");
        return aus;
    },
    feinFelder: feinFelderGebirge,
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const eintraege = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((m) => m.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries;
        const plan = bauePlan(eintraege);
        const ist = await leseIstAlle(database, plan);
        const konflikte: VorKonflikt[] = [];
        for (const g of sortiert(plan)) {
            const z = ist.get(schl(g.art, g.id));
            // Den Gegenstand gibt es nicht mehr: Das meldet die Vorprüfung als `geloescht`.
            if (z === undefined) continue;
            const name = g.name === undefined ? {} : { name: g.name };
            const abweichend = [...g.felder]
                .filter(([feld, ziel]) => !gleich(feld, z.werte[feld], ziel.nachher))
                .map(([feld]) => feld);
            if (abweichend.length > 0)
                konflikte.push({
                    art: "wert",
                    kind: g.art,
                    id: g.id,
                    ...name,
                    felder: abweichend,
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`,
                });
            if (g.mitgezogen.length > 0 && !mitgezogenGeht(g, z))
                konflikte.push({
                    art: "wert",
                    kind: g.art,
                    id: g.id,
                    ...name,
                    felder: ["geometry"],
                    abweichung: { was: "flaeche_nachbar" },
                    detail: "Die mitgezogenen Ecken der Nachbarfläche liegen nicht mehr genau an ihrer Stelle.",
                });
            // Die Höhe eines Gipfels, die vorher leer war, kann der Schreibweg nicht leeren; geht er zu einer Art ohne Gelände zurück, leert er sie selbst (WI-0271 L3).
            const hoehe = g.felder.get("height");
            const zielArt = String(g.felder.get("subtype")?.vorher ?? z.werte["subtype"]);
            // Ein Gipfel, den die Serie selbst anlegte, kommt nur still (`active`); seine Höhe ist kein Ziel.
            if (
                g.art === "peak" &&
                !g.angelegt &&
                formtGelaende(zielArt) &&
                hoehe !== undefined &&
                hoehe.vorher === null &&
                z.werte["height"] !== null
            )
                konflikte.push({
                    art: "wert",
                    kind: "peak",
                    id: g.id,
                    ...name,
                    felder: ["height"],
                    abweichung: { was: "gipfel_wert" },
                    detail: "Die Höhe war vorher leer; der Gipfel lässt sich nicht ohne Höhe zurückschreiben.",
                });
        }
        konflikte.push(...(await konflikteGebirge(database, eintraege, kontext.leser.personId)));
        konflikte.push(...(await konflikteSprachkopien(database, plan)));
        // Die Quellen der Landschaft und des Gipfels: Jede Verknüpfung steht heute so, wie die Serie sie hinterließ, und ihr Ziel gibt es noch. Ein Träger, den diese Rücknahme selbst belebt, darf heute still sein.
        const belebt = new Set(
            sortiert(plan)
                .filter((g) => (g.art === "landscape" || g.art === "peak") && g.felder.get("active")?.vorher === true)
                .map((g) => traegerSchluessel(g.art === "landscape" ? "area" : "peak", g.id)),
        );
        for (const kind of QUELLEN_ARTEN)
            konflikte.push(
                ...konflikteAmTraeger(await pruefeQuellen(database, planAusTraeger(eintraege, kind), belebt)),
            );
        return konflikte;
    },
};

// --- Schreiben --------------------------------------------------------------------------------------------------------------

/**
 * Der Stand eines Gegenstands nach der Rücknahme: seine heutigen Werte, die geplanten Felder auf den Wert vor dem ersten Mitglied. Einen Gegenstand, den die Serie selbst anlegte, gab es vorher nicht:
 * Zurück ist nur `active = false`, was er danach bekam (Name, Höhe, Lage …), bleibt (WI-0265 B8c).
 */
function zielWerte(g: PlanGegenstand, z: Ist): Record<string, unknown> {
    const neu = { ...z.werte };
    for (const [feld, ziel] of g.felder) if (!g.angelegt || feld === "active") neu[feld] = ziel.vorher;
    return neu;
}

/** Die Felder, die sich ändern (heute anders als das Ziel); ohne `heightOrigin`, das nur mit der Höhe geht. */
const aenderungen = (g: PlanGegenstand, z: Ist, neu: Record<string, unknown>): string[] =>
    [...g.felder.keys()].filter((feld) => feld !== "heightOrigin" && !gleich(feld, z.werte[feld], neu[feld]));

const wechsel = (z: Ist, neu: Record<string, unknown>, felder: readonly string[]): Record<string, MapChange> =>
    Object.fromEntries(felder.map((feld) => [feld, { before: z.werte[feld] ?? null, after: neu[feld] ?? null }]));

const konfliktRevision = (): ApiError =>
    new ApiError(
        409,
        "edit_conflict",
        "Seit diesen Änderungen hat sich etwas geändert. Die Rücknahme würde das überschreiben.",
    );

/** Die Aktion des Eintrags: Stilllegen und Zurückholen heißen so, sonst wie der Vorwärtsweg („Text geändert“ als `label.renamed`). */
function aktionVon(
    art: Art,
    felder: readonly string[],
    neu: Record<string, unknown>,
    aktivWechsel: boolean,
): MapAuditEntry["action"] {
    if (art === "landscape")
        return aktivWechsel
            ? neu["active"] === true
                ? "region.restored"
                : neu["offMap"] === true
                  ? "region.taken_off_map"
                  : "region.retired"
            : "region.updated";
    if (art === "area")
        return aktivWechsel ? (neu["active"] === true ? "area.restored" : "area.retired") : "area.reshaped";
    if (art === "label")
        return aktivWechsel
            ? neu["active"] === true
                ? "label.restored"
                : "label.retired"
            : felder.includes("text")
              ? "label.renamed"
              : "label.updated";
    return aktivWechsel ? (neu["active"] === true ? "peak.restored" : "peak.retired") : "peak.updated";
}

const kraftlinienFehler = (name: string, linien: readonly { name: string }[]): ApiError =>
    new ApiError(
        409,
        "powerline_endpoint",
        `An einer Beschriftung von ${name} endet eine Kraftlinie (${linien
            .slice(0, 3)
            .map((l) => l.name)
            .join(", ")}); erst sie umhängen oder entfernen.`,
        { powerlines: linien.map((l) => l.name) },
    );

/** Eine Landschaft geht von der Karte: Endet an einer ihrer Beschriftungen eine Kraftlinie, bleibt sie (wie beim Entfernen, 409 `powerline_endpoint`). */
async function pruefeKraftlinienAnLandschaft(tx: Queryable, regionPk: string, name: string): Promise<void> {
    const linien = await tx<{ name: string }[]>`
        SELECT DISTINCT coalesce(nullif(p.name, ''), p.public_id::text) AS name
          FROM powerline p JOIN map_label l ON l.public_id IN (p.from_public_id, p.to_public_id)
         WHERE (p.is_active OR p.off_map) AND l.is_active AND l.region_id = ${regionPk}::bigint
         ORDER BY 1
    `;
    if (linien.length > 0) throw kraftlinienFehler(name, linien);
}

/** Eine Beschriftung oder eine Landmarke geht von der Karte: Endet an ihr eine Kraftlinie, bleibt sie (409 `powerline_endpoint`). */
async function pruefeKraftlinienAnBeschriftung(tx: Queryable, labelId: string, name: string): Promise<void> {
    const linien = await tx<{ name: string }[]>`
        SELECT DISTINCT coalesce(nullif(p.name, ''), p.public_id::text) AS name
          FROM powerline p
         WHERE (p.is_active OR p.off_map) AND ${labelId}::uuid IN (p.from_public_id, p.to_public_id)
         ORDER BY 1
    `;
    if (linien.length > 0) throw kraftlinienFehler(name, linien);
}

interface Ergebnis {
    affected: OperationReceipt["affected"];
    entries: MapAuditEntry[];
    warnings: OperationReceipt["warnings"];
    ohneAbleitung: boolean;
    namen: string[];
}

/**
 * Die Inverse des Protokolls ohne das Gebirge (das schreibt `schreibeGebirge`): jeder Gegenstand des Plans auf den Wert vor dem ersten Mitglied. Zwei Durchgänge, damit eine
 * Fläche vor ihren Teilen zurückkommt und nach ihnen geht: erst, was auf der Karte steht (Landschaft, Teilflächen, Beschriftungen, Gipfel), dann, was von der Karte geht.
 */
async function schreibeFlaeche(
    tx: Queryable,
    actor: MapActor,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<Ergebnis> {
    const plan = bauePlan(eintraege);
    const ist = await leseIstAlle(tx, plan);
    const grundFeld: Record<string, MapChange> = grund === undefined ? {} : { restoreReason: { after: grund } };
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    const regionen = new Set<string>();
    let gelaende = false;
    let ohneAbleitung = true;

    const objekte = sortiert(plan);
    const geht = (g: PlanGegenstand): boolean => {
        const z = ist.get(schl(g.art, g.id));
        return z !== undefined && g.felder.has("active") && g.felder.get("active")!.vorher === false;
    };
    // Erst, was auf der Karte bleibt oder zurückkommt; dann, was geht (Teile vor der Fläche).
    const erster = objekte.filter((g) => !geht(g));
    const zweiter = objekte.filter(geht).sort((a, b) => ART_FOLGE[b.art] - ART_FOLGE[a.art]);

    for (const g of [...erster, ...zweiter]) {
        const z = ist.get(schl(g.art, g.id));
        if (z === undefined) throw new ApiError(404, "not_found", "Etwas davon gibt es nicht mehr.");
        const neu = zielWerte(g, z);

        if (g.art === "area" && g.mitgezogen.length > 0) {
            const zurueck =
                g.mitgezogen.length === 1
                    ? eckenZurueck(ausRingen(z.werte["geometry"]), g.mitgezogen[0]!.vorher, g.mitgezogen[0]!.nachher)
                    : undefined;
            if (zurueck === undefined) throw konfliktRevision();
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE region_area
                   SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(zurueck)}::text), 0),
                       geometry_revision = COALESCE(geometry_revision, 0) + 1
                 WHERE id = ${z.pk}::bigint AND revision = ${z.revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            affected.push({ kind: TEILFLAECHE_ART, id: g.id, revision: geschrieben.revision });
            entries.push({
                action: "area.carried",
                regionId: z.region!.id,
                areaId: g.id,
                revisionBefore: z.revision,
                revisionAfter: geschrieben.revision,
                changes: {
                    geometry: {
                        before: g.mitgezogen[0]!.nachher.map((p) => [...p]),
                        after: g.mitgezogen[0]!.vorher.map((p) => [...p]),
                    },
                    ...grundFeld,
                },
            });
            regionen.add(z.region!.id);
            ohneAbleitung = false;
            gelaende ||= speistGelaende(z.region!.layer as EditorLandscapeLayer, z.region!.type);
            continue;
        }

        const felder = aenderungen(g, z, neu);
        if (felder.length === 0) continue;
        const aktivWechsel = felder.includes("active");
        const aktion = aktionVon(g.art, felder, neu, aktivWechsel);
        const aenderung = wechsel(z, neu, felder);
        if (g.name !== undefined) namen.push(g.name);

        if (g.art === "landscape") {
            const kurve = (neu["curve"] ?? {}) as { enabled?: boolean | null; max?: number | null };
            if (aktivWechsel && neu["active"] === false) await pruefeKraftlinienAnLandschaft(tx, z.pk, g.name ?? "");
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE region
                   SET name = ${neu["name"] as string}, region_layer = ${neu["layer"] as string}, region_type = ${neu["type"] as string | null},
                       stack_order = ${neu["order"] as number}, is_locked = ${neu["locked"] as boolean}, is_hidden = ${neu["hidden"] as boolean},
                       hazards = ${ordneGefahren((neu["hazards"] ?? []) as string[])}::text[],
                       label_curve_enabled = ${kurve.enabled ?? null}, label_curve_max = ${kurve.max ?? null},
                       is_active = ${neu["active"] as boolean}, off_map = ${neu["offMap"] as boolean}
                 WHERE id = ${z.pk}::bigint AND revision = ${z.revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            regionen.add(g.id);
            affected.push({ kind: LANDSCHAFT_ART, id: g.id, revision: geschrieben.revision });
            entries.push({
                action: aktion,
                regionId: g.id,
                revisionBefore: z.revision,
                revisionAfter: geschrieben.revision,
                changes: { ...aenderung, ...grundFeld },
            });
            if (felder.some((feld) => feld !== "hidden" && feld !== "hazards")) ohneAbleitung = false;
            const vorher = { layer: z.werte["layer"] as string, type: z.werte["type"] as string | null };
            const nachher = { layer: neu["layer"] as string, type: neu["type"] as string | null };
            if (felder.includes("layer") || felder.includes("type"))
                gelaende ||=
                    speistGelaende(vorher.layer as EditorLandscapeLayer, vorher.type) ||
                    speistGelaende(nachher.layer as EditorLandscapeLayer, nachher.type);
        } else if (g.art === "area") {
            const formNeu = felder.includes("geometry");
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE region_area
                   SET geom = CASE WHEN ${formNeu} THEN ST_SetSRID(ST_GeomFromGeoJSON(${formNeu ? geojsonAus(ausRingen(neu["geometry"])) : null}::text), 0) ELSE geom END,
                       geometry_revision = CASE WHEN ${formNeu} THEN COALESCE(geometry_revision, 0) + 1 ELSE geometry_revision END,
                       is_active = ${neu["active"] as boolean}
                 WHERE id = ${z.pk}::bigint AND revision = ${z.revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            regionen.add(z.region!.id);
            affected.push({ kind: TEILFLAECHE_ART, id: g.id, revision: geschrieben.revision });
            entries.push({
                action: aktion,
                regionId: z.region!.id,
                areaId: g.id,
                revisionBefore: z.revision,
                revisionAfter: geschrieben.revision,
                changes: { ...aenderung, ...grundFeld },
            });
            ohneAbleitung = false;
            gelaende ||= speistGelaende(z.region!.layer as EditorLandscapeLayer, z.region!.type);
        } else if (g.art === "label") {
            const lage = (neu["position"] ?? [0, 0]) as number[];
            const zoom = (neu["zoom"] ?? [null, null]) as (number | null)[];
            const lageNeu = felder.includes("position");
            if (aktivWechsel && neu["active"] === false) await pruefeKraftlinienAnBeschriftung(tx, g.id, g.name ?? "");
            const [geschrieben] = await tx<{ revision: number }[]>`
                UPDATE map_label
                   SET name = ${neu["text"] as string}, text_follows_name = ${neu["textFollowsName"] as boolean | null}, subtype = ${neu["type"] as string | null},
                       label_size = ${neu["size"] as number | null}::numeric(4, 1), label_priority = ${neu["priority"] as number | null}::smallint,
                       label_min_zoom = ${zoom[0] ?? null}::smallint, label_max_zoom = ${zoom[1] ?? null}::smallint,
                       show_name = ${neu["showName"] as boolean | null}::boolean,
                       geom = CASE WHEN ${lageNeu} THEN ST_SetSRID(ST_MakePoint(${lage[0]!}, ${lage[1]!}), 0) ELSE geom END,
                       is_active = ${neu["active"] as boolean}
                 WHERE id = ${z.pk}::bigint AND revision = ${z.revision}
                RETURNING revision::int AS revision
            `;
            if (geschrieben === undefined) throw konfliktRevision();
            regionen.add(z.region!.id);
            affected.push({ kind: "label", id: g.id, revision: geschrieben.revision });
            entries.push({
                action: aktion,
                regionId: z.region!.id,
                labelId: g.id,
                revisionBefore: z.revision,
                revisionAfter: geschrieben.revision,
                changes: { ...aenderung, ...grundFeld },
            });
            ohneAbleitung = false;
        } else {
            // Der Gipfel: erst zurückholen, dann die Felder über den einen Schreibweg (mit der Herkunft der Höhe), zuletzt Stilllegen.
            let revision = z.revision;
            const stilllegen = async (aktiv: boolean): Promise<void> => {
                const [geschrieben] = await tx<{ revision: number }[]>`
                    UPDATE terrain_peak SET is_active = ${aktiv}
                     WHERE id = ${z.pk}::bigint AND revision = ${revision}
                    RETURNING revision::int AS revision
                `;
                if (geschrieben === undefined) throw konfliktRevision();
                affected.push({ kind: GIPFEL_ART, id: g.id, revision: geschrieben.revision });
                entries.push({
                    action: aktiv ? "peak.restored" : "peak.retired",
                    peakId: g.id,
                    revisionBefore: revision,
                    revisionAfter: geschrieben.revision,
                    changes: { active: { before: !aktiv, after: aktiv }, ...grundFeld },
                });
                revision = geschrieben.revision;
            };
            if (aktivWechsel && neu["active"] === false) await pruefeKraftlinienAnBeschriftung(tx, g.id, g.name ?? "");
            if (aktivWechsel && neu["active"] === true) await stilllegen(true);
            const felderGipfel = felder.filter((feld) => feld !== "active");
            if (felderGipfel.length > 0) {
                const changes: { -readonly [K in keyof PeakChanges]: PeakChanges[K] } = {};
                const art = String(neu["subtype"]);
                if (felderGipfel.includes("name")) changes.name = neu["name"] as string;
                if (felderGipfel.includes("subtype")) changes.subtype = art as NonNullable<PeakChanges["subtype"]>;
                if (felderGipfel.includes("merkmale"))
                    changes.merkmale = merkmaleGeordnet((neu["merkmale"] ?? []) as string[]);
                // Ohne Gelände trägt der Gipfel keine Höhe: Der Schreibweg leert sie mit dem Wechsel der Art.
                if (felderGipfel.includes("height") && formtGelaende(art)) changes.height = neu["height"] as number;
                if (felderGipfel.includes("showName")) changes.showName = neu["showName"] as boolean;
                if (felderGipfel.includes("position")) {
                    const lage = neu["position"] as number[];
                    changes.position = [lage[0]!, lage[1]!];
                }
                const ursprung = g.felder.get("heightOrigin");
                // Leerte ein Wechsel der Art die Höhe, blieb ihr Vermerk stehen (`gipfelSchreiben`): Sie kommt mit diesem Vermerk zurück, nicht als eigene.
                const vermerkBlieb = ursprung === undefined && g.felder.has("subtype");
                const herkunft: FeldHerkunft = vermerkBlieb
                    ? ((z.werte["heightOrigin"] as FeldHerkunft | null) ?? "wiki")
                    : ursprung === undefined
                      ? "manual"
                      : ((ursprung.vorher as FeldHerkunft | null) ?? "wiki");
                const geschrieben = await gipfelSchreiben(tx, actor, g.id, revision, changes, herkunft);
                if (geschrieben !== undefined) {
                    affected.push(...geschrieben.affected);
                    entries.push(
                        ...geschrieben.entries.map((e) => ({ ...e, changes: { ...e.changes, ...grundFeld } })),
                    );
                    revision = geschrieben.entries[0]?.revisionAfter ?? revision;
                }
            }
            if (aktivWechsel && neu["active"] === false) await stilllegen(false);
            ohneAbleitung = false;
        }
    }

    // Die Schriftläufe hängen an der Landschaft: Sie steht unter `affected`, auch wenn nur ihre Teile geändert wurden (wie bei `landscape.update`).
    const fehlende = [...regionen]
        .filter((id) => !affected.some((x) => x.kind === LANDSCHAFT_ART && x.id === id))
        .sort();
    if (fehlende.length > 0)
        for (const zeile of await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM region WHERE public_id = ANY(${fehlende}::uuid[]) ORDER BY public_id
        `)
            affected.unshift({ kind: LANDSCHAFT_ART, id: zeile.id, revision: zeile.revision });
    return { affected, entries, warnings: gelaende ? [GELAENDE_VERALTET] : [], ohneAbleitung, namen };
}

// --- Die Familien -----------------------------------------------------------------------------------------------------------

/** Wo die Route hängt: an einer Landschaft oder an einem Gipfel. */
export type RuecknahmeZiel = { readonly art: "landscape" | "peak"; readonly id: string };

export const familieVon = (ziel: RuecknahmeZiel, mapDomainId: string): RuecknahmeFamilie => ({
    operation: ziel.art === "landscape" ? RUECKNAHME_FLAECHE_OPERATION : RUECKNAHME_GIPFEL_OPERATION,
    scope: `${ziel.art}:${ziel.id}`,
    adapter: FLAECHE_ADAPTER,
    mapDomainId,
    // Nur Quellen gehen über die Naht der Inhalte wie das Original; mit Feldern über die der Karte.
    naht: nahtDerQuellen,
});

/** Die Karte einer Landschaft, auch einer stillgelegten (deren Entfernen die Rücknahme zurückholt); 404, wenn es sie nicht gibt. */
export async function karteDerLandschaft(database: Queryable, regionId: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM region WHERE public_id = ${regionId}::uuid AND region_layer <> 'klima'
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diese Landschaft gibt es nicht.");
    return zeile.map_domain_id;
}

/** Rechnet die Rücknahme eines der Gipfel das Gelände (`gipfelRechnet`: vom heutigen Stand zurück zu dem vor dem ersten Mitglied)? */
async function gipfelAendernGelaende(
    database: Queryable,
    offen: readonly string[],
    personId: string,
): Promise<boolean> {
    const plan = bauePlan((await eintraegeNachKennung(database, offen, { personId, nutzlast: "voll" })).entries);
    const gipfel: Plan = new Map([...plan].filter(([, g]) => g.art === "peak"));
    if (gipfel.size === 0) return false;
    const ist = await leseIstAlle(database, gipfel);
    return [...gipfel.values()].some((g) => {
        const z = ist.get(schl(g.art, g.id));
        if (z === undefined) return false;
        const heute = String(z.werte["subtype"]);
        return gipfelRechnet(g.felder.keys(), heute, String(g.felder.get("subtype")?.vorher ?? heute));
    });
}

/** Die Folgen für das Bestätigungsblatt: wie viele Teilflächen und Gipfel, und was mit dem Gelände geschieht (Fachvertrag D, F.2). */
async function folgenVon(
    database: Queryable,
    mapDomainId: string,
    vor: Vorpruefung,
    personId: string,
): Promise<RuecknahmePruefung["folgen"]> {
    const offen = vor.mitglieder.filter((m) => m.offen);
    // Die Quellen einer Landschaft ändern weder Form noch Art noch Ebene: Sie zählen nicht zu dem, was das Gelände betrifft.
    const beruehrt = new Set(
        offen.flatMap((m) => m.gegenstaende.filter((g) => !istQuellenAktion(g.action)).map((g) => `${g.kind}:${g.id}`)),
    );
    const wirkend = vor.gegenstaende.filter((g) => beruehrt.has(`${g.kind}:${g.id}`));
    const gegenstaende = wirkend.filter((g) => g.kind === "area" || g.kind === "peak").length;
    // Ein Gebirge und ein Gipfel rechnen im Umkreis neu (EIN Lauf), wo das Rezept es kann; sonst bleibt das Gelände veraltet. Ein Gipfel nur, wo sich das Gelände ändert (WI-0271 L3).
    const gebirge = offen.some((m) => m.gegenstaende.some((g) => g.action === GEBIRGE_PROTOKOLL));
    const gipfel =
        !gebirge &&
        offen.some((m) => m.gegenstaende.some((g) => g.kind === "peak")) &&
        (await gipfelAendernGelaende(
            database,
            offen.map((m) => m.operationId),
            personId,
        ));
    const rechnet = (gebirge || gipfel) && gegenstaende > 0;
    if (rechnet) {
        const rezept = await resolveTerrainRecipe(database, mapDomainId);
        return { gegenstaende, gelaende: istRegional(rezept) ? "lokal" : "veraltet" };
    }
    // Eine Fläche, die das Gelände speist, macht es veraltet (Befund `terrain_stale`, kein Lauf).
    const landschaften = wirkend.filter((g) => g.kind === "landscape").map((g) => g.id);
    const flaechen = wirkend
        .filter((g) => g.kind === "area" || g.kind === "label")
        .map((g) => ({ kind: g.kind, id: g.id }));
    if (landschaften.length + flaechen.length === 0) return { gegenstaende, gelaende: "keines" };
    const zeilen = await database<{ layer: string; typ: string | null }[]>`
        SELECT DISTINCT r.region_layer AS layer, r.region_type AS typ
          FROM region r
         WHERE r.public_id = ANY(${landschaften}::uuid[])
            OR r.id IN (SELECT region_id FROM region_area WHERE public_id = ANY(${flaechen.filter((f) => f.kind === "area").map((f) => f.id)}::uuid[]))
            OR r.id IN (SELECT region_id FROM map_label WHERE public_id = ANY(${flaechen.filter((f) => f.kind === "label").map((f) => f.id)}::uuid[]))
    `;
    const betrifft = wirkend.some((g) => g.kind === "area") || wirkend.some((g) => g.kind === "landscape");
    return {
        gegenstaende,
        gelaende:
            betrifft && zeilen.some((z) => speistGelaende(z.layer as EditorLandscapeLayer, z.typ))
                ? "veraltet"
                : "keines",
    };
}

/** `POST …/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauMit(
    database: Database,
    familie: RuecknahmeFamilie,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: familie.mapDomainId, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familie,
    );
    return {
        ...vor,
        folgen: await folgenVon(database, familie.mapDomainId, vor, leser.personId),
    } as RuecknahmePruefung;
}

/**
 * Die Teilflächen mit Gebirgswerten im Plan, die diese Rücknahme von der Karte nimmt: sie selbst oder ihre Landschaft stand vor dem ersten Mitglied nicht auf der Karte (eine angelegte Fläche, WI-0265 B8c).
 * Die Werte einer Fläche ohne Eintrag zur Fläche selbst (nur `area.gebirge`) bleiben, wo sie sind.
 */
function gehendeGebirge(eintraege: readonly MapHistoryEntry[]): Set<string> {
    const plan = bauePlan(eintraege);
    const still = (art: Art, id: string): boolean => plan.get(schl(art, id))?.felder.get("active")?.vorher === false;
    return new Set(
        [...planAusEintraegen(eintraege)]
            .filter(([area, fl]) => still("area", area) || (fl.region !== undefined && still("landscape", fl.region)))
            .map(([area]) => area),
    );
}

/** Die Quellen der Landschaft und des Gipfels in EINEM Ergebnis (`undefined`, wo die Einträge keine führen). */
async function schreibeQuellenZurueck(
    tx: Sql,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<TraegerQuellenErgebnis | undefined> {
    const ergebnisse: TraegerQuellenErgebnis[] = [];
    for (const kind of QUELLEN_ARTEN) {
        const eines = await schreibeTraegerQuellenZurueck(tx, eintraege, kind, grund);
        if (eines !== undefined) ergebnisse.push(eines);
    }
    if (ergebnisse.length <= 1) return ergebnisse[0];
    return {
        affected: ergebnisse.flatMap((eines) => eines.affected),
        entries: ergebnisse.flatMap((eines) => eines.entries),
        name: ergebnisse[0]!.name,
    };
}

const idsVon = (vorab: Vorpruefung, art: Art): string[] =>
    [...new Set(vorab.gegenstaende.filter((g) => g.kind === art).map((g) => g.id))].sort();

/** Die Zeilen der Gegenstände in fester Reihenfolge sperren (Landschaften, Teilflächen, Beschriftungen, Gipfel, Gebirgswerte), bevor die Vorprüfung wiederholt wird. */
async function sperreZeilen(tx: Queryable, vorab: Vorpruefung): Promise<void> {
    const regionen = idsVon(vorab, "landscape");
    const flaechen = idsVon(vorab, "area");
    const labels = idsVon(vorab, "label");
    const gipfel = idsVon(vorab, "peak");
    if (regionen.length > 0)
        await tx`SELECT id FROM region WHERE public_id = ANY(${regionen}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    if (flaechen.length > 0)
        await tx`SELECT id FROM region_area WHERE public_id = ANY(${flaechen}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    if (labels.length > 0)
        await tx`SELECT id FROM map_label WHERE public_id = ANY(${labels}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    if (gipfel.length > 0)
        await tx`SELECT id FROM terrain_peak WHERE public_id = ANY(${gipfel}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    await sperreGebirgswerte(tx, flaechen);
}

/**
 * `POST …/restore-series`: nimmt die Mitglieder einer Serie (oder eine Einzeloperation) in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was die Derographie ausmacht:
 * die Fremdsperren der Landschaften und Gipfel, die Sperren der Zeilen, die Inverse des Protokolls und die Quittung zum Gelände.
 */
export async function ruecknehmenMit(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    familie: RuecknahmeFamilie,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const haken: RuecknahmeHaken = {
        async pruefeFremdeSperre(db, akteur, scopes) {
            const landschaften = [...scopes]
                .filter((s) => s.startsWith("landscape:"))
                .map((s) => s.slice("landscape:".length));
            const gipfel = [...scopes].filter((s) => s.startsWith("peak:")).map((s) => s.slice("peak:".length));
            if (landschaften.length > 0) await pruefeFremdeSperre(db, akteur, landschaften);
            if (gipfel.length > 0) await pruefeFremdeGipfelSperre(db, akteur, gipfel);
        },
        async sperreZeilen(tx, vorab) {
            await sperreZeilen(tx, vorab);
            for (const kind of QUELLEN_ARTEN)
                if (hatQuellen(vorab, kind))
                    await sperreQuellen(
                        tx,
                        planAusTraeger(
                            (
                                await eintraegeNachKennung(tx, vorab.offen, {
                                    personId: leser.personId,
                                    nutzlast: "voll",
                                })
                            ).entries,
                            kind,
                        ),
                    );
        },
        async schreibe({ tx, offen, grund }) {
            const eintraege = (await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" }))
                .entries;
            // Die Werte einer Fläche, die die Rücknahme von der Karte nimmt, kommen vor dem Stilllegen zurück, die einer Fläche, die auf die Karte kommt, danach (`gebirgSchreiben` schreibt nur an einer aktiven).
            const gehend = gehendeGebirge(eintraege);
            const gebirgeVorher = await schreibeGebirge(tx, eintraege, grund, (area) => gehend.has(area));
            const flaeche = await schreibeFlaeche(tx, actor, eintraege, grund);
            const gebirgeNachher = await schreibeGebirge(tx, eintraege, grund, (area) => !gehend.has(area));
            const gebirge = {
                affected: [...gebirgeVorher.affected, ...gebirgeNachher.affected],
                entries: [...gebirgeVorher.entries, ...gebirgeNachher.entries],
            };
            // Unter einem Rezept ohne regionale Rückverteilung gibt es für das Gebirge keinen Lauf: Das Gelände bleibt veraltet, und die Quittung sagt es (D, U13).
            const regional =
                gebirge.affected.length === 0 ? true : istRegional(await resolveTerrainRecipe(tx, familie.mapDomainId));
            const warnings = [...flaeche.warnings, ...(regional ? [] : [GELAENDE_VERALTET])].filter(
                (w, i, alle) => alle.findIndex((x) => x.code === w.code) === i,
            );
            const namen = [...new Set(flaeche.namen)];
            const wer =
                namen.length === 0
                    ? "Derographie"
                    : namen.length === 1
                      ? namen[0]!
                      : `${String(namen.length)} Gegenstände`;
            // Die Quellen der Landschaft gehen in derselben Operation mit zurück (WI-0265 B6g3).
            const quellen = await schreibeQuellenZurueck(tx, eintraege, grund);
            const hatFelder = flaeche.entries.length > 0 || gebirge.entries.length > 0 || quellen === undefined;
            const felder = hatFelder
                ? {
                      receipt: { affected: [...flaeche.affected, ...gebirge.affected], derivedWork: [], warnings },
                      summary: `${wer}: ${offen.length === 1 ? "1 Änderung" : `${String(offen.length)} Änderungen`} zurückgenommen`,
                      entries: [...flaeche.entries, ...gebirge.entries],
                      // Verbergen allein geht in keine Ableitung ein (T41): nur die Kachelrevision.
                      ...(flaeche.ohneAbleitung && flaeche.entries.length > 0 && gebirge.entries.length === 0
                          ? { ableitung: false as const }
                          : {}),
                  }
                : undefined;
            return mischeErgebnis(felder, quellen, offen.length);
        },
    };
    return fuehreRuecknahmeAus({ database, actor, leser, familie, body, haken });
}

// --- Die Landschaft ---------------------------------------------------------------------------------------------------------

/** `POST /api/editor/landscapes/:id/restore-series/preview`. */
export async function vorschauFlaeche(
    database: Database,
    regionId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const karte = await karteDerLandschaft(database, regionId);
    return vorschauMit(database, familieVon({ art: "landscape", id: regionId }, karte), body, leser);
}

/** `POST /api/editor/landscapes/:id/restore-series`. */
export async function ruecknehmenFlaeche(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    regionId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const karte = await karteDerLandschaft(database, regionId);
    return ruecknehmenMit(database, actor, leser, familieVon({ art: "landscape", id: regionId }, karte), body);
}
