import { Type, type Static } from "@sinclair/typebox";
import { CLIENT_FEHLER_GRENZEN, ClientFehlerDraht } from "./client-fehler.ts";
import { BezeichnungWert, SonderrolleAnzeige } from "./auth/session.ts";
import { MAP_HISTORY_OBJECT_KINDS } from "./editor-history.ts";
import { EDITOR_LOCK_KINDS, EDITOR_LOCK_PARTS } from "./editor-lock.ts";
import { WETTER_METRIKEN } from "./besucher-wetter.ts";

/**
 * Die anonyme Besucherstatistik (WI-0138, Bauplan BESUCH-0001; Betreiber 2026-10-12: „ich will wissen wieviel besucher wir haben,
 * wann die uns besuchen, woher … editoren nicht als besucher mitgezählt … keine individuellen ip loggen“).
 *
 *     POST /api/besuch        Ereignisse eines Besuchs, gebündelt     öffentlich, antwortet immer 204
 *     POST /api/besuch/ping   Lebenszeichen alle 60 s                 öffentlich, antwortet immer 204
 *     GET  /api/besuch/zahlen Die Zahlen des Panels                   use_editor_menu
 *
 * 🔴 **Die Positivliste steht HIER, in einer Liste für Sender und Empfänger.** In Legacy standen beide getrennt, und der
 * Routenplaner schickte monatelang `map_option`, das `track.php` verwarf (Befund im Abzug: 1.602 Serveraufrufe von
 * „Was ist hier“, keine einzige Zeile in der Statistik). Ein Ereignis außerhalb dieser Liste zählt nicht.
 */

export const BESUCH_URL = "/api/besuch";
export const BESUCH_PING_URL = "/api/besuch/ping";
export const BESUCH_ZAHLEN_URL = "/api/besuch/zahlen";

/**
 * Was ein Besuch melden darf. `dimension` ist leer, wo die Metrik für sich steht.
 *
 * 🔴 **Jeder Eintrag braucht einen Sender und einen Leser.** Die Liste ist ein Vertrag zwischen Browser, Zählpfad und Panel;
 * ein Eintrag ohne beides zählt nie und füllt nichts. `map_load` war so einer und ist in WI-0159 entfallen: Niemand las sie
 * (`lesen.ts` nennt sie in keiner Kennzahl und in keiner Liste), niemand sendete sie, und Legacy brachte in 109 Tagen vier
 * Zeilen zusammen - „Karte geladen“ ist `pageview` mit einem Zwischenschritt.
 */
export const BESUCH_METRIKEN = [
    "pageview",
    "search",
    "search_empty",
    "place_open",
    "route",
    "route_fail",
    "route_waypoint",
    "transport",
    "route_option",
    "map_mode",
    "map_style",
    "eco_kind",
    "display_toggle",
    // 🪤 Ohne eigenen Sender seit WI-0286, dort löste `zoom_stufe` das grobe Band ab. Es bleibt hier, damit ein über das Release
    // offener Tab nicht seine ganze Meldung abgewiesen bekommt; gelesen wird es, solange ein Zeitraum noch keine Stufen hat.
    "zoom_band",
    // Auf welcher Zoomstufe (0..`MAX_BAND`) die Karte zur Ruhe kam (WI-0286). Sender: `beobachteKarte`; Leser: `zoom` in `BesuchZahlen`.
    "zoom_stufe",
    // Das Design der Seite und die Sprache ihrer Oberfläche, beim Start und bei jedem Wechsel (WI-0286). Sender: `besuch-melden.ts`,
    // `theme-toggle.vue`, `lang-toggle.vue`. Die Sprache des Browsers steht davon getrennt in `sprache`.
    "theme",
    "sprache_eingestellt",
    "tilt",
    "flight",
    "profile",
    "play",
    "share_create",
    // Ein Fehler im Browser, einmal je Seite und Art (WI-0202). Sender: `apps/web/src/besuch/fehler-faenger.ts`; Leser: der
    // Unterreiter „API“ (`besucher/api-lesen.ts`). Die Diagnose dazu reist im Feld `fehler` derselben Meldung.
    "client_fehler",
    // Das experimentelle Wetter (WI-0288, `besucher-wetter.ts`): Start, Nutzung, Leistung und Fehler, je Seitenaufruf, als Klassen mit
    // Gerät. Sender: `apps/web/src/map/wetter/wetter-messung.ts`; Leser: `BesuchZahlen.wetter` (`lesen.ts`).
    ...WETTER_METRIKEN,
] as const;
export type BesuchMetrik = (typeof BESUCH_METRIKEN)[number];

/**
 * Diese trägt eine Stunde und füllt damit die Tafel der aktivsten Zeiten; alle anderen den Platzhalter 24.
 *
 * 🪤 Hier stand bis WI-0159 auch `map_load`, obwohl keine Tafel aus ihr gebaut wird: Eine Stunde an einer Metrik, die
 * niemand liest, vervielfacht nur die Zeilen (Legacys Falle mit der NULL-Stunde, siehe `zaehler.ts`).
 */
export const BESUCH_METRIKEN_MIT_STUNDE: readonly BesuchMetrik[] = ["pageview"];

export const BESUCH_GRENZEN = {
    /** Höchstens so viele Ereignisse je Meldung; der Rest fällt weg (Legacy: 100, aber unsere Bündel sind klein). */
    ereignisse: 20,
    /** Länge einer Ausprägung; länger wird abgeschnitten, nicht verworfen. */
    dimension: 190,
    /** Umfang einer Meldung. */
    bodyBytes: 4096,
    /** So viele Meldungen je Minute und Tageskennung; darüber wird still verworfen. */
    proMinute: 60,
} as const;

/** Was der Browser sendet. Kein Freitext: `dimension` kommt aus unseren eigenen Werten, nie aus einer Eingabe. */
export const BesuchMeldung = Type.Object(
    {
        ereignisse: Type.Array(
            Type.Object(
                {
                    metrik: Type.Union(BESUCH_METRIKEN.map((name) => Type.Literal(name))),
                    dimension: Type.Optional(Type.String({ maxLength: BESUCH_GRENZEN.dimension })),
                },
                { additionalProperties: false },
            ),
            { maxItems: BESUCH_GRENZEN.ereignisse },
        ),
        /** Die Stunde der Ortszeit des Besuchs (0..23); daraus entsteht die Tafel der aktivsten Zeiten. */
        stunde: Type.Optional(Type.Integer({ minimum: 0, maximum: 23 })),
        /** Woher der Besuch kam; der Server nimmt davon nur den Namen der Quelle, nie den Pfad. */
        herkunft: Type.Optional(Type.String({ maxLength: 500 })),
        /**
         * Diagnosen zu Fehlern im Browser (WI-0202, `client-fehler.ts`). Der Server bereinigt jede noch einmal und lässt fallen,
         * was nicht passt; eine unpassende verdirbt die Meldung nicht, weil die Drahtform großzügig ist.
         */
        fehler: Type.Optional(Type.Array(ClientFehlerDraht, { maxItems: CLIENT_FEHLER_GRENZEN.jeMeldung })),
        /**
         * Die Seite ist zehn Sekunden offen (OPS-000118, Filter „Besuche unter 10 Sekunden ausblenden“): `"nachtrag"` trägt alles, was sie
         * bis dahin gemeldet hat, und zählt nur in der gefilterten Sicht; `true` steht an jeder späteren Meldung, die dann in beiden zählt.
         * Ohne das Feld zählt eine Meldung nur ungefiltert, wie bisher.
         */
        bestaetigt: Type.Optional(Type.Union([Type.Literal("nachtrag"), Type.Literal(true)])),
        /** Grobe Klassen der Umgebung, jede für sich gezählt (BESUCH-0001 §13 C). */
        geraet: Type.Optional(
            Type.Object(
                {
                    breite: Type.Optional(Type.Integer({ minimum: 0, maximum: 20000 })),
                    dreid: Type.Optional(Type.Boolean()),
                    grob: Type.Optional(Type.Boolean()),
                    wenigerBewegung: Type.Optional(Type.Boolean()),
                    dunkel: Type.Optional(Type.Boolean()),
                },
                { additionalProperties: false },
            ),
        ),
    },
    { additionalProperties: false },
);
export type BesuchMeldung = Static<typeof BesuchMeldung>;

export const BESUCH_ZUSTAENDE = ["active", "reading", "hidden"] as const;
export type BesuchZustand = (typeof BESUCH_ZUSTAENDE)[number];

/**
 * Woran jemand gerade sitzt (WI-0141b; Betreiber 2026-10-14: „bau die aktuelle ansicht in der sitzung mit ein“).
 *
 * 🔴 **Eine Positivliste, kein Freitext.** Der Wert kommt aus dem Browser und wird anderen Editoren angezeigt; was hier
 * nicht steht, wird verworfen. Sonst stünde im Panel, was ein Client hineinschreibt.
 *
 * 🔴 **Kein Protokoll.** Der Wert lebt an der Sitzung und verfällt mit ihr; es gibt keine Historie, wer wann was offen
 * hatte. Die Statistik zählt weiter anonym und in Summen.
 */
export const SITZUNG_ANSICHTEN = [
    "karte.standard",
    "karte.political",
    "karte.landscapes",
    "karte.powerlines",
    "karte.none",
    "planer",
    "editor.aenderungen",
    "editor.karteninhalte",
    "editor.status",
    "editor.orte",
    "editor.medien",
    "editor.system",
] as const;
export type SitzungAnsicht = (typeof SITZUNG_ANSICHTEN)[number];

export const BesuchPing = Type.Object(
    {
        zustand: Type.Union(BESUCH_ZUSTAENDE.map((name) => Type.Literal(name))),
        /** Woran die Person gerade sitzt; nur von Angemeldeten ausgewertet, bei allen anderen verworfen. */
        ansicht: Type.Optional(Type.Union(SITZUNG_ANSICHTEN.map((name) => Type.Literal(name)))),
    },
    { additionalProperties: false },
);
export type BesuchPing = Static<typeof BesuchPing>;

const Eintrag = Type.Object({ name: Type.String(), wert: Type.Integer() }, { additionalProperties: false });
const Liste = Type.Array(Eintrag);

/**
 * Wie viele Einträge eine Liste des Panels höchstens trägt (WI-0191, Kanal OPS-000016: „Bitte die Statistiken die mehr als die
 * angezeigten 8 EInträge haben ausklappbar machen.“).
 *
 * Das Panel zeigt zuerst acht; der Rest kommt gleich mit, damit das Aufklappen ohne zweiten Gang zum Server auskommt. Alle
 * Listen stecken in **einer** Antwort aus **einer** Abfrage — ein Parameter je Liste würde die Datenbankarbeit verdoppeln und
 * nichts sparen (Begründung: WI-0191 §3).
 */
export const BESUCH_LISTE_GRENZE = 50;

/**
 * Eine Rangliste des Panels: die höchsten Einträge und wie viele Ausprägungen es insgesamt gab.
 *
 * 🔴 **`gesamt` ist Pflicht, nicht Zierde.** Ohne diese Zahl wüsste das Panel nicht, ob es alles hat, und „Alle 50 zeigen“ wäre
 * an einer Liste mit 300 Suchbegriffen eine Lüge — genau das stille Abschneiden war der Anlass dieses Work Items.
 */
const ListeMitGesamt = Type.Object({ eintraege: Liste, gesamt: Type.Integer() }, { additionalProperties: false });

/** Die Sorten; sie stehen im Schlüssel jeder Zeile und werden nie vermischt (Betreiber: „editoren … klar getrennt“). */
export const BESUCH_SORTEN = ["visitor", "editor", "bot"] as const;
export type BesuchSorte = (typeof BESUCH_SORTEN)[number];

/** Die Zeiträume des Panels, Legacys Sprossen (`review-visitor-analytics.js:673`). */
export const BESUCH_ZEITRAEUME = [7, 30, 365, 3660] as const;

export const BesuchZahlen = Type.Object(
    {
        sorte: Type.Union(BESUCH_SORTEN.map((name) => Type.Literal(name))),
        tage: Type.Integer(),
        von: Type.String(),
        bis: Type.String(),
        /** Ohne Schlüssel in der Umgebung zählt der Server keine eindeutigen Besucher; die Ansicht sagt „unbekannt“, nie 0. */
        kennungAktiv: Type.Boolean(),
        kennzahlen: Type.Object(
            {
                aufrufe: Type.Integer(),
                eindeutigeMittel: Type.Union([Type.Integer(), Type.Null()]),
                routen: Type.Integer(),
                /**
                 * Die meisten Editorenköpfe an einem Tag: verschiedene Personen mit Editorkonto, nicht Geräte (Vali 2026-11-11: „wir sind
                 * nur 11“). `null` heißt „im Zeitraum nie gezählt“, nie 0: Die Kopfzählung beginnt erst am 2026-11-11.
                 */
                editorenSpitze: Type.Union([Type.Integer(), Type.Null()]),
                /** Der erste gezählte Tag (`YYYY-MM-DD`), wenn die Kopfzählung erst im Zeitraum begann; sonst `null`. */
                editorenAb: Type.Union([Type.String(), Type.Null()]),
                besterTag: Type.Union([Type.Integer(), Type.Null()]),
                /** Der Tag des besten Tags (`YYYY-MM-DD`; Betreiber 2026-10-19: das Datum neben der Zahl); bei Gleichstand der jüngste. */
                besterTagAm: Type.Union([Type.String(), Type.Null()]),
                /** Veränderung der Aufrufe gegenüber dem gleich langen Zeitraum davor; ohne Vergleichszeitraum `null`. */
                wachstum: Type.Union([Type.Number(), Type.Null()]),
                /** Suchen, die keinen Treffer hatten (WI-0138 V11): was Besucher bei uns vermissen. */
                sucheLeer: Type.Integer(),
                /**
                 * Die meisten zugleich Anwesenden im Zeitraum (WI-0213), gezählt wie „Anwesend jetzt“. `null` heißt „nie
                 * gemessen“, nie 0: Die Messung beginnt erst mit WI-0213, und Legacy kannte sie nicht.
                 */
                gleichzeitigSpitze: Type.Union([Type.Integer(), Type.Null()]),
                /**
                 * Der Tag der Spitze (`YYYY-MM-DD`; Betreiber 2026-10-19: „wir wollen hier das datum haben WANN die meisten gleichzeitig
                 * anwesend waren“); bei Gleichstand der jüngste. Die Uhrzeit ist nicht gespeichert, die Spitze steht je Tag.
                 */
                gleichzeitigAm: Type.Union([Type.String(), Type.Null()]),
            },
            { additionalProperties: false },
        ),
        verlauf: Type.Array(
            Type.Object(
                {
                    tag: Type.String(),
                    aufrufe: Type.Integer(),
                    /** Bei den Editoren die Köpfe; `null` an einem Tag vor der Kopfzählung. */
                    eindeutige: Type.Union([Type.Integer(), Type.Null()]),
                    /** Die Editorenköpfe des Tages; `null` an einem Tag vor der Kopfzählung, nie die alte Gerätezahl. */
                    editoren: Type.Union([Type.Integer(), Type.Null()]),
                },
                { additionalProperties: false },
            ),
        ),
        /** Sieben Zeilen (Montag bis Sonntag) mit je 24 Stunden. */
        tafel: Type.Array(Type.Array(Type.Integer())),
        dauer: Type.Object(
            {
                /** Besuche mit gemessener Dauer; nur sie gehen in Median, Mittel und Körbe ein. */
                sitzungen: Type.Integer(),
                median: Type.Union([Type.Integer(), Type.Null()]),
                mittel: Type.Union([Type.Integer(), Type.Null()]),
                koerbe: Liste,
                /** Besuche mit nur einem Lebenszeichen: Ihre Dauer ist unbekannt, nicht 0 s (OPS-000118). */
                ohne: Type.Integer(),
            },
            { additionalProperties: false },
        ),
        /**
         * Der Filter „Besuche unter 10 Sekunden ausblenden“ (OPS-000118), nur wenn er gewählt ist. `ab`: der erste gefilterte Tag; davor gibt
         * es keine gefilterten Zahlen, und der Zeitraum beginnt dort (`null`: noch nie gefiltert). `ausgeblendet` von `gesamt`: Seitenaufrufe
         * im selben Zeitraum ohne und mit Filter.
         */
        filter: Type.Union([
            Type.Null(),
            Type.Object(
                {
                    ab: Type.Union([Type.String(), Type.Null()]),
                    ausgeblendet: Type.Integer(),
                    gesamt: Type.Integer(),
                },
                { additionalProperties: false },
            ),
        ]),
        /** Als Automat ausgeschlossen (OPS-000118): Seitenaufrufe der Sorte `bot` im Zeitraum und warum, damit der Ausschluss sichtbar bleibt. */
        ausgeschlossen: Type.Object({ aufrufe: Type.Integer(), gruende: Liste }, { additionalProperties: false }),
        /**
         * Wie nah herangegangen wird (WI-0286; Betreiber 2026-11-07: „ein histogramm … mit mean und median der zoomstufen“): die
         * Stufen aufsteigend, Median und Mittel daraus. Leer und `null`, solange der Zeitraum keine Stufe gesehen hat.
         */
        zoom: Type.Object(
            {
                ruhen: Type.Integer(),
                median: Type.Union([Type.Integer(), Type.Null()]),
                mittel: Type.Union([Type.Number(), Type.Null()]),
                stufen: Liste,
            },
            { additionalProperties: false },
        ),
        /**
         * Das experimentelle Wetter (WI-0288; Betreiber 2026-11-08: „bisschen was zur nutzung und bisschen was zur performacnce des
         * experimentellen wetters“). Jede Liste trägt Ausprägungen der Form `gerät:klasse` (`besucher-wetter.ts`), in der Reihenfolge ihrer
         * Klassen, nicht nach Häufigkeit: Eine Verteilung liest sich nur geordnet. `schalter` sind die Klicks im Auge (`wetter_<id>:on|off`),
         * nach Häufigkeit; sie stehen NICHT in `listen.schalter`.
         */
        wetter: Type.Object(
            {
                schalter: ListeMitGesamt,
                lauf: ListeMitGesamt,
                start: ListeMitGesamt,
                bildrate: ListeMitGesamt,
                spitze: ListeMitGesamt,
                aufloesung: ListeMitGesamt,
                gpu: ListeMitGesamt,
                fehler: ListeMitGesamt,
            },
            { additionalProperties: false },
        ),
        listen: Type.Object(
            {
                land: ListeMitGesamt,
                region: ListeMitGesamt,
                einstieg: ListeMitGesamt,
                geraet: ListeMitGesamt,
                system: ListeMitGesamt,
                browser: ListeMitGesamt,
                zoomband: ListeMitGesamt,
                fenster: ListeMitGesamt,
                faehig: ListeMitGesamt,
                /** Die Sprache des Browsers (`Accept-Language`), einmal je Person und Tag. */
                sprache: ListeMitGesamt,
                /** Die Sprache, in der die Seite läuft: beim Start und bei jedem Wechsel (WI-0286). */
                spracheEingestellt: ListeMitGesamt,
                /** Hell oder dunkel, wie es auf der Seite gilt, beim Start und bei jedem Wechsel (WI-0286). */
                theme: ListeMitGesamt,
                ansicht: ListeMitGesamt,
                untergrund: ListeMitGesamt,
                ebene: ListeMitGesamt,
                mittel: ListeMitGesamt,
                option: ListeMitGesamt,
                orte: ListeMitGesamt,
                routen: ListeMitGesamt,
                schalter: ListeMitGesamt,
                suche: ListeMitGesamt,
                /** Warum eine Route nicht zustande kam, nach Grund des Routers. */
                fehlschlag: ListeMitGesamt,
                /** Was im Infopanel geöffnet wurde, nach Art (Ort, Gebiet, …). */
                angesehen: ListeMitGesamt,
                dreid: ListeMitGesamt,
            },
            { additionalProperties: false },
        ),
        jetzt: Type.Object(
            {
                gesamt: Type.Integer(),
                aktiv: Type.Integer(),
                lesend: Type.Integer(),
                verborgen: Type.Integer(),
                editoren: Type.Integer(),
                fensterMinuten: Type.Integer(),
            },
            { additionalProperties: false },
        ),
        speicher: Type.Object({ zeilen: Type.Integer(), bytes: Type.Integer() }, { additionalProperties: false }),
    },
    { additionalProperties: false },
);
export type BesuchZahlen = Static<typeof BesuchZahlen>;

/** Die Klasse der Fensterbreite; gezählt wird die Klasse, nie die Pixelzahl (sonst wäre sie ein Merkmal zu viel). */
export function fensterKlasse(breite: number): string {
    if (breite < 480) return "bis480";
    if (breite < 1024) return "bis1024";
    if (breite < 1600) return "bis1600";
    return "groesser";
}

/**
 * Die Form einer Namens-Ausprägung (`search`, `route`, `region` …): ein Name aus unserem Kartenbestand, nie ein freier Text.
 *
 * 🔴 **Steht HIER, in einer Form für Sender und Empfänger.** Der Server prüft sie in `dimensionErlaubt` und verwirft, was nicht
 * passt; der Sender baut mit derselben Form, damit er nichts meldet, was verworfen werden müsste. Zwei Muster an zwei Stellen
 * liefen auseinander — genau die Falle, an der Legacys Routenplaner monatelang `map_option` ins Leere schickte.
 */
export const BESUCH_NAME_FORM = /^[\p{L}\p{N}][\p{L}\p{N} .,'’()–→+-]{0,59}$/u;

/**
 * Die Ausprägung einer geplanten Route: „Start → Ziel“ (BESUCH-0001 §E: „Geplante Routen (Start → Ziel) … Ortsnamen aus unserem
 * Bestand“).
 *
 * 🔴 **Die Namen kommen aus UNSERER Antwort** (`RouteResponse.waypoints`), nie aus einem Eingabefeld — dieselbe Regel wie bei
 * `melde("search", hit.name)`. Zwischenpunkte stehen nicht darin: Start und Ziel sind die Frage („welche Strecken bewegen die
 * Leute“), und jeder weitere Name vervielfachte die Zeilen.
 *
 * `undefined`, wo kein sauberes Paar entsteht — dann meldet der Planer die Route **ohne** Ausprägung. Die Kennzahl „Routen
 * geplant“ zählt sie trotzdem, nur die Liste bleibt ohne diesen Eintrag: Sie darf nie davon abhängen, ob ein Name in die Form
 * passt (WI-0157).
 */
export function routenPaar(namen: readonly string[]): string | undefined {
    if (namen.length < 2) return undefined;
    const start = namen[0]?.trim() ?? "";
    const ziel = namen.at(-1)?.trim() ?? "";
    if (start === "" || ziel === "") return undefined;
    const paar = `${start} → ${ziel}`;
    return BESUCH_NAME_FORM.test(paar) ? paar : undefined;
}

/**
 * Ein angesteuerter Ort als Ausprägung (`BESUCH-0001 §E`: „Angesteuerte Orte · dieselbe Quelle“, also die Namen aus unserer
 * eigenen Routenantwort). `undefined`, wo der Name keine Namensform ist.
 *
 * 🔴 **Der Sender prüft selbst, statt sich auf den Riegel zu verlassen.** Ein Wegpunkt kann ein Kartenpunkt sein
 * (`p:<x>:<y>`, `route.ts`), und dessen Name ist keine Ortsbezeichnung. Käme er trotzdem los, verwürfe ihn `zeilenAus`
 * **still** - genau die Falle, die WI-0157 bei `route` gekostet hat. Hier fällt er sichtbar vorher weg, und ein Test hält
 * es fest.
 */
export function besuchOrtsName(name: string): string | undefined {
    const text = name.trim();
    return BESUCH_NAME_FORM.test(text) ? text : undefined;
}

/**
 * Legacys Werte auf die heutigen umgeschrieben (Betreiber 2026-10-13: „coole idee - so bauen“).
 *
 * Legacy und Avesmaps3D benennen dieselbe Wahl verschieden: Legacys Ansicht „Standard“ heißt im Hash `deregraphic`, unsere
 * `standard`. Blieben beide Schlüssel stehen, stünde „Standard“ nach dem Import **zweimal** in derselben Liste, einmal mit
 * Legacys Tagen und einmal mit unseren — und die Balken wären nur halb so hoch, wie die Wahrheit ist.
 *
 * 🔴 **Umgeschrieben wird erst beim Lesen, nie in der Tabelle.** `visitor_metric` behält, was gemeldet wurde; ändert sich
 * später eine Zuordnung, ist sie eine Zeile hier und kein Datenschaden. Deshalb steht das Zusammenfassen im Leseweg
 * (`apps/server/src/besucher/lesen.ts`), wo die Summen ohnehin entstehen.
 *
 * Belege je Zeile, Legacy-Mirror `avesmaps@cfbbe69c8`:
 * - `map_mode`: `index.html:2791-2795` — dasselbe `<select>`; `deregraphic` trägt `data-i18n="view.mode.standard"`,
 *   `ecosystem` die Beschriftung „Landschaften“.
 * - `map_style`: `index.html:3256` — `stylized` heißt dort „Modern“.
 * - `route_option`: `js/routing/route-engine.js:685` zählte das deutsche Wort, `route-travel-here.js:301` den Satz.
 */
export const LEGACY_DIMENSIONEN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    map_mode: { deregraphic: "standard", ecosystem: "landscapes" },
    map_style: { stylized: "modern" },
    route_option: { kürzeste: "kuerzeste", "hierher reisen": "hierherReisen" },
};

/** Der heutige Schlüssel einer Ausprägung; was Legacy nicht anders nannte, bleibt wie es ist. */
export function heutigeDimension(metrik: string, dimension: string): string {
    return LEGACY_DIMENSIONEN[metrik]?.[dimension] ?? dimension;
}

/**
 * Wer im Editor ist und was er tut (WI-0141b; Betreiber 2026-10-14: „so weiß jeder wer gerade online ist und was macht“):
 *
 *     GET /api/besuch/editoren    die Editoren dieser Umgebung    use_editor_menu
 *
 * 🔴 **Eine Anwesenheitsliste, keine Personenverwaltung.** Hier steht, was Kolleginnen und Kollegen voneinander wissen
 * dürfen: Name, Rolle, wofür jemand zuständig ist, wann er zuletzt da war, womit er angemeldet ist. **Nicht** hier:
 * Adressen, Anmeldewege, Sperrgründe, Rechte — die stehen in der Personenverwaltung hinter `manage_people`.
 */
export const BESUCH_EDITOREN_URL = "/api/besuch/editoren";

export const BesuchEditor = Type.Object(
    {
        id: Type.String(),
        name: Type.String(),
        rolle: Type.String(),
        /** Die Wortform ihrer Rollen und ihre Sonderrollen (WI-0279 E9b, E10); optional für einen älteren Server. */
        bezeichnung: Type.Optional(Type.Union([BezeichnungWert, Type.Null()])),
        sonderrollen: Type.Optional(Type.Array(SonderrolleAnzeige)),
        /** Wofür die Person zuständig ist (WI-0133); leer, wo nichts eingetragen ist. */
        verantwortung: Type.Union([Type.String(), Type.Null()]),
        /** Zuletzt gesehen; `null` bei einer Person, die sich hier noch nie angemeldet hat. */
        zuletzt: Type.Union([Type.String(), Type.Null()]),
        /** Im Fenster der Anwesenheit gesehen. */
        online: Type.Boolean(),
        /** Womit angemeldet, wie die Sitzung es nennt („Chrome auf Windows“); `null`, wenn keine Sitzung läuft. */
        geraet: Type.Union([Type.String(), Type.Null()]),
        /** Woran die Person gerade sitzt (`SITZUNG_ANSICHTEN`); `null`, solange nichts gemeldet wurde. */
        ansicht: Type.Union([Type.String(), Type.Null()]),
        /** Laufende Sitzungen dieser Person in dieser Umgebung. */
        sitzungen: Type.Integer(),
        /** An so vielen der letzten dreißig Tage war die Person da. */
        tageAktiv: Type.Integer(),
        /** Was die Person gerade bearbeitet (WI-0276): ihre jüngste geltende Sperre; `null`, wenn sie nichts hält. */
        bearbeitet: Type.Union([
            Type.Object(
                {
                    art: Type.Union(EDITOR_LOCK_KINDS.map((art) => Type.Literal(art))),
                    id: Type.String(),
                    name: Type.Union([Type.String(), Type.Null()]),
                    woran: Type.Union(EDITOR_LOCK_PARTS.map((woran) => Type.Literal(woran))),
                    seit: Type.String(),
                },
                { additionalProperties: false },
            ),
            Type.Null(),
        ]),
        /** Woran die Person zuletzt etwas geändert hat (WI-0276, `map_operation`); `null` ohne Änderung. */
        zuletztGeaendert: Type.Union([
            Type.Object(
                {
                    art: Type.Union(MAP_HISTORY_OBJECT_KINDS.map((art) => Type.Literal(art))),
                    id: Type.String(),
                    name: Type.Union([Type.String(), Type.Null()]),
                    am: Type.String(),
                },
                { additionalProperties: false },
            ),
            Type.Null(),
        ]),
        /** Wie viele Änderungen an der Karte von dieser Person stammen, alle Zeiten. */
        aenderungen: Type.Integer(),
    },
    { additionalProperties: false },
);
export type BesuchEditor = Static<typeof BesuchEditor>;

export const BesuchEditoren = Type.Object(
    { editoren: Type.Array(BesuchEditor), fensterMinuten: Type.Integer() },
    { additionalProperties: false },
);
export type BesuchEditoren = Static<typeof BesuchEditoren>;
