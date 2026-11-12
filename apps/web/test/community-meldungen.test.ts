import { describe, expect, it } from "vitest";
import {
    ABSCHLUSS_ERGEBNISSE,
    capabilitiesFor,
    type VerlaufEintrag,
    type VorgangDetail,
    type VorgangListe,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import {
    abschlussNachricht,
    abschlussSperre,
    bezugText,
    filtere,
    handgriffe,
    hinweise,
    kategorieName,
    kreisVon,
    lageVon,
    legendeNamen,
    legendeZahlen,
    mitDublette,
    mitErgebnis,
    neuerAbschluss,
    papierkorbAn,
    personenName,
    prioritaetPille,
    rechtsText,
    segmentZahl,
    sortiere,
    stehtOffen,
    titelVon,
    trefferZahl,
    unterreiterZahl,
    unterzeile,
    verlaufZeilen,
    zustaendigWahlen,
    zustaendigZeilen,
    istMeine,
    LISTEN_REITER,
    sonderrollenImTrichter,
    unterzeileTeile,
    rollenBlattZeilen,
    rollenBlattFolge,
    rollenGeaendert,
} from "../src/community/meldungen-modell";
import { createRedaktion, vorschlagVon, VORGANG_WERKZEUG, type VorgangBezug } from "../src/community/redaktion";
import {
    fuehreAus,
    kennung,
    kennungFrei,
    ladeListe,
    redaktionFehler,
    schreibeNotiz,
    sichten,
} from "../src/community/redaktion-api";

/**
 * Das Modell des Reiters „Community › Meldungen“ ohne Browser (WI-0268 C3): Kreis, Titel, Filter, Sortierung, Zahlen, Sperrgründe der Handgriffe je Recht und Zustand, der Verlauf, die Anbindung an die
 * Fensterverwaltung und die Schritte an der Leitung.
 */

const zeile = (ueberschreibe: Partial<VorgangZeile> = {}): VorgangZeile => ({
    nummer: "COM-000123",
    art: "meldung",
    kategorie: "lage",
    zustand: "neu",
    ergebnis: null,
    prioritaet: "normal",
    eingang: "website",
    bezugName: "Wehrheim",
    bezugArt: "objekt",
    zustaendig: null,
    ohneQuelle: false,
    moeglicheDublette: null,
    eingegangenAt: "2026-10-31T10:00:00.000Z",
    aktivAt: "2026-10-31T10:00:00.000Z",
    revision: 1,
    ...ueberschreibe,
});

const ICH = "11111111-1111-4111-8111-111111111111";
const ANDERE = "22222222-2222-4222-8222-222222222222";
const reviewer = [...capabilitiesFor("reviewer")];
const admin = [...capabilitiesFor("admin")];

const detail = (z: VorgangZeile, rest: Partial<VorgangDetail> = {}): VorgangDetail => ({
    zeile: z,
    quelle: null,
    fehltArt: null,
    bezug: {
        art: "objekt",
        objektArt: "place",
        objektId: "33333333-3333-4333-8333-333333333333",
        name: "Wehrheim",
        typ: "Stadt",
        lage: { x: 100, y: 100 },
        vorschlagLage: null,
        naechsterOrt: null,
    },
    melder: { name: null, rueckwege: ["statusseite"], entfernt: false },
    dubletteVon: null,
    papierkorbAt: null,
    archiviertAt: null,
    verlauf: [],
    ...rest,
});

describe("Kreis, Titel und Zeile (Bedienkonzept §2.2, §4)", () => {
    it("🔴 der Kreis folgt dem Zustand: neu ○, in Arbeit ◐, Rückfrage ◑, abgeschlossen ●", () => {
        expect(kreisVon("neu")).toBe("leer");
        expect(kreisVon("in_arbeit")).toBe("halb");
        expect(kreisVon("rueckfrage")).toBe("halb-rechts");
        expect(kreisVon("abgeschlossen")).toBe("voll");
    });

    it("der Titel heißt „‹Kategorie›: ‹Bezug›“, eine Stelle „Stelle bei ‹Ort›“", () => {
        expect(titelVon(zeile())).toBe("Lage falsch: Wehrheim");
        expect(titelVon(zeile({ kategorie: "fehlt", bezugArt: "stelle", bezugName: "Gallys" }))).toBe(
            "Etwas fehlt: Stelle bei Gallys",
        );
        // Eine Stelle ohne nächsten Ort ist trotzdem eine Stelle.
        expect(titelVon(zeile({ kategorie: "fehlt", bezugArt: "stelle", bezugName: null }))).toBe(
            "Etwas fehlt: Stelle",
        );
        // Ohne Bezug steht die Kategorie allein; eine unbekannte Kategorie bleibt, wie sie kommt.
        expect(titelVon(zeile({ bezugArt: null, bezugName: null }))).toBe("Lage falsch");
        expect(kategorieName("unbekannt")).toBe("unbekannt");
        expect(kategorieName("bewertung")).toBe("Bewertung gemeldet");
        expect(bezugText(zeile({ bezugArt: null, bezugName: null }))).toBeUndefined();
    });

    it("die Unterzeile nennt Nummer, Bezug und wer zuständig ist", () => {
        expect(unterzeile(zeile())).toBe("COM-000123 · Wehrheim · niemand zuständig");
        expect(unterzeile(zeile({ zustaendig: { id: ICH, name: "Vali" } }))).toBe("COM-000123 · Wehrheim · Vali");
        expect(unterzeile(zeile({ bezugArt: null, bezugName: null }))).toBe("COM-000123 · niemand zuständig");
    });

    it("🔴 eine Pille trägt nur hoch (Bernstein) und dringend (Rot)", () => {
        expect(prioritaetPille("niedrig")).toBeUndefined();
        expect(prioritaetPille("normal")).toBeUndefined();
        expect(prioritaetPille("hoch")).toBe("warnung");
        expect(prioritaetPille("dringend")).toBe("gefahr");
    });

    it("Hinweise: mögliche Dublette und ohne Quelle, nur an Offenem", () => {
        expect(hinweise(zeile())).toEqual([]);
        expect(hinweise(zeile({ moeglicheDublette: "COM-000117", ohneQuelle: true }))).toEqual([
            "mögliche Dublette von COM-000117",
            "ohne Quelle",
        ]);
        expect(
            hinweise(zeile({ zustand: "abgeschlossen", ohneQuelle: true, moeglicheDublette: "COM-000117" })),
        ).toEqual([]);
    });

    it("rechts steht die Zeit, an Abgeschlossenem das Ergebnis", () => {
        const jetzt = new Date("2026-10-31T10:05:00.000Z");
        expect(rechtsText(zeile(), jetzt)).toMatch(/5/);
        expect(rechtsText(zeile({ zustand: "abgeschlossen", ergebnis: "umgesetzt" }), jetzt)).toBe("Umgesetzt");
    });
});

describe("Segmente, Zahlen und Legende", () => {
    const zaehler: VorgangListe["zaehler"] = {
        offen: 9,
        erledigt: 4,
        archiv: 20,
        papierkorb: 2,
        meine: 5,
        neu: 3,
        inArbeit: 5,
        rueckfrage: 1,
    };

    it("🔴 die Zahl am Unterreiter ist, was auf mich wartet (`zaehler.meine`)", () => {
        expect(unterreiterZahl({ zaehler })).toBe(5);
        expect(unterreiterZahl(undefined)).toBeUndefined();
    });

    it("die Segmente zählen je Ablage", () => {
        expect(segmentZahl(zaehler, "offen")).toBe(9);
        expect(segmentZahl(zaehler, "erledigt")).toBe(4);
        expect(segmentZahl(zaehler, "archiv")).toBe(20);
        expect(segmentZahl(zaehler, "papierkorb")).toBe(2);
    });

    it("die Legende zählt die gezeigten Zeilen je Kreis und nennt im Offenen drei Stufen", () => {
        const zeilen = [
            zeile({ nummer: "COM-000001", zustand: "neu" }),
            zeile({ nummer: "COM-000002", zustand: "neu" }),
            zeile({ nummer: "COM-000003", zustand: "in_arbeit" }),
            zeile({ nummer: "COM-000004", zustand: "rueckfrage" }),
            zeile({ nummer: "COM-000005", zustand: "abgeschlossen" }),
        ];
        expect(legendeZahlen(zeilen)).toEqual({ leer: 2, halb: 1, "halb-rechts": 1, voll: 1 });
        expect(legendeNamen("offen")).toEqual({ leer: "neu", halb: "in Arbeit", "halb-rechts": "Rückfrage" });
        expect(Object.keys(legendeNamen("erledigt"))).toEqual(["voll"]);
        expect(Object.keys(legendeNamen("archiv"))).toEqual(["voll"]);
        expect(Object.keys(legendeNamen("papierkorb"))).toHaveLength(4);
    });
});

describe("Filter (Bedienkonzept §4)", () => {
    const zeilen = [
        zeile({ nummer: "COM-000001", zustand: "neu", prioritaet: "hoch", kategorie: "lage" }),
        zeile({
            nummer: "COM-000002",
            zustand: "in_arbeit",
            zustaendig: { id: ICH, name: "Vali" },
            kategorie: "name",
        }),
        zeile({
            nummer: "COM-000003",
            zustand: "rueckfrage",
            zustaendig: { id: ANDERE, name: "Thomas" },
            kategorie: "lage",
            prioritaet: "dringend",
        }),
        zeile({ nummer: "COM-000004", zustand: "in_arbeit", kategorie: "fehlt" }),
    ];
    const nummern = (z: readonly VorgangZeile[]): string[] => z.map((x) => x.nummer);

    it("ohne Filter bleibt alles", () => {
        expect(filtere(zeilen, {}, ICH)).toHaveLength(4);
        expect(filtere(zeilen, { zustand: [], zustaendig: [] }, ICH)).toHaveLength(4);
    });

    it("Zustand, Priorität und Kategorie filtern je Wert", () => {
        expect(nummern(filtere(zeilen, { zustand: ["in_arbeit"] }, ICH))).toEqual(["COM-000002", "COM-000004"]);
        expect(nummern(filtere(zeilen, { prioritaet: ["hoch", "dringend"] }, ICH))).toEqual([
            "COM-000001",
            "COM-000003",
        ]);
        expect(nummern(filtere(zeilen, { kategorie: ["lage"] }, ICH))).toEqual(["COM-000001", "COM-000003"]);
    });

    it("🔴 „Zuständig“: mir, niemand, andere", () => {
        expect(nummern(filtere(zeilen, { zustaendig: ["mir"] }, ICH))).toEqual(["COM-000002"]);
        expect(nummern(filtere(zeilen, { zustaendig: ["niemand"] }, ICH))).toEqual(["COM-000001", "COM-000004"]);
        expect(nummern(filtere(zeilen, { zustaendig: ["andere"] }, ICH))).toEqual(["COM-000003"]);
        // Ohne Anmeldung kennt die Seite „mich“ nicht: Jede zugewiesene Zeile zählt als von anderen.
        expect(nummern(filtere(zeilen, { zustaendig: ["andere"] }, undefined))).toEqual(["COM-000002", "COM-000003"]);
        expect(filtere(zeilen, { zustaendig: ["mir"] }, undefined)).toEqual([]);
    });

    it("mehrere Abschnitte gelten zusammen, mehrere Werte eines Abschnitts einzeln (oder)", () => {
        expect(nummern(filtere(zeilen, { zustand: ["in_arbeit"], zustaendig: ["niemand"] }, ICH))).toEqual([
            "COM-000004",
        ]);
        expect(nummern(filtere(zeilen, { kategorie: ["name", "fehlt"] }, ICH))).toEqual(["COM-000002", "COM-000004"]);
    });

    it("die Zahl im Trichter zählt unter allen anderen Filtern, ohne den eigenen Abschnitt", () => {
        const wahl = { zustand: ["in_arbeit"] };
        // Der eigene Abschnitt zählt nicht mit: „neu“ hätte 1, obwohl „in Arbeit“ gewählt ist.
        expect(trefferZahl(zeilen, wahl, ICH, "zustand", "neu")).toBe(1);
        // Ein anderer Abschnitt zählt unter dem gewählten Zustand: „niemand“ gibt es in „in Arbeit“ einmal.
        expect(trefferZahl(zeilen, wahl, ICH, "zustaendig", "niemand")).toBe(1);
        expect(trefferZahl(zeilen, wahl, ICH, "zustaendig", "mir")).toBe(1);
        expect(trefferZahl(zeilen, wahl, ICH, "zustaendig", "andere")).toBe(0);
    });

    it("der Papierkorb ist ein Wert im Trichter und kein Filter der Zeilen", () => {
        expect(papierkorbAn({})).toBe(false);
        expect(papierkorbAn({ papierkorb: ["zeigen"] })).toBe(true);
        expect(papierkorbAn({ papierkorb: [] })).toBe(false);
        expect(filtere(zeilen, { papierkorb: ["zeigen"] }, ICH)).toHaveLength(4);
    });
});

describe("Sortierung (Bedienkonzept §4)", () => {
    const a = zeile({
        nummer: "COM-000001",
        eingegangenAt: "2026-10-30T10:00:00.000Z",
        aktivAt: "2026-10-31T12:00:00.000Z",
    });
    const b = zeile({
        nummer: "COM-000002",
        eingegangenAt: "2026-10-31T09:00:00.000Z",
        aktivAt: "2026-10-31T09:00:00.000Z",
        prioritaet: "hoch",
    });
    const c = zeile({
        nummer: "COM-000003",
        eingegangenAt: "2026-10-31T09:00:00.000Z",
        aktivAt: "2026-10-31T10:00:00.000Z",
        prioritaet: "dringend",
    });
    const nummern = (z: readonly VorgangZeile[]): string[] => z.map((x) => x.nummer);

    it("neueste oder älteste zuerst; bei gleicher Zeit entscheidet die Nummer, damit die Folge fest ist", () => {
        expect(nummern(sortiere([a, b, c], "neu"))).toEqual(["COM-000003", "COM-000002", "COM-000001"]);
        expect(nummern(sortiere([a, b, c], "alt"))).toEqual(["COM-000001", "COM-000002", "COM-000003"]);
    });

    it("letzte Aktivität und Priorität", () => {
        expect(nummern(sortiere([a, b, c], "aktiv"))).toEqual(["COM-000001", "COM-000003", "COM-000002"]);
        expect(nummern(sortiere([a, b, c], "prioritaet"))).toEqual(["COM-000003", "COM-000002", "COM-000001"]);
    });

    it("die Antwort des Servers bleibt, wie sie kam", () => {
        const eingang = [a, b, c];
        sortiere(eingang, "alt");
        expect(nummern(eingang)).toEqual(["COM-000001", "COM-000002", "COM-000003"]);
    });
});

describe("Handgriffe und ihre Sperrgründe (Bedienkonzept §2.2 bis §2.6)", () => {
    it("ein neuer Vorgang: Übernehmen, Sichten und Abschließen; kein Wiedereröffnen", () => {
        const g = handgriffe(lageVon(detail(zeile())), reviewer, ICH);
        expect(g.uebernehmen.zeigen).toBe(true);
        expect(g.sichten.zeigen).toBe(true);
        expect(g.abschliessen.zeigen).toBe(true);
        expect(g.wiedereroeffnen.zeigen).toBe(false);
        expect(g.archivieren.zeigen).toBe(false);
    });

    it("🔴 wer schon zuständig ist, übernimmt nicht noch einmal; „Sichten“ gibt es nur bei neu", () => {
        const g = handgriffe(
            lageVon(detail(zeile({ zustand: "in_arbeit", zustaendig: { id: ICH, name: "Vali" } }))),
            reviewer,
            ICH,
        );
        expect(g.uebernehmen.zeigen).toBe(false);
        expect(g.sichten.zeigen).toBe(false);
        expect(g.abschliessen.zeigen).toBe(true);
        // Ein anderer darf ihn übernehmen.
        expect(
            handgriffe(
                lageVon(detail(zeile({ zustand: "in_arbeit", zustaendig: { id: ANDERE, name: "Thomas" } }))),
                reviewer,
                ICH,
            ).uebernehmen.zeigen,
        ).toBe(true);
    });

    it("ein abgeschlossener Vorgang: Wiedereröffnen und Ins Archiv, kein Abschließen; nach außen schreiben geht nicht", () => {
        const g = handgriffe(
            lageVon(detail(zeile({ zustand: "abgeschlossen", ergebnis: "umgesetzt" }))),
            reviewer,
            ICH,
        );
        expect(g.abschliessen.zeigen).toBe(false);
        expect(g.wiedereroeffnen.zeigen).toBe(true);
        expect(g.archivieren.zeigen).toBe(true);
        expect(g.uebernehmen.zeigen).toBe(false);
        expect(g.anMelder.grund).toBe("community.redaktion.grund.abgeschlossen");
        // Eine Notiz geht trotzdem.
        expect(g.notiz).toEqual({ zeigen: true });
        // Im Archiv ist „Ins Archiv“ erledigt.
        const archiviert = handgriffe(
            lageVon(detail(zeile({ zustand: "abgeschlossen" }), { archiviertAt: "2026-10-31T10:00:00.000Z" })),
            reviewer,
            ICH,
        );
        expect(archiviert.archivieren.zeigen).toBe(false);
        expect(archiviert.wiedereroeffnen.zeigen).toBe(true);
    });

    it("🔴 „An Melder“ ist gesperrt, wenn es keinen Rückweg gibt: „Kein Rückweg zum Melder“", () => {
        const ohne = detail(zeile(), { melder: { name: null, rueckwege: [], entfernt: false } });
        expect(handgriffe(lageVon(ohne), reviewer, ICH).anMelder.grund).toBe("community.redaktion.grund.keinRueckweg");
        expect(handgriffe(lageVon(detail(zeile())), reviewer, ICH).anMelder.grund).toBeUndefined();
    });

    it("🔴 Papierkorb, Wiederherstellen und Personenbezug löschen brauchen `moderate_community`, sonst gesperrt mit Grund", () => {
        const normal = handgriffe(lageVon(detail(zeile())), reviewer, ICH);
        expect(normal.papierkorb).toEqual({ zeigen: true, grund: "community.redaktion.grund.moderieren" });
        expect(normal.personenbezug.grund).toBe("community.redaktion.grund.moderieren");
        const moderiert = handgriffe(lageVon(detail(zeile())), admin, ICH);
        expect(moderiert.papierkorb).toEqual({ zeigen: true });
        expect(moderiert.personenbezug).toEqual({ zeigen: true });
        // Im Papierkorb: Wiederherstellen statt Papierkorb, ohne „An Melder“.
        const korb = handgriffe(lageVon(detail(zeile(), { papierkorbAt: "2026-10-31T10:00:00.000Z" })), admin, ICH);
        expect(korb.papierkorb.zeigen).toBe(false);
        expect(korb.wiederherstellen).toEqual({ zeigen: true });
        expect(korb.abschliessen.zeigen).toBe(false);
        expect(korb.anMelder.grund).toBe("community.redaktion.grund.imPapierkorb");
        // Nach dem Löschen des Personenbezugs gibt es nichts mehr zu löschen.
        const geloescht = detail(zeile(), { melder: { name: null, rueckwege: [], entfernt: true } });
        expect(handgriffe(lageVon(geloescht), admin, ICH).personenbezug.zeigen).toBe(false);
    });

    it("⚙ im Editor: nur an einem Objekt, mit dem Recht Editor, sonst gesperrt mit Grund", () => {
        expect(handgriffe(lageVon(detail(zeile())), reviewer, ICH).editor.grund).toBe(
            "community.redaktion.grund.editorRecht",
        );
        expect(
            handgriffe(
                lageVon(detail(zeile())),
                [...reviewer, "edit_map_objects", "edit_territories", "edit_landscapes"],
                ICH,
            ).editor,
        ).toEqual({
            zeigen: true,
        });
        const stelle = detail(zeile({ bezugArt: "stelle" }), {
            bezug: { ...detail(zeile()).bezug!, art: "stelle", objektArt: null, objektId: null },
        });
        expect(handgriffe(lageVon(stelle), admin, ICH).editor.zeigen).toBe(false);
        const ohneKennung = detail(zeile(), { bezug: { ...detail(zeile()).bezug!, objektId: null } });
        expect(
            handgriffe(lageVon(ohneKennung), [...admin, "edit_map_objects", "edit_territories", "edit_landscapes"], ICH)
                .editor.grund,
        ).toBe("community.redaktion.grund.keinEditor");
    });

    it("Priorität und Zuständig lassen sich nur an Offenem ändern", () => {
        expect(stehtOffen(lageVon(detail(zeile())))).toBe(true);
        expect(stehtOffen(lageVon(detail(zeile({ zustand: "abgeschlossen" }))))).toBe(false);
        expect(stehtOffen(lageVon(detail(zeile(), { papierkorbAt: "2026-10-31T10:00:00.000Z" })))).toBe(false);
    });

    it("🔴 das Menü „Zuständig“: jeder darf jeden einsetzen und jede Zuständigkeit leeren (WI-0279, Vali 2026-11-11)", () => {
        const personen = [
            { id: ICH, name: "Vali" },
            { id: ANDERE, name: "Thomas" },
        ];
        const wahl = zustaendigWahlen(personen, null, ICH);
        expect(wahl.map((w) => w.person?.name ?? null)).toEqual(["Vali", "Thomas", null]);
        // Kein Eintrag ist gesperrt, auch nicht für eine Reviewerin ohne `moderate_community`.
        for (const w of wahl) expect(Object.keys(w).sort()).toEqual(["aktiv", "person"]);
        // Wer an der Stelle Ansprechperson ist, steht hinter „mir“ oben (WI-0279 E3c); ein Recht entsteht dadurch nicht.
        const DRITTE = "33333333-3333-4333-8333-333333333333";
        const mitRegion = zustaendigWahlen([...personen, { id: DRITTE, name: "Alrik" }], null, ICH, new Set([DRITTE]));
        expect(mitRegion.map((w) => w.person?.name ?? null)).toEqual(["Vali", "Alrik", "Thomas", null]);
        const fremd = zustaendigWahlen(personen, { id: ANDERE, name: "Thomas" }, ICH);
        expect(fremd[1]?.aktiv).toBe(true);
        expect(fremd.at(-1)).toEqual({ person: null, aktiv: false });
    });

    it("🔴 Meine | Alle (WI-0279): mein ist, was der Server so nennt; ohne das Feld nur die eigene Person", () => {
        expect(istMeine(zeile({ mein: true }), ICH)).toBe(true);
        expect(istMeine(zeile({ mein: false, zustaendig: { id: ICH, name: "Vali" } }), ICH)).toBe(false);
        expect(istMeine(zeile({ zustaendig: { id: ICH, name: "Vali" } }), ICH)).toBe(true);
        expect(istMeine(zeile({ zustaendig: { id: ANDERE, name: "Thomas" } }), ICH)).toBe(false);
        expect(LISTEN_REITER).toEqual(["meine", "alle"]);
    });

    it("🔴 Trichter „Sonderrolle“: nur Rollen der Liste, im Katalog geordnet, mit Anzahl; eine Zeile mit Rolle ist nicht „niemand“", () => {
        const zeilen = [
            zeile({ nummer: "COM-000001", rollen: [{ sonderrolle: "topograph", mein: false }] }),
            zeile({
                nummer: "COM-000002",
                rollen: [
                    { sonderrolle: "odologe", mein: true },
                    { sonderrolle: "derograph", mein: false },
                ],
            }),
            zeile({ nummer: "COM-000003" }),
        ];
        expect(sonderrollenImTrichter(zeilen, [])).toEqual(["derograph", "odologe", "topograph"]);
        // Eine gewählte Rolle bleibt stehen, damit sie sich abwählen lässt.
        expect(sonderrollenImTrichter(zeilen.slice(2), ["linguist"])).toEqual(["linguist"]);
        expect(filtere(zeilen, { sonderrolle: ["derograph", "topograph"] }, ICH).map((z) => z.nummer)).toEqual([
            "COM-000001",
            "COM-000002",
        ]);
        expect(trefferZahl(zeilen, {}, ICH, "sonderrolle", "odologe")).toBe(1);
        expect(filtere(zeilen, { zustaendig: ["niemand"] }, ICH).map((z) => z.nummer)).toEqual(["COM-000003"]);
    });

    it("🔴 Unterzeile (WI-0279): Person und Rollen mit Komma, der eigene Teil markiert; ohne beides „niemand zuständig“", () => {
        const mit = unterzeileTeile(
            zeile({
                zustaendig: { id: ICH, name: "Vali" },
                rollen: [
                    { sonderrolle: "derograph", mein: false },
                    { sonderrolle: "topograph", mein: true },
                ],
            }),
            ICH,
        );
        expect(mit.map((teil) => teil.text).join("")).toMatch(/· Vali, Derograph, Topograph$/u);
        expect(mit.filter((teil) => teil.mein).map((teil) => teil.text)).toEqual(["Vali", "Topograph"]);
        const ohne = unterzeileTeile(zeile(), ICH);
        expect(ohne).toHaveLength(1);
        expect(ohne[0]?.text).toMatch(/· niemand zuständig$/u);
        expect(ohne[0]?.mein).toBe(false);
    });

    it("🔴 Kasten „Zuständig“ und Blatt (WI-0279): Person mit Absender, je Rolle Inhaber und Absender; das Blatt nennt, wer neu die Glocke hört", () => {
        const d = detail(zeile({ zustaendig: { id: ANDERE, name: "Thomas" } }), {
            zustaendigSeit: { von: { id: ICH, name: "Vali" }, at: "2026-11-11T08:00:00.000Z" },
            rollen: [
                {
                    sonderrolle: "ortskundiger",
                    von: { art: "system", person: null },
                    at: "2026-11-11T08:00:00.000Z",
                    inhaber: [{ id: ICH, name: "Vali" }],
                    regionen: ["Weiden"],
                },
                {
                    sonderrolle: "derograph",
                    von: { art: "person", person: null },
                    at: "2026-11-11T08:00:00.000Z",
                    inhaber: [],
                    regionen: [],
                },
            ],
            rollenInhaber: [
                { sonderrolle: "derograph", personen: [] },
                {
                    sonderrolle: "topograph",
                    personen: [
                        { id: ANDERE, name: "Thomas" },
                        { id: ICH, name: "Vali" },
                    ],
                },
                { sonderrolle: "ortskundiger", personen: [{ id: ICH, name: "Vali" }] },
            ],
        });
        const kasten = zustaendigZeilen(d, ICH, new Date("2026-11-11T10:00:00.000Z"));
        expect(kasten.map((z) => [z.art, z.titel, z.mein])).toEqual([
            ["person", "Thomas", false],
            ["rolle", "Ortskundiger (Weiden)", true],
            ["rolle", "Derograph", false],
        ]);
        expect(kasten[0]?.von).toMatch(/^zugewiesen von Vali, /u);
        expect(kasten[1]?.von).toMatch(/^zugewiesen von Avesmaps beim Eingang, /u);
        expect(kasten[2]?.inhaber).toEqual([]);
        expect(kasten[2]?.von).toMatch(/^zugewiesen von jemand, /u);
        // Ohne Person und Rolle: kein Kasten.
        expect(zustaendigZeilen(detail(zeile()), ICH)).toEqual([]);
        // Das Blatt: zwölf Rollen; Topograph neu gewählt, Thomas hört die Glocke, ich nicht.
        expect(rollenBlattZeilen(d)).toHaveLength(12);
        expect(rollenGeaendert(d, ["ortskundiger", "derograph"])).toBe(false);
        expect(rollenGeaendert(d, ["ortskundiger", "derograph", "topograph"])).toBe(true);
        expect(rollenBlattFolge(d, ["ortskundiger", "derograph", "topograph"], ICH)).toBe("Neu in der Glocke: Thomas.");
        expect(rollenBlattFolge(d, ["ortskundiger"], ICH)).toBe(
            "Wer eine gewählte Rolle hat, sieht die Meldung unter „Meine“.",
        );
    });

    it("🔴 Verlauf der Sonderrollen: eine Zeile je Änderung, beim Eingang von Avesmaps", () => {
        const at = "2026-11-11T08:00:00.000Z";
        const ereignis = (
            art: string,
            alt: string | null,
            neu: string | null,
            von: { id: string; name: string } | null,
        ) => ({
            art: "ereignis" as const,
            ereignis: art,
            alt,
            neu,
            text: null,
            von,
            vomMelder: false,
            at,
        });
        const zeilen = verlaufZeilen(
            [
                ereignis("rollen_eingang", null, "odologe,derograph", null),
                ereignis("rollen", "odologe", "topograph", { id: ICH, name: "Vali" }),
            ],
            () => undefined,
        );
        expect(zeilen.map((z) => (z.art === "ereignis" ? z.satz : ""))).toEqual([
            "Derograph und Odologe beim Eingang zugewiesen · Avesmaps",
            "Topograph zugewiesen · Vali",
            "Odologe herausgenommen · Vali",
        ]);
    });
});

describe("Abschließen (Bedienkonzept §2.5, Fachkonzept §4.3)", () => {
    it("🔴 vorgewählt „umgesetzt“; der Haken „Nachricht an den Melder“ steht, wenn ein Rückweg da ist, mit vorbelegtem Text", () => {
        const mit = neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, ["statusseite"]);
        expect(mit.ergebnis).toBe("umgesetzt");
        expect(mit.nachrichtSenden).toBe(true);
        expect(mit.nachricht).toBe(abschlussNachricht("umgesetzt"));
        expect(mit.nachricht).toContain("Danke für die Meldung");
        const ohne = neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, []);
        expect(ohne.nachrichtSenden).toBe(false);
    });

    it("das Ergebnis tauscht den vorbelegten Text, nie einen selbst geschriebenen", () => {
        const start = neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, ["statusseite"]);
        const abgelehnt = mitErgebnis(start, "abgelehnt");
        expect(abgelehnt.nachricht).toBe(abschlussNachricht("abgelehnt"));
        const geschrieben = mitErgebnis({ ...start, nachricht: "Mein eigener Text." }, "abgelehnt");
        expect(geschrieben.nachricht).toBe("Mein eigener Text.");
    });

    it("🔴 die Begründung ist Pflicht: ohne sie ist Abschließen gesperrt, mit Grund", () => {
        const start = neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, ["statusseite"]);
        expect(abschlussSperre(start, "COM-000123")).toBe("community.redaktion.grund.begruendung");
        expect(abschlussSperre({ ...start, begruendung: "   " }, "COM-000123")).toBe(
            "community.redaktion.grund.begruendung",
        );
        expect(abschlussSperre({ ...start, begruendung: "Ort verschoben." }, "COM-000123")).toBeUndefined();
        // Ist die Nachricht an den Melder gesetzt, aber leer, fehlt ihr Text.
        expect(abschlussSperre({ ...start, begruendung: "Ort.", nachricht: " " }, "COM-000123")).toBe(
            "community.redaktion.grund.nachrichtLeer",
        );
        expect(
            abschlussSperre({ ...start, begruendung: "Ort.", nachricht: "", nachrichtSenden: false }, "COM-000123"),
        ).toBeUndefined();
    });

    it("🔴 bei einer Dublette ist die Nummer des anderen Vorgangs Pflicht, und nicht die eigene", () => {
        const start = mitErgebnis(neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, ["statusseite"]), "dublette");
        const mitGrund = { ...start, begruendung: "Doppelt." };
        expect(abschlussSperre(mitGrund, "COM-000123")).toBe("community.redaktion.grund.dubletteNummer");
        expect(abschlussSperre({ ...mitGrund, dubletteVon: "COM-000123" }, "COM-000123")).toBe(
            "community.redaktion.grund.dubletteSelbst",
        );
        expect(abschlussSperre({ ...mitGrund, dubletteVon: "117" }, "COM-000123")).toBeUndefined();
    });

    it("die Nummer der Dublette belegt Begründung und Nachricht vor, ohne Eigenes zu überschreiben", () => {
        const start = mitErgebnis(neuerAbschluss("meldung", ABSCHLUSS_ERGEBNISSE.meldung, ["statusseite"]), "dublette");
        const mit = mitDublette(start, "117");
        expect(mit.begruendung).toBe("Dublette von COM-000117");
        expect(mit.nachricht).toContain("COM-000117");
        // Ändert sich die Nummer, folgt die vorbelegte Begründung.
        expect(mitDublette(mit, "COM-000118").begruendung).toBe("Dublette von COM-000118");
        // Eine selbst geschriebene Begründung bleibt.
        expect(mitDublette({ ...mit, begruendung: "Genau dasselbe." }, "COM-000118").begruendung).toBe(
            "Genau dasselbe.",
        );
    });

    it("Anfragen schließen mit anderen Ergebnissen als Meldungen (Vertrag)", () => {
        expect(ABSCHLUSS_ERGEBNISSE.meldung).toEqual([
            "umgesetzt",
            "bereits_richtig",
            "abgelehnt",
            "dublette",
            "weitergereicht",
        ]);
        expect(neuerAbschluss("anfrage", ABSCHLUSS_ERGEBNISSE.anfrage, []).ergebnis).toBe("beantwortet");
    });
});

describe("Der Verlauf in Alltagssprache (Bedienkonzept §2.2 Nr. 4)", () => {
    const vali = { id: ICH, name: "Vali" };
    const verlauf: VerlaufEintrag[] = [
        {
            art: "ereignis",
            ereignis: "eingang",
            alt: null,
            neu: "neu",
            text: null,
            von: null,
            vomMelder: true,
            at: "2026-10-31T10:00:00.000Z",
        },
        {
            art: "nachricht",
            richtung: "ein",
            weg: "website",
            text: "Wehrheim liegt falsch.",
            von: null,
            at: "2026-10-31T10:00:00.000Z",
        },
        {
            art: "ereignis",
            ereignis: "uebernommen",
            alt: null,
            neu: ICH,
            text: null,
            von: vali,
            vomMelder: false,
            at: "2026-10-31T10:05:00.000Z",
        },
        { art: "notiz", text: "Quelle fehlt noch.", von: vali, at: "2026-10-31T10:06:00.000Z" },
        {
            art: "ereignis",
            ereignis: "zustaendig",
            alt: ICH,
            neu: ANDERE,
            text: null,
            von: vali,
            vomMelder: false,
            at: "2026-10-31T10:07:00.000Z",
        },
        {
            art: "ereignis",
            ereignis: "prioritaet",
            alt: "normal",
            neu: "hoch",
            text: null,
            von: vali,
            vomMelder: false,
            at: "2026-10-31T10:08:00.000Z",
        },
        {
            art: "ereignis",
            ereignis: "rueckfrage",
            alt: "in_arbeit",
            neu: "rueckfrage",
            text: null,
            von: vali,
            vomMelder: false,
            at: "2026-10-31T10:09:00.000Z",
        },
        {
            art: "nachricht",
            richtung: "aus",
            weg: "statusseite",
            text: "Gibt es eine Quelle?",
            von: vali,
            at: "2026-10-31T10:09:00.000Z",
        },
        {
            art: "ereignis",
            ereignis: "wiedereroeffnet",
            alt: "rueckfrage",
            neu: "in_arbeit",
            text: "durch Antwort wieder geöffnet",
            von: null,
            vomMelder: true,
            at: "2026-10-31T10:30:00.000Z",
        },
        {
            art: "ereignis",
            ereignis: "abgeschlossen",
            alt: "in_arbeit",
            neu: "umgesetzt",
            text: "Ort verschoben.",
            von: vali,
            vomMelder: false,
            at: "2026-10-31T11:00:00.000Z",
        },
        {
            art: "ereignis",
            ereignis: "wiedereroeffnet",
            alt: "umgesetzt",
            neu: "in_arbeit",
            text: "Doch falsch.",
            von: vali,
            vomMelder: false,
            at: "2026-10-31T12:00:00.000Z",
        },
    ];
    const name = personenName([vali, { id: ANDERE, name: "Thomas" }]);
    const zeilen = verlaufZeilen(verlauf, name);

    it("🔴 Nachrichten, Notizen und Ereignisse stehen in der Folge des Servers; der Eingang fehlt, denn die Meldung steht selbst da", () => {
        expect(zeilen.map((z) => z.art)).toEqual([
            "nachricht",
            "ereignis",
            "notiz",
            "ereignis",
            "ereignis",
            "ereignis",
            "nachricht",
            "ereignis",
            "ereignis",
            "ereignis",
        ]);
    });

    it("Ereignisse als kurze Zeilen mit dem Namen dahinter", () => {
        const sätze = zeilen.flatMap((z) => (z.art === "ereignis" ? [z.satz] : []));
        expect(sätze).toEqual([
            "übernommen · Vali",
            "zuständig: Thomas · Vali",
            "Priorität: hoch · Vali",
            "Rückfrage gesendet · Vali",
            "durch Antwort wieder geöffnet",
            "abgeschlossen: Umgesetzt · Vali",
            "wieder geöffnet · Vali",
        ]);
    });

    it("🔴 die Begründung und der Grund stehen unter ihrem Ereignis; die feste Zeile des Servers bei der Antwort des Melders nicht", () => {
        const texte = zeilen.flatMap((z) => (z.art === "ereignis" ? [z.text] : []));
        expect(texte).toEqual([
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            "Ort verschoben.",
            "Doch falsch.",
        ]);
    });

    it("Notizen und Nachrichten tragen, von wem sie sind und wohin sie gehen", () => {
        const notiz = zeilen.find((z) => z.art === "notiz");
        expect(notiz).toMatchObject({ text: "Quelle fehlt noch.", von: "Vali" });
        const aus = zeilen.find((z) => z.art === "nachricht" && z.richtung === "aus");
        expect(aus).toMatchObject({ text: "Gibt es eine Quelle?", von: "Vali", weg: "statusseite" });
        const ein = zeilen.find((z) => z.art === "nachricht" && z.richtung === "ein");
        expect(ein).toMatchObject({ von: undefined });
    });

    it("eine unbekannte Person in der Zuständigkeit bleibt „jemand“", () => {
        const fremd = verlaufZeilen(
            [
                {
                    art: "ereignis",
                    ereignis: "zustaendig",
                    alt: null,
                    neu: "unbekannt",
                    text: null,
                    von: null,
                    vomMelder: false,
                    at: "2026-10-31T10:00:00.000Z",
                },
            ],
            name,
        );
        expect(fremd[0]).toMatchObject({ satz: "zuständig: jemand" });
        const leer = verlaufZeilen(
            [
                {
                    art: "ereignis",
                    ereignis: "zustaendig",
                    alt: ICH,
                    neu: null,
                    text: null,
                    von: vali,
                    vomMelder: false,
                    at: "2026-10-31T10:00:00.000Z",
                },
            ],
            name,
        );
        expect(leer[0]).toMatchObject({ satz: "Zuständigkeit geleert · Vali" });
    });
});

describe("Die Schritte an der Leitung (`redaktion-api.ts`)", () => {
    const antwort = (status: number, body: unknown): typeof fetch =>
        (async () =>
            new Response(JSON.stringify(body), {
                status,
                headers: { "content-type": "application/json" },
            })) as typeof fetch;

    it("die Liste fragt Segment und Art, schneidet die Suche zu und lässt eine leere weg", async () => {
        const urls: string[] = [];
        const fetcher = (async (url: string) => {
            urls.push(url);
            return new Response(JSON.stringify({ zeilen: [], zaehler: {} }), { status: 200 });
        }) as unknown as typeof fetch;
        await ladeListe({ segment: "offen" }, fetcher);
        await ladeListe({ segment: "papierkorb", q: "  Wehr heim  " }, fetcher);
        await ladeListe({ segment: "archiv", q: "   " }, fetcher);
        expect(urls[0]).toBe("/api/community/vorgaenge?segment=offen&art=meldung");
        expect(urls[1]).toBe("/api/community/vorgaenge?segment=papierkorb&art=meldung&q=Wehr+heim");
        expect(urls[2]).toBe("/api/community/vorgaenge?segment=archiv&art=meldung");
    });

    it("🔴 ein Schritt trägt Kennung und Revision; eine Wiederholung nach einem Netzfehler dieselbe Kennung", async () => {
        const gesendet: { url: string; body: Record<string, unknown> }[] = [];
        let versuch = 0;
        const fetcher = (async (url: string, init: RequestInit) => {
            gesendet.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
            versuch += 1;
            if (versuch === 1) throw new TypeError("Netz weg");
            return new Response(JSON.stringify({ nummer: "COM-000123", revision: 4 }), { status: 200 });
        }) as unknown as typeof fetch;
        kennungFrei("COM-000123", "sichten");
        await expect(fuehreAus("COM-000123", "sichten", { baseRevision: 3 }, { fetcher })).rejects.toBeInstanceOf(
            ApiFailure,
        );
        const erste = kennung("COM-000123", "sichten");
        await fuehreAus("COM-000123", "sichten", { baseRevision: 3 }, { fetcher });
        expect(gesendet).toHaveLength(2);
        expect(gesendet[0]?.url).toBe("/api/community/vorgaenge/COM-000123/sichten");
        expect(gesendet[1]?.body["operationId"]).toBe(gesendet[0]?.body["operationId"]);
        expect(gesendet[0]?.body["operationId"]).toBe(erste);
        expect(gesendet[1]?.body["baseRevision"]).toBe(3);
        // Nach dem Gelingen bekommt die nächste Handlung eine neue Kennung.
        expect(kennung("COM-000123", "sichten")).not.toBe(erste);
        kennungFrei("COM-000123", "sichten");
    });

    it("eine Ablehnung des Servers gibt die Kennung frei: Die nächste Handlung ist eine neue", async () => {
        const fehler = { error: { code: "community_conflict", message: "x" } };
        kennungFrei("COM-000124", "uebernehmen");
        const vorher = kennung("COM-000124", "uebernehmen");
        await expect(
            fuehreAus("COM-000124", "uebernehmen", { baseRevision: 1 }, { fetcher: antwort(409, fehler) }),
        ).rejects.toMatchObject({ code: "community_conflict" });
        expect(kennung("COM-000124", "uebernehmen")).not.toBe(vorher);
        kennungFrei("COM-000124", "uebernehmen");
    });

    it("Notizen tragen keine Revision, Schritte mit Revision schon", async () => {
        const bodies: Record<string, unknown>[] = [];
        const fetcher = (async (_url: string, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
            return new Response(JSON.stringify({ nummer: "COM-000125", revision: 2 }), { status: 200 });
        }) as unknown as typeof fetch;
        const alt = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            await schreibeNotiz("COM-000125", "Quelle fehlt.");
            await sichten("COM-000125", 7);
        } finally {
            globalThis.fetch = alt;
        }
        expect(bodies[0]).toMatchObject({ text: "Quelle fehlt." });
        expect(bodies[0]).not.toHaveProperty("baseRevision");
        expect(bodies[1]).toMatchObject({ baseRevision: 7 });
    });

    it("🔴 die Fehler werden Fachcodes: Konflikt, Übergang, fehlendes Recht, Netz", () => {
        expect(redaktionFehler(new ApiFailure(409, "community_conflict", "x"))).toBe("konflikt");
        expect(redaktionFehler(new ApiFailure(409, "community_transition", "x"))).toBe("uebergang");
        expect(redaktionFehler(new ApiFailure(403, "community_forbidden", "x"))).toBe("verboten");
        expect(redaktionFehler(new ApiFailure(403, "forbidden", "x"))).toBe("verboten");
        expect(redaktionFehler(new ApiFailure(0, "network", "x"))).toBe("netz");
        expect(redaktionFehler(new ApiFailure(404, "community_not_found", "x"))).toBe("nicht_gefunden");
        expect(redaktionFehler(new ApiFailure(503, "community_unavailable", "x"))).toBe("nicht_moeglich");
        expect(redaktionFehler(new Error("irgendwas"))).toBe("sonst");
    });
});

describe("Das Fenster eines Vorgangs in der Fensterverwaltung (`redaktion.ts`)", () => {
    const naht = (fenster = createWerkzeugfenster(undefined)) => {
        const gezeigt: VorgangBezug[] = [];
        const reiter = { meldungen: 0 };
        const steuerung = createRedaktion();
        steuerung.verbinde({
            fenster,
            zeigeMeldungen: () => void (reiter.meldungen += 1),
            zeige: (bezug) => gezeigt.push(bezug),
            oeffneImEditor: () => undefined,
        });
        return { fenster, steuerung, gezeigt, reiter };
    };

    it("🔴 ein Vorgang öffnet als Werkzeugfenster, angedockt, mit der COM-Nummer als Gegenstand", () => {
        const { fenster, steuerung } = naht();
        const id = steuerung.oeffne("COM-000123", "COM-000123 · Lage falsch");
        const eintrag = fenster.stand.value.fenster.find((x) => x.id === id);
        expect(eintrag).toMatchObject({
            werkzeug: VORGANG_WERKZEUG,
            gegenstand: "COM-000123",
            lage: "angedockt",
            titel: "COM-000123 · Lage falsch",
        });
        expect(steuerung.vorgangFenster.value).toHaveLength(1);
    });

    it("🔴 ein zweiter Vorgang ersetzt den ersten im selben Fenster, mit derselben Lage", () => {
        const { fenster, steuerung } = naht();
        const erste = steuerung.oeffne("COM-000123", "COM-000123 · Lage falsch");
        fenster.setzeLage(erste!, "geloest", { left: 40, top: 60, width: 520, height: 400 });
        const zweite = steuerung.oeffne("COM-000124", "COM-000124 · Etwas fehlt");
        expect(zweite).toBe(erste);
        expect(steuerung.vorgangFenster.value).toHaveLength(1);
        expect(steuerung.vorgangFenster.value[0]).toMatchObject({
            gegenstand: "COM-000124",
            lage: "geloest",
            box: { left: 40, top: 60, width: 520, height: 400 },
        });
    });

    it("🔴 trägt das erste eine Eingabe, geht sie nicht verloren: Es wird abgelegt, der zweite öffnet daneben", () => {
        const { fenster, steuerung } = naht();
        const erste = steuerung.oeffne("COM-000123", "COM-000123 · Lage falsch")!;
        fenster.markiere(erste, { ungespeichert: true });
        const zweite = steuerung.oeffne("COM-000124", "COM-000124 · Etwas fehlt")!;
        expect(zweite).not.toBe(erste);
        const alt = fenster.stand.value.fenster.find((x) => x.id === erste);
        expect(alt).toMatchObject({ lage: "versenkt", gegenstand: "COM-000123", ungespeichert: true });
        expect(fenster.abgelegt.value.map((x) => x.id)).toEqual([erste]);
        expect(steuerung.vorgangFenster.value).toHaveLength(2);
    });

    it("derselbe Vorgang noch einmal öffnet kein zweites Fenster, sondern holt das vorhandene hervor", () => {
        const { fenster, steuerung } = naht();
        const erste = steuerung.oeffne("COM-000123", "COM-000123 · Lage falsch")!;
        fenster.setzeLage(erste, "versenkt");
        const wieder = steuerung.oeffne("COM-000123", "COM-000123 · Lage falsch");
        expect(wieder).toBe(erste);
        expect(steuerung.vorgangFenster.value).toHaveLength(1);
        expect(steuerung.vorgangFenster.value[0]?.lage).toBe("angedockt");
    });

    it("ohne Verbindung zur Seite öffnet nichts", () => {
        const steuerung = createRedaktion();
        expect(steuerung.verbunden.value).toBe(false);
        expect(steuerung.oeffne("COM-000123", "x")).toBeUndefined();
        expect(steuerung.oeffneMeldung("COM-000123")).toBe(false);
    });

    it("🔴 der Klick in der Glocke zeigt Community › Meldungen und öffnet den Vorgang; ohne Nummer bleibt es bei der Liste, die neu lädt", () => {
        const { fenster, steuerung, reiter } = naht();
        const vorher = steuerung.listeVersion.value;
        expect(steuerung.oeffneMeldung("COM-000123")).toBe(true);
        expect(reiter.meldungen).toBe(1);
        expect(steuerung.listeVersion.value).toBe(vorher + 1);
        expect(fenster.stand.value.fenster).toHaveLength(1);
        expect(steuerung.vorgangFenster.value[0]).toMatchObject({
            werkzeug: VORGANG_WERKZEUG,
            gegenstand: "COM-000123",
        });
        // „3 neue Meldungen“ führt nur in die Liste: kein zweites Fenster, der Reiter ist wieder vorn.
        expect(steuerung.oeffneMeldung(null)).toBe(true);
        expect(reiter.meldungen).toBe(2);
        expect(steuerung.listeVersion.value).toBe(vorher + 2);
        expect(steuerung.vorgangFenster.value).toHaveLength(1);
    });

    it("die Liste lädt neu, wenn sich etwas ändert", () => {
        const { steuerung } = naht();
        const vorher = steuerung.listeVersion.value;
        steuerung.geaendert();
        expect(steuerung.listeVersion.value).toBe(vorher + 1);
    });

    it("🔴 der Geist: neue Lage mit der alten dahinter; ohne Vorschlag keiner", () => {
        const bezug: VorgangBezug = {
            art: "objekt",
            objektArt: "place",
            objektId: "33333333-3333-4333-8333-333333333333",
            name: "Wehrheim",
            typ: null,
            lage: { x: 10, y: 20 },
            vorschlagLage: { x: 30, y: 40 },
            naechsterOrt: null,
        };
        expect(vorschlagVon(bezug)).toEqual({ neu: { x: 30, y: 40 }, alt: { x: 10, y: 20 } });
        expect(vorschlagVon({ ...bezug, lage: null })).toEqual({ neu: { x: 30, y: 40 } });
        expect(vorschlagVon({ ...bezug, vorschlagLage: null })).toBeUndefined();
        expect(vorschlagVon(null)).toBeUndefined();
    });
});
