import {
    PATH_EDIT_SUBTYPES,
    PATH_STATE_REVERSE,
    type MapHistoryEntry,
    type MapHistoryObject,
    type OperationReceipt,
    type PathFlowDirection,
    type PathReisenBody,
    type PathUpdateBody,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { derivePathVisualsFor } from "../derive/path-visual.ts";
import { ApiError } from "../http/api-error.ts";
import { resolveTerrainRecipe } from "../terrain/auswahl.ts";
import { fuehreFlussHoehenNach, umgekehrtAusProtokoll, wasserHoehenProtokoll } from "../terrain/fluss-hoehen.ts";
import { istRegional } from "../terrain/hoehenmodell.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor, MapAuditEntry, MapChange } from "./map-operation.ts";
import { schreibeNeuerWegWiederIn, schreibeNeuerWegZurueckIn } from "./path-neuer-weg.ts";
import { pruefeStrassenZuweisung, schreibeStrasseWiederIn, schreibeStrasseZurueckIn } from "./strasse-zuweisen.ts";
import { leseStrasse, schreibeStrasseIn, type AbschnittZeile } from "./path-update.ts";
import { schluesselAusProtokoll } from "./path-weitere.ts";
import { pruefeVerbindenWieder, schreibeVerbindenZurueckIn } from "./path-verbinden.ts";
import {
    legeTeileZusammenIn,
    pruefeSperren,
    rechtFuer,
    schreibeStandIn,
    teileWiederIn,
    wegStand,
    WEG_WECHSEL,
    type WegWechsel,
} from "./path-split.ts";
import {
    fuehreRuecknahmeAus,
    pruefeFamilie,
    type RuecknahmeFamilie,
    type RuecknahmeSchreiben,
    type SchreibErgebnis,
} from "./ruecknahme-ablauf.ts";
import {
    RUECKNAHME_WEG_OPERATION,
    WEG_ANLEGEN_OPERATION,
    WEG_FELDER_OPERATIONEN,
    WEG_KURVE_OPERATIONEN,
    WEG_QUELLEN_OPERATIONEN,
    WEG_STAND_OPERATIONEN,
    WEG_STRASSE_OPERATION,
    WEG_TEILEN_OPERATION,
    WEG_UMGRUPPIEREN_OPERATION,
    WEG_VERBINDEN_OPERATION,
} from "./ruecknahme-arten.ts";
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
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt, VorMitglied, Vorpruefung } from "./ruecknahme.ts";

/**
 * Wege zurücknehmen (WI-0265 B6a und B6a2; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3 „Mehrscope“, F.1, Gate 2 und 3; Testvertrag U4 bis U9): der
 * Adapter des Wegs für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `path.restore_series` (Quelle `restore`, `reverts` = die offenen Mitglieder in
 * Serienfolge, EIN `deriveAfter`; Ablauf, Fehler und Sperren in `ruecknahme-ablauf.ts`). Die Route hängt an EINEM Abschnitt (`:id`), den jedes Mitglied berührt.
 *
 * **Parität mit dem Client-↺ des Wegverlaufs** (`apps/web/src/wegeditor/weg-verlauf.ts`): zurück geht, was dort ging, über denselben Schreibweg wie das Vorwärts („Fertig“,
 * `schreibeStrasseIn`, `schreibeStandIn`), damit Prüfungen, Herkunft und abgeleitete Aufträge dieselben sind. Sechs Arten Mitglied, nach den Protokolleinträgen, nicht nach dem Namen:
 *
 * - **Felder** (`path.update` ohne Kurve, Aktion `path.updated`; mehrere zusammen sind eine Arbeitsserie, wenn jedes nur einen Abschnitt berührt): Name, Wegart, „Name auf der Karte“ und
 *   Kennzeichen gelten der ganzen Straße, Tunnel, Bach, Fließrichtung, Reisemittel und weitere Straßennamen (WI-0302) je Abschnitt. Je Feld der Wert VOR dem ersten Mitglied, das es berührt (C.3); folgte der Wert vorher dem
 *   Wiki, kommt er als `revert: "wiki"` zurück. 🔴 Gegenüber dem Client strenger, weil der Server es weiß: Ein Feld der ganzen Straße geht nur zurück, wenn JEDER Abschnitt der Straße es mit
 *   demselben Wert davor trug (`weg_strasse`), sonst schriebe es auch die Abschnitte um, die die Änderung nie berührte (etwa die einer inzwischen zusammengelegten Straße).
 *   Die Straße ist die von HEUTE, über alle Abschnitte der Mitglieder (`strassenDesPlans`, OPS-000098): Hat ein Mitglied den Namen geleert, ist jeder Abschnitt seither seine eigene Straße;
 *   zurück geht der Name dann an jede dieser Straßen, in derselben Operation, je Straße über den Schreibweg der Straße.
 * - **Stand** (Ganz löschen, Zurückholen, Von der Karte nehmen, Zurück auf die Karte; einzeln, ganze Straße oder Mehrfachauswahl): der Gegenwechsel für genau die Abschnitte der Operation,
 *   wenn er in den Stand von vorher führt (`weg_wert`: ein Weg, der vor „Ganz löschen“ von der Karte genommen war, kommt über keinen Wechsel dorthin zurück).
 * - **Kurve** (`path.update` mit Kurve, früher `path.reshape`; Aktionen `path.reshaped` und `path.carried`): die Linie des Abschnitts, die mitgezogenen Punkte anderer Wege und die Höhen
 *   an Flüssen (`wasserHoehen` im Protokoll, „Höhe wandert mit“, WI-0259) kehren in EINER Operation zurück; Mehrscope: alles oder nichts, jeder Abschnitt gegen seine Revision. Die Kurve
 *   hatte im Client kein ↺; der Auftrag B6a nennt sie ausdrücklich.
 * - **Umgruppieren** („Auswahl zu neuem Weg“, `path.regroup`, Aktion `path.regrouped`): Name, Herkunft und die stillgelegten Wiki-Zuordnungen genau der Abschnitte der Operation kommen zurück
 *   (`schreibeNeuerWegZurueckIn`; heißt ein Abschnitt inzwischen anders oder hängt ein anderer Artikel daran, 409). Das ↺ ging bis B6a über die Route des Vorwärts mit `reverts`.
 * - **Straßen-Assistent** (`path.assign_street`, Aktion `path.street_assigned`; WI-0310): wie Umgruppieren, über `strasse-zuweisen.ts` (`schreibeStrasseZurueckIn`, dessen Rücknahme
 *   `schreibeStrasseWiederIn` mit `path.street_assigned_again`); Name, Herkunft, Wiki-Zeilen und Quellen genau der Abschnitte der Operation, ganz oder gar nicht.
 * - **Verbinden** („Wege verbinden“, `path.join`, Aktion `path.joined`): die Vorlage bekommt ihre Linie zurück, die übrigen kommen wieder auf die Karte, die Höhen an Flüssen (`wasserHoehen`)
 *   an ihre Stützpunkte (`schreibeVerbindenZurueckIn`). Auch das ging bis B6a über die Route des Vorwärts.
 *
 * - **Quellen** (`traeger.sources`, Aktion `path.sources_changed` am Anker der Straße; WI-0265 B6g3): die Klappbox des Wegeditors. Sie teilen die Serie des Abschnitts, an dem sie hängen (der Anker), und gehen
 *   mit den Feldern in EINER Rücknahme ganz oder gar nicht zurück (`ruecknahme-traeger-quellen.ts`): Die Quelle geht auf der GANZEN Straße auf den Stand davor (die Sicht der Straße, nicht Abschnitt für Abschnitt).
 *   Das Recht dazu ist `manage_sources`, eine gemischte Serie verlangt beide Rechte. Nur Quellen gehen über die Naht der Inhalte (kein Ereignis `map.changed`, keine Ableitung).
 *
 * - **Felder und Kurve in einem Schritt** (`path.update` mit Kurve UND geänderten Feldern, Aktionen `path.updated` und `path.reshaped`; WI-0265 B8a, `felderkurve`): beides in EINER Operation, ganz oder gar
 *   nicht, über denselben Schreibweg der Felder (`schreibeStrasseIn`) und der Kurve. Die Rücknahme davon ist wieder dieselbe Art.
 * - **Anlegen** (`path.create`, `anlegen`; WI-0265 B8a): zurücknehmen heißt **stilllegen**, über den Wechsel des Stands „Ganz löschen“ (`schreibeStandIn`); die Rücknahme davon holt den Abschnitt zurück (`stand`).
 *   Eine Serie darf mit dem Anlegen beginnen (Felder, Quellen, Kurve danach) und geht als Ganzes zurück: stillgelegt wird der Abschnitt. Streng: Hat seither jemand etwas an ihn gehängt (eine Wiki-Zuordnung)
 *   oder ihn geändert (jede spätere Operation, auch Quellen), geht nichts zurück.
 * - **Teilen** (`path.split`, `teilen`; WI-0265 B8a): die Teile werden wieder zu EINEM Weg (`legeTeileZusammenIn`): der vordere Teil mit seiner Kennung und der ganzen Linie davor, der hintere still gelegt
 *   wie bei „Wege verbinden“. Hat jemand eines der Teile seither geändert (Felder, Kurve, Stand, Quellen), ist das ein Konflikt. Das Ergebnis heißt `path.merged` (`zusammen`); dessen Rücknahme teilt wieder
 *   (`teileWiederIn`) und schreibt die Einträge des Teilens, sodass sich beide Richtungen weiter zurücknehmen lassen.
 *
 * - **Die Rücknahme von „Wege verbinden“ und „Auswahl zu neuem Weg“ ist selbst rücknehmbar** (WI-0265 B8a2): Sie verbindet bzw. gruppiert wieder, mit denselben Kennungen und Feldern wie nach der
 *   ursprünglichen Operation. Die Richtung steht im Namen von Operation und Aktion, nie in der Nutzlast:
 *   - Verbinden (`path.join`, `path.joined`) → Rücknahme (`path.restore_series`, `path.joined`, Art `getrennt`) → deren Rücknahme legt die Abschnitte wieder zusammen (`legeTeileZusammenIn`, `path.merged`,
 *     Art `zusammen`) → deren Rücknahme teilt wieder (`teileWiederIn`, `path.split` und `path.created`, Art `teilen`) → … Teilen und Zusammenlegen sind EIN Paar für ein Teilen in zwei und ein Trennen einer
 *     Kette in beliebig viele Abschnitte; die Höhen an Flüssen (`wasserHoehen`) gehen in jedem Schritt mit. Streng: Das Zusammenlegen geht nur, wenn das Verbinden heute noch ginge und zu derselben Linie führt
 *     (`pruefeVerbindenWieder`: eine Kette ohne Lücke, das Netz verliert nichts).
 *   - Umgruppieren (`path.regroup`, `path.regrouped`) → Rücknahme (`path.restore_series`, `path.regrouped`, Art `entgruppiert`) → deren Rücknahme gruppiert wieder (`schreibeNeuerWegWiederIn`,
 *     `path.regrouped_again`, Art `neugruppiert`) → deren Rücknahme (`schreibeNeuerWegZurueckIn`, dieselbe wie für das Original) → … Jeder Abschnitt unter dem Namen, den die Gegenrichtung ihm gab, jede
 *     Zuordnung noch so, wie sie sie hinterließ (sonst 409), ganz oder gar nicht.
 *
 * Nicht rücknehmbar (Grund `art`): ein Verbinden oder Umgruppieren aus Altbestand, das selbst ein Client-↺ war (Operation `path.join` oder `path.regroup` mit Quelle `restore`, vor dem Server-↺ von B6a):
 * Dieser Eintrag hielt weder die Linie davor noch die Zuordnungen fest, die seine Gegenrichtung braucht; ohne sie ließe sich nichts „wieder“ schreiben.
 * Mehrere Mitglieder (eine Serie) sind nur Felder und Quellen, und, wenn die Serie mit einem Anlegen beginnt, auch Kurven; Stand, Kurve, Teilen, Umgruppieren und Verbinden gehen sonst allein.
 */

type Art =
    | "felder"
    | "stand"
    | "kurve"
    | "umgruppieren"
    | "verbinden"
    | "quellen"
    | "felderkurve"
    | "anlegen"
    | "teilen"
    | "zusammen"
    | "getrennt"
    | "entgruppiert"
    | "neugruppiert"
    | "strasse"
    | "strasse_zurueck"
    | "strasse_wieder";

/** Der Wechsel des Stands, den eine Aktion im Protokoll hinterlässt (`path.deleted` → `path.delete`). */
const WECHSEL_VON_AKTION = new Map<string, WegWechsel>(
    (Object.keys(WEG_WECHSEL) as WegWechsel[]).map((wechsel) => [WEG_WECHSEL[wechsel].eintrag, wechsel]),
);

// Die Namen der Operationen stehen im Katalog (`ruecknahme-arten.ts`, WI-0265 B6f): Liste, Zustandsfilter und dieser Adapter sagen so dasselbe.

/** Welche Art Mitglied eine Operation ist, nach ihrem Namen und den Aktionen ihrer Protokolleinträge; `undefined`, wenn keine, die die Rücknahme kennt. */
function artVon(operation: string, aktionen: readonly string[]): Art | undefined {
    if (aktionen.length === 0) return undefined;
    // Felder, auch zusammen mit den Quellen der Straße (eine Rücknahme von Feldern und Quellen trägt beides).
    if (
        WEG_FELDER_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "path.updated" || aktion === "path.sources_changed") &&
        aktionen.some((aktion) => aktion === "path.updated")
    )
        return "felder";
    if (nurQuellen("path", WEG_QUELLEN_OPERATIONEN, operation, aktionen)) return "quellen";
    if (
        WEG_KURVE_OPERATIONEN.has(operation) &&
        aktionen.filter((aktion) => aktion === "path.reshaped").length === 1 &&
        aktionen.every((aktion) => aktion === "path.reshaped" || aktion === "path.carried")
    )
        return "kurve";
    if (
        WEG_STAND_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === aktionen[0] && WECHSEL_VON_AKTION.has(aktion))
    )
        return "stand";
    if (operation === WEG_UMGRUPPIEREN_OPERATION && aktionen.every((aktion) => aktion === "path.regrouped"))
        return "umgruppieren";
    if (operation === WEG_VERBINDEN_OPERATION && aktionen.every((aktion) => aktion === "path.joined"))
        return "verbinden";
    // Die Rücknahmen von Verbinden und Umgruppieren (`path.restore_series`) und ihre Gegenrichtung (WI-0265 B8a2): der Name der Aktion sagt, in welche Richtung der Eintrag ging.
    if (
        operation === RUECKNAHME_WEG_OPERATION &&
        aktionen.length >= 2 &&
        aktionen.every((aktion) => aktion === "path.joined")
    )
        return "getrennt";
    if (operation === RUECKNAHME_WEG_OPERATION && aktionen.every((aktion) => aktion === "path.regrouped"))
        return "entgruppiert";
    if (operation === RUECKNAHME_WEG_OPERATION && aktionen.every((aktion) => aktion === "path.regrouped_again"))
        return "neugruppiert";
    // Der Straßen-Assistent (WI-0310) wie Umgruppieren: zugewiesen, zurückgenommen (`path.street_assigned`), wieder zugewiesen (`path.street_assigned_again`).
    if (operation === WEG_STRASSE_OPERATION && aktionen.every((aktion) => aktion === "path.street_assigned"))
        return "strasse";
    if (operation === RUECKNAHME_WEG_OPERATION && aktionen.every((aktion) => aktion === "path.street_assigned"))
        return "strasse_zurueck";
    if (operation === RUECKNAHME_WEG_OPERATION && aktionen.every((aktion) => aktion === "path.street_assigned_again"))
        return "strasse_wieder";
    // Felder UND Kurve in EINEM Schritt (`path.update` mit Kurve): die Aktionen beider Arten zusammen.
    if (
        WEG_KURVE_OPERATIONEN.has(operation) &&
        aktionen.filter((aktion) => aktion === "path.reshaped").length === 1 &&
        aktionen.some((aktion) => aktion === "path.updated") &&
        aktionen.every((aktion) => aktion === "path.updated" || aktion === "path.reshaped" || aktion === "path.carried")
    )
        return "felderkurve";
    if (
        operation === WEG_ANLEGEN_OPERATION &&
        aktionen.length === 1 &&
        aktionen.every((aktion) => aktion === "path.created")
    )
        return "anlegen";
    // Teilen: der vordere Teil verkürzt (`path.split`), der hintere neu (`path.created`). Auch das Wiedereinsetzen der Teile (Rücknahme von `path.merged`) schreibt es so, bei einer Kette mit
    // mehreren hinteren Teilen.
    if (
        (operation === WEG_TEILEN_OPERATION || operation === RUECKNAHME_WEG_OPERATION) &&
        aktionen.filter((aktion) => aktion === "path.split").length === 1 &&
        aktionen.some((aktion) => aktion === "path.created") &&
        aktionen.every((aktion) => aktion === "path.split" || aktion === "path.created")
    )
        return "teilen";
    if (
        operation === RUECKNAHME_WEG_OPERATION &&
        aktionen.length >= 2 &&
        aktionen.every((aktion) => aktion === "path.merged")
    )
        return "zusammen";
    return undefined;
}

/** Was eine Serie mit einem Anlegen enthalten darf: Danach ist der Abschnitt nur noch stillzulegen, und keine dieser Änderungen ändert daran etwas. */
const IN_ANLEGEN_SERIE: ReadonlySet<Art | undefined> = new Set<Art | undefined>([
    "anlegen",
    "felder",
    "quellen",
    "kurve",
    "felderkurve",
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

/** Der Wechsel des Stands, den ein Eintrag der Art `stand` hinterließ. */
const wechselDes = (eintrag: MapHistoryEntry): WegWechsel | undefined =>
    WECHSEL_VON_AKTION.get(eintrag.objects[0]?.action ?? "");

// --- Felder ---------------------------------------------------------------------------------------------------------------

/** Die Felder, die der Schreibweg der Straße für ALLE Abschnitte setzt (`path-update.ts`): Name, Wegart, Kennzeichen, „Name auf der Karte“. */
const STRASSENFELDER = ["name", "subtype", "mark", "labelVisible"] as const;
/** Die Felder je Abschnitt: Tunnel, Bach, Fließrichtung, Reisemittel, weitere Straßennamen (WI-0302). */
const ABSCHNITTSFELDER = ["tunnel", "isBach", "flowDirection", "reisen", "weitere"] as const;
const FELDER_BEKANNT: ReadonlySet<string> = new Set([...STRASSENFELDER, ...ABSCHNITTSFELDER]);
/** Die Herkunft der Wiki-Felder (`<feld>Origin`): Sie wandert mit dem Feld und steht nicht für sich im Plan. */
const MIT_HERKUNFT: ReadonlySet<string> = new Set(["name", "subtype", "mark"]);

/** Was ein Feld erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt (C.3), und die Herkunft vor dem ersten, das sie änderte. */
interface FeldZiel {
    feld: string;
    vorher: unknown;
    nachher: unknown;
    herkunftVorher?: unknown;
}
interface AbschnittsPlan {
    name?: string;
    felder: Map<string, FeldZiel>;
}

/** Die Felder der Mitglieder (`path.updated`) je Abschnitt; die Einträge brauchen die volle Nutzlast. */
function planAusEintraegen(eintraege: readonly MapHistoryEntry[]): Map<string, AbschnittsPlan> {
    const plan = new Map<string, AbschnittsPlan>();
    const herkunft = new Map<string, Map<string, unknown>>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq)) {
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "path" || gegenstand.action !== "path.updated") continue;
            let abschnitt = plan.get(gegenstand.id);
            if (abschnitt === undefined) {
                abschnitt = { felder: new Map(), ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}) };
                plan.set(gegenstand.id, abschnitt);
            }
            for (const [schluessel, wechsel] of Object.entries(gegenstand.changes)) {
                // Der Grund einer Rücknahme (Gate 2) ist kein Feld des Wegs; er steht an den Einträgen jeder Rücknahme.
                if (schluessel === "restoreReason") continue;
                if (schluessel.endsWith("Origin")) {
                    const feld = schluessel.slice(0, -"Origin".length);
                    const jeFeld = herkunft.get(gegenstand.id) ?? new Map<string, unknown>();
                    herkunft.set(gegenstand.id, jeFeld);
                    if (!jeFeld.has(feld)) jeFeld.set(feld, wechsel.before ?? null);
                    continue;
                }
                const bisher = abschnitt.felder.get(schluessel);
                if (bisher === undefined)
                    abschnitt.felder.set(schluessel, {
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

/** Ein Wert mit Schlüsseln in fester Folge verglichen (das Protokoll ordnet sie anders als der Lesepfad). */
const geordnet = (wert: unknown): unknown =>
    Array.isArray(wert)
        ? wert.map(geordnet)
        : typeof wert === "object" && wert !== null
          ? Object.fromEntries(
                Object.entries(wert)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => [k, geordnet(v)]),
            )
          : wert;
const gleichGeordnet = (a: unknown, b: unknown): boolean => JSON.stringify(geordnet(a)) === JSON.stringify(geordnet(b));

/** Der Stand der Reisemittel aus dem Protokoll als Körper (wie `reisenAusProtokoll` im Wegverlauf); ungeschrieben mit `geschrieben: false`. */
function reisenAusProtokoll(wert: unknown): PathReisenBody | undefined {
    const r = wert as { liste?: unknown; fenster?: unknown; geschrieben?: unknown } | null;
    if (typeof r !== "object" || r === null || typeof r.fenster !== "object" || r.fenster === null) return undefined;
    const liste = r.liste === null ? null : Array.isArray(r.liste) ? r.liste.map(String) : undefined;
    if (liste === undefined || (liste === null && r.geschrieben === true)) return undefined;
    const fenster = r.fenster as PathReisenBody["fenster"];
    return r.geschrieben === true ? { liste, fenster } : { liste, fenster, geschrieben: false };
}

interface StrassenWert {
    name?: PathUpdateBody["name"];
    subtype?: PathUpdateBody["subtype"];
    mark?: PathUpdateBody["mark"];
    labelVisible?: boolean;
}

interface FelderErgebnis {
    konflikte: VorKonflikt[];
    /** Der Körper des Schreibwegs der Straße ohne `operationId`; nur wo keine Konflikte sind. */
    koerper?: Omit<PathUpdateBody, "operationId">;
}

/**
 * Was die Felder der Mitglieder an der Straße (`strasse`: ihre Abschnitte heute) zurücksetzen müssen, oder warum es nicht geht. Rein; die Vorprüfung und das Schreiben rechnen
 * damit dasselbe.
 */
function rechneFelder(plan: ReadonlyMap<string, AbschnittsPlan>, strasse: readonly AbschnittZeile[]): FelderErgebnis {
    const konflikte: VorKonflikt[] = [];
    const nameVon = (id: string): { name?: string } => {
        const name = plan.get(id)?.name ?? strasse.find((a) => a.public_id === id)?.name;
        return name === undefined ? {} : { name };
    };
    const abweichung = (
        was: "weg_strasse" | "weg_wert",
        id: string,
        felder: string[],
        detail: string,
    ): VorKonflikt => ({
        art: "wert",
        kind: "path",
        id,
        ...nameVon(id),
        felder,
        abweichung: { was },
        detail,
    });
    for (const [id, abschnitt] of plan)
        for (const feld of abschnitt.felder.keys())
            if (!FELDER_BEKANNT.has(feld))
                konflikte.push(abweichung("weg_wert", id, [feld], "Dieses Feld lässt sich am Weg nicht zurücksetzen."));
    const ids = strasse.map((a) => a.public_id);
    const wert: StrassenWert = {};
    const jeAbschnitt = new Map<string, Partial<PathUpdateBody["sections"][number]>>();
    const setze = (id: string, teil: Partial<PathUpdateBody["sections"][number]>): void => {
        jeAbschnitt.set(id, { ...jeAbschnitt.get(id), ...teil });
    };

    for (const feld of STRASSENFELDER) {
        const beruehrt = [...plan].filter(([, abschnitt]) => abschnitt.felder.has(feld));
        if (beruehrt.length === 0) continue;
        const ziele = beruehrt.map(([id, abschnitt]) => ({ id, ziel: abschnitt.felder.get(feld)! }));
        const ersterFremder = ids.find((id) => !ziele.some((z) => z.id === id));
        const verschieden = ziele.some((z) => !gleichGeordnet(z.ziel.vorher, ziele[0]!.ziel.vorher));
        const entfernt = ziele.find((z) => !ids.includes(z.id));
        if (ersterFremder !== undefined || verschieden || entfernt !== undefined) {
            konflikte.push(
                abweichung(
                    "weg_strasse",
                    ersterFremder ?? entfernt?.id ?? ziele[0]!.id,
                    [feld],
                    "Das Feld gilt für die ganze Straße, die vorher nicht aus denselben Abschnitten bestand oder je Abschnitt verschiedene Werte hatte.",
                ),
            );
            continue;
        }
        const vorher = ziele[0]!.ziel.vorher;
        // Folgte der Wert an jedem Abschnitt vorher dem Wiki, kommt er als Wiki-Wert zurück (WI-0225 §7), sonst als der eigene von vorher.
        const zumWiki = MIT_HERKUNFT.has(feld) && ziele.every((z) => z.ziel.herkunftVorher === "wiki");
        if (feld === "name" || feld === "subtype") {
            const ok =
                typeof vorher === "string" &&
                (feld === "name" ? vorher.trim() !== "" : (PATH_EDIT_SUBTYPES as readonly string[]).includes(vorher));
            if (!ok && !zumWiki) {
                konflikte.push(
                    abweichung("weg_wert", ziele[0]!.id, [feld], "Der frühere Wert lässt sich nicht wieder setzen."),
                );
                continue;
            }
            if (feld === "name") wert.name = zumWiki ? { revert: "wiki" } : (vorher as string).trim();
            else wert.subtype = zumWiki ? { revert: "wiki" } : (vorher as Exclude<PathUpdateBody["subtype"], object>);
        } else if (feld === "mark") {
            if (vorher !== null && vorher !== "karawanenroute") {
                konflikte.push(
                    abweichung("weg_wert", ziele[0]!.id, [feld], "Der frühere Wert lässt sich nicht wieder setzen."),
                );
                continue;
            }
            wert.mark = zumWiki ? { revert: "wiki" } : vorher === "karawanenroute" ? "karawanenroute" : "";
        } else wert.labelVisible = vorher === true;
    }

    for (const [id, abschnitt] of plan) {
        for (const feld of ABSCHNITTSFELDER) {
            const ziel = abschnitt.felder.get(feld);
            if (ziel === undefined) continue;
            if (feld === "tunnel") setze(id, { tunnel: ziel.vorher === true });
            else if (feld === "isBach") setze(id, { bach: ziel.vorher === true });
            else if (feld === "flowDirection")
                setze(id, {
                    flowDirection:
                        ziel.vorher === "forward" || ziel.vorher === "reverse"
                            ? (ziel.vorher as PathFlowDirection)
                            : null,
                });
            else if (feld === "weitere") {
                // Die weiteren Straßennamen von vorher, als vollständige Liste der Schlüssel über denselben Schreibweg (Herkunft: belebt, wo eine Zeile still liegt).
                const weitere = schluesselAusProtokoll(ziel.vorher);
                if (weitere === undefined) {
                    konflikte.push(
                        abweichung(
                            "weg_wert",
                            id,
                            [feld],
                            "Der frühere Stand der weiteren Straßennamen lässt sich nicht lesen.",
                        ),
                    );
                    continue;
                }
                setze(id, { weitere });
            } else {
                const reisen = reisenAusProtokoll(ziel.vorher);
                if (reisen === undefined) {
                    konflikte.push(
                        abweichung("weg_wert", id, [feld], "Der frühere Stand der Reisemittel lässt sich nicht lesen."),
                    );
                    continue;
                }
                setze(id, { reisen });
            }
        }
    }
    if (konflikte.length > 0) return { konflikte };
    return {
        konflikte,
        koerper: {
            sections: strasse.map((a) => ({
                publicId: a.public_id,
                baseRevision: a.revision,
                ...jeAbschnitt.get(a.public_id),
            })),
            ...(wert.name !== undefined ? { name: wert.name } : {}),
            ...(wert.subtype !== undefined ? { subtype: wert.subtype } : {}),
            ...(wert.mark !== undefined ? { mark: wert.mark } : {}),
            ...(wert.labelVisible !== undefined ? { labelVisible: wert.labelVisible } : {}),
        },
    };
}

// --- Stand ----------------------------------------------------------------------------------------------------------------

/** Der Stand eines Wegs vor dem Wechsel, aus dem Protokoll (`active`/`offMap` nennen nur, was sich änderte; sonst gilt der Stand danach). */
function standDavor(wechsel: WegWechsel, gegenstand: MapHistoryObject): ReturnType<typeof wegStand> {
    const nach = WEG_WECHSEL[wechsel].nach;
    const aktiv = gegenstand.changes["active"]?.before ?? nach === "karte";
    const abgenommen = gegenstand.changes["offMap"]?.before ?? nach === "abgenommen";
    return wegStand({ is_active: aktiv === true, off_map: abgenommen === true });
}

// --- Kurve ----------------------------------------------------------------------------------------------------------------

type Koordinate = [number, number];

const linieAus = (wert: unknown): Koordinate[] | undefined =>
    Array.isArray(wert) &&
    wert.length >= 2 &&
    wert.every((p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number")
        ? (wert as Koordinate[])
        : undefined;

interface MitgezogenerPunkt {
    index: number;
    x: number;
    y: number;
}
const punkteAus = (wert: unknown): MitgezogenerPunkt[] | undefined =>
    Array.isArray(wert) &&
    wert.length > 0 &&
    wert.every(
        (p) =>
            typeof p === "object" &&
            p !== null &&
            Number.isInteger((p as MitgezogenerPunkt).index) &&
            typeof (p as MitgezogenerPunkt).x === "number" &&
            typeof (p as MitgezogenerPunkt).y === "number",
    )
        ? (wert as MitgezogenerPunkt[])
        : undefined;

/** Ob die Kurve in einer Form im Protokoll steht, die ihre Rücknahme versteht (volle Linie, Punkte mit Index). */
function kurveLesbar(eintrag: MapHistoryEntry): boolean {
    const eigene = eintrag.objects.find((g) => g.action === "path.reshaped");
    if (linieAus(eigene?.changes["geometry"]?.before) === undefined) return false;
    return eintrag.objects
        .filter((g) => g.action === "path.carried")
        .every((g) => punkteAus(g.changes["geometry"]?.before) !== undefined);
}

// --- Der Adapter ----------------------------------------------------------------------------------------------------------

/** Der Adapter des Wegs für `vorpruefen` (siehe Kopf der Datei). */
export const WEG_ADAPTER: RuecknahmeAdapter = {
    familie: "weg",
    // Das Recht der Vorwärtsoperation (F.1): die Kurve und der Wechsel von der Karte / auf die Karte verlangen `edit_map_geometry`, Felder, Löschen und Zurückholen `edit_map_objects`.
    recht(operation, aktionen) {
        const art = artVon(operation, aktionen);
        // Verbinden ändert eine Linie und legt Abschnitte still: die Route verlangt dazu `edit_map_objects`, hier steht das Recht der Lage.
        if (art === "kurve" || art === "verbinden") return "edit_map_geometry";
        // Anlegen, Teilen und Felder mit Kurve: beide Rechte wie die Routen (`POST /api/editor/paths`, `…/split`, `…/update` mit Kurve).
        if (art === "anlegen" || art === "teilen" || art === "zusammen" || art === "getrennt" || art === "felderkurve")
            return ["edit_map_objects", "edit_map_geometry"];
        if (art === "stand") return rechtFuer(WECHSEL_VON_AKTION.get(aktionen[0] ?? "")!);
        // Die Quellen verlangen `manage_sources` (`POST …/inhalte/traeger/path/:id/quellen`); eine Rücknahme von Feldern und Quellen verlangt beide Rechte.
        if (art === "quellen") return "manage_sources";
        return traegtQuellen("path", aktionen) ? ["edit_map_objects", "manage_sources"] : "edit_map_objects";
    },
    pruefeArt: (operation, aktionen) =>
        artVon(operation, aktionen) === undefined ? { ok: false, reason: "art" } : { ok: true },
    pruefeListe(offen) {
        // Mehrere Mitglieder sind eine Arbeitsserie: nur Felder und Quellen. Ein Wechsel des Stands, eine Kurve, Umgruppieren und Verbinden gehen allein.
        // Beginnt eine Serie mit einem Anlegen, geht sie als Ganzes zurück (der Abschnitt wird stillgelegt); dann dürfen auch Kurven darin stehen (WI-0265 B8a).
        const verworfen = new Map<string, "art">();
        const mitAnlegen = offen.some((mitglied) => artDes(mitglied) === "anlegen");
        for (const mitglied of offen) {
            const art = artDes(mitglied);
            // Eine Umgruppierung oder Verbindung, die selbst ein Client-↺ war (Operation `path.regroup`/`path.join` mit Quelle `restore`, Altbestand vor dem Server-↺), ist keine Umkehrung: Ihr Gegenstück
            // spielte die alte Route zurück und hielt weder die Linie davor noch die Zuordnungen fest, die eine Gegenrichtung braucht. Die Rücknahmen des Servers (`path.restore_series`) sind eigene Arten.
            if ((art === "umgruppieren" || art === "verbinden") && mitglied.source === "restore")
                verworfen.set(mitglied.operationId, "art");
            else if (
                offen.length > 1 &&
                !(mitAnlegen ? IN_ANLEGEN_SERIE.has(art) : art === "felder" || art === "quellen")
            )
                verworfen.set(mitglied.operationId, "art");
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
        ).entries.sort((a, b) => a.seq - b.seq);
        const konflikte: VorKonflikt[] = [];
        // Beginnt die Serie mit einem Anlegen, ist nur der Abschnitt stillzulegen: Es zählt, dass seither nichts an ihm hängt (WI-0265 B8a).
        const anlegen = eintraege.filter((eintrag) => artDesEintrags(eintrag) === "anlegen");
        if (anlegen.length > 0) return pruefeAnlegen(database, anlegen);
        const felder = eintraege.filter((eintrag) => {
            const art = artDesEintrags(eintrag);
            return art === "felder" || art === "felderkurve";
        });
        if (felder.length > 0) {
            const plan = planAusEintraegen(felder);
            // Die heutigen Straßen aller Abschnitte der Mitglieder (OPS-000098). Früher nur die Straße des Abschnitts, an dem die Route hängt, als die jedes Mitglieds (Serien haben genau einen Abschnitt; eine Operation über viele Abschnitte ist allein).
            if (plan.size > 0) {
                const strassen = await strassenDesPlans(database, plan, false);
                if ("fehlt" in strassen) {
                    konflikte.push({
                        art: "wert",
                        kind: "path",
                        id: strassen.fehlt,
                        felder: ["active"],
                        abweichung: { was: "weg_fehlt" },
                        detail: "Den Weg gibt es nicht mehr.",
                    });
                } else konflikte.push(...rechneFelder(plan, strassen.alle).konflikte);
            }
        }
        for (const eintrag of eintraege) {
            const art = artDesEintrags(eintrag);
            if (art === "stand") {
                const wechsel = wechselDes(eintrag);
                if (wechsel === undefined) continue;
                const zurueck = PATH_STATE_REVERSE[wechsel];
                const ziel = WEG_WECHSEL[zurueck].nach;
                // Der Gegenwechsel muss in den Stand führen, in dem der Weg VOR der Operation war.
                for (const gegenstand of eintrag.objects) {
                    if (gegenstand.kind !== "path" || standDavor(wechsel, gegenstand) === ziel) continue;
                    konflikte.push({
                        art: "wert",
                        kind: "path",
                        id: gegenstand.id,
                        ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}),
                        felder: ["active"],
                        abweichung: { was: "weg_wert" },
                        detail: "Der frühere Stand des Wegs lässt sich über keinen Wechsel wieder herstellen.",
                    });
                }
            } else if (art === "teilen" || art === "zusammen" || art === "getrennt") {
                konflikte.push(...(await pruefeTeile(database, eintrag, art)));
            } else if (art === "entgruppiert") {
                konflikte.push(...(await pruefeEntgruppiert(database, eintrag)));
            } else if (art === "strasse" || art === "strasse_zurueck" || art === "strasse_wieder") {
                konflikte.push(...(await pruefeStrassenZuweisung(database, eintrag.objects)));
            } else if ((art === "kurve" || art === "felderkurve") && !kurveLesbar(eintrag)) {
                const eigene = eintrag.objects.find((g) => g.action === "path.reshaped");
                konflikte.push({
                    art: "wert",
                    kind: "path",
                    id: eigene?.id ?? eintrag.objects[0]?.id ?? "",
                    ...(eigene?.name !== undefined ? { name: eigene.name } : {}),
                    felder: ["geometry"],
                    abweichung: { was: "weg_wert" },
                    detail: "Die Linie vor der Änderung steht nicht im Protokoll.",
                });
            }
        }
        // Die Quellen der Straße: Die Sicht der Straße steht heute so, wie die Serie sie hinterließ, und die Straße besteht noch unter demselben Anker.
        konflikte.push(...konflikteAmTraeger(await pruefeQuellen(database, planAusTraeger(eintraege, "path"))));
        return konflikte;
    },
};

interface StandZeile {
    public_id: string;
    name: string;
    is_active: boolean;
    off_map: boolean;
}

/** Wo die Abschnitte heute stehen (auf der Karte, abgenommen, gelöscht); ein Abschnitt, den es nicht gibt, fehlt in der Antwort. */
async function leseStaende(database: Queryable, ids: readonly string[]): Promise<Map<string, StandZeile>> {
    const zeilen = await database<StandZeile[]>`
        SELECT public_id::text AS public_id, name, is_active, off_map FROM path WHERE public_id = ANY(${[...ids]}::uuid[])
    `;
    return new Map(zeilen.map((zeile) => [zeile.public_id, zeile] as const));
}

const wegFehlt = (id: string, name: string | undefined): VorKonflikt => ({
    art: "wert",
    kind: "path",
    id,
    ...(name !== undefined ? { name } : {}),
    felder: ["active"],
    abweichung: { was: "weg_fehlt" },
    detail: "Den Weg gibt es nicht mehr.",
});

/**
 * Das Anlegen zurücknehmen heißt den Abschnitt stilllegen: Das geht nur, wenn seither nichts an ihm hängt (WI-0265 B8a, streng, Fachvertrag C.3). Die Revision und jede spätere Operation am Weg
 * (Felder, Kurve, Quellen, Stand) prüft der Kern; hier steht, was keine Operation am Weg ist: eine **Wiki-Zuordnung**, die der neue Weg beim Anlegen nicht hatte.
 */
async function pruefeAnlegen(database: Queryable, eintraege: readonly MapHistoryEntry[]): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    const angelegt = eintraege.flatMap((eintrag) =>
        eintrag.objects.filter((o) => o.kind === "path" && o.action === "path.created"),
    );
    const staende = await leseStaende(
        database,
        angelegt.map((o) => o.id),
    );
    for (const weg of angelegt) {
        const stand = staende.get(weg.id);
        if (stand === undefined || !stand.is_active) {
            konflikte.push(wegFehlt(weg.id, weg.name));
            continue;
        }
        const [zuordnung] = await database<{ da: boolean }[]>`
            SELECT TRUE AS da
              FROM path_wiki_assignment a JOIN path p ON p.id = a.path_id
             WHERE p.public_id = ${weg.id}::uuid AND a.is_active
             LIMIT 1
        `;
        if (zuordnung !== undefined)
            konflikte.push({
                art: "wert",
                kind: "path",
                id: weg.id,
                name: stand.name,
                felder: ["wiki"],
                abweichung: { was: "zuordnung" },
                detail: "Der Weg hat seit dem Anlegen eine Wiki-Zuordnung.",
            });
    }
    return konflikte;
}

/**
 * Teilen zurück (`teilen`: alle Teile müssen auf der Karte stehen), Zusammenlegen zurück (`zusammen`: der vordere auf der Karte, die hinteren still gelegt, nicht abgenommen) und die Rücknahme von
 * „Wege verbinden“ zurück (`getrennt`: alle Abschnitte auf der Karte, und das Verbinden geht heute noch zu derselben Linie, `pruefeVerbindenWieder`). Die Revisionen prüft der Kern; ein Teil, den es nicht
 * mehr gibt oder der anders steht, wird hier benannt.
 */
async function pruefeTeile(
    database: Queryable,
    eintrag: MapHistoryEntry,
    art: "teilen" | "zusammen" | "getrennt",
): Promise<VorKonflikt[]> {
    const teile = teileVon(eintrag, art);
    if (teile === undefined) return [wegFehlt(eintrag.objects[0]?.id ?? "", eintrag.objects[0]?.name)];
    const staende = await leseStaende(database, [teile.vorne.id, ...teile.hinten.map((h) => h.id)]);
    const konflikte: VorKonflikt[] = [];
    for (const [teil, soll] of [
        [teile.vorne, "karte"],
        ...teile.hinten.map((h) => [h, art === "zusammen" ? "still" : "karte"] as const),
    ] as const) {
        const stand = staende.get(teil.id);
        if (stand === undefined) {
            konflikte.push(wegFehlt(teil.id, teil.name));
            continue;
        }
        const ist = stand.is_active ? "karte" : stand.off_map ? "abgenommen" : "still";
        if (ist !== soll)
            konflikte.push({
                art: "wert",
                kind: "path",
                id: teil.id,
                name: stand.name,
                felder: ["active"],
                abweichung: { was: "weg_wert" },
                detail: "Der Teil des Wegs steht nicht mehr so, wie die Änderung ihn hinterließ.",
            });
    }
    if (art === "getrennt" && konflikte.length === 0) {
        // Streng: Die Abschnitte werden wieder zu EINEM Weg; das muss heute noch gehen und zu derselben Linie führen.
        const linie = linieAus(teile.vorne.changes["geometry"]?.before);
        const geht =
            linie === undefined
                ? false
                : (
                      await pruefeVerbindenWieder(
                          database,
                          [teile.vorne.id, ...teile.hinten.map((h) => h.id)],
                          teile.vorne.id,
                          linie,
                      )
                  ).geht;
        if (!geht)
            konflikte.push({
                art: "wert",
                kind: "path",
                id: teile.vorne.id,
                ...(teile.vorne.name !== undefined ? { name: teile.vorne.name } : {}),
                felder: ["geometry"],
                abweichung: { was: "weg_wert" },
                detail: "Die Abschnitte lassen sich nicht mehr zu derselben Linie verbinden.",
            });
    }
    return konflikte;
}

/** Die Rücknahme von „Auswahl zu neuem Weg“ zurück: Die Zuordnungen, die sie wieder aktivierte, müssen noch aktiv sein (sie werden wieder still gelegt). */
async function pruefeEntgruppiert(database: Queryable, eintrag: MapHistoryEntry): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    for (const weg of eintrag.objects.filter((o) => o.kind === "path")) {
        const wiki = weg.changes["wiki"]?.after as { zeilen?: { id: string }[]; x2?: string | null } | null | undefined;
        if (wiki === undefined || wiki === null) continue;
        const zeilen = (wiki.zeilen ?? []).map((w) => w.id);
        const [aktiv] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM path_wiki_assignment WHERE id = ANY(${zeilen}::bigint[]) AND is_active
        `;
        const [aktivX2] =
            wiki.x2 === undefined || wiki.x2 === null
                ? [{ n: 1 }]
                : await database<{ n: number }[]>`
                      SELECT count(*)::int AS n FROM wiki_key_assignment WHERE id = ${wiki.x2}::bigint AND is_active
                  `;
        if ((aktiv?.n ?? 0) !== zeilen.length || (aktivX2?.n ?? 0) !== 1)
            konflikte.push({
                art: "wert",
                kind: "path",
                id: weg.id,
                ...(weg.name !== undefined ? { name: weg.name } : {}),
                felder: ["wiki"],
                abweichung: { was: "weg_wert" },
                detail: "Die Wiki-Zuordnung des Abschnitts steht nicht mehr so, wie die Rücknahme sie hinterließ.",
            });
    }
    return konflikte;
}

interface Teile {
    vorne: MapHistoryObject;
    hinten: MapHistoryObject[];
}

/**
 * Die Teile einer Teilung oder Kette aus dem Protokoll. Der vordere Teil trägt die Linie, jeder hintere `active`:
 * beim Teilen (`teilen`) der vordere (`path.split`, Linie davor) und die hinteren (`path.created`); beim Zusammenlegen (`zusammen`) alle `path.merged`; bei der Rücknahme von „Wege verbinden“
 * (`getrennt`) alle `path.joined` der Rücknahme (die Vorlage trägt die Linie, die übrigen `active`).
 */
function teileVon(eintrag: MapHistoryEntry, art: "teilen" | "zusammen" | "getrennt"): Teile | undefined {
    const wege = eintrag.objects.filter((o) => o.kind === "path");
    const aktion = art === "teilen" ? undefined : art === "zusammen" ? "path.merged" : "path.joined";
    const vorne =
        art === "teilen"
            ? wege.find((o) => o.action === "path.split")
            : wege.find((o) => o.action === aktion && o.changes["geometry"] !== undefined);
    const hinten =
        art === "teilen"
            ? wege.filter((o) => o.action === "path.created")
            : wege.filter((o) => o.action === aktion && o.changes["active"] !== undefined);
    if (vorne === undefined || hinten.length === 0 || hinten.some((h) => h.id === vorne.id)) return undefined;
    return { vorne, hinten };
}

/**
 * Die heutigen Straßen aller Abschnitte des Plans (OPS-000098, Dergel in Production: zwölf Abschnitte, deren Name in einer Operation geleert wurde, sind seither zwölf
 * Straßen, und die Rücknahme sah nur die eine, an der die Route hing). In fester Reihenfolge der Kennungen; `alle` sind ihre Abschnitte zusammen. Fehlt ein Abschnitt (nicht mehr aktiv),
 * steht er unter `fehlt`. Mit `sperren` wie `leseStrasse` (`FOR NO KEY UPDATE`).
 */
async function strassenDesPlans(
    db: Queryable,
    plan: ReadonlyMap<string, AbschnittsPlan>,
    sperren: boolean,
): Promise<
    | { strassen: { anker: string; eigener: AbschnittZeile; abschnitte: AbschnittZeile[] }[]; alle: AbschnittZeile[] }
    | { fehlt: string }
> {
    const strassen: { anker: string; eigener: AbschnittZeile; abschnitte: AbschnittZeile[] }[] = [];
    const gesehen = new Set<string>();
    for (const id of [...plan.keys()].sort()) {
        if (gesehen.has(id)) continue;
        let gelesen: Awaited<ReturnType<typeof leseStrasse>>;
        try {
            gelesen = await leseStrasse(db, id, { sperren });
        } catch (error) {
            if (error instanceof ApiError && error.statusCode === 404) return { fehlt: id };
            throw error;
        }
        for (const a of gelesen.abschnitte) gesehen.add(a.public_id);
        strassen.push({ anker: id, ...gelesen });
    }
    return { strassen, alle: strassen.flatMap((s) => s.abschnitte) };
}

const familieVon = (wegId: string, mapDomainId: string): RuecknahmeFamilie => ({
    operation: RUECKNAHME_WEG_OPERATION,
    scope: `path:${wegId}`,
    adapter: WEG_ADAPTER,
    mapDomainId,
    // Nur Quellen gehen über die Naht der Inhalte wie das Original; mit Feldern über die der Karte.
    naht: nahtDerQuellen,
});

/** Die Karte des Abschnitts (auch eines gelöschten oder abgenommenen); 404, wenn es ihn nicht gibt. */
async function domainOf(database: Queryable, wegId: string): Promise<string> {
    const [zeile] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM path WHERE public_id = ${wegId}::uuid
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    return zeile.map_domain_id;
}

/** Die Folgen für das Bestätigungsblatt: wie viele Abschnitte, und was mit dem Gelände geschieht (die Höhen an Flüssen wandern mit der Kurve zurück). */
async function folgenVon(
    database: Queryable,
    mapDomainId: string,
    vor: Vorpruefung,
): Promise<RuecknahmePruefung["folgen"]> {
    const gegenstaende = vor.gegenstaende.filter((gegenstand) => gegenstand.kind === "path").length;
    const mitHoehen = vor.mitglieder.some(
        (m) => m.offen && m.gegenstaende.some((g) => g.felder.includes("wasserHoehen")),
    );
    if (!mitHoehen) return { gegenstaende, gelaende: "keines" };
    const rezept = await resolveTerrainRecipe(database, mapDomainId);
    return { gegenstaende, gelaende: istRegional(rezept) ? "lokal" : "veraltet" };
}

/** `POST …/restore-series/preview` am Weg: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauWeg(
    database: Database,
    wegId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    const domain = await domainOf(database, wegId);
    const vor = await pruefeFamilie(
        database,
        { mapDomainId: domain, mitglieder: body.members, membersHash: body.membersHash },
        leser,
        familieVon(wegId, domain),
    );
    return { ...vor, folgen: await folgenVon(database, domain, vor) } as RuecknahmePruefung;
}

const reihenfolgeNachId = (ids: readonly string[]): string[] => [...ids].sort();

/** Die Zeilen der Abschnitte der Mitglieder in fester Reihenfolge sperren (wie die Schreibwege: `FOR NO KEY UPDATE`, die Operation ändert nie eine Kennung des Wegs). */
async function sperreAbschnitte(tx: Queryable, vorab: Vorpruefung): Promise<void> {
    const wege = reihenfolgeNachId(vorab.gegenstaende.filter((g) => g.kind === "path").map((g) => g.id));
    if (wege.length > 0)
        await tx`SELECT id FROM path WHERE public_id = ANY(${wege}::uuid[]) ORDER BY public_id FOR NO KEY UPDATE`;
}

/** Der Grund steht an jedem Eintrag der Rücknahme (Positivliste `path`). */
const mitGrund = (entry: MapAuditEntry, grund: string | undefined): MapAuditEntry =>
    grund === undefined ? entry : { ...entry, changes: { ...entry.changes, restoreReason: { after: grund } } };

const summeVon = (name: string, n: number): string =>
    `${name === "" ? "Weg" : name}: ${n === 1 ? "1 Änderung" : `${String(n)} Änderungen`} zurückgenommen`;

/** Felder: die Werte vor dem ersten Mitglied in EINEM Lauf des Schreibwegs der Straße. */
async function schreibeFelder(
    tx: Sql,
    actor: MapActor,
    wegId: string,
    operationId: string,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const plan = planAusEintraegen(eintraege);
    const gelesen = await strassenDesPlans(tx, plan, true);
    if ("fehlt" in gelesen)
        throw new ApiError(409, "edit_conflict", "Den Weg gibt es nicht mehr.", {
            objects: [{ kind: "path", id: gelesen.fehlt }],
        });
    const ergebnis = rechneFelder(plan, gelesen.alle);
    const eigener =
        gelesen.strassen.find((s) => s.abschnitte.some((a) => a.public_id === wegId))?.eigener ??
        gelesen.strassen[0]!.eigener;
    // Die Vorprüfung unter den Sperren hat es schon geprüft; wer hier noch etwas findet, bekommt den ersten Befund als Konflikt (alles oder nichts).
    if (ergebnis.koerper === undefined)
        throw new ApiError(409, "edit_conflict", "Seit diesen Änderungen hat sich etwas geändert.", {
            currentRevision: eigener.revision,
            objects: ergebnis.konflikte.map((k) => ({ kind: k.kind, id: k.id, art: k.art, abweichung: k.abweichung })),
        });
    // Je heutige Straße EIN Lauf des Schreibwegs mit ihren Abschnitten und den Feldern der Straße; meist ist es genau eine.
    const koerper = ergebnis.koerper;
    const laeufe: SchreibErgebnis[] = [];
    for (const strasse of gelesen.strassen) {
        const ihre = new Set(strasse.abschnitte.map((a) => a.public_id));
        laeufe.push(
            await schreibeStrasseIn(
                tx,
                actor,
                strasse.anker,
                { operationId, ...koerper, sections: koerper.sections.filter((s) => ihre.has(s.publicId)) },
                undefined,
            ),
        );
    }
    const geschrieben = vereineLaeufe(laeufe);
    return {
        ...geschrieben,
        summary: summeVon(eigener.name, eintraege.length),
        entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)),
    };
}

/** Mehrere Läufe des Schreibwegs in EINER Operation als eine Quittung: Gegenstände und Aufträge je einmal, alle Einträge. */
function vereineLaeufe(laeufe: readonly SchreibErgebnis[]): SchreibErgebnis {
    if (laeufe.length === 1) return laeufe[0]!;
    const erster = laeufe[0]!;
    // Ohne Aufträge nur, wenn kein Lauf welche braucht (etwa nur weitere Straßennamen, WI-0302).
    const ohneAbleitung = laeufe.every((lauf) => lauf.ableitung === false);
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    const derivedWork = new Map<string, OperationReceipt["derivedWork"][number]>();
    for (const lauf of laeufe) {
        for (const eines of lauf.receipt.affected) affected.set(`${eines.kind}:${eines.id}`, eines);
        for (const arbeit of lauf.receipt.derivedWork) derivedWork.set(JSON.stringify(arbeit), arbeit);
    }
    return {
        ...(erster.summary !== undefined ? { summary: erster.summary } : {}),
        ...(ohneAbleitung ? { ableitung: false as const } : {}),
        receipt: {
            ...erster.receipt,
            affected: [...affected.values()],
            derivedWork: [...derivedWork.values()],
            warnings: laeufe.flatMap((lauf) => lauf.receipt.warnings),
        },
        entries: laeufe.flatMap((lauf) => lauf.entries),
    };
}

/** Stand: der Gegenwechsel für genau die Abschnitte der Operation, über den Schreibweg der Wechsel. */
async function schreibeStand(
    tx: Sql,
    actor: MapActor,
    domain: string,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const wechsel = wechselDes(eintrag);
    if (wechsel === undefined)
        throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", { reason: "art" });
    const abschnitte = await heutigeRevisionen(tx, abschnittsIds(eintrag));
    const geschrieben = await schreibeStandIn(tx, actor, {
        anker: abschnitte[0]!.publicId,
        mapDomainId: domain,
        abschnitte,
        wechsel: PATH_STATE_REVERSE[wechsel],
        umfang: "abschnitt",
    });
    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
}

/** Die Abschnitte eines Eintrags in der Folge ihrer Kennung (dieselbe Sperrfolge wie überall am Weg). */
const abschnittsIds = (eintrag: MapHistoryEntry): string[] =>
    reihenfolgeNachId(eintrag.objects.filter((g) => g.kind === "path").map((g) => g.id));

/** Die Abschnitte mit ihrer heutigen Revision, die unter den Sperren der Rücknahme geprüft ist (die Vorprüfung hat sie mit der Revision nach dem Mitglied verglichen). */
async function heutigeRevisionen(
    tx: Sql,
    ids: readonly string[],
): Promise<{ publicId: string; baseRevision: number }[]> {
    const revisionen = new Map(
        (
            await tx<{ id: string; revision: number }[]>`
                SELECT public_id::text AS id, revision::int AS revision FROM path WHERE public_id = ANY(${[...ids]}::uuid[])
            `
        ).map((zeile) => [zeile.id, zeile.revision] as const),
    );
    return ids.map((id) => {
        const revision = revisionen.get(id);
        if (revision === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
        return { publicId: id, baseRevision: revision };
    });
}

/** Das Protokoll einer Operation je Abschnitt (`changes`), wie die Schreibwege des Umgruppierens und Verbindens es lesen. */
const protokollJeAbschnitt = (eintrag: MapHistoryEntry): Map<string, Record<string, MapChange>> =>
    new Map(
        eintrag.objects
            .filter((g) => g.kind === "path")
            .map((g) => [g.id, g.changes as Record<string, MapChange>] as const),
    );

/** Umgruppieren: Name, Herkunft und die stillgelegten Zuordnungen genau der Abschnitte der Operation zurück. */
async function schreibeUmgruppieren(
    tx: Sql,
    actor: MapActor,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const geschrieben = await schreibeNeuerWegZurueckIn(tx, actor, {
        abschnitte: await heutigeRevisionen(tx, abschnittsIds(eintrag)),
        eintraege: protokollJeAbschnitt(eintrag),
    });
    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
}

/** Verbinden: die Vorlage mit ihrer alten Linie, die übrigen zurück auf die Karte, die Höhen an Flüssen an ihre Stützpunkte. */
async function schreibeVerbinden(
    tx: Sql,
    actor: MapActor,
    domain: string,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const je = protokollJeAbschnitt(eintrag);
    const vorlage = [...je].find(([, changes]) => changes["geometry"] !== undefined)?.[0];
    if (vorlage === undefined)
        throw new ApiError(400, "not_revertable", "Diese Verbindung lässt sich nicht zurücknehmen.", { reason: "art" });
    const geschrieben = await schreibeVerbindenZurueckIn(tx, actor, {
        mapDomainId: domain,
        abschnitte: await heutigeRevisionen(tx, abschnittsIds(eintrag)),
        je,
        vorlage,
    });
    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
}

interface PfadZeile {
    id: string;
    public_id: string;
    revision: number;
    is_active: boolean;
    geojson: string;
}

const koordinatenVon = (geojson: string): Koordinate[] =>
    (JSON.parse(geojson) as { coordinates: Koordinate[] }).coordinates;

/** Kurve: die Linie des Abschnitts, die mitgezogenen Punkte und die Höhen an Flüssen zurück, jeder Abschnitt gegen seine Revision, in EINER Transaktion. */
async function schreibeKurve(
    tx: Sql,
    domain: string,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const eigene = eintrag.objects.find((g) => g.kind === "path" && g.action === "path.reshaped");
    const alteLinie = linieAus(eigene?.changes["geometry"]?.before);
    if (eigene === undefined || alteLinie === undefined)
        throw new ApiError(400, "not_revertable", "Diese Kurve lässt sich nicht zurücknehmen.", { reason: "art" });
    const mitgezogen = eintrag.objects.filter((g) => g.kind === "path" && g.action === "path.carried");
    const ids = reihenfolgeNachId([eigene.id, ...mitgezogen.map((g) => g.id)]);
    const zeilen = new Map(
        (
            await tx<PfadZeile[]>`
                SELECT id::text, public_id::text AS public_id, revision::int AS revision, is_active, ST_AsGeoJSON(geom, 15) AS geojson
                  FROM path WHERE public_id = ANY(${ids}::uuid[]) ORDER BY public_id
            `
        ).map((zeile) => [zeile.public_id, zeile] as const),
    );
    for (const id of ids) {
        const zeile = zeilen.get(id);
        if (zeile === undefined || !zeile.is_active) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    }
    // Nie über die Sperre eines anderen hinweg (EDIT-0003 §4), weder am eigenen Weg noch an einem mitgezogenen.
    const entries: MapAuditEntry[] = [];
    const affected: OperationReceipt["affected"] = [];
    const pfadIds: number[] = [];

    const jetzt = zeilen.get(eigene.id)!;
    const linieJetzt = koordinatenVon(jetzt.geojson);
    const [geaendert] = await tx<{ revision: number }[]>`
        UPDATE path
           SET geom = ST_SetSRID(ST_MakeLine(ARRAY(
                   SELECT ST_MakePoint(t.x, t.y)
                     FROM unnest(${alteLinie.map((p) => p[0])}::float8[], ${alteLinie.map((p) => p[1])}::float8[]) WITH ORDINALITY AS t(x, y, n)
                    ORDER BY t.n)), 0)
         WHERE public_id = ${eigene.id}::uuid AND revision = ${jetzt.revision}
        RETURNING revision::int AS revision
    `;
    if (geaendert === undefined)
        throw new ApiError(409, "edit_conflict", "Seit dieser Kurve hat sich der Weg geändert.", {
            currentRevision: jetzt.revision,
        });
    pfadIds.push(Number(jetzt.id));
    affected.push({ kind: "path", id: eigene.id, revision: geaendert.revision });
    entries.push({
        action: "path.reshaped",
        pathId: eigene.id,
        revisionBefore: jetzt.revision,
        revisionAfter: geaendert.revision,
        changes: { geometry: { before: linieJetzt, after: alteLinie } },
    });

    for (const gezogen of mitgezogen) {
        const zeile = zeilen.get(gezogen.id)!;
        const davor = punkteAus(gezogen.changes["geometry"]?.before);
        const danach = punkteAus(gezogen.changes["geometry"]?.after);
        if (davor === undefined || danach === undefined)
            throw new ApiError(400, "not_revertable", "Diese Kurve lässt sich nicht zurücknehmen.", { reason: "art" });
        let geometrie = "geom";
        const parameter: unknown[] = [gezogen.id, zeile.revision];
        for (const p of davor) {
            parameter.push(p.index, p.x, p.y);
            const n = parameter.length;
            geometrie = `ST_SetPoint(${geometrie}, $${String(n - 2)}::int, ST_SetSRID(ST_MakePoint($${String(n - 1)}, $${String(n)}), 0))`;
        }
        const [mit] = await tx.unsafe<{ revision: number }[]>(
            `UPDATE path SET geom = ${geometrie} WHERE public_id = $1::uuid AND revision = $2
             RETURNING revision::int AS revision`,
            parameter as never[],
        );
        if (mit === undefined)
            throw new ApiError(409, "edit_conflict", "Seit dieser Kurve hat sich ein mitgezogener Weg geändert.", {
                currentRevision: zeile.revision,
            });
        pfadIds.push(Number(zeile.id));
        affected.push({ kind: "path", id: gezogen.id, revision: mit.revision });
        entries.push({
            action: "path.carried",
            pathId: gezogen.id,
            revisionBefore: zeile.revision,
            revisionAfter: mit.revision,
            // Die Punkte liegen heute, wo die Kurve sie hinterließ (`danach`); sie gehen dorthin zurück, wo sie vorher lagen (`davor`).
            changes: { geometry: { before: danach, after: davor } },
        });
    }
    await derivePathVisualsFor(tx, pfadIds);
    // Die Höhen an Flüssen, die mit der Kurve umzogen (WI-0259), gehen an ihre Stützpunkte zurück.
    const umgezogen = umgekehrtAusProtokoll(eigene.changes["wasserHoehen"]);
    if (umgezogen.length > 0) {
        const hoehen = await fuehreFlussHoehenNach(tx, domain, umgezogen, { genau: true });
        if (hoehen.umzuege.length > 0) entries[0]!.changes!["wasserHoehen"] = wasserHoehenProtokoll(hoehen.umzuege);
        for (const g of hoehen.affected) affected.push(g);
    }
    return {
        receipt: {
            affected,
            derivedWork: [
                { kind: "path_visual", state: "done" },
                { kind: "routing", state: "pending" },
            ],
            warnings: [],
        },
        summary: `${eigene.name ?? "Weg"}: Kurve zurückgenommen${mitgezogen.length > 0 ? `, ${String(mitgezogen.length)} Wege mitgezogen` : ""}`,
        entries: entries.map((entry) => mitGrund(entry, grund)),
    };
}

/** Felder und Kurve eines Schritts (`path.update` mit Kurve) zurück: beide in EINER Operation, erst die Felder über den Schreibweg der Straße, dann die Kurve. */
async function schreibeFelderUndKurve(
    tx: Sql,
    actor: MapActor,
    domain: string,
    wegId: string,
    operationId: string,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const felder = await schreibeFelder(tx, actor, wegId, operationId, eintraege, grund);
    const kurve = await schreibeKurve(tx, domain, eintraege[0]!, grund);
    const affected = new Map<string, OperationReceipt["affected"][number]>();
    for (const eines of [...felder.receipt.affected, ...kurve.receipt.affected])
        affected.set(`${eines.kind}:${eines.id}`, eines);
    const derivedWork = [...felder.receipt.derivedWork];
    for (const arbeit of kurve.receipt.derivedWork)
        if (!derivedWork.some((x) => x.kind === arbeit.kind)) derivedWork.push(arbeit);
    return {
        receipt: {
            affected: [...affected.values()],
            derivedWork,
            warnings: [...felder.receipt.warnings, ...kurve.receipt.warnings],
        },
        summary: kurve.summary ?? felder.summary ?? "Weg: Änderungen zurückgenommen",
        entries: [...felder.entries, ...kurve.entries],
    };
}

/** Anlegen zurück: der Abschnitt wird stillgelegt wie bei „Ganz löschen“ (Wechsel des Stands `path.delete`); die Rücknahme davon holt ihn zurück. */
async function schreibeAnlegenZurueck(
    tx: Sql,
    actor: MapActor,
    domain: string,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const angelegt = eintraege.flatMap((eintrag) =>
        eintrag.objects.filter((o) => o.kind === "path" && o.action === "path.created"),
    );
    const ids = reihenfolgeNachId(angelegt.map((o) => o.id));
    const geschrieben = await schreibeStandIn(tx, actor, {
        anker: ids[0]!,
        mapDomainId: domain,
        abschnitte: await heutigeRevisionen(tx, ids),
        wechsel: "path.delete",
        umfang: "abschnitt",
    });
    return {
        ...geschrieben,
        summary: `${angelegt[0]?.name ?? "Weg"}: Anlegen zurückgenommen`,
        entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)),
    };
}

/**
 * Teilen zurück (`teilen`) und die Rücknahme von „Wege verbinden“ zurück (`getrennt`): die Teile wieder zu EINEM Weg, mit der Kennung und der Linie davor (`legeTeileZusammenIn`); die Höhen an Flüssen
 * gehen mit (`wasserHoehen` am vorderen Teil).
 */
async function schreibeZusammenlegen(
    tx: Sql,
    actor: MapActor,
    domain: string,
    eintrag: MapHistoryEntry,
    art: "teilen" | "getrennt",
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const teile = teileVon(eintrag, art);
    const linie = linieAus(teile?.vorne.changes["geometry"]?.before);
    if (teile === undefined || linie === undefined)
        throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", { reason: "art" });
    const geschrieben = await legeTeileZusammenIn(tx, actor, {
        mapDomainId: domain,
        vorne: teile.vorne.id,
        hinten: teile.hinten.map((h) => h.id),
        linie,
        hoehen: teile.vorne.changes["wasserHoehen"],
    });
    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
}

/** Das Zusammenlegen zurück: der vordere Teil wieder kürzer, die hinteren zurück auf der Karte (`teileWiederIn`); die Höhen an Flüssen gehen mit. */
async function schreibeZusammenZurueck(
    tx: Sql,
    actor: MapActor,
    domain: string,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const teile = teileVon(eintrag, "zusammen");
    const linieVorne = linieAus(teile?.vorne.changes["geometry"]?.before);
    if (teile === undefined || linieVorne === undefined)
        throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", { reason: "art" });
    const geschrieben = await teileWiederIn(tx, actor, {
        mapDomainId: domain,
        vorne: teile.vorne.id,
        hinten: teile.hinten.map((h) => h.id),
        linieVorne,
        hoehen: teile.vorne.changes["wasserHoehen"],
    });
    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
}

/** Die Rücknahme von „Auswahl zu neuem Weg“ zurück: die Auswahl wieder EIN Weg (`schreibeNeuerWegWiederIn`). */
async function schreibeEntgruppiert(
    tx: Sql,
    actor: MapActor,
    eintrag: MapHistoryEntry,
    grund: string | undefined,
): Promise<SchreibErgebnis> {
    const geschrieben = await schreibeNeuerWegWiederIn(tx, actor, {
        abschnitte: await heutigeRevisionen(tx, abschnittsIds(eintrag)),
        eintraege: protokollJeAbschnitt(eintrag),
    });
    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
}

/**
 * `POST …/restore-series` am Weg: nimmt die Mitglieder (Felder einer Serie, EINE Kurve, Felder und Kurve eines Schritts, EINEN Wechsel des Stands, EIN Anlegen oder EIN Teilen) in EINER Operation zurück
 * (Ablauf: `fuehreRuecknahmeAus`). Hier steht, was den Weg ausmacht: die Fremdsperre der Abschnitte, die Sperre ihrer Zeilen und die Inverse je Art.
 */
export async function ruecknehmenWeg(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    wegId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    const domain = await domainOf(database, wegId);
    return fuehreRuecknahmeAus({
        database,
        actor,
        leser,
        familie: familieVon(wegId, domain),
        body,
        haken: {
            pruefeFremdeSperre: (db, akteur, scopes) =>
                pruefeSperren(
                    db as Sql,
                    akteur,
                    [...scopes]
                        .filter((scope) => scope.startsWith("path:"))
                        .map((scope) => scope.slice("path:".length)),
                ),
            async sperreZeilen(tx, vorab) {
                await sperreAbschnitte(tx, vorab);
                if (hatQuellen(vorab, "path"))
                    await sperreQuellen(
                        tx,
                        planAusTraeger(
                            (
                                await eintraegeNachKennung(tx, vorab.offen, {
                                    personId: leser.personId,
                                    nutzlast: "voll",
                                })
                            ).entries,
                            "path",
                        ),
                    );
            },
            async schreibe({ tx, offen, grund }: RuecknahmeSchreiben) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                // Beginnt die Serie mit einem Anlegen, wird der Abschnitt stillgelegt; was danach in der Serie stand, bleibt, wie es ist (ohne Belang für einen stillgelegten Weg).
                if (eintraege.some((eintrag) => artDesEintrags(eintrag) === "anlegen"))
                    return schreibeAnlegenZurueck(tx, actor, domain, eintraege, grund);
                const art = artDesEintrags(eintraege[0]!);
                if (art === "felderkurve")
                    return schreibeFelderUndKurve(tx, actor, domain, wegId, body.operationId, eintraege, grund);
                if (art === "teilen" || art === "getrennt")
                    return schreibeZusammenlegen(tx, actor, domain, eintraege[0]!, art, grund);
                if (art === "zusammen") return schreibeZusammenZurueck(tx, actor, domain, eintraege[0]!, grund);
                if (art === "entgruppiert") return schreibeEntgruppiert(tx, actor, eintraege[0]!, grund);
                if (art === "felder" || art === "quellen") {
                    // Felder und Quellen der Straße in EINER Operation; eine Rücknahme nur der Quellen schreibt keine Felder.
                    const felder =
                        planAusEintraegen(eintraege).size > 0
                            ? await schreibeFelder(tx, actor, wegId, body.operationId, eintraege, grund)
                            : undefined;
                    const quellen = await schreibeTraegerQuellenZurueck(tx, eintraege, "path", grund);
                    return mischeErgebnis(felder, quellen, eintraege.length);
                }
                if (art === "stand") return schreibeStand(tx, actor, domain, eintraege[0]!, grund);
                if (art === "kurve") return schreibeKurve(tx, domain, eintraege[0]!, grund);
                // `neugruppiert` (die Gegenrichtung der Rücknahme) hat die Einträge des Originals: Seine Rücknahme ist dieselbe wie dessen.
                if (art === "umgruppieren" || art === "neugruppiert")
                    return schreibeUmgruppieren(tx, actor, eintraege[0]!, grund);
                if (art === "verbinden") return schreibeVerbinden(tx, actor, domain, eintraege[0]!, grund);
                // Der Straßen-Assistent: zurück (auch die Wiederholung), oder die Rücknahme davon wieder zuweisen.
                if (art === "strasse" || art === "strasse_wieder" || art === "strasse_zurueck") {
                    const kern = art === "strasse_zurueck" ? schreibeStrasseWiederIn : schreibeStrasseZurueckIn;
                    const geschrieben = await kern(tx, actor, {
                        abschnitte: await heutigeRevisionen(tx, abschnittsIds(eintraege[0]!)),
                        eintraege: protokollJeAbschnitt(eintraege[0]!),
                    });
                    return { ...geschrieben, entries: geschrieben.entries.map((entry) => mitGrund(entry, grund)) };
                }
                throw new ApiError(400, "not_revertable", "Diese Änderung lässt sich nicht zurücknehmen.", {
                    reason: "art",
                });
            },
        },
    });
}
