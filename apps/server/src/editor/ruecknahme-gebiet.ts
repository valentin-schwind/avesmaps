import {
    EDITOR_TERRITORY_DETAIL_FIELDS,
    type Capability,
    type EditorTerritoryDetailField,
    type MapHistoryEntry,
    type OperationReceipt,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
    type TerritoryDetailChanges,
    type TerritoryUpdateChanges,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { eintraegeNachKennung } from "./history.ts";
import { GEBIET_ART, GEBIETSFLAECHE_ART, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeSchreiben,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import {
    GEBIET_ANLEGEN_OPERATIONEN,
    GEBIET_ENTFERNEN_OPERATIONEN,
    GEBIET_FELDER_OPERATIONEN,
    GEBIET_QUELLEN_OPERATIONEN,
    GEBIET_ZURUECKHOLEN_OPERATION,
    RUECKNAHME_GEBIET_OPERATION,
} from "./ruecknahme-arten.ts";
import { eckenZurueck } from "./ruecknahme-flaeche.ts";
import {
    hatQuellen,
    istQuellenAktion,
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
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, VorMitglied } from "./ruecknahme.ts";
import { geojsonAus, gleich as gleicheForm, polygoneVon, ringe, type Punkt } from "./ring-form.ts";
import { leseGebiete, schreibeDarstellung } from "./territory-display.ts";
import { pruefeFremdeGebietssperre } from "./territory-reshape.ts";
import { kehreEntfernenUm, leseEntfernenProtokoll } from "./territory-retire.ts";
import { pruefeObergebiet, schreibeFelder } from "./territory-update.ts";

/**
 * Herrschaftsgebiete zurücknehmen (WI-0265 B6b; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3 „Mehrscope“, F.1, Gate 2 und 3; Testvertrag U4, U5, U6, U8, U9):
 * der Adapter des Gebiets für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `territory.restore_series` (Quelle `restore`, `reverts` = die offenen
 * Mitglieder in Serienfolge; Ablauf, Fehler und Sperren in `ruecknahme-ablauf.ts`). Die Route hängt an EINEM Gebiet (`:id`); jedes Mitglied berührt es.
 *
 * 🔴 **Parität:** Zurückgenommen wird genau, was das ↺ im Verlauf des Gebiets bis B6b konnte (`apps/web/src/gebietseditor/gebiet-verlauf.ts`), nicht mehr. Drei Arten Mitglied, nach den
 * Protokolleinträgen, nicht nach dem Namen der Operation:
 *
 * - **Felder und Darstellung** (`territory.update`, `territory.display`, `territory.sammel`, auch eine frühere Rücknahme): Name, Kurzname, Art, Status, Hauptstadt, Obergebiet („Umhängen“),
 *   die 17 Detailfelder samt Herkunft (folgte ein Wert vorher dem Wiki, kommt er als `revert: "wiki"` zurück), Farbe und Zoomspanne. Mehrere Mitglieder sind eine Arbeitsserie (dasselbe
 *   Gebiet, dieselbe Person): je Feld der Wert VOR dem ersten Mitglied, das es berührt, in EINER Operation. Betraf die Operation mehrere Gebiete (Mehrfachauswahl, Farben und Zoombänder
 *   für mehrere), kommen ALLE zurück oder keines: Das ↺ „nur dieses Gebiet“ des Clients ist eine stille Teilrücknahme und fällt weg (Fachvertrag C.3). Das eigene Band einer Fläche, das eine
 *   neue Spanne geleert hat, kommt nicht zurück (wie in Legacy gilt dann die Spanne des Gebiets).
 * - **Entfernen** (`territory.retire`, auch für mehrere), **„Unter neues Obergebiet …“** (`territory.create_parent`) und **„Flächen vereinigen ›“** (`territory.merge`): Der Schreibweg von
 *   `territory.restore` (`kehreEntfernenUm` in `territory-retire.ts`) kehrt das Protokoll Zeile für Zeile um, wenn es noch so steht; hier läuft er in der Transaktion der Rücknahme. Geht nur allein.
 *
 * - **Quellen** (`traeger.sources`, Aktion `territory.sources_changed`; WI-0265 B6g3): die Klappbox des Gebietseditors. Sie teilen die Serie des Gebiets und gehen mit den Felder in EINER Rücknahme ganz oder
 *   gar nicht zurück (`ruecknahme-traeger-quellen.ts`); das Recht dazu ist `manage_sources`, eine gemischte Serie verlangt beide Rechte. Nur Quellen gehen über die Naht der Inhalte (kein Ereignis `map.changed`).
 *
 * - **Die Form** (WI-0265 B8b; `territory.update` mit `areas`, Aktionen `territory_area.reshaped` und `territory_area.carried`): gehört zu den Feldern, in derselben Rücknahme. Eine eigene Fläche
 *   bekommt ihre Form vor dem ersten Mitglied (das Protokoll trägt sie vollständig: `before` sind alle Ringe), die mitgezogenen Ecken einer Nachbarfläche gehen wie in der Derographie zurück
 *   (`eckenZurueck`: jede Ecke liegt genau einmal an ihrer Stelle, sonst 409 `flaeche_nachbar`, ganz oder gar nicht). Das Recht dazu ist das der Vorwärtsoperation: `edit_map_geometry` dazu.
 * - **Anlegen** (`territory.create`: Gebiet samt erster Fläche; `territory_area.create`: „Grenze zeichnen“): Zurücknehmen heißt stilllegen (`territory.retired`, `territory_area.retired`, derselbe
 *   Weg wie Entfernen). Eine Serie aus Anlegen und den folgenden Änderungen derselben Person geht als Ganzes zurück, also wird stillgelegt; ihre Felder, Quellen und Formen brauchen keine eigene
 *   Inverse. Hängt seither ein aktives Untergebiet am Gebiet, bleibt es stehen (409 mit dem Untergebiet als Gegenstand), nichts wird geschrieben.
 * - **Zurückholen** (`territory.restore`, und eine Rücknahme von Entfernen): Seine Rücknahme macht das Entfernen noch einmal (`kehreEntfernenUm` in die Gegenrichtung); geht nur allein.
 *
 * - **Felder UND Stand zugleich** (WI-0265 B8b2): Eine Serie aus Feldern und „Grenze zeichnen“ oder Entfernen geht als Ganzes zurück, und die Rücknahme (Felder davor, Stand zurück) lässt sich selbst
 *   zurücknehmen: Der Stand geht über `kehreEntfernenUm` (das jüngste Mitglied zuerst), die Felder über den Weg der Felder in derselben Operation, ganz oder gar nicht. Ein Entfernen oder Vereinigen,
 *   das nur ein Gebiet berührt, ist Serienmitglied; „Unter neues Obergebiet …“ und das Zurückholen gehen allein.
 *
 * Nicht rücknehmbar (Grund `art`): ein Name, der vorher leer war. Dazu Import, Zurücksetzen der Testwelt und WikiSync (Grund `quelle`, aus der Liste).
 *
 * **Bedingung:** Revision und Werte stehen heute gleich wie nach dem letzten Mitglied (Kern: die Revision je Gegenstand; hier zusätzlich die Werte, damit der Konflikt die Felder nennt, und die
 * Ziele von Obergebiet und Hauptstadt, die es noch geben muss).
 */

type Art = "felder" | "entfernen" | "quellen" | "anlegen" | "grenze";

// Die Namen der Operationen stehen im Katalog (`ruecknahme-arten.ts`, WI-0265 B6f): Liste, Zustandsfilter und dieser Adapter sagen so dasselbe.
/** Die Aktionen einer Änderung der Felder und der Darstellung; das Leeren der eigenen Bänder (`bands_cleared`) ist eine Folge der Spanne. */
const FELDER_AKTIONEN: ReadonlySet<string> = new Set([
    "territory.updated",
    "territory.display_changed",
    "territory_area.bands_cleared",
]);
/** Die Form des Gebiets: eine eigene Fläche (`reshaped`) und die mitgezogenen Ecken einer Nachbarfläche (`carried`). */
const FORM_AKTIONEN: ReadonlySet<string> = new Set(["territory_area.reshaped", "territory_area.carried"]);
const ENTFERNEN_AKTIONEN: ReadonlySet<string> = new Set([
    "territory.retired",
    "territory.updated",
    "territory.created",
    "territory.restored",
    "territory_area.retired",
    "territory_area.restored",
    "territory_area.merged",
    // Die Form der Vorlage, die ein Zurückholen von „Flächen vereinigen ›“ hinterließ.
    "territory_area.reshaped",
]);
/** Entfernen und Vereinigen, die nur ein Gebiet berühren, dürfen in einer Serie stehen (WI-0265 B8b2). */
const SERIEN_ENTFERNEN: ReadonlySet<string> = new Set(["territory.retire", "territory.merge"]);
/** Die Operationen, die `kehreEntfernenUm` umkehrt: Entfernen, „Unter neues Obergebiet …“, Vereinigen und das Zurückholen (auch als Rücknahme einer Serie). */
const UMKEHR_OPERATIONEN: ReadonlySet<string> = new Set([
    ...GEBIET_ENTFERNEN_OPERATIONEN,
    GEBIET_ZURUECKHOLEN_OPERATION,
    RUECKNAHME_GEBIET_OPERATION,
]);

/** Welche Art Mitglied eine Operation ist, nach ihrem Namen und den Aktionen ihrer Protokolleinträge; `undefined`, wenn keine, die die Rücknahme kennt. */
function artVon(operation: string, aktionen: readonly string[]): Art | undefined {
    if (aktionen.length === 0) return undefined;
    // Felder, Darstellung und Form, auch zusammen mit den Quellen des Gebiets (eine Rücknahme von Feldern und Quellen trägt beides).
    if (
        GEBIET_FELDER_OPERATIONEN.has(operation) &&
        aktionen.every(
            (aktion) =>
                FELDER_AKTIONEN.has(aktion) || FORM_AKTIONEN.has(aktion) || aktion === "territory.sources_changed",
        ) &&
        aktionen.some((aktion) => FELDER_AKTIONEN.has(aktion) || FORM_AKTIONEN.has(aktion))
    )
        return "felder";
    if (nurQuellen("territory", GEBIET_QUELLEN_OPERATIONEN, operation, aktionen)) return "quellen";
    if (UMKEHR_OPERATIONEN.has(operation) && aktionen.every((aktion) => ENTFERNEN_AKTIONEN.has(aktion)))
        return "entfernen";
    // Anlegen (WI-0265 B8b): Gebiet samt erster Fläche, oder die Fläche allein.
    if (
        GEBIET_ANLEGEN_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "territory.created" || aktion === "territory_area.created")
    ) {
        if (operation === "territory.create" && aktionen.includes("territory.created")) return "anlegen";
        if (operation === "territory_area.create" && aktionen.every((aktion) => aktion === "territory_area.created"))
            return "grenze";
    }
    return undefined;
}

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

/**
 * Die Felder, die ein Mitglied der Art „Entfernen“ neben seinem Stilllegen oder Zurückholen trägt (WI-0265 B8b2): `kehreEntfernenUm` setzt nur das Obergebiet (und seine Herkunft) zurück; die
 * übrigen Felder von `territory.updated` und die Darstellung gehen über den Weg der Felder. Der Eintrag ohne Stand (`territory.retired` …) und ohne Obergebiet; leer, wo nichts übrig bleibt.
 */
function nurFelder(eintrag: MapHistoryEntry): MapHistoryEntry {
    const objects = eintrag.objects.flatMap((gegenstand) => {
        if (gegenstand.kind !== "territory" || !FELDER_AKTIONEN.has(gegenstand.action)) return [];
        const changes = Object.fromEntries(
            Object.entries(gegenstand.changes).filter(([feld]) => feld !== "parent" && feld !== "parentOrigin"),
        );
        return Object.keys(changes).length === 0 ? [] : [{ ...gegenstand, changes }];
    });
    return { ...eintrag, objects };
}

/** Die Felder des Gebiets, die `territory.update` schreibt, und die Darstellung (`territory.display`). */
const FELDER = ["name", "shortName", "type", "status", "capital", "parent"] as const;
const DARSTELLUNG = ["color", "minZoom", "maxZoom"] as const;
type Feld = (typeof FELDER)[number] | (typeof DARSTELLUNG)[number];
const DETAILS: readonly string[] = EDITOR_TERRITORY_DETAIL_FIELDS;
/** Die Felder, die die Rücknahme der Felder versteht; ein anderes im Protokoll hält sie an, statt es zu übergehen. */
const BEKANNT: ReadonlySet<string> = new Set<string>([...FELDER, ...DARSTELLUNG, ...DETAILS, "parentOrigin"]);

const istDetail = (feld: string): feld is EditorTerritoryDetailField => DETAILS.includes(feld);
const leer = (wert: unknown): unknown => wert ?? null;

/** Was ein Feld über die Serie hinweg erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt (C.3). */
interface FeldZiel {
    feld: string;
    vorher: unknown;
    nachher: unknown;
}
interface HerkunftZiel {
    vorher: unknown;
    nachher: unknown;
}
interface GebietPlan {
    name?: string;
    felder: Map<string, FeldZiel>;
    /** Die Herkunft eines Detailfelds (`<feld>Origin`): vor dem ersten und nach dem letzten Mitglied, das sie änderte. */
    herkunft: Map<string, HerkunftZiel>;
}

/** Die Felder der Mitglieder je Gebiet; die Einträge brauchen die volle Nutzlast. Nur Gegenstände der Art `territory` (das Leeren der Bänder ist eine Folge, nie ein Ziel). */
function planAusEintraegen(eintraege: readonly MapHistoryEntry[]): Map<string, GebietPlan> {
    const plan = new Map<string, GebietPlan>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            // Die Quellen des Gebiets (`territory.sources_changed`) sind keine Felder des Gebiets; sie gehen über den Kern der Quellen am Träger.
            if (gegenstand.kind !== "territory" || istQuellenAktion(gegenstand.action)) continue;
            let gebiet = plan.get(gegenstand.id);
            if (gebiet === undefined) {
                gebiet = {
                    felder: new Map(),
                    herkunft: new Map(),
                    ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}),
                };
                plan.set(gegenstand.id, gebiet);
            }
            for (const [schluessel, wechsel] of Object.entries(gegenstand.changes)) {
                if (schluessel.endsWith("Origin") && istDetail(schluessel.slice(0, -"Origin".length))) {
                    const feld = schluessel.slice(0, -"Origin".length);
                    const bisher = gebiet.herkunft.get(feld);
                    if (bisher === undefined)
                        gebiet.herkunft.set(feld, { vorher: wechsel.before ?? null, nachher: wechsel.after ?? null });
                    else bisher.nachher = wechsel.after ?? null;
                    continue;
                }
                const bisher = gebiet.felder.get(schluessel);
                if (bisher === undefined)
                    gebiet.felder.set(schluessel, {
                        feld: schluessel,
                        vorher: wechsel.before ?? null,
                        nachher: wechsel.after ?? null,
                    });
                else bisher.nachher = wechsel.after ?? null;
            }
        }
    return plan;
}

/** Ein Gebiet, wie es heute steht: die Felder, die Darstellung, die Detailfelder samt Herkunft. */
interface GebietIst {
    id: string;
    name: string;
    mapDomainId: string;
    revision: number;
    aktiv: boolean;
    werte: Record<Feld, unknown>;
    details: Record<EditorTerritoryDetailField, { wert: string | null; herkunft: "wiki" | "manual" | null }>;
}

interface GebietZeile {
    id: string;
    name: string;
    short_name: string | null;
    territory_type: string | null;
    status_text: string | null;
    capital: string | null;
    parent: string | null;
    color: string;
    min_zoom: number | null;
    max_zoom: number | null;
    map_domain_id: string;
    revision: number;
    is_active: boolean;
    detail_id: string | null;
}

/** Der heutige Stand der Gebiete (auch stillgelegter); was es nicht gibt, fehlt in der Antwort. */
async function leseIst(database: Queryable, ids: readonly string[]): Promise<Map<string, GebietIst>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<GebietZeile[]>`
        SELECT t.public_id::text AS id, t.name, t.short_name, t.territory_type, t.status_text,
               t.capital_place_public_id::text AS capital, p.public_id::text AS parent, t.color, t.min_zoom, t.max_zoom,
               t.map_domain_id, t.revision::int AS revision, t.is_active, d.id::text AS detail_id
          FROM territory t
          LEFT JOIN territory p ON p.id = t.parent_id
          LEFT JOIN territory_detail d ON d.territory_id = t.id
         WHERE t.public_id = ANY(${ids as string[]}::uuid[])
    `;
    const detailIds = zeilen.flatMap((zeile) => (zeile.detail_id === null ? [] : [zeile.detail_id]));
    const werte = new Map<string, Record<string, string | null>>();
    const herkunft = new Map<string, Map<string, "override" | "wiki">>();
    if (detailIds.length > 0) {
        for (const zeile of await database<(Record<string, string | null> & { id: string })[]>`
            SELECT d.*, d.id::text AS id FROM territory_detail d WHERE d.id = ANY(${detailIds}::bigint[])
        `)
            werte.set(zeile.id, zeile);
        for (const zeile of await database<{ id: string; field: string; origin: "override" | "wiki" }[]>`
            SELECT territory_detail_id::text AS id, field, origin FROM territory_detail_field_origin
             WHERE territory_detail_id = ANY(${detailIds}::bigint[])
        `) {
            const jeFeld = herkunft.get(zeile.id) ?? new Map<string, "override" | "wiki">();
            jeFeld.set(zeile.field, zeile.origin);
            herkunft.set(zeile.id, jeFeld);
        }
    }
    return new Map(
        zeilen.map((zeile) => {
            const detail = zeile.detail_id === null ? undefined : werte.get(zeile.detail_id);
            const jeFeld = zeile.detail_id === null ? undefined : herkunft.get(zeile.detail_id);
            return [
                zeile.id,
                {
                    id: zeile.id,
                    name: zeile.name,
                    mapDomainId: zeile.map_domain_id,
                    revision: zeile.revision,
                    aktiv: zeile.is_active,
                    werte: {
                        name: zeile.name,
                        shortName: zeile.short_name,
                        type: zeile.territory_type,
                        status: zeile.status_text,
                        capital: zeile.capital,
                        parent: zeile.parent,
                        color: zeile.color.toLowerCase(),
                        minZoom: zeile.min_zoom,
                        maxZoom: zeile.max_zoom,
                    },
                    details: Object.fromEntries(
                        EDITOR_TERRITORY_DETAIL_FIELDS.map((feld) => {
                            const origin = jeFeld?.get(feld);
                            return [
                                feld,
                                {
                                    wert: detail?.[feld] ?? null,
                                    herkunft: origin === undefined ? null : origin === "wiki" ? "wiki" : "manual",
                                },
                            ];
                        }),
                    ) as GebietIst["details"],
                },
            ] as const;
        }),
    );
}

const gleichWert = (a: unknown, b: unknown): boolean =>
    typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : leer(a) === leer(b);

/** Die Felder, die heute anders stehen als nach dem letzten Mitglied (Namen des Protokolls). */
function abweichendeFelder(plan: GebietPlan, ist: GebietIst): string[] {
    const abweichend: string[] = [];
    for (const ziel of plan.felder.values()) {
        if (!BEKANNT.has(ziel.feld) || ziel.feld === "parentOrigin") continue;
        const heute = istDetail(ziel.feld) ? ist.details[ziel.feld].wert : ist.werte[ziel.feld as Feld];
        // Ein Name oder eine Farbe vergleicht ohne Rücksicht auf die Schreibweise der Farbe; ein leeres Feld ist `null`.
        if (!gleichWert(heute, ziel.nachher)) abweichend.push(ziel.feld);
    }
    for (const [feld, ziel] of plan.herkunft)
        if (
            istDetail(feld) &&
            (ist.details[feld].herkunft ?? null) !== (ziel.nachher ?? null) &&
            !abweichend.includes(feld)
        )
            abweichend.push(feld);
    return abweichend;
}

// --- Die Flächen: Form und Anlegen (WI-0265 B8b) -------------------------------------------------------------------------------

/** Was die Mitglieder an EINER Fläche taten: angelegt, ihre Form geändert (alle Ringe) oder Ecken mitgezogen (nur Punkte, ohne Ring- und Eckenindex). */
interface FlaechenPlan {
    id: string;
    /** Das Gebiet der Fläche (öffentliche Kennung) und sein Name, wie das Protokoll sie nennt. */
    gebiet?: string;
    name?: string;
    angelegt: boolean;
    /** Die Form vor dem ersten und nach dem letzten Mitglied, das sie änderte. */
    form?: { vorher: unknown; nachher: unknown };
    mitgezogen: { vorher: Punkt[]; nachher: Punkt[] }[];
}

const alsPunkte = (wert: unknown): Punkt[] =>
    Array.isArray(wert) ? (wert as number[][]).map(([x, y]) => [x!, y!] as const) : [];
const alsPolygone = (wert: unknown): Punkt[][][] =>
    ((wert ?? []) as number[][][][]).map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x!, y!] as const)));

/** Die Flächen der Mitglieder in der Folge der Serie. Die Einträge brauchen die volle Nutzlast. */
function planFlaechen(eintraege: readonly MapHistoryEntry[]): Map<string, FlaechenPlan> {
    const plan = new Map<string, FlaechenPlan>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq))
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "territory_area") continue;
            if (gegenstand.action !== "territory_area.created" && !FORM_AKTIONEN.has(gegenstand.action)) continue;
            let flaeche = plan.get(gegenstand.id);
            if (flaeche === undefined) {
                flaeche = { id: gegenstand.id, angelegt: false, mitgezogen: [] };
                plan.set(gegenstand.id, flaeche);
            }
            if (gegenstand.territory !== undefined) {
                flaeche.gebiet ??= gegenstand.territory.id;
                if (gegenstand.territory.name !== undefined) flaeche.name ??= gegenstand.territory.name;
            }
            const wechsel = gegenstand.changes["geometry"];
            if (gegenstand.action === "territory_area.created") flaeche.angelegt = true;
            else if (gegenstand.action === "territory_area.carried")
                flaeche.mitgezogen.push({ vorher: alsPunkte(wechsel?.before), nachher: alsPunkte(wechsel?.after) });
            else if (wechsel !== undefined) {
                if (flaeche.form === undefined) flaeche.form = { vorher: wechsel.before, nachher: wechsel.after };
                else flaeche.form.nachher = wechsel.after;
            }
        }
    return plan;
}

/** Die Gebiete, die diese Mitglieder angelegt haben (Aktion `territory.created` einer Operation `territory.create`), mit ihrem Namen. */
function angelegteGebiete(eintraege: readonly MapHistoryEntry[]): Map<string, string | undefined> {
    const gebiete = new Map<string, string | undefined>();
    for (const eintrag of eintraege)
        if (eintrag.operation === "territory.create")
            for (const gegenstand of eintrag.objects)
                if (gegenstand.kind === "territory" && gegenstand.action === "territory.created")
                    gebiete.set(gegenstand.id, gegenstand.name);
    return gebiete;
}

/** Eine Fläche, wie sie heute steht. */
interface FlaecheIst {
    id: string;
    pk: string;
    gebiet: string;
    gebietName: string;
    aktiv: boolean;
    revision: number;
    form: Punkt[][][];
}

async function leseFlaechenIst(database: Queryable, ids: readonly string[]): Promise<Map<string, FlaecheIst>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<
        {
            id: string;
            pk: string;
            gebiet: string;
            gebiet_name: string;
            aktiv: boolean;
            revision: number;
            geojson: string;
        }[]
    >`
        SELECT a.public_id::text AS id, a.id::text AS pk, t.public_id::text AS gebiet, t.name AS gebiet_name, a.is_active AS aktiv,
               a.revision::int AS revision, ST_AsGeoJSON(a.geom, 15) AS geojson
          FROM territory_area a JOIN territory t ON t.id = a.territory_id
         WHERE a.public_id = ANY(${ids as string[]}::uuid[])
    `;
    return new Map(
        zeilen.map((zeile) => [
            zeile.id,
            {
                id: zeile.id,
                pk: zeile.pk,
                gebiet: zeile.gebiet,
                gebietName: zeile.gebiet_name,
                aktiv: zeile.aktiv,
                revision: zeile.revision,
                form: polygoneVon(zeile.geojson),
            },
        ]),
    );
}

/**
 * Die Konflikte der Flächen: Eine Fläche, die zurück soll, gibt es nicht mehr (die Flächen eines angelegten Gebiets sind davon ausgenommen), und die mitgezogenen Ecken einer
 * Nachbarfläche liegen nicht mehr genau einmal an ihrer Stelle (`flaeche_nachbar`, wie in der Derographie; ganz oder gar nicht). Eine eigene Fläche prüft der Kern über ihre Revision.
 */
async function konflikteFlaechen(
    database: Queryable,
    plan: ReadonlyMap<string, FlaechenPlan>,
    angelegt: ReadonlyMap<string, string | undefined>,
): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    const ist = await leseFlaechenIst(database, [...plan.keys()]);
    for (const flaeche of plan.values()) {
        if (flaeche.gebiet !== undefined && angelegt.has(flaeche.gebiet)) continue;
        const heute = ist.get(flaeche.id);
        const name = flaeche.name === undefined ? {} : { name: flaeche.name };
        if (heute === undefined || (!heute.aktiv && !flaeche.angelegt)) {
            konflikte.push({ art: "geloescht", kind: "territory_area", id: flaeche.id, ...name });
            continue;
        }
        // Altbestand: Trägt der Eintrag der Form die Ringe davor nicht (ältere Protokolle), lässt sie sich nicht wieder setzen; die Rücknahme bleibt aus, ehrlich mit dem Feld.
        if (
            flaeche.form !== undefined &&
            flaeche.mitgezogen.length === 0 &&
            alsPolygone(flaeche.form.vorher).length === 0
        )
            konflikte.push({
                art: "wert",
                kind: "territory_area",
                id: flaeche.id,
                ...name,
                currentRevision: heute.revision,
                felder: ["geometry"],
                abweichung: { was: "felder" },
                detail: "Die Form vor diesem Schritt steht im Protokoll nicht; sie lässt sich nicht wieder setzen.",
            });
        if (flaeche.mitgezogen.length === 0) continue;
        const geht =
            flaeche.mitgezogen.length === 1 &&
            flaeche.form === undefined &&
            eckenZurueck(heute.form, flaeche.mitgezogen[0]!.vorher, flaeche.mitgezogen[0]!.nachher) !== undefined;
        if (!geht)
            konflikte.push({
                art: "wert",
                kind: "territory_area",
                id: flaeche.id,
                ...name,
                currentRevision: heute.revision,
                felder: ["geometry"],
                abweichung: { was: "flaeche_nachbar" },
                detail: "Die mitgezogenen Ecken der Nachbarfläche liegen nicht mehr genau an ihrer Stelle.",
            });
    }
    return konflikte;
}

/**
 * Die Konflikte eines angelegten Gebiets: Es gibt es nicht mehr, oder seither hängt ein aktives Untergebiet daran (das Protokoll des Untergebiets nennt das Obergebiet nicht als
 * Gegenstand, der Kern sieht es also nicht). Stilllegen ließe es ohne Obergebiet zurück.
 */
async function konflikteAngelegt(
    database: Queryable,
    angelegt: ReadonlyMap<string, string | undefined>,
): Promise<VorKonflikt[]> {
    if (angelegt.size === 0) return [];
    const konflikte: VorKonflikt[] = [];
    const ids = [...angelegt.keys()];
    const ist = await leseIst(database, ids);
    for (const id of ids) {
        const heute = ist.get(id);
        const name = angelegt.get(id) === undefined ? {} : { name: angelegt.get(id)! };
        if (heute === undefined || !heute.aktiv) konflikte.push({ art: "geloescht", kind: "territory", id, ...name });
    }
    const kinder = await database<{ id: string; name: string; revision: number; eltern_name: string }[]>`
        SELECT c.public_id::text AS id, c.name, c.revision::int AS revision, p.name AS eltern_name
          FROM territory c JOIN territory p ON p.id = c.parent_id
         WHERE p.public_id = ANY(${ids}::uuid[]) AND c.is_active
         ORDER BY c.public_id
    `;
    for (const kind of kinder)
        konflikte.push({
            art: "wert",
            kind: "territory",
            id: kind.id,
            name: kind.name,
            currentRevision: kind.revision,
            felder: ["parent"],
            abweichung: { was: "felder" },
            detail: `Seither hängt „${kind.name}“ unter „${kind.eltern_name}“; das Gebiet lässt sich so nicht stilllegen.`,
        });
    return konflikte;
}

/** Der Adapter des Gebiets für `vorpruefen` (siehe Kopf der Datei). */
export const GEBIET_ADAPTER: RuecknahmeAdapter = {
    familie: "gebiet",
    // Das Recht der Vorwärtsoperation (seit WI-0279 die Fachrechte der Gebiete): Felder und Darstellung verlangen `edit_territories` (`PATCH …/:id`, `POST …/display`, `…/sammel`); Entfernen, „Unter neues Obergebiet …“ und
    // Vereinigen sind Geometrie der Karte und verlangen zusätzlich `edit_map_geometry` (`POST …/retire`, `…/restore`).
    // Die Quellen verlangen `manage_sources` (`POST …/inhalte/traeger/territory/:id/quellen`); eine Rücknahme von Feldern und Quellen verlangt beide Rechte.
    recht(operation, aktionen) {
        const art = artVon(operation, aktionen);
        if (art === "entfernen") return "edit_territory_form";
        if (art === "quellen") return "manage_sources";
        // Anlegen und die Form haben Lage: Die Route legt beide Rechte fest (`POST …/territories`, `…/areas`, `PATCH …/:id` mit `areas`).
        if (art === "anlegen" || art === "grenze") return ["edit_territories", "edit_territory_form"];
        const form = aktionen.some((aktion) => FORM_AKTIONEN.has(aktion));
        const rechte: Capability[] = ["edit_territories", ...(form ? (["edit_territory_form"] as const) : [])];
        if (traegtQuellen("territory", aktionen)) rechte.push("manage_sources");
        return rechte.length === 1 ? rechte[0]! : rechte;
    },
    pruefeArt: (operation, aktionen) =>
        artVon(operation, aktionen) === undefined ? { ok: false, reason: "art" } : { ok: true },
    pruefeListe(offen) {
        // Mehrere Mitglieder sind eine Arbeitsserie (ein Gegenstand): Felder, Darstellung, Form, Quellen, das Anlegen und ein Entfernen oder Vereinigen, das nur dieses Gebiet berührte (WI-0265 B8b2).
        // „Unter neues Obergebiet …“ und das Zurückholen gehen allein (sie berühren mehrere Gebiete, und das Zurückholen ist selbst eine Rücknahme).
        const verworfen = new Map<string, "art">();
        if (offen.length <= 1) return verworfen;
        for (const mitglied of offen) {
            const art = artDes(mitglied);
            const entfernenInSerie = art === "entfernen" && SERIEN_ENTFERNEN.has(mitglied.operation);
            if (art !== "felder" && art !== "quellen" && art !== "anlegen" && art !== "grenze" && !entfernenInSerie)
                verworfen.set(mitglied.operationId, "art");
        }
        return verworfen;
    },
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const alle = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((m) => m.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries;
        // Die Mitglieder der Art „Entfernen“ tragen Felder mit, wenn sie eine Rücknahme von Feldern UND eines Stilllegens sind (WI-0265 B8b2): Diese Felder prüft derselbe Vergleich der Werte.
        const umkehrGebiete = new Set(
            alle
                .filter((eintrag) => artDesEintrags(eintrag) === "entfernen")
                .flatMap((eintrag) => eintrag.objects.flatMap((g) => (g.kind === "territory" ? [g.id] : []))),
        );
        const eintraege = [
            ...alle.filter((eintrag) => artDesEintrags(eintrag) === "felder"),
            ...alle
                .filter((eintrag) => artDesEintrags(eintrag) === "entfernen")
                .map(nurFelder)
                .filter((eintrag) => eintrag.objects.length > 0),
        ];
        // Anlegen (WI-0265 B8b): Das angelegte Gebiet geht still, samt seiner Fläche; was die Serie sonst daran änderte, braucht keine Inverse.
        const angelegt = angelegteGebiete(alle);
        const konflikte: VorKonflikt[] = [...(await konflikteAngelegt(database, angelegt))];
        // Die Form: eigene Flächen über ihre Revision (Kern), die mitgezogenen Ecken der Nachbarn hier.
        konflikte.push(
            ...(await konflikteFlaechen(
                database,
                planFlaechen(alle.filter((eintrag) => artDesEintrags(eintrag) !== "entfernen")),
                angelegt,
            )),
        );
        // Die Quellen des Gebiets: Jede Verknüpfung steht heute so, wie die Serie sie hinterließ, und ihr Ziel gibt es noch (nicht an einem angelegten Gebiet: Es geht samt ihnen still).
        if (angelegt.size === 0)
            konflikte.push(...konflikteAmTraeger(await pruefeQuellen(database, planAusTraeger(alle, "territory"))));
        if (eintraege.length === 0 || angelegt.size > 0) return konflikte;
        const plan = planAusEintraegen(eintraege);
        const ist = await leseIst(database, [...plan.keys()]);
        for (const [id, gebiet] of plan) {
            const heute = ist.get(id);
            const name = gebiet.name === undefined ? {} : { name: gebiet.name };
            // Ein Gebiet, dessen Stand die Mitglieder selbst wechselten (Stilllegen, Zurückholen), ist nicht „gelöscht“: Der Kern prüft seine Revision.
            if (heute === undefined || (!heute.aktiv && !umkehrGebiete.has(id))) {
                konflikte.push({ art: "geloescht", kind: "territory", id, ...name });
                continue;
            }
            const abweichend = abweichendeFelder(gebiet, heute);
            if (abweichend.length > 0) {
                konflikte.push({
                    art: "wert",
                    kind: "territory",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: abweichend,
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`,
                });
                continue;
            }
            // Die Ziele, auf die die Rücknahme zurückgeht, müssen es noch geben: das Obergebiet (und kein Kreis), die Hauptstadt.
            const ziele: { feld: string; fehler: string }[] = [];
            const elternZiel = gebiet.felder.get("parent")?.vorher;
            if (typeof elternZiel === "string" && elternZiel !== heute.werte.parent) {
                try {
                    await pruefeObergebiet(database, id, heute.mapDomainId, elternZiel);
                } catch (fehler) {
                    if (!(fehler instanceof ApiError)) throw fehler;
                    ziele.push({ feld: "parent", fehler: fehler.message });
                }
            }
            const hauptstadt = gebiet.felder.get("capital")?.vorher;
            if (typeof hauptstadt === "string" && hauptstadt !== heute.werte.capital) {
                const [ort] = await database<{ da: boolean }[]>`
                    SELECT EXISTS (SELECT 1 FROM place WHERE public_id = ${hauptstadt}::uuid AND is_active)
                        OR EXISTS (SELECT 1 FROM place_unplaced WHERE public_id = ${hauptstadt}::uuid AND is_active) AS da
                `;
                if (ort?.da !== true) ziele.push({ feld: "capital", fehler: "Diesen Ort gibt es nicht." });
            }
            if (ziele.length > 0)
                konflikte.push({
                    art: "wert",
                    kind: "territory",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: ziele.map((ziel) => ziel.feld),
                    abweichung: { was: "felder" },
                    detail: ziele.map((ziel) => ziel.fehler).join(" "),
                });
        }
        return konflikte;
    },
};

const familieVon = (gebietId: string, mapDomainId: string): RuecknahmeFamilie => ({
    operation: RUECKNAHME_GEBIET_OPERATION,
    scope: `territory:${gebietId}`,
    adapter: GEBIET_ADAPTER,
    mapDomainId,
    // Nur Quellen gehen über die Naht der Inhalte wie das Original; mit Feldern über die der Karte.
    naht: nahtDerQuellen,
});

/** Die Karte des Gebiets (auch eines stillgelegten: Der Verlauf holt es zurück); 404, wenn es keine Zeile dazu gibt. */
async function domainVon(database: Queryable, gebietId: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM territory WHERE public_id = ${gebietId}::uuid
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
    return zeile.map_domain_id;
}

/** `POST …/restore-series/preview` am Gebiet: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauGebiet(
    database: Database,
    gebietId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const domain = await domainVon(database, gebietId);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: domain, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(gebietId, domain),
    );
    // Ein Gebiet geht nicht ins Gelände; die abgeleiteten Flächen (`territory_derive`) rechnet die Schreibnaht nach.
    return {
        ...vor,
        folgen: { gegenstaende: vor.gegenstaende.filter((g) => g.kind === "territory").length, gelaende: "keines" },
    } as RuecknahmePruefung;
}

/** Die Zeilen der Gebiete und ihrer Flächen in fester Reihenfolge sperren (`FOR NO KEY UPDATE`, wie die übrigen Schreibwege; die laufende Ableitung hält `FOR KEY SHARE`). */
async function sperreGebiete(
    tx: Queryable,
    vorab: { gegenstaende: readonly { kind: string; id: string }[] },
): Promise<void> {
    const gebiete = [...new Set(vorab.gegenstaende.filter((g) => g.kind === "territory").map((g) => g.id))].sort();
    const flaechen = [
        ...new Set(vorab.gegenstaende.filter((g) => g.kind === "territory_area").map((g) => g.id)),
    ].sort();
    if (gebiete.length > 0)
        await tx`SELECT id FROM territory WHERE public_id = ANY(${gebiete}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
    if (flaechen.length > 0)
        await tx`SELECT id FROM territory_area WHERE public_id = ANY(${flaechen}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

/** Der Grund steht an jedem Eintrag der Rücknahme, der ein Gebiet oder eine Fläche nennt (Positivliste `territory`, `territory_area`). */
const mitGrund = (entry: MapAuditEntry, grund: string | undefined): MapAuditEntry =>
    grund === undefined ? entry : { ...entry, changes: { ...entry.changes, restoreReason: { after: grund } } };

const nichtRuecknehmbar = (feld?: string): ApiError =>
    new ApiError(400, "not_revertable", "Diese Änderung am Gebiet lässt sich nicht zurücknehmen.", {
        reason: "art",
        ...(feld !== undefined ? { field: feld } : {}),
    });

/** Die Felder und Detailfelder, wie `territory.update` sie nimmt: der Wert VOR der Serie; was heute schon so steht, lässt `schreibeFelder` aus. */
function aenderungAus(plan: GebietPlan, ist: GebietIst): TerritoryUpdateChanges {
    const changes: { -readonly [K in keyof TerritoryUpdateChanges]: TerritoryUpdateChanges[K] } = {};
    const details: { -readonly [K in EditorTerritoryDetailField]?: NonNullable<TerritoryDetailChanges[K]> } = {};
    for (const ziel of plan.felder.values()) {
        const { feld, vorher } = ziel;
        if (!BEKANNT.has(feld)) throw nichtRuecknehmbar(feld);
        if ((DARSTELLUNG as readonly string[]).includes(feld)) continue;
        if (feld === "name") {
            // Ein Gebiet braucht einen Namen: War er vorher leer, gibt es nichts, wohin er zurückgehen könnte.
            if (typeof vorher !== "string" || vorher.trim() === "") throw nichtRuecknehmbar(feld);
            changes.name = vorher;
        } else if (feld === "shortName" || feld === "type" || feld === "status")
            changes[feld] = typeof vorher === "string" ? vorher : "";
        else if (feld === "capital" || feld === "parent") changes[feld] = typeof vorher === "string" ? vorher : "";
        else if (istDetail(feld)) {
            // Wie im Verlauf (`wikiRuecknahme`): Folgte der Wert vorher dem Wiki, kommt er als Wiki-Wert zurück, sonst als eigener Wert; ein Feld ohne Wert und Vermerk als „kein Wert“.
            const herkunft = plan.herkunft.get(feld)?.vorher;
            details[feld] =
                herkunft === "wiki" ? { revert: "wiki" } : { value: typeof vorher === "string" ? vorher : null };
        }
    }
    // Hat die Serie nur die Herkunft eines Detailfelds geändert (↺ auf den gleichen Wiki-Wert), holt die Rücknahme die Herkunft davor zurück: war es der Wiki-Wert, wieder als Wiki-Wert,
    // war es ein eigener, der heutige Wert als eigener.
    for (const [feld, ziel] of plan.herkunft) {
        if (!istDetail(feld) || details[feld] !== undefined) continue;
        if (ziel.vorher === "wiki") details[feld] = { revert: "wiki" };
        else if (ziel.vorher === "manual") details[feld] = { value: ist.details[feld].wert };
    }
    if (Object.keys(details).length > 0) changes.details = details;
    return changes;
}

/** Farbe und Zoomspanne davor; `undefined`, wenn die Serie keine von beiden berührt. Die ganze Spanne davor: was die Serie nicht änderte, gilt heute wie damals. */
function darstellungAus(
    plan: GebietPlan,
    ist: GebietIst,
): { color?: string; zoom?: { minZoom?: number; maxZoom?: number } } | undefined {
    const farbe = plan.felder.get("color")?.vorher;
    const min = plan.felder.get("minZoom");
    const max = plan.felder.get("maxZoom");
    if (farbe === undefined && min === undefined && max === undefined) return undefined;
    const ergebnis: { color?: string; zoom?: { minZoom?: number; maxZoom?: number } } = {};
    if (typeof farbe === "string") ergebnis.color = farbe.toLowerCase();
    if (min !== undefined || max !== undefined) {
        const grenze = (ziel: FeldZiel | undefined, heute: unknown): number | null => {
            const wert = ziel === undefined ? heute : ziel.vorher;
            return typeof wert === "number" ? wert : null;
        };
        const von = grenze(min, ist.werte.minZoom);
        const bis = grenze(max, ist.werte.maxZoom);
        ergebnis.zoom = { ...(von === null ? {} : { minZoom: von }), ...(bis === null ? {} : { maxZoom: bis }) };
    }
    return ergebnis;
}

/** Felder und Darstellung: die Werte vor dem ersten Mitglied je Gebiet, in der Reihenfolge der Kennungen, alle in EINER Operation. */
async function schreibeFelderUndDarstellung(
    tx: RuecknahmeSchreiben["tx"],
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
    /** Nur diese Gebiete (WI-0265 B8b2): Ein Gebiet, das die Rücknahme selbst stilllegt oder zurückholt, bekommt seine Felder, solange es aktiv ist (der Schreibweg der Felder liest nur aktive). */
    nur?: ReadonlySet<string>,
): Promise<SchreibErgebnis> {
    const plan = planAusEintraegen(eintraege);
    const ids = [...plan.keys()].filter((id) => nur === undefined || nur.has(id)).sort();
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    for (const id of ids) {
        const gebiet = plan.get(id)!;
        const ist = (await leseIst(tx, [id])).get(id);
        if (ist === undefined || !ist.aktiv)
            throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
        const felder = aenderungAus(gebiet, ist);
        const darstellung = darstellungAus(gebiet, ist);
        let revision = ist.revision;
        let name = ist.name;
        let bewegt = false;
        if (Object.keys(felder).length > 0) {
            const geschrieben = await schreibeFelder(tx, id, revision, felder);
            for (const objekt of geschrieben.affected) affected.set(`${objekt.kind}:${objekt.id}`, objekt);
            entries.push(...geschrieben.entries);
            name = geschrieben.name;
            revision = geschrieben.affected.find((objekt) => objekt.id === id)?.revision ?? revision;
            bewegt ||= geschrieben.entries.length > 0;
        }
        if (darstellung !== undefined) {
            const jetzt = (await leseGebiete(tx, [id])).get(id)!;
            const geschrieben = await schreibeDarstellung(
                tx,
                {
                    id,
                    baseRevision: revision,
                    ...(darstellung.zoom === undefined ? {} : { zoom: darstellung.zoom }),
                    ...(darstellung.color === undefined ? {} : { color: darstellung.color }),
                },
                jetzt,
            );
            if (geschrieben !== undefined) {
                for (const objekt of geschrieben.affected) affected.set(`${objekt.kind}:${objekt.id}`, objekt);
                entries.push(...geschrieben.entries);
                bewegt = true;
            }
        }
        if (bewegt) namen.push(name);
    }
    // Ändert die Rücknahme nur Farben, geht sie in kein abgeleitetes Ergebnis ein (wie `territory.display`).
    const nurFarbe = entries.every((eintrag) => Object.keys(eintrag.changes ?? {}).every((feld) => feld === "color"));
    const satz =
        namen.length > 3 ? `${namen.slice(0, 3).join(", ")} und ${String(namen.length - 3)} weitere` : namen.join(", ");
    return {
        receipt: { affected: [...affected.values()], derivedWork: [], warnings: [] },
        summary:
            namen.length === 0
                ? `${String(eintraege.length)} Änderungen am Gebiet zurückgenommen`
                : `${satz}: ${eintraege.length === 1 ? "Änderung" : `${String(eintraege.length)} Änderungen`} zurückgenommen`,
        entries: entries.map((eintrag) => mitGrund(eintrag, grund)),
        ...(nurFarbe ? { ableitung: false as const } : {}),
    };
}

/** Entfernen, „Unter neues Obergebiet …“ und Vereinigen: derselbe Schreibweg wie `territory.restore`, in der Transaktion der Rücknahme. */
async function schreibeEntfernenZurueck(
    tx: RuecknahmeSchreiben["tx"],
    actor: MapActor,
    gebietId: string,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const { op, zeilen } = await leseEntfernenProtokoll(tx, eintrag.operationId);
    if (op === undefined || !UMKEHR_OPERATIONEN.has(op.action)) throw nichtRuecknehmbar();
    const ergebnis = await kehreEntfernenUm(tx, actor, gebietId, op, zeilen);
    return { ...ergebnis, entries: ergebnis.entries.map((entry) => mitGrund(entry, grund)) };
}

const konfliktRevision = (): ApiError =>
    new ApiError(
        409,
        "edit_conflict",
        "Seit diesen Änderungen hat sich etwas geändert. Die Rücknahme würde das überschreiben.",
    );

const namenSatz = (namen: readonly string[]): string =>
    namen.length > 3 ? `${namen.slice(0, 3).join(", ")} und ${String(namen.length - 3)} weitere` : namen.join(", ");

/**
 * Die Flächen zurück (WI-0265 B8b): Eine angelegte Fläche geht still (`territory_area.retired`), eine geformte bekommt ihre Form vor dem ersten Mitglied (`territory_area.reshaped`, die Ringe
 * stehen vollständig im Protokoll), die mitgezogenen Ecken einer Nachbarfläche gehen an ihre alte Stelle (`territory_area.carried`, wie die Derographie: jede Ecke liegt genau einmal an ihrer
 * Stelle). Der Schreibweg der Form ist der des Vorwärtswegs: Revision gegen die heutige, die Ableitung rechnet die Schreibnaht nach. `undefined`, wenn es keine Fläche zu schreiben gibt.
 */
async function schreibeFlaechenZurueck(
    tx: RuecknahmeSchreiben["tx"],
    plan: ReadonlyMap<string, FlaechenPlan>,
    grund: string | undefined,
): Promise<SchreibErgebnis | undefined> {
    if (plan.size === 0) return undefined;
    const ist = await leseFlaechenIst(tx, [...plan.keys()]);
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    const entries: MapAuditEntry[] = [];
    const namen = new Set<string>();
    for (const id of [...plan.keys()].sort()) {
        const flaeche = plan.get(id)!;
        const heute = ist.get(id);
        if (heute === undefined) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht mehr.");
        const merke = (revision: number): void => {
            affected.set(`${GEBIETSFLAECHE_ART}:${id}`, { kind: GEBIETSFLAECHE_ART, id, revision });
            namen.add(heute.gebietName);
        };
        if (flaeche.angelegt) {
            if (!heute.aktiv) continue;
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE territory_area SET is_active = FALSE WHERE id = ${heute.pk}::bigint AND revision = ${heute.revision}
                RETURNING revision::int AS revision
            `;
            if (neu === undefined) throw konfliktRevision();
            merke(neu.revision);
            entries.push({
                action: "territory_area.retired",
                territoryId: heute.gebiet,
                territoryAreaId: id,
                revisionBefore: heute.revision,
                revisionAfter: neu.revision,
                changes: { active: { before: true, after: false } },
            });
            continue;
        }
        if (!heute.aktiv) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht mehr.");
        let ziel: Punkt[][][];
        let aktion: "territory_area.reshaped" | "territory_area.carried";
        let davor: unknown;
        let danach: unknown;
        if (flaeche.mitgezogen.length > 0) {
            // Genau eine mitziehende Operation, keine eigene Form daneben, jede Ecke genau einmal an ihrer Stelle (die Vorprüfung sagt es; hier noch einmal unter der Sperre).
            const zurueck =
                flaeche.mitgezogen.length === 1 && flaeche.form === undefined
                    ? eckenZurueck(heute.form, flaeche.mitgezogen[0]!.vorher, flaeche.mitgezogen[0]!.nachher)
                    : undefined;
            if (zurueck === undefined) throw konfliktRevision();
            ziel = zurueck;
            aktion = "territory_area.carried";
            davor = flaeche.mitgezogen[0]!.nachher.map((punkt) => [...punkt]);
            danach = flaeche.mitgezogen[0]!.vorher.map((punkt) => [...punkt]);
        } else if (flaeche.form !== undefined) {
            ziel = alsPolygone(flaeche.form.vorher);
            if (ziel.length === 0 || ziel.some((polygon) => polygon.some((ring) => ring.length < 3)))
                throw nichtRuecknehmbar("geometry");
            // Steht sie schon so da, schreibt die Rücknahme sie nicht (Revision und Ableitung bleiben).
            if (gleicheForm(heute.form, ziel)) continue;
            aktion = "territory_area.reshaped";
            davor = ringe(heute.form);
            danach = ringe(ziel);
        } else continue;
        const [neu] = await tx<{ revision: number }[]>`
            UPDATE territory_area SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(ziel)}), 0))
             WHERE id = ${heute.pk}::bigint AND revision = ${heute.revision}
            RETURNING revision::int AS revision
        `;
        if (neu === undefined) throw konfliktRevision();
        merke(neu.revision);
        entries.push({
            action: aktion,
            territoryId: heute.gebiet,
            territoryAreaId: id,
            revisionBefore: heute.revision,
            revisionAfter: neu.revision,
            changes: { geometry: { before: davor, after: danach } },
        });
    }
    if (entries.length === 0) return undefined;
    return {
        receipt: { affected: [...affected.values()], derivedWork: [], warnings: [] },
        summary: `${namenSatz([...namen])}: Grenzen zurückgenommen`,
        entries: entries.map((eintrag) => mitGrund(eintrag, grund)),
    };
}

/**
 * Die angelegten Gebiete still (WI-0265 B8b): erst ihre aktiven Flächen (die Fläche, die das Anlegen mitbrachte, ist schon still; jede andere, die seither dazukam, geht mit, denn auch
 * sie gehört der Serie), dann das Gebiet selbst, wenn kein aktives Untergebiet mehr daran hängt. Derselbe Weg wie Entfernen (`territory.retired`).
 */
async function schreibeGebieteStill(
    tx: RuecknahmeSchreiben["tx"],
    angelegt: ReadonlyMap<string, string | undefined>,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    const entries: MapAuditEntry[] = [];
    const namen: string[] = [];
    const ids = [...angelegt.keys()].sort();
    const ist = await leseIst(tx, ids);
    for (const id of ids) {
        const heute = ist.get(id);
        if (heute === undefined) throw konfliktRevision();
        // Schon still (die Serie legte es selbst still, etwa mit „Entfernen“): Es bleibt, wie es ist (WI-0265 B8b2).
        if (!heute.aktiv) continue;
        const flaechen = await tx<{ id: string; public_id: string; revision: number }[]>`
            SELECT a.id::text AS id, a.public_id::text AS public_id, a.revision::int AS revision
              FROM territory_area a JOIN territory t ON t.id = a.territory_id
             WHERE t.public_id = ${id}::uuid AND a.is_active ORDER BY a.id FOR NO KEY UPDATE OF a
        `;
        for (const flaeche of flaechen) {
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE territory_area SET is_active = FALSE WHERE id = ${flaeche.id}::bigint RETURNING revision::int AS revision
            `;
            affected.set(`${GEBIETSFLAECHE_ART}:${flaeche.public_id}`, {
                kind: GEBIETSFLAECHE_ART,
                id: flaeche.public_id,
                revision: neu!.revision,
            });
            entries.push({
                action: "territory_area.retired",
                territoryId: id,
                territoryAreaId: flaeche.public_id,
                revisionBefore: flaeche.revision,
                revisionAfter: neu!.revision,
                changes: { active: { before: true, after: false } },
            });
        }
        const [still] = await tx<{ revision: number }[]>`
            UPDATE territory SET is_active = FALSE
             WHERE public_id = ${id}::uuid AND is_active AND revision = ${heute.revision}
               AND NOT EXISTS (SELECT 1 FROM territory c WHERE c.parent_id = territory.id AND c.is_active)
            RETURNING revision::int AS revision
        `;
        if (still === undefined) throw konfliktRevision();
        affected.set(`${GEBIET_ART}:${id}`, { kind: GEBIET_ART, id, revision: still.revision });
        entries.push({
            action: "territory.retired",
            territoryId: id,
            revisionBefore: heute.revision,
            revisionAfter: still.revision,
            changes: { active: { before: true, after: false } },
        });
        namen.push(heute.name);
    }
    return {
        receipt: { affected: [...affected.values()], derivedWork: [], warnings: [] },
        summary: `${namenSatz(namen)}: Anlegen zurückgenommen`,
        entries: entries.map((eintrag) => mitGrund(eintrag, grund)),
    };
}

/** Zwei Ergebnisse in einer Operation: die Quittung ohne Doppelte, die Einträge hintereinander; die Ableitung entfällt nur, wenn beide sie nicht brauchen. */
function vereine(a: SchreibErgebnis | undefined, b: SchreibErgebnis | undefined): SchreibErgebnis | undefined {
    if (a === undefined) return b;
    if (b === undefined) return a;
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    for (const eines of [...a.receipt.affected, ...b.receipt.affected])
        affected.set(`${eines.kind}:${eines.id}`, eines);
    const ohneAbleitung = a.ableitung === false && b.ableitung === false;
    return {
        receipt: { ...a.receipt, affected: [...affected.values()] },
        summary: a.summary ?? b.summary ?? "",
        entries: [...a.entries, ...b.entries],
        ...(ohneAbleitung ? { ableitung: false as const } : {}),
    };
}

/**
 * `POST …/restore-series` am Gebiet: nimmt die Mitglieder (Felder und Darstellung einer Serie, oder EIN Entfernen, „Unter neues Obergebiet …“, Vereinigen) in EINER Operation zurück
 * (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was das Gebiet ausmacht: die Fremdsperre der Gebiete, die Sperre der Zeilen und die Inverse je Art.
 */
export async function ruecknehmenGebiet(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    gebietId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const domain = await domainVon(database, gebietId);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieVon(gebietId, domain),
        body,
        haken: {
            pruefeFremdeSperre: (db, akteur, scopes) =>
                pruefeFremdeGebietssperre(
                    db,
                    akteur,
                    [...scopes]
                        .filter((scope) => scope.startsWith("territory:"))
                        .map((scope) => scope.slice("territory:".length)),
                ),
            async sperreZeilen(tx, vorab) {
                await sperreGebiete(tx, vorab);
                if (hatQuellen(vorab, "territory"))
                    await sperreQuellen(
                        tx,
                        planAusTraeger(
                            (
                                await eintraegeNachKennung(tx, vorab.offen, {
                                    personId: leser.personId,
                                    nutzlast: "voll",
                                })
                            ).entries,
                            "territory",
                        ),
                    );
            },
            async schreibe({ tx, offen, grund }) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                const arten = eintraege.map(artDesEintrags);
                if (arten.includes(undefined)) throw nichtRuecknehmbar();
                // Entfernen, „Unter neues Obergebiet …“, Vereinigen und Zurückholen: derselbe Schreibweg wie `territory.restore`, das jüngste Mitglied zuerst (WI-0265 B8b2: auch in einer Serie).
                const umkehr = eintraege.filter((eintrag) => artDesEintrags(eintrag) === "entfernen");
                // Angelegt in dieser Serie: Gebiet und Flächen gehen still; Felder, Quellen, Formen und Stilllegen davon brauchen keine eigene Inverse (die Serie hat einen Gegenstand).
                const angelegt = angelegteGebiete(eintraege);
                // Felder, Darstellung, Form und Quellen des Gebiets in EINER Operation; eine Rücknahme nur der Quellen schreibt keine Felder. Die Felder eines Mitglieds, das auch ein Stilllegen
                // oder Zurückholen trägt, kommen aus seinem Eintrag ohne Stand und Obergebiet (`nurFelder`). Der Schreibweg der Felder nimmt nur ein aktives Gebiet: Ein Gebiet, das jetzt aktiv ist,
                // bekommt sie vor dem Stand (den danach das Stilllegen übernimmt), ein stilles nach dem Stand (den davor das Zurückholen herstellt).
                const felderEintraege = eintraege.map((eintrag) =>
                    artDesEintrags(eintrag) === "entfernen" ? nurFelder(eintrag) : eintrag,
                );
                const feldIds = [...planAusEintraegen(felderEintraege).keys()];
                const jetzt = await leseIst(tx, feldIds);
                const aktivJetzt = new Set(feldIds.filter((id) => jetzt.get(id)?.aktiv === true));
                const stillJetzt = new Set(feldIds.filter((id) => !aktivJetzt.has(id)));
                const feldAnteil = async (nur: ReadonlySet<string>): Promise<SchreibErgebnis | undefined> =>
                    nur.size === 0 || angelegt.size > 0
                        ? undefined
                        : schreibeFelderUndDarstellung(tx, felderEintraege, grund, nur);
                const felderVorher = await feldAnteil(aktivJetzt);
                // Das jüngste Mitglied zuerst: Ein Entfernen, das eine angelegte Fläche abnahm, geht vor dem Anlegen zurück.
                let stand: SchreibErgebnis | undefined;
                if (angelegt.size === 0)
                    for (const eintrag of [...umkehr].reverse())
                        stand = vereine(stand, await schreibeEntfernenZurueck(tx, actor, gebietId, eintrag, grund));
                const flaechen = await schreibeFlaechenZurueck(
                    tx,
                    planFlaechen(
                        eintraege.filter((eintrag) => !["quellen", "entfernen"].includes(artDesEintrags(eintrag)!)),
                    ),
                    grund,
                );
                // Angelegt in dieser Serie: Gebiet und Flächen gehen still; Felder, Quellen, Formen und Stilllegen davon brauchen keine eigene Inverse (die Serie hat einen Gegenstand).
                if (angelegt.size > 0) return vereine(flaechen, await schreibeGebieteStill(tx, angelegt, grund))!;
                const felderNachher = await feldAnteil(stillJetzt);
                const quellen = await schreibeTraegerQuellenZurueck(tx, eintraege, "territory", grund);
                // Die Einträge stehen in der Folge des Schreibens: Der Kern erwartet als Revision eines Gegenstands die seines letzten Eintrags.
                const zusammen = vereine(vereine(vereine(felderVorher, stand), flaechen), felderNachher);
                const kern =
                    zusammen !== undefined && stand !== undefined
                        ? { ...zusammen, summary: stand.summary ?? zusammen.summary ?? "" }
                        : zusammen;
                if (kern === undefined && quellen === undefined) throw nichtRuecknehmbar();
                return mischeErgebnis(kern, quellen, eintraege.length);
            },
        },
    });
}
