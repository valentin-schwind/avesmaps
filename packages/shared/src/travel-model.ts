import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { AIR_GROUPS, isAirTransport } from "./air.ts";
import { CALENDAR_MONTHS, SEASONS, type Season } from "./calendar.ts";

/**
 * Das Reisemodell (WI-0017 R2, MCS-018, Kap. 6.8): Tempo, Reisetag und die Regeln, welches
 * Transportmittel wo fahren darf. Die Zahlen stehen in `config/travel-model/`, je Block mit seiner
 * Herkunft - Regel aus dem Regelwerk oder App-Setzung.
 *
 * 🔴 Die Funktionen hier sind Legacys Regeln aus `client-graph.php` (avesmaps@bfec670), Zeile für
 * Zeile nachgebaut, damit sich beide Router vergleichen lassen (ROUTE-A). Wo wir bewusst abweichen,
 * steht es am Router, nicht hier.
 */

/** Die Zeilen der Bodentafel (`jahreszeitBoden.meilen`): Wegklassen, die der Boden unterscheidet (WI-0258). */
export const BODEN_WEGKLASSEN = ["strasse", "weg", "gebirge", "querfeldein"] as const;
export type BodenWegklasse = (typeof BODEN_WEGKLASSEN)[number];
/** Die Spalten der Bodentafel neben `trocken`: nass, verschneit, tief verschneit. */
export const BODEN_ZUSTANDSKLASSEN = ["nass", "schnee", "tief"] as const;
export type BodenZustandsklasse = (typeof BODEN_ZUSTANDSKLASSEN)[number];

const mitHerkunft = <T extends TSchema>(schema: T) =>
    Type.Object({ wert: schema, herkunft: Type.String() }, { additionalProperties: false });

const Stunden = Type.Number({ exclusiveMinimum: 0, maximum: 24 });
const Monat = Type.Union(CALENDAR_MONTHS.map((month) => Type.Literal(month)));
const TagImMonat = Type.Integer({ minimum: 1, maximum: 30 });
/** Wann etwas befahrbar ist, beide Enden eingeschlossen - dieselbe Form wie `path.transport_seasons`. */
const Fenster = Type.Object(
    { from_month: Monat, from_day: TagImMonat, to_month: Monat, to_day: TagImMonat },
    { additionalProperties: false },
);

/**
 * Die Stufen der Unterbringung (WI-0042; Legacy-Owner 2026-08-03: genau EINE Eingabe). Die Stufe setzt
 * Bett, Verpflegung, Zollveranlagung und die Kabine an Bord gemeinsam. Die Schlüssel nennen die Zeile
 * der Quelle (Regelwerk S. 382), die Beschriftung sagt, was der Reisende liest.
 */
export const LODGING_LEVELS = ["frei", "strohsack", "bett", "zimmer"] as const;
export type LodgingLevel = (typeof LODGING_LEVELS)[number];
/** Die Vorgabe: Bett im Gemeinschaftszimmer (Legacy `DEFAULT_PLANNER_STATE.lodging`). */
export const DEFAULT_LODGING: LodgingLevel = "bett";

export function isLodgingLevel(value: unknown): value is LodgingLevel {
    return typeof value === "string" && (LODGING_LEVELS as readonly string[]).includes(value);
}

/**
 * Warum etwas zeitweise nicht befahrbar ist (Betreiber 2026-09-27: „es braucht bei flächen und wege einen
 * grund für die sperrungen: Vereisung, Schneemassen, Wind“, dazu „Sturm, Wetter“). Der Planer schreibt „Wegen Vereisung
 * unpassierbar“ statt „Gesperrt“; ohne Grund bleibt es bei „Gesperrt“.
 */
export const CLOSURE_REASONS = ["vereisung", "schneemassen", "wind", "sturm", "wetter"] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

/** Die Gewässer der freien Seefahrt: Regionsarten der Wasserflächen (WI-0046, M3 B: auch die Binnenseen). */
export const WATER_KINDS = ["meer", "see"] as const;
export type WaterKind = (typeof WATER_KINDS)[number];

/** Woher ein Preis stammt (Kap. 6.20): aus der Quelle, von uns gesetzt oder unbekannt. */
export const COST_STATUSES = ["SOURCE_RULE", "AVESMAPS_DECISION", "UNKNOWN"] as const;
export type CostStatus = (typeof COST_STATUSES)[number];

/** Beträge stehen in Heller (1 Dukat = 10 Silbertaler = 100 Heller). */
const Heller = Type.Number({ minimum: 0 });
const JeStufe = Type.Object(
    Object.fromEntries(LODGING_LEVELS.map((level) => [level, Heller])) as Record<LodgingLevel, typeof Heller>,
    { additionalProperties: false },
);
/** Die Grenzen eines Werts des eigenen Flugmittels, wie die Felder des Planers (WI-0050). */
const FlugGrenze = Type.Object(
    {
        min: Type.Number({ exclusiveMinimum: 0 }),
        max: Type.Number({ exclusiveMinimum: 0 }),
        nachkommastellen: Type.Integer({ minimum: 0, maximum: 3 }),
        vorgabe: Type.Number({ exclusiveMinimum: 0 }),
    },
    { additionalProperties: false },
);

const mitStatus = <T extends TSchema>(schema: T) =>
    Type.Object(
        {
            status: Type.Union(COST_STATUSES.map((status) => Type.Literal(status))),
            wert: schema,
            herkunft: Type.String(),
        },
        { additionalProperties: false },
    );

export const TravelModel = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        quelle: Type.Object({ snapshot: Type.String(), code: Type.String() }, { additionalProperties: false }),
        meilenJeKarteneinheit: mitHerkunft(Type.Number({ exclusiveMinimum: 0 })),
        zeitfaktor: mitHerkunft(Type.Number({ exclusiveMinimum: 0 })),
        reisetagStunden: mitHerkunft(
            Type.Object(
                {
                    land: Stunden,
                    water: Stunden,
                    night: Stunden,
                    /**
                     * Der Reisetag eines Mittels, das vom Tag seiner Domäne abweicht (WI-0069): etwa die Galeere
                     * mit 8 Stunden auf dem Wasser. Nachtfahrt geht vor (`nachtfahrt`, dann `night`).
                     */
                    jeReisemittel: Type.Record(Type.String(), Stunden),
                },
                { additionalProperties: false },
            ),
        ),
        nachtfahrt: mitHerkunft(Type.Array(Type.String())),
        stroemungsfaktorVorgabe: mitHerkunft(Type.Number({ minimum: 1 })),
        /**
         * Die Tagesleistung je Mittel (WI-0069, seit WI-0258 an Land nach „Wege des Entdeckers“ S. 160–162): Meilen
         * je Reisetag mit den Reisestunden des Mittels (`travelDayHours`), auf dem Fluss stromab und dazu stromauf.
         * Aus ihr ist die Tafel `tempo` gerechnet (ein Test rechnet jede Zelle nach), und aus stromab / stromauf der
         * Strömungsfaktor eines Flussmittels, wenn am Weg keiner gespeichert ist.
         *
         * `meilen` ist die Leistung auf der normalen Straße. `meilenJeWegart` (WI-0258, E1) sind die absoluten Meilen
         * am Tag je Wegart (Landtafel der WdE); `wegartenWie` verweist auf ein Mittel, dessen Verhältnisse
         * (Meilen der Wegart durch dessen `meilen`) gelten - Wanderer, Einzelreiter und Karawane (S-1).
         */
        tagesleistung: mitHerkunft(
            Type.Record(
                Type.String(),
                Type.Object(
                    {
                        meilen: Type.Number({ exclusiveMinimum: 0 }),
                        stromauf: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
                        meilenJeWegart: Type.Optional(Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 }))),
                        wegartenWie: Type.Optional(Type.String()),
                    },
                    { additionalProperties: false },
                ),
            ),
        ),
        /**
         * Wessen gespeicherte Wegdaten ein neues Mittel übernimmt (WI-0069): Freigabeliste (`allowed_transports`)
         * und Sperrfenster (`transport_seasons`) eines Weges kennen nur Legacys Mittel. Steht dort das Mittel, von
         * dem ein neues erbt, gilt es auch für das neue - geschnitten mit dessen Angebot.
         */
        freigabeErbe: mitHerkunft(Type.Record(Type.String(), Type.String())),
        /**
         * Mittel, die nur auf Schnee fahren (WI-0069, Schlitten; Betreiber 2026-10-03): in den Jahreszeiten unter
         * `jahreszeiten`, wo der Boden einer der `zustaende` ist, und mit `gebirgeUeberSchneegrenze` in den
         * Gebirgsflächen über der Schneegrenze (`schneegrenze`) zu jeder Zeit. Ohne Reisebeginn gar nicht.
         * `baecheGefroren` (WI-0258 E3, S-4): Auf seinem Schnee sind die Bäche zugefroren, es quert sie querfeldein ohne
         * Furt und Aufenthalt. Den Boden der Jahreszeit und die Landschaft bremsen es wie jedes Mittel; seine Werte
         * dafür stehen in der Bodentafel (`jahreszeitBoden.meilen`).
         */
        bodenPflicht: mitHerkunft(
            Type.Record(
                Type.String(),
                Type.Object(
                    {
                        zustaende: Type.Array(Type.String(), { minItems: 1 }),
                        jahreszeiten: Type.Array(Type.Union(SEASONS.map((season) => Type.Literal(season))), {
                            minItems: 1,
                        }),
                        gebirgeUeberSchneegrenze: Type.Boolean(),
                        baecheGefroren: Type.Boolean(),
                    },
                    { additionalProperties: false },
                ),
            ),
        ),
        /**
         * Die Schneegrenze je Klimazone und Jahreszeit in Schritt (WI-0065, seit WI-0069 auch Routingregel): die
         * Werte gelten zur Mitte der Jahreszeit (`jahreszeitMitten`, Tag im Jahr), dazwischen linear
         * (`snowlineHeight`). Dieselbe Tafel zeichnet das Höhenprofil.
         *
         * `bodenDarueber` (Betreiber 2026-10-04, „Schnee über der Schneegrenze: ja, A“): der Boden, der über der
         * Schneegrenze zu jeder Jahreszeit liegt, ein Zustand aus `jahreszeitBoden.zustaende`. Ein Wegstück ganz in
         * Gebirgsflächen und ganz über der Schneegrenze des Tages (dieselbe Stelle, an der der Schlitten Bergschnee
         * findet) bekommt mindestens diesen Boden; ist der Boden der Jahreszeit strenger, gilt der. Ohne Eintrag bremst
         * die Schneegrenze nicht.
         *
         * `bodenAnteilig` (Betreiber 2026-10-04: „Welche Schneeregel einschalten? B“, Fassung B): Der Boden liegt nicht nur auf ganzen
         * Wegstücken über der Grenze, sondern auf dem Teil jedes Wegstücks, der im Gebirge über ihr liegt (je Abtastschritt
         * des Höhenprofils); die Kante dauert anteilig länger. Ohne Eintrag oder `false` nur ganze Stücke (Fassung A). Die
         * Freigabe des Schlittens bleibt bei ganzen Stücken.
         */
        schneegrenze: mitHerkunft(
            Type.Object(
                {
                    jahreszeitMitten: Type.Array(Type.Number({ minimum: 1, maximum: 365 }), {
                        minItems: 4,
                        maxItems: 4,
                    }),
                    reihenfolge: Type.Array(Type.Union(SEASONS.map((season) => Type.Literal(season))), {
                        minItems: 4,
                        maxItems: 4,
                    }),
                    zonen: Type.Record(
                        Type.String(),
                        Type.Array(Type.Number({ minimum: 0 }), { minItems: 4, maxItems: 4 }),
                    ),
                    bodenDarueber: Type.Optional(Type.String()),
                    bodenAnteilig: Type.Optional(Type.Boolean()),
                },
                { additionalProperties: false },
            ),
        ),
        /**
         * Auf welchen Gewässern ein Seeschiff im freien Seerouting fährt (WI-0069, Ruderboot): Regionsarten
         * `meer`, `see`. Ohne Eintrag auf allen.
         */
        gewaesser: mitHerkunft(
            Type.Record(
                Type.String(),
                Type.Array(Type.Union(WATER_KINDS.map((kind) => Type.Literal(kind))), { minItems: 1 }),
            ),
        ),
        /**
         * Eiltempo (WI-0078, Geographia Aventurica S. 123 „EILMARSCH“): die optionale Reiseweise, die NUR die Zeit
         * ändert, nie die Wegwahl. Jede Zeile ist Regel oder benannte Setzung; der Router kennt keine Kennung.
         *
         * - `mittel`: je Reisemittel sein Faktor (Eilmarsch und Eilritt 1,5, Fuhrwerk, Karren, Kutsche und Schlitten
         *   1,25) und die Wegarten, auf denen er gilt. Ein Mittel ohne Eintrag eilt nie (Kamelkarawane, jedes
         *   Fluss-, See- und Flugmittel: die GA kennt dafür keinen allgemeinen Eilfaktor).
         * - `taktung` (Betreiber 2026-10-05, F3 = A, und „das was in der GA steht“): Auf Dauer schlägt ein Mensch
         *   oder Tier nur **jeden zweiten Tag** erhöhtes Tempo an. Es wird keine Stundenzahl erfunden; die Taktung
         *   sagt, die ersten `eiltage` von je `reisetage` Reisetagen sind Eiltage. 🔴 Gerechnet wird **am Reisetag**:
         *   An einem Eiltag gilt der VOLLE Faktor, an einem gewöhnlichen Tag keiner (`isHurryDay`,
         *   `hurryPacedHours`). Der erste Reisetag eilt, also bekommt eine Reise an einem Tag die vollen 1,5.
         * - `bodenSperre` (GA S. 123 und Betreiber 2026-10-05, F1): Aufgeweichter Boden, Tiefschnee und Eis
         *   vereiteln den Eilmarsch. `bodenAusnahme` nimmt den Schlitten von Schnee und Eis aus - er braucht sie.
         * - `landschaftSperre` (GA S. 123 „in Gebirgen, Sümpfen und im Dschungel schlichtweg unmöglich“, Betreiber
         *   2026-10-05: „Regenwald ist wie Dschungel und der Urwald“): Landschaftsarten (`region_type`), in denen
         *   kein Abschnitt eilt. Das Gebirge steht nicht hier, sondern als Wegart `Gebirgspass` außerhalb von
         *   `wegarten`.
         */
        eiltempo: mitHerkunft(
            Type.Object(
                {
                    taktung: Type.Object(
                        { reisetage: Type.Integer({ minimum: 1 }), eiltage: Type.Integer({ minimum: 0 }) },
                        { additionalProperties: false },
                    ),
                    mittel: Type.Record(
                        Type.String(),
                        Type.Object(
                            {
                                faktor: Type.Number({ minimum: 1 }),
                                wegarten: Type.Array(Type.String(), { minItems: 1 }),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                    bodenSperre: Type.Array(Type.String()),
                    bodenAusnahme: Type.Record(Type.String(), Type.Array(Type.String())),
                    landschaftSperre: Type.Array(Type.String()),
                },
                { additionalProperties: false },
            ),
        ),
        umstiegsaufschlag: mitHerkunft(Type.Number({ minimum: 0 })),
        querfeldeinAufschlag: mitHerkunft(Type.Number({ minimum: 1 })),
        querfeldeinLaengenaufschlag: mitHerkunft(
            Type.Object(
                { jeMeile: Type.Number({ minimum: 0 }), hoechstens: Type.Number({ minimum: 1 }) },
                { additionalProperties: false },
            ),
        ),
        /**
         * Wagen querfeldein (WI-0258, Betreiber 2026-10-29, E2 und S-6): Die Mittel unter `reisemittel` (Karren, Fuhrwerk,
         * Kutsche) fahren abseits der Wege nur über offenes Land: Flächen ohne Landschaft und die Landschaftsarten unter
         * `offeneLandschaften` (Tundra, Hochebene). Jede andere Landschaft aus `bodenfaktor` ist für sie gesperrt, mit
         * `gebirge` auch jede Gebirgsfläche. Die Sperre baut `vehicle-barrier.ts`; einzelne Berge bleiben befahrbar.
         */
        querfeldeinFahrzeuge: mitHerkunft(
            Type.Object(
                {
                    reisemittel: Type.Array(Type.String()),
                    offeneLandschaften: Type.Array(Type.String()),
                    gebirge: Type.Boolean(),
                },
                { additionalProperties: false },
            ),
        ),
        bachQuerung: mitHerkunft(
            Type.Object(
                {
                    meilen: Type.Number({ minimum: 0 }),
                    meilenJeReisemittel: Type.Record(Type.String(), Type.Number({ minimum: 0 })),
                    stroemungsAnker: Type.Number({ exclusiveMinimum: 0 }),
                    watfaktor: Type.Number({ minimum: 1 }),
                    hoechstens: Type.Number({ minimum: 1 }),
                },
                { additionalProperties: false },
            ),
        ),
        bodenfaktor: mitHerkunft(Type.Record(Type.String(), Type.Number({ minimum: 1 }))),
        /** Steigung auf Landwegen und querfeldein (WI-0049 S5a–S5c, MCS-026). Ohne Gelände wirkt nichts davon. */
        steigung: mitHerkunft(
            Type.Object(
                {
                    /** Leistungskilometer (J+S): so viele Schritt Anstieg kosten eine Meile mehr. */
                    anstiegSchrittJeMeile: Type.Number({ exclusiveMinimum: 0 }),
                    /** … und so viele Schritt Abstieg, aber nur wo es steiler bergab geht als `steilAb`. */
                    steilerAbstiegSchrittJeMeile: Type.Number({ exclusiveMinimum: 0 }),
                    /** Gefälle je Abtastschritt (höchstens 0,25 E), ab dem ein Abstieg zählt, als Verhältnis. */
                    steilAb: Type.Number({ exclusiveMinimum: 0 }),
                    /** Wegarten, deren GA-Faktor die Steigung schon enthält: im Mittel die GA, Steigung nur als Abweichung. */
                    gaMitSteigung: Type.Array(Type.String()),
                    /** Die Wegart, an der die übrigen Landwege geeicht werden. */
                    eichWegart: Type.String(),
                    /** Querfeldein in den Gebirgsflächen im Mittel (GA „Gebirge ohne Klettern“, 0,75 / 0,2). */
                    querfeldeinGebirge: Type.Number({ minimum: 1 }),
                    /** Querfeldein an freien Gipfeln im Mittel (GA-Modifikator „einzelne Berge“ ×0,5). */
                    querfeldeinEinzelnerBerg: Type.Number({ minimum: 1 }),
                    /**
                     * Über wie viele Schritt die Anzeige den steilsten Abschnitt misst (WI-0049 S5d): die größte
                     * mittlere Steigung eines Abschnitts dieser Länge. Nur Anzeige, die Zeit rechnet je Abtastschritt.
                     */
                    anzeigeFensterSchritt: Type.Number({ exclusiveMinimum: 0 }),
                    /**
                     * Die drei Steigungsfamilien (WI-0049 S5c, Gutachten MCS-026 Punkt 2): welches Reisemittel
                     * wie am Hang langsamer wird. Ein Landmittel ohne Eintrag geht wie FOOT.
                     */
                    familien: Type.Object(
                        {
                            /** Fuß und geführte Tiere: der Leistungskilometer oben. */
                            FOOT: Type.Object(
                                { reisemittel: Type.Array(Type.String()) },
                                { additionalProperties: false },
                            ),
                            /** Reit- und Lasttiere: max(1, e^(exponent · (|s + versatz| − versatz))). */
                            EQUID: Type.Object(
                                {
                                    reisemittel: Type.Array(Type.String()),
                                    exponent: Type.Number({ exclusiveMinimum: 0 }),
                                    versatz: Type.Number({ minimum: 0 }),
                                    /** Kehrenregel: steiler als der Knick der Formel geht es in Kehren. */
                                    kehren: Type.Boolean(),
                                },
                                { additionalProperties: false },
                            ),
                            /** Wagen: 1 + quadrat · s² bergauf, bergab erst jenseits der Rollgrenze. */
                            WHEEL: Type.Object(
                                {
                                    reisemittel: Type.Array(Type.String()),
                                    quadrat: Type.Number({ exclusiveMinimum: 0 }),
                                    rollgrenze: Type.Number({ minimum: 0 }),
                                    /** Kehrenregel: steiler als der Knick der Formel geht es in Kehren. */
                                    kehren: Type.Boolean(),
                                },
                                { additionalProperties: false },
                            ),
                        },
                        { additionalProperties: false },
                    ),
                    /**
                     * Die Sternregel (GA S. 123): Im Sterngelände werden die Tiere geführt, und das Mittel geht
                     * mit Tempo und Steigung des Fußmittels unter `absteigen`, mal dem Verhältnis aus `gefuehrt`.
                     */
                    sternregel: Type.Object(
                        {
                            /** Reisemittel → Fußmittel, mit dessen Tempo und Steigung es im Sterngelände geht. */
                            absteigen: Type.Record(Type.String(), Type.String()),
                            /** Wegarten, die innerhalb der Gebirgsflächen Sterngelände sind; `Querfeldein` ist der Gang. */
                            imGebirge: Type.Array(Type.String()),
                            /**
                             * Wie schnell geführte Tiere dort sind (WI-0258 E5, „Wege des Entdeckers“ S. 161): je Wegart unter
                             * `imGebirge` die Meilen am Tag eines geführten Tieres (`tier`) und der Gruppe zu Fuß (`fuss`). Das
                             * Mittel geht dort mit dem Tempo der Gruppe zu Fuß mal `tier / fuss`, also langsamer als zu Fuß.
                             * Eine Wegart ohne Eintrag geht wie die Gruppe zu Fuß.
                             */
                            gefuehrt: Type.Record(
                                Type.String(),
                                Type.Object(
                                    {
                                        tier: Type.Number({ exclusiveMinimum: 0 }),
                                        fuss: Type.Number({ exclusiveMinimum: 0 }),
                                    },
                                    { additionalProperties: false },
                                ),
                            ),
                        },
                        { additionalProperties: false },
                    ),
                },
                { additionalProperties: false },
            ),
        ),
        flussQuerung: mitHerkunft(
            Type.Object({ faktor: Type.Number({ minimum: 1 }) }, { additionalProperties: false }),
        ),
        /**
         * Der bevorzugte Küstenabstand je Seeschiff im freien Seerouting (WI-0046, S7), in Karteneinheiten:
         * näher als `near` kostet bis `nearPenalty` mehr, weiter als `far` je weitere `far` Einheiten
         * `farPenalty` mehr. Wirkt nur auf die Wegwahl, nie auf das Tempo.
         */
        kuestenfahrt: mitHerkunft(
            Type.Record(
                Type.String(),
                Type.Union([
                    Type.Object(
                        {
                            near: Type.Number({ exclusiveMinimum: 0 }),
                            nearPenalty: Type.Number({ minimum: 0 }),
                            far: Type.Number({ exclusiveMinimum: 0 }),
                            farPenalty: Type.Number({ minimum: 0 }),
                        },
                        { additionalProperties: false },
                    ),
                    /** Fährt mit dem Küstenabstand dieses anderen Seeschiffs (WI-0069). */
                    Type.Object({ wie: Type.String() }, { additionalProperties: false }),
                ]),
            ),
        ),
        /**
         * Wann Meer und Seen einer Klimazone befahrbar sind (WI-0046, S5), je Zone ein Fenster wie
         * `path.transport_seasons`: gespeichert ist die Befahrbarkeit, nicht die Sperre. Wirkt nur im freien
         * Seerouting und nur mit Reisebeginn; eine Zone ohne Eintrag friert nie zu.
         */
        vereisung: mitHerkunft(Type.Record(Type.String(), Fenster)),
        /**
         * Wann eine Meerregion befahrbar ist und warum sonst nicht (WI-0046, S5; Betreiber 2026-09-27: „wir
         * müssen nachher nur die meere editieren, die gesperrt sind“). Schlüssel ist der Name der Region;
         * wirkt nur im freien Seerouting und nur mit Reisebeginn.
         */
        meerSperren: mitHerkunft(
            Type.Record(
                Type.String(),
                Type.Object(
                    { fenster: Fenster, grund: Type.Union(CLOSURE_REASONS.map((reason) => Type.Literal(reason))) },
                    { additionalProperties: false },
                ),
            ),
        ),
        /**
         * Der Boden der Jahreszeit (WI-0038; seit WI-0258 nach „Wege des Entdeckers“ S. 160-162, E4): je Mittel und
         * Wegklasse die Meilen am Tag trocken, nass, verschneit und tief verschneit. Der Zeitfaktor einer Kante ist
         * `trocken / Wert des Zustands`, nur wenn er größer als 1 ist.
         *
         * - `wegklasse`: welche Zeile der Bodentafel eine Wegart liest (Straße, Weg, Gebirge, querfeldein). Eine Wegart
         *   ohne Eintrag (Fluss, See) hat keinen Boden.
         * - `zustaende`: welche Spalte ein Bodenzustand liest (`klasse`: nass, schnee, tief) und ob er Schnee oder Eis
         *   ist (`schnee`, für die Mehrstunden durch Schnee und die Zustände des Schlittens).
         * - `meilen`: die Tafel je Mittel; `{ wie }` nimmt die Zeile eines anderen Mittels (Wanderer, Einzelreiter,
         *   Karawane, S-1).
         * - `tafel`: welche Klimazone in welcher Jahreszeit welchen Zustand hat (Setzung des Betreibers).
         */
        jahreszeitBoden: mitHerkunft(
            Type.Object(
                {
                    wegklasse: Type.Record(
                        Type.String(),
                        Type.Union(BODEN_WEGKLASSEN.map((name) => Type.Literal(name))),
                    ),
                    zustaende: Type.Record(
                        Type.String(),
                        Type.Object(
                            {
                                klasse: Type.Union(BODEN_ZUSTANDSKLASSEN.map((name) => Type.Literal(name))),
                                schnee: Type.Boolean(),
                            },
                            { additionalProperties: false },
                        ),
                    ),
                    meilen: Type.Record(
                        Type.String(),
                        Type.Union([
                            Type.Record(
                                Type.String(),
                                Type.Object(
                                    {
                                        trocken: Type.Number({ exclusiveMinimum: 0 }),
                                        nass: Type.Number({ exclusiveMinimum: 0 }),
                                        schnee: Type.Number({ exclusiveMinimum: 0 }),
                                        tief: Type.Number({ exclusiveMinimum: 0 }),
                                    },
                                    { additionalProperties: false },
                                ),
                            ),
                            /** Nimmt die Zeile dieses anderen Mittels (S-1). */
                            Type.Object({ wie: Type.String() }, { additionalProperties: false }),
                        ]),
                    ),
                    tafel: Type.Record(Type.String(), Type.Record(Type.String(), Type.String())),
                },
                { additionalProperties: false },
            ),
        ),
        tempo: mitHerkunft(
            Type.Record(Type.String(), Type.Record(Type.String(), Type.Number({ exclusiveMinimum: 0 }))),
        ),
        transportmittel: mitHerkunft(
            Type.Object(
                {
                    land: Type.Array(Type.String()),
                    river: Type.Array(Type.String()),
                    sea: Type.Array(Type.String()),
                },
                { additionalProperties: false },
            ),
        ),
        nieAngeboten: mitHerkunft(Type.Record(Type.String(), Type.Array(Type.String()))),
        vorgabeOhneListe: mitHerkunft(Type.Record(Type.String(), Type.Array(Type.String()))),
        /**
         * Die Flugmittel (WI-0051, Plan 6.35 und 6.37; `air.ts`): je Flugmittel Tempo in Meilen je Stunde (echt,
         * NICHT um den Zeitfaktor überhöht) und Reisehöhe in Schritt über Grund, dazu die Grenzen und Vorgaben
         * des eigenen Flugmittels. Ein Flugmittel steigt höchstens auf die Reisehöhe mal `hoechstflughoeheProzent`
         * ÜBER DEM GELÄNDE direkt unter ihm (`airMaxAboveGround`, Betreiber 2026-10-04) und nie höher als
         * `hoechstflughoeheAbsolutSchritt` über dem Meer (`airCeilingAbsolute`, dünne Luft); umflogen wird nur
         * Gelände, das höher liegt als die absolute Höchstflughöhe minus den Mindestabstand (F2).
         *
         * F4 (Betreiber 2026-10-04): Fliegen über der Reisehöhe kostet Zeit (`flightSurcharge`, `airSurcharge`), damit
         * der Flug lieber um hohe Berge herumfliegt als drüber: `steigkostenFaktor` Schritt Strecke je Schritt, um den
         * die Bahn über die Reisehöhe über Grund steigt, `haltekostenFaktor` als Zuschlag auf die Strecke über ihr.
         */
        flug: mitHerkunft(
            Type.Object(
                {
                    mindestabstandSchritt: Type.Number({ minimum: 0 }),
                    hoechstflughoeheProzent: Type.Number({ exclusiveMinimum: 0 }),
                    hoechstflughoeheAbsolutSchritt: Type.Number({ exclusiveMinimum: 0 }),
                    steigkostenFaktor: Type.Number({ minimum: 0 }),
                    haltekostenFaktor: Type.Number({ minimum: 0 }),
                    profile: Type.Array(
                        Type.Object(
                            {
                                /** Die Kennung in der Anfrage (`air`); nie `custom`. */
                                id: Type.String({ pattern: "^[a-z][A-Za-z]*$" }),
                                gruppe: Type.Union(AIR_GROUPS.map((group) => Type.Literal(group))),
                                tempo: Type.Number({ exclusiveMinimum: 0 }),
                                reisehoehe: Type.Number({ exclusiveMinimum: 0 }),
                            },
                            { additionalProperties: false },
                        ),
                        { minItems: 1 },
                    ),
                    eigenes: Type.Object(
                        { tempo: FlugGrenze, reisehoehe: FlugGrenze },
                        { additionalProperties: false },
                    ),
                },
                { additionalProperties: false },
            ),
        ),
        /** Die Reisekosten je Person (WI-0042, Kap. 6.20), jeder Posten mit Status und Herkunft. */
        reisekosten: Type.Object(
            {
                uebernachtung: mitStatus(JeStufe),
                dach: mitStatus(
                    Type.Record(Type.String(), Type.Union([Type.Literal("gasthaus"), Type.Literal("anBord")])),
                ),
                verpflegung: mitStatus(JeStufe),
                reittier: mitStatus(
                    Type.Object(
                        {
                            jeReisendem: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
                            stallJeNacht: Heller,
                            futterJeWoche: Heller,
                            hufbeschlag: Heller,
                        },
                        { additionalProperties: false },
                    ),
                ),
                flusspassage: mitStatus(
                    Type.Object(
                        {
                            je100Meilen: JeStufe,
                            stromaufFaktor: Type.Number({ minimum: 1 }),
                            reittierJe100Meilen: Heller,
                        },
                        { additionalProperties: false },
                    ),
                ),
                seepassage: mitStatus(
                    Type.Object({ je100Meilen: JeStufe, reittierJe100Meilen: Heller }, { additionalProperties: false }),
                ),
                kutsche: mitStatus(
                    Type.Object(
                        { reisemittel: Type.Array(Type.String()), je100Meilen: Heller },
                        { additionalProperties: false },
                    ),
                ),
                zoll: mitStatus(JeStufe),
                /**
                 * Wie die Landesgrenzen einer Reise gezählt werden (WI-0065, Legacy `route-costs.js`): Läufe unter
                 * `mindestLaufMeilen` im Nachbarreich sind kein Übertritt, abgetastet wird alle `abtastschritt`
                 * Karteneinheiten. Die Zählung selbst steht in `travel-borders.ts`; der Zoll ist `zoll[stufe]` mal Grenzen.
                 */
                grenzuebertritt: mitStatus(
                    Type.Object(
                        {
                            mindestLaufMeilen: Type.Number({ minimum: 0 }),
                            abtastschritt: Type.Number({ exclusiveMinimum: 0 }),
                        },
                        { additionalProperties: false },
                    ),
                ),
            },
            { additionalProperties: false },
        ),
    },
    { $id: "TravelModel", additionalProperties: false },
);

export type TravelModel = Static<typeof TravelModel>;
/** Der bevorzugte Küstenabstand eines Seeschiffs (`kuestenfahrt`), aufgelöst: nie ein Verweis. */
export type CoastProfile = Exclude<TravelModel["kuestenfahrt"]["wert"][string], { wie: string }>;

export type RouteDomain = "land" | "river" | "sea";

/**
 * Der Normierer des Zeitgewichts: „schnellste" misst Kalenderzeit, also Reisezeit x 12 / Reisetag.
 * Legacy hält ihn als Konstante (AVESMAPS_TRAVEL_DEFAULT_HOURS). Er skaliert alle Gewichte gleich
 * und ändert die Wahl nur zusammen mit dem Umstiegsaufschlag.
 */
export const WEIGHT_NORMALIZER_HOURS = 12;

/** Flussweg ist Fluss, Seeweg ist See, alles andere Land (client-graph.php, avesmapsClientRouteDomain). */
export function routeDomain(pathType: string): RouteDomain {
    if (pathType === "Flussweg") return "river";
    if (pathType === "Seeweg") return "sea";
    return "land";
}

/** Was eine Wegart überhaupt anbietet - eine gespeicherte Liste wird damit geschnitten. */
export function offeredTransports(model: TravelModel, pathType: string): string[] {
    const never = model.nieAngeboten.wert[pathType] ?? [];
    return model.transportmittel.wert[routeDomain(pathType)].filter((transport) => !never.includes(transport));
}

/** Was ohne gespeicherte Liste fahren darf. */
export function defaultAllowedTransports(model: TravelModel, pathType: string): string[] {
    const excluded = model.vorgabeOhneListe.wert[pathType] ?? [];
    return offeredTransports(model, pathType).filter((transport) => !excluded.includes(transport));
}

/**
 * Welche Mittel auf DIESEM Weg fahren dürfen.
 *
 * 🔴 Legacys Semantik, genau: eine gespeicherte Liste ist maßgeblich, auch leer - AUSSER sie ist leer
 * und keine Domäne ist gesetzt; dann ist es eine Altzeile und bekommt die Vorgabe. Die Liste wird
 * immer mit dem Angebot der Wegart geschnitten (avesmapsClientRoutePathAllowedTransports).
 *
 * Ein neues Mittel (WI-0069) steht in keiner Liste aus Legacy: Es fährt dort, wo die Liste das Mittel nennt,
 * von dem es erbt (`freigabeErbe`), und nur, wenn die Wegart es anbietet. Eine Liste erweitert sich so nie über
 * ihr Angebot hinaus, und eine leere bleibt leer.
 *
 * 🔴 **Vom Editor vollständig geschrieben** (`geschrieben`, `path.transports_written`, Migration 0208; F16 „A“, Betreiber
 * 2026-10-18): Dann gilt die Liste genau, wie sie dasteht (geschnitten mit dem Angebot), auch leer; nichts erbt.
 */
export function allowedTransportsForPath(
    model: TravelModel,
    pathType: string,
    stored: readonly string[] | null,
    storedDomain: string | null,
    geschrieben = false,
): string[] {
    if (stored === null || (!geschrieben && stored.length === 0 && (storedDomain ?? "").trim() === "")) {
        return defaultAllowedTransports(model, pathType);
    }
    const offered = offeredTransports(model, pathType);
    const allowed = stored.filter((transport) => offered.includes(transport));
    if (geschrieben) return allowed;
    for (const transport of offered) {
        const parent = model.freigabeErbe.wert[transport];
        if (parent !== undefined && !allowed.includes(transport) && stored.includes(parent)) allowed.push(transport);
    }
    return allowed;
}

/**
 * Das gespeicherte Sperrfenster eines Weges für dieses Mittel (`path.transport_seasons`): sein eigenes, sonst
 * das des Mittels, von dem es erbt (WI-0069). Undefined heißt ganzjährig gangbar. Vom Editor vollständig
 * geschrieben (`geschrieben`, Migration 0208, F16 „A“): nur das eigene.
 */
export function pathSeasonWindow<T>(
    model: TravelModel,
    seasons: Readonly<Record<string, T>> | undefined | null,
    transport: string,
    geschrieben = false,
): T | undefined {
    if (!seasons) return undefined;
    const own = seasons[transport];
    if (own !== undefined || geschrieben) return own;
    const parent = model.freigabeErbe.wert[transport];
    return parent === undefined ? undefined : seasons[parent];
}

/** Tempo in Meilen je Stunde (um den Zeitfaktor überhöht); null, wenn die Tafel nichts kennt. */
export function travelSpeed(model: TravelModel, transport: string, pathType: string): number | null {
    const speed = model.tempo.wert[transport]?.[pathType];
    return typeof speed === "number" && speed > 0 ? speed : null;
}

/**
 * Der Reisetag des Mittels: Nachtfahrt, sonst sein eigener (`reisetagStunden.jeReisemittel`, WI-0069), sonst
 * Land oder Wasser. Ein Flugmittel reist wie an Land (WI-0051, F-E2 = A), nicht mit dem Tag des Wassers.
 *
 * 🔴 EINE Quelle für Zeitgewicht, Rastzähler, Etappenplan und Ankunft: Wer die Stunden eines Mittels braucht,
 * fragt hier (oder `stageDayHours`, das für Land und Flug das Planerfeld nimmt).
 */
export function travelDayHours(model: TravelModel, transport: string): number {
    const hours = model.reisetagStunden.wert;
    if (model.nachtfahrt.wert.includes(transport)) return hours.night;
    const own = hours.jeReisemittel[transport];
    if (own !== undefined) return own;
    const landDay = model.transportmittel.wert.land.includes(transport) || isAirTransport(model, transport);
    return landDay ? hours.land : hours.water;
}

/**
 * „Schnellste" gewichtet Reisezeit mit 12 / Reisetag: Land x 1,5, Wasser x 1, Nachtfahrt x 0,5, Galeere (8 h) x 1,5.
 *
 * `normalizerHours` ist der eingestellte Wert der Systemsteuerung (WI-0153); ohne Angabe gilt die Konstante — so
 * rechnet der Browser, der die Einstellungen nicht kennt. 🪤 Der Aufrufer liest ihn EINMAL vor seiner Schleife: Die
 * Stelle hier läuft je Kante des Dijkstra.
 */
export function timeWeightFactor(model: TravelModel, transport: string, normalizerHours?: number): number {
    return (normalizerHours ?? WEIGHT_NORMALIZER_HOURS) / travelDayHours(model, transport);
}

/** Die Bodentafel eines Mittels: Meilen am Tag je Wegklasse und Zustand. */
export type GroundMiles = Record<string, { trocken: number; nass: number; schnee: number; tief: number }>;

/**
 * Die Bodentafel eines Mittels (`jahreszeitBoden.meilen`), Verweise (`{ wie }`) aufgelöst wie `coastProfileOf`; null,
 * wenn das Mittel keine Zeile hat oder die Verweise im Kreis laufen.
 */
export function groundMilesOf(model: TravelModel, transport: string): GroundMiles | null {
    const seen = new Set<string>();
    let current = transport;
    while (!seen.has(current)) {
        seen.add(current);
        const entry = model.jahreszeitBoden.wert.meilen[current];
        if (entry === undefined) return null;
        const wie = (entry as { wie?: unknown }).wie;
        if (typeof wie !== "string") return entry as GroundMiles;
        current = wie;
    }
    return null;
}

/**
 * Der Boden der Jahreszeit (WI-0038, E10; Legacy `season-ground.php`, Owner 03.08.2026; seit WI-0258 nach „Wege des
 * Entdeckers“ S. 160-162): Wie viel länger ein Stück in dieser Klimazone und Jahreszeit dauert - `trocken / Wert des
 * Zustands` in den Meilen am Tag, die die Bodentafel dem Mittel auf der Wegart gibt. Null ohne Mehrzeit: kein
 * Zustand, ein Boden ohne Wirkung für dieses Mittel, Wasser.
 */
export function seasonGround(
    model: TravelModel,
    zone: string | null,
    season: Season,
    pathType: string,
    transport: string,
): { condition: string; factor: number } | null {
    return conditionGround(
        model,
        zone === null ? undefined : model.jahreszeitBoden.wert.tafel[zone]?.[season],
        pathType,
        transport,
    );
}

/**
 * Wie viel länger ein Stück einer Wegart auf diesem Bodenzustand dauert, mit derselben Rechnung wie der Boden der
 * Jahreszeit (`seasonGround`); auch für den Boden über der Schneegrenze (`snowlineGround`). Null ohne Mehrzeit.
 */
export function conditionGround(
    model: TravelModel,
    condition: string | undefined,
    pathType: string,
    transport: string,
): { condition: string; factor: number } | null {
    const table = model.jahreszeitBoden.wert;
    const state = condition === undefined ? undefined : table.zustaende[condition];
    const wegklasse = table.wegklasse[pathType];
    const miles = wegklasse === undefined ? undefined : groundMilesOf(model, transport)?.[wegklasse];
    if (condition === undefined || state === undefined || miles === undefined) return null;
    const factor = miles.trocken / miles[state.klasse];
    return factor > 1 ? { condition, factor } : null;
}

/**
 * Ist dieser Bodenzustand der Jahreszeit Schnee oder Eis (WI-0065 Nachtrag 2026-10-04)? Abgeleitet aus der Bodentafel
 * (`zustaende[…].schnee`), keine eigene Liste: leichter Schnee, Tiefschnee und Eis - dieselben Zustände, auf denen der
 * Schlitten fährt (`bodenPflicht`). Nässe zählt nicht.
 */
export function isSnowCondition(model: TravelModel, condition: string): boolean {
    return model.jahreszeitBoden.wert.zustaende[condition]?.schnee === true;
}

/** Reisestunden aus der Kantenzeit: Zeit x Meilen je Einheit x Zeitfaktor (avesmapsRouteTravelHoursFromCostUnits). */
export function travelHoursFromTime(model: TravelModel, time: number): number {
    return time * model.meilenJeKarteneinheit.wert * model.zeitfaktor.wert;
}
