import { describe, expect, it } from "vitest";
import {
    PANEL_APPROVED_EXTRAS,
    PANEL_LEGACY_ONLY,
    SUBJECT_DETAIL_KINDS,
    SUBJECT_FACT_FIELDS,
    displayDescription,
    visibleFacts,
    wikiFirstSentence,
    type PanelApprovedExtras,
    type SubjectFact,
    type SubjectTextFact,
} from "../src/index.ts";

/**
 * Die Anzeigeregel des Infopanels (WI-0063 27.8): der erste Satz exakt wie Legacy `settlementFirstSentence`
 * (Mirror `b9657635a`, `js/map-features/map-features-location-marker-entry.js`), die Sichtbarkeit der als `legacyHidden`
 * markierten Zusatzfelder und der Umfang der Beschreibung je Subject-Art.
 *
 * Die festen Fälle der Satzregel wurden einmalig gegen Legacys Funktion selbst gerechnet (alle hier genannten Eingaben und
 * 20.000 zufällige Zeichenfolgen aus den heiklen Zeichen, null Abweichungen).
 */

const WIKI = {
    kind: "wiki",
    wikiUrl: "https://de.wiki-aventurica.de/wiki/X",
    syncedAt: "2026-06-06T21:01:40.000Z",
} as const;
const EDITORIAL = { kind: "editorial" } as const;

/** Die elf Felder, die mit der Staatsinfobox des Gebiets (E4, WI-0063 27.18) hinzukamen: acht Zeilen und drei Zusatzfelder. */
const E4_FIELDS = [
    "herrschaftsform",
    "gruendung",
    "aufloesung",
    "gruender",
    "waehrung",
    "einwohnerzahl",
    "geographisch",
    "handelswaren",
    "politisch",
    "wappenbeschreibung",
    "zugehoerigkeitRoh",
] as const;

/** Die Felder der Infobox einer Sprache (WI-0261 S5b): Eine Sprache ist keine Art mit Zusatzfeldern, keines ist für die übrigen Arten freigegeben. */
const SPRACH_FIELDS = [
    "sprachfamilie",
    "vorstufen",
    "schrift",
    "dialekte",
    "sprecheranzahl",
    "amtssprache",
    "weitereVerbreitung",
] as const;

describe("wikiFirstSentence (Port von Legacys settlementFirstSentence)", () => {
    it.each<[string, string | null | undefined, string]>([
        ["leer, nur Leerraum, null und undefined geben nichts", "", ""],
        ["nur Leerraum", "  \n\t ", ""],
        ["null", null, ""],
        ["undefined", undefined, ""],
        [
            "der erste Satz bis zum Punkt vor Leerraum",
            "Gareth ist die Hauptstadt des Mittelreiches. Sie liegt am Großen Fluss.",
            "Gareth ist die Hauptstadt des Mittelreiches.",
        ],
        ["Ausrufe- und Fragezeichen beenden den Satz", "Wirklich? Ja! Nein.", "Wirklich?"],
        ["ein Ausrufezeichen vor Leerraum", "Hoch lebe der Kaiser! Und weiter", "Hoch lebe der Kaiser!"],
        ["ohne Leerraum nach dem Zeichen geht der Satz weiter", "Wirklich?Ja! Nein.", "Wirklich?Ja!"],
        ["ein Punkt ohne Leerraum danach (Dezimalzahl) schneidet nicht", "3.5 Meilen groß. Rest", "3.5 Meilen groß."],
        ["Auslassungspunkte: erst der letzte Punkt vor Leerraum schließt", "Warte... was. Nächster", "Warte..."],
        ["eine Abkürzung schneidet (wie in Legacy)", "Dr. Müller wohnt hier.", "Dr."],
        ["der Punkt am Ende ohne Folgetext", "Ende mit Punkt.", "Ende mit Punkt."],
        ["kein Satzende: der ganze Text", "Kein Satzende", "Kein Satzende"],
        [
            "Leerraum, Tabulator und Zeilenumbruch werden zu einem Leerzeichen",
            "Zwei  Leerzeichen\nund\tUmbruch. Zweiter.",
            "Zwei Leerzeichen und Umbruch.",
        ],
        ["geschütztes Leerzeichen ist Leerraum", "Preis: 5,5 Dukaten. Und weiter", "Preis: 5,5 Dukaten."],
        [
            "Leerzeichen vor dem Komma entfallen",
            "Punin , die Stadt am Yaquir. Weiteres.",
            "Punin, die Stadt am Yaquir.",
        ],
        ["mehrere Leerzeichen vor dem Komma", "Ein Satz   , mit Komma.", "Ein Satz, mit Komma."],
        ["Vorlagenrest: ab dem ersten | gekappt", "Eine Stadt |Befestigung=ja |Stadtteil=x", "Eine Stadt"],
        ["Vorlagenrest: ab dem ersten } gekappt", "Eine Stadt }} Nachsatz", "Eine Stadt"],
        ["Vorlagenrest: ein | mitten im Satz kappt auch vor dem Satzende", "Ein Satz | mit Rest. Zweiter.", "Ein Satz"],
        ["Vorlagenrest: „Feld=“ mit Großbuchstaben nach Leerraum", "Eine Stadt Befestigung=ja", "Eine Stadt"],
        ["Vorlagenrest: auch mit Umlaut-Anfang und Leerraum vor dem =", "Eine Stadt Äbte = viele", "Eine Stadt"],
        ["Vorlagenrest ohne Leerraum davor wird nicht gekappt", "Befestigung=ja", "Befestigung=ja"],
        ["ein klein geschriebenes Feld ist kein Vorlagenrest", "Klein feld=wert", "Klein feld=wert"],
        ["nur Vorlagenrest vom ersten Zeichen an: nichts bleibt", "|Befestigung=ja", ""],
        ["Infobox-Rest „Feld= |Feld= …“ wird abgeschnitten", "Stadt Stadtteil= |Befestigung= …", "Stadt"],
    ])("%s", (_name, input, expected) => {
        expect(wikiFirstSentence(input)).toBe(expected);
    });

    it("kappt bei mehr als 220 Zeichen bei 220 und schließt mit ' …'", () => {
        expect(wikiFirstSentence("x".repeat(300))).toBe(`${"x".repeat(220)} …`);
        // 220 Zeichen samt Satzpunkt bleiben ganz, 221 werden bei 220 gekappt (der Punkt fällt dabei weg).
        expect(wikiFirstSentence(`${"a".repeat(219)}. Danach`)).toBe(`${"a".repeat(219)}.`);
        expect(wikiFirstSentence(`${"a".repeat(220)}. Danach`)).toBe(`${"a".repeat(220)} …`);
        expect(wikiFirstSentence(`${"a".repeat(221)}. Danach`)).toBe(`${"a".repeat(220)} …`);
    });

    it("ein Leerzeichen an der Schnittstelle fällt vor dem ' …' weg", () => {
        const text = `${"a".repeat(219)} ${"b".repeat(50)}`;
        expect(wikiFirstSentence(text)).toBe(`${"a".repeat(219)} …`);
    });
});

const textFact = (overrides: Partial<SubjectTextFact> = {}): SubjectTextFact => ({
    field: "description",
    value: "Erster Satz. Zweiter Satz.",
    provenance: WIKI,
    ...overrides,
});

describe("visibleFacts", () => {
    const facts: SubjectFact[] = [
        textFact({ field: "description" }),
        textFact({ field: "einwohner", value: "60000", provenance: EDITORIAL, layer: "direct", legacyHidden: true }),
        textFact({ field: "lage", value: "Direkte Lage", provenance: EDITORIAL, layer: "direct", legacyHidden: true }),
        { field: "synonyms", values: ["Alter Wald"], provenance: WIKI, legacyHidden: true },
        { field: "neighbors", direction: "O", values: ["Ostland"], provenance: WIKI, legacyHidden: true },
        textFact({ field: "regionParent", value: "Nordmarken" }),
    ];

    it("wie Legacy zeigt genau die Fakten ohne legacyHidden, in der Reihenfolge des Servers", () => {
        expect(visibleFacts("area", facts, PANEL_LEGACY_ONLY).map((fact) => fact.field)).toEqual([
            "description",
            "regionParent",
        ]);
    });

    it("wie Legacy ist für jede Subject-Art leer", () => {
        expect(Object.keys(PANEL_LEGACY_ONLY).sort()).toEqual([...SUBJECT_DETAIL_KINDS].sort());
        for (const kind of SUBJECT_DETAIL_KINDS) {
            expect(PANEL_LEGACY_ONLY[kind], kind).toEqual({ fields: [], fullDescription: false, context: false });
        }
    });

    it("die Freigabe vom 2026-10-04 nennt jede Subject-Art und jedes damalige Feld, mit Pille und Kontext", () => {
        expect(Object.keys(PANEL_APPROVED_EXTRAS).sort()).toEqual([...SUBJECT_DETAIL_KINDS].sort());
        // 🔴 Ein später hinzukommendes Feld ist erst mit Eintrag freigegeben: die elf Felder der Staatsinfobox (WI-0063 27.18)
        // standen am 2026-10-04 nicht auf dem Blatt.
        const since = new Set<string>([...E4_FIELDS, ...SPRACH_FIELDS]);
        const approvedThen = SUBJECT_FACT_FIELDS.filter((field) => !since.has(field));
        for (const kind of SUBJECT_DETAIL_KINDS) {
            // Am Gebiet ist der Kontinent des Gebietsexports verborgen geblieben (27.18).
            const expected =
                kind === "territory" ? approvedThen.filter((field) => field !== "continent") : approvedThen;
            expect([...PANEL_APPROVED_EXTRAS[kind].fields].sort(), kind).toEqual([...expected].sort());
            expect(PANEL_APPROVED_EXTRAS[kind].fullDescription, kind).toBe(true);
            expect(PANEL_APPROVED_EXTRAS[kind].context, kind).toBe(true);
        }
        expect(visibleFacts("area", facts)).toEqual(facts);
    });

    it("🔴 Gebiet (27.18): die vier Zusatzfelder des Gebietsexports erscheinen nicht, die Zeilen der Staatsinfobox schon", () => {
        const territory: SubjectFact[] = [
            textFact({ field: "herrschaftsform", value: "Feudalherrschaft", provenance: EDITORIAL }),
            textFact({ field: "continent", value: "Aventurien", provenance: WIKI, legacyHidden: true }),
            textFact({ field: "politisch", value: "Mittelreich", provenance: EDITORIAL, legacyHidden: true }),
            textFact({ field: "wappenbeschreibung", value: "Rot, ein Greif", provenance: WIKI, legacyHidden: true }),
            textFact({ field: "zugehoerigkeitRoh", value: "Mittelreich", provenance: WIKI, legacyHidden: true }),
        ];
        expect(visibleFacts("territory", territory).map((fact) => fact.field)).toEqual(["herrschaftsform"]);
        expect(visibleFacts("territory", territory, PANEL_LEGACY_ONLY).map((fact) => fact.field)).toEqual([
            "herrschaftsform",
        ]);
        // Der Kontinent einer Landschaft ist freigegeben und bleibt es.
        expect(visibleFacts("area", territory).map((fact) => fact.field)).toEqual(["herrschaftsform", "continent"]);
    });

    it("ein freigegebenes Feld zeigt seine verborgenen Fakten, nur für diese Art", () => {
        const approved: PanelApprovedExtras = {
            ...PANEL_LEGACY_ONLY,
            area: { fields: ["neighbors", "synonyms"], fullDescription: false, context: false },
        };
        expect(visibleFacts("area", facts, approved).map((fact) => fact.field)).toEqual([
            "description",
            "synonyms",
            "neighbors",
            "regionParent",
        ]);
        // Eine andere Art bleibt bei Legacy.
        expect(visibleFacts("place", facts, approved).map((fact) => fact.field)).toEqual([
            "description",
            "regionParent",
        ]);
    });

    it("die Freigabe eines Feldes zeigt alle verborgenen Fakten dieses Feldes (der direkte Wert neben dem Nestwert)", () => {
        const both: SubjectFact[] = [
            textFact({ field: "lage", value: "Nest-Lage" }),
            textFact({
                field: "lage",
                value: "Direkte Lage",
                provenance: EDITORIAL,
                layer: "direct",
                legacyHidden: true,
            }),
        ];
        expect(visibleFacts("place", both, PANEL_LEGACY_ONLY)).toHaveLength(1);
        const approved: PanelApprovedExtras = {
            ...PANEL_LEGACY_ONLY,
            place: { fields: ["lage"], fullDescription: false, context: false },
        };
        expect(visibleFacts("place", both, approved).map((fact) => ("value" in fact ? fact.value : ""))).toEqual([
            "Nest-Lage",
            "Direkte Lage",
        ]);
    });

    it("ohne Fakten bleibt die Liste leer", () => {
        expect(visibleFacts("peak", undefined)).toEqual([]);
        expect(visibleFacts("peak", [])).toEqual([]);
    });
});

describe("displayDescription", () => {
    it("Ort, Weg, Landschaft und Gipfel mit Wiki-Herkunft zeigen den ersten Satz, wie Legacy ohne Pille", () => {
        for (const kind of ["place", "path", "area", "peak"] as const) {
            expect(displayDescription(kind, textFact(), PANEL_LEGACY_ONLY), kind).toEqual({ text: "Erster Satz." });
        }
    });

    it("freigegeben steht der ganze Text hinter der Pille, der erste Satz bleibt der sichtbare", () => {
        for (const kind of ["place", "path", "area", "peak"] as const) {
            expect(displayDescription(kind, textFact()), kind).toEqual({
                text: "Erster Satz.",
                full: "Erster Satz. Zweiter Satz.",
            });
        }
    });

    it("der ganze Text ist geglättet: Leerraum zusammengefasst, kein Leerzeichen vor dem Komma", () => {
        const fact = textFact({ value: "Al'Anfa , die Stadt.  Zweiter\n Satz , lang." });
        expect(displayDescription("place", fact)).toEqual({
            text: "Al'Anfa, die Stadt.",
            full: "Al'Anfa, die Stadt. Zweiter Satz, lang.",
        });
    });

    it("ein Text aus einem Satz hat keine Pille", () => {
        expect(displayDescription("area", textFact({ value: "Nur ein Satz." }))).toEqual({ text: "Nur ein Satz." });
    });

    it("die Kraftlinie zeigt den vollen Text, auch mit Wiki-Herkunft", () => {
        expect(displayDescription("powerline", textFact())).toEqual({ text: "Erster Satz. Zweiter Satz." });
    });

    it("die eigene (redaktionelle) Beschreibung eines Orts ohne Nest zeigt Legacy vollständig", () => {
        const own = textFact({ provenance: EDITORIAL, layer: "direct" });
        expect(displayDescription("place", own)).toEqual({ text: "Erster Satz. Zweiter Satz." });
    });

    it("fullDescription gibt die Pille frei, nur für die freigegebene Art", () => {
        const approved: PanelApprovedExtras = {
            ...PANEL_LEGACY_ONLY,
            area: { fields: [], fullDescription: true, context: false },
        };
        expect(displayDescription("area", textFact(), approved).full).toBe("Erster Satz. Zweiter Satz.");
        expect(displayDescription("place", textFact(), approved).full).toBeUndefined();
    });

    it("ein anderes Feld als die Beschreibung bleibt unverändert", () => {
        const field = textFact({ field: "einwohner", value: "Viele. Sehr viele." });
        expect(displayDescription("place", field)).toEqual({ text: "Viele. Sehr viele." });
    });

    it("bleibt vom ersten Satz nichts übrig (nur Vorlagenreste), ist das Ergebnis leer und ohne Pille: keine Zeile", () => {
        expect(displayDescription("area", textFact({ value: "|Befestigung=ja" }))).toEqual({ text: "" });
    });
});
