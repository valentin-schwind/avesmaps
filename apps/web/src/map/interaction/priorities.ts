import { layersOfSelection, type LandscapeLayer, type LandscapeSelection, type MapView } from "@avesmaps3d/shared";

/**
 * Wer auf der Karte den Vorrang hat: EINE Tafel für alle Besitzer der Zeigerereignisse (M8, Hardening Review
 * 2026-09-28). Wer eine neue Art von Klick, Zeigen oder Geste einführt, trägt sie hier ein - nicht in eine
 * Bedingung an einer anderen Stelle. Eine höhere Zahl gewinnt.
 *
 * Die Rangfolge ist die von Legacy: Ort vor Route vor Fläche. Neu ist nur, dass sie an einer Stelle steht. Die Kraftlinie steht
 * zwischen Route und Fläche, das Klimaband unter allen Flächen (Begründung in der Tafel).
 *
 * | Id               | Zahl | Warum an dieser Stelle |
 * |------------------|------|------------------------|
 * | `camera-gesture` | 100  | Drehen und Neigen mit Strg + Ziehen oder Mitteltaste hat das letzte Wort: Es ist eine Geste der ganzen Karte, nicht eines Dings darauf. Kein Treffer-Besitzer, sondern eine Erfassung (`capture`). |
 * | `measure`        | 95   | Die laufende Entfernungsmessung (WI-0095). Sie steht über ALLEM außer der Kamerageste, und das ist Legacys Verhalten, nicht eine eigene Setzung: Legacy hängt den Klick, der den zweiten Punkt setzt, im **Capture** an den Kartencontainer und schluckt ihn (`handleDistanceMeasurementContainerClick`, `js/app/bootstrap.js` L1143) - ein Klick auf eine Stadt setzt den Zielpunkt und öffnet die Stadt nicht. Ebenso liegen Legacys Griffe über den Ortsmarken (Panes 520 > 500), auch über einer Wegpunktmarke. 🪤 Der Besitzer ist nur angemeldet, SOLANGE eine Messung läuft (`enabled`): Ohne sie verhält sich die Karte wie vorher. |
 * | `stelle-waehlen` | 94.5 | „Stelle ändern“ im Formular „Eigenes Bild hinzufügen“ der Reisebilder (WI-0272 S2b, `photobox/stelle-layer.ts`): Nur angemeldet, solange der Modus läuft; dann gehört ihm der nächste Klick auf die Karte, wo auch immer (Fadenkreuz), auch auf einem Ort, und er beendet den Modus. Wie `lage-zeigen`, nur für das andere Besucherfenster; die beiden laufen nie zugleich (es gibt ein Besucherfenster zur Zeit), der Rang ist nur eindeutig. Unter `measure`, über `lage-zeigen`. Reisebilder gibt es nur in der Standardansicht, darum steht er in keiner Tafel der Landschaften. Klick und Zeigen, nie der Druck. |
 * | `stelle-korrigieren` | 94.4 | „Stelle auf der Karte wählen“ in der Korrektur einer Reisebild-Einreichung durch die Redaktion (WI-0272 S3, `medien/medien-stelle-layer.ts`): wie `stelle-waehlen`, nur für die Medienverwaltung, die dafür zugeht; die beiden laufen nie zugleich, der Rang ist nur eindeutig. Nur angemeldet, solange die Wahl läuft; dann gehört ihm der nächste Klick, auch auf einem Ort. Klick und Zeigen, nie der Druck. |
 * | `lage-zeigen`    | 94   | „Neue Lage auf der Karte zeigen“ im Meldeformular der Besucher (WI-0268 C2, `community/lage-vorschlag.ts`): Nur angemeldet, solange der Modus läuft; dann gehört ihm der nächste Klick auf die Karte, wo auch immer (Fadenkreuz), auch auf einem Ort, und er beendet den Modus. Wie `place-set`, nur für Besucher; unter `measure` (eine laufende Messung setzt ihren Punkt zuerst), über `place-set` (beide laufen nie zugleich, der Rang ist nur eindeutig). Klick und Zeigen, nie der Druck. |
 * | `place-set`      | 93   | „● Auf der Karte setzen“ für einen Ort, der noch nicht auf der Karte steht (WI-0128 E16): Nur angemeldet, solange jemand den Knopf gedrückt hat, und dann gehört ihm der nächste Klick auf die Karte, wo auch immer (Fadenkreuz), auch auf einem Ort. Unter `measure`: Eine laufende Messung setzt ihren Punkt zuerst. Klick und Zeigen, nie der Druck. |
 * | `height-drag`    | 92   | „↕ Höhe ziehen“ im Kammeditor (WI-0249 P9; Betreiber 2026-10-24: „der toggle button zum einstellen der höhe (rauf runter) kann den cursor so verändern, dass die hoch-runter-bewegung auf der map die höhe einstellt“; `landschaftseditor/kamm-hoehe-ziehen.ts`). Nur angemeldet, solange der Knopf gedrückt ist; dann gehören ihm Druck und Zeigen nur über einem Anfasser oder der Kante eines Kamms (Zeiger `ns-resize`, die Karte verschiebt sich dort nicht; Betreiber 2026-10-25: „wenn man ins leere klickt … die ansicht bewegen … nur wenn man AUF die gipfel/kämme klickt, soll sich die höhe verändern“), über leerer Karte nichts, nie der Klick: Ein Klick ohne Bewegung wählt weiter über `geometry-edit` darunter. Über `geometry-edit`, damit ein Druck auf einen Anfasser die Höhe zieht statt den Punkt; unter `place-set` und `measure`. Zwei Finger, Strg und andere Tasten als die linke bleiben der Karte. |
 * | `geometry-edit`  | 91   | „Geometrie bearbeiten“: der EINE Besitzer der Anfasser und Kanten aller Editoren (WI-0177, Editor-Orchestrierung 2026-10-15; `map/geometrie/modus.ts`). Nur angemeldet, solange jemand einen Modus ausdrücklich gestartet hat (Wegkurve, Ecken, Kurve, Grenzen, „✥ Ort verschieben“ seit WI-0177 Stufe 4); dann gehören ihm die Anfasser (Druck, Zeigen, Klick) und die Kante (Zeigen, Klick für den Doppelklick), auch über einer Wegpunktmarke, und in einer Fläche der zweite Klick eines Doppelklicks ins Innere und bis 22 px neben die Kante (T59). Wer einen Rechtsklick am Anfasser anmeldet, bekommt ihn, und er schluckt ihn (Ort verschieben: sonst öffnete ein Klick ohne Bewegung mitten im Modus das Menü am Objekt; O2, Betreiber 2026-10-15). Unter `measure` und `place-set`; „● Auf der Karte setzen“ zieht später hierher (T12). |
 * | `wetter-icon`    | 88   | Die Griffe der Wetter-Icons im Wetter-Editor (WI-0288 Stufe 3, `map/wetter/wetter-griffe.ts`): Nur angemeldet, solange sein Fenster offen ist; dann gehören ihm Klick (wählt das Icon), Zeigen und Druck (zieht Lage, Pfeilspitze oder Ring) über einem Icon, auch über einem Ort darunter. Die Icons liegen als SVG über der Karte, also über jedem Objekt der Karte; unter `waypoint-drag` und `geometry-edit`, weil deren Griffe ausdrücklich gestartet sind. Ohne Schreibrecht nur der Klick. Kein Geometrie-Modul: Das Wetter speichert sofort (EDIT-0003 G4 sagt Entwurf mit „Fertig“; mit der Orchestrierung abzustimmen). |
 * | `wetter-info`    | 83   | Ein Wetter-Icon MIT Wiki-Verweis für Besucher (WI-0288, Betreiber 2026-11-08: „ja infopanel bauen“; `map/wetter/wetter-info.ts`): Klick öffnet sein Infopanel, Zeigen zeigt Hand und Schild. Die Icons liegen als SVG über der Karte, also über Ort, Reisebild und Fläche darunter; ein Icon ohne Verweis beansprucht nichts, sein Klick fällt durch wie bisher. Nur, solange der Wetter-Editor zu ist (sonst `wetter-icon`); unter `object-dblclick`, der nur im Editor angemeldet ist. Kein Druck: Ziehen über einem Icon bewegt die Karte. |
 * | `object-dblclick` | 85  | Der gemeinsame Doppelklick auf Objekte im Editor (WI-0177, EDIT-0003 R3, `editor-menu/doppelklick.ts`): Er zählt zwei Klicks am selben Fleck und nimmt nur den ZWEITEN; der erste fällt durch und wählt wie jeder Klick. Über Ort, Weg und Fläche, damit der zweite Klick nicht die Auswahl weiterdreht (übereinanderliegende Flächen, der Abschnitt eines Wegs); unter `geometry-edit`, damit der Doppelklick auf Anfasser und Kante dem laufenden Modus bleibt. Nur im Editor angemeldet. |
 * | `waypoint-drag`  | 90   | Eine Wegpunktmarke liegt über allem, auch über einem Ort: Wer sie packt, zieht sie (WI-0052). Sie beansprucht Druck und Zeigen, nie den Klick. |
 * | `reisebild`      | 82   | Das Zeichen und die Fahne der Reisebilder auf der Karte (WI-0272 S4, `photobox/reisebilder-karte.ts`): Ein Klick auf ein Symbol öffnet die Leiste oder die Bildansicht und keinen Ort darunter, die Fahne sitzt neben dem Marker und darf ihn nicht schlucken. Über `place`, unter `object-dblclick`. Nur in der Standardansicht angemeldet (`enabled`), darum in keiner Tafel der Landschaften. Klick und Zeigen; der Rechtsklick gehört dem Kartenmenü darunter. |
 * | `place`          | 80   | Ein Ort vor der Route und der Fläche darunter (Legacy `_onClick`: Ort vor Weg vor Region). |
 * | `route`          | 60   | Die Route (Linie und Wegpunktmarken) vor jeder Fläche (WI-0043). |
 * | `powerline`      | 50   | Die Kraftlinie (WI-0063 P8): Legacy fragt zuerst den Ort an der Stelle (Klick-Schiedsrichter, `map-features-powerlines.js` L554), dann erst die Linie; sie liegt über Wegen und Flächen (Panes 400 < 430, siehe `place-layers.ts`) und unter der Route, die über allem gezeichnet wird. Wo sie sichtbar ist, gibt es keine Wege und Flächen (nur in der Kraftlinien-Ansicht). |
 * | `gebiet-wechsel` | 46  | Der Klick auf ein anderes Gebiet in „Grenzen bearbeiten“ (OPS-000077, `gebietseditor/gebiet-wechsel.ts`): Vor dem Weg, sonst schluckte jeder Weg im Nachbargebiet den Wechsel; ein Ort und ein Gipfel gehen vor. Nur angemeldet und nur, solange der Modus läuft. |
 * | `path`           | 45   | Der Weg - Straße, Pfad, Pass UND Fluss (WI-0090). Legacys Klick-Schiedsrichter ist Ort vor **Weg** vor Region (`_onClick`), und genau diese Lücke füllt die Zahl: unter `powerline` (50), weil die Kraftlinie über den Wegen gezeichnet wird (Panes 400 < 430) und wer oben liegt, den Klick bekommt; über `area` (40), weil ein Weg auf der Fläche liegt und das kleinere Ding ist. Die Route (60) bleibt darüber: Sie wird ENTLANG der Wege gerechnet, läge also dauernd auf einer Straße - gewänne der Weg, ließe sich keine Etappe einer Straßenreise mehr wählen (A9). Ein Fluss stand schon bisher vor jeder Fläche unter ihm (`area: 0` in `area-candidates.ts`); mit 45 bleibt genau diese Rangfolge, nur ohne eine zweite Regel im Besitzer `area`. |
 * | `area`           | 40   | Die Fläche: das, was unter allem liegt. Der Besitzer ist in jeder Ansicht angemeldet; WELCHE Flächen er annimmt, sagt `LAYER_OWNERS` unten (`areaLayers`, WI-0083). Der Fluss ist seit WI-0090 beim Besitzer `path` - er IST ein Weg, und zwei Besitzer für dieselbe Linie wären zwei Stellen für dieselbe Regel. Später sitzt hier die Rangfunktion aus `region_layer` und `stack_order` (siehe `area-selection-input.ts`). |
 * | `sprache`        | 35   | Die Sprache (WI-0261 S5b): Ihre Flächen gibt es nur in der Ebene „Sprachen“ der Derographie (`layersOfSelection`), und dort decken sie fast das ganze Land. Sie liegen unter jeder Fläche und jedem Weg, die ein Anzeige-Schalter dort zeichnet (ein Ort gewinnt wie in der Bauvorlage), und über dem Klimaband, das es in dieser Ebene nicht gibt. Wo zwei Sprachen überlappen, öffnet der Klick erst das kleine Menü am Zeiger. |
 * | `climate`        | 30   | Das Klimaband (WI-0063 P8): Es deckt in seiner Ansicht die ganze Karte und liegt unter allem, was darauf gezeichnet ist - ein Fluss oder eine Fläche darüber gewinnt vor ihm (Legacy: eigenes Pane unter den übrigen Landschaftsebenen). Bänder gibt es nur in der Klimaansicht („Alle“ zeigt keine, Betreiber 2026-10-05, wie Legacy), und dort ist das Band das EINZIGE wählbare Objekt (`LAYER_OWNERS` unten). Der Rang hält die Rangfolge fest, falls ein Band je wieder unter anderen Flächen liegt. |
 * | `context`        | 20   | Das Kontextmenü gilt an jedem Kartenpunkt: **Rechtsklick am Rechner, langer Druck am Finger** (WI-0108, Betreiber 2026-10-08: „langer tap ist rechtsklick“). Es steht unter allen Besitzern, die später ein eigenes Menü bringen (Ort, Wegpunkt, Fläche bearbeiten): Die haben Vorrang vor dem allgemeinen. Über `empty`, weil es nie leer ausgeht. 🔴 Es ist seitdem der EINZIGE Besitzer des langen Drucks; die Zeile `map-point` 10 („Was ist hier?“ direkt am langen Druck, WI-0063 4.3) ist weg, denn „Was ist hier?“ ist der erste EINTRAG dieses Menüs. Solange sie dastand, nahm jedes Objekt mit höherem Rang - Weg 45, Fläche 40, Band 30 - dem Menü den langen Druck weg, und am Telefon war es nirgends zu öffnen. |
 * | `empty`          | 0    | Der Rückfall: Ein Klick, den niemand beansprucht, ist ein Klick in die freie Karte und beendet jede Auswahl. |
 *
 * Gleiche Zahlen sind nicht verboten, aber unentschieden: Dann gewinnt, wer zuerst angemeldet wurde. Ein Test
 * (`interaction-coordinator.test.ts`) hält die Zahlen unterschiedlich.
 */
export const INTERACTION_PRIORITY = {
    "camera-gesture": 100,
    measure: 95,
    // Der Klick des Formulars „Eigenes Bild hinzufügen“ (WI-0272 S2b): wie `lage-zeigen`, für das Fenster der Reisebilder.
    "stelle-waehlen": 94.5,
    // Die Kartenwahl der Redaktion in der Korrektur einer Einreichung (WI-0272 S3): wie `stelle-waehlen`, für die Medienverwaltung.
    "stelle-korrigieren": 94.4,
    "lage-zeigen": 94,
    "place-set": 93,
    "height-drag": 92,
    "geometry-edit": 91,
    "waypoint-drag": 90,
    // Die Griffe der Wetter-Icons, nur bei offenem Wetter-Editor (WI-0288 Stufe 3).
    "wetter-icon": 88,
    "object-dblclick": 85,
    // Ein Wetter-Icon mit Wiki-Verweis öffnet sein Infopanel (WI-0288), nur bei geschlossenem Wetter-Editor.
    "wetter-info": 83,
    // Zeichen und Fahne der Reisebilder (WI-0272 S4): vor dem Ort darunter, nur in der Standardansicht.
    reisebild: 82,
    place: 80,
    // Gipfel und Vulkane (WI-0178 P2, T55): das ▲ vor der Fläche darunter und vor Weg und Route, ein Ort darüber gewinnt.
    peak: 70,
    route: 60,
    powerline: 50,
    "gebiet-wechsel": 46,
    path: 45,
    area: 40,
    sprache: 35,
    climate: 30,
    context: 20,
    empty: 0,
} as const;

export type InteractionOwnerId = keyof typeof INTERACTION_PRIORITY;

/**
 * Was in einer Ebene der Landschaften überhaupt an Klick, Zeigen, Druck und langem Druck teilnimmt: die zweite Tafel neben dem
 * Rang. Sie beantwortet ZWEI Fragen, und `participationInView` ist die eine Stelle, die sie liest:
 *
 * | Feld | Frage | `undefined` heißt |
 * |---|---|---|
 * | `owners` | Welche BESITZER nehmen teil? | alle (der `scope` des Koordinators) |
 * | `areaLayers` | Welche Landschaftsebenen nehmen die Besitzer `area` (Flächen) und `path` (Flüsse) an? | alle |
 *
 * 🔴 Klimazonen: nur das Klimaband wird gewählt (Betreiber 2026-10-05, wörtlich: „kannst du bei der klimazonenansicht auch nur
 * klimazonen klickbar machen?“). Meer, See, Fluss, Landschaftsfläche, Ort, Weg und Route wählt dort niemand, sie zeigen auch kein
 * Zeiger-Schild; ein Klick fällt auf das Band darunter durch.
 *
 * 🪤 **Das ist in den Klimazonen eine ENTSCHEIDUNG, keine Folge der Karte** (WI-0090 O1): Dort sind Wege nicht bloß im Stil,
 * sondern voll gezeichnet (`LAYER_DEFAULTS.klima.paths: true`; bei Gareth auf z 6,5 gemessen: 938 Wegfeatures im Bild, alle
 * sechzehn Wegebenen im Stil). „Jede Art, die gezeichnet ist, hat einen Besitzer“ (`AGENTS.md`) hieße also, `path` hier
 * einzutragen; der Satz des Betreibers oben sagt das Gegenteil, und er ist auf genau diese Ansicht gemünzt. Darum bleibt
 * `path` draußen, bis er es anders sagt - umlegen ist diese eine Liste.
 *
 * Es bleiben, was keine Objektwahl ist:
 * - `camera-gesture`: Drehen und Neigen (eine Erfassung, keine Teilnahme; steht hier, damit die Tafel vollständig ist),
 * - `measure`: die laufende Entfernungsmessung (WI-0095) - sie wählt kein Objekt, sie misst zwei Stellen der Karte, und
 *   Legacy lässt sie in jeder Ansicht laufen,
 * - `geometry-edit`: ein ausdrücklich gestarteter Modus des Geometrie-Moduls, etwa das Verschieben eines Orts (Arbeit im Ortseditor,
 *   E12, seit WI-0177 Stufe 4 auf dem Modul),
 * - `waypoint-drag`: das Ziehen einer Wegpunktmarke, wenn eine Route steht (Arbeit am Planer),
 * - `context`: das Kontextmenü am Rechtsklick und am langen Druck (WI-0108; darin steht „Was ist hier?“),
 * - `empty`: der Klick ins Leere jenseits der Bänder.
 *
 * 🔴 Wege außerhalb der Klimazonen: Ein Weg nimmt teil, wo er GEZEICHNET ist (WI-0090) - und das steht nicht hier, sondern im
 * Stil: Seine unsichtbare Trefferebene entsteht je Wegart mit demselben Filter und demselben `minzoom` wie die gezeichnete
 * Linie (`buildPathLayers`, Art `hit`). Was das Anzeige-Menü ausschaltet, was eine Ansicht nicht zeigt und was auf dieser
 * Zoomstufe zu klein ist, hat keine Trefferebene und damit keinen Kandidaten. Eine Zeile „in welcher Ansicht gibt es Wege“
 * wäre die zweite Antwort auf eine Frage, die der Stil schon beantwortet.
 *
 * 🔴 Flächen: In jeder Ansicht nimmt nur die Fläche teil, deren Ebene gerade gewählt ist (WI-0083, Betreiber 2026-10-05,
 * wörtlich: „kannst du dafür sorgen, dass immer nur die flächen (derographie, vegetation, topographie) angeklickt werden können,
 * deren ansicht gerade aktiv is. seen und meere sollen in allen ansichten sichtbar sein, aber nur in topographie (und alle)
 * anklickbar.“). In „Alle“ nehmen alle teil. Seen und Meere sind Landschaftsarten der TOPOGRAPHIE (Kartografie-Tafel) und hängen
 * damit an ihr: sichtbar bleiben sie überall, wählbar sind sie nur in Topographie und „Alle“.
 *
 * 🔴 Flüsse und Bäche genauso (WI-0083 Nachtrag, Betreiber 2026-10-05 „ja“ auf die Vorlage: „Ein Fluss ist Wasser wie ein See“).
 * Ein Fluss ist in unseren Daten ein WEG und trägt keine Landschaftsebene; seine Zugehörigkeit entsteht deshalb über das Wasser
 * (`isWaterPathSubtype` × `WATER_CARTOGRAPHY_LAYER`, gesetzt am Kandidaten in `area-candidates.ts`). Gezeichnet bleibt er samt
 * seinem Namen überall; was wegfällt, ist außerhalb von Topographie und „Alle“ nur das Treffen. Der Seeweg steht ohnehin auf
 * keiner Karte (`hidden`), und eine ROUTE über demselben Fluss bleibt wählbar: Rang `route` 60 steht über `area` 40.
 *
 * 🪤 `areaLayers` ist keine neue Wertetafel, sondern abgeleitet: Welche Ebenen eine Auswahl ZEICHNET, sagt schon
 * `layersOfSelection`, und genau die nehmen teil. Eine zweite Liste könnte von der ersten weglaufen.
 *
 * 🪤 Eine Bedingung in einem einzelnen Besitzer („bin ich in der Klimaansicht?“, „liegt meine Ebene vorne?“) wäre die zweite
 * Stelle für dieselbe Frage; der Koordinator liest `owners` (`scope`) und lässt die übrigen Besitzer gar nicht erst fragen, und
 * der Besitzer `area` bekommt `areaLayers` als Eingabe gereicht.
 */
export const LAYER_OWNERS: Partial<Record<LandscapeSelection, readonly InteractionOwnerId[]>> = {
    klima: [
        "camera-gesture",
        "measure",
        "lage-zeigen",
        "place-set",
        "geometry-edit",
        "waypoint-drag",
        "climate",
        "context",
        "empty",
    ],
};

/** Was in dieser Ansicht teilnimmt: die Besitzer, und die Flächen und Flüsse welcher Landschaftsebenen. */
export interface ViewParticipation {
    /** Die Besitzer, die teilnehmen; `undefined` heißt alle. */
    readonly owners: readonly InteractionOwnerId[] | undefined;
    /** Die Landschaftsebenen, deren Flächen und Flüsse der Besitzer `area` annimmt; `undefined` heißt alle. */
    readonly areaLayers: readonly LandscapeLayer[] | undefined;
}

/** Die eine Stelle, die die Tafel liest. Außerhalb der Landschaften nimmt alles teil, was gezeichnet ist. */
export function participationInView(view: MapView, layer: LandscapeSelection): ViewParticipation {
    if (view !== "landscapes") return { owners: undefined, areaLayers: undefined };
    return { owners: LAYER_OWNERS[layer], areaLayers: layersOfSelection(layer) };
}

/** Die Besitzer, die in dieser Ansicht teilnehmen; `undefined` heißt alle. */
export function ownersInView(view: MapView, layer: LandscapeSelection): readonly InteractionOwnerId[] | undefined {
    return participationInView(view, layer).owners;
}

/** Die Landschaftsebenen, deren Flächen und Flüsse in dieser Ansicht teilnehmen; `undefined` heißt alle. */
export function areaLayersInView(view: MapView, layer: LandscapeSelection): readonly LandscapeLayer[] | undefined {
    return participationInView(view, layer).areaLayers;
}

/**
 * Bekommt ein Weg beim Zeigen die gestrichelte Umrandung dazu? Die DRITTE Frage dieser Tafel, und die EINE Stelle, an der
 * sie steht (WI-0090 § 2, Betreiber 2026-10-06).
 *
 * 🔴 Die Regel in einem Satz: **Die Auswahl ist überall gleich; der Unterschied sitzt allein in der Vorschau.** Ein Tooltip
 * kommt immer, die Strichelung in jeder Ansicht AUSSER „Standard“. Wörtlich: „in der standardansicht will ich dass wege wie orte angeklickt und gehovered werden können (gelb
 * abgeklickt, tooltip hover). in allen andern ansicht, wo straßen an sind, sollen sie wie flüsse markiert werde werden
 * können (mit dem gelben gestrichelten rahmen)“ und „ich wollte die standardansicht nicht mit gelben gestrichelten linien
 * verhunzen. die kommen in der neutralen topographie ansicht gut an“.
 *
 * 🔴 **„Standardansicht“ ist die ANSICHT „Standard“ am Kartenfächer** (WI-0090 O2, Betreiber 2026-10-09: „Standardansicht =
 * Kartenfächer auf Standard“), nicht die Landschaftsebene „Alle“. Vorher war die Frage offen, und gestrichelt wurde
 * vorsichtshalber nur, wo genau eine Landschaftsebene das Bild trug; jetzt gilt der Satz wörtlich: „in allen andern ansicht,
 * wo straßen an sind“ - also auch Landschaften mit „Alle“, Politisch, Nur Karte und Kraftlinien, sobald dort Wege gezeichnet
 * sind. Die Ebene spielt keine Rolle mehr. In den Klimazonen sind Wege gar nicht wählbar (O1, Betreiber 2026-10-09: „Nein
 * nicht anklickbar“, `LAYER_OWNERS.klima`), dort fragt diese Funktion niemand.
 */
export function pathPreviewOutlined(view: MapView): boolean {
    return view !== "standard";
}
