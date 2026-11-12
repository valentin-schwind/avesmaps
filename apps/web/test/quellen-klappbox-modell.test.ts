import { describe, expect, it } from "vitest";
import {
    alleOffen,
    artWahl,
    filterZahlen,
    gruppenNachArt,
    istEingeschraenkt,
    schalteAlle,
    schalteZeile,
    sichtbare,
    suchSchluessel,
    trifftSuche,
    wikiKreis,
    type KlappAnsicht,
    type KreisEingabe,
    type KlappQuelle,
} from "../src/fenster/quellen-klappbox-modell.ts";

/**
 * Die Rechnung der Quellen-Klappbox (WI-0254 `--weiter`): was die Box zeigt, wenn gesucht, gefiltert und sortiert wird, wie die Gruppen nach Art des Belegs heißen und wie viele
 * Quellen in welche fallen.
 *
 * Problemfälle: eine Suche, die Umlaute, ß oder Akzente nicht gleichsetzt („Müller“ findet „Mueller“ nicht); ein Filter, der eine Quelle OHNE Typ durchlässt; eine stille Quelle, die
 * ungefragt in der Liste oder in den Zahlen steht; „alle zuklappen“, das Zeilen schließt, die gar nicht sichtbar sind; eine Sortierung, die die Liste des Aufrufers umordnet.
 */

const quelle = (nr: number, teil: Partial<KlappQuelle> = {}): KlappQuelle => ({
    id: `q${String(nr)}`,
    titel: `Quelle ${String(nr)}`,
    art: null,
    seiten: "",
    notiz: "",
    typ: "regionalspielhilfe",
    offiziell: true,
    url: null,
    kreis: "voll",
    state: "active",
    neu: false,
    ...teil,
});

const ansicht = (teil: Partial<KlappAnsicht> = {}): KlappAnsicht => ({
    suche: "",
    arten: [],
    typen: [],
    sortierung: "wiki",
    stilleZeigen: false,
    ...teil,
});

const ids = (liste: readonly KlappQuelle[]): string[] => liste.map((q) => q.id);

describe("Suchschlüssel und Suche", () => {
    it("🔴 Groß- und Kleinschreibung, Umlaute, ß und Akzente sind gleich", () => {
        expect(suchSchluessel("Müller")).toBe(suchSchluessel("mueller"));
        expect(suchSchluessel("Müller")).toBe(suchSchluessel("MULLER"));
        expect(suchSchluessel("Straße")).toBe(suchSchluessel("strasse"));
        expect(suchSchluessel("Hôtel Café")).toBe("hotel cafe");
        expect(suchSchluessel("  Aventurischer   Bote #12 ")).toBe("aventurischer bote 12");
        expect(suchSchluessel(undefined)).toBe("");
        expect(suchSchluessel(null)).toBe("");
    });

    it("jedes Wort der Suche muss im Titel vorkommen; eine leere Suche trifft alles", () => {
        expect(trifftSuche("Die Kräuter des Dschungels", "kraeuter dschungel")).toBe(true);
        expect(trifftSuche("Die Kräuter des Dschungels", "dschungel kraeuter")).toBe(true);
        expect(trifftSuche("Die Kräuter des Dschungels", "kraeuter wüste")).toBe(false);
        expect(trifftSuche("Alles", "")).toBe(true);
        expect(trifftSuche("Alles", "   ")).toBe(true);
        // Nur Satzzeichen: Der Schlüssel ist leer, die Suche trifft alles (kein Fehlschlag durch ein verirrtes Zeichen).
        expect(trifftSuche("Alles", "?!")).toBe(true);
    });
});

describe("Sichtbare Quellen", () => {
    const liste = [
        quelle(1, { titel: "Zoo-Botanica", art: "ausfuehrlich", typ: "regelbuch" }),
        quelle(2, { titel: "Aventurischer Bote 121", art: "erwaehnung", typ: "aventurischer_bote" }),
        quelle(3, { titel: "Ärzte und Heiler", art: "ergaenzend", typ: null }),
        quelle(4, { titel: "Bestiarium", art: null, typ: "regelbuch" }),
        quelle(5, { titel: "Alte Notiz", art: "ausfuehrlich", state: "retired" }),
        quelle(6, { titel: "Unterdrückt", art: "erwaehnung", state: "suppressed" }),
    ];

    it("ohne Suche und Filter: alle aktiven, in der Folge des Aufrufers (wie im Wiki)", () => {
        expect(ids(sichtbare(liste, ansicht()))).toEqual(["q1", "q2", "q3", "q4"]);
    });

    it("🔴 stille Quellen stehen nur, wenn man sie zeigen lässt", () => {
        expect(ids(sichtbare(liste, ansicht({ stilleZeigen: true })))).toEqual(["q1", "q2", "q3", "q4", "q5", "q6"]);
    });

    it("die Suche trifft den Titel, gleich in welcher Schreibung", () => {
        expect(ids(sichtbare(liste, ansicht({ suche: "aerzte" })))).toEqual(["q3"]);
        expect(ids(sichtbare(liste, ansicht({ suche: "BOTE 121" })))).toEqual(["q2"]);
        expect(ids(sichtbare(liste, ansicht({ suche: "gibtesnicht" })))).toEqual([]);
    });

    it("Filter nach Art des Belegs; die Quellen ohne Art heißen „ohne“", () => {
        expect(ids(sichtbare(liste, ansicht({ arten: ["ausfuehrlich"] })))).toEqual(["q1"]);
        expect(ids(sichtbare(liste, ansicht({ arten: ["ohne"] })))).toEqual(["q4"]);
        expect(ids(sichtbare(liste, ansicht({ arten: ["erwaehnung", "ergaenzend"] })))).toEqual(["q2", "q3"]);
    });

    it("🔴 ein Filter nach Typ lässt eine Quelle ohne bekannten Typ nicht durch", () => {
        expect(ids(sichtbare(liste, ansicht({ typen: ["regelbuch"] })))).toEqual(["q1", "q4"]);
        expect(ids(sichtbare(liste, ansicht({ typen: ["regelbuch", "aventurischer_bote"] })))).toEqual([
            "q1",
            "q2",
            "q4",
        ]);
    });

    it("Suche und Filter schränken gemeinsam ein", () => {
        expect(ids(sichtbare(liste, ansicht({ suche: "bote", typen: ["regelbuch"] })))).toEqual([]);
        expect(ids(sichtbare(liste, ansicht({ suche: "b", typen: ["regelbuch"], arten: ["ohne"] })))).toEqual(["q4"]);
    });

    it("Sortierung nach Titel A–Z; die Liste des Aufrufers bleibt unberührt", () => {
        const vorher = ids(liste);
        expect(ids(sichtbare(liste, ansicht({ sortierung: "titel" })))).toEqual(["q3", "q2", "q4", "q1"]);
        expect(ids(liste)).toEqual(vorher);
    });

    it("Sortierung nach Art: Ausführlich, Ergänzend, Erwähnung, ohne Art; darin nach Titel, stille hinter den aktiven", () => {
        expect(ids(sichtbare(liste, ansicht({ sortierung: "art", stilleZeigen: true })))).toEqual([
            "q1", // Ausführlich: Zoo-Botanica (aktiv)
            "q5", // Ausführlich: Alte Notiz (gelöst) hinter dem aktiven
            "q3", // Ergänzend
            "q2", // Erwähnung: Aventurischer Bote (aktiv)
            "q6", // Erwähnung: Unterdrückt (still)
            "q4", // ohne Art
        ]);
    });

    it("die Titel sortieren nach den Regeln der Sprache (Ä steht bei A)", () => {
        const l = [quelle(1, { titel: "Zander" }), quelle(2, { titel: "Ärger" }), quelle(3, { titel: "Bote" })];
        expect(ids(sichtbare(l, ansicht({ sortierung: "titel", sprache: "de" })))).toEqual(["q2", "q3", "q1"]);
    });
});

describe("Gruppen nach Art des Belegs", () => {
    it("in der Folge Ausführlich, Ergänzend, Erwähnung, ohne Art; eine leere Gruppe fehlt; jede trägt ihre Zahl", () => {
        const liste = [
            quelle(1, { art: "erwaehnung" }),
            quelle(2, { art: null }),
            quelle(3, { art: "ausfuehrlich" }),
            quelle(4, { art: "erwaehnung" }),
        ];
        const gruppen = gruppenNachArt(liste);
        expect(gruppen.map((g) => [g.art, g.zahl, ids(g.quellen)])).toEqual([
            ["ausfuehrlich", 1, ["q3"]],
            ["erwaehnung", 2, ["q1", "q4"]],
            ["ohne", 1, ["q2"]],
        ]);
        expect(gruppenNachArt([])).toEqual([]);
    });

    it("artWahl nennt eine Quelle ohne Art „ohne“", () => {
        expect(artWahl({ art: null })).toBe("ohne");
        expect(artWahl({ art: "ergaenzend" })).toBe("ergaenzend");
    });
});

describe("Zahlen im Filter", () => {
    const liste = [
        quelle(1, { art: "ausfuehrlich", typ: "roman" }),
        quelle(2, { art: "ausfuehrlich", typ: "roman" }),
        quelle(3, { art: null, typ: null }),
        quelle(4, { art: "erwaehnung", typ: "roman", state: "suppressed" }),
    ];

    it("zählt nur, was zeigbar ist", () => {
        expect(filterZahlen(liste, false)).toEqual({
            arten: { ausfuehrlich: 2, ergaenzend: 0, erwaehnung: 0, ohne: 1 },
            typen: { roman: 2 },
        });
        expect(filterZahlen(liste, true)).toEqual({
            arten: { ausfuehrlich: 2, ergaenzend: 0, erwaehnung: 1, ohne: 1 },
            typen: { roman: 3 },
        });
    });

    it("„n von m“ steht, sobald gesucht oder gefiltert wird", () => {
        expect(istEingeschraenkt({ suche: "", arten: [], typen: [] })).toBe(false);
        expect(istEingeschraenkt({ suche: "  ", arten: [], typen: [] })).toBe(false);
        expect(istEingeschraenkt({ suche: "x", arten: [], typen: [] })).toBe(true);
        expect(istEingeschraenkt({ suche: "", arten: ["ohne"], typen: [] })).toBe(true);
        expect(istEingeschraenkt({ suche: "", arten: [], typen: ["roman"] })).toBe(true);
    });
});

describe("Auf und zu", () => {
    it("eine Zeile schaltet um; die alte Menge bleibt unberührt", () => {
        const leer = new Set<string>();
        const auf = schalteZeile(leer, "q1");
        expect([...auf]).toEqual(["q1"]);
        expect([...leer]).toEqual([]);
        expect([...schalteZeile(auf, "q1")]).toEqual([]);
    });

    it("🔴 „alle“ klappt nur die sichtbaren Zeilen: erst alle auf, sind alle auf, alle zu; andere Zeilen bleiben, wie sie sind", () => {
        const sichtbarIds = ["q1", "q2"];
        const offen = new Set(["q9"]);
        expect(alleOffen(sichtbarIds, offen)).toBe(false);
        const alleAuf = schalteAlle(offen, sichtbarIds);
        expect([...alleAuf].sort()).toEqual(["q1", "q2", "q9"]);
        expect(alleOffen(sichtbarIds, alleAuf)).toBe(true);
        expect([...schalteAlle(alleAuf, sichtbarIds)]).toEqual(["q9"]);
        // Eine einzelne offene Zeile: „alle“ klappt erst die übrigen auf.
        expect([...schalteAlle(new Set(["q1"]), sichtbarIds)].sort()).toEqual(["q1", "q2"]);
    });

    it("ohne Zeilen gibt es nichts aufzuklappen: Der Knopf bietet „aufklappen“", () => {
        expect(alleOffen([], new Set(["q1"]))).toBe(false);
        expect([...schalteAlle(new Set(["q1"]), [])]).toEqual(["q1"]);
    });
});

describe("Der Kreis nach dem Vergleich mit dem Wiki (WI-0254 §12)", () => {
    const wiki = { art: "ausfuehrlich", seiten: "130", notiz: "Beschreibt den Hof." };
    const eingabe = (teil: Partial<KreisEingabe> = {}): KreisEingabe => ({
        state: "active",
        lauf: true,
        art: "ausfuehrlich",
        seiten: "130",
        notiz: "Beschreibt den Hof.",
        wiki,
        ...teil,
    });

    it("🔴 ● wenn das Wiki dieselbe Quelle mit derselben Art, denselben Seiten und derselben Notiz zitiert", () => {
        expect(wikiKreis(eingabe())).toBe("voll");
    });

    it("🔴 ◐ bei jeder Abweichung in Art, Seiten oder Notiz: alles andere ist manuell", () => {
        expect(wikiKreis(eingabe({ art: "ergaenzend" }))).toBe("halb");
        expect(wikiKreis(eingabe({ art: null }))).toBe("halb");
        expect(wikiKreis(eingabe({ seiten: "131" }))).toBe("halb");
        expect(wikiKreis(eingabe({ notiz: "Anders." }))).toBe("halb");
        expect(wikiKreis(eingabe({ notiz: null }))).toBe("halb");
    });

    it("🔴 ◐, wenn das Wiki die Quelle an diesem Gegenstand nicht zitiert (auch Legacy ohne Wiki-Zeile)", () => {
        expect(wikiKreis(eingabe({ wiki: null }))).toBe("halb");
    });

    it("🔴 ○ für eine unterdrückte oder gelöste Verknüpfung, gleich was das Wiki sagt", () => {
        expect(wikiKreis(eingabe({ state: "suppressed" }))).toBe("leer");
        expect(wikiKreis(eingabe({ state: "retired" }))).toBe("leer");
        // Auch ohne Lauf: Nicht aktiv ist nicht aktiv.
        expect(wikiKreis(eingabe({ state: "retired", lauf: false, wiki: null }))).toBe("leer");
    });

    it("🔴 kein Kreis, wo es keinen Lauf gibt: Die Herkunft ist unbekannt, nichts wird behauptet", () => {
        expect(wikiKreis(eingabe({ lauf: false, wiki: null }))).toBeNull();
        expect(wikiKreis(eingabe({ lauf: false }))).toBeNull();
    });

    it("der Vergleich kürzt an den Rändern, und leer ist nichts: ' 130 ' gleicht '130', '' gleicht null", () => {
        expect(wikiKreis(eingabe({ seiten: " 130 " }))).toBe("voll");
        expect(
            wikiKreis(eingabe({ wiki: { art: null, seiten: "", notiz: null }, art: null, seiten: null, notiz: "  " })),
        ).toBe("voll");
    });

    it("beim Weg entscheidet der Server über alle Abschnitte: ● nur, wenn jeder dem Zitat seines Artikels gleicht", () => {
        expect(wikiKreis(eingabe({ abschnitteGleich: true }))).toBe("voll");
        // Die Angaben oben gleichen dem Zitat, aber ein Abschnitt tut es nicht.
        expect(wikiKreis(eingabe({ abschnitteGleich: false }))).toBe("halb");
        // Ohne Zitat gibt es nichts, dem alle gleichen könnten.
        expect(wikiKreis(eingabe({ wiki: null, abschnitteGleich: true }))).toBe("halb");
    });
});
