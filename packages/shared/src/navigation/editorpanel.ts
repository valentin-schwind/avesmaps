import type { NavTafel } from "./navigation.ts";

/**
 * Die Tafel des Editorpanels (EDIT-0001 §3.2). Legacys Weg (Mirror `cfbbe69c8`, `index.html:467-472`,
 * `js/review/review-subjects.js:79-92`): Reiter Community · Änderungen · WikiSync · Status, unter WikiSync die Schiene der acht
 * Subjekte, je Subjekt ein Verb; Aliasse sind Legacys Werte von `data-editor-panel-tab` und `data-wiki-sync-panel-tab`.
 *
 * - Der Reiter „WikiSync“ heißt „Karteninhalte“ (Betreiber 2026-10-10, WI-0126 §11b); „Dump holen“ und „Konflikte“ sitzen in der
 *   Systemsteuerung unter „Abgleiche“ (§11c).
 * - Karten haben keinen eigenen Eintrag (Vali 2026-11-02): Sie stehen in der Medienverwaltung und als Reiter „Karten“ am Objekt (`fenster/traeger-karten.vue`). Die Karteninhalte stehen alle da, die noch nicht gebauten als „später“ (D16); jede Zeile wird beim Bau ihres Editors aus
 *   `spaeter` ein `subjekt` mit Verb und Werkzeug. Liste und Ziel je Inhalt nach EDIT-0001 §4.7.
 * - „Community“ ist seit WI-0268 C3 ein Bereich mit dem Unterreiter „Meldungen“ (Mails, Bewertungen und Social Hub stehen als „später“
 *   da); „Änderungen“ ist seit E17 ein Bereich.
 * - Die Orte haben keine Ansichten mehr (Betreiber 2026-10-11: „Alle“, „Platziert“, „Fehlt“ in den Trichter, „weil nicht ganz klar ist,
 *   ob die Filter mit oder dagegen zählen“): Die Facette `karte` steht ganz oben, „Auf der Karte“ und „Nicht auf der Karte“.
 */
export const EDITORPANEL = {
    id: "editorpanel",
    vorgabe: "karteninhalte",
    wurzel: "reiter",
    eintraege: [
        // Die Community (WI-0268 C3, Bedienkonzept WI-0263 §1.1): Meldungen sind gebaut, Mails, Bewertungen und der Social Hub folgen
        // (Teil 2 und C4); Mails sind seit WI-0268 C4, Bewertungen seit WI-0269 C10, der Social Hub seit WI-0270 C11 gebaut. Legacys Unterreiter hießen Meldungen · Bewertungen · Mails · Social Media; hier steht die abgenommene Folge.
        {
            id: "community",
            unter: null,
            art: "bereich",
            // Eines genügt: Diplomat, Social-Media-Manager und Kartograph (WI-0279) sehen den Reiter ohne die Meldungen, nur mit ihrem Unterreiter.
            rechte: ["moderate_submissions", "read_mailbox", "social_communication", "moderate_map_suggestions"],
            kinder: "unterreiter",
            alias: ["review"],
        },
        // Die Meldungen tragen seit WI-0305 auch die Kartenvorschläge (Vali 2026-11-10: „Als Eintrag der Meldungen“): Der eigene Unterreiter „Karten“ (WI-0275) ist fort, sein Tiefer Link
        // `?tab=kartenvorschlaege` führt hierher. Wer nur Kartenvorschläge prüft (Kurator, Kartograph, WI-0279), sieht die Meldungen mit nur diesen.
        {
            id: "meldungen",
            unter: "community",
            art: "bereich",
            rechte: ["moderate_submissions", "moderate_map_suggestions"],
            alias: ["reports", "kartenvorschlaege"],
        },
        // Die Mails (WI-0268 C4): Anfragen aus dem Kontaktformular mit Eingang, Gesendet und Archiv; nur mit `read_mailbox` (Betreiber, Fachkonzept §9, E3), Reviewer sehen den Unterreiter nicht.
        { id: "mails", unter: "community", art: "bereich", rechte: ["read_mailbox"] },
        { id: "bewertungen", unter: "community", art: "bereich", rechte: ["moderate_submissions"] },
        // Der Social Hub (WI-0270 C11): nur mit dem Recht für Beiträge des Projekts; Reviewer sehen den Unterreiter nicht.
        { id: "social", unter: "community", art: "bereich", rechte: ["social_communication"] },
        { id: "aenderungen", unter: null, art: "bereich", rechte: ["use_editor_menu"], alias: ["changes"] },
        {
            id: "karteninhalte",
            unter: null,
            art: "bereich",
            rechte: ["use_editor_menu"],
            kinder: "schiene-zweispaltig",
            alias: ["wiki-sync", "wikisync"],
        },
        {
            id: "orte",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "punkt",
            stand: "abgleich.orte",
            verb: {
                id: "orte-bearbeiten",
                werkzeug: "ortseditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_map_objects"],
            },
            facetten: ["karte", "typ", "lage", "art", "kontinent", "quelle", "wappen", "bilder"],
            alias: ["locations"],
        },
        { id: "ortseditor", unter: "orte", art: "werkzeug", rechte: [] },
        {
            // Der Gebietseditor (WI-0209 A3, EDIT-0005 §3): Liste als Baum mit Legacys Kreis über die Untergebiete (T26 (5)), Ziel der
            // Ausschnitt; ein Klick in der Liste stellt die Karte auf „Politisch“ (F17, T32).
            id: "territorien",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "baum",
            ziel: "ausschnitt",
            verb: {
                id: "herrschaftsgebiete-bearbeiten",
                werkzeug: "gebietseditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_territories"],
            },
            // „Befund“ mit „Prüfen“ (WI-0209 D6).
            facetten: ["karte", "jahr", "art", "befund", "stand"],
            alias: ["territories"],
        },
        { id: "gebietseditor", unter: "territorien", art: "werkzeug", rechte: [] },
        {
            // Der Landschaftseditor (WI-0178, EDIT-0004 §2.1): Liste flach, Ziel der Ausschnitt; die Ebene wählt die Karte (T27 (1)).
            id: "regionen",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "ausschnitt",
            verb: {
                id: "landschaften-bearbeiten",
                werkzeug: "landschaftseditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_landscapes"],
            },
            // Flächenart und Landmarkenart statt „Art“ (WI-0271 L4): Jede gilt nur an ihren Zeilen.
            // „Gefahrenlage“ (WI-0308): gefährlich oder ungefährlich, nur an Flächen.
            facetten: ["wiki", "darstellung", "flaechenart", "landmarkenart", "stand", "sichtbarkeit", "gefahrenlage"],
            alias: ["regions"],
        },
        { id: "landschaftseditor", unter: "regionen", art: "werkzeug", rechte: [] },
        {
            // Das Wege-Fenster (WI-0177 Stufe 2, W5a): eine Zeile je Straße (die Abschnitte gleichen Namens und gleicher Art), die
            // Abschnitte in den Eigenschaften; ein Klick in der Liste stellt die Karte auf „Standard“ (F17, T32).
            id: "wege",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "ausschnitt",
            verb: {
                id: "wege-bearbeiten",
                werkzeug: "wegeditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_map_objects"],
            },
            // Der Stand (T54) statt „Karte“: auf der Karte, nicht auf der Karte, gelöscht.
            facetten: ["stand", "wiki", "art"],
            alias: ["paths"],
        },
        { id: "wegeditor", unter: "wege", art: "werkzeug", rechte: [] },
        {
            // Der Kraftlinien-Editor (WI-0205 K2): eine Zeile je Linie (die Abschnitte gleichen Namens), Ziel der Ausschnitt; ein Klick
            // in der Liste stellt die Karte auf die Ansicht „Kraftlinien“ (F17, T32).
            id: "kraftlinien",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "ausschnitt",
            verb: {
                id: "kraftlinien-bearbeiten",
                werkzeug: "kraftlinieneditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_map_objects"],
            },
            facetten: ["wiki", "gestalt", "stand"],
            alias: ["powerlines"],
        },
        { id: "kraftlinieneditor", unter: "kraftlinien", art: "werkzeug", rechte: [] },
        {
            // Der Spracheditor (WI-0261 S5d2; Betreiber 2026-10-30: „intern sind es inhalten -> Auf der Karte -> Sprachen und benötigen auch
            // einen editor“): eine Zeile je Sprache und je freiem Wiki-Artikel, Ziel der Ausschnitt; ein Klick in der Liste stellt die Karte
            // auf Derographie › Sprachen (F17, T32). Schreiben mit `edit_languages` (ab Admin und über die Sonderrolle Linguist, WI-0279 E17a); Editoren lesen.
            id: "sprachen",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "ausschnitt",
            verb: {
                id: "sprachen-bearbeiten",
                werkzeug: "spracheditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_languages"],
            },
            facetten: ["zustand", "stand"],
            alias: ["languages"],
        },
        { id: "spracheditor", unter: "sprachen", art: "werkzeug", rechte: [] },
        {
            // Der Wetter-Editor (WI-0288 Stufe 3; Probierseite `review/wetter-editor/`, Idee A und B): EINE Liste mit den Gruppen „Presets“
            // und „Icons“, Ziel ein Punkt (die Icons). Nur wer das Wetter schreibt, sieht die Kachel: Editoren und die Rolle Meteorologe.
            id: "wetter",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: ["edit_weather"],
            liste: "gruppiert",
            ziel: "punkt",
            verb: {
                id: "wetter-bearbeiten",
                werkzeug: "wettereditor",
                rechte: ["use_editor_menu"],
                schreiben: ["edit_weather"],
            },
            facetten: ["art", "sicht", "zeit"],
        },
        { id: "wettereditor", unter: "wetter", art: "werkzeug", rechte: [] },
        // Das Fenster „Inhalte bearbeiten“ (WI-0254): EIN Fenster mit vier Reitern (Quellen, Literatur, Vorkommen, Korpora); das Verb jedes
        // dieser Karteninhalte öffnet es mit dem eigenen Reiter vorn. Das Werkzeug steht unter „Quellen“, den Reiter wählt die Oberfläche
        // aus dem gewählten Inhalt. Keine Ziele auf der Karte (`ziel: "keins"`): Es sind Nachschlagewerke, keine Kartenobjekte.
        {
            id: "literatur",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "keins",
            verb: {
                id: "literatur-bearbeiten",
                werkzeug: "inhalteeditor",
                rechte: ["use_editor_menu"],
                schreiben: ["manage_sources"],
            },
            alias: ["adventures"],
        },
        {
            id: "vorkommen",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "keins",
            verb: {
                id: "vorkommen-bearbeiten",
                werkzeug: "inhalteeditor",
                rechte: ["use_editor_menu"],
                schreiben: ["manage_sources"],
            },
            alias: ["lore"],
        },
        {
            id: "quellen",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "keins",
            verb: {
                id: "quellen-bearbeiten",
                werkzeug: "inhalteeditor",
                rechte: ["use_editor_menu"],
                schreiben: ["manage_sources"],
            },
            alias: ["sources"],
        },
        { id: "inhalteeditor", unter: "quellen", art: "werkzeug", rechte: [] },
        {
            id: "korpora",
            unter: "karteninhalte",
            art: "subjekt",
            rechte: [],
            liste: "flach",
            ziel: "keins",
            verb: {
                id: "korpora-bearbeiten",
                werkzeug: "inhalteeditor",
                rechte: ["use_editor_menu"],
                schreiben: ["manage_sources"],
            },
            alias: ["corpora"],
        },
        // Die Besucherstatistik (WI-0138). Legacys Unterreiter in Legacys Reihenfolge (`index.html:829-832`); „API“ wartet auf
        // die eigene Zähltabelle (BESUCH-0001 §15, V12).
        {
            id: "status",
            unter: null,
            art: "bereich",
            rechte: ["use_editor_menu"],
            kinder: "unterreiter",
            alias: ["presence"],
        },
        { id: "besucher", unter: "status", art: "bereich", rechte: ["use_editor_menu"] },
        { id: "editoren", unter: "status", art: "bereich", rechte: ["use_editor_menu"] },
        { id: "api", unter: "status", art: "bereich", rechte: ["use_editor_menu"] },
        // WI-0141: die Last der eigenen Instanz über Zeit, neben den Zahlen der Besucher.
        { id: "server", unter: "status", art: "bereich", rechte: ["use_editor_menu"] },
    ],
} as const satisfies NavTafel;
