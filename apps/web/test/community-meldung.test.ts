import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    BEZUG_OBJEKTARTEN,
    COMMUNITY_GRENZEN,
    FEHLT_ARTEN,
    FEHLT_ARTEN_FORMULAR,
    MELDUNG_KATEGORIEN,
    MeldungBody,
} from "@avesmaps3d/shared";
import { neuesFormular } from "../src/community/api.ts";
import { createBesucherSteuerung, ortAusAntwort } from "../src/community/community-besucher.ts";
import {
    betrifftLage,
    betrifftName,
    betrifftObjekt,
    drahtBezug,
    drahtBody,
    FEHLT_ZEICHEN,
    KATEGORIE_ZEICHEN,
    leererEntwurf,
    OBJEKT_ZEICHEN,
    sperrFeld,
    sperrGrund,
    startBetrifft,
    type BezugOrt,
    type MeldeBezug,
    type MeldeEntwurf,
} from "../src/community/meldung-modell.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";

/**
 * Das Meldeformular ohne Browser (WI-0268 C2; Bedienkonzept §2.1, §2.1a): Bezug, Pflichtfelder samt Grund der Sperre, der Rumpf der Anfrage, und die Steuerung, die EIN Fenster
 * der Besucher hält. Der Rumpf wird gegen das Schema des Servers geprüft (`MeldungBody`): Was hier gebaut wird, nimmt die Route an.
 */

const GARETH_ID = "00000000-0000-4000-8000-000000000001";
const ORT: BezugOrt = { id: GARETH_ID, name: "Wehrheim", typ: "dorf", lage: { x: 551.6256, y: 532.9694 } };
const OBJEKT: MeldeBezug = {
    art: "objekt",
    objektArt: "place",
    objektId: GARETH_ID,
    name: "Wehrheim",
    typ: "dorf",
    lage: { x: 551.6256, y: 532.9694 },
};
const STELLE: MeldeBezug = { art: "stelle", lage: { x: 560.123, y: 540.456 } };
const STELLE_MIT_ORT: MeldeBezug = { ...STELLE, ort: ORT };

const entwurf = (teil: Partial<MeldeEntwurf> = {}): MeldeEntwurf => ({
    kategorie: "fehlt",
    fehltArt: "ort",
    text: "Hier liegt ein Dorf am Fluss.",
    quelle: "",
    name: "",
    honig: "",
    ...teil,
});

describe("der Anfang des Formulars", () => {
    it("🔴 an einer Stelle ist „Etwas fehlt“ vorbelegt, an einem Objekt wählt der Besucher selbst (§2.1a)", () => {
        expect(leererEntwurf(STELLE).kategorie).toBe("fehlt");
        expect(leererEntwurf(OBJEKT).kategorie).toBe("");
        expect(startBetrifft(STELLE)).toBe("stelle");
        expect(startBetrifft(OBJEKT)).toBe("objekt");
    });

    it("das Honigtopf-Feld und alle Texte beginnen leer", () => {
        expect(leererEntwurf(OBJEKT)).toMatchObject({ honig: "", text: "", quelle: "", name: "", fehltArt: "" });
    });

    it("Betrifft: ein Objekt ist ein Objekt; an einer Stelle gilt der Ort in der Nähe, wenn er gewählt ist und es einen gibt", () => {
        expect(betrifftObjekt(OBJEKT, "objekt")).toBe(true);
        expect(betrifftObjekt(STELLE, "stelle")).toBe(false);
        expect(betrifftObjekt(STELLE_MIT_ORT, "stelle")).toBe(false);
        expect(betrifftObjekt(STELLE_MIT_ORT, "ort")).toBe(true);
        // Ohne gefundenen Ort ist „ort“ nichts, was man wählen könnte.
        expect(betrifftObjekt(STELLE, "ort")).toBe(false);
        expect(betrifftName(STELLE_MIT_ORT, "ort")).toBe("Wehrheim");
        expect(betrifftName(STELLE_MIT_ORT, "stelle")).toBeUndefined();
        expect(betrifftLage(STELLE_MIT_ORT, "ort")).toEqual(ORT.lage);
        expect(betrifftLage(OBJEKT, "objekt")).toEqual(OBJEKT.lage);
    });
});

describe("🔴 Absenden ist gesperrt, solange Pflichtfelder fehlen - mit dem Grund (§2.1 Schritt 5)", () => {
    it("der erste fehlende Punkt in der Reihenfolge des Formulars", () => {
        expect(sperrGrund(entwurf({ kategorie: "", text: "" }))).toBe("community.sperre.kategorie");
        expect(sperrGrund(entwurf({ fehltArt: "", text: "" }))).toBe("community.sperre.fehltArt");
        expect(sperrGrund(entwurf({ text: "kurz" }))).toBe("community.sperre.text");
        expect(sperrGrund(entwurf())).toBeUndefined();
    });

    it("die Objektart wird nur bei „Etwas fehlt“ gefragt", () => {
        expect(sperrGrund(entwurf({ kategorie: "lage", fehltArt: "" }))).toBeUndefined();
        expect(sperrGrund(entwurf({ kategorie: "fehlt", fehltArt: "" }))).toBe("community.sperre.fehltArt");
    });

    it("die Beschreibung zählt getrimmt: 10 bis 2000 Zeichen", () => {
        const min = COMMUNITY_GRENZEN.textMin;
        expect(sperrGrund(entwurf({ text: " ".repeat(40) }))).toBe("community.sperre.text");
        expect(sperrGrund(entwurf({ text: `  ${"x".repeat(min - 1)}  ` }))).toBe("community.sperre.text");
        expect(sperrGrund(entwurf({ text: "x".repeat(min) }))).toBeUndefined();
        expect(sperrGrund(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMax) }))).toBeUndefined();
        expect(sperrGrund(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMax + 1) }))).toBe(
            "community.sperre.textLang",
        );
    });

    it("🔴 die Quelle sperrt nie: Eine Beobachtung soll nicht verloren gehen - sie ist nur ein Hinweis im Formular", () => {
        expect(sperrGrund(entwurf({ quelle: "" }))).toBeUndefined();
        expect(sperrGrund(entwurf({ quelle: "   " }))).toBeUndefined();
    });

    it("das gesperrte Feld, das nach einem Druck markiert wird, folgt derselben Reihenfolge", () => {
        expect(sperrFeld(entwurf({ kategorie: "", text: "" }))).toBe("kategorie");
        expect(sperrFeld(entwurf({ fehltArt: "", text: "" }))).toBe("fehltArt");
        expect(sperrFeld(entwurf({ text: "kurz" }))).toBe("text");
        expect(sperrFeld(entwurf({ text: "x".repeat(COMMUNITY_GRENZEN.textMax + 1) }))).toBe("text");
        expect(sperrFeld(entwurf())).toBeUndefined();
    });

    it("jeder Grund hat einen Satz in der Tafel", () => {
        for (const key of [
            "community.sperre.kategorie",
            "community.sperre.fehltArt",
            "community.sperre.text",
            "community.sperre.textLang",
        ] as const)
            expect(de[key], key).toBeTypeOf("string");
    });
});

describe("die Liste „Was fehlt?“ und die Zeichen des Formulars (WI-0279)", () => {
    it("🔴 das Formular bietet zehn Arten in fester Reihenfolge an, `gebiet` nicht mehr; der Vertrag kennt weiter alle", () => {
        expect([...FEHLT_ARTEN_FORMULAR]).toEqual([
            "ort",
            "weg",
            "fluss",
            "gewaesser",
            "insel",
            "landschaft",
            "gebirge",
            "herrschaft",
            "sprache",
            "anderes",
        ]);
        expect(FEHLT_ARTEN_FORMULAR).not.toContain("gebiet");
        for (const art of FEHLT_ARTEN_FORMULAR) expect(FEHLT_ARTEN, art).toContain(art);
        expect(FEHLT_ARTEN).toContain("gebiet");
    });

    it("🔴 der Server nimmt jede gültige Art, auch die neuen und die alte `gebiet`, und lehnt eine fremde ab", () => {
        const kennung = neuesFormular();
        for (const art of FEHLT_ARTEN) {
            const body = drahtBody(kennung, entwurf({ fehltArt: art }), STELLE, "stelle", undefined, 5000);
            expect(Value.Check(MeldungBody, body), art).toBe(true);
        }
        const falsch = { ...drahtBody(kennung, entwurf(), STELLE, "stelle", undefined, 5000), fehltArt: "wolke" };
        expect(Value.Check(MeldungBody, falsch)).toBe(false);
    });

    it("jede Kategorie, jede Art des Fehlenden und jede Objektart hat ein Zeichen, und jede angebotene Art einen Text", () => {
        for (const kategorie of MELDUNG_KATEGORIEN)
            expect(KATEGORIE_ZEICHEN[kategorie], kategorie).toBeTypeOf("string");
        for (const art of FEHLT_ARTEN) expect(FEHLT_ZEICHEN[art], art).toBeTypeOf("string");
        for (const art of BEZUG_OBJEKTARTEN) expect(OBJEKT_ZEICHEN[art], art).toBeTypeOf("string");
        for (const art of FEHLT_ARTEN) {
            expect(de[`community.fehltArt.${art}`], art).toBeTypeOf("string");
            expect(en[`community.fehltArt.${art}`], art).toBeTypeOf("string");
        }
    });
});

describe("der Rumpf der Anfrage", () => {
    const kennung = neuesFormular();

    it("🔴 gilt für den Server: Stelle, Ort und Objekt bestehen das Schema der Route", () => {
        const faelle: [string, MeldeBezug, "objekt" | "stelle" | "ort"][] = [
            ["Objekt", OBJEKT, "objekt"],
            ["Stelle", STELLE, "stelle"],
            ["Stelle mit nächstem Ort", STELLE_MIT_ORT, "stelle"],
            ["der Ort in der Nähe", STELLE_MIT_ORT, "ort"],
        ];
        for (const [name, bezug, betrifft] of faelle) {
            const body = drahtBody(kennung, entwurf({ quelle: "Wiki" }), bezug, betrifft, undefined, 12_000);
            expect(Value.Check(MeldungBody, body), name).toBe(true);
        }
    });

    it("🔴 Kennung und Schlüssel sind die des Formulars; Honigtopf und Zeit gehen mit", () => {
        const body = drahtBody(kennung, entwurf({ honig: "https://spam.test" }), OBJEKT, "objekt", undefined, 4321.7);
        expect(body.operationId).toBe(kennung.operationId);
        expect(body.schluessel).toBe(kennung.schluessel);
        expect(body.falle).toEqual({ feld: "https://spam.test", dauerMs: 4322 });
        expect(drahtBody(kennung, entwurf(), OBJEKT, "objekt", undefined, -5).falle.dauerMs).toBe(0);
    });

    it("leere Felder fehlen im Rumpf; Text, Quelle und Name sind getrimmt", () => {
        const leer = drahtBody(kennung, entwurf(), OBJEKT, "objekt", undefined, 5000);
        expect(leer).not.toHaveProperty("quelle");
        expect(leer).not.toHaveProperty("name");
        const voll = drahtBody(
            kennung,
            entwurf({ text: "  Der Name ist falsch geschrieben.  ", quelle: " Regionalband S. 12 ", name: " Alrike " }),
            OBJEKT,
            "objekt",
            undefined,
            5000,
        );
        expect(voll).toMatchObject({
            text: "Der Name ist falsch geschrieben.",
            quelle: "Regionalband S. 12",
            name: "Alrike",
        });
    });

    it("die Objektart geht nur bei „Etwas fehlt“ mit", () => {
        expect(
            drahtBody(kennung, entwurf({ kategorie: "fehlt", fehltArt: "fluss" }), STELLE, "stelle", undefined, 5000)
                .fehltArt,
        ).toBe("fluss");
        expect(
            drahtBody(kennung, entwurf({ kategorie: "name", fehltArt: "fluss" }), OBJEKT, "objekt", undefined, 5000),
        ).not.toHaveProperty("fehltArt");
    });

    it("🔴 eine Meldung aus der Bildansicht trägt das Reisebild, ob sie die Stelle oder den Ort betrifft; sonst fehlt es", () => {
        const reisebildId = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11";
        const ausDemBild: MeldeBezug = { ...STELLE_MIT_ORT, reisebildId };
        expect(drahtBezug(ausDemBild, "stelle", "sonstiges", undefined)).toMatchObject({ art: "stelle", reisebildId });
        expect(drahtBezug(ausDemBild, "ort", "sonstiges", undefined)).toMatchObject({ art: "objekt", reisebildId });
        expect(drahtBezug(STELLE_MIT_ORT, "stelle", "sonstiges", undefined)).not.toHaveProperty("reisebildId");
        expect(drahtBezug(OBJEKT, "objekt", "sonstiges", undefined)).not.toHaveProperty("reisebildId");
    });

    it("🔴 ein Vorschlag (neue Lage) geht nur bei „Lage falsch“ an einem Objekt mit, gerundet auf 0,01", () => {
        const neu = { x: 560.12345, y: 541.9876 };
        const lage = drahtBezug(OBJEKT, "objekt", "lage", neu);
        expect(lage).toMatchObject({
            art: "objekt",
            objektArt: "place",
            objektId: GARETH_ID,
            name: "Wehrheim",
            typ: "dorf",
            lage: { x: 551.63, y: 532.97 },
            vorschlagLage: { x: 560.12, y: 541.99 },
        });
        expect(drahtBezug(OBJEKT, "objekt", "name", neu)).not.toHaveProperty("vorschlagLage");
        expect(drahtBezug(STELLE, "stelle", "lage", neu)).not.toHaveProperty("vorschlagLage");
        const ortLage = drahtBezug(STELLE_MIT_ORT, "ort", "lage", neu);
        expect(ortLage).toMatchObject({
            art: "objekt",
            objektArt: "place",
            objektId: GARETH_ID,
            vorschlagLage: { x: 560.12, y: 541.99 },
        });
    });

    it("eine Stelle trägt ihre Lage und, wo bekannt, den Namen des nächsten Orts", () => {
        expect(drahtBezug(STELLE, "stelle", "fehlt", undefined)).toEqual({
            art: "stelle",
            lage: { x: 560.12, y: 540.46 },
        });
        expect(drahtBezug(STELLE_MIT_ORT, "stelle", "fehlt", undefined)).toEqual({
            art: "stelle",
            lage: { x: 560.12, y: 540.46 },
            naechsterOrt: "Wehrheim",
        });
    });

    it("zu lange Namen werden gekürzt, ein leerer Name wird nicht zum Fehler", () => {
        const lang = drahtBezug(
            { ...OBJEKT, name: "N".repeat(300), typ: "t".repeat(200) } as MeldeBezug,
            "objekt",
            "name",
            undefined,
        );
        expect(lang).toMatchObject({ name: "N".repeat(200), typ: "t".repeat(80) });
        expect(drahtBezug({ ...OBJEKT, name: "  " } as MeldeBezug, "objekt", "name", undefined)).toMatchObject({
            name: "?",
        });
    });

    it("🔴 ein unvollständiges Formular baut keinen Rumpf", () => {
        expect(() => drahtBody(kennung, entwurf({ text: "kurz" }), OBJEKT, "objekt", undefined, 5000)).toThrow();
        expect(() => drahtBody(kennung, entwurf({ kategorie: "" }), OBJEKT, "objekt", undefined, 5000)).toThrow();
    });
});

describe("die Steuerung der Besucherfenster", () => {
    const keinOrt = async (): Promise<BezugOrt | undefined> => undefined;

    it("🔴 ein Fenster zur Zeit: ein anderer Vorgang ersetzt das Formular; die Lage bleibt", () => {
        const s = createBesucherSteuerung({ naechsterOrt: keinOrt });
        s.setzeLage("geloest", { left: 10, top: 20, width: 520, height: 300 });
        s.oeffneMeldung(OBJEKT);
        const erste = s.anzeige.value;
        expect(erste).toMatchObject({ art: "meldung", bezug: OBJEKT });
        s.oeffneMeldung({ ...OBJEKT, objektId: "00000000-0000-4000-8000-000000000002" });
        expect(s.anzeige.value?.nr).not.toBe(erste?.nr);
        s.oeffneStatus("A".repeat(43));
        expect(s.anzeige.value).toMatchObject({ art: "status", schluessel: "A".repeat(43) });
        expect(s.fenster.value).toEqual({ lage: "geloest", box: { left: 10, top: 20, width: 520, height: 300 } });
    });

    it("🔴 ein weiterer Rechtsklick setzt die Stelle neu, das Formular bleibt (§2.1a)", () => {
        const s = createBesucherSteuerung({ naechsterOrt: keinOrt });
        s.oeffneStelle({ x: 1, y: 2 });
        const nr = s.anzeige.value?.nr;
        s.oeffneStelle({ x: 3, y: 4 });
        expect(s.anzeige.value?.nr).toBe(nr);
        expect(s.anzeige.value).toMatchObject({ art: "meldung", bezug: { art: "stelle", lage: { x: 3, y: 4 } } });
    });

    it("der nächste Ort kommt nach und steht dann als zweite Wahl da", async () => {
        const s = createBesucherSteuerung({ naechsterOrt: async () => ORT });
        s.oeffneStelle({ x: 5, y: 6 });
        expect(s.anzeige.value).toMatchObject({ bezug: { art: "stelle" } });
        await Promise.resolve();
        await Promise.resolve();
        expect(s.anzeige.value).toMatchObject({ art: "meldung", bezug: { art: "stelle", ort: ORT } });
    });

    it("kennt der Aufrufer den Ort schon (Rechtsklick auf einen Ort), wird er nicht noch einmal gesucht", async () => {
        let gefragt = 0;
        const s = createBesucherSteuerung({
            naechsterOrt: async () => {
                gefragt += 1;
                return undefined;
            },
        });
        s.oeffneStelle({ x: 5, y: 6 }, ORT);
        await Promise.resolve();
        expect(gefragt).toBe(0);
        expect(s.anzeige.value).toMatchObject({ bezug: { ort: ORT } });
    });

    it("🔴 die Stelle aus der Bildansicht trägt das Reisebild; eine neue Stelle per Rechtsklick nimmt es wieder weg", async () => {
        const reisebildId = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11";
        const s = createBesucherSteuerung({ naechsterOrt: async () => undefined });
        s.oeffneStelle({ x: 5, y: 6 }, ORT, reisebildId);
        expect(s.anzeige.value).toMatchObject({ bezug: { art: "stelle", ort: ORT, reisebildId } });
        s.oeffneStelle({ x: 7, y: 8 }, ORT);
        await Promise.resolve();
        expect(s.anzeige.value).not.toMatchObject({ bezug: { reisebildId } });
    });

    it("eine späte Antwort gilt nicht mehr, wenn inzwischen eine andere Stelle oder ein anderes Fenster dasteht", async () => {
        let antwort: (ort: BezugOrt | undefined) => void = () => undefined;
        const s = createBesucherSteuerung({ naechsterOrt: () => new Promise((fertig) => (antwort = fertig)) });
        s.oeffneStelle({ x: 5, y: 6 });
        s.oeffneStatus("B".repeat(43));
        antwort(ORT);
        await Promise.resolve();
        await Promise.resolve();
        expect(s.anzeige.value).toMatchObject({ art: "status" });
    });

    it("🔴 die Statusseite nimmt nur einen Schlüssel an; alles andere zeigt gleich „gibt es nicht (mehr)“", () => {
        const s = createBesucherSteuerung();
        for (const schlecht of [null, undefined, "", "zu-kurz", `${"A".repeat(42)}+`]) {
            s.oeffneStatus(schlecht);
            expect(s.anzeige.value).toMatchObject({ art: "status", schluessel: null });
        }
    });

    it("Schließen räumt Fenster, Modus und Vorschlag; die Lage bleibt für das nächste Öffnen", () => {
        const s = createBesucherSteuerung();
        s.setzeLage("geloest");
        s.oeffneMeldung(OBJEKT);
        s.starteLageModus({ name: "Wehrheim", alt: ORT.lage });
        s.schliesse();
        expect(s.anzeige.value).toBeUndefined();
        expect(s.lageModus.value).toBeUndefined();
        expect(s.fenster.value.lage).toBe("geloest");
    });

    it("🔴 Neue Lage zeigen: der Klick setzt den Vorschlag samt alter Lage und beendet den Modus; zurücknehmen löscht ihn", () => {
        const s = createBesucherSteuerung();
        s.oeffneMeldung(OBJEKT);
        s.starteLageModus({ name: "Wehrheim", alt: ORT.lage });
        expect(s.lageModus.value).toEqual({ name: "Wehrheim", alt: ORT.lage });
        s.setzeVorschlag({ x: 600, y: 500 });
        expect(s.lageModus.value).toBeUndefined();
        expect(s.vorschlag.value).toEqual({ neu: { x: 600, y: 500 }, alt: ORT.lage });
        // Erneut zeigen versetzt ihn.
        s.starteLageModus({ name: "Wehrheim", alt: ORT.lage });
        s.setzeVorschlag({ x: 610, y: 510 });
        expect(s.vorschlag.value?.neu).toEqual({ x: 610, y: 510 });
        s.nimmVorschlagZurueck();
        expect(s.vorschlag.value).toBeUndefined();
    });

    it("ein neues Formular beginnt ohne Vorschlag und ohne Modus des alten", () => {
        const s = createBesucherSteuerung();
        s.oeffneMeldung(OBJEKT);
        s.starteLageModus({ name: "Wehrheim" });
        s.setzeVorschlag({ x: 1, y: 1 });
        s.oeffneMeldung({ ...OBJEKT, objektId: "00000000-0000-4000-8000-000000000003" });
        expect(s.vorschlag.value).toBeUndefined();
        expect(s.lageModus.value).toBeUndefined();
    });

    it("🔴 ein Fenster der Besucher öffnet gelöst (mittig), erst ▥ dockt es an; angedockt rückt die Seite Laschen und Eckknöpfe", () => {
        const s = createBesucherSteuerung();
        expect(s.angedockt.value).toBe(false);
        s.oeffneStatus("A".repeat(43));
        expect(s.fenster.value).toEqual({ lage: "geloest" });
        expect(s.angedockt.value).toBe(false);
        s.setzeLage("angedockt");
        expect(s.angedockt.value).toBe(true);
        s.setzeLage("geloest");
        expect(s.angedockt.value).toBe(false);
        s.setzeLage("angedockt");
        s.schliesse();
        expect(s.angedockt.value).toBe(false);
    });

    it("die Box des gelösten Fensters wird gemerkt", () => {
        const s = createBesucherSteuerung();
        s.setzeLage("geloest");
        s.setzeBox({ left: 1, top: 2, width: 520, height: 400 });
        expect(s.fenster.value).toEqual({ lage: "geloest", box: { left: 1, top: 2, width: 520, height: 400 } });
    });
});

describe("der nächste Ort aus der Antwort des Servers", () => {
    it("Name, Art und Lage; ohne Treffer kein Ort", () => {
        expect(
            ortAusAntwort({ place: { id: GARETH_ID, name: "Wehrheim", subtype: "dorf", hidden: false, x: 1, y: 2 } }),
        ).toEqual({ id: GARETH_ID, name: "Wehrheim", typ: "dorf", lage: { x: 1, y: 2 } });
        expect(ortAusAntwort({ place: null })).toBeUndefined();
    });
});
