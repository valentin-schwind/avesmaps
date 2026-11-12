import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { createServer, type ViteDevServer } from "vite";
import { createSSRApp, h, nextTick, shallowRef, watch, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MAM_EINREICHUNGEN,
    PHOTOBOX_NACHRICHT_MAX,
    PHOTOBOX_SUBMISSION_STATES,
    PHOTOBOX_TERMS_VERSION,
    type MamNavigation,
    type MediaAssetDetail,
    type MediaUsageResult,
    type PhotoboxSubmissionState,
    type PhotoboxSubmissionView,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../src/auth/api.ts";
import { da } from "../src/i18n/da.ts";
import { de } from "../src/i18n/de.ts";
import { setLocale } from "../src/i18n/i18n.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { fr } from "../src/i18n/fr.ts";
import { it as italienisch } from "../src/i18n/it.ts";
import { nl } from "../src/i18n/nl.ts";
import { pl } from "../src/i18n/pl.ts";
import { sv } from "../src/i18n/sv.ts";
import {
    NACHRICHT_MAX,
    angabenZeilen,
    darfErneutPruefen,
    darfOffline,
    dateiStand,
    einreichungRechte,
    einreichungVon,
    korrekturAnfrage,
    nachrichtFehler,
    pruefKnoepfe,
    reiter,
    veroeffentlichung,
    wirkungNachFreigabe,
    typbildName,
    wirkungText,
    zeigtNachFreigabe,
    zeigtPruefen,
    zeigtTypbildVorschau,
    zustandName,
    type EinreichungRechte,
} from "../src/medien/medien-einreichung-modell.ts";
import { createMedienOperationen, operationsFehler } from "../src/medien/medien-operationen.ts";
import { medienOffen, reisebilderStand } from "../src/medien/medien-oeffnen.ts";
import { holeMedienFensterZurueck, medienStelle, type KorrekturEntwurf } from "../src/medien/medien-stelle.ts";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";

/**
 * Der Inspector der Medienverwaltung bei einer Einreichung (WI-0272 S3, Aufgabe 18): welche Kästen, welche Knöpfe mit welchem Recht, was die Freigabe
 * bewirkt und was eine Korrektur ändert. Das Modell rechnet es, die Bauteile zeigen es; hier stehen beide.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const UUID_ORT = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b12";

const einreichung = (teil: Partial<PhotoboxSubmissionView> = {}): PhotoboxSubmissionView => ({
    publicId: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11",
    revision: 3,
    zustand: "pending",
    eingereichtAm: "2026-11-01T10:00:00.000Z",
    beschreibung: "Pfad am Dorfrand",
    entstehung: "photo",
    nutzung: "avesmaps_only",
    lage: { x: 300, y: 310.25 },
    bedingungen: PHOTOBOX_TERMS_VERSION,
    angepasst: false,
    ...teil,
});

const REVIEWER: EinreichungRechte = einreichungRechte(["view_media_private", "moderate_submissions"]);
const EDITOR: EinreichungRechte = einreichungRechte(["view_media_private", "moderate_submissions", "publish_media"]);
const NIEMAND: EinreichungRechte = einreichungRechte(["view_media_private"]);

const aktionen = (
    zustand: PhotoboxSubmissionState,
    rechte: EinreichungRechte,
    teil: Partial<PhotoboxSubmissionView> = {},
) => pruefKnoepfe(einreichung({ zustand, ...teil }), rechte).map((knopf) => knopf.aktion);

describe("Rechte und der Inspector bei einer Einreichung", () => {
    it("🔴 die Kästen gibt es nur, wo das Asset eine Einreichung hat", () => {
        expect(einreichungVon(undefined)).toBeUndefined();
        expect(einreichungVon({} as MediaAssetDetail)).toBeUndefined();
        const s = einreichung();
        expect(einreichungVon({ submission: s } as MediaAssetDetail)).toBe(s);
    });

    it("die Rechte kommen aus den Fähigkeiten der Sitzung: Prüfen und Offline nehmen sind zwei verschiedene", () => {
        expect(REVIEWER).toEqual({ moderieren: true, offlineNehmen: false });
        expect(EDITOR).toEqual({ moderieren: true, offlineNehmen: true });
        expect(NIEMAND).toEqual({ moderieren: false, offlineNehmen: false });
        expect(einreichungRechte([])).toEqual({ moderieren: false, offlineNehmen: false });
    });

    it("🔴 ohne das Recht gibt es keinen Knopf des Prüfens, in keinem Zustand", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            expect(aktionen(zustand, NIEMAND, { wartendeBeschreibung: "x" }), zustand).toEqual([]);
        }
    });

    it("zu prüfen (geprüft oder Rückfrage): Freigeben, Rückfrage, Ablehnen, Korrigieren, alle frei", () => {
        for (const zustand of ["pending", "changes_requested"] as const) {
            const knoepfe = pruefKnoepfe(einreichung({ zustand }), REVIEWER);
            expect(knoepfe, zustand).toEqual([
                { aktion: "freigeben" },
                { aktion: "rueckfrage" },
                { aktion: "ablehnen" },
                { aktion: "korrigieren" },
            ]);
        }
    });

    it("vor der technischen Prüfung und nach einem Fehler der Datei stehen sie da, aber gesperrt mit ihrem Satz", () => {
        for (const [zustand, grund] of [
            ["incoming", "medien.einreichung.gesperrt.datei"],
            ["technical_failed", "medien.einreichung.gesperrt.fehler"],
        ] as const) {
            const knoepfe = pruefKnoepfe(einreichung({ zustand }), REVIEWER);
            expect(
                knoepfe.map((knopf) => knopf.aktion),
                zustand,
            ).toEqual(["freigeben", "rueckfrage", "ablehnen", "korrigieren"]);
            for (const knopf of knoepfe) expect(knopf.gesperrt, `${zustand} ${knopf.aktion}`).toBe(grund);
        }
    });

    it("nach der Freigabe: nur „Neue Beschreibung übernehmen“, wenn eine wartet, und „Korrigieren“", () => {
        expect(aktionen("approved", REVIEWER)).toEqual(["korrigieren"]);
        expect(aktionen("approved", REVIEWER, { wartendeBeschreibung: "Neu" })).toEqual(["uebernehmen", "korrigieren"]);
    });

    it("entschieden und beendet: weder Knöpfe noch die Kästen „Prüfen“ und „Nach der Freigabe“", () => {
        for (const zustand of ["rejected", "withdrawn", "offline", "expired", "purged"] as const) {
            expect(aktionen(zustand, EDITOR), zustand).toEqual([]);
            expect(zeigtPruefen({ zustand }), zustand).toBe(false);
            expect(zeigtNachFreigabe({ zustand }), zustand).toBe(false);
        }
        for (const zustand of ["incoming", "technical_failed", "pending", "changes_requested", "approved"] as const) {
            expect(zeigtPruefen({ zustand }), zustand).toBe(true);
        }
    });

    it("🔴 „Offline nehmen“: nur ab `publish_media` und nur bei einer freigegebenen Einreichung (ein Reviewer sieht es nicht)", () => {
        expect(darfOffline({ zustand: "approved" }, EDITOR)).toBe(true);
        expect(darfOffline({ zustand: "approved" }, REVIEWER)).toBe(false);
        expect(darfOffline({ zustand: "approved" }, NIEMAND)).toBe(false);
        for (const zustand of PHOTOBOX_SUBMISSION_STATES.filter((z) => z !== "approved")) {
            expect(darfOffline({ zustand }, EDITOR), zustand).toBe(false);
        }
    });

    it("🔴 „Erneut zur Prüfung“: wer prüfen darf (auch ein Reviewer), nur bei einer freigegebenen Einreichung", () => {
        expect(darfErneutPruefen({ zustand: "approved" }, REVIEWER)).toBe(true);
        expect(darfErneutPruefen({ zustand: "approved" }, EDITOR)).toBe(true);
        expect(darfErneutPruefen({ zustand: "approved" }, NIEMAND)).toBe(false);
        for (const zustand of PHOTOBOX_SUBMISSION_STATES.filter((z) => z !== "approved")) {
            expect(darfErneutPruefen({ zustand }, REVIEWER), zustand).toBe(false);
        }
    });

    it("die Datei steht aus dem technischen Zustand, nie von Hand: geprüft, wartet, Fehler", () => {
        expect(dateiStand("ok")).toBe("geprueft");
        expect(dateiStand("pending")).toBe("wartet");
        for (const zustand of ["decode_failed", "unsupported_format", "missing_file"] as const) {
            expect(dateiStand(zustand), zustand).toBe("fehler");
        }
    });

    it("Rückfrage und Ablehnung brauchen einen Text, höchstens so lang wie die Tafel", () => {
        expect(NACHRICHT_MAX).toBe(PHOTOBOX_NACHRICHT_MAX);
        expect(nachrichtFehler("")).toBe("medien.einreichung.nachricht.leer");
        expect(nachrichtFehler("   \n ")).toBe("medien.einreichung.nachricht.leer");
        expect(nachrichtFehler("Welcher Hafen?")).toBeUndefined();
        expect(nachrichtFehler("ä".repeat(PHOTOBOX_NACHRICHT_MAX))).toBeUndefined();
        expect(nachrichtFehler("ä".repeat(PHOTOBOX_NACHRICHT_MAX + 1))).toBe("medien.einreichung.nachricht.lang");
    });
});

describe("Nach der Freigabe: Ort mit Ortsansicht, ohne, und ohne Ort", () => {
    const ort = (teil: Partial<NonNullable<PhotoboxSubmissionView["ort"]>> = {}) => ({
        publicId: UUID_ORT,
        name: "Beispieldorf",
        typ: "dorf",
        ...teil,
    });

    it("ohne Ort: erscheint an der Stelle auf der Karte und in der Leiste", () => {
        const wirkung = wirkungNachFreigabe(einreichung());
        expect(wirkung).toEqual({ fall: "ohneOrt" });
        expect(wirkungText(wirkung).toLowerCase()).toContain("erscheint an der stelle auf der karte und in der leiste");
        expect(zeigtTypbildVorschau(wirkung)).toBe(false);
    });

    it("🔴 Ort ohne Ortsansicht: reiht sich im Kopf von {Ort} hinter das Typbild „{Art}“ (Vali 2026-11-09: ersetzt es nicht mehr)", () => {
        for (const s of [einreichung({ ort: ort() }), einreichung({ ort: ort(), ortHatOrtsansicht: false })]) {
            const wirkung = wirkungNachFreigabe(s);
            expect(wirkung).toEqual({ fall: "typbild", ort: "Beispieldorf", typ: "dorf" });
            expect(wirkungText(wirkung).toLowerCase()).toContain(
                "reiht sich im kopf von beispieldorf hinter das typbild „dorf“",
            );
            expect(zeigtTypbildVorschau(wirkung)).toBe(true);
        }
    });

    it("🔴 M8: der Name des Typbilds im Satz kommt aus den Sprachtafeln (die Ortsarten), nicht auf Deutsch in jeder Sprache", () => {
        try {
            setLocale("en");
            expect(wirkungText(wirkungNachFreigabe(einreichung({ ort: ort({ typ: "metropole" }) })))).toBe(
                "Joins the header of Beispieldorf behind the type image “Metropolis”.",
            );
            expect(typbildName("dorf")).toBe("Village");
            expect(typbildName("grossstadt")).toBe("Large city");
            setLocale("fr");
            expect(typbildName("stadt")).toBe("Ville");
            // Was keine Ortsart ist, hat in den Sprachtafeln keinen Namen und bleibt bei dem deutschen der Kategorie.
            expect(typbildName("wald")).toBe("Wald");
        } finally {
            setLocale("de");
        }
        expect(typbildName("dorf")).toBe("Dorf");
    });

    it("Ort mit Ortsansicht: reiht sich hinter die Ortsansicht, ohne Vorher-Nachher", () => {
        const wirkung = wirkungNachFreigabe(
            einreichung({ ort: ort({ name: "Gareth", typ: "metropole" }), ortHatOrtsansicht: true }),
        );
        expect(wirkung).toEqual({ fall: "ortsansicht", ort: "Gareth" });
        expect(wirkungText(wirkung).toLowerCase()).toContain("reiht sich hinter die ortsansicht");
        expect(wirkungText(wirkung)).toContain("Gareth");
        expect(zeigtTypbildVorschau(wirkung)).toBe(false);
    });

    it("die Art des Typbilds ist die Beschriftung der Grafik (Großstadt), eine unbekannte Art lässt den Namen weg statt zu raten", () => {
        expect(wirkungText(wirkungNachFreigabe(einreichung({ ort: ort({ typ: "grossstadt" }) })))).toContain(
            "„Großstadt“",
        );
        const unbekannt = wirkungNachFreigabe(einreichung({ ort: ort({ typ: "gibt-es-nicht" }) }));
        expect(unbekannt).toEqual({ fall: "typbild", ort: "Beispieldorf", typ: undefined });
        expect(wirkungText(unbekannt)).not.toContain("„");
        expect(zeigtTypbildVorschau(unbekannt)).toBe(false);
    });
});

describe("Veröffentlichung der Einreichung (Rolle photobox)", () => {
    const verwendung = (publication: unknown, role = "photobox"): MediaUsageResult =>
        ({ usages: [{ role, publication }], sameFile: [], retired: 0 }) as unknown as MediaUsageResult;

    it("🔴 fehlt die Freigaberegel, lautet die Zeile „wartet auf die Freigaberegel“", () => {
        for (const reason of ["permission_needs_approval", "attribution_required"]) {
            const v = veroeffentlichung(verwendung({ public: false, reason }));
            expect(v, reason).toMatchObject({ oeffentlich: false, wartetAufRegel: true });
            expect(v?.text, reason).toBe("wartet auf die Freigaberegel");
        }
    });

    it("jeder andere Grund heißt „Nicht öffentlich: …“ wie bei jedem Asset; öffentlich sagt es schlicht", () => {
        const technisch = veroeffentlichung(verwendung({ public: false, reason: "no_published_representation" }));
        expect(technisch).toMatchObject({ oeffentlich: false, wartetAufRegel: false });
        expect(technisch?.text).toMatch(/^Nicht öffentlich: /);
        expect(veroeffentlichung(verwendung({ public: true, reason: "rule" }))).toMatchObject({
            oeffentlich: true,
            wartetAufRegel: false,
            text: "öffentlich",
        });
    });

    it("ohne Verwendung der Rolle photobox keine Zeile: nicht freigegeben, zurückgenommen oder eine andere Rolle", () => {
        expect(veroeffentlichung(undefined)).toBeUndefined();
        expect(veroeffentlichung(verwendung(null))).toBeUndefined();
        expect(veroeffentlichung(verwendung({ public: true, reason: "rule" }, "header"))).toBeUndefined();
        expect(
            veroeffentlichung({ usages: [], sameFile: [], retired: 0 } as unknown as MediaUsageResult),
        ).toBeUndefined();
    });
});

describe("Angaben des Einsenders", () => {
    const zeilen = (teil: Partial<PhotoboxSubmissionView> = {}) =>
        Object.fromEntries(angabenZeilen(einreichung(teil)).map((zeile) => [zeile.id, zeile]));

    it("alles, was der Einsender schickte: Beschreibung, Entstehung, Nutzung, Blickrichtung, Name, Bedingungen, eingereicht am, angepasst", () => {
        const z = zeilen({
            blickrichtung: 2,
            name: "Alrik Testmann",
            ort: { publicId: UUID_ORT, name: "Gareth", typ: "metropole" },
            bezug: { art: "landschaft", id: "name:Svellt" },
        });
        expect(z["beschreibung"]?.wert).toBe("Pfad am Dorfrand");
        expect(z["entstehung"]?.wert).toBe("Foto");
        expect(z["nutzung"]?.wert).toBe("Nur für Avesmaps");
        expect(z["blick"]?.wert).toBe("Osten");
        expect(z["name"]?.wert).toBe("Alrik Testmann");
        expect(z["stelle"]?.wert).toBe("300 / 310.3");
        expect(z["ort"]?.wert).toBe("Gareth");
        expect(z["bezug"]?.wert).toBe("Landschaft: Svellt");
        expect(z["bedingungen"]?.wert).toBe(PHOTOBOX_TERMS_VERSION);
        expect(z["eingereicht"]?.wert).toMatch(/\d{2}\.\d{2}\.2026/);
        expect(z["angepasst"]?.wert).toBe("nein");
    });

    it("die Marke „intern“ steht einmal am Kasten, nicht an jeder Zeile (alles hier ist privat: der Name des Einsenders steht nur in der Medienverwaltung)", () => {
        for (const zeile of angabenZeilen(einreichung())) expect(zeile.intern, zeile.id).toBe(false);
    });

    it("🔴 die wartende Beschreibung steht neben der geltenden und warnt; ohne sie gibt es die Zeile nicht", () => {
        expect(zeilen()["wartend"]).toBeUndefined();
        const z = zeilen({ wartendeBeschreibung: "Neu gefasst", nachricht: "Welcher Hafen?" });
        expect(z["wartend"]).toMatchObject({ wert: "Neu gefasst", ton: "warnung" });
        expect(z["beschreibung"]?.wert).toBe("Pfad am Dorfrand");
        expect(z["nachricht"]?.wert).toBe("Welcher Hafen?");
    });

    it("was fehlt, steht als Auskunft da: ohne Namen, ohne Blickrichtung, ohne Ort, ohne Bezug", () => {
        const z = zeilen();
        expect(z["name"]?.wert).toBe("ohne Namen");
        expect(z["blick"]?.wert).toBe("ohne");
        expect(z["ort"]?.wert).toBe("ohne");
        expect(z["bezug"]?.wert).toBe("ohne");
    });

    it("„von der Redaktion angepasst“ sagt ja und warnt, wenn die Redaktion Angaben änderte", () => {
        expect(zeilen({ angepasst: true })["angepasst"]).toMatchObject({ wert: "ja", ton: "warnung" });
    });
});

describe("Korrigieren: nur senden, was sich ändert", () => {
    const s = einreichung({
        beschreibung: "Pfad am Dorfrand",
        ort: { publicId: UUID_ORT, name: "Beispieldorf", typ: "dorf" },
    });
    const leer = { beschreibung: "Pfad am Dorfrand", lage: undefined, ort: undefined, bezug: undefined };

    it("unverändert gibt es nichts zu senden", () => {
        expect(korrekturAnfrage(s, leer)).toBeUndefined();
        expect(korrekturAnfrage(s, { ...leer, beschreibung: "  Pfad am Dorfrand  " })).toBeUndefined();
        expect(korrekturAnfrage(s, { ...leer, lage: { x: 300, y: 310.25 } })).toBeUndefined();
        expect(korrekturAnfrage(s, { ...leer, ort: { publicId: UUID_ORT, name: "Beispieldorf" } })).toBeUndefined();
    });

    it("die Beschreibung getrimmt, die neue Stelle, ein anderer Ort, ein Bezug", () => {
        expect(korrekturAnfrage(s, { ...leer, beschreibung: "  Der Hafen  " })).toEqual({ beschreibung: "Der Hafen" });
        expect(korrekturAnfrage(s, { ...leer, lage: { x: 301, y: 311 } })).toEqual({ lage: { x: 301, y: 311 } });
        expect(
            korrekturAnfrage(s, { ...leer, ort: { publicId: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b99", name: "Gareth" } }),
        ).toEqual({ placeId: "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b99" });
        expect(
            korrekturAnfrage(s, { ...leer, bezug: { art: "weg", id: "name:Reichsstraße", name: "Reichsstraße" } }),
        ).toEqual({
            bezug: { art: "weg", id: "name:Reichsstraße" },
        });
    });

    it("Ort und Bezug lassen sich entfernen (null), aber nur, wenn es einen gibt", () => {
        expect(korrekturAnfrage(s, { ...leer, ort: null })).toEqual({ placeId: null });
        expect(korrekturAnfrage(einreichung(), { ...leer, ort: null })).toBeUndefined();
        const mitBezug = einreichung({ bezug: { art: "weg", id: "name:Reichsstraße" } });
        expect(korrekturAnfrage(mitBezug, { ...leer, bezug: null })).toEqual({ bezug: null });
        expect(korrekturAnfrage(einreichung(), { ...leer, bezug: null })).toBeUndefined();
    });

    it("🔴 nach der Freigabe nur die Beschreibung: Stelle, Ort und Bezug fallen weg (der Server nähme sie mit 409 nicht an)", () => {
        const frei = { ...s, zustand: "approved" as const };
        expect(
            korrekturAnfrage(frei, {
                beschreibung: "Neu",
                lage: { x: 5, y: 5 },
                ort: null,
                bezug: { art: "weg", id: "x", name: "x" },
            }),
        ).toEqual({ beschreibung: "Neu" });
        expect(korrekturAnfrage(frei, { ...leer, lage: { x: 5, y: 5 }, ort: null })).toBeUndefined();
    });
});

describe("Die Reiter über der Liste", () => {
    it("Offen, Rückfrage, Erledigt mit ihrer Zahl aus der Navigation", () => {
        const nav = { einreichungen: { offen: 3, rueckfrage: 1, erledigt: 7 } } as MamNavigation;
        expect(reiter(nav)).toEqual([
            { id: "offen", text: "Offen", anzahl: 3 },
            { id: "rueckfrage", text: "Rückfrage", anzahl: 1 },
            { id: "erledigt", text: "Erledigt", anzahl: 7 },
        ]);
        expect(reiter(nav).map((eintrag) => eintrag.id)).toEqual([...MAM_EINREICHUNGEN]);
    });

    it("ohne Navigation oder von einem Server der Vorversion: ohne Zahl", () => {
        for (const nav of [undefined, {} as MamNavigation]) {
            expect(reiter(nav).map((eintrag) => eintrag.anzahl)).toEqual([undefined, undefined, undefined]);
        }
    });
});

describe("Die Sprachtafeln: jeder Schlüssel in allen neun Sprachen, mit denselben Platzhaltern", () => {
    const tafeln = { de, en, fr, nl, it: italienisch, es, pl, da, sv } as Record<string, Record<string, string>>;
    const platzhalter = (text: string): string[] =>
        [...text.matchAll(/\{(\w+)\}/g)].map((treffer) => treffer[1]!).sort();
    const praefixe = ["medien.einreichung.", "medien.korb.photobox_uploads", "medien.korbErklaerung.photobox_uploads"];
    const schluessel = Object.keys(de).filter((key) => praefixe.some((praefix) => key.startsWith(praefix)));

    it("es gibt die Schlüssel der Einreichungen", () => {
        expect(schluessel.length).toBeGreaterThan(40);
    });

    for (const [sprache, tafel] of Object.entries(tafeln)) {
        it(`${sprache}: nichts fehlt, nichts ist leer, die Platzhalter stimmen`, () => {
            for (const key of schluessel) {
                const text = tafel[key];
                expect(text, `${sprache} ${key}`).toBeTypeOf("string");
                expect(text, `${sprache} ${key}`).not.toBe("");
                expect(platzhalter(text!), `${sprache} ${key}`).toEqual(platzhalter(de[key as keyof typeof de]));
            }
        });
    }

    it("🔴 Hausregel `ui-anrede`: keine Anrede und keine Bitte in den neuen Texten (de, en); der Wächter dort bricht beim ersten fremden Treffer ab und sähe sie sonst nicht", () => {
        const anrede = /\b(du|dich|dir|dein\w*|euch|euer\w*|Ihnen)\b/i;
        const hoeflich = /[a-zäöüß,;]\s+(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;
        const aufforderung =
            /\bbitte\b|(^|[.!?:;–—]\s+|- )(Klicke|Klick|Wähle|Tippe|Drücke|Ziehe|Zieh|Nimm|Gib|Schau|Probiere|Versuche|Prüfe|Wechsle|Öffne|Setze|Lege|Halte|Achte|Beachte)\b/i;
        const enAnrede = /\b(you|your|yours|yourself)\b/i;
        const enBitte =
            /\bplease\b|[—–;]\s+(now\s+)?(set|choose|pick|select|click|tap|try|check|use|drag|open|enter)\b/i;
        const eigene = [...schluessel, "photobox.status.text.technical_failed"];
        for (const key of eigene) {
            const text = (de as Record<string, string>)[key]!.replace(/\{\w+\}/g, "");
            expect(text, key).not.toMatch(anrede);
            expect(text, key).not.toMatch(hoeflich);
            expect(text, key).not.toMatch(aufforderung);
            const englisch = (en as Record<string, string>)[key]!.replace(/\{\w+\}/g, "");
            expect(englisch, key).not.toMatch(enAnrede);
            expect(englisch, key).not.toMatch(enBitte);
        }
    });

    it("🔴 Hausregel: keine Anrede im Text des Reisebild-Status bei einer nicht lesbaren Datei (de), und er lädt zum Ersetzen oder Zurückziehen ein", () => {
        const satz = de["photobox.status.text.technical_failed"];
        expect(satz).toBe(
            "Die Datei ließ sich nicht verarbeiten. Ein anderes Bild hochladen oder die Einreichung zurückziehen.",
        );
        expect(satz).not.toMatch(/\b(du|dein\w*|dir|dich|sie|ihr\w*|euch)\b/i);
    });
});

describe("Die Bauteile, serverseitig gerendert", () => {
    let server: ViteDevServer;
    let Kasten: Component;
    let Inspektor: Component;
    /** Die Sitzung im Modulgraphen des SSR-Servers: Der Inspector liest sie dort, nicht aus dem Graphen des Tests. */
    let sitzung: { authState: { value: unknown } };

    beforeAll(async () => {
        server = await createServer({
            root: repositoryRoot,
            configFile: false,
            logLevel: "silent",
            appType: "custom",
            cacheDir: join(tmpdir(), "avesmaps-test-medien-einreichung-vite"),
            server: { middlewareMode: true, hmr: false, watch: null },
            optimizeDeps: { noDiscovery: true, include: [] },
            plugins: [vue()],
            resolve: {
                alias: [
                    {
                        find: /^@avesmaps3d\/shared$/,
                        replacement: join(repositoryRoot, "packages/shared/src/index.ts"),
                    },
                ],
            },
        });
        Kasten = (
            (await server.ssrLoadModule("/apps/web/src/medien/medien-kasten-einreichung.vue")) as { default: Component }
        ).default;
        Inspektor = (
            (await server.ssrLoadModule("/apps/web/src/medien/medien-inspektor.vue")) as { default: Component }
        ).default;
        sitzung = (await server.ssrLoadModule("/apps/web/src/auth/session-state.ts")) as typeof sitzung;
    }, 120_000);

    afterAll(async () => {
        await server.close();
    });

    const asset = (teil: Partial<MediaAssetDetail["asset"]> = {}): MediaAssetDetail["asset"] => ({
        id: "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69",
        revision: 4,
        title: null,
        kind: "image",
        assetType: "picture",
        origin: "community_upload",
        creationMethod: "photo",
        technicalState: "ok",
        moderationState: "pending",
        degradedOriginal: false,
        sourceSystem: "photobox",
        sourceRef: null,
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z",
        importedAt: null,
        ...teil,
    });
    const detail = (
        teil: Partial<PhotoboxSubmissionView> | null,
        technik: MediaAssetDetail["asset"]["technicalState"] = "ok",
    ): MediaAssetDetail =>
        ({
            asset: asset({ technicalState: technik }),
            rights: null,
            creation: null,
            ingest: [],
            legacySource: null,
            representations: [],
            suspensions: [],
            usageCount: 0,
            retiredUsageCount: 0,
            sharedFileCount: 0,
            history: [],
            evidence: [],
            mergedHere: [],
            ...(teil === null ? {} : { submission: einreichung(teil) }),
        }) as MediaAssetDetail;

    const operationen = {} as never;
    const rendereKasten = (
        d: MediaAssetDetail,
        rechte: EinreichungRechte,
        verwendung?: MediaUsageResult,
        loeschen: { darfLoeschen?: boolean; loeschenGesperrt?: string } = {},
    ): Promise<string> =>
        renderToString(
            createSSRApp({
                render: () =>
                    h(Kasten, {
                        detail: d,
                        verwendung,
                        rechte,
                        operationen,
                        vorschauUrl: "/vorschau.webp",
                        ...loeschen,
                    }),
            }),
        );
    const knopf = (html: string, aktion: string): boolean =>
        html.includes(`data-testid="medien-einreichung-${aktion}"`);

    it("🔴 „Endgültig löschen …“ steht nach der Freigabe neben „Offline nehmen“, nur mit `delete_media`, gesperrt mit demselben Grund (WI-0272)", async () => {
        const mit = await rendereKasten(detail({ zustand: "approved" }), EDITOR, undefined, { darfLoeschen: true });
        expect(knopf(mit, "offline")).toBe(true);
        expect(knopf(mit, "loeschen")).toBe(true);
        expect(mit).toContain("Endgültig löschen …");
        const ohne = await rendereKasten(detail({ zustand: "approved" }), EDITOR);
        expect(knopf(ohne, "loeschen")).toBe(false);
        const gesperrt = await rendereKasten(detail({ zustand: "approved" }), EDITOR, undefined, {
            darfLoeschen: true,
            loeschenGesperrt: "Wird noch verwendet; auch zurückgezogene Verwendungen zählen.",
        });
        expect(gesperrt).toContain("Wird noch verwendet; auch zurückgezogene Verwendungen zählen.");
        // Vor der Freigabe gibt es den Knopf nicht (offen heißt: erst freigeben oder ablehnen).
        const offen = await rendereKasten(detail({ zustand: "pending" }), EDITOR, undefined, { darfLoeschen: true });
        expect(knopf(offen, "loeschen")).toBe(false);
    });

    it("🔴 abgeschlossen (offline, zurückgezogen): „Endgültig löschen …“ steht am Bild im Kasten „Abgeschlossen“, nicht nur unter „Handlungen“", async () => {
        for (const zustand of ["offline", "withdrawn"] as const) {
            const mit = await rendereKasten(detail({ zustand }), EDITOR, undefined, { darfLoeschen: true });
            expect(mit, zustand).toContain('data-testid="medien-einreichung-abgeschlossen"');
            expect(knopf(mit, "loeschen"), zustand).toBe(true);
            expect(mit, zustand).toContain("Das Bild ist nicht öffentlich.");
            const ohne = await rendereKasten(detail({ zustand }), EDITOR);
            expect(ohne, zustand).not.toContain('data-testid="medien-einreichung-abgeschlossen"');
        }
        const frei = await rendereKasten(detail({ zustand: "approved" }), EDITOR, undefined, { darfLoeschen: true });
        expect(frei).not.toContain('data-testid="medien-einreichung-abgeschlossen"');
    });

    it("🔴 drei Kästen: Prüfen, Nach der Freigabe, Angaben des Einsenders", async () => {
        const html = await rendereKasten(detail({}), REVIEWER);
        for (const kasten of ["pruefen", "folge", "angaben"]) {
            expect(html, kasten).toContain(`data-testid="medien-einreichung-${kasten}"`);
        }
        expect(html).toContain("Prüfen");
        expect(html).toContain("Nach der Freigabe");
        expect(html).toContain("Angaben des Einsenders");
    });

    it("Prüfen: die Datei ist automatisch geprüft, zwei Punkte zum Abhaken, vier Knöpfe, der Satz zum persönlichen Link", async () => {
        const html = await rendereKasten(detail({}), REVIEWER);
        expect(html).toContain("Datei geprüft und gerechnet");
        expect(html).toContain("Keine erkennbaren Personen ohne Einverständnis");
        expect(html).toContain("Passt zu Aventurien und zur Stelle");
        for (const aktion of ["freigeben", "rueckfrage", "ablehnen", "korrigieren"])
            expect(knopf(html, aktion), aktion).toBe(true);
        expect(html).toContain("Rückfrage und Ablehnung erreichen den Einsender nur über seinen persönlichen Link.");
        expect(html).not.toContain('data-testid="medien-einreichung-gesperrt"');
        expect(html).not.toMatch(
            /<button[^>]*disabled[^>]*data-testid="medien-einreichung-(freigeben|rueckfrage|ablehnen|korrigieren)"/,
        );
    });

    it("🔴 die Datei steht aus dem technischen Zustand: noch nicht geprüft heißt gesperrte Knöpfe mit sichtbarem Satz", async () => {
        const html = await rendereKasten(detail({ zustand: "incoming" }, "pending"), REVIEWER);
        expect(html).toContain("Das Bild wird noch geprüft.");
        expect(html).not.toContain("Datei geprüft und gerechnet");
        expect(html).toMatch(
            /data-testid="medien-einreichung-freigeben"[^>]*disabled|disabled[^>]*data-testid="medien-einreichung-freigeben"/,
        );
    });

    it("🔴 ohne `moderate_submissions` keine Knöpfe des Prüfens, aber die Angaben und der Satz dazu", async () => {
        const html = await rendereKasten(detail({}), NIEMAND);
        for (const aktion of ["freigeben", "rueckfrage", "ablehnen", "korrigieren", "offline"]) {
            expect(knopf(html, aktion), aktion).toBe(false);
        }
        expect(html).toContain('data-testid="medien-einreichung-angaben"');
        expect(html).toContain('data-testid="medien-einreichung-kein-recht"');
    });

    it("🔴 ein Reviewer ohne `publish_media` sieht kein „Offline nehmen“, ein Editor schon, und nur bei einer freigegebenen Einreichung", async () => {
        const frei = detail({ zustand: "approved" });
        expect(knopf(await rendereKasten(frei, REVIEWER), "offline")).toBe(false);
        expect(await rendereKasten(frei, REVIEWER)).not.toContain("Offline nehmen");
        const html = await rendereKasten(frei, EDITOR);
        expect(knopf(html, "offline")).toBe(true);
        expect(html).toContain("Offline nehmen");
        expect(knopf(await rendereKasten(detail({}), EDITOR), "offline")).toBe(false);
    });

    it("nach der Freigabe: die Zeile der Veröffentlichung und „Erneut zur Prüfung“; keine Knöpfe zum Freigeben mehr, kein Satz zu einem Ausbau", async () => {
        const verwendung = {
            usages: [{ role: "photobox", publication: { public: false, reason: "permission_needs_approval" } }],
        } as unknown as MediaUsageResult;
        const html = await rendereKasten(detail({ zustand: "approved" }), EDITOR, verwendung);
        expect(html).toContain("wartet auf die Freigaberegel");
        expect(html).not.toContain("folgen mit dem nächsten Ausbau");
        expect(knopf(html, "erneut")).toBe(true);
        expect(html).toContain("Erneut zur Prüfung");
        expect(knopf(await rendereKasten(detail({ zustand: "approved" }), NIEMAND, verwendung), "erneut")).toBe(false);
        expect(knopf(await rendereKasten(detail({}), REVIEWER), "erneut")).toBe(false);
        expect(knopf(html, "freigeben")).toBe(false);
        expect(knopf(html, "korrigieren")).toBe(true);
    });

    it("Nach der Freigabe nennt Ort und Typbild; Typbild und Reisebild nebeneinander nur, wo es sich hinter das Typbild reiht", async () => {
        const ort = { publicId: UUID_ORT, name: "Beispieldorf", typ: "dorf" };
        const ersetzt = await rendereKasten(detail({ ort, ortHatOrtsansicht: false }), REVIEWER);
        expect(ersetzt).toContain("Reiht sich im Kopf von Beispieldorf hinter das Typbild „Dorf“.");
        expect(ersetzt).toContain("zuerst: Typbild");
        expect(ersetzt).toContain('data-testid="medien-einreichung-vorher"');
        const dahinter = await rendereKasten(detail({ ort, ortHatOrtsansicht: true }), REVIEWER);
        expect(dahinter).toContain("hinter die Ortsansicht");
        expect(dahinter).not.toContain('data-testid="medien-einreichung-vorher"');
        const ohne = await rendereKasten(detail({}), REVIEWER);
        expect(ohne).toContain("Erscheint an der Stelle auf der Karte und in der Leiste.");
    });

    it("beendet (abgelehnt, offline …): nur noch die Angaben des Einsenders", async () => {
        const html = await rendereKasten(detail({ zustand: "rejected" }), EDITOR);
        expect(html).toContain('data-testid="medien-einreichung-angaben"');
        expect(html).not.toContain('data-testid="medien-einreichung-pruefen"');
        expect(html).not.toContain('data-testid="medien-einreichung-folge"');
    });

    it("🔴 der Kasten der Angaben trägt die Marke „intern“ genau einmal", async () => {
        const html = await rendereKasten(detail({ name: "Alrik" }), REVIEWER);
        const angaben = html.slice(html.indexOf('data-testid="medien-einreichung-angaben"'));
        expect(angaben.match(/data-testid="medien-intern"/gu)).toHaveLength(1);
        expect(angaben).toContain("Alrik");
    });

    it("🔴 aus der Kartenwahl zurück öffnet die Korrektur gleich mit der neuen Stelle", async () => {
        const html = await renderToString(
            createSSRApp({
                render: () =>
                    h(Kasten, {
                        detail: detail({}),
                        verwendung: undefined,
                        rechte: REVIEWER,
                        operationen,
                        neueStelle: { x: 411, y: 255.5 },
                    }),
            }),
        );
        expect(html).toContain('data-testid="medien-einreichung-korrigieren-form"');
        expect(html).toMatch(/data-testid="medien-einreichung-korrektur-stelle"[^>]*>[^<]*neu: 411 \/ 255.5/u);
        // Nach der Freigabe lässt sich die Stelle nicht mehr ändern: dort öffnet sie nichts.
        const frei = await renderToString(
            createSSRApp({
                render: () =>
                    h(Kasten, {
                        detail: detail({ zustand: "approved" }),
                        verwendung: undefined,
                        rechte: REVIEWER,
                        operationen,
                        neueStelle: { x: 411, y: 255.5 },
                    }),
            }),
        );
        expect(frei).not.toContain('data-testid="medien-einreichung-korrigieren-form"');
    });

    it("🔴 der Entwurf der Korrektur kommt mit zurück, auch ohne neue Stelle (Abbruch mit Esc): Beschreibung, entfernter Ort, Suchtext und die frühere Stelle", async () => {
        const entwurf: KorrekturEntwurf = {
            beschreibung: "Neu gefasst am Markt",
            lage: { x: 123, y: 45.5 },
            ort: null,
            bezug: { art: "weg", id: "weg:Reichsstrasse", name: "Reichsstraße" },
            suche: "Gar",
        };
        const mitOrt = detail({ ort: { publicId: UUID_ORT, name: "Beispieldorf", typ: "dorf" } });
        const html = await renderToString(
            createSSRApp({
                render: () =>
                    h(Kasten, { detail: mitOrt, verwendung: undefined, rechte: REVIEWER, operationen, entwurf }),
            }),
        );
        expect(html).toContain('data-testid="medien-einreichung-korrigieren-form"');
        expect(html).toContain("Neu gefasst am Markt");
        // Der Ort der Einreichung wurde entfernt, der gewählte Bezug steht da.
        expect(html).not.toContain('data-testid="medien-einreichung-chip-ort"');
        expect(html).toContain('data-testid="medien-einreichung-chip-bezug"');
        expect(html).toMatch(/data-testid="medien-einreichung-korrektur-stelle"[^>]*>[^<]*neu: 123 \/ 45.5/u);
        expect(html).toMatch(/<input[^>]*value="Gar"/u);
        // Mit der neuen Stelle von der Karte gewinnt sie gegen die frühere.
        const mit = await renderToString(
            createSSRApp({
                render: () =>
                    h(Kasten, {
                        detail: mitOrt,
                        verwendung: undefined,
                        rechte: REVIEWER,
                        operationen,
                        entwurf,
                        neueStelle: { x: 411, y: 255.5 },
                    }),
            }),
        );
        expect(mit).toContain("Neu gefasst am Markt");
        expect(mit).toMatch(/data-testid="medien-einreichung-korrektur-stelle"[^>]*>[^<]*neu: 411 \/ 255.5/u);
        // Nach der Freigabe lässt sich nichts davon mehr ändern: Dort öffnet der Entwurf nichts.
        const frei = await renderToString(
            createSSRApp({
                render: () =>
                    h(Kasten, {
                        detail: detail({ zustand: "approved" }),
                        verwendung: undefined,
                        rechte: REVIEWER,
                        operationen,
                        entwurf,
                    }),
            }),
        );
        expect(frei).not.toContain('data-testid="medien-einreichung-korrigieren-form"');
    });

    it("die Angaben tragen die wartende Beschreibung und „von der Redaktion angepasst“", async () => {
        const html = await rendereKasten(detail({ wartendeBeschreibung: "Neu gefasst", angepasst: true }), REVIEWER);
        expect(html).toContain("Neu gefasst");
        expect(html).toContain("von der Redaktion angepasst");
        expect(html).toContain("Pfad am Dorfrand");
    });

    /** Der Inspector mit einem Asset: `daten` ist nur, was er liest. */
    const rendereInspektor = async (d: MediaAssetDetail, faehigkeiten: string[]): Promise<string> => {
        sitzung.authState.value = {
            known: true,
            authEnabled: true,
            environment: null,
            person: null,
            capabilities: faehigkeiten,
        };
        const daten = {
            detail: shallowRef({ wert: d, laedt: false, fehler: undefined }),
            verwendung: shallowRef({ wert: { usages: [], sameFile: [], retired: 0 }, laedt: false, fehler: undefined }),
            galerien: shallowRef([]),
            erneutAsset: () => undefined,
            erneutListe: () => undefined,
            erneutNavigation: () => undefined,
        };
        return renderToString(
            createSSRApp({
                render: () =>
                    h(Inspektor, {
                        daten,
                        asset: d.asset.id,
                        zusammenfassung: undefined,
                        telefon: false,
                        treffer: 1,
                        operationen,
                    }),
            }),
        );
    };

    it("🔴 der Inspector zeigt die Kästen nur bei Einreichungen", async () => {
        const mit = await rendereInspektor(detail({}), ["view_media_private", "moderate_submissions"]);
        expect(mit).toContain('data-testid="medien-einreichung-pruefen"');
        expect(mit).toContain('data-testid="medien-einreichung-angaben"');
        const ohne = await rendereInspektor(detail(null), ["view_media_private", "moderate_submissions"]);
        expect(ohne).not.toContain("medien-einreichung-");
        expect(ohne).toContain('data-testid="medien-handlungen"');
    });

    it("🔴 im Inspector: ein Reviewer ohne `publish_media` sieht kein „Offline nehmen“ an einer freigegebenen Einreichung", async () => {
        const frei = detail({ zustand: "approved" });
        expect(await rendereInspektor(frei, ["view_media_private", "moderate_submissions"])).not.toContain(
            "medien-einreichung-offline",
        );
        expect(await rendereInspektor(frei, ["view_media_private", "moderate_submissions", "publish_media"])).toContain(
            "medien-einreichung-offline",
        );
    });
});

describe("Die Operationen der Redaktion im Browser", () => {
    const ID = "0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b11";
    const OP = "11111111-2222-4333-8444-555555555555";
    const quittung = {
        operationId: OP,
        status: "applied",
        environment: "development",
        affected: [{ kind: "media_submission", id: ID, revision: 4 }],
        derivedWork: [],
        warnings: [],
    };

    function aufzeichner(): { fetcher: typeof fetch; aufrufe: { url: string; body: Record<string, unknown> }[] } {
        const aufrufe: { url: string; body: Record<string, unknown> }[] = [];
        const fetcher = (async (url: string, init?: RequestInit) => {
            aufrufe.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
            return new Response(JSON.stringify(quittung), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }) as typeof fetch;
        return { fetcher, aufrufe };
    }

    it("🔴 jede Operation geht an ihre Adresse unter der Kennung der EINREICHUNG, mit ihrer Revision im Rumpf", async () => {
        const { fetcher, aufrufe } = aufzeichner();
        const ops = createMedienOperationen({ fetcher });
        const basis = { operationId: OP, baseRevision: 3 };
        await ops.reisebildFreigeben(ID, basis);
        await ops.reisebildRueckfrage(ID, { ...basis, nachricht: "Welcher Hafen?" });
        await ops.reisebildAblehnen(ID, { ...basis, grund: "Nicht aus Aventurien." });
        await ops.reisebildKorrigieren(ID, { ...basis, beschreibung: "Der Hafen", placeId: null });
        await ops.reisebildOffline(ID, basis);
        await ops.reisebildErneutPruefen(ID, basis);
        expect(aufrufe.map((aufruf) => aufruf.url)).toEqual(
            ["approve", "ask", "reject", "correct", "offline", "reopen"].map(
                (aktion) => `/api/editor/media/photobox/${ID}/${aktion}`,
            ),
        );
        expect(aufrufe.map((aufruf) => aufruf.body["baseRevision"])).toEqual([3, 3, 3, 3, 3, 3]);
        expect(aufrufe[1]!.body).toEqual({ ...basis, nachricht: "Welcher Hafen?" });
        expect(aufrufe[2]!.body).toEqual({ ...basis, grund: "Nicht aus Aventurien." });
        expect(aufrufe[3]!.body).toEqual({ ...basis, beschreibung: "Der Hafen", placeId: null });
    });

    it("🔴 jede gelungene Operation sagt dem Stapel Bescheid (`reisebilderStand`), eine gescheiterte nicht (Review S3 I3)", async () => {
        const { fetcher } = aufzeichner();
        const ops = createMedienOperationen({ fetcher });
        const basis = { operationId: OP, baseRevision: 3 };
        const davor = reisebilderStand.value;
        await ops.reisebildFreigeben(ID, basis);
        await ops.reisebildRueckfrage(ID, { ...basis, nachricht: "Welcher Hafen?" });
        await ops.reisebildAblehnen(ID, { ...basis, grund: "Nicht aus Aventurien." });
        await ops.reisebildKorrigieren(ID, { ...basis, beschreibung: "Der Hafen" });
        await ops.reisebildOffline(ID, basis);
        expect(reisebilderStand.value - davor).toBe(5);
        const kaputt = createMedienOperationen({
            fetcher: (async () =>
                new Response(JSON.stringify({ error: { code: "edit_conflict", message: "x" } }), {
                    status: 409,
                    headers: { "content-type": "application/json" },
                })) as typeof fetch,
        });
        await expect(kaputt.reisebildFreigeben(ID, basis)).rejects.toBeDefined();
        expect(reisebilderStand.value - davor, "ein Fehler zählt nicht").toBe(5);
    });

    it("ein Konflikt nennt die Person; ein Zustand, der es nicht erlaubt, heißt es so und lädt zum Neuladen ein", () => {
        const konflikt = operationsFehler(
            new ApiFailure(409, "edit_conflict", "", {
                currentRevision: 5,
                changedAt: "2026-11-01T12:00:00.000Z",
                changedBy: { id: "1b2c3d4e-0000-4000-8000-000000000001", displayName: "Thalionmel" },
            }),
        );
        expect(konflikt.konflikt?.currentRevision).toBe(5);
        expect(konflikt.text).toContain("Thalionmel");
        const uebergang = operationsFehler(new ApiFailure(409, "photobox_transition", "x"));
        expect(uebergang.text).toBe(de["medien.op.photoboxUebergang"]);
        expect(uebergang.konflikt).toBeUndefined();
        expect(operationsFehler(new ApiFailure(422, "photobox_invalid", "x")).text).toBe(
            de["medien.op.photoboxUngueltig"],
        );
    });
});

describe("Stelle auf der Karte wählen (Kartenwahl der Korrektur)", () => {
    const ASSET = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";

    it("🔴 die Wahl gibt die Karte frei (die Medienverwaltung geht zu) und bringt sie mit der Stelle zurück, beim selben Asset", () => {
        medienOffen.value = true;
        medienStelle.starte(ASSET);
        expect(medienStelle.waehlen.value).toBe(true);
        expect(medienOffen.value).toBe(false);
        expect(medienStelle.ergebnis.value).toBeUndefined();

        medienStelle.setze({ x: 400, y: 300 });
        expect(medienStelle.waehlen.value).toBe(false);
        expect(medienOffen.value).toBe(true);
        expect(medienStelle.ergebnis.value).toEqual({ asset: ASSET, lage: { x: 400, y: 300 } });

        medienStelle.verwerfe();
        expect(medienStelle.ergebnis.value).toBeUndefined();
    });

    it("Abbruch bringt die Medienverwaltung zurück, ohne Stelle; ein Klick ohne laufende Wahl tut nichts", () => {
        medienOffen.value = true;
        medienStelle.starte(ASSET);
        medienStelle.beende();
        expect(medienStelle.waehlen.value).toBe(false);
        expect(medienOffen.value).toBe(true);
        expect(medienStelle.ergebnis.value).toBeUndefined();

        medienOffen.value = false;
        medienStelle.setze({ x: 1, y: 1 });
        medienStelle.beende();
        expect(medienStelle.ergebnis.value).toBeUndefined();
        expect(medienOffen.value, "ohne laufende Wahl öffnet nichts das Fenster").toBe(false);
    });

    it("eine neue Wahl vergisst die alte Stelle", () => {
        medienStelle.starte(ASSET);
        medienStelle.setze({ x: 5, y: 6 });
        medienStelle.starte(ASSET);
        expect(medienStelle.ergebnis.value).toBeUndefined();
        medienStelle.beende();
    });

    const ENTWURF: KorrekturEntwurf = {
        beschreibung: "Neu gefasst",
        lage: undefined,
        ort: null,
        bezug: undefined,
        suche: "Gar",
    };

    it("🔴 der Entwurf der Korrektur geht mit zur Karte und kommt nach der Wahl UND nach dem Abbruch zurück, bis der Kasten ihn genommen hat", () => {
        medienStelle.starte(ASSET, ENTWURF);
        expect(medienStelle.entwurf.value).toEqual({ asset: ASSET, entwurf: ENTWURF });
        medienStelle.setze({ x: 400, y: 300 });
        expect(medienStelle.entwurf.value).toEqual({ asset: ASSET, entwurf: ENTWURF });
        medienStelle.verwerfe();
        expect(medienStelle.entwurf.value).toBeUndefined();

        medienStelle.starte(ASSET, ENTWURF);
        medienStelle.beende();
        expect(medienStelle.ergebnis.value, "Abbruch: keine Stelle").toBeUndefined();
        expect(medienStelle.entwurf.value, "Abbruch: der Entwurf bleibt").toEqual({ asset: ASSET, entwurf: ENTWURF });
        medienStelle.verwerfe();
        expect(medienStelle.entwurf.value).toBeUndefined();
    });

    it("eine neue Wahl ohne Entwurf vergisst den alten", () => {
        medienStelle.starte(ASSET, ENTWURF);
        medienStelle.beende();
        medienStelle.starte(ASSET);
        expect(medienStelle.entwurf.value).toBeUndefined();
        medienStelle.beende();
    });

    it("🔴 Lage und Größe des Werkzeugfensters kommen mit zurück: einmal abgeholt, dann vergessen", () => {
        const box = { left: 80, top: 60, width: 700, height: 520 };
        medienStelle.starte(ASSET, ENTWURF, { lage: "geloest", box });
        medienStelle.beende();
        expect(medienStelle.nimmFenster()).toEqual({ lage: "geloest", box });
        expect(medienStelle.nimmFenster()).toBeUndefined();
        // Aus dem modalen Fenster gibt es nichts zu merken.
        medienStelle.starte(ASSET, ENTWURF);
        medienStelle.beende();
        expect(medienStelle.nimmFenster()).toBeUndefined();
        medienStelle.verwerfe();
    });

    it("🔴 verdrahtet wie in app.vue: Das Werkzeugfenster steht schon wieder da, WENN die Medienverwaltung aufgeht (nach der Wahl wie nach dem Abbruch)", async () => {
        const fenster = createWerkzeugfenster(undefined);
        const box = { left: 90, top: 70, width: 640, height: 500 };
        const medien = () => fenster.stand.value.fenster.find((eintrag) => eintrag.werkzeug === "medien");
        const id = fenster.oeffne(
            { werkzeug: "medien", gegenstand: "medien", titel: "Medien", nurLesen: false },
            "geloest",
        );
        fenster.setzeLage(id, "geloest", box);
        medienOffen.value = true;
        // Die beiden Beobachter aus app.vue: Zugehen verwirft das Werkzeugfenster; das Ende der Wahl stellt es wieder hin (sync, vor `medienOffen`).
        const stopVerwerfen = watch(medienOffen, (offen) => {
            const da = medien();
            if (!offen && da) fenster.verwirf(da.id);
        });
        const stopWahl = watch(
            medienStelle.waehlen,
            (waehlt) => {
                const vorher = waehlt ? undefined : medienStelle.nimmFenster();
                if (vorher !== undefined) holeMedienFensterZurueck(fenster, vorher, "Medien");
            },
            { flush: "sync" },
        );
        let beimAufgehen: unknown;
        const stopBeobachter = watch(
            medienOffen,
            (offen) => {
                if (offen) beimAufgehen = medien();
            },
            { flush: "sync" },
        );
        try {
            for (const ende of ["setze", "beende"] as const) {
                beimAufgehen = undefined;
                medienStelle.starte(ASSET, ENTWURF, { lage: "geloest", box });
                await nextTick();
                expect(medien(), "während der Wahl ist es verworfen").toBeUndefined();
                if (ende === "setze") medienStelle.setze({ x: 1, y: 2 });
                else medienStelle.beende();
                expect(beimAufgehen, ende).toMatchObject({ werkzeug: "medien", lage: "geloest", box });
                await nextTick();
                medienStelle.verwerfe();
            }
        } finally {
            stopVerwerfen();
            stopWahl();
            stopBeobachter();
            medienOffen.value = false;
        }
    });

    it("🔴 das Werkzeugfenster steht nach der Wahl wieder da, wo es war (gelöst mit Box); ein vorhandenes bleibt, wie es ist", () => {
        const fenster = createWerkzeugfenster(undefined);
        const box = { left: 80, top: 60, width: 700, height: 520 };
        const id = fenster.oeffne(
            { werkzeug: "medien", gegenstand: "medien", titel: "Medien", nurLesen: false },
            "geloest",
        );
        fenster.setzeLage(id, "geloest", box);
        // Die Medienverwaltung geht zu, ihr Werkzeugfenster wird verworfen (app.vue).
        fenster.verwirf(id);
        expect(fenster.stand.value.fenster).toHaveLength(0);
        holeMedienFensterZurueck(fenster, { lage: "geloest", box }, "Medien");
        const da = fenster.stand.value.fenster;
        expect(da).toHaveLength(1);
        expect(da[0]).toMatchObject({ werkzeug: "medien", lage: "geloest", box });
        // Ein zweiter Aufruf legt kein zweites an.
        holeMedienFensterZurueck(fenster, { lage: "geloest", box }, "Medien");
        expect(fenster.stand.value.fenster).toHaveLength(1);
        // Angedockt kommt es auch wieder angedockt.
        const andere = createWerkzeugfenster(undefined);
        holeMedienFensterZurueck(andere, { lage: "angedockt", box: undefined }, "Medien");
        expect(andere.stand.value.fenster[0]).toMatchObject({ werkzeug: "medien", lage: "angedockt" });
    });
});

describe("Zustände der Einreichung im Korb sind vollständig benannt", () => {
    it("jeder Zustand hat seine Beschriftung für Liste und Pille (die der Statusseite)", () => {
        for (const zustand of PHOTOBOX_SUBMISSION_STATES) {
            expect(de[`photobox.status.zustand.${zustand}`], zustand).toBeTypeOf("string");
            expect(zustandName(zustand), zustand).not.toBe("");
        }
    });

    it("🔴 die Redaktion liest „Freigegeben“, nicht „Veröffentlicht“: Ob ein Bild öffentlich ist, sagt die Pille daneben (es kann auf die Freigaberegel warten)", () => {
        expect(zustandName("approved")).toBe("Freigegeben");
        expect(zustandName("pending")).toBe("In Prüfung");
        expect(zustandName("changes_requested")).toBe("Rückfrage");
    });
});
