import type {
    MapHistoryActor,
    MapHistoryEntry,
    MapHistoryObjectKind,
    MapHistorySeries,
    RuecknahmeKonflikt,
    RuecknahmePruefung,
    WikiBoxArt,
} from "@avesmaps3d/shared";
import { formatDecimal, formatNumber, t, tPlural } from "../i18n/i18n";
import type { SerienZeile } from "./aenderung-modell";
import { artName, uhrzeit, wer, zeitMitZone } from "./aenderung-text";
import { vorgangName } from "./aenderung-vorgang";

/**
 * Das Zurücknehmen aus „Änderungen“ und dem Objektverlauf, ohne Vue und ohne Browser (WI-0265 B5c; Probierseite `review/wi-0265/aenderungen.html`,
 * Szenen 2, 3, 6 und 7): wann eine Zeile ein ↺ anbietet, welche Mitglieder an den Server gehen und wie die Rückfrage ihre Zeilen schreibt.
 * Entschieden wird nie hier. Die Oberfläche bietet an, was der Server für diese Art kennt (Derographie, Ort, Weg, Gipfel, Gebiet, Kraftlinie, Sprache, Quelle, Werk, Korpus, Vorkommen und die Quellen eines Orts, Gebiets, einer Landschaft oder eines Wegs); ob es geht, sagt erst die Vorprüfung
 * (`restore-series/preview`), und die Rücknahme wiederholt sie in ihrer Transaktion.
 *
 * - **Je Familie eine Adresse** (`RuecknahmeZiel`): die Derographie (Gebirge, Felder, Beschriftungen, Form, Stilllegen, die Werkzeuge an Flächen) unter ihrer Landschaft, der Gipfel
 *   unter seinem Gipfel, der Ort unter seinem Ort, der Weg unter einem seiner Abschnitte, das Gebiet unter seinem Gebiet und die Kraftlinie unter einem ihrer Abschnitte
 *   (WI-0265 B6b), die Sprache unter ihrer Sprache (B6e; eine Teilfläche nennt sie am Gegenstand). Eine Serie mischt nie Familien.
 * - **Einzeln nur das letzte offene Mitglied** (Streng, U5): Die Liste kennt die Reihenfolge der Serie und sperrt die früheren mit „überholt durch
 *   Schritt n“, bevor der Server gefragt wird. Gilt die Liste nicht vollständig, entscheidet die Vorprüfung.
 * - **Die Spiegel der Server-Adapter** (`ortArt`, `wegArt`, `istDerographie`, `gebietArt`, `linienArt`) sind eine Anzeige, keine Zusage: Sie sparen dem Menschen den Weg zu einem
 *   Knopf, der doch nur „nicht rücknehmbar“ sagte. Lehnt der Server dennoch ab, steht sein Grund in der Rückfrage.
 */

export type RuecknahmeFamilie =
    | "landscape"
    | "place"
    | "path"
    | "peak"
    | "umwandlung"
    | "territory"
    | "powerline"
    | "nodix"
    | "sprache"
    | "source"
    | "work"
    | "corpus"
    | "lore"
    | "wikibox"
    | "wikisync"
    | "wikisyncschritt";

/**
 * Die Adresse der Rücknahme: die Familie und die Kennung, unter der die Route hängt (`/api/editor/landscapes/:id/restore-series`). Die Wiki-Box nennt dazu die Art der Box (`ort`, `weg` …), weil ihre Route je Art
 * eine andere ist (`/api/editor/wiki-box/:art/:id/restore-series`, WI-0265 B8d).
 */
export interface RuecknahmeZiel {
    readonly familie: RuecknahmeFamilie;
    readonly id: string;
    readonly art?: WikiBoxArt;
}

// --- Welche Arten es gibt (Spiegel von `ruecknahme-flaeche.ts`, `ruecknahme-ort.ts`, `ruecknahme-weg.ts`, `ruecknahme-gebiet.ts`, `ruecknahme-kraftlinie.ts` und `ruecknahme-sprache.ts`) -----------------

/** Die Quellen eines Kartenobjekts (`traeger.sources`, WI-0265 B6g3): Sie gehören zur Familie ihres Trägers und teilen dessen Serie. */
const TRAEGER_QUELLEN_OPERATION = "traeger.sources";

/** Die Operationen der Derographie, die der Server zurücknimmt, seit WI-0265 B8c auch das Anlegen einer Fläche, einer Beschriftung und eines Gipfels oder einer Landmarke und das Löschen einer Beschriftung. */
const DEROGRAPHIE_OPERATIONEN: ReadonlySet<string> = new Set([
    "landscape.create",
    "label.create",
    "label.retire",
    "peak.create",
    "landscape.update",
    TRAEGER_QUELLEN_OPERATION,
    "landscape.restore_series",
    "landscape.restore",
    "landscape.retire",
    "landscape.batch",
    "landscape.boolean",
    "landscape.parts",
    "landscape.split",
    "landscape.copy",
    "landscape.merge",
    "peak.update",
    "peak.restore_series",
    "peak.retire",
    "peak.restore",
]);
/** Die Aktionen ihrer Protokolleinträge, die die Inverse des Servers kennt. */
const DEROGRAPHIE_AKTIONEN: ReadonlySet<string> = new Set([
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
    "area.gebirge",
    "label.created",
    "label.updated",
    "label.renamed",
    "label.retired",
    "label.restored",
    "peak.created",
    "peak.updated",
    "peak.retired",
    "peak.restored",
    // Flussenden, die dem Gipfel folgten (OPS-000088): Sie gehen mit seiner Lage zurück.
    "path.endpoint_moved",
    // Die Quellen der Landschaft (WI-0265 B6g3) und des Gipfels oder der Landmarke (WI-0271 L4; B8c).
    "region.sources_changed",
    "peak.sources_changed",
]);
const ORT_FELDER_OPERATIONEN: ReadonlySet<string> = new Set(["place.update", "place.sammel", "place.restore_series"]);
const ORT_LOESCHEN_OPERATIONEN: ReadonlySet<string> = new Set(["place.delete", "place.restore_series"]);
const ORT_ABNEHMEN_OPERATIONEN: ReadonlySet<string> = new Set(["place.take_off_map", "place.restore_series"]);
const ORT_WIEDERHERSTELLEN_OPERATIONEN: ReadonlySet<string> = new Set(["place.restore", "place.restore_series"]);
const ORT_QUELLEN_OPERATIONEN: ReadonlySet<string> = new Set([TRAEGER_QUELLEN_OPERATION, "place.restore_series"]);
const ORT_VERSCHIEBEN_OPERATIONEN: ReadonlySet<string> = new Set(["place.move", "place.restore_series"]);
const WEG_FELDER_OPERATIONEN: ReadonlySet<string> = new Set(["path.update", "path.restore_series"]);
const WEG_QUELLEN_OPERATIONEN: ReadonlySet<string> = new Set([TRAEGER_QUELLEN_OPERATION, "path.restore_series"]);
const WEG_KURVE_OPERATIONEN: ReadonlySet<string> = new Set(["path.update", "path.reshape", "path.restore_series"]);
const WEG_STAND_OPERATIONEN: ReadonlySet<string> = new Set([
    "path.delete",
    "path.restore",
    "path.take_off_map",
    "path.put_on_map",
    "path.restore_series",
]);
const WEG_STAND_AKTIONEN: ReadonlySet<string> = new Set([
    "path.deleted",
    "path.restored",
    "path.taken_off_map",
    "path.put_on_map",
]);

/**
 * Was ein Mitglied am Ort ist: Felder (auch als Serie, auch zusammen mit den Quellen, auch die Mehrfachbearbeitung mehrerer Orte), EINE Verschiebung samt Wegenden, EIN Löschen (auch mehrerer Orte, und die Rücknahme
 * eines Anlegens oder Wiederherstellens), Quellen (WI-0265 B6g3), das Anlegen, das Wiederherstellen, das Abnehmen von der Karte und das Setzen auf die Karte (WI-0265 B8a).
 */
export type OrtArt =
    "felder" | "verschieben" | "loeschen" | "quellen" | "anlegen" | "wiederherstellen" | "abnehmen" | "aufsetzen";

export function ortArt(operation: string, aktionen: readonly string[]): OrtArt | undefined {
    if (aktionen.length === 0) return undefined;
    if (
        ORT_FELDER_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "place.updated" || aktion === "place.sources_changed") &&
        aktionen.some((aktion) => aktion === "place.updated")
    )
        return "felder";
    if (ORT_QUELLEN_OPERATIONEN.has(operation) && aktionen.every((aktion) => aktion === "place.sources_changed"))
        return "quellen";
    if (
        ORT_VERSCHIEBEN_OPERATIONEN.has(operation) &&
        aktionen.filter((aktion) => aktion === "place.moved").length === 1 &&
        aktionen.every((aktion) => aktion === "place.moved" || aktion === "path.endpoint_moved")
    )
        return "verschieben";
    if (
        ORT_LOESCHEN_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "place.deleted" || aktion === "place.deleted_unplaced")
    )
        return "loeschen";
    if (
        (operation === "place.create" || operation === "place.update") &&
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

/**
 * Was ein Mitglied am Weg ist: Felder der Straße (auch als Serie, auch zusammen mit den Quellen), die Kurve (samt mitgezogenen Punkten), EIN Wechsel des Stands, „Auswahl zu neuem Weg“ (`umgruppieren`),
 * „Wege verbinden“ (`verbinden`), die Quellen der Straße (`quellen`, WI-0265 B6g3), Felder und Kurve in einem Schritt (`felderkurve`), das Anlegen, das Teilen und das Zusammenlegen der Teile
 * (WI-0265 B8a); Spiegel von `ruecknahme-weg.ts`.
 */
export type WegArt =
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

export function wegArt(operation: string, aktionen: readonly string[]): WegArt | undefined {
    if (aktionen.length === 0) return undefined;
    if (
        WEG_FELDER_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === "path.updated" || aktion === "path.sources_changed") &&
        aktionen.some((aktion) => aktion === "path.updated")
    )
        return "felder";
    if (WEG_QUELLEN_OPERATIONEN.has(operation) && aktionen.every((aktion) => aktion === "path.sources_changed"))
        return "quellen";
    if (
        WEG_KURVE_OPERATIONEN.has(operation) &&
        aktionen.filter((aktion) => aktion === "path.reshaped").length === 1 &&
        aktionen.every((aktion) => aktion === "path.reshaped" || aktion === "path.carried")
    )
        return "kurve";
    if (
        WEG_STAND_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === aktionen[0] && WEG_STAND_AKTIONEN.has(aktion))
    )
        return "stand";
    // „Auswahl zu neuem Weg“ und „Wege verbinden“: die Operation selbst; eine, die selbst ein Client-↺ war (Operation `path.regroup`/`path.join` mit Quelle `restore`, Altbestand vor dem Server-↺),
    // schließt `ruecknahmeFamilie` aus. Ihre Rücknahme (`path.restore_series`) und deren Rücknahme sind eigene Arten, die Richtung steht im Namen der Aktion (WI-0265 B8a2).
    if (operation === "path.regroup" && aktionen.every((aktion) => aktion === "path.regrouped")) return "umgruppieren";
    if (operation === "path.join" && aktionen.every((aktion) => aktion === "path.joined")) return "verbinden";
    if (
        operation === "path.restore_series" &&
        aktionen.length >= 2 &&
        aktionen.every((aktion) => aktion === "path.joined")
    )
        return "getrennt";
    if (operation === "path.restore_series" && aktionen.every((aktion) => aktion === "path.regrouped"))
        return "entgruppiert";
    if (operation === "path.restore_series" && aktionen.every((aktion) => aktion === "path.regrouped_again"))
        return "neugruppiert";
    // Der Straßen-Assistent (WI-0310, `path.assign_street`) wie „Auswahl zu neuem Weg“: die Operation, ihre Rücknahme und deren Rücknahme (`ruecknahme-weg.ts`).
    if (operation === "path.assign_street" && aktionen.every((aktion) => aktion === "path.street_assigned"))
        return "strasse";
    if (operation === "path.restore_series" && aktionen.every((aktion) => aktion === "path.street_assigned"))
        return "strasse_zurueck";
    if (operation === "path.restore_series" && aktionen.every((aktion) => aktion === "path.street_assigned_again"))
        return "strasse_wieder";
    // Felder UND Kurve in einem Schritt, Anlegen, Teilen und das Zusammenlegen der Teile (die Rücknahme des Teilens); WI-0265 B8a.
    if (
        WEG_KURVE_OPERATIONEN.has(operation) &&
        aktionen.filter((aktion) => aktion === "path.reshaped").length === 1 &&
        aktionen.some((aktion) => aktion === "path.updated") &&
        aktionen.every((aktion) => aktion === "path.updated" || aktion === "path.reshaped" || aktion === "path.carried")
    )
        return "felderkurve";
    if (operation === "path.create" && aktionen.length === 1 && aktionen.every((aktion) => aktion === "path.created"))
        return "anlegen";
    if (
        (operation === "path.split" || operation === "path.restore_series") &&
        aktionen.filter((aktion) => aktion === "path.split").length === 1 &&
        aktionen.some((aktion) => aktion === "path.created") &&
        aktionen.every((aktion) => aktion === "path.split" || aktion === "path.created")
    )
        return "teilen";
    if (
        operation === "path.restore_series" &&
        aktionen.length >= 2 &&
        aktionen.every((aktion) => aktion === "path.merged")
    )
        return "zusammen";
    return undefined;
}

/**
 * Eine Änderung der Derographie, die der Server zurücknimmt (WI-0265 B3 Gebirge, B6c alles übrige): Felder und Beschriftungen der Landschaft, ihre Form samt mitgezogenen Nachbarn,
 * Stilllegen und Zurückholen, die Werkzeuge an Flächen, das Gebirge und die Höhen der Gipfel; seit B8c auch das Anlegen (Fläche samt Teilfläche, Beschriftung, Gipfel, Landmarke), das als Stilllegen
 * zurückgeht.
 */
export const istDerographie = (operation: string, aktionen: readonly string[]): boolean =>
    DEROGRAPHIE_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    aktionen.every((aktion) => DEROGRAPHIE_AKTIONEN.has(aktion));

const GEBIET_FELDER_OPERATIONEN: ReadonlySet<string> = new Set([
    "territory.update",
    "territory.display",
    "territory.sammel",
    "territory.restore_series",
]);
const GEBIET_FELDER_AKTIONEN: ReadonlySet<string> = new Set([
    "territory.updated",
    "territory.display_changed",
    "territory_area.bands_cleared",
    // Die Form (WI-0265 B8b): eine eigene Fläche und die mitgezogenen Ecken einer Nachbarfläche gehören zu den Feldern.
    "territory_area.reshaped",
    "territory_area.carried",
]);
const GEBIET_QUELLEN_OPERATIONEN: ReadonlySet<string> = new Set([
    TRAEGER_QUELLEN_OPERATION,
    "territory.restore_series",
]);
const GEBIET_ENTFERNEN_OPERATIONEN: ReadonlySet<string> = new Set([
    "territory.retire",
    "territory.create_parent",
    "territory.merge",
    // Das Zurückholen und die Rücknahme selbst (WI-0265 B8b): ihre Rücknahme macht das Entfernen noch einmal.
    "territory.restore",
    "territory.restore_series",
]);
const GEBIET_ENTFERNEN_AKTIONEN: ReadonlySet<string> = new Set([
    "territory.retired",
    "territory.restored",
    "territory.updated",
    "territory.created",
    "territory_area.retired",
    "territory_area.restored",
    "territory_area.merged",
    "territory_area.reshaped",
]);

/**
 * Was ein Mitglied am Gebiet ist: Felder, Darstellung und Form (auch als Serie, auch zusammen mit den Quellen), EIN Entfernen, „Unter neues Obergebiet …“, Vereinigen oder Zurückholen,
 * Quellen (WI-0265 B6g3), das Anlegen eines Gebiets samt Fläche und „Grenze zeichnen“ (B8b; auch in einer Serie).
 */
export type GebietArt = "felder" | "entfernen" | "quellen" | "anlegen" | "grenze";

export function gebietArt(operation: string, aktionen: readonly string[]): GebietArt | undefined {
    if (aktionen.length === 0) return undefined;
    if (
        GEBIET_FELDER_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => GEBIET_FELDER_AKTIONEN.has(aktion) || aktion === "territory.sources_changed") &&
        aktionen.some((aktion) => GEBIET_FELDER_AKTIONEN.has(aktion))
    )
        return "felder";
    if (GEBIET_QUELLEN_OPERATIONEN.has(operation) && aktionen.every((aktion) => aktion === "territory.sources_changed"))
        return "quellen";
    if (
        GEBIET_ENTFERNEN_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => GEBIET_ENTFERNEN_AKTIONEN.has(aktion))
    )
        return "entfernen";
    if (
        operation === "territory.create" &&
        aktionen.includes("territory.created") &&
        aktionen.every((aktion) => aktion === "territory.created" || aktion === "territory_area.created")
    )
        return "anlegen";
    if (operation === "territory_area.create" && aktionen.every((aktion) => aktion === "territory_area.created"))
        return "grenze";
    return undefined;
}

// Die Linie: auch das Anlegen eines Abschnitts (WI-0265 B8b).
const LINIE_OPERATIONEN: ReadonlySet<string> = new Set([
    "powerline.create",
    "powerline.update_line",
    "powerline.restore_series",
]);
const LINIE_AKTIONEN: ReadonlySet<string> = new Set([
    "powerline.updated",
    "powerline.created",
    "powerline.revived",
    "powerline.removed",
]);
const STAND_OPERATIONEN: ReadonlySet<string> = new Set([
    "powerline.take_off_map",
    "powerline.put_on_map",
    "powerline.retire",
    "powerline.restore",
    "powerline.restore_series",
]);
const STAND_AKTIONEN: ReadonlySet<string> = new Set([
    "powerline.taken_off_map",
    "powerline.put_on_map",
    "powerline.retired",
    "powerline.restored",
]);

/** Was ein Mitglied an der Kraftlinie ist: Änderungen der Linie (auch als Serie) oder EIN Wechsel ihres Stands (auch für mehrere Linien). */
export type LinienArt = "linie" | "stand";

export function linienArt(operation: string, aktionen: readonly string[]): LinienArt | undefined {
    if (aktionen.length === 0) return undefined;
    if (LINIE_OPERATIONEN.has(operation) && aktionen.every((aktion) => LINIE_AKTIONEN.has(aktion))) return "linie";
    if (
        STAND_OPERATIONEN.has(operation) &&
        aktionen.every((aktion) => aktion === aktionen[0] && STAND_AKTIONEN.has(aktion))
    )
        return "stand";
    return undefined;
}

/** Der Kraftlinienpunkt (WI-0265 B8b): Anlegen, Verschieben, Entfernen und die Rücknahme selbst; die Aktionen ihrer Protokolleinträge. */
const NODIX_OPERATIONEN: ReadonlySet<string> = new Set([
    "nodix.create",
    "nodix.move",
    "nodix.retire",
    "nodix.restore_series",
]);
const NODIX_AKTIONEN: ReadonlySet<string> = new Set([
    "nodix.created",
    "nodix.moved",
    "nodix.retired",
    "nodix.restored",
]);
export const istNodix = (operation: string, aktionen: readonly string[]): boolean =>
    NODIX_OPERATIONEN.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => NODIX_AKTIONEN.has(aktion));

/** Die Operationen des Spracheditors, die der Server zurücknimmt (WI-0265 B6e; seit B8c auch das Anlegen einer Sprache oder Teilfläche und `sprache.flaeche_aus_landschaft`). */
const SPRACHE_OPERATIONEN: ReadonlySet<string> = new Set([
    "sprache.create",
    "sprache_flaeche.create",
    "sprache.flaeche_aus_landschaft",
    "sprache.update",
    "sprache.wiki",
    "sprache.retire",
    "sprache.restore",
    "sprache.restore_series",
    "sprache_flaeche.reshape",
    "sprache_flaeche.parts",
    "sprache_flaeche.split",
    "sprache_flaeche.boolean",
    "sprache_flaeche.copy",
    "sprache_flaeche.retire",
    "sprache_flaeche.restore",
]);
/** Die Aktionen ihrer Protokolleinträge, die die Inverse des Servers kennt (`sprache.created` und `sprache_flaeche.created`/`.copied`: das Anlegen und Kopieren, auch in eine neue Sprache). */
const SPRACHE_AKTIONEN: ReadonlySet<string> = new Set([
    "sprache.created",
    "sprache.updated",
    "sprache.wiki_changed",
    "sprache.wiki_released",
    "sprache.retired",
    "sprache.restored",
    "sprache_flaeche.created",
    "sprache_flaeche.copied",
    "sprache_flaeche.reshaped",
    "sprache_flaeche.parts",
    "sprache_flaeche.split",
    "sprache_flaeche.boolean",
    "sprache_flaeche.retired",
    "sprache_flaeche.restored",
]);

/**
 * Eine Änderung im Spracheditor, die der Server zurücknimmt (WI-0265 B6e): Felder und Wiki-Artikel der Sprache, Stilllegen und Zurückholen von Sprache und Teilfläche, die Form und die
 * Werkzeuge an Teilflächen (auch das Kopieren in eine neue Sprache), seit B8c auch das Anlegen einer Sprache oder Teilfläche und die Kopie einer Fläche der Derographie (`sprache.flaeche_aus_landschaft`).
 */
export const istSprache = (operation: string, aktionen: readonly string[]): boolean =>
    SPRACHE_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    aktionen.every((aktion) => SPRACHE_AKTIONEN.has(aktion));

/** Die Operationen von Quelle, Werk, Korpus und Vorkommen, die der Server zurücknimmt (WI-0265 B6g1; seit B8d auch das Anlegen: Zurück heißt stillgelegt). */
const QUELLE_OPERATIONEN: ReadonlySet<string> = new Set(["source.create", "source.update", "source.restore_series"]);
const WERK_OPERATIONEN: ReadonlySet<string> = new Set(["work.create", "work.update", "work.restore_series"]);
const KORPUS_OPERATIONEN: ReadonlySet<string> = new Set(["corpus.create", "corpus.update", "corpus.restore_series"]);
const VORKOMMEN_OPERATIONEN: ReadonlySet<string> = new Set([
    "lore.create",
    "lore.update",
    "lore.rules_text",
    "lore.restore_series",
]);

/**
 * Eine Änderung einer Quelle (WI-0265 B6g1): ihre Felder und, seit B6g3, ihre Verwendungen an Trägern (`links`). Die Aktion `source.updated`, dazu `path.sources_changed` am Anker, wo die Änderung eine Straße
 * berührte (dieselbe Information, für den Verlauf des Wegs).
 */
export const istQuelle = (eintrag: Pick<MapHistoryEntry, "operation" | "objects">): boolean => {
    const aktionen = eintrag.objects.map((gegenstand) => gegenstand.action);
    return (
        QUELLE_OPERATIONEN.has(eintrag.operation) &&
        // Das Anlegen schreibt genau `source.created` (WI-0265 B8d).
        (aktionen.every((aktion) => aktion === "source.created") ||
            (aktionen.some((aktion) => aktion === "source.updated") &&
                aktionen.every((aktion) => aktion === "source.updated" || aktion === "path.sources_changed"))) &&
        aktionen.length > 0
    );
};
/** Eine Änderung der Felder oder der Ortsliste eines Werks (WI-0265 B6g1) und sein Anlegen (B8d). */
export const istWerk = (operation: string, aktionen: readonly string[]): boolean =>
    WERK_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    aktionen.every((aktion) => aktion === "work.updated" || aktion === "work.created");
/** Eine Änderung der Angaben eines Korpus samt Wirkung auf seine Quellen (WI-0265 B6g1) und sein Anlegen (B8d). */
export const istKorpus = (operation: string, aktionen: readonly string[]): boolean =>
    KORPUS_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    aktionen.every((aktion) => aktion === "corpus.updated" || aktion === "corpus.created");

/**
 * Eine Änderung am Vorkommen (WI-0265 B6g2): Felder, Ortszeilen, Quellenverknüpfungen und Regeln eines Eintrags (`lore.update`) und die Regeln und Quellen, die „Regeln als Text“ an bestehenden Einträgen
 * anlegte (`lore.rules_text`). Seit B8d auch das Anlegen (`lore.create`) und ein Eintrag, den „Regeln als Text“ anlegte (Aktion `lore.created`).
 */
export const istVorkommen = (operation: string, aktionen: readonly string[]): boolean =>
    VORKOMMEN_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    aktionen.every((aktion) => aktion === "lore.updated" || aktion === "lore.rules_text" || aktion === "lore.created");

/**
 * Zuweisen und Entfernen eines Wiki-Artikels in der Wiki-Box (WI-0265 B8d) und die Rücknahme davon: eine eigene Familie, ein Schritt steht als Einzeleintrag da und bildet nie eine Serie. Die Aktionen heißen
 * `<Protokollart>.wiki_zugewiesen` und `.wiki_entfernt`; die Protokollart nennt die Art der Box.
 */
const WIKIBOX_OPERATIONEN: ReadonlySet<string> = new Set([
    "wikibox.zuweisen",
    "wikibox.entfernen",
    "wikibox.weitere_zuweisen",
    "wikibox.weitere_entfernen",
    "wikibox.restore_series",
]);
const WIKIBOX_AKTION =
    /^(place|path|territory|region|powerline|peak)\.wiki_(zugewiesen|entfernt|weitere_zugewiesen|weitere_entfernt)$/u;
const WIKIBOX_ART: Readonly<Record<string, WikiBoxArt>> = {
    place: "ort",
    path: "weg",
    territory: "gebiet",
    region: "region",
    powerline: "kraftlinie",
    peak: "gipfel",
};
export const istWikiBox = (operation: string, aktionen: readonly string[]): boolean =>
    WIKIBOX_OPERATIONEN.has(operation) &&
    aktionen.length > 0 &&
    aktionen.every((aktion) => WIKIBOX_AKTION.test(aktion));

/**
 * Die Übernahme eines Laufs je Bereich und von Regelvorschlägen durch den WikiSync (Quelle `wikisync`, WI-0265 B8d) und ihre Rücknahmen samt der Gegenrichtung der Regelvorschläge (B8e): Das ↺ ruft die Rücknahme
 * auf, die der WikiSync selbst hat (Auftrag, Recht `undo_wikisync_run`, frischer Passkey). Die Adresse ist die Operation selbst. Die Rücknahme einer Rücknahme spielt die Werte der Übernahme wieder ein.
 */
const WIKISYNC_OPERATIONEN: ReadonlySet<string> = new Set([
    "wikisync.uebernehmen",
    "lore.rules_wikisync",
    "wikisync.zuruecknehmen",
    "lore.rules_wikisync_undo",
    "lore.rules_wikisync_redo",
]);
/**
 * Die Schritte des WikiSync, die der Editor am Objekt auslöst (WI-0265 B8e): der Sync eines Objekts in der Wiki-Box und seine Rücknahme (Auftrag) und die Zuweisung eines Artikels an eine Fläche im Regelfenster
 * (sofort). Recht `edit_map_objects` wie vorwärts; eine eigene Route. Seit B8e2 hat auch die Rücknahme der Zuweisung ein ↺: Es stellt dieselbe Zuweisung wieder her (`wikisync.flaeche_wiederherstellen`).
 */
const WIKISYNC_SCHRITT_OPERATIONEN: ReadonlySet<string> = new Set([
    "wikisync.objekt_sync",
    "wikisync.objekt_zuruecknehmen",
    "wikisync.flaeche_zuweisen",
    "wikisync.flaeche_zuruecknehmen",
    "wikisync.flaeche_wiederherstellen",
]);
export const istWikiSync = (eintrag: Pick<MapHistoryEntry, "operation" | "source">): boolean =>
    eintrag.source === "wikisync" && WIKISYNC_OPERATIONEN.has(eintrag.operation);
export const istWikiSyncSchritt = (eintrag: Pick<MapHistoryEntry, "operation" | "source">): boolean =>
    eintrag.source === "wikisync" && WIKISYNC_SCHRITT_OPERATIONEN.has(eintrag.operation);

const aktionenVon = (eintrag: MapHistoryEntry): string[] => eintrag.objects.map((gegenstand) => gegenstand.action);

/** Welche Familie der Server für diesen Eintrag kennt, oder `undefined` (dann bietet die Oberfläche kein ↺ an, B6). */
export function ruecknahmeFamilie(eintrag: MapHistoryEntry): RuecknahmeFamilie | undefined {
    if (istWikiSync(eintrag)) return "wikisync";
    if (istWikiSyncSchritt(eintrag)) return "wikisyncschritt";
    // „In Landmarke umwandeln …“ und seine Rücknahme (WI-0271 L8): eine eigene Familie, sie berührt Ort und Landmarke zugleich und hängt an der Landmarke.
    if (eintrag.operation === "landmarke.umwandeln" || eintrag.operation === "landmarke.restore_series")
        return "umwandlung";
    const aktionen = aktionenVon(eintrag);
    // Berührt der Eintrag nur Gipfel, hängt er an einem Gipfel (eine Serie von „Fertig“ an einem Gipfel); sonst an seiner Landschaft (auch ein „Entfernen …“, das einen Gipfel mitnahm).
    if (istDerographie(eintrag.operation, aktionen))
        return eintrag.objects.every((gegenstand) => gegenstand.kind === "peak") ? "peak" : "landscape";
    // Eine Umgruppierung oder Verbindung, die selbst ein Client-↺ war (Altbestand, Quelle `restore`), ist keine Umkehrung und hat kein ↺ (wie im Server).
    const weg = wegArt(eintrag.operation, aktionen);
    if (weg !== undefined && !((weg === "umgruppieren" || weg === "verbinden") && eintrag.source === "restore"))
        return "path";
    if (ortArt(eintrag.operation, aktionen) !== undefined) return "place";
    if (gebietArt(eintrag.operation, aktionen) !== undefined) return "territory";
    if (istSprache(eintrag.operation, aktionen)) return "sprache";
    if (istQuelle(eintrag)) return "source";
    if (istWerk(eintrag.operation, aktionen)) return "work";
    if (istKorpus(eintrag.operation, aktionen)) return "corpus";
    if (istVorkommen(eintrag.operation, aktionen)) return "lore";
    if (istWikiBox(eintrag.operation, aktionen)) return "wikibox";
    if (istNodix(eintrag.operation, aktionen)) return "nodix";
    return linienArt(eintrag.operation, aktionen) === undefined ? undefined : "powerline";
}

/** Die Art des Gegenstands, an dem die Route der Familie hängt (die Wiki-Box nennt ihre Art selbst: `WIKIBOX_ART`). */
const ZIEL_ART: Readonly<
    Record<Exclude<RuecknahmeFamilie, "wikibox" | "wikisync" | "wikisyncschritt">, MapHistoryObjectKind>
> = {
    landscape: "landscape",
    place: "place",
    path: "path",
    peak: "peak",
    umwandlung: "peak",
    territory: "territory",
    powerline: "powerline",
    nodix: "nodix",
    sprache: "sprache",
    source: "source",
    work: "work",
    corpus: "corpus",
    lore: "lore",
};

/**
 * Die Adresse der Rücknahme eines Eintrags. Die Derographie hängt an ihrer Landschaft: Der Eintrag nennt die Landschaft oder die Teilfläche oder Beschriftung, und diese nennen ihre Landschaft
 * (`landscape` am Gegenstand, WI-0265 B5d), sodass auch eine einzelne Änderung ohne Serie ihre Adresse kennt; eine ältere Antwort ohne das Feld behilft sich mit
 * `series.scope`. Der Objektverlauf der Landschaft und des Gipfels kennt sie ohnehin (`VerlaufsArt.ruecknahmeZiel`). Ort, Weg, Gipfel, Gebiet und Kraftlinie stehen im Eintrag selbst (die Linie
 * mit einem ihrer Abschnitte).
 */
export function ruecknahmeZiel(
    eintrag: MapHistoryEntry,
    serie?: Pick<MapHistorySeries, "scope"> | undefined,
): RuecknahmeZiel | undefined {
    const familie = ruecknahmeFamilie(eintrag);
    if (familie === undefined) return undefined;
    // Die Übernahme des WikiSync: die Operation selbst ist die Adresse (die Route hängt an ihr), nicht ein Gegenstand.
    if (familie === "wikisync" || familie === "wikisyncschritt") return { familie, id: eintrag.operationId };
    if (familie === "wikibox") {
        // Der Träger ist der erste Gegenstand des Eintrags (beim Weg und bei der Kraftlinie ein Abschnitt, jeder genügt); seine Art steht in der Aktion.
        const erster = eintrag.objects[0];
        const boxArt = erster === undefined ? undefined : WIKIBOX_ART[erster.action.split(".")[0] ?? ""];
        return erster === undefined || boxArt === undefined ? undefined : { familie, id: erster.id, art: boxArt };
    }
    const art = ZIEL_ART[familie];
    // Die Landschaft des ERSTEN Gegenstands, der eine nennt (er selbst oder seine Teilfläche oder Beschriftung): bei einem Werkzeug die der Quelle, bei einem „Entfernen …“ die erste der Auswahl.
    // Jede Landschaft der Operation wäre für den Server richtig (jedes Mitglied berührt sie).
    if (familie === "landscape") {
        for (const gegenstand of eintrag.objects) {
            const landschaft = gegenstand.kind === "landscape" ? gegenstand.id : gegenstand.landscape?.id;
            if (landschaft !== undefined) return { familie, id: landschaft };
        }
    } else {
        const eigener = eintrag.objects.find((gegenstand) => gegenstand.kind === art);
        if (eigener !== undefined) return { familie, id: eigener.id };
    }
    // Entfernen von der Karte und Vereinigen schreiben nur Flächen ins Protokoll; die Fläche nennt ihr Gebiet (WI-0265 B6b).
    const gebiet =
        familie === "territory"
            ? eintrag.objects.find((gegenstand) => gegenstand.territory !== undefined)?.territory
            : undefined;
    if (gebiet !== undefined) return { familie, id: gebiet.id };
    // Stilllegen, Umformen und die Werkzeuge schreiben nur Teilflächen ins Protokoll; die Teilfläche nennt ihre Sprache (WI-0265 B6e).
    const sprache =
        familie === "sprache"
            ? eintrag.objects.find((gegenstand) => gegenstand.sprache !== undefined)?.sprache
            : undefined;
    if (sprache !== undefined) return { familie, id: sprache.id };
    if (serie?.scope.kind === art) return { familie, id: serie.scope.id };
    return undefined;
}

// --- Das Angebot -----------------------------------------------------------------------------------------------------------

/**
 * Warum ein ↺ nicht angeboten wird, soweit die Liste es schon weiß. `quelle` und `nichtArt` sind der Zustand `nicht_ruecknehmbar` der Liste (Grund `quelle`: Import, WikiSync, Testwelt;
 * Grund `art`: eine Art Änderung, die keine Familie zurücknimmt, WI-0265 B6f): Es gibt dort gar kein ↺, der Satz steht im Detail. `art` dagegen ist ein gesperrtes ↺ (ein Verschieben oder
 * eine Kurve in einer Serie), das der Server noch ablehnen würde.
 */
export type Sperrgrund =
    | { readonly art: "zurueck" }
    | { readonly art: "quelle" }
    | { readonly art: "nichtArt" }
    | { readonly art: "art" }
    | { readonly art: "ueberholt"; readonly position: number };

/** Was ein ↺ an einem Eintrag oder einer Serie tut: die Adresse, die Mitglieder, die Prüfsumme, und was die Liste vorab sperrt. */
export interface RuecknahmeAngebot {
    readonly modus: "einzeln" | "serie";
    readonly ziel: RuecknahmeZiel;
    /** Die Kennungen, die an den Server gehen: die GANZE Serie (auch ihre schon zurückgenommenen Mitglieder) oder genau eine. */
    readonly mitglieder: readonly string[];
    /** Die Prüfsumme der Serie aus der Liste; bei einer Einzelrücknahme rechnet der Server sie. */
    readonly membersHash: string | undefined;
    /** Wie viele Mitglieder die Liste als offen kennt (für die Aufschrift „Gesamte Serie zurücknehmen (8)“). */
    readonly offen: number;
    /** Die Mitglieder, die die Liste geliefert hat, älteste zuerst (für Zeiten und Namen in der Rückfrage). */
    readonly eintraege: readonly MapHistoryEntry[];
    readonly sperre: Sperrgrund | undefined;
    /** Ändert sich der Schlüssel, ist es ein anderes ↺ (die Rückfrage des alten wird verworfen). */
    readonly schluessel: string;
}

/** Das spätere offene Mitglied der Serie, das diesen Eintrag überholt („überholt durch Schritt 6“). */
function ueberholtDurch(
    eintrag: MapHistoryEntry,
    mitglieder: readonly MapHistoryEntry[],
): { readonly position: number } | undefined {
    const position = eintrag.series?.position;
    if (position === undefined) return undefined;
    const spaeter = mitglieder
        .filter((m) => (m.series?.position ?? 0) > position && m.status === "ruecknehmbar")
        .map((m) => m.series!.position);
    return spaeter.length === 0 ? undefined : { position: Math.min(...spaeter) };
}

function einzelSperre(eintrag: MapHistoryEntry, mitglieder: readonly MapHistoryEntry[]): Sperrgrund | undefined {
    if (eintrag.status === "bereits_zurueckgenommen") return { art: "zurueck" };
    if (eintrag.status === "nicht_ruecknehmbar") return { art: eintrag.statusReason === "art" ? "nichtArt" : "quelle" };
    const durch = ueberholtDurch(eintrag, mitglieder);
    return durch === undefined ? undefined : { art: "ueberholt", position: durch.position };
}

/**
 * Das ↺ an EINEM Eintrag (nur das letzte offene Mitglied einer Serie): `serie` sind die Mitglieder seiner Serie, soweit die Liste sie hat, in
 * beliebiger Folge. Ohne Adresse gibt es kein Angebot.
 */
export function angebotEinzeln(
    eintrag: MapHistoryEntry,
    ziel: RuecknahmeZiel | undefined,
    serie: readonly MapHistoryEntry[] = [],
): RuecknahmeAngebot | undefined {
    if (ziel === undefined || ruecknahmeFamilie(eintrag) !== ziel.familie) return undefined;
    return {
        modus: "einzeln",
        ziel,
        mitglieder: [eintrag.operationId],
        membersHash: undefined,
        offen: eintrag.status === "ruecknehmbar" ? 1 : 0,
        eintraege: [eintrag],
        sperre: einzelSperre(eintrag, serie),
        schluessel: `einzeln:${eintrag.operationId}`,
    };
}

/** Felder und die Quellen des Trägers bilden zusammen eine Serie (WI-0265 B6g3); alles andere (Verschieben, Löschen, Entfernen, Kurve, Stand) geht allein. */
const istFelderOderQuellen = (art: string | undefined): boolean => art === "felder" || art === "quellen";

/** Was eine Serie mit einem Anlegen enthalten darf (WI-0265 B8a): danach ist nur noch stillzulegen, jede dieser Änderungen ändert daran nichts. */
const IN_ORT_ANLEGEN_SERIE: ReadonlySet<string | undefined> = new Set<string | undefined>([
    "anlegen",
    "felder",
    "quellen",
    "verschieben",
    "abnehmen",
    "aufsetzen",
]);
const IN_WEG_ANLEGEN_SERIE: ReadonlySet<string | undefined> = new Set<string | undefined>([
    "anlegen",
    "felder",
    "quellen",
    "kurve",
    "felderkurve",
]);

/**
 * Ob ein Mitglied in einer Serie zurückgenommen werden kann: am Ort, Gebiet und Weg Felder und Quellen (am Gebiet auch das Anlegen), an der Linie Änderungen der Linie; an der Derographie jedes. Beginnt die
 * Serie am Ort oder Weg mit einem Anlegen (`mitAnlegen`), geht sie als Ganzes zurück und darf mehr enthalten (WI-0265 B8a).
 */
function gehtInSerie(familie: RuecknahmeFamilie, mitglied: MapHistoryEntry, mitAnlegen = false): boolean {
    const aktionen = aktionenVon(mitglied);
    if (familie === "place") {
        const art = ortArt(mitglied.operation, aktionen);
        return mitAnlegen ? IN_ORT_ANLEGEN_SERIE.has(art) : istFelderOderQuellen(art);
    }
    if (familie === "territory") {
        const art = gebietArt(mitglied.operation, aktionen);
        // Auch ein Entfernen oder Vereinigen, das nur ein Gebiet berührte (WI-0265 B8b2); „Unter neues Obergebiet …“ und das Zurückholen gehen allein.
        return (
            istFelderOderQuellen(art) ||
            art === "anlegen" ||
            art === "grenze" ||
            (art === "entfernen" &&
                (mitglied.operation === "territory.retire" || mitglied.operation === "territory.merge"))
        );
    }
    if (familie === "powerline") return linienArt(mitglied.operation, aktionen) === "linie";
    return true;
}

/**
 * Das ↺ an einer Serie: die GANZE Mitgliederliste der Serie samt Prüfsumme, so wie die Liste sie geliefert hat. Der Server weitet nie still aus; ist die
 * Serie gewachsen, antwortet er `series_changed`. Eine Serie, die die Oberfläche nicht ganz kennt (ohne `meta`) oder die der Server nicht kennt, bietet
 * nichts an.
 */
export function angebotSerie(zeile: SerienZeile, ziel: RuecknahmeZiel | undefined): RuecknahmeAngebot | undefined {
    const meta = zeile.meta;
    const neuestes = zeile.mitglieder[0];
    if (meta === undefined || ziel === undefined || neuestes === undefined) return undefined;
    if (zeile.mitglieder.some((m) => ruecknahmeFamilie(m) !== ziel.familie)) return undefined;
    const aelteste = [...zeile.mitglieder].reverse();
    const offen = zeile.mitglieder.filter((m) => m.status === "ruecknehmbar").length;
    // Beginnt die Serie mit einem Anlegen (Ort oder Weg), wird der Gegenstand als Ganzes stillgelegt (WI-0265 B8a).
    const mitAnlegen = zeile.mitglieder.some((m) => {
        const aktionen = aktionenVon(m);
        return (
            (ziel.familie === "place" && ortArt(m.operation, aktionen) === "anlegen") ||
            (ziel.familie === "path" && wegArt(m.operation, aktionen) === "anlegen")
        );
    });
    let sperre: Sperrgrund | undefined;
    if (zeile.mitglieder.every((m) => m.status === "bereits_zurueckgenommen")) sperre = { art: "zurueck" };
    else if (zeile.mitglieder.every((m) => m.status === "nicht_ruecknehmbar"))
        sperre = { art: zeile.mitglieder.every((m) => m.statusReason === "art") ? "nichtArt" : "quelle" };
    else if (zeile.mitglieder.some((m) => !gehtInSerie(ziel.familie, m, mitAnlegen)))
        // Ein Verschieben, Löschen, Entfernen oder Abnehmen geht allein; eine Serie sind nur Felder (`pruefeListe` der Adapter). Beginnt sie mit einem Anlegen, darf mehr darin stehen.
        sperre = { art: "art" };
    else if (
        ziel.familie === "path" &&
        zeile.mitglieder.some((m) => {
            const art = wegArt(m.operation, aktionenVon(m));
            return !(mitAnlegen ? IN_WEG_ANLEGEN_SERIE.has(art) : istFelderOderQuellen(art));
        })
    )
        // Dasselbe am Weg: Eine Serie sind nur Felder und Quellen (mit einem Anlegen davor auch Kurven); ein Wechsel des Stands geht allein.
        sperre = { art: "art" };
    return {
        modus: "serie",
        ziel,
        mitglieder: meta.members,
        membersHash: meta.membersHash,
        offen,
        eintraege: aelteste,
        sperre,
        schluessel: `serie:${meta.id}`,
    };
}

// --- Die Rückfrage ----------------------------------------------------------------------------------------------------------

/** Eine Zeile der Liste „Zurückgenommen wird“: der Vorgang, die Zeit und die Gegenstände. */
export interface BetroffenZeile {
    readonly operationId: string;
    readonly titel: string;
    readonly zeit: string;
    readonly gegenstaende: string;
}

/** Die offenen Mitglieder der Vorprüfung als Zeilen, älteste zuerst; in einer Serie mit „Schritt 3/8“. */
export function betroffenZeilen(pruefung: Pick<RuecknahmePruefung, "mitglieder" | "offen">): BetroffenZeile[] {
    const offen = new Set(pruefung.offen);
    return pruefung.mitglieder
        .filter((m) => offen.has(m.operationId))
        .sort((a, b) => a.seq - b.seq)
        .map((m) => {
            const namen = [...new Set(m.gegenstaende.map((g) => g.name ?? artName(g.kind)))];
            const vorgang = vorgangName(
                m.operation,
                m.gegenstaende.map((g) => g.action),
            );
            return {
                operationId: m.operationId,
                titel:
                    m.series === undefined
                        ? vorgang
                        : `${t("aenderungen.serie.schritt", { nr: m.series.position, gesamt: m.series.size })}: ${vorgang}`,
                zeit: m.series === undefined ? zeitMitZone(m.at) : uhrzeit(m.at),
                gegenstaende: namen.join(", "),
            };
        });
}

/** So viele Namen nennt die Rückfrage beim Zurückholen eines Gebiets, danach „und n weitere“. */
const GEBIETSNAMEN = 6;

/**
 * Was das Zurückholen eines entfernten Gebiets mitnimmt (EDIT-0003 T54, R13; früher das Blatt der Folgen im Verlauf des Gebiets): welche Gebiete zurückkommen, wie viele Untergebiete wieder wie
 * vorher hängen, welche Flächen zurück auf die Karte gehen, und dass danach neu abgeleitet wird. Gelesen aus den Gegenständen der Vorprüfung, die Sätze stehen in den Tafeln des Gebietseditors.
 */
function gebietFolgen(pruefung: Pick<RuecknahmePruefung, "mitglieder" | "offen">): string[] {
    const offen = new Set(pruefung.offen);
    const entfernen = pruefung.mitglieder.filter((m) => offen.has(m.operationId) && m.operation === "territory.retire");
    if (entfernen.length === 0) return [];
    const gegenstaende = entfernen.flatMap((m) => m.gegenstaende);
    const zeilen: string[] = [];
    const gebiete = gegenstaende.filter((g) => g.kind === "territory" && g.felder.includes("active"));
    if (gebiete.length > 0) {
        const namen = gebiete.slice(0, GEBIETSNAMEN).map((g) => g.name ?? "–");
        zeilen.push(
            t("gebietseditor.zurueckholen.gebiete", {
                namen:
                    gebiete.length > GEBIETSNAMEN
                        ? t("gebietseditor.zurueckholen.weitere", {
                              namen: namen.join(", "),
                              n: formatNumber(gebiete.length - GEBIETSNAMEN, 0),
                          })
                        : namen.join(", "),
            }),
        );
    }
    const umgehaengt = gegenstaende.filter((g) => g.kind === "territory" && g.felder.includes("parent"));
    if (umgehaengt.length > 0)
        zeilen.push(t("gebietseditor.zurueckholen.kinder", { n: formatNumber(umgehaengt.length, 0) }));
    const flaechen = gegenstaende.filter((g) => g.kind === "territory_area" && g.felder.includes("active"));
    if (flaechen.length > 0)
        zeilen.push(t("gebietseditor.zurueckholen.flaechen", { n: formatNumber(flaechen.length, 0) }));
    zeilen.push(t("gebietseditor.entfernen.ableitung"));
    return zeilen;
}

/**
 * Die Folgen, die die Rückfrage VOR dem Schreiben nennt: Gegenstände, Wegenden und was mit dem Gelände geschieht. Am Weg (alle Gegenstände sind Wege) sind es keine mitgezogenen
 * Wegenden: Dort nennt die Rückfrage, wie viele Abschnitte zurück auf die Karte kommen (EDIT-0003 R13, wie früher das Blatt des Wegverlaufs).
 */
export function folgenZeilen(pruefung: Pick<RuecknahmePruefung, "mitglieder" | "offen" | "folgen">): string[] {
    const zeilen: string[] = [];
    const offen = new Set(pruefung.offen);
    const betroffen = pruefung.mitglieder.filter((m) => offen.has(m.operationId));
    const nurWege = betroffen.length > 0 && betroffen.every((m) => m.gegenstaende.every((g) => g.kind === "path"));
    const wegenden = new Set(
        betroffen.flatMap((m) => m.gegenstaende.filter((g) => g.kind === "path").map((g) => g.id)),
    );
    if (nurWege) {
        // Zurück auf die Karte kommt, was die Operation von der Karte nahm (gelöscht oder abgenommen).
        const zurueck = new Set(
            betroffen.flatMap((m) =>
                m.gegenstaende
                    .filter(
                        (g) =>
                            g.action === "path.deleted" ||
                            g.action === "path.taken_off_map" ||
                            // „Wege verbinden“ zurück: Die still gelegten Abschnitte (Feld `active`) kommen auf die Karte. Die Rücknahme davon (`path.restore_series`) legt sie wieder still.
                            (m.operation === "path.join" &&
                                g.action === "path.joined" &&
                                g.felder.includes("active")) ||
                            // Das Zusammenlegen der Teile zurück: Der hintere Teil kommt wieder auf die Karte (WI-0265 B8a).
                            (g.action === "path.merged" && g.felder.includes("active")),
                    )
                    .map((g) => g.id),
            ),
        );
        if (zurueck.size > 0)
            zeilen.push(
                tPlural("wegeditor.zurueckholen.abschnitte", zurueck.size, { n: formatNumber(zurueck.size, 0) }),
            );
    } else if (wegenden.size > 0)
        zeilen.push(t("aenderungen.ruecknahme.folgen.wegenden", { n: formatNumber(wegenden.size, 0) }));
    if (pruefung.folgen.gegenstaende > 1 && (nurWege || wegenden.size === 0))
        zeilen.push(
            t("aenderungen.ruecknahme.folgen.gegenstaende", { n: formatNumber(pruefung.folgen.gegenstaende, 0) }),
        );
    zeilen.push(...gebietFolgen(pruefung));
    // Der WikiSync nimmt Feld für Feld zurück und als Auftrag (WI-0265 B8d): Das Blatt sagt es vor dem Schreiben. Der Sync eines Objekts und die Zuweisung einer Fläche (B8e) sagen ihr Eigenes.
    const wikisync = betroffen.filter((m) => m.source === "wikisync");
    if (wikisync.some((m) => istWikiSync(m))) zeilen.push(t("aenderungen.ruecknahme.folgen.wikisync"));
    if (wikisync.some((m) => m.operation === "wikisync.objekt_sync" || m.operation === "wikisync.objekt_zuruecknehmen"))
        zeilen.push(t("aenderungen.ruecknahme.folgen.wikisyncObjekt"));
    if (
        wikisync.some(
            (m) => m.operation === "wikisync.flaeche_zuweisen" || m.operation === "wikisync.flaeche_wiederherstellen",
        )
    )
        zeilen.push(t("aenderungen.ruecknahme.folgen.wikisyncFlaeche"));
    if (wikisync.some((m) => m.operation === "wikisync.flaeche_zuruecknehmen"))
        zeilen.push(t("aenderungen.ruecknahme.folgen.wikisyncFlaecheWieder"));
    if (pruefung.folgen.gelaende === "lokal") zeilen.push(t("aenderungen.ruecknahme.folgen.gelaende.lokal"));
    else if (pruefung.folgen.gelaende === "veraltet") zeilen.push(t("aenderungen.ruecknahme.folgen.gelaende.veraltet"));
    return zeilen;
}

/** Wer die Änderungen schrieb, wenn es eine andere Person ist (der Grund ist dann Pflicht): die Namen der fremden Personen. */
export function fremdeNamen(pruefung: Pick<RuecknahmePruefung, "fremdePersonen">): string {
    const namen = pruefung.fremdePersonen.map((person) => person.name).filter((name): name is string => !!name);
    return [...new Set(namen)].join(", ");
}

/**
 * Der Gegenstand, den „Konflikt prüfen“ zeigt: der des Konflikts, bei einer Teilfläche oder Beschriftung (`area`, `label`, die kein Fenster haben) die Landschaft der Rücknahme, bei einer Fläche
 * des Gebiets (`territory_area`) das Gebiet.
 */
export function konfliktGegenstand(
    konflikt: Pick<RuecknahmeKonflikt, "kind" | "id" | "name">,
    ziel: RuecknahmeZiel,
): { readonly kind: MapHistoryObjectKind; readonly id: string; readonly name?: string | undefined } {
    if (ziel.familie === "landscape" && (konflikt.kind === "area" || konflikt.kind === "label"))
        return { kind: "landscape", id: ziel.id };
    // Eine Fläche des Gebiets hat kein Fenster: Es zeigt das Gebiet der Rücknahme (WI-0265 B6b).
    if (ziel.familie === "territory" && konflikt.kind === "territory_area") return { kind: "territory", id: ziel.id };
    // Eine Teilfläche einer Sprache ebenso: Das Fenster der Sprache zeigt sie (WI-0265 B6e).
    if (ziel.familie === "sprache" && konflikt.kind === "sprache_flaeche") return { kind: "sprache", id: ziel.id };
    return { kind: konflikt.kind, id: konflikt.id, name: konflikt.name };
}

/** Eine Zeile der Konfliktliste: Gegenstand, was geschah, von wem und wann, die Felder. */
export interface KonfliktZeile {
    readonly objekt: string;
    /** Die Art des Konflikts in einem Wort („später geändert“, „Wert weicht ab“). */
    readonly art: string;
    /** Bei `wert`: was abweicht, als Satz aus den Sprachtafeln; fehlt ohne `abweichung` des Servers. */
    readonly satz: string | undefined;
    readonly von: string | undefined;
    /** Die geänderten Felder; nicht, wo `satz` sie schon nennt. */
    readonly felder: string | undefined;
    /** Der deutsche Satz des Servers, nur als Hinweis beim Überfahren (`title`), nie als sichtbarer Text. */
    readonly hinweis: string | undefined;
    readonly konflikt: RuecknahmeKonflikt;
}

const KONFLIKT_ART = {
    spaeter: "aenderungen.ruecknahme.konflikt.art.spaeter",
    ueberholt: "aenderungen.ruecknahme.konflikt.art.ueberholt",
    revision: "aenderungen.ruecknahme.konflikt.art.revision",
    geloescht: "aenderungen.ruecknahme.konflikt.art.geloescht",
    wert: "aenderungen.ruecknahme.konflikt.art.wert",
} as const;

const NETZ_TEIL = {
    kaemme: "aenderungen.ruecknahme.konflikt.netz.kaemme",
    nebengipfel: "aenderungen.ruecknahme.konflikt.netz.nebengipfel",
    mulden: "aenderungen.ruecknahme.konflikt.netz.mulden",
    flussHoehen: "aenderungen.ruecknahme.konflikt.netz.flussHoehen",
    seeHoehen: "aenderungen.ruecknahme.konflikt.netz.seeHoehen",
} as const;

/** Eine Lage in Kartenkoordinaten, so wie die Rückfrage sie nennt: „(412 | 307)“. */
const lageText = (punkt: { readonly x: number; readonly y: number }): string =>
    `(${formatDecimal(punkt.x, 1)} | ${formatDecimal(punkt.y, 1)})`;

type FeldName = (kind: RuecknahmeKonflikt["kind"], feld: string) => string;

/** „Heute anders als nach dem letzten Schritt: Höhe des Kamms, Gezeichnete Kämme (Kämme, Mulden).“; `undefined`, wenn kein Feld abweicht. */
function felderSatz(konflikt: RuecknahmeKonflikt, feldName: FeldName): string | undefined {
    const teile = konflikt.abweichung?.netzTeile ?? [];
    const namen = (konflikt.felder ?? [])
        // Das Netz steht bei einer gewanderten Flusshöhe in `felder`, ohne selbst abzuweichen: Dann nennt der Satz davor die Ursache.
        .filter((feld) => feld !== "netz" || teile.length > 0)
        .map((feld) =>
            feld === "netz" && teile.length > 0
                ? t("aenderungen.ruecknahme.konflikt.netz.teile", {
                      netz: feldName(konflikt.kind, feld),
                      teile: teile.map((teil) => t(NETZ_TEIL[teil])).join(", "),
                  })
                : feldName(konflikt.kind, feld),
        );
    return namen.length === 0
        ? undefined
        : t("aenderungen.ruecknahme.konflikt.satz.felder", { felder: namen.join(", ") });
}

/** Die Namen der Felder eines Konflikts, durch Komma getrennt („Name, Wegart“). */
const felderListe = (konflikt: RuecknahmeKonflikt, feldName: FeldName): string =>
    (konflikt.felder ?? []).map((feld) => feldName(konflikt.kind, feld)).join(", ");

/**
 * Der Satz zu einer Abweichung der Werte (`art: wert`), aus dem Schlüssel des Servers und den Sprachtafeln: nie der deutsche Satz des Servers, nie ein roher Feldschlüssel.
 * Ohne `abweichung` (ein älterer Server, ein Konflikt anderer Art) gibt es keinen Satz.
 */
export function abweichungSatz(konflikt: RuecknahmeKonflikt, feldName: FeldName): string | undefined {
    const abweichung = konflikt.abweichung;
    if (abweichung === undefined) return undefined;
    const lagen = {
        heute: abweichung.heute === undefined ? "–" : lageText(abweichung.heute),
        erwartet: abweichung.erwartet === undefined ? "–" : lageText(abweichung.erwartet),
    };
    switch (abweichung.was) {
        case "felder":
            return felderSatz(konflikt, feldName);
        case "flusshoehe": {
            const ursache = t("aenderungen.ruecknahme.konflikt.satz.flusshoehe");
            const rest = felderSatz(konflikt, feldName);
            return rest === undefined ? ursache : `${ursache} ${rest}`;
        }
        case "ort_geloescht":
            return t("aenderungen.ruecknahme.konflikt.satz.ortGeloescht");
        case "ort_nicht_auf_karte":
            return t("aenderungen.ruecknahme.konflikt.satz.ortNichtAufKarte");
        case "ort_lage":
            return t("aenderungen.ruecknahme.konflikt.satz.ortLage", lagen);
        case "weg_fehlt":
            return t("aenderungen.ruecknahme.konflikt.satz.wegFehlt");
        case "weg_anfang":
            return t("aenderungen.ruecknahme.konflikt.satz.wegAnfang", lagen);
        case "weg_ende":
            return t("aenderungen.ruecknahme.konflikt.satz.wegEnde", lagen);
        case "weg_strasse":
            return t("aenderungen.ruecknahme.konflikt.satz.wegStrasse", { felder: felderListe(konflikt, feldName) });
        case "weg_wert":
            return t("aenderungen.ruecknahme.konflikt.satz.wegWert", { felder: felderListe(konflikt, feldName) });
        case "flaeche_nachbar":
            return t("aenderungen.ruecknahme.konflikt.satz.flaecheNachbar");
        case "gipfel_wert":
            return t("aenderungen.ruecknahme.konflikt.satz.gipfelWert", { felder: felderListe(konflikt, feldName) });
        case "sprache_wiki":
            return t("aenderungen.ruecknahme.konflikt.satz.spracheWiki");
        case "ort_kraftlinie":
            return t("aenderungen.ruecknahme.konflikt.satz.ortKraftlinie");
        case "ort_auf_karte":
            return t("aenderungen.ruecknahme.konflikt.satz.ortAufKarte");
        case "weg_am_ort":
            return t("aenderungen.ruecknahme.konflikt.satz.wegAmOrt");
        case "zuordnung":
            return t("aenderungen.ruecknahme.konflikt.satz.zuordnung");
        case "inhalt_verwendet":
            return t("aenderungen.ruecknahme.konflikt.satz.inhaltVerwendet", {
                felder: felderListe(konflikt, feldName),
            });
        case "wikibox_artikel":
            return t("aenderungen.ruecknahme.konflikt.satz.wikiboxArtikel");
        case "wikibox_teilweise":
            return t("aenderungen.ruecknahme.konflikt.satz.wikiboxTeilweise");
    }
}

export function konfliktZeilen(
    konflikte: readonly RuecknahmeKonflikt[],
    feldName: FeldName = (_kind, feld) => feld,
): KonfliktZeile[] {
    return konflikte.map((konflikt) => {
        const person = konflikt.changedBy === undefined ? undefined : wer(konflikt.changedBy as MapHistoryActor);
        const wann = konflikt.changedAt === undefined ? undefined : zeitMitZone(konflikt.changedAt);
        const von =
            person === undefined && wann === undefined
                ? undefined
                : t("aenderungen.ruecknahme.konflikt.von", { wer: person ?? "–", wann: wann ?? "–" });
        const satz = abweichungSatz(konflikt, feldName);
        // Nennt der Satz die Felder schon, steht die Zeile „Felder: …“ nicht noch einmal da.
        const felderZeile =
            konflikt.abweichung !== undefined || konflikt.felder === undefined || konflikt.felder.length === 0
                ? undefined
                : t("aenderungen.ruecknahme.konflikt.felder", {
                      felder: konflikt.felder.map((feld) => feldName(konflikt.kind, feld)).join(", "),
                  });
        return {
            objekt: konflikt.name ?? artName(konflikt.kind),
            art: t(KONFLIKT_ART[konflikt.art]),
            satz,
            von,
            felder: felderZeile,
            hinweis: konflikt.detail === undefined || konflikt.detail === "" ? undefined : konflikt.detail,
            konflikt,
        };
    });
}
