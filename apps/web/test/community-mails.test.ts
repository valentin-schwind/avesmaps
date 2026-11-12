import { Value } from "@sinclair/typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import {
    AlsMeldungBody,
    capabilitiesFor,
    type GesendetZeile,
    type SearchHit,
    type VerlaufEintrag,
    type VorgangListe,
    type VorgangZeile,
} from "@avesmaps3d/shared";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import {
    ANTWORT_AN,
    MAIL_ABLAGEN,
    MAIL_FILTER_KATEGORIEN,
    ablageZahl,
    anfrageGriffe,
    antwortGrund,
    antwortSperre,
    eingangName,
    gesendetAn,
    gesendetBetreff,
    gesendetMeta,
    istBeantwortet,
    mailAbsender,
    mailAktionen,
    mailBetreff,
    mailLegendeNamen,
    mailMeta,
    mailtoVon,
    neuerWeiterfuehrenEntwurf,
    ortAusTreffer,
    segmentVon,
    unterreiterZahl,
    weiterfuehrenBezug,
    weiterfuehrenBody,
    weiterfuehrenHatEntwurf,
    weiterfuehrenSperre,
    type WeiterfuehrenEntwurf,
} from "../src/community/mails-modell";
import { verlaufZeilen, type VorgangLage } from "../src/community/meldungen-modell";
import { createRedaktion } from "../src/community/redaktion";
import {
    antworteAnfrage,
    fuehreAlsMeldungWeiter,
    insArchiv,
    kennung,
    kennungFrei,
    ladeGesendet,
    ladeListe,
    ladePersonen,
    zurueckInEingang,
} from "../src/community/redaktion-api";
import { de } from "../src/i18n/de";
import { setLocale } from "../src/i18n/i18n";

/**
 * Das Modell des Reiters „Community › Mails“ ohne Browser (WI-0268 C4; Bedienkonzept §3.2 bis §3.4): die Karte, die Aktionsspalte, die Ablagen, der Fuß „Notiz | Antwort“ in seinen Zuständen (gesperrt, aktiv), das Blatt
 * „Als Meldung weiterführen“, die Schritte an der Leitung und der Weg der Glocke in die Mails.
 */

afterEach(() => setLocale("de"));

const operator = [...capabilitiesFor("operator")];
const admin = [...capabilitiesFor("admin")];

const anfrage = (teil: Partial<VorgangZeile> = {}): VorgangZeile => ({
    nummer: "COM-000124",
    art: "anfrage",
    kategorie: "frage",
    zustand: "neu",
    ergebnis: null,
    prioritaet: "normal",
    eingang: "kontakt",
    bezugName: null,
    bezugArt: null,
    zustaendig: null,
    ohneQuelle: false,
    moeglicheDublette: null,
    eingegangenAt: "2026-10-31T10:00:00.000Z",
    aktivAt: "2026-10-31T10:00:00.000Z",
    revision: 1,
    absender: "Alrike",
    betreff: "Darf die Karte gedruckt werden?",
    beantwortet: false,
    ...teil,
});

const lage = (teil: Partial<VorgangLage> = {}, zeile: Partial<VorgangZeile> = {}): VorgangLage => ({
    zeile: anfrage(zeile),
    papierkorb: false,
    archiviert: false,
    rueckwege: ["statusseite"],
    entfernt: false,
    bezug: null,
    ...teil,
});

describe("die Karte in der Bauart des Mail-Eingangs (Guide §13.27)", () => {
    it("Absender kräftig, Betreff gedämpft, Meta „Nummer · Eingang · zuständig“", () => {
        const z = anfrage();
        expect(mailAbsender(z)).toBe("Alrike");
        expect(mailBetreff(z)).toBe("Darf die Karte gedruckt werden?");
        expect(mailMeta(z)).toBe("COM-000124 · Kontaktformular · niemand zuständig");
        expect(mailMeta(anfrage({ zustaendig: { id: "x", name: "Vali" } }))).toBe(
            "COM-000124 · Kontaktformular · Vali",
        );
    });

    it("ohne Namen und Adresse (nach der Frist) steht „ohne Namen“, ohne Betreff die Kategorie", () => {
        expect(mailAbsender(anfrage({ absender: null }))).toBe("ohne Namen");
        expect(mailBetreff(anfrage({ betreff: null }))).toBe("Frage");
        expect(mailBetreff(anfrage({ betreff: "" }))).toBe("Frage");
        expect(mailBetreff(anfrage({ kategorie: "rechte", betreff: null }))).toBe("Urheber- und Bildrechte");
    });

    it("das Abzeichen „beantwortet“ nur, wenn eine Antwort ausging", () => {
        expect(istBeantwortet(anfrage())).toBe(false);
        expect(istBeantwortet(anfrage({ beantwortet: true }))).toBe(true);
        expect(istBeantwortet({})).toBe(false);
    });

    it("der Eingang als Wort, eine unbekannte Art bleibt", () => {
        expect(eingangName("kontakt")).toBe("Kontaktformular");
        expect(eingangName("mail")).toBe("Mail");
        expect(eingangName("etwas-neues")).toBe("etwas-neues");
    });
});

describe("Ablagen, Zahlen, Legende", () => {
    const liste = (zaehler: Partial<VorgangListe["zaehler"]> = {}): VorgangListe => ({
        zeilen: [],
        zaehler: {
            offen: 4,
            erledigt: 1,
            archiv: 7,
            papierkorb: 0,
            meine: 3,
            neu: 2,
            inArbeit: 1,
            rueckfrage: 1,
            eingang: 5,
            ...zaehler,
        },
    });

    it("Eingang · Gesendet · Archiv; Gesendet ist keine Ablage und fragt das Segment Eingang", () => {
        expect(MAIL_ABLAGEN).toEqual(["eingang", "gesendet", "archiv"]);
        expect(segmentVon("eingang")).toBe("eingang");
        expect(segmentVon("gesendet")).toBe("eingang");
        expect(segmentVon("archiv")).toBe("archiv");
    });

    it("die Zahl an Eingang und Archiv, Gesendet trägt keine", () => {
        const z = liste().zaehler;
        expect(ablageZahl(z, "eingang")).toBe(5);
        expect(ablageZahl(z, "archiv")).toBe(7);
        expect(ablageZahl(z, "gesendet")).toBeUndefined();
        expect(ablageZahl(liste({ eingang: undefined as never }).zaehler, "eingang")).toBeUndefined();
    });

    it("🔴 die Zahl am Unterreiter ist, was auf die Redaktion wartet: neu und in Arbeit, nicht „wartet auf Antwort“", () => {
        expect(unterreiterZahl(liste())).toBe(3);
        expect(unterreiterZahl(liste({ neu: 0, inArbeit: 0, rueckfrage: 9 }))).toBe(0);
        expect(unterreiterZahl(undefined)).toBeUndefined();
    });

    it("die Legende nennt im Eingang drei Stufen, im Archiv nur „im Archiv“", () => {
        expect(mailLegendeNamen("eingang")).toEqual({
            leer: "neu",
            halb: "in Arbeit",
            "halb-rechts": "wartet auf Antwort",
        });
        expect(mailLegendeNamen("archiv")).toEqual({ voll: "im Archiv" });
    });

    it("die Kategorien des Trichters sind die neun der Anfragen (das Kontaktformular bietet sechs Themen an, `lob`, `allgemein` und `problem` kamen mit ihm dazu)", () => {
        expect([...MAIL_FILTER_KATEGORIEN]).toEqual([
            "frage",
            "hinweis",
            "mitmachen",
            "lob",
            "allgemein",
            "problem",
            "rechte",
            "datenschutz",
            "sonstiges",
        ]);
    });
});

describe("🔴 die Aktionsspalte neben der Karte", () => {
    it("im Eingang ↧ Ins Archiv, im Archiv ↺ Zurück in den Eingang", () => {
        expect(mailAktionen("eingang", operator).archiv).toBe("ins-archiv");
        expect(mailAktionen("archiv", operator).archiv).toBe("zurueck");
    });

    it("der Papierkorb geht mit `moderate_community`; ohne steht er gesperrt da, mit einem Satz", () => {
        expect(mailAktionen("eingang", operator).korb).toEqual({ zeigen: true });
        const gesperrt = mailAktionen("eingang", ["moderate_submissions"]).korb;
        expect(gesperrt.zeigen).toBe(true);
        expect(gesperrt.grund).toBe("community.mails.grund.korb");
        expect(de[gesperrt.grund!]).toBeTypeOf("string");
    });
});

describe("Gesendet", () => {
    const g = (teil: Partial<GesendetZeile> = {}): GesendetZeile => ({
        nummer: "COM-000124",
        an: null,
        betreff: "Darf die Karte gedruckt werden?",
        text: "Ja, mit Quelle.",
        at: "2026-10-31T10:00:00.000Z",
        von: { id: "v", name: "Vali" },
        weg: "statusseite",
        ...teil,
    });

    it("„An: Statusseite“, solange es keine Adresse gibt; mit Adresse „An: ‹Adresse›“", () => {
        expect(gesendetAn(g())).toBe("An: Statusseite");
        expect(gesendetAn(g({ an: "alrike@example.org" }))).toBe("An: alrike@example.org");
    });

    it("der Betreff mit „Re: “, die Meta-Zeile mit Nummer und Person", () => {
        expect(gesendetBetreff(g())).toBe("Re: Darf die Karte gedruckt werden?");
        expect(gesendetBetreff(g({ betreff: null }))).toBe("Re:");
        expect(gesendetMeta(g())).toBe("COM-000124 · von Vali");
        expect(gesendetMeta(g({ von: null }))).toBe("COM-000124");
    });
});

describe("🔴 der Fuß „Notiz | Antwort“: gesperrt und aktiv", () => {
    it("aktiv: ein offener Vorgang mit Rückweg und dem Recht zum Antworten", () => {
        expect(antwortGrund(lage(), operator)).toBeUndefined();
        expect(antwortGrund(lage({}, { zustand: "in_arbeit" }), operator)).toBeUndefined();
        expect(antwortGrund(lage({}, { zustand: "rueckfrage" }), operator)).toBeUndefined();
    });

    it("ohne `answer_community` gesperrt (eine Antwort vertritt Avesmaps nach außen)", () => {
        expect(antwortGrund(lage(), admin)).toBe("community.mails.grund.antwortRecht");
        expect(antwortGrund(lage(), [])).toBe("community.mails.grund.antwortRecht");
    });

    it("im Archiv „Zum Antworten zurück in den Eingang holen“, im Papierkorb der Satz des Papierkorbs", () => {
        const archiv = antwortGrund(
            lage({ archiviert: true }, { zustand: "abgeschlossen", ergebnis: "erledigt" }),
            operator,
        );
        expect(archiv).toBe("community.mails.grund.imArchiv");
        expect(de[archiv!]).toContain("zurück in den Eingang");
        expect(antwortGrund(lage({ papierkorb: true }, { zustand: "abgeschlossen", ergebnis: "spam" }), operator)).toBe(
            "community.redaktion.grund.imPapierkorb",
        );
    });

    it("ohne Rückweg (Name und Statuslink sind nach der Frist weg) gesperrt", () => {
        expect(antwortGrund(lage({ rueckwege: [], entfernt: true }), operator)).toBe(
            "community.mails.grund.keinRueckweg",
        );
    });

    it("„Antworten“ verlangt Text; der Grund der Lage geht vor; jeder Satz steht in der Tafel", () => {
        expect(antwortSperre(undefined, "Ja.")).toBeUndefined();
        expect(antwortSperre(undefined, "   ")).toBe("community.redaktion.grund.textFehlt");
        expect(antwortSperre("community.mails.grund.imArchiv", "Ja.")).toBe("community.mails.grund.imArchiv");
        for (const key of [
            "community.mails.grund.antwortRecht",
            "community.mails.grund.imArchiv",
            "community.mails.grund.keinRueckweg",
            "community.mails.grund.korb",
            ANTWORT_AN,
        ] as const) {
            expect(de[key], key).toBeTypeOf("string");
        }
    });

    it("die Leiste: ↧ Ins Archiv bei Offenem, ↺ Zurück in den Eingang bei Abgeschlossenem, nichts davon im Papierkorb", () => {
        const offen = anfrageGriffe(lage());
        expect(offen).toMatchObject({
            insArchiv: { zeigen: true },
            zurueck: { zeigen: false },
            alsMeldung: { zeigen: true },
        });
        const zu = anfrageGriffe(lage({ archiviert: true }, { zustand: "abgeschlossen", ergebnis: "beantwortet" }));
        expect(zu).toMatchObject({
            insArchiv: { zeigen: false },
            zurueck: { zeigen: true },
            alsMeldung: { zeigen: true },
        });
        const korb = anfrageGriffe(lage({ papierkorb: true }, { zustand: "abgeschlossen", ergebnis: "spam" }));
        expect(korb).toMatchObject({
            insArchiv: { zeigen: false },
            zurueck: { zeigen: false },
            alsMeldung: { zeigen: false },
        });
    });
});

describe("das Blatt „Als Meldung weiterführen“", () => {
    const ORT = "11111111-2222-4333-8444-555555555555";
    const treffer = (teil: Partial<SearchHit> = {}): SearchHit =>
        ({
            kind: "ort",
            id: ORT,
            name: "Wehrheim",
            subtype: "stadt",
            x: 500.123456,
            y: 400.5,
            zoom: 6,
            ...teil,
        }) as SearchHit;
    const entwurf = (teil: Partial<WeiterfuehrenEntwurf> = {}): WeiterfuehrenEntwurf => ({
        ...neuerWeiterfuehrenEntwurf("Wehrheim liegt falsch auf der Karte, bitte nachsehen."),
        bezug: { art: "stelle", lage: { x: 123.456, y: 456.789 } },
        ...teil,
    });

    it("beginnt mit „Sonstiges“, dem Text der Anfrage und ohne Bezug; der Text ist auf 2000 Zeichen begrenzt", () => {
        const neu = neuerWeiterfuehrenEntwurf("Text der Anfrage");
        expect(neu).toEqual({
            kategorie: "sonstiges",
            fehltArt: "",
            bezug: undefined,
            text: "Text der Anfrage",
            quelle: "",
            antwort: "",
        });
        expect(neuerWeiterfuehrenEntwurf("x".repeat(5000)).text).toHaveLength(2000);
    });

    it("🔴 gesperrt mit Grund, in der Reihenfolge des Blatts: Kategorie, Objektart, Bezug, Beschreibung, Recht für die Antwort", () => {
        expect(weiterfuehrenSperre(entwurf({ kategorie: "" }), operator)).toBe(
            "community.mails.weiter.sperre.kategorie",
        );
        expect(weiterfuehrenSperre(entwurf({ kategorie: "fehlt", fehltArt: "" }), operator)).toBe(
            "community.sperre.fehltArt",
        );
        expect(weiterfuehrenSperre(entwurf({ bezug: undefined }), operator)).toBe(
            "community.mails.weiter.sperre.bezug",
        );
        expect(weiterfuehrenSperre(entwurf({ text: "kurz" }), operator)).toBe("community.sperre.text");
        expect(weiterfuehrenSperre(entwurf({ text: "x".repeat(2001) }), operator)).toBe("community.sperre.textLang");
        expect(weiterfuehrenSperre(entwurf({ antwort: "Danke." }), admin)).toBe("community.mails.grund.antwortRecht");
        expect(weiterfuehrenSperre(entwurf(), operator)).toBeUndefined();
        expect(weiterfuehrenSperre(entwurf({ antwort: "Danke." }), operator)).toBeUndefined();
        for (const key of [
            "community.mails.weiter.sperre.kategorie",
            "community.mails.weiter.sperre.bezug",
            "community.sperre.fehltArt",
            "community.sperre.text",
            "community.sperre.textLang",
        ] as const) {
            expect(de[key], key).toBeTypeOf("string");
        }
    });

    it("ein Treffer der Suche ist nur dann ein Bezug, wenn er ein Ort ist", () => {
        expect(ortAusTreffer(treffer())).toEqual({
            id: ORT,
            name: "Wehrheim",
            typ: "stadt",
            lage: { x: 500.123456, y: 400.5 },
        });
        const ohneUnterart = { ...treffer() } as Partial<SearchHit>;
        delete ohneUnterart.subtype;
        expect(ortAusTreffer(ohneUnterart as SearchHit)).toEqual({
            id: ORT,
            name: "Wehrheim",
            lage: { x: 500.123456, y: 400.5 },
        });
        for (const kind of ["weg", "landschaft", "klima"] as const)
            expect(ortAusTreffer(treffer({ kind }))).toBeUndefined();
    });

    it("🔴 der Rumpf besteht das Schema der Route: ein Ort als Objekt mit Schnappschuss, eine Stelle mit ihrer Lage, gerundet", () => {
        const ort = ortAusTreffer(treffer())!;
        const mitOrt = weiterfuehrenBody(entwurf({ bezug: { art: "ort", ort } }), operator);
        expect(mitOrt.bezug).toEqual({
            art: "objekt",
            objektArt: "place",
            objektId: ORT,
            name: "Wehrheim",
            typ: "stadt",
            lage: { x: 500.12, y: 400.5 },
        });
        const mitStelle = weiterfuehrenBody(entwurf(), operator);
        expect(mitStelle.bezug).toEqual({ art: "stelle", lage: { x: 123.46, y: 456.79 } });
        for (const body of [mitOrt, mitStelle]) {
            expect(Value.Check(AlsMeldungBody, { operationId: ORT, baseRevision: 3, ...body })).toBe(true);
        }
    });

    it("leere Felder fehlen im Rumpf; Quelle und Antwort sind getrimmt; die Objektart geht nur bei „Etwas fehlt“ mit", () => {
        const schlicht = weiterfuehrenBody(entwurf({ text: "  Wehrheim liegt falsch auf der Karte.  " }), operator);
        expect(schlicht).not.toHaveProperty("quelle");
        expect(schlicht).not.toHaveProperty("antwort");
        expect(schlicht).not.toHaveProperty("fehltArt");
        expect(schlicht.text).toBe("Wehrheim liegt falsch auf der Karte.");
        const voll = weiterfuehrenBody(
            entwurf({ kategorie: "fehlt", fehltArt: "weg", quelle: " Regionalband S. 3 ", antwort: " Danke. " }),
            operator,
        );
        expect(voll).toMatchObject({
            kategorie: "fehlt",
            fehltArt: "weg",
            quelle: "Regionalband S. 3",
            antwort: "Danke.",
        });
        const anders = weiterfuehrenBody(entwurf({ kategorie: "lage", fehltArt: "weg" }), operator);
        expect(anders).not.toHaveProperty("fehltArt");
    });

    it("🔴 ein unvollständiges Blatt baut keinen Rumpf", () => {
        expect(() => weiterfuehrenBody(entwurf({ bezug: undefined }), operator)).toThrow();
        expect(() => weiterfuehrenBody(entwurf({ text: "kurz" }), operator)).toThrow();
        expect(() => weiterfuehrenBody(entwurf({ antwort: "Ja." }), admin)).toThrow();
    });

    it("ein Ort ohne Namen wird nicht zum Fehler, ein langer Name wird gekürzt", () => {
        const bezug = weiterfuehrenBezug({ art: "ort", ort: { id: ORT, name: "  ", lage: { x: 1, y: 2 } } });
        expect(bezug).toMatchObject({ name: "?" });
        const lang = weiterfuehrenBezug({ art: "ort", ort: { id: ORT, name: "N".repeat(300), lage: { x: 1, y: 2 } } });
        expect(lang).toMatchObject({ name: "N".repeat(200) });
    });

    it("Hat das Blatt einen Entwurf? Antwort, Quelle oder ein gewählter Bezug zählen; die Vorlage allein nicht", () => {
        expect(weiterfuehrenHatEntwurf(neuerWeiterfuehrenEntwurf("Text"))).toBe(false);
        expect(weiterfuehrenHatEntwurf(entwurf())).toBe(true);
        expect(weiterfuehrenHatEntwurf({ ...neuerWeiterfuehrenEntwurf("Text"), antwort: "Ja" })).toBe(true);
        expect(weiterfuehrenHatEntwurf({ ...neuerWeiterfuehrenEntwurf("Text"), quelle: "S. 1" })).toBe(true);
    });
});

describe("🔴 die Adresse als Verweis (Eingabe von außen)", () => {
    it("ein schlichte Adresse bleibt lesbar, das @ bleibt", () => {
        expect(mailtoVon("alrike@example.org")).toBe("mailto:alrike@example.org");
        expect(mailtoVon("  Alrike.Fischer+karte@example.org ")).toBe("mailto:Alrike.Fischer+karte@example.org");
    });

    it("was aus der Adresse mehr machen könnte, wird kodiert: Kopfzeilen, Text, weitere Empfänger, Fragment", () => {
        const verweis = mailtoVon("a@b.de?bcc=chef@example.org&body=Hallo");
        expect(verweis).toBe("mailto:a@b.de%3Fbcc%3Dchef@example.org%26body%3DHallo");
        expect(verweis).not.toMatch(/[?&#,;=]/u);
        expect(mailtoVon("a@b.de,c@d.de")).not.toContain(",");
        expect(mailtoVon("a@b.de;c@d.de")).not.toContain(";");
        expect(mailtoVon("a@b.de#x")).not.toContain("#");
        expect(mailtoVon("a@b.de c@d.de")).not.toContain(" ");
    });
});

describe("der Verlauf einer Anfrage in Alltagssprache", () => {
    const ereignis = (
        art: string,
        teil: Partial<Extract<VerlaufEintrag, { art: "ereignis" }>> = {},
    ): VerlaufEintrag => ({
        art: "ereignis",
        ereignis: art,
        alt: null,
        neu: null,
        text: null,
        von: { id: "v", name: "Vali" },
        vomMelder: false,
        at: "2026-10-31T10:00:00.000Z",
        ...teil,
    });
    const saetze = (verlauf: VerlaufEintrag[], art: "meldung" | "anfrage"): string[] =>
        verlaufZeilen(verlauf, () => undefined, art).flatMap((z) => (z.art === "ereignis" ? [z.satz] : []));

    it("Antwort statt Rückfrage, zurück in den Eingang statt wieder geöffnet, Absender statt Melder", () => {
        const verlauf = [
            ereignis("rueckfrage"),
            ereignis("antwort", { von: null, vomMelder: true }),
            ereignis("wiedereroeffnet"),
            ereignis("zurueckgezogen", { von: null, vomMelder: true }),
        ];
        expect(saetze(verlauf, "anfrage")).toEqual([
            "Antwort gesendet · Vali",
            "Antwort des Absenders",
            "zurück in den Eingang geholt · Vali",
            "vom Absender zurückgezogen",
        ]);
        expect(saetze(verlauf, "meldung")).toEqual([
            "Rückfrage gesendet · Vali",
            "Antwort des Melders",
            "wieder geöffnet · Vali",
            "vom Melder zurückgezogen",
        ]);
    });
});

describe("die Schritte an der Leitung", () => {
    interface Aufruf {
        url: string;
        methode: string;
        body: Record<string, unknown> | undefined;
    }
    function holer(antworten: Response[]): { fetcher: typeof fetch; aufrufe: Aufruf[] } {
        const aufrufe: Aufruf[] = [];
        const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
            aufrufe.push({
                url: String(url),
                methode: init?.method ?? "GET",
                body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
            });
            const antwort = antworten.shift();
            if (antwort === undefined) throw new Error("keine Antwort vorbereitet");
            return antwort;
        }) as typeof fetch;
        return { fetcher, aufrufe };
    }
    const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const quittung = { nummer: "COM-000124", revision: 4 };

    it("die Liste der Anfragen fragt art=anfrage und das Segment; die Suche geht mit", async () => {
        const { fetcher, aufrufe } = holer([json({ zeilen: [], zaehler: {} })]);
        await ladeListe({ segment: "eingang", art: "anfrage", q: " Spielleiter " }, fetcher);
        expect(aufrufe[0]!.url).toBe("/api/community/vorgaenge?segment=eingang&art=anfrage&q=Spielleiter");
        const meldungen = holer([json({ zeilen: [], zaehler: {} })]);
        await ladeListe({ segment: "offen" }, meldungen.fetcher);
        expect(meldungen.aufrufe[0]!.url).toBe("/api/community/vorgaenge?segment=offen&art=meldung");
    });

    it("Gesendet und die Personen (für Anfragen nur mit `mails`)", async () => {
        const { fetcher, aufrufe } = holer([json({ zeilen: [] }), json({ zeilen: [] }), json([]), json([])]);
        await ladeGesendet(undefined, fetcher);
        await ladeGesendet("Antwort eins", fetcher);
        await ladePersonen(true, fetcher);
        await ladePersonen(false, fetcher);
        expect(aufrufe.map((a) => a.url)).toEqual([
            "/api/community/gesendet",
            "/api/community/gesendet?q=Antwort%20eins",
            "/api/community/personen?mails=true",
            "/api/community/personen",
        ]);
    });

    it("🔴 antworten, ins Archiv, zurück in den Eingang und als Meldung gehen mit Revision und einer Kennung je Schritt", async () => {
        const { fetcher, aufrufe } = holer([
            json(quittung),
            json(quittung),
            json(quittung),
            json({ ...quittung, meldung: "COM-000130" }),
        ]);
        // `fuehreAus` bekommt den Fetcher nur über seine Optionen; die Kurzformen gehen an `fetch`.
        const alt = globalThis.fetch;
        globalThis.fetch = fetcher;
        try {
            await antworteAnfrage("COM-000124", 3, "Ja, gern.", true);
            await insArchiv("COM-000124", 3);
            await zurueckInEingang("COM-000124", 3);
            const antwort = await fuehreAlsMeldungWeiter("COM-000124", 3, {
                kategorie: "sonstiges",
                text: "Aus der Anfrage entstanden.",
                bezug: { art: "stelle", lage: { x: 1, y: 2 } },
            });
            expect(antwort.meldung).toBe("COM-000130");
        } finally {
            globalThis.fetch = alt;
        }
        expect(aufrufe.map((a) => `${a.methode} ${a.url}`)).toEqual([
            "POST /api/community/vorgaenge/COM-000124/antworten",
            "POST /api/community/vorgaenge/COM-000124/ins-archiv",
            "POST /api/community/vorgaenge/COM-000124/zurueck-in-eingang",
            "POST /api/community/vorgaenge/COM-000124/als-meldung",
        ]);
        expect(aufrufe[0]!.body).toMatchObject({ baseRevision: 3, text: "Ja, gern.", archivieren: true });
        expect(aufrufe[1]!.body).toMatchObject({ baseRevision: 3 });
        expect(aufrufe[3]!.body).toMatchObject({ baseRevision: 3, kategorie: "sonstiges" });
        for (const a of aufrufe) expect(a.body?.["operationId"]).toMatch(/^[0-9a-f-]{36}$/u);
        // Die Kennungen sind frei, sobald die Schritte durch sind.
        expect(kennung("COM-000124", "ins-archiv")).toBeTypeOf("string");
        kennungFrei("COM-000124", "ins-archiv");
    });
});

describe("der Klick in der Glocke führt bei einer neuen Anfrage in die Mails", () => {
    it("die Steuerung gibt den Unterreiter weiter, ohne Angabe bleibt es bei den Meldungen", () => {
        const redaktion = createRedaktion();
        const gezeigt: (string | undefined)[] = [];
        redaktion.verbinde({
            fenster: createWerkzeugfenster(undefined),
            zeigeMeldungen: (unterreiter) => gezeigt.push(unterreiter),
            zeige: () => undefined,
            oeffneImEditor: () => undefined,
        });
        expect(redaktion.oeffneMeldung("COM-000124", "mails")).toBe(true);
        expect(redaktion.oeffneMeldung("COM-000125")).toBe(true);
        expect(gezeigt).toEqual(["mails", undefined]);
        expect(redaktion.vorgangFenster.value.map((f) => f.gegenstand)).toEqual(["COM-000125"]);
    });

    it("ohne Verbindung (kein Editor) öffnet nichts", () => {
        expect(createRedaktion().oeffneMeldung("COM-000124", "mails")).toBe(false);
    });
});
