import { describe, expect, it } from "vitest";
import {
    CAPABILITY_NAMES,
    EDITORPANEL,
    KONTENVERWALTUNG,
    NAV_TAFELN,
    ORTSEDITOR,
    SYSTEMSTEUERUNG,
    SYSTEMSTEUERUNG_GRUPPEN,
    ausTiefemLink,
    capabilitiesFor,
    kinder,
    merkschluessel,
    merkwerte,
    pfad,
    pruefeTafel,
    sichtbar,
    verbModus,
    waehlbar,
    wiederherstellen,
    type NavEintrag,
    type NavTafel,
} from "../src/index.ts";

/**
 * Das Navigationsregister (EDIT-0001 §3.2, WI-0128 E1). Die Fälle T1.1 bis T1.10 aus EDIT-0001 §7.1; dazu die Tafeln selbst:
 * Legacys Weg vom Editorpanel zu den Orten (§3.1), alle acht Karteninhalte mit „später“ (D16), Liste und Ziel je Subjekt (§4.7).
 */
const reviewer = [...capabilitiesFor("reviewer")];
const editor = [...capabilitiesFor("editor")];
const tester = [...capabilitiesFor("tester")];
const betreiberRechte = [...capabilitiesFor("operator")];
const ids = (eintraege: readonly NavEintrag[]): string[] => eintraege.map((eintrag) => eintrag.id);

/** Eine kleine Tafel für die Regeln, unabhängig von den echten Tafeln. */
const probe: NavTafel = {
    id: "probe",
    wurzel: "reiter",
    eintraege: [
        { id: "a", unter: null, art: "bereich", rechte: ["use_editor_menu"], kinder: "schiene", alias: ["alt-a"] },
        {
            id: "a1",
            unter: "a",
            art: "subjekt",
            rechte: [],
            kinder: "reiter",
            liste: "flach",
            ziel: "punkt",
            verb: { id: "a1-bearbeiten", werkzeug: "a1-werkzeug", rechte: ["use_editor_menu"] },
        },
        { id: "a1-alle", unter: "a1", art: "ansicht", rechte: [], zaehler: "a1.alle" },
        { id: "a1-fehlt", unter: "a1", art: "ansicht", rechte: [], zaehler: "a1.fehlt" },
        { id: "a1-werkzeug", unter: "a1", art: "werkzeug", rechte: [] },
        { id: "a2", unter: "a", art: "spaeter", rechte: [], liste: "baum", ziel: "ausschnitt" },
        {
            id: "nur-admin",
            unter: "a",
            art: "subjekt",
            rechte: ["manage_people"],
            liste: "flach",
            ziel: "keins",
            verb: { id: "x", werkzeug: "nur-admin-werkzeug", rechte: ["manage_people"] },
        },
        { id: "nur-admin-werkzeug", unter: "nur-admin", art: "werkzeug", rechte: [] },
        { id: "b", unter: null, art: "spaeter", rechte: ["use_editor_menu"] },
        { id: "c", unter: null, art: "bereich", rechte: ["use_editor_menu"], kinder: "schiene" },
        { id: "c1", unter: "c", art: "spaeter", rechte: [] },
        { id: "d", unter: null, art: "bereich", rechte: ["moderate_submissions"] },
    ],
};

describe("Navigationsregister: die Tafeln sind in sich gültig", () => {
    it("T1.1 bis T1.6: keine Regelverletzung in den echten Tafeln", () => {
        for (const tafel of Object.values(NAV_TAFELN)) expect(pruefeTafel(tafel), tafel.id).toEqual([]);
        expect(pruefeTafel(probe)).toEqual([]);
    });

    it("T1.1 Kennungen eindeutig und nur [a-z0-9-], auch die Legacy-Aliasse", () => {
        const kaputt: NavTafel = {
            id: "kaputt",
            wurzel: "reiter",
            eintraege: [
                { id: "Gross", unter: null, art: "bereich", rechte: [] },
                { id: "doppelt", unter: null, art: "bereich", rechte: [], alias: ["gross"] },
                { id: "doppelt", unter: null, art: "bereich", rechte: [], alias: ["doppelt"] },
            ],
        };
        const probleme = pruefeTafel(kaputt).join("\n");
        expect(probleme).toMatch(/Gross.*Kennung/);
        expect(probleme).toMatch(/doppelt.*mehrfach/);
        expect(probleme).toMatch(/Alias doppelt.*Kennung/);
    });

    it("T1.2 jedes Recht steht im Katalog", () => {
        for (const tafel of Object.values(NAV_TAFELN))
            for (const eintrag of tafel.eintraege) {
                for (const recht of eintrag.rechte)
                    expect(CAPABILITY_NAMES, `${tafel.id}.${eintrag.id}`).toContain(recht);
                for (const recht of eintrag.verb?.rechte ?? []) expect(CAPABILITY_NAMES).toContain(recht);
            }
        const fremd = {
            ...probe,
            eintraege: [{ id: "z", unter: null, art: "bereich", rechte: ["darf_alles"] }],
        } as unknown as NavTafel;
        expect(pruefeTafel(fremd).join("\n")).toMatch(/darf_alles.*Katalog/);
    });

    it("T1.3 genau ein Verb je Subjekt, und sein Werkzeug steht als Kind darunter und hat eine Tafel", () => {
        for (const tafel of Object.values(NAV_TAFELN))
            for (const subjekt of tafel.eintraege.filter((eintrag) => eintrag.art === "subjekt")) {
                expect(subjekt.verb, `${tafel.id}.${subjekt.id}`).toBeDefined();
                const werkzeug = tafel.eintraege.find((eintrag) => eintrag.id === subjekt.verb!.werkzeug);
                expect(werkzeug?.art).toBe("werkzeug");
                // Ein Werkzeug steht unter EINEM Subjekt, das sein Verb nennt; mehrere Subjekte dürfen es teilen („Inhalte bearbeiten“,
                // WI-0254: vier Karteninhalte, ein Fenster).
                const nennen = tafel.eintraege
                    .filter((eintrag) => eintrag.art === "subjekt" && eintrag.verb?.werkzeug === werkzeug!.id)
                    .map((eintrag) => eintrag.id);
                expect(nennen, `${tafel.id}.${werkzeug!.id}`).toContain(werkzeug?.unter);
                expect(Object.keys(NAV_TAFELN), `Tafel für ${werkzeug!.id}`).toContain(werkzeug!.id);
            }
        const ohneVerb: NavTafel = {
            id: "ohne",
            wurzel: "schiene",
            eintraege: [{ id: "s", unter: null, art: "subjekt", rechte: [], liste: "flach", ziel: "punkt" }],
        };
        expect(pruefeTafel(ohneVerb).join("\n")).toMatch(/s.*Verb/);
    });

    it("T1.4 keine Zählquelle an einem Subjekt der Schiene (Legacy: „Keine Anzahl je Zeile“)", () => {
        for (const tafel of Object.values(NAV_TAFELN))
            for (const subjekt of tafel.eintraege.filter((eintrag) => eintrag.art === "subjekt"))
                expect(subjekt.zaehler, `${tafel.id}.${subjekt.id}`).toBeUndefined();
        const mitZahl = structuredClone(probe) as { eintraege: NavEintrag[] } & NavTafel;
        (mitZahl.eintraege[1] as { zaehler?: string }).zaehler = "a1.alle";
        expect(pruefeTafel(mitZahl).join("\n")).toMatch(/a1.*Zählung/);
    });

    it("T1.5 Ansichten stehen genau eine Ebene unter einem Subjekt oder Werkzeug (oder als Eintrag einer Schiene) und haben keine Kinder (eine Reiterzeile)", () => {
        for (const tafel of Object.values(NAV_TAFELN))
            for (const ansicht of tafel.eintraege.filter((eintrag) => eintrag.art === "ansicht")) {
                const oben = tafel.eintraege.find((eintrag) => eintrag.id === ansicht.unter);
                const schiene = oben?.art === "bereich" && oben.kinder === "schiene";
                expect(schiene || ["subjekt", "werkzeug"].includes(oben?.art ?? ""), `${tafel.id}.${ansicht.id}`).toBe(
                    true,
                );
                expect(tafel.eintraege.some((eintrag) => eintrag.unter === ansicht.id)).toBe(false);
            }
        // Unter einem Bereich mit Reitern ist eine Ansicht falsch: Reiter sind Bereiche, keine Listenansichten.
        const unterReiter: NavTafel = {
            id: "reiter",
            wurzel: "reiter",
            eintraege: [
                { id: "r", unter: null, art: "bereich", rechte: [], kinder: "reiter" },
                { id: "r-a", unter: "r", art: "ansicht", rechte: [] },
            ],
        };
        expect(pruefeTafel(unterReiter).join("\n")).toMatch(/r-a.*Ansicht/);
        const zweiteZeile: NavTafel = {
            ...probe,
            eintraege: [...probe.eintraege, { id: "a1-alle-unter", unter: "a1-alle", art: "ansicht", rechte: [] }],
        };
        expect(pruefeTafel(zweiteZeile).join("\n")).toMatch(/a1-alle-unter.*Ansicht/);
    });

    it("T1.6 Facetten stehen nur im Register, an Subjekt oder Werkzeug; die Orte haben „Karte“ obenauf und Legacys sieben", () => {
        const orte = EDITORPANEL.eintraege.find((eintrag) => eintrag.id === "orte");
        // „Karte“ ersetzt die Reiter Alle · Platziert · Fehlt (Betreiber 2026-10-11), danach Legacys sieben in Legacys Reihenfolge.
        expect(orte?.facetten).toEqual(["karte", "typ", "lage", "art", "kontinent", "quelle", "wappen", "bilder"]);
        for (const tafel of Object.values(NAV_TAFELN))
            for (const eintrag of tafel.eintraege.filter((x) => x.facetten))
                expect(["subjekt", "werkzeug"], `${tafel.id}.${eintrag.id}`).toContain(eintrag.art);
    });
});

describe("Navigationsregister: Sichtbarkeit nach Rechten", () => {
    it("T1.7 ein Knoten ohne wählbaren Eintrag fällt weg, auch wenn er einen späteren hätte", () => {
        expect(ids(sichtbar(probe, editor))).not.toContain("c");
        expect(ids(sichtbar(probe, editor))).not.toContain("c1");
        expect(ids(kinder(probe, null, editor))).toEqual(["a", "b", "d"]);
    });

    it("Rechte vererben sich nach unten, und ein Eintrag ist nur so sichtbar wie sein Knoten", () => {
        expect(ids(kinder(probe, "a", editor))).toEqual(["a1", "a2"]);
        expect(ids(kinder(probe, "a", [...capabilitiesFor("admin")]))).toEqual(["a1", "a2", "nur-admin"]);
        expect(sichtbar(probe, tester)).toEqual([]);
        expect(waehlbar(probe, "a1-werkzeug", editor)).toBe(true);
        expect(waehlbar(probe, "nur-admin", editor)).toBe(false);
    });

    it("T1.8 „später“ ist sichtbar, aber nicht wählbar", () => {
        expect(ids(sichtbar(probe, editor))).toContain("a2");
        expect(waehlbar(probe, "a2", editor)).toBe(false);
        expect(waehlbar(probe, "b", editor)).toBe(false);
    });

    it("das Editorpanel: vier Bereiche wie Legacy, alle wählbar („Community“ seit WI-0268 C3); acht Subjekte, „Orte“ und „Regionen“ wählbar (D16, WI-0178)", () => {
        expect(ids(kinder(EDITORPANEL, null, reviewer))).toEqual([
            "community",
            "aenderungen",
            "karteninhalte",
            "status",
        ]);
        expect(
            kinder(EDITORPANEL, null, reviewer)
                .filter((x) => waehlbar(EDITORPANEL, x.id, reviewer))
                .map((x) => x.id),
        ).toEqual(["community", "aenderungen", "karteninhalte", "status"]);
        // Der Reiter „Community“ (WI-0268 C3, Bedienkonzept WI-0263 §1.1): „Meldungen“, seit WI-0268 C4 „Mails“, seit WI-0269 C10 „Bewertungen“ sind gebaut. Die Mails erscheinen nur mit dem Recht
        // `read_mailbox` (ab Betreiber, Entscheidung E3), der Social Hub (WI-0270 C11) nur mit dem Recht für Beiträge des Projekts (ab Editor); Reviewer sehen keinen von beiden.
        expect(ids(kinder(EDITORPANEL, "community", reviewer))).toEqual(["meldungen", "bewertungen"]);
        expect(ids(kinder(EDITORPANEL, "community", editor))).toEqual(["meldungen", "bewertungen", "social"]);
        expect(ids(kinder(EDITORPANEL, "community", betreiberRechte))).toEqual([
            "meldungen",
            "mails",
            "bewertungen",
            "social",
        ]);
        // Die Kartenvorschläge stehen seit WI-0305 bei den Meldungen: Wer nur sie prüft (Kurator, Kartograph), sieht die Meldungen; der alte Tiefe Link führt dorthin.
        expect(ids(kinder(EDITORPANEL, "community", ["moderate_map_suggestions"]))).toEqual(["meldungen"]);
        expect(ausTiefemLink(EDITORPANEL, "kartenvorschlaege")).toEqual(["community", "meldungen"]);
        expect(
            kinder(EDITORPANEL, "community", betreiberRechte)
                .filter((x) => waehlbar(EDITORPANEL, x.id, betreiberRechte))
                .map((x) => x.id),
        ).toEqual(["meldungen", "mails", "bewertungen", "social"]);
        expect(
            kinder(EDITORPANEL, "community", editor)
                .filter((x) => waehlbar(EDITORPANEL, x.id, editor))
                .map((x) => x.id),
        ).toEqual(["meldungen", "bewertungen", "social"]);
        expect(
            kinder(EDITORPANEL, "community", reviewer)
                .filter((x) => waehlbar(EDITORPANEL, x.id, reviewer))
                .map((x) => x.id),
        ).toEqual(["meldungen", "bewertungen"]);
        expect(kinder(EDITORPANEL, "community", betreiberRechte).filter((x) => x.art === "spaeter")).toEqual([]);
        // Der Tiefe Link: Kennung oder Legacys Alias (`review` für den Reiter, `reports` für die Meldungen).
        expect(ausTiefemLink(EDITORPANEL, "review")).toEqual(["community"]);
        expect(ausTiefemLink(EDITORPANEL, "meldungen")).toEqual(["community", "meldungen"]);
        expect(ausTiefemLink(EDITORPANEL, "reports")).toEqual(["community", "meldungen"]);
        // Der Reiter „Status“ trägt seit WI-0138 die Besucherstatistik; seit V12 sind alle Unterreiter wählbar, seit WI-0141
        // (`ab506596`) auch der vierte, „Server“, mit demselben Recht wie die anderen drei.
        expect(ids(kinder(EDITORPANEL, "status", reviewer))).toEqual(["besucher", "editoren", "api", "server"]);
        expect(
            kinder(EDITORPANEL, "status", reviewer)
                .filter((x) => waehlbar(EDITORPANEL, x.id, reviewer))
                .map((x) => x.id),
        ).toEqual(["besucher", "editoren", "api", "server"]);
        expect(ids(kinder(EDITORPANEL, "karteninhalte", reviewer))).toEqual([
            "orte",
            "territorien",
            "regionen",
            "wege",
            "kraftlinien",
            "sprachen",
            "literatur",
            "vorkommen",
            "quellen",
            "korpora",
        ]);
        // Nichts ist mehr später (Karten stehen seit 2026-11-02 als Reiter am Objekt); Literatur, Vorkommen, Quellen und Korpora öffnen das Fenster „Inhalte bearbeiten“ (WI-0254).
        expect(kinder(EDITORPANEL, "karteninhalte", reviewer).filter((x) => x.art === "spaeter")).toHaveLength(0);
        expect(ids(kinder(EDITORPANEL, "quellen", reviewer))).toEqual(["inhalteeditor"]);
        // Keine Ansichten mehr unter den Orten (Facette „Karte“); darunter steht nur das Werkzeug des Verbs.
        expect(ids(kinder(EDITORPANEL, "orte", reviewer))).toEqual(["ortseditor"]);
        // Der Landschaftseditor (WI-0178 A3) steht unter den Regionen, wie der Ortseditor unter den Orten.
        expect(ids(kinder(EDITORPANEL, "regionen", reviewer))).toEqual(["landschaftseditor"]);
        // Der Gebietseditor (WI-0209 A3) steht unter den Herrschaftsgebieten.
        expect(ids(kinder(EDITORPANEL, "territorien", reviewer))).toEqual(["gebietseditor"]);
        // Der Kraftlinien-Editor (WI-0205 K2) steht unter den Kraftlinien.
        expect(ids(kinder(EDITORPANEL, "kraftlinien", reviewer))).toEqual(["kraftlinieneditor"]);
        // Das Wege-Fenster (WI-0177 W5a) steht unter den Wegen.
        expect(ids(kinder(EDITORPANEL, "wege", reviewer))).toEqual(["wegeditor"]);
        // Der Spracheditor (WI-0261 S5d2) steht unter den Sprachen.
        expect(ids(kinder(EDITORPANEL, "sprachen", reviewer))).toEqual(["spracheditor"]);
        expect(sichtbar(EDITORPANEL, tester)).toEqual([]);
    });

    it("Liste und Ziel je Karteninhalt (EDIT-0001 §4.7 G2, G3)", () => {
        const art = Object.fromEntries(
            kinder(EDITORPANEL, "karteninhalte", reviewer).map((x) => [x.id, `${x.liste}/${x.ziel}`]),
        );
        expect(art).toEqual({
            orte: "flach/punkt",
            territorien: "baum/ausschnitt",
            regionen: "flach/ausschnitt",
            // Eine Zeile je Straße (WI-0177 W5a); die Abschnitte stehen in den Eigenschaften.
            wege: "flach/ausschnitt",
            // Eine Zeile je Linie (die Abschnitte gleichen Namens, WI-0205 K2); die Abschnitte stehen in der Kette der Nodices.
            kraftlinien: "flach/ausschnitt",
            // Eine Zeile je Sprache und je freiem Wiki-Artikel (WI-0261 S5d2); die Teilflächen stehen im Reiter „Flächen“.
            sprachen: "flach/ausschnitt",
            literatur: "flach/keins",
            vorkommen: "flach/keins",
            quellen: "flach/keins",
            korpora: "flach/keins",
        });
    });

    it("der Ortseditor: Reiter wie im Blatt Fassung 3, der Verlauf seit E17 wählbar", () => {
        expect(ids(kinder(ORTSEDITOR, null, reviewer))).toEqual([
            "eigenschaften",
            "innerorts",
            "quellen",
            "bilder",
            "karten",
            "verlauf",
        ]);
        expect(waehlbar(ORTSEDITOR, "verlauf", reviewer)).toBe(true);
    });
});

describe("Navigationsregister: Pfad, Tiefer Link, Merken", () => {
    it("pfad nennt die Kette von der Wurzel bis zum Eintrag", () => {
        expect(pfad(EDITORPANEL, "ortseditor")).toEqual(["karteninhalte", "orte", "ortseditor"]);
        expect(pfad(EDITORPANEL, "gibt-es-nicht")).toBeUndefined();
    });

    it("T1.9 Tiefer Link: Kennung, Legacy-Alias, Unbekanntes", () => {
        expect(ausTiefemLink(EDITORPANEL, "orte")).toEqual(["karteninhalte", "orte"]);
        expect(ausTiefemLink(EDITORPANEL, "wiki-sync")).toEqual(["karteninhalte"]);
        expect(ausTiefemLink(EDITORPANEL, "locations")).toEqual(["karteninhalte", "orte"]);
        expect(ausTiefemLink(EDITORPANEL, " Locations ")).toEqual(["karteninhalte", "orte"]);
        expect(ausTiefemLink(EDITORPANEL, "presence")).toEqual(["status"]);
        expect(ausTiefemLink(EDITORPANEL, "ortseditor")).toEqual(["karteninhalte", "orte", "ortseditor"]);
        expect(ausTiefemLink(EDITORPANEL, "<script>")).toBeUndefined();
        expect(ausTiefemLink(EDITORPANEL, "")).toBeUndefined();
    });

    it("merkschluessel: je Knoten ein Schlüssel", () => {
        expect(merkschluessel(EDITORPANEL, null)).toBe("avesmaps3d.nav.editorpanel.wurzel");
        expect(merkschluessel(EDITORPANEL, "karteninhalte")).toBe("avesmaps3d.nav.editorpanel.karteninhalte");
    });

    it("ohne Gemerktes: oben die Vorgabe der Tafel („Karteninhalte“, obwohl „Änderungen“ davor steht), sonst der erste wählbare Weg", () => {
        expect(wiederherstellen(EDITORPANEL, new Map(), reviewer)).toEqual({
            pfad: ["karteninhalte", "orte"],
            verwerfen: [],
        });
        expect(wiederherstellen(probe, new Map(), editor).pfad).toEqual(["a", "a1", "a1-alle"]);
    });

    it("gemerkt wird nur die Kaskade der Reiter und der Schiene, nie eine Ansicht und nie ein Werkzeug", () => {
        expect(merkwerte(probe, ["a", "a1", "a1-fehlt"])).toEqual([
            ["avesmaps3d.nav.probe.wurzel", "a"],
            ["avesmaps3d.nav.probe.a", "a1"],
        ]);
        expect(merkwerte(EDITORPANEL, ["karteninhalte", "orte", "ortseditor"])).toHaveLength(2);
    });

    it("T1.10 wiederherstellen verwirft Unbekanntes, Späteres und Werte ohne Recht", () => {
        const gemerkt = new Map([
            ["avesmaps3d.nav.editorpanel.wurzel", "gibt-es-auch-nicht"],
            ["avesmaps3d.nav.editorpanel.karteninhalte", "gibt-es-nicht"],
            ["avesmaps3d.nav.editorpanel.orte", "orte-fehlt"],
        ]);
        // „orte-fehlt“ war ein Reiter bis 2026-10-11 (jetzt Facette „Karte“). Unter „Orte“ gibt es keine Kaskade mehr: Der alte
        // Merkwert wird weder gelesen noch verworfen, er wirkt nicht.
        expect(wiederherstellen(EDITORPANEL, gemerkt, reviewer)).toEqual({
            pfad: ["karteninhalte", "orte"],
            verwerfen: ["avesmaps3d.nav.editorpanel.wurzel", "avesmaps3d.nav.editorpanel.karteninhalte"],
        });
        // „Community“ ist seit WI-0268 C3 wählbar, „Mails“ darunter seit C4 nur mit `read_mailbox`: Der Merkwert eines Unterreiters, den die Rechte nicht mehr hergeben, fällt weg, der Reiter selbst bleibt.
        expect(
            wiederherstellen(
                EDITORPANEL,
                new Map([
                    ["avesmaps3d.nav.editorpanel.wurzel", "community"],
                    ["avesmaps3d.nav.editorpanel.community", "mails"],
                ]),
                reviewer,
            ),
        ).toEqual({ pfad: ["community", "meldungen"], verwerfen: ["avesmaps3d.nav.editorpanel.community"] });
        expect(wiederherstellen(probe, new Map([["avesmaps3d.nav.probe.a1", "gibt-es-nicht"]]), editor)).toEqual({
            pfad: ["a", "a1", "a1-alle"],
            verwerfen: ["avesmaps3d.nav.probe.a1"],
        });
        const admin = [...capabilitiesFor("admin")];
        const merkAdmin = new Map([["avesmaps3d.nav.probe.a", "nur-admin"]]);
        expect(wiederherstellen(probe, merkAdmin, admin).pfad).toEqual(["a", "nur-admin"]);
        expect(wiederherstellen(probe, merkAdmin, editor)).toEqual({
            pfad: ["a", "a1", "a1-alle"],
            verwerfen: ["avesmaps3d.nav.probe.a"],
        });
    });

    it("ein Tiefer Link schlägt das Gemerkte und wird von dort aus weiter aufgelöst", () => {
        const gemerkt = new Map([["avesmaps3d.nav.probe.wurzel", "d"]]);
        expect(
            wiederherstellen(probe, gemerkt, [...capabilitiesFor("reviewer"), "use_editor_menu"], "alt-a").pfad,
        ).toEqual(["a", "a1", "a1-alle"]);
        expect(wiederherstellen(EDITORPANEL, new Map(), reviewer, "ortseditor").pfad).toEqual([
            "karteninhalte",
            "orte",
            "ortseditor",
        ]);
        // Ohne Recht zählt der Link nicht.
        expect(wiederherstellen(probe, new Map(), editor, "nur-admin").pfad).toEqual(["a", "a1", "a1-alle"]);
    });
});

describe("das Verb öffnet zum Schreiben oder nur lesend (EDIT-0001 §7.1 E3)", () => {
    it("🔴 ein Editor bearbeitet, ein Reviewer liest; ohne Editor-Menü gibt es kein Verb", () => {
        expect(verbModus(EDITORPANEL, "orte", editor)).toBe("bearbeiten");
        expect(verbModus(EDITORPANEL, "orte", reviewer)).toBe("lesen");
        expect(verbModus(EDITORPANEL, "orte", tester)).toBeUndefined();
    });

    it("ein späteres Subjekt und ein Eintrag ohne Verb haben keins; die Inhalte öffnen ihr Fenster lesend oder schreibend", () => {
        expect(verbModus(EDITORPANEL, "karten", editor)).toBeUndefined();
        for (const inhalt of ["quellen", "literatur", "vorkommen", "korpora"]) {
            expect(verbModus(EDITORPANEL, inhalt, editor), inhalt).toBe("bearbeiten");
            expect(verbModus(EDITORPANEL, inhalt, reviewer), inhalt).toBe("lesen");
            expect(verbModus(EDITORPANEL, inhalt, tester), inhalt).toBeUndefined();
        }
        expect(verbModus(EDITORPANEL, "karteninhalte", editor)).toBeUndefined();
        expect(verbModus(EDITORPANEL, "gibt-es-nicht", editor)).toBeUndefined();
    });

    it("jedes Schreibrecht eines Verbs steht im Katalog", () => {
        const kaputt: NavTafel = {
            ...EDITORPANEL,
            eintraege: EDITORPANEL.eintraege.map((eintrag) =>
                "verb" in eintrag
                    ? { ...eintrag, verb: { ...eintrag.verb, schreiben: ["gibt_es_nicht" as never] } }
                    : eintrag,
            ),
        };
        expect(pruefeTafel(kaputt)).toContain("orte: Recht gibt_es_nicht des Verbs steht nicht im Katalog");
    });
});

describe("die Tafeln der Kontenverwaltung und der Systemsteuerung (E2, vorher ADMIN_ENTRIES; geteilt in SYS-15, SYS-0001 §9d.1)", () => {
    const admin = [...capabilitiesFor("admin")];

    it("🔴 ein Admin sieht die Bereiche beider Tafeln mit ihren Einträgen in der Reihenfolge der Tafel", () => {
        expect(ids(kinder(KONTENVERWALTUNG, null, admin))).toEqual(["bereich-personen"]);
        expect(ids(kinder(KONTENVERWALTUNG, "bereich-personen", admin))).toEqual([
            "personen",
            "einladungen",
            "rollen",
            "sonderrollen",
            "protokoll",
        ]);
        // Die Fachrechte öffnen genau ihren Reiter, ohne den Betrieb (WI-0279).
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-karte", ["manage_routing"]))).toEqual(["wegfindung"]);
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-karte", ["manage_terrain_recipe"]))).toEqual(["hoehenmodell"]);
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-karte", ["manage_map_series"]))).toEqual(["kartenserien"]);
        // Der Meteorologe (WI-0288 Stufe 4) sieht das Wettermodell, ohne den Betrieb und in keiner anderen Gruppe.
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-karte", ["manage_weather_model"]))).toEqual(["wettermodell"]);
        expect(ids(kinder(SYSTEMSTEUERUNG, null, ["manage_weather_model", "edit_weather"]))).toEqual(["bereich-karte"]);
        // Ein Admin sieht alle vier Gruppen; „Claudia & Claudio“ fehlt ihm (nur die Rolle Betreiber).
        expect(ids(kinder(SYSTEMSTEUERUNG, null, admin))).toEqual([...SYSTEMSTEUERUNG_GRUPPEN]);
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-redaktion", admin))).toEqual(["neuigkeiten", "mail"]);
    });

    it("🔴 vier feste Gruppen mit den Reitern in der Reihenfolge des Betreibers (2026-10-17, WI-0127 §23)", () => {
        const betreiber = [...capabilitiesFor("operator")];
        const gruppe = (id: string): string[] => ids(kinder(SYSTEMSTEUERUNG, id, betreiber));
        expect(ids(kinder(SYSTEMSTEUERUNG, null, betreiber))).toEqual([
            "bereich-betrieb",
            "bereich-auslieferung",
            "bereich-karte",
            "bereich-redaktion",
        ]);
        // BETRIEB: Betriebszustand · Systemzustand · Warteschlange · Backups · Protokoll
        expect(gruppe("bereich-betrieb")).toEqual([
            "betrieb",
            "systemzustand",
            "statusseite",
            "backup",
            "protokoll-system",
        ]);
        // AUSLIEFERUNG & DATEN: Umgebungen · Versionen · Datenabgleich
        expect(gruppe("bereich-auslieferung")).toEqual(["production", "versionen", "abgleiche"]);
        // KARTE & EINSTELLUNGEN: Kartenserien (vorn, Vorlage WI-0220 abgenommen 2026-10-18) · Inhalte · Höhenmodell ·
        // Wettermodell (WI-0288 Stufe 4) · Karteneinstellungen · Wegfindung · Zoombänder (hinten, WI-0221)
        expect(gruppe("bereich-karte")).toEqual([
            "kartenserien",
            "inhalte",
            "hoehenmodell",
            "wettermodell",
            "karteneinstellungen",
            "wegfindung",
            "zoombaender",
        ]);
        // REDAKTION & ZUSAMMENARBEIT: Neuigkeiten · Mailpostfach (WI-0268 C6c) · Social Media (WI-0270 C12a, nur Betreiber) · Claudia & Claudio
        expect(gruppe("bereich-redaktion")).toEqual(["neuigkeiten", "mail", "social", "claudio"]);
        // Jeder Reiter steht in genau einer der vier Gruppen, und es gibt keine weitere.
        const bereiche = SYSTEMSTEUERUNG.eintraege
            .filter((eintrag) => eintrag.art === "bereich")
            .map((eintrag) => eintrag.id);
        expect(bereiche).toEqual([...SYSTEMSTEUERUNG_GRUPPEN]);
        for (const eintrag of SYSTEMSTEUERUNG.eintraege.filter((eintrag) => eintrag.art !== "bereich")) {
            expect(SYSTEMSTEUERUNG_GRUPPEN as readonly string[], eintrag.id).toContain(eintrag.unter);
        }
    });

    it("🔴 die Kennungen sind über beide Tafeln eindeutig (tiefe Links `?verwaltung=<eintrag>` finden ihr Fenster)", () => {
        const alle = [...KONTENVERWALTUNG.eintraege, ...SYSTEMSTEUERUNG.eintraege].map((eintrag) => eintrag.id);
        expect(new Set(alle).size).toBe(alle.length);
    });

    it("🔴 ein Bereich ohne wählbaren Eintrag fällt weg: ein Verweis allein macht keinen Bereich", () => {
        expect(ids(kinder(SYSTEMSTEUERUNG, null, ["view_own_jobs", "use_editor_menu"]))).toEqual([]);
        expect(ids(kinder(KONTENVERWALTUNG, null, ["manage_people"]))).toEqual(["bereich-personen"]);
        // Wer nur Konten pflegt, sieht die Systemsteuerung nicht (§9d.1).
        expect(ids(kinder(SYSTEMSTEUERUNG, null, ["manage_people"]))).toEqual([]);
        // Editoren und Tester sehen seit WI-0253 nur den Datenabgleich, dort nur WikiSync (Vali 2026-10-25: „Vorschau und Berichte: alle“).
        expect(ids(kinder(SYSTEMSTEUERUNG, null, editor))).toEqual(["bereich-auslieferung"]);
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-auslieferung", editor))).toEqual(["abgleiche"]);
        expect(ids(kinder(KONTENVERWALTUNG, null, editor))).toEqual([]);
    });

    it("🔴 „Claudia & Claudio“ ist der Betreiber-Kanal: nur für die Rolle Betreiber, nach den Neuigkeiten (KANAL-0001 K3, Frage 2 = B)", () => {
        const betreiber = [...capabilitiesFor("operator")];
        expect(waehlbar(SYSTEMSTEUERUNG, "claudio", admin)).toBe(false);
        expect(waehlbar(SYSTEMSTEUERUNG, "claudio", betreiber)).toBe(true);
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-redaktion", betreiber))).toEqual([
            "neuigkeiten",
            "mail",
            "social",
            "claudio",
        ]);
        // Das Recht allein trägt den Eintrag und damit den Bereich.
        expect(ids(kinder(SYSTEMSTEUERUNG, "bereich-redaktion", ["use_operator_channel"]))).toEqual(["claudio"]);
        expect(waehlbar(SYSTEMSTEUERUNG, "statusseite", admin)).toBe(true);
        expect(waehlbar(SYSTEMSTEUERUNG, "betrieb", admin)).toBe(true);
    });
});
