import type {
    BezugObjektart,
    CommunityLage,
    LoreKind,
    LoreRowView,
    MamEinreichung,
    MediaReisebild,
    MediaTypeImageVariant,
    MediaViewRelation,
    SourceEntry,
    SprachTrefferArt,
    SubjectRef,
    SubjectTarget,
    WaypointHit,
} from "@avesmaps3d/shared";
import type { LandscapeLines } from "../route-planner/route-landscapes";
import type { StageHead } from "../route-planner/stage-metrics";
import type { CatalogModel } from "./catalog-model";
import type { HeaderGraphic } from "./header-graphic";
import type { PanelRules } from "./panel-extras";

/**
 * Das Modell des Infopanels (WI-0063 P6, Design Guide §16): Was die Bausteine zeichnen, als reine Daten - gebaut aus der Antwort des
 * Servers in `panel-model.ts`, ohne Vue und ohne Browser. 🔴 Jedes Feld hier ist schon entschieden: Ein Baustein zeigt, was im Modell
 * steht, und was dort fehlt, fehlt auch im Bild (WI-0063 5.3: kein leerer Baustein). Texte stehen fertig in der Sprache der Seite.
 */

/**
 * Ein Stück Text; mit `ref` ist es ein Link, der das Subject öffnet (Hauptstadt, Verkehrsweg, Gebiet der Treppe). `swatch` ist die Farbe
 * eines kleinen Kästchens davor („Umstritten mit“, Legacy `createRegionContestedSwatchMarkup`): die Farbe, in der das Gebiet auf der
 * Karte steht.
 */
export interface TextPart {
    text: string;
    ref?: SubjectRef;
    swatch?: string;
    /**
     * Die Peilung hinter dem Text („12,3 Meilen ↗“, Legacy `avesmapsWhatIsHereDirMarkup`): `degrees` dreht die Nadel (0 = Norden, im
     * Uhrzeigersinn), `label` ist das Wort dazu für Bildschirmleser und Hinweis („Südwest (259,1°)“).
     */
    bearing?: { degrees: number; label: string };
    /** Ein Zeilenumbruch steht vor dem Teil (eine Liste langer Einträge, die Zeile für Zeile steht: die Gebiete einer Etappe). */
    breakBefore?: boolean;
    /**
     * Das Satzzeichen, das im Text unmittelbar auf einen Link folgt, bis zum nächsten Leerraum (das Komma in „<A>, <B>“). Es steht im
     * Kasten des Links (`info-link.vue`); nur `withTrailingPunctuation` setzt es, beim Zeichnen - das Modell trennt Link und Text.
     */
    tail?: string;
    /**
     * Ein zweiter Text derselben Stelle, den ein verborgener Klick an ihre Stelle setzt, und ein weiterer wieder zurück: die Grade
     * eines Kartenpunkts und darunter seine x/y-Koordinate (WI-0273, Betreiber 2026-10-31: „ein verborgener klick auf die
     * koordinaten soll wieder x/y enthüllen“). Ohne Hinweis und ohne Zeigerwechsel; nur die Tastatur sieht den Fokusring.
     */
    wechsel?: string;
}

/** Ein Eintrag des Untertitels („Metropole“, „Hauptstadt von X“); die Einträge trennt ein „ · “. */
export interface SubtitleItem {
    parts: TextPart[];
}

/** Das Kanon-Etikett (Guide §16, Legacy `featureKanonBadgeMarkup`): links der Kanon, rechts optional ein Bezeichner; ohne ihn ist die Pille rund. */
export interface CanonPill {
    state: "official" | "unofficial";
    /** Der Bezeichner der Halbpille („Briefspiel (2)“, „3 Quellen“, „Wiki Aventurica“), bei „offiziell“ wie bei „inoffiziell“; fehlt bei einer runden Pille. */
    by?: string;
}

export interface HeaderImage {
    id: string;
    url: string;
    width: number;
    height: number;
    /** Die Nennung, nur wo eine Freigabe sie verlangt (`MediaCredit`), als eine Zeile. */
    credit?: string;
    /**
     * Der Bildbezug eines Kopfbildes, wie der Server ihn liefert (`MediaPublicView.relation`, Betreiber 2026-10-11): `place_view`
     * (Ortsansicht), `type_image` (Typbild) oder, seit WI-0272 S5, `reisebild`. Fehlt er (Wappen, Antwort der Vorversion), gilt Typbild (`bildbezug.ts`).
     */
    relation?: MediaViewRelation;
    /** Nur bei `relation: "reisebild"` (WI-0272 S5): Beschreibung, freiwilliger Name der Nennung und Entstehung, wie der Server sie nennt. */
    reisebild?: MediaReisebild;
    /** Ein offener Eingang des Ortes (WI-0272 S5): nur für Editoren, aus der geschützten Route; nie aus der öffentlichen Antwort. `url` ist die interne Vorschau. */
    eingang?: true;
    /** Als KI-generiert gekennzeichnet (`MediaPublicView.ki`): Der Filter „Ohne KI“ nimmt eine solche Ortsansicht oder ein solches Typbild des Ortes aus dem Kopf. */
    ki?: true;
    /** Die Grafik der Art als Glied der Folge (vorn bei einem Ort ohne eigenes Bild, vor Reisebildern und Eingängen, `folgeMitEingaengen`). */
    grafik?: true;
}

/** Der Ort, dessen Kopf das Panel zeigt, soweit „+ Eigenes Bild hinzufügen“ ihn braucht (WI-0272 S5): Kennung, Name, Art und Lage. Nur an einem Ort. */
export interface HeaderOrt {
    id: string;
    name: string;
    subtype: string;
    x: number;
    y: number;
}

/**
 * Die Navigation einer Etappe (WI-0063 4.7, E13, 27.13): Der Kopf einer Etappe ist mittig gesetzt - „Etappe 3 von 12“ als Titel, darunter
 * „‹ Von → Bis ›“ in einer dreispaltigen Zeile, die Pfeile fest an den Rändern. Sie wählen die vorige und die nächste Etappe der Reise im
 * Planer; an Anfang und Ende ist der Pfeil gesperrt. Keine Kopie von Legacys Wegpunktleiste.
 */
export interface StageNav {
    /** Beschriftung der Pfeile (Bildschirmleser). */
    prev: string;
    next: string;
    hasPrev: boolean;
    hasNext: boolean;
}

export interface HeaderModel {
    title: string;
    subtitle: SubtitleItem[];
    /** Eine Zeile unter dem Untertitel: „Ganze Straße: Perz – Helmdahl“ (Legacy `info-header__markierung`, Wort fett). */
    note?: { label: string; text: string };
    /** Nur an einer Etappe: die Pfeile an den Rändern der Untertitelzeile; ihr Dasein setzt den ganzen Kopf mittig (Titel und Untertitel). */
    stageNav?: StageNav;
    /**
     * Nur an einer Etappe (WI-0079 §7a, Bildvorgabe des Betreibers vom 2026-10-05): die drei Kennzahlen unter dem
     * Kopf - Distanz, Reisezeit, Rastzeit - und die leise Teilstrecke darüber. Eine Größe, die es nicht gibt (eine
     * Etappe ohne Rast), hat keine Spalte und keinen Platzhalter. Gebaut in `route-planner/stage-metrics.ts`,
     * gezeichnet von `info-stage-head.vue`.
     */
    stageHead?: StageHead;
    canon?: CanonPill;
    /**
     * Ein verborgener Ort (WI-0080, Betreiber 2026-10-05): Neben dem Kanon-Etikett steht dann die Pille „Verborgen“ in Lila. Nur gesetzt,
     * wo es zutrifft, und nur aus dem Lesevertrag (`SubjectDetail.hidden`) - das Panel fragt nicht die Karte.
     */
    hidden?: true;
    /**
     * Eine gefährliche Fläche (WI-0308, Vali 2026-11-12 Antwort 12): neben dem Kanon-Etikett die Pille „Gefahrengebiet“, darunter die Arten
     * mit Komma. Nur aus dem Lesevertrag (`SubjectDetail.gefahr`).
     */
    gefahr?: { arten: string };
    /** Die Grafik der Art; `undefined`, solange die Antwort fehlt: Dann steht nur der Platzhaltergrund da. */
    graphic?: HeaderGraphic;
    /** Eine Sprache (WI-0261 S5b): ihre Farbe auf der Karte; links vom Namen steht dann eine Sprechblase in dieser Farbe (Bauvorlage `sprechblase`). */
    sprachfarbe?: string;
    /** Die eigenen Bilder des Objekts, eine Folge; leer: Es gilt die Grafik der Art. */
    images: HeaderImage[];
    /** Die zurückgehaltenen Typbilder eines Ortes (`SubjectMedia.typbilder`): Sie stehen nur da, wenn „Ohne KI“ alle `images` nimmt (`kopfOhneKi`). */
    typbilder?: HeaderImage[];
    /** Nur an einem Ort (WI-0272 S5): Er ist der Bezug von „+ Eigenes Bild hinzufügen“ links oben im Kopf, und die Eingänge der Redaktion gehören zu ihm. */
    ort?: HeaderOrt;
    /** Das Wappen links neben Name und Untertitel, nie im Bildbereich. */
    coat?: HeaderImage;
}

/**
 * Welches Katalogfenster aufgeht und wohin (WI-0118): „Kartensammlung von …“ oder „Literatur zu …“, für diesen Gegenstand, und - wenn ein
 * Eintrag angeklickt wurde - bei dieser Kennung, vergrößert. Ohne `focus` steht die Liste da, kein Eintrag ist aufgeklappt.
 */
export interface CatalogTarget {
    section: "citymaps" | "literature";
    ref: SubjectRef;
    /** Der Name des Gegenstands für den Titel des Fensters („Gareth“); leer: das Fenster heißt nur „Kartensammlung“. */
    name: string;
    focus?: string;
}

/**
 * Das Objekt, zu dem „Änderungen vorschlagen“ das Meldeformular öffnet (WI-0268 C2, Fachkonzept §6): Objektart, Kennung und der Schnappschuss von Name, Art und Lage, wie der
 * Besucher das Objekt sah. `typ` ist der Schlüssel der Art (`metropole`, `reichsstrasse`), nie ein übersetztes Wort; `lage` fehlt, wo die Antwort kein Ziel nennt.
 */
export interface SuggestTarget {
    objektArt: BezugObjektart;
    objektId: string;
    name: string;
    typ?: string | undefined;
    lage?: CommunityLage | undefined;
}

/**
 * Der Ort, zu dem „Bewertung schreiben“ das Fenster öffnet (WI-0269 C10, Fachkonzept §14): die Kennung (`place.public_id`) und der Name; `sterne` setzt die Wertung vor (ein Klick auf einen Stern, wo es
 * ihn gibt). Das Fenster gehört der Seite (`community/`), das Panel kennt nur die Naht.
 */
export interface ReviewTarget {
    ortId: string;
    ortName: string;
    sterne?: number | undefined;
}

/** Die Bewertung, die „⚑ Melden“ meldet: Kennung, Sterne und der Text, wie der Besucher ihn sah (nur für die Anzeige im Fenster, nie im Rumpf der Anfrage). */
export interface ReviewReportTarget {
    ortId: string;
    ortName: string;
    bewertung: { id: string; stars: number; text?: string | undefined; head: string };
}

/** Was eine Aktion tut: eine Beschreibung, die der Aufrufer (`app.vue`) über die vorhandenen Nähte ausführt. */
export type ActionRun =
    | { type: "addPlace"; hit: WaypointHit }
    | { type: "addMapPoint"; x: number; y: number }
    | { type: "removeDestination"; id: string }
    | { type: "share"; url: string; what: "place" | "pin" | "review" }
    /** „Bewertung schreiben“ (WI-0269 C10): das Formular der Besucher zum Ort. */
    | ({ type: "review" } & ReviewTarget)
    /** „⚑ Bewertung melden“ (WI-0269 C10): das Meldefenster zu dieser Bewertung. */
    | ({ type: "reviewReport" } & ReviewReportTarget)
    | { type: "show" }
    /** „Änderungen vorschlagen“ (WI-0268 C2): das Meldeformular zum Objekt, mit dem Objekt als Bezug. Es wird nichts an der Karte geändert. */
    | ({ type: "suggest" } & SuggestTarget)
    /** „Weg als Route“ (B12, Legacy `path-as-route`): Die Orte der Straße ERSETZEN die Wegpunkte des Planers, dann wird gerechnet. */
    | { type: "pathAsRoute"; places: WaypointHit[] }
    /** Die Pfeile der Etappe (E13): vorige oder nächste Etappe der Reise. */
    | { type: "stageStep"; step: 1 | -1 }
    | { type: "closePoint" }
    /** „Kartensammlung anzeigen“, „Literatur anzeigen“ und ein Klick auf eine Kachel des Streifens: das Fenster zum Abschnitt (WI-0118). */
    | ({ type: "openCatalog" } & CatalogTarget)
    /** „Karte vorschlagen“ (WI-0275 Stufe C): das Fenster der Besucher zur Kartensammlung dieses Gegenstands; `hatKarten` sagt, ob dort schon Karten liegen. */
    | { type: "suggestMap"; ref: SubjectRef; name: string; hatKarten: boolean }
    /**
     * Der Kontext-Einstieg in die Medienverwaltung (WI-0068 §13, P3): Wappen oder Kopfbild öffnen genau dieses Asset, die Treffer auf
     * das gezeigte Fachobjekt beschränkt. Nur im Editor-Modus mit `view_media_private` (der Knopf erscheint sonst nicht).
     */
    | { type: "openMedia"; asset: string; name: string }
    /**
     * „+ Eigenes Bild hinzufügen“ links oben im Kopf eines Ortes (WI-0272 S5): das Einreichungsfenster der Besucher mit dem Ort als Bezug und seiner Lage als Stelle, derselbe Weg wie im Kartenmenü.
     */
    | { type: "reisebildHinzufuegen"; ort: HeaderOrt }
    /**
     * Das ⚙ am Reisebild und am Eingang (WI-0272 S5): die Medienverwaltung im Korb „PhotoBox-Uploads“, mit dem Medium im Inspector, wenn eines genannt ist; ohne Medium der Korb allein, Unterteilung
     * „offen“. Ein Reisebild hängt an keinem Fachobjekt: Die Treffer sind darum nicht auf den Ort beschränkt (anders als bei `openMedia`).
     */
    | { type: "openReisebilder"; asset?: string; einreichung?: MamEinreichung }
    /**
     * Das ⚙ auf der Grafik der Art (WI-0272 S5, Vali: „bei wappen kann ich mit dem bearbeiten-zahnrad direkt in die MAM. das geht bei typbildern und photobox bildern noch nicht“): das Typbild dieser Kategorie in der
     * Medienverwaltung, an jedem Objekt mit Typbild. Die Kategorie ist die Grafik des Kopfes (`HeaderModel.graphic`).
     */
    | { type: "openTypbild"; kategorie: HeaderGraphic; variante?: MediaTypeImageVariant };

export type ActionId =
    | "addDestination"
    | "removeDestination"
    | "share"
    | "review"
    | "suggest"
    | "show"
    | "pathAsRoute"
    | "removePoint"
    | "citymapsAll"
    | "citymapsSuggest"
    | "literatureAll";

export interface PanelAction {
    id: ActionId;
    label: string;
    /** `accent` gefüllt (die Hauptaktion), `soft` normal, `danger` mit Zeichen in der Warnfarbe. */
    tone: "accent" | "soft" | "danger";
    icon:
        | { glyph: string }
        | {
              image:
                  | "linkteilen"
                  | "sextant"
                  | "vorschlag"
                  | "papierkorb"
                  | "waypoint-end"
                  | "kartensammlung"
                  | "literatur"
                  | "feder";
          };
    /** Was sie tut; fehlt es, ist die Kachel gesperrt (heute nur „Karte vorschlagen“ unter der Kartensammlung und ein Objekt, dessen Kennung die Antwort nicht nennt). */
    run?: ActionRun;
}

export interface StairRow {
    depth: number;
    name: string;
    ref: SubjectRef;
    /** Der Anteil, wo er etwas aussagt („ (83 %)“). */
    share?: string;
    /**
     * Das Wappen des Gebiets als kleiner Daumen VOR dem Namen (WI-0094, Legacy `.location-popup__breadcrumb-coat`). Es fehlt,
     * wo der Lesevertrag keines nennt - dann rückt der Name auf, es gibt kein Loch und keinen Platzhalter (wie in Legacy).
     * Das Bild ist schmückend: Der Name steht daneben, also trägt es keinen Alternativtext.
     */
    coat?: { url: string; width: number; height: number };
}

/** „Liegt in“ (WI-0063 5.4): die Herrschaftskette als Treppe von der Wurzel zum Blatt; eine lange wird ein Deckel. */
export interface LiesInModel {
    /** Die kurze Überschrift der offenen Treppe („Liegt in“, „Erstreckt sich über“). */
    heading: string;
    rows: StairRow[];
    /**
     * Gesetzt, wenn die Treppe lang ist: Sie steht dann im Deckel, dessen Kopf die Beziehung samt Zahl nennt („Erstreckt sich über 19
     * politische Gebiete“); eine eigene Überschrift gibt es dann nicht.
     */
    lid?: { summary: string };
}

export type RowValue =
    | { kind: "text"; text: string }
    /**
     * Eine Messangabe („12,34 Meilen“, „8,2 Stunden (0,34 Tage)“): der Text fertig formatiert, in der Zeile aber nach der Klappbox-Regel
     * gesetzt (Guide §16.3, `AvmText`): die Zahl hell mit Ziffern gleicher Breite, die Einheit gedämpft.
     */
    | { kind: "measure"; text: string }
    | { kind: "parts"; parts: TextPart[] }
    /**
     * Ein Deckel: zugeklappt die Vorschau („erste → … → letzte“), dazu „n Orte auf dem Weg“. `fullParts` ist der volle Text mit Links, wo
     * Stationen Objekte der Karte sind (die Vorschau steht auf dem Knopf des Deckels und bleibt Text). Ohne `preview` steht zugeklappt nur
     * Zahl und Wort („20 politische Gebiete“, die Gebiete einer Etappe).
     */
    | {
          kind: "lid";
          preview?: string;
          full: string;
          fullParts?: TextPart[];
          count: number;
          /**
           * Das Wort hinter der Zahl, in der Form, die zu ihr passt („Ort“, „Orte“) - fertig gesetzt (WI-0173).
           * 🪤 Die Wahl trifft der Erzeuger der Zeile mit der Zahl in der Hand, nicht das Bauteil: Es gibt Sprachen
           * mit drei Zählformen, und zwei Wörter können sie nicht tragen.
           */
          unit: string;
      }
    /** Ein Text, dessen Rest hinter der „…“-Pille steht: zugeklappt `text` (der erste Satz), aufgeklappt `full`. */
    | { kind: "more"; text: string; full: string }
    | LoreRowValue
    | StaettenRowValue
    | SprachTrefferRowValue;

/**
 * Eine der vier Vorkommenszeilen (WI-0091): ein Deckel, der zugeklappt wie aufgeklappt NUR den Zählsatz zeigt („35 Handelswaren
 * gelistet“). 🔴 Die Namen stehen nicht hier - sie kommen beim Aufklappen in einer eigenen Frage (`loadLore`), weil ein Ort im
 * Median 47 geerbte Einträge trägt. Die Zeile weiß also, WEN sie fragt (`ref`) und WAS sie fragt (`loreKind`), aber nicht die Antwort.
 */
export interface LoreRowValue {
    kind: "lore";
    /**
     * Wen die Zeile fragt. 🪤 **Fehlt an einer ROUTENETAPPE** (WI-0106): Eine Etappe ist kein Kartenobjekt, sie hat keine
     * Adresse, unter der eine Sektion nachzuholen wäre - dafür steht ihre Antwort schon in `section`.
     */
    ref?: SubjectRef;
    loreKind: LoreKind;
    count: number;
    sentence: string;
    /** Der Satz am Telefon, ohne Verb („445 Pflanzenarten“, WI-0098); bei 0 derselbe wie `sentence`. */
    shortSentence: string;
    /**
     * Die Antwort, die diese Zeile schon MITBRINGT (WI-0106, die Routenetappe): Dann fragt sie beim Aufklappen nichts nach.
     *
     * 🔴 **Das ist kein Abkürzen der Regel, sondern ihre Begründung von der anderen Seite:** Die Namen stehen nicht in der
     * Detailantwort, weil ein Ort im Median 47 und bis zu 256 Einträge trägt. Eine Etappe trägt im Median 23 und höchstens 130
     * (gemessen über vier Reisen, 129 Etappen) - und sie hat gar keine Detailantwort, in der eine Zahl stehen könnte. Für im
     * Median 2,0 kB eine zweite Frage zu stellen wäre ein Umweg, nicht Sparsamkeit.
     *
     * Nur die Zeilen, nicht die ganze Sektion: `subject` und `revision` braucht die Darstellung nicht.
     */
    section?: { rows: readonly LoreRowView[] };
}

/**
 * Die Zeile „Stätten“ eines Ortes (WI-0109): derselbe Deckel wie eine Vorkommenszeile, dieselbe Aufschrift-Rezeptur („21
 * Gebäude und Stätten verzeichnet“), nur eine andere Gliederungsachse hinter dem Klick (die ART statt der Nähe) und ein
 * Buchstabenregister erst ab zwei Namen.
 *
 * 🔴 Dieselbe verzögerte Frage wie bei den Vorkommen (`loadStaetten`): Gareth trägt 414 Stätten in 121 Arten. Die Zeile weiß, WEN
 * sie fragt (`ref`), aber nicht die Antwort. 🪤 Sie hat **kein** `section`: Stätten gibt es nur an Orten, und ein Ort hat immer
 * eine Adresse - der Fall der Routenetappe, die ihre Antwort mitbringt, entsteht hier nicht.
 */
export interface StaettenRowValue {
    kind: "staetten";
    ref: SubjectRef;
    count: number;
    sentence: string;
    /** Der Satz am Telefon, ohne Verb („90 Gebäude und Stätten“, WI-0098). */
    shortSentence: string;
}

/**
 * Eine Trefferzeile einer Sprache (WI-0261, Betreiber 2026-10-31: „kannst du dich hier an das design der bisherigen item in der infobox halten“): derselbe Deckel wie
 * eine Vorkommenszeile, die Namen holt sie beim ersten Aufklappen (`loadSprachTreffer`). Die Zeile weiß, WEN (`ref`) und WAS (`art`) sie fragt, nicht die Antwort.
 */
export interface SprachTrefferRowValue {
    kind: "sprachTreffer";
    ref: SubjectRef;
    art: SprachTrefferArt;
    count: number;
    sentence: string;
    /** Der Satz am Telefon, ohne Verb („721 Gebiete“), wie an den Vorkommen. */
    shortSentence: string;
}

export interface RowModel {
    key: string;
    label: string;
    value: RowValue;
}

export interface RightsRow {
    key: string;
    label: string;
    text: string;
    href?: string;
}

/** Die Wikizeile des Quellenkastens: erste Zeile der Zone „Quelle:“, mit ⓘ-Tafel und Kanon-Pille. */
export interface WikiModel {
    label: string;
    url: string;
    canon?: CanonPill;
    rights: RightsRow[];
}

/** „In der Nähe (3)“ einer freien Kartenstelle: ein Abschnitt (Guide §16.4) mit Zeilen in der Form der Feldliste. */
export interface NearbyModel {
    heading: string;
    count: number;
    rows: RowModel[];
}

/**
 * „Alle zeigen“ in der Infobox einer Sprache (WI-0261 S5c; Bauvorlage `ib-alle`): Es lässt die Flächen der Sprache leuchten und fliegt auf ihre Hauptteile. `gegenden` ist die Zahl der Teilflächen;
 * `ref` und `target` brauchen die Kamera (`flyToSubject`). Ob es leuchtet, liest die Komponente aus dem Zustand der App.
 */
export interface AlleZeigenModel {
    schluessel: string;
    gegenden: number;
    ref: SubjectRef;
    target?: SubjectTarget;
}

/** Wo die Quellen des Subjects liegen: Das Panel lädt sie sofort, sobald die Detailantwort sie zählt (`counts.sources`, nie 0). */
export interface SourceListModel {
    ref: SubjectRef;
    count: number;
}

export type { CatalogModel } from "./catalog-model";

export interface PanelModel {
    header: HeaderModel;
    actions: PanelAction[];
    /** Die Erklärung einer gesperrten Aktion als Zeile unter dem Band (Guide §13.11: nicht als Tooltip). */
    actionsNote?: string;
    liesIn?: LiesInModel;
    rows: RowModel[];
    /** Nur an einer freien Kartenstelle: was rundherum liegt (Legacy „In der Nähe“). */
    nearby?: NearbyModel;
    wiki?: WikiModel;
    sources?: SourceListModel;
    /**
     * Sprache (WI-0261 S5b): leise Zeilen unter der Feldtafel - die Herkunft des Wiki-Texts samt Lizenz, „Text: Wiki Aventurica (Autoren) · CC BY-SA 3.0“ (derselbe
     * Baustein wie in der Infobox eines Vorkommens, `lizenzTeile`), und die weiteren Wiki-Artikel einer Sprachgruppe. Ein Stück mit `href` führt nach draußen (↗).
     */
    lizenz?: readonly (readonly { text: string; href?: string | undefined }[])[];
    /** Sprache: „Wo sie gesprochen wird“, die Treffer je Art als Deckel (O4 „nur Zahlen, aufklappbar“). */
    gesprochen?: { heading: string; rows: RowModel[]; alleZeigen?: AlleZeigenModel };
    /** Quellen, die die Antwort mitbringt (die Referenzkarte der Sprachen, die weiteren Wiki-Artikel einer Sprache): Sie stehen im Quellenkasten. */
    quellen?: readonly SourceEntry[];
    /**
     * Die Katalogabschnitte NACH dem Quellenkasten, in Legacys Reihenfolge: Kartensammlung, Literatur, Bewertungen (WI-0063 27.7).
     * Jeder steht nur da, wo die Detailantwort ihn zählt; seine Liste holt er selbst. Eine Etappe hat keine (sie ist kein Träger).
     */
    catalogs?: CatalogModel[];
}

/** Was das Modell von außen braucht: die Regel (Legacy oder alle Zusatzfelder), die Seite ohne Query und den Stand der Reise. */
export interface PanelEnv {
    rules: PanelRules;
    /** Steht die Karte in der Standardansicht (WI-0272 §12 Frage 6)? Nur dort steht „+ Eigenes Bild hinzufügen“ im Kopf eines Ortes. Reaktiv. Fehlt die Angabe, gilt nein. */
    standardAnsicht?(): boolean;
    /** `origin + pathname`: Basis jeder Adresse zum Teilen. */
    pageUrl: string;
    /** Steht der Ort (oder die Kartenstelle) schon als Reiseziel in der Reise des Planers? */
    isDestination(id: string): boolean;
    /**
     * Die Landschaften und Gebiete je Etappe, wie der Planer sie schon abgefragt hat (WI-0063 27.13, kein zweiter Abruf); `null`, solange
     * die Abfrage läuft oder fehlschlug: Dann fehlen die beiden Zeilen der Etappe, ohne Platzhalter. Reaktiv: liest den Stand des Planers.
     */
    landscapes(): LandscapeLines | null;
    /**
     * Die Vorkommen der Etappe `index`, wie sie das Panel schon abgefragt hat (WI-0106); `null`, solange die Antwort fehlt oder
     * fehlschlug: Dann fehlen die vier Zeilen der Etappe, ohne Platzhalter - wie bei den Landschaften. Reaktiv.
     */
    stageLore(index: number): { rows: readonly LoreRowView[] } | null;
    /** Wie das eigene Flugmittel des Planers heißt (leer: „Eigenes Flugmittel“); die Fortbewegung eines Flugs nennt es so. */
    customAirName(): string;
    /**
     * Wie die KARTENPUNKTE der Reise im Planer heißen, nach Kennung („Kartenpunkt bei Rabenfelde“; WI-0087 P9).
     * Dieselbe Quelle wie die Wegpunkteingabe und die Etappenliste - die Teilstrecke im Kopf löst damit ihre
     * Wegpunktschlüssel auf, statt eine UUID zu zeigen.
     */
    pointNames(): ReadonlyMap<string, string>;
}
