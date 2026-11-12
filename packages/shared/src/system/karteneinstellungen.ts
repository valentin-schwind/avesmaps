import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { airProfileIds } from "../air.ts";
import { DEPARTURE_MONTHS, NAMELESS_DAYS, NAMELESS_MONTH } from "../calendar.ts";
import { canonColour } from "../design-canon-registry.ts";
import { AVENTURIA } from "../map-domain-registry.ts";
import { OperationId } from "../operation.ts";
import { AVENTURIA_POLITICAL_CARTOGRAPHY } from "../political-cartography-registry.ts";
import { ROUTE_DEFAULTS } from "../route.ts";
import { AVENTURIA_TRAVEL_MODEL } from "../travel-model-registry.ts";
import { DEFAULT_LODGING, LODGING_LEVELS } from "../travel-model.ts";
import { MAX_VIEW_BAND, renderZoomForBand } from "../zoom-bands.ts";
import { KARTENSERIEN_VORGABE_REIHENFOLGE } from "./kartenserien.ts";
import { WegfindungImBrowser } from "./wegfindung.ts";

/**
 * Die Karteneinstellungen der Systemsteuerung (WI-0166): die Voreinstellungen, mit denen Avesmaps jeden Besuch beginnt.
 * Betreiber 2026-10-15: „bau in der systemsteuerung einen neuen Reiter "Karteneinstellungen" und wir beginnen max mit
 * "Startposition" und "Startzoom"“, und danach: „Karteneinstellungen soll zum anlaufpunkt für alle (vor)einstellungen werden,
 * die wir so haben“.
 *
 * 🔴 **Diese Tafel ist die Quelle der Wahrheit** für den Reiter, den Leseweg des Servers, die Prüfung einer Eingabe und den
 * Start der Karte. Die Namen und Sätze stehen in den Sprachtafeln (`admin.karteneinstellungen.*`), nicht hier.
 *
 * 🔴 **Gespeichert wird nur, was verstellt ist** (`map_setting`, Migration 0134), wie bei der Wegfindung: Zurücksetzen löscht
 * die Zeile. Eine gespeicherte Zahl, die heute zufällig der Vorgabe gleicht, verdeckte sonst eine spätere Änderung im Code.
 *
 * Anders als bei der Wegfindung ist ein Wert hier nicht immer eine Zahl: Die Startposition ist ein Punkt, ein Transportmittel
 * ein Name, „Eiltempo“ ein Schalter. Darum steht der Wert als JSON in der Tafel, und jede Einstellung trägt ihre Art (`zahl`,
 * `punkt`, `auswahl`, `schalter`, `reisebeginn`, `farbe`); eine neue Art kommt hier dazu, nicht in einer zweiten Tafel.
 *
 * 🔴 **Eine Voreinstellung bestimmt nur den Start eines neuen Besuchs, nie die Bedeutung eines Links** (Betreiber 2026-10-15:
 * „so dass alte Links gleich bleiben“). Adresse und Kurzlink schreiben nur die Abweichung von der FESTEN Vorgabe im Code
 * (`DEFAULT_OPTIONS`, `DEFAULT_AIR_CHOICE` im Planer); gelesen wird jeder Link gegen dieselbe feste Vorgabe. Darum muss die
 * Vorgabe jeder Einstellung hier gleich der Vorgabe im Code sein (`apps/web/test/karteneinstellungen.test.ts` prüft es).
 *
 *     GET  /api/map-settings                      die wirksamen Werte (öffentlich, ETag)                    keine
 *     GET  /api/admin/system/karteneinstellungen  die Abweichungen und ihre Revision                        view_operations (V)
 *     POST /api/admin/system/karteneinstellungen  { operationId, baseRevision, id, value }                  manage_system_settings (S)
 */

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Moment = Type.String();
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const KARTENEINSTELLUNGEN_URL = "/api/admin/system/karteneinstellungen";
export const MAP_SETTINGS_URL = "/api/map-settings";

/** Ein Punkt in Karteneinheiten (MCS-001): x nach Osten, y nach Norden, 0 bis 1024. */
export interface KartenPunkt {
    x: number;
    y: number;
}

/** Der Reisebeginn: unbestimmt (keine Jahreszeiten), ein Tag in einem der zwölf Monate oder einer der Namenlosen Tage (`namenlos`). */
export type Reisebeginn = "unbestimmt" | { monat: string; tag: number };

/** Ein Stützpunkt einer Kurve: MapLibres Zoom (die Karte zeigt ihn eine Stufe niedriger an) und die Neigung dort in Grad. */
export interface KurvenPunkt {
    zoom: number;
    neigung: number;
}

export type KartenWert =
    number | KartenPunkt | string | boolean | { monat: string; tag: number } | readonly KurvenPunkt[];

/**
 * Was eine Änderung nach sich zieht (Design Guide §8: an JEDER Zeile). `naechsterBesuch`: Die Karte liest den Wert beim Öffnen,
 * wer sie offen hat, sieht ihn nach dem Neuladen. `neuePlanung`: dasselbe für den Routenplaner, und nur, wenn die Adresse keine
 * Reise trägt — ein Link öffnet weiter genau seine Reise. `naechsteBerechnung`: Der Server liest den Wert, wenn er abgeleitete
 * Angaben eines Objekts neu berechnet (die Sprachen eines Gebiets nach dem Speichern einer Fläche); Bestehendes bleibt bis dahin.
 */
export type KarteneinstellungFolge = "naechsterBesuch" | "neuePlanung" | "naechsteBerechnung";

interface EinstellungBasis {
    /** Die Kennung, unter der eine Abweichung gespeichert wird, und der Schlüssel der Sprachtafel. */
    id: string;
    folge: KarteneinstellungFolge;
    /** Eine Zwischenüberschrift über die volle Breite vor dieser Zeile (`admin.karteneinstellungen.abschnitt.<schlüssel>`). */
    abschnitt?: string;
    /**
     * Wie viele Zeilen des Rasters mit zwei Spalten der Wert einnimmt (ohne Angabe eine). Mit 2 rücken die beiden folgenden Werte
     * untereinander in die zweite Spalte (Panel „OceanShader an/aus“). Am Telefon steht ohnehin alles in einer Spalte.
     */
    rasterZeilen?: number;
}

export interface ZahlEinstellung extends EinstellungBasis {
    art: "zahl";
    vorgabe: number;
    min: number;
    max: number;
    /** So viele Nachkommastellen zeigt das Feld höchstens. */
    stellen: number;
    /** Nur Vielfache dieser Schrittweite (die Reisestunden gehen in halben Stunden, wie im Planer). */
    schritt?: number;
}

export interface PunktEinstellung extends EinstellungBasis {
    art: "punkt";
    vorgabe: KartenPunkt;
    grenzen: { minX: number; minY: number; maxX: number; maxY: number };
    stellen: number;
}

/** Eine Wahl aus einer festen Liste; die Namen der Optionen nennt die Oberfläche (dieselben Wörter wie im Planer). */
export interface AuswahlEinstellung extends EinstellungBasis {
    art: "auswahl";
    vorgabe: string;
    optionen: readonly string[];
}

export interface SchalterEinstellung extends EinstellungBasis {
    art: "schalter";
    vorgabe: boolean;
}

export interface ReisebeginnEinstellung extends EinstellungBasis {
    art: "reisebeginn";
    vorgabe: Reisebeginn;
    monate: readonly string[];
}

/** Eine Farbe der Karte als `#rrggbb` in Kleinbuchstaben; das Feld ist der Farbwähler des Browsers samt Text zum Tippen. */
export interface FarbEinstellung extends EinstellungBasis {
    art: "farbe";
    vorgabe: string;
}

/**
 * Eine Kurve aus Stützpunkten, nach Zoom geordnet, dazwischen gerade; vor dem ersten und hinter dem letzten Punkt gilt dessen Wert. Die
 * Oberfläche ist ein Kurveneditor wie bei Lüfterkurven: ziehen, auf die Kurve klicken für einen neuen Punkt, Doppelklick entfernt ihn.
 */
export interface KurvenEinstellung extends EinstellungBasis {
    art: "kurve";
    vorgabe: readonly KurvenPunkt[];
    zoom: { min: number; max: number };
    neigung: { min: number; max: number };
    punkte: { min: number; max: number };
}

export type Karteneinstellung =
    | ZahlEinstellung
    | PunktEinstellung
    | AuswahlEinstellung
    | SchalterEinstellung
    | ReisebeginnEinstellung
    | FarbEinstellung
    | KurvenEinstellung
    | TextEinstellung;

export interface KarteneinstellungPanel {
    /** Der Schlüssel des Panels in der Sprachtafel (`admin.karteneinstellungen.panel.<id>.*`). */
    id: string;
    werte: readonly Karteneinstellung[];
}

const { bounds } = AVENTURIA.coordinateSpace;

/**
 * Die Startansicht: wohin die Karte schaut, wenn die Adresse nichts sagt (kein `#x=…&y=…&z=…`, kein Kurzlink, kein Wiki-Link,
 * keine Route; die liest `app.vue` vorher).
 *
 * - **Startposition:** die Mitte des Kontinentnamens „Aventurien“ (Betreiber 2026-10-15: „Kannst das Label "Aventurien"
 *   zentrieren“). Gelesen aus der Beschriftung (`map_label_render`, Region `kontinent`), auf eine Viertel-Einheit genau, wie die
 *   Kachel sie trägt. Bis WI-0166 stand hier Gareth (520, 500).
 * - **Startzoom:** 2,5 in der Zählung der Adresse (`z=`), also MapLibres Zoom (Betreiber 2026-10-15: „standardmaßig auf zoom
 *   2,5 gehen“). Bis WI-0166 stand hier 5. Die Grenzen sind die der Karte: 0 bis zur nächsten Stufe, die sie zeigt; was die
 *   sichtbare Fläche nicht füllt, zieht der Kartenzaun ohnehin nach (`camera/visible-area.ts`).
 */
const STARTANSICHT: KarteneinstellungPanel = {
    id: "startansicht",
    werte: [
        {
            id: "startPosition",
            art: "punkt",
            folge: "naechsterBesuch",
            vorgabe: { x: 518.75, y: 504 },
            grenzen: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY },
            stellen: 2,
        },
        {
            id: "startZoom",
            art: "zahl",
            folge: "naechsterBesuch",
            vorgabe: 2.5,
            min: 0,
            max: renderZoomForBand(MAX_VIEW_BAND),
            stellen: 2,
        },
    ],
};

const TRANSPORTE = AVENTURIA_TRAVEL_MODEL.transportmittel.wert;

/**
 * Der Routenplaner (Betreiber 2026-10-15: „Bau als Nächstes das Panel Routenplaner in die Karteneinstellungen (Reiseart, erlaubte
 * Wege, Transportmittel, Schnellste/Kürzeste, Umstiege, Eiltempo, Reisestunden, Reisebeginn, Unterbringung, Flugmittel), so dass
 * alte Links gleich bleiben“). Zwei Abschnitte wie die beiden Klappboxen des Planers: „Transportmittel“ und „Reiseoptionen“.
 *
 * Jede Vorgabe ist die feste Vorgabe des Planers (`ROUTE_DEFAULTS`, `DEFAULT_LODGING`, der Hexenflug), keine eigene Zahl:
 * Wiche sie ab, bedeutete „keine Zeile“ hier etwas anderes als „kein Parameter“ im Link.
 */
const ROUTENPLANER: KarteneinstellungPanel = {
    id: "routenplaner",
    werte: [
        {
            id: "planerReiseart",
            abschnitt: "transportmittel",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: "surface",
            optionen: ["surface", "air"],
        },
        {
            id: "planerFlugmittel",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: "witchFlight",
            optionen: airProfileIds(AVENTURIA_TRAVEL_MODEL),
        },
        { id: "planerLandErlaubt", art: "schalter", folge: "neuePlanung", vorgabe: true },
        {
            id: "planerLandTransport",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: ROUTE_DEFAULTS.land,
            optionen: TRANSPORTE.land,
        },
        { id: "planerFlussErlaubt", art: "schalter", folge: "neuePlanung", vorgabe: true },
        {
            id: "planerFlussTransport",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: ROUTE_DEFAULTS.river,
            optionen: TRANSPORTE.river,
        },
        { id: "planerMeerErlaubt", art: "schalter", folge: "neuePlanung", vorgabe: true },
        {
            id: "planerMeerTransport",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: ROUTE_DEFAULTS.sea,
            optionen: TRANSPORTE.sea,
        },
        {
            id: "planerRoutenwahl",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: ROUTE_DEFAULTS.optimize,
            optionen: ["fastest", "shortest"],
        },
        {
            id: "planerUmstiegeMinimieren",
            art: "schalter",
            folge: "neuePlanung",
            vorgabe: ROUTE_DEFAULTS.minimize_transfers,
        },
        { id: "planerEiltempo", art: "schalter", folge: "neuePlanung", vorgabe: ROUTE_DEFAULTS.hurry },
        {
            id: "planerReisestunden",
            abschnitt: "reiseoptionen",
            art: "zahl",
            folge: "neuePlanung",
            vorgabe: ROUTE_DEFAULTS.hours_per_day,
            min: 0.5,
            max: 24,
            stellen: 1,
            schritt: 0.5,
        },
        {
            id: "planerReisebeginn",
            art: "reisebeginn",
            folge: "neuePlanung",
            vorgabe: "unbestimmt",
            monate: DEPARTURE_MONTHS,
        },
        {
            id: "planerUnterbringung",
            art: "auswahl",
            folge: "neuePlanung",
            vorgabe: DEFAULT_LODGING,
            optionen: LODGING_LEVELS,
        },
    ],
};

/**
 * Das Editierverhalten (WI-0177; Betreiber 2026-10-15, wörtlich: „das snapping sollte einstellbarsein in "Karteneinstellungen" (->
 * neues Panel unten mit titel "Editierverhalten")“): wie die Editoren auf der Karte einrasten.
 *
 * - **Fangradius:** wie nah, in Bildpunkten am Schirm, ein gezogenes Ende einem Ziel kommen muss, damit es einrastet; zugleich die
 *   Größe der Hülle um das Ende. EIN Wert für alle Editoren (Ort, Weg, Fläche; gemeinsames Geometrie-Modul, Editor-Orchestrierung).
 *   Vorgabe 10 wie beim Ort verschieben (WI-0128 E12, EDIT-0001 G4); Legacys Wegeditor hatte 18 (`js/config.js:103`).
 */
const EDITIERVERHALTEN: KarteneinstellungPanel = {
    id: "editierverhalten",
    werte: [
        {
            id: "fangradius",
            art: "zahl",
            folge: "naechsterBesuch",
            vorgabe: 10,
            min: 4,
            max: 40,
            stellen: 0,
            schritt: 1,
        },
    ],
};

/**
 * Die Sprachen (WI-0261; Betreiber 2026-10-30, wörtlich: „5%, trag den wert bei "Startwerte" in der Systemsteuerung ein“).
 *
 * - **Mindestanteil:** ab welchem Anteil eine Sprachfläche in der Zeile „Sprachen“ eines Herrschaftsgebiets, einer
 *   Derographie-Fläche oder eines Wegs steht, in Prozent der Fläche (beim Weg der Länge). Orte brauchen keine Schwelle: Ihr Punkt
 *   liegt in der Sprachfläche oder nicht. 0 heißt „jede Berührung“. Vorgabe 5 wie im Abgleich Wiki gegen Fläche (WI-0261).
 *   Gelesen von der Kollisionsberechnung der Sprachen; bis sie gebaut ist, hat der Wert keinen Leser.
 */
const SPRACHEN: KarteneinstellungPanel = {
    id: "sprachen",
    werte: [
        {
            id: "sprachenMindestanteil",
            art: "zahl",
            folge: "naechsteBerechnung",
            vorgabe: 5,
            min: 0,
            max: 100,
            stellen: 0,
            schritt: 1,
        },
    ],
};

/**
 * Die Herrschaftsgebiete (Kanal OPS-000082; Vali 2026-11-04, wörtlich: „du führst dort "Transparenz der Herrschaftsgebiete" ein. Standard ist 70%“).
 *
 * - **Transparenz:** EIN Wert für alle Gebiete, in Prozent. Die Karte rechnet daraus die Deckkraft von Füllung und Schraffur
 *   (`map/territory-layers.ts`). Die Vorgabe kommt aus der Kartografietafel (`fillOpacity`), damit die Zahl nur einmal steht. `territory.opacity`
 *   bleibt Datum aus Legacy und wirkt nicht auf die Karte.
 */
const HERRSCHAFTSGEBIETE: KarteneinstellungPanel = {
    id: "herrschaftsgebiete",
    werte: [
        {
            id: "gebieteTransparenz",
            art: "zahl",
            folge: "naechsterBesuch",
            vorgabe: Math.round((1 - AVENTURIA_POLITICAL_CARTOGRAPHY.fillOpacity) * 100),
            min: 0,
            max: 100,
            stellen: 0,
            schritt: 1,
        },
    ],
};

/**
 * Die Orte (Kanal OPS-000083; Vali 2026-11-04, wörtlich: „die rot-werte von orten und inoffiziellen orten kannst du gern auch in "Standardwerte"
 * unterbringen“; zur Raute: „die nun auch in den standardwerten bearbeitet werden sollten“): die Farbe des Kreises und die der Raute, je offiziell und
 * inoffiziell. Die Vorgaben stehen im Designkanon. Der gewählte Ort bleibt im Kanon.
 */
const ORTE: KarteneinstellungPanel = {
    id: "orte",
    werte: [
        { id: "ortFarbeOffiziell", art: "farbe", folge: "naechsterBesuch", vorgabe: canonColour("markerSettlement") },
        {
            id: "ortFarbeInoffiziell",
            art: "farbe",
            folge: "naechsterBesuch",
            vorgabe: canonColour("markerSettlementUnofficial"),
        },
        {
            id: "bauwerkFarbeOffiziell",
            art: "farbe",
            folge: "naechsterBesuch",
            vorgabe: canonColour("markerSettlementSite"),
        },
        {
            id: "bauwerkFarbeInoffiziell",
            art: "farbe",
            folge: "naechsterBesuch",
            vorgabe: canonColour("markerSettlementSiteUnofficial"),
        },
    ],
};

/**
 * Der Ozean-Shader (WI-0288; Betreiber 2026-11-08, wörtlich: „mach den schalter in den reiter "Standardwerte" in der Systemsteuerung im
 * Panel "OceanShader an/aus"“): ob in der 3D-Ansicht das bewegte Wasser auf Meer und Seen läuft (`map/wasser/`). Aus heißt: Der Teil wird
 * gar nicht geladen, das Wasser steht, wie die Karte es zeichnet. In 2D gibt es das bewegte Wasser nie. Vorgabe an, wie seit Stufe 5.
 *
 * In der zweiten Spalte (Betreiber 2026-11-08: „in der 2. spalte des panels noch größe des glanzpunktes und stärke des glanzes“):
 * - **Größe des Glanzpunkts:** Faktor auf den Winkel des Sonnenflecks im Wasser (`uPunkt` in `map/wasser/wasser-shader.ts`), 1 wie bisher.
 * - **Stärke des Glanzes:** Faktor auf Sonnenfleck, Himmelsspiegelung und Lichtkanten der Wellen (`uGlanz`), 1 wie bisher. Er stand bis
 *   dahin als `glanz` im Wettermodell (Panel „Wasser“) und ist hierher umgezogen, damit es ihn nur einmal gibt.
 */
const OZEANSHADER: KarteneinstellungPanel = {
    id: "ozeanShader",
    werte: [
        { id: "ozeanShaderAn", art: "schalter", folge: "naechsterBesuch", vorgabe: true, rasterZeilen: 2 },
        { id: "ozeanGlanzpunkt", art: "zahl", folge: "naechsterBesuch", vorgabe: 1, min: 0.25, max: 4, stellen: 2 },
        { id: "ozeanGlanz", art: "zahl", folge: "naechsterBesuch", vorgabe: 1, min: 0, max: 3, stellen: 2 },
    ],
};

/**
 * Die Zoomkurve (Betreiber 2026-11-09: „kannst du einen freien editor von stützpunkten auf einer funktion (wie bei lüfterkurven) in eine
 * "Zoomkurve" unter dem "Standardwerte"-Reiter in der Systemsteuerung tun? … um das zoom-winkel-verhältnis selbst einzustellen“): wie
 * steil die Kamera in 3D bei jedem Zoom blickt, solange sie der Kurve folgt (nach dem 3D-Knopf; `begleitNeigung` in
 * `apps/web/src/map/camera/camera-math.ts`). Gespeichert in MapLibres Zoom, die Oberfläche zeigt ihn wie die Karte eine Stufe niedriger.
 *
 * Vorgabe aus dem Plot desselben Tages: 25° bei angezeigtem Zoom 1, 45° bei 5, 80° bei 8,5, also ein Knick nur bei 5 (Betreiber: „bis 5
 * will ich eigentlich gar keine veränderung - nur ganz sanft … mit 5 als einzige veränderung in der steigungs funktion“). Sanfter geht es
 * bis Zoom 1 nicht, ohne an die Grenze im Überblick (30°, D3) zu stoßen. Die Grenze nach Zoom bleibt über der Kurve; 80° ist der
 * Anschlag (`PITCH_CEILING`).
 */
export const ZOOM_KURVE_VORGABE: readonly KurvenPunkt[] = [
    { zoom: 2, neigung: 25 },
    { zoom: 6, neigung: 45 },
    { zoom: 9.5, neigung: 80 },
];

const ZOOMKURVE: KarteneinstellungPanel = {
    id: "zoomkurve",
    werte: [
        {
            id: "zoomKurve",
            art: "kurve",
            folge: "naechsterBesuch",
            vorgabe: ZOOM_KURVE_VORGABE,
            zoom: { min: 1, max: renderZoomForBand(MAX_VIEW_BAND) },
            neigung: { min: 0, max: 80 },
            punkte: { min: 2, max: 12 },
        },
    ],
};

/** Wie das Deckblatt von „Reise als PDF“ sein Kartenbild bekommt: die ganze Route eingepasst, der gerade gezeigte Ausschnitt, oder keins. */
export const PDF_KARTENBILDER = ["route", "ausschnitt", "ohne"] as const;
/** Die Ebenen der Derographie in der Folge des Kartenfächers; `hoehenstufen` ist die Topographie in Höhenstufen. */
export const PDF_DERO_EBENEN = [
    "alle",
    "derographisch",
    "vegetation",
    "topographie",
    "hoehenstufen",
    "klima",
    "sprachen",
] as const;
/**
 * Die Karte des Kartenbilds: `aktuell` (was die Karte beim Öffnen zeigt), die Vorgabe-Serien, „Politisch“ und die Ebenen der
 * Derographie, in der Folge des Dialogs. Eine Serie, die es nicht mehr gibt, oder „Politisch“ ohne Gebiete fällt im Dialog auf `aktuell`.
 */
export const PDF_KARTEN: readonly string[] = [
    "aktuell",
    ...KARTENSERIEN_VORGABE_REIHENFOLGE.map((serie) => `serie:${serie}`),
    "politisch",
    ...PDF_DERO_EBENEN.map((ebene) => `dero:${ebene}`),
];
export const PDF_ETAPPEN_ARTEN = ["kurz", "lang"] as const;
export const PDF_FORMATE = ["a4", "a5", "letter"] as const;
export const PDF_LAGEN = ["hoch", "quer"] as const;
export const PDF_PAPIERE = ["pergament", "weiss"] as const;
/** `seite`: die Sprache, in der die Seite gerade steht; sonst jede Sprache der Seite (`LOCALES`, ein Test hält beide gleich). */
export const PDF_SPRACHEN = ["seite", "de", "en", "fr", "nl", "it", "es", "pl", "da", "sv"] as const;
/** Ein Dateiname ohne Endung, so wie ihn jedes Dateisystem nimmt; `{von}` und `{bis}` füllt der Dialog mit Start und Ziel. */
export const PDF_DATEINAME_MUSTER = '^[^\\\\/:*?"<>|\\u0000-\\u001f]{1,120}$';

/**
 * Der PDF Exporter (WI-0306; Vali 2026-11-10, wörtlich: „PDF export: Jede Etappe als default, Reisetagebuch standard aus. du darfst gerne
 * die "standardwerte" in ein panel "PDF Exporter" in die systemsteuerung“): womit der Dialog „Reise als PDF“ aufgeht. Was jemand im Dialog
 * wählt, bleibt bei ihm, solange die Seite offen ist; gespeichert wird es nirgends.
 *
 * Die Vorgaben sind die des Entwurfs (Fassung 6) mit Valis zwei Änderungen: „Jede Etappe“ statt „Kurz, je Abschnitt“, Reisetagebuch aus.
 * Der Dateiname ist eine Vorlage: leer heißt „Reise von Gareth nach Havena“ in der Sprache des PDFs, sonst stehen `{von}` und `{bis}` für
 * Start und Ziel.
 */
const PDF_EXPORTER: KarteneinstellungPanel = {
    id: "pdfExporter",
    werte: [
        {
            id: "pdfKartenbild",
            abschnitt: "pdfKartenbild",
            art: "auswahl",
            folge: "naechsterBesuch",
            vorgabe: "route",
            optionen: PDF_KARTENBILDER,
        },
        { id: "pdfKarte", art: "auswahl", folge: "naechsterBesuch", vorgabe: "aktuell", optionen: PDF_KARTEN },
        { id: "pdfEtappen", abschnitt: "pdfInhalt", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfProfil", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfKosten", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfSchiffe", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfGebiete", art: "schalter", folge: "naechsterBesuch", vorgabe: false },
        { id: "pdfUnterwegs", art: "schalter", folge: "naechsterBesuch", vorgabe: false },
        { id: "pdfTagebuch", art: "schalter", folge: "naechsterBesuch", vorgabe: false },
        { id: "pdfQr", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        {
            id: "pdfEtappenArt",
            abschnitt: "pdfEtappen",
            art: "auswahl",
            folge: "naechsterBesuch",
            vorgabe: "lang",
            optionen: PDF_ETAPPEN_ARTEN,
        },
        { id: "pdfWetter", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfDazuGegend", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfDazuGebiet", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfDazuSprache", art: "schalter", folge: "naechsterBesuch", vorgabe: false },
        { id: "pdfDazuGelaende", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        { id: "pdfDazuNeu", art: "schalter", folge: "naechsterBesuch", vorgabe: true },
        {
            id: "pdfFormat",
            abschnitt: "pdfPapier",
            art: "auswahl",
            folge: "naechsterBesuch",
            vorgabe: "a4",
            optionen: PDF_FORMATE,
        },
        { id: "pdfLage", art: "auswahl", folge: "naechsterBesuch", vorgabe: "hoch", optionen: PDF_LAGEN },
        { id: "pdfPapier", art: "auswahl", folge: "naechsterBesuch", vorgabe: "pergament", optionen: PDF_PAPIERE },
        {
            id: "pdfSprache",
            abschnitt: "pdfDatei",
            art: "auswahl",
            folge: "naechsterBesuch",
            vorgabe: "seite",
            optionen: PDF_SPRACHEN,
        },
        {
            id: "pdfDateiname",
            art: "text",
            folge: "naechsterBesuch",
            vorgabe: "",
            muster: PDF_DATEINAME_MUSTER,
            maxLaenge: 120,
        },
    ],
};

export const KARTENEINSTELLUNG_PANELE: readonly KarteneinstellungPanel[] = [
    STARTANSICHT,
    ROUTENPLANER,
    EDITIERVERHALTEN,
    SPRACHEN,
    HERRSCHAFTSGEBIETE,
    ORTE,
    OZEANSHADER,
    ZOOMKURVE,
    PDF_EXPORTER,
];

/** Der Tag eines Reisebeginns: ganze Tage von 1 bis 30, wie im Planer (`clampStartDay`). */
export const REISEBEGINN_TAGE = { min: 1, max: 30 } as const;

/** An den Namenlosen Tagen: 1 bis 5. */
export const REISEBEGINN_NAMENLOSE_TAGE = { min: 1, max: NAMELESS_DAYS } as const;

/** Jede Einstellung der Tafel, über alle Panele, in der Reihenfolge der Anzeige. */
export const KARTENEINSTELLUNGEN: readonly Karteneinstellung[] = KARTENEINSTELLUNG_PANELE.flatMap(
    (panel) => panel.werte,
);

/** Die Einstellung zu einer Kennung; `undefined`, wenn die Kennung nicht zur Tafel gehört. */
export const karteneinstellung = (id: string): Karteneinstellung | undefined =>
    KARTENEINSTELLUNGEN.find((eintrag) => eintrag.id === id);

// --- Private Einstellungen ---------------------------------------------------------------------------------------------------------

/**
 * Private Einstellungen (WI-0180 §8; Andockstelle von der Regel-Koordination 2026-10-16): dieselbe Tafel und derselbe Speicher
 * (`map_setting`), aber mit Sichtbarkeit `privat`.
 *
 * - Sie stehen NICHT in `KARTENEINSTELLUNG_PANELE`: Der Reiter „Karteneinstellungen“ zeigt sie nie, und `GET /api/map-settings`
 *   kennt sie nicht (`karteneinstellungenWirksam` liest nur die öffentlichen).
 * - Lesen und schreiben nur mit `switch_environment` (Rolle Betreiber, bewusst kein Sonderrecht; WI-0180 §5.2 „Nur Betreiber“).
 *   `manage_system_settings` allein genügt nicht, denn der Betreiber kann es Admins zuteilen.
 * - Im Protokoll steht der Schlüssel, nie der Wert.
 * - Die Oberfläche steht im Reiter „Umgebungen“ der Systemsteuerung (WI-0204, Betreiber 2026-10-16 „Direkt bauen“ zu Fassung 2).
 *
 * Heute nur die Adresse von Lokal: Name und Port getrennt (eine Adresse baut `lokalAdresse` in `system/umgebungen.ts`), dazu,
 * wann Lokal im Umgebungsmenü steht. Ohne Namen fehlt Lokal überall.
 */
export interface TextEinstellung extends EinstellungBasis {
    art: "text";
    vorgabe: string;
    /** Ein Wert außer der leeren Vorgabe muss diesem Muster folgen. */
    muster: string;
    maxLaenge: number;
}

export type PrivateKarteneinstellung = TextEinstellung | ZahlEinstellung | AuswahlEinstellung;
export type JedeKarteneinstellung = Karteneinstellung | TextEinstellung;

/** Ein Tailscale-Name (MagicDNS): Kleinbuchstaben, Ziffern und Bindestriche, Punkte dazwischen, endet auf `.ts.net`. */
export const LOKAL_NAME_MUSTER = "^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+ts\\.net$";
export const LOKAL_IM_MENUE = ["erreichbar", "immer"] as const;
export type LokalImMenue = (typeof LOKAL_IM_MENUE)[number];

export const PRIVATE_KARTENEINSTELLUNGEN: readonly PrivateKarteneinstellung[] = [
    { id: "lokalName", art: "text", folge: "naechsterBesuch", vorgabe: "", muster: LOKAL_NAME_MUSTER, maxLaenge: 253 },
    {
        id: "lokalPort",
        art: "zahl",
        folge: "naechsterBesuch",
        vorgabe: 443,
        min: 1,
        max: 65535,
        stellen: 0,
        schritt: 1,
    },
    { id: "lokalImMenue", art: "auswahl", folge: "naechsterBesuch", vorgabe: "erreichbar", optionen: LOKAL_IM_MENUE },
];

export const privateKarteneinstellung = (id: string): PrivateKarteneinstellung | undefined =>
    PRIVATE_KARTENEINSTELLUNGEN.find((eintrag) => eintrag.id === id);

/** Öffentlich oder privat: was der Server liest und schreibt. Die Oberfläche der Karteneinstellungen nimmt `karteneinstellung`. */
export const jedeKarteneinstellung = (id: string): JedeKarteneinstellung | undefined =>
    karteneinstellung(id) ?? privateKarteneinstellung(id);

/** Die wirksamen privaten Werte; nur für Sitzungen mit `switch_environment`. */
export interface PrivateKartenEinstellungen {
    lokalName: string;
    lokalPort: number;
    lokalImMenue: LokalImMenue;
}

export function privateKarteneinstellungenWirksam(
    abweichungen: Readonly<Record<string, unknown>>,
): PrivateKartenEinstellungen {
    const werte: Record<string, KartenWert> = {};
    for (const einstellung of PRIVATE_KARTENEINSTELLUNGEN) {
        const abweichung = abweichungen[einstellung.id];
        werte[einstellung.id] = karteneinstellungImRahmen(einstellung, abweichung) ? abweichung : einstellung.vorgabe;
    }
    return werte as unknown as PrivateKartenEinstellungen;
}

const istZahl = (wert: unknown): wert is number => typeof wert === "number" && Number.isFinite(wert);

const FARBE_MUSTER = /^#[0-9a-f]{6}$/u;

function istPunkt(wert: unknown): wert is KartenPunkt {
    if (typeof wert !== "object" || wert === null || Array.isArray(wert)) return false;
    const keys = Object.keys(wert).sort();
    const punkt = wert as Record<string, unknown>;
    return keys.length === 2 && keys[0] === "x" && keys[1] === "y" && istZahl(punkt["x"]) && istZahl(punkt["y"]);
}

/**
 * Passt der Wert zu Art und Grenzen der Einstellung? Oberfläche, Server und Kartenstart prüfen mit DIESER Funktion; ein
 * gespeicherter Wert, der nicht (mehr) passt, gilt beim Lesen nicht und die Vorgabe greift.
 */
export function karteneinstellungImRahmen(einstellung: JedeKarteneinstellung, wert: unknown): wert is KartenWert {
    switch (einstellung.art) {
        case "text":
            return (
                typeof wert === "string" &&
                wert.length <= einstellung.maxLaenge &&
                (wert === einstellung.vorgabe || new RegExp(einstellung.muster).test(wert))
            );
        case "zahl": {
            if (!istZahl(wert) || wert < einstellung.min || wert > einstellung.max) return false;
            return einstellung.schritt === undefined || Number.isInteger(wert / einstellung.schritt);
        }
        case "punkt": {
            if (!istPunkt(wert)) return false;
            const { minX, minY, maxX, maxY } = einstellung.grenzen;
            return wert.x >= minX && wert.x <= maxX && wert.y >= minY && wert.y <= maxY;
        }
        case "auswahl":
            return typeof wert === "string" && einstellung.optionen.includes(wert);
        case "schalter":
            return typeof wert === "boolean";
        case "farbe":
            return typeof wert === "string" && FARBE_MUSTER.test(wert);
        case "reisebeginn":
            return wert === "unbestimmt" || istTagImMonat(wert, einstellung.monate);
        case "kurve":
            return istKurve(wert, einstellung);
    }
}

/** Eine Kurve: so viele Punkte, wie die Einstellung erlaubt, jeder in den Grenzen, der Zoom streng steigend. */
function istKurve(wert: unknown, einstellung: KurvenEinstellung): wert is readonly KurvenPunkt[] {
    if (!Array.isArray(wert) || wert.length < einstellung.punkte.min || wert.length > einstellung.punkte.max)
        return false;
    let vorher = Number.NEGATIVE_INFINITY;
    for (const punkt of wert as unknown[]) {
        if (typeof punkt !== "object" || punkt === null || Array.isArray(punkt)) return false;
        const keys = Object.keys(punkt).sort();
        const { zoom, neigung } = punkt as Record<string, unknown>;
        if (keys.length !== 2 || keys[0] !== "neigung" || keys[1] !== "zoom" || !istZahl(zoom) || !istZahl(neigung))
            return false;
        if (zoom < einstellung.zoom.min || zoom > einstellung.zoom.max || zoom <= vorher) return false;
        if (neigung < einstellung.neigung.min || neigung > einstellung.neigung.max) return false;
        vorher = zoom;
    }
    return true;
}

/**
 * Der Wert einer Kurve an einer Stelle: zwischen zwei Punkten gerade, vor dem ersten und hinter dem letzten dessen Wert. Die Kamera
 * rechnet damit (`begleitNeigung`), die Oberfläche zeichnet damit.
 */
export function kurvenWert(punkte: readonly KurvenPunkt[], zoom: number): number {
    const erster = punkte[0];
    const letzter = punkte[punkte.length - 1];
    if (erster === undefined || letzter === undefined) return 0;
    if (zoom <= erster.zoom) return erster.neigung;
    if (zoom >= letzter.zoom) return letzter.neigung;
    for (let i = 1; i < punkte.length; i++) {
        const a = punkte[i - 1]!;
        const b = punkte[i]!;
        if (zoom <= b.zoom) return a.neigung + ((zoom - a.zoom) / (b.zoom - a.zoom)) * (b.neigung - a.neigung);
    }
    return letzter.neigung;
}

function istTagImMonat(wert: unknown, monate: readonly string[]): wert is { monat: string; tag: number } {
    if (typeof wert !== "object" || wert === null || Array.isArray(wert)) return false;
    const keys = Object.keys(wert).sort();
    const tag = (wert as Record<string, unknown>)["tag"];
    const monat = (wert as Record<string, unknown>)["monat"];
    return (
        keys.length === 2 &&
        keys[0] === "monat" &&
        keys[1] === "tag" &&
        typeof monat === "string" &&
        monate.includes(monat) &&
        typeof tag === "number" &&
        Number.isInteger(tag) &&
        tag >= REISEBEGINN_TAGE.min &&
        tag <= (monat === NAMELESS_MONTH ? REISEBEGINN_NAMENLOSE_TAGE : REISEBEGINN_TAGE).max
    );
}

/** Sind zwei Werte gleich? Ein Objekt (Punkt, Reisebeginn) ist gleich, wenn jedes Feld gleich ist, eine Kurve, wenn jeder Punkt gleich ist. */
export function karteneinstellungGleich(a: KartenWert, b: KartenWert): boolean {
    if (typeof a !== "object" || typeof b !== "object") return a === b;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        const kb = b as readonly KurvenPunkt[];
        return (a as readonly KurvenPunkt[]).every(
            (punkt, i) => punkt.zoom === kb[i]?.zoom && punkt.neigung === kb[i]?.neigung,
        );
    }
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return (
        ka.length === kb.length &&
        ka.every(
            (key, index) =>
                key === kb[index] && (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key],
        )
    );
}

/** Die wirksamen Werte, die der Kartenstart liest. Eine neue Einstellung bekommt hier ihr Feld, mit ihrer Art. */
export interface KartenEinstellungen {
    startPosition: KartenPunkt;
    startZoom: number;
    planerReiseart: string;
    planerFlugmittel: string;
    planerLandErlaubt: boolean;
    planerLandTransport: string;
    planerFlussErlaubt: boolean;
    planerFlussTransport: string;
    planerMeerErlaubt: boolean;
    planerMeerTransport: string;
    planerRoutenwahl: string;
    planerUmstiegeMinimieren: boolean;
    planerEiltempo: boolean;
    planerReisestunden: number;
    planerReisebeginn: Reisebeginn;
    planerUnterbringung: string;
    fangradius: number;
    sprachenMindestanteil: number;
    gebieteTransparenz: number;
    ortFarbeOffiziell: string;
    ortFarbeInoffiziell: string;
    bauwerkFarbeOffiziell: string;
    bauwerkFarbeInoffiziell: string;
    ozeanShaderAn: boolean;
    ozeanGlanzpunkt: number;
    ozeanGlanz: number;
    zoomKurve: KurvenPunkt[];
    pdfKartenbild: string;
    pdfKarte: string;
    pdfEtappen: boolean;
    pdfProfil: boolean;
    pdfKosten: boolean;
    pdfSchiffe: boolean;
    pdfGebiete: boolean;
    pdfUnterwegs: boolean;
    pdfTagebuch: boolean;
    pdfQr: boolean;
    pdfEtappenArt: string;
    pdfWetter: boolean;
    pdfDazuGegend: boolean;
    pdfDazuGebiet: boolean;
    pdfDazuSprache: boolean;
    pdfDazuGelaende: boolean;
    pdfDazuNeu: boolean;
    pdfFormat: string;
    pdfLage: string;
    pdfPapier: string;
    pdfSprache: string;
    pdfDateiname: string;
}

/** Die Vorgaben aller Einstellungen. */
export function karteneinstellungVorgaben(): KartenEinstellungen {
    return karteneinstellungenWirksam({});
}

/**
 * Die wirksamen Werte: die Vorgaben, überschrieben von den gespeicherten Abweichungen. Eine Kennung, die die Tafel nicht kennt,
 * wird übergangen (sie stammt aus einem späteren oder zurückgenommenen Release), ebenso ein Wert, der nicht in die Grenzen passt.
 */
export function karteneinstellungenWirksam(abweichungen: Readonly<Record<string, unknown>>): KartenEinstellungen {
    const werte: Record<string, KartenWert> = {};
    for (const einstellung of KARTENEINSTELLUNGEN) {
        const abweichung = abweichungen[einstellung.id];
        werte[einstellung.id] = karteneinstellungImRahmen(einstellung, abweichung)
            ? abweichung
            : structuredClone(einstellung.vorgabe);
    }
    return werte as unknown as KartenEinstellungen;
}

// --- Formen der Wege ---------------------------------------------------------------------------------------------------------------

export const KARTENEINSTELLUNG_ID_MUSTER = "^[a-z][A-Za-z0-9]{0,59}$";

const KartenPunktSchema = Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false });
const ReisebeginnTagSchema = Type.Object(
    { monat: Type.String(), tag: Type.Integer() },
    { additionalProperties: false },
);
const KurvenPunktSchema = Type.Object({ zoom: Type.Number(), neigung: Type.Number() }, { additionalProperties: false });
const KartenWertSchema = Type.Union([
    Type.Number(),
    Type.Boolean(),
    Type.String(),
    KartenPunktSchema,
    ReisebeginnTagSchema,
    Type.Array(KurvenPunktSchema),
]);

export const AdminKarteneinstellungRow = Type.Object(
    {
        id: Type.String(),
        /** Der eingestellte Wert; er weicht von der Vorgabe ab, sonst stünde die Zeile nicht da. */
        value: KartenWertSchema,
        changedAt: Nullable(Moment),
        changedBy: Nullable(Type.String()),
    },
    { additionalProperties: false },
);
export type AdminKarteneinstellungRow = Static<typeof AdminKarteneinstellungRow>;

/** `GET /api/admin/system/karteneinstellungen`: nur die Abweichungen; die Vorgaben kennt die Oberfläche aus der Tafel. */
export const AdminKarteneinstellungen = Type.Object(
    {
        now: Moment,
        /** Die Revision der Einstellungen (`map_setting_state.revision`), Grundlage für `baseRevision`. */
        revision: Nullable(Type.Integer({ minimum: 0 })),
        /** `unprovisioned`: Die Tafel fehlt (vor Migration 0134), es gelten die Vorgaben. */
        source: literals(["database", "unprovisioned"] as const),
        rows: Type.Array(AdminKarteneinstellungRow),
        /** Kennungen in der Tafel, die das Register nicht kennt oder deren Wert nicht passt (übergangen). */
        unknownKeys: Type.Array(Type.String()),
        /**
         * Die privaten Abweichungen (WI-0180 §8), nur für Sitzungen mit `switch_environment`; sonst fehlt das Feld. Hinten
         * angehängt: Der Reiter „Karteneinstellungen“ liest es nicht, der Reiter „Umgebungen“ schon.
         */
        privat: Type.Optional(Type.Array(AdminKarteneinstellungRow)),
    },
    { additionalProperties: false },
);
export type AdminKarteneinstellungen = Static<typeof AdminKarteneinstellungen>;

/**
 * `POST /api/admin/system/karteneinstellungen`; `value: null` setzt auf die Vorgabe zurück.
 *
 * 🪤 **`value` hat ein offenes Schema, und die Tafel prüft ihn** (`karteneinstellungImRahmen`, im Schreibweg: 400
 * `value_out_of_range`). Zwei Wege sind gemessen gescheitert: Eine Vereinigung mit einem Zahlenschema lässt Fastifys ajv `null`
 * in 0 umwandeln (dieselbe Falle wie bei der Wegfindung), und das Zurücksetzen käme als Zoom 0 an; eine Typliste
 * `["number", "object", "null"]` wandelt nicht um, meldet aber bei JEDEM Serverstart „use allowUnionTypes“ (strictTypes).
 */
export const KarteneinstellungBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        id: Type.String({ minLength: 1, maxLength: 60, pattern: KARTENEINSTELLUNG_ID_MUSTER }),
        value: Type.Unsafe<KartenWert | null>({}),
    },
    { additionalProperties: false },
);
export type KarteneinstellungBody = Static<typeof KarteneinstellungBody>;

/**
 * `GET /api/map-settings`: die wirksamen Werte für den Start der Karte, für jeden Besucher. 🔴 Nur hinzufügen: Ein neues Feld
 * kommt hinten dazu, der Client liest tolerant (`map/start-view.ts`), der Server sendet streng.
 */
export const MapSettings = Type.Object(
    {
        revision: Nullable(Type.Integer({ minimum: 0 })),
        startPosition: KartenPunktSchema,
        startZoom: Type.Number(),
        // Das Panel „Routenplaner“ (WI-0166, zweiter Schnitt): hinten angehängt, wie es die Regel für Verträge will.
        planerReiseart: Type.String(),
        planerFlugmittel: Type.String(),
        planerLandErlaubt: Type.Boolean(),
        planerLandTransport: Type.String(),
        planerFlussErlaubt: Type.Boolean(),
        planerFlussTransport: Type.String(),
        planerMeerErlaubt: Type.Boolean(),
        planerMeerTransport: Type.String(),
        planerRoutenwahl: Type.String(),
        planerUmstiegeMinimieren: Type.Boolean(),
        planerEiltempo: Type.Boolean(),
        planerReisestunden: Type.Number(),
        planerReisebeginn: Type.Union([Type.Literal("unbestimmt"), ReisebeginnTagSchema]),
        planerUnterbringung: Type.String(),
        // Das Panel „Editierverhalten“ (WI-0177): hinten angehängt.
        fangradius: Type.Number(),
        // Die Werte der Wegfindung, die der Browser selbst anwendet (WI-0214): wirksam, nicht gespeichert; hinten angehängt.
        wegfindung: Type.Optional(WegfindungImBrowser),
        // Das Panel „Sprachen“ (WI-0261): hinten angehängt.
        sprachenMindestanteil: Type.Number(),
        // Die Panele „Herrschaftsgebiete“ (OPS-000082) und „Orte“ (OPS-000083): hinten angehängt.
        gebieteTransparenz: Type.Number(),
        ortFarbeOffiziell: Type.String(),
        ortFarbeInoffiziell: Type.String(),
        bauwerkFarbeOffiziell: Type.String(),
        bauwerkFarbeInoffiziell: Type.String(),
        // Das Panel „OceanShader an/aus“ (WI-0288): hinten angehängt.
        ozeanShaderAn: Type.Boolean(),
        ozeanGlanzpunkt: Type.Number(),
        ozeanGlanz: Type.Number(),
        // Das Panel „Zoomkurve“ (2026-11-09): hinten angehängt.
        zoomKurve: Type.Array(KurvenPunktSchema),
        // Das Panel „PDF Exporter“ (WI-0306, 2026-11-10): hinten angehängt.
        pdfKartenbild: Type.String(),
        pdfKarte: Type.String(),
        pdfEtappen: Type.Boolean(),
        pdfProfil: Type.Boolean(),
        pdfKosten: Type.Boolean(),
        pdfSchiffe: Type.Boolean(),
        pdfGebiete: Type.Boolean(),
        pdfUnterwegs: Type.Boolean(),
        pdfTagebuch: Type.Boolean(),
        pdfQr: Type.Boolean(),
        pdfEtappenArt: Type.String(),
        pdfWetter: Type.Boolean(),
        pdfDazuGegend: Type.Boolean(),
        pdfDazuGebiet: Type.Boolean(),
        pdfDazuSprache: Type.Boolean(),
        pdfDazuGelaende: Type.Boolean(),
        pdfDazuNeu: Type.Boolean(),
        pdfFormat: Type.String(),
        pdfLage: Type.String(),
        pdfPapier: Type.String(),
        pdfSprache: Type.String(),
        pdfDateiname: Type.String(),
    },
    { additionalProperties: false },
);
export type MapSettings = Static<typeof MapSettings>;

export const KARTENEINSTELLUNG_ERROR_STATUS = {
    unknown_setting: 400,
    value_out_of_range: 400,
    no_change: 409,
} as const;
