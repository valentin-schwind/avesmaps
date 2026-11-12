import { describe, expect, it } from "vitest";
import type { MamTypeImage, MamTypeImageList } from "@avesmaps3d/shared";
import {
    TYPBILD_START,
    entstehungPasst,
    paarStand,
    sternAsset,
    typbildBild,
    typbildSlot,
    typbildFilterAnzahl,
    typbildStand,
    typbildZeile,
    typbildZeilen,
    type TypbildAnsicht,
} from "../src/medien/medien-typbilder-modell";

/**
 * Das Modell der Typbildliste (WI-0068, Betreiber 2026-10-11). Geprüft werden die Fälle, in denen eine Liste sonst still das Falsche
 * tut: eine Kategorie OHNE ★ (sie darf nie wegfallen), eine Kategorie ohne Objektzählung (`count: null` ist keine Null), und ein ★,
 * den die Policy nicht freigibt (eine private Vorschau ist kein öffentliches Bild).
 */

const eintrag = (teil: Partial<MamTypeImage> & Pick<MamTypeImage, "category" | "label">): MamTypeImage => ({
    objects: "place",
    count: 10,
    current: null,
    former: 0,
    formerItems: [],
    ...teil,
});

const stern = (assetId: string, oeffentlich: boolean): NonNullable<MamTypeImage["current"]> => ({
    assetId,
    title: "Dorf am Fluss",
    preview: oeffentlich ? { url: "/media/abc.webp", width: 64, height: 64 } : null,
    privatePreview: oeffentlich ? null : { url: "/api/editor/media/x/preview/intern_header", width: 32, height: 32 },
    revision: 3,
    since: "2026-10-12T10:00:00.000Z",
    public: oeffentlich,
});

const liste = (items: MamTypeImage[], adoptable = 0): MamTypeImageList => ({ items, adoptable });
const ansicht = (teil: Partial<TypbildAnsicht> = {}): TypbildAnsicht => ({ ...TYPBILD_START, filter: {}, ...teil });

describe("Typbildliste", () => {
    const dorf = eintrag({ category: "dorf", label: "Dorf", count: 3181, current: stern("a1", true) });
    const stadt = eintrag({ category: "stadt", label: "Stadt", count: 219 });
    // „Kraftlinien" ist die Kategorie, die keine zaehlbare Art hat (`objects: "other"`): `count` ist dort `null`,
    // und `null` ist KEINE Null - das Modell muss beides auseinanderhalten.
    const kraftlinien = eintrag({ category: "kraftlinien", label: "Kraftlinien", objects: "other", count: null });

    it("zeigt auch Kategorien ohne ★ - sie sind der Arbeitsvorrat", () => {
        const zeilen = typbildZeilen(liste([dorf, stadt, kraftlinien]), ansicht());
        expect(zeilen.map((zeile) => zeile.category)).toEqual(["dorf", "kraftlinien", "stadt"]);
    });

    it("sortiert nach Name aufsteigend und nach Objektzahl absteigend, ohne Angabe der Richtung", () => {
        const nachName = typbildZeilen(liste([dorf, stadt, kraftlinien]), ansicht({ sort: "name" }));
        expect(nachName.map((zeile) => zeile.label)).toEqual(["Dorf", "Kraftlinien", "Stadt"]);
        const nachZahl = typbildZeilen(liste([dorf, stadt, kraftlinien]), ansicht({ sort: "objekte" }));
        expect(nachZahl.map((zeile) => zeile.label)).toEqual(["Dorf", "Stadt", "Kraftlinien"]);
    });

    it("stellt eine fehlende Zählung hinten an, in BEIDEN Richtungen - sie ist keine kleine Zahl", () => {
        const ab = typbildZeilen(liste([kraftlinien, stadt, dorf]), ansicht({ sort: "objekte", order: "desc" }));
        expect(ab[ab.length - 1]?.label).toBe("Kraftlinien");
        const auf = typbildZeilen(liste([kraftlinien, stadt, dorf]), ansicht({ sort: "objekte", order: "asc" }));
        expect(auf[auf.length - 1]?.label).toBe("Kraftlinien");
    });

    it("sucht über Beschriftung, Schlüssel und Titel des ★-Assets, ohne Akzente und Groß-/Kleinschreibung", () => {
        expect(typbildZeilen(liste([dorf, stadt]), ansicht({ suche: "STADT" })).map((z) => z.category)).toEqual([
            "stadt",
        ]);
        expect(typbildZeilen(liste([dorf, stadt]), ansicht({ suche: "am fluss" })).map((z) => z.category)).toEqual([
            "dorf",
        ]);
    });

    it("filtert nach Objektart und nach dem Paar (vorher ★-Stand: „noch keines“ heißt jetzt „Kein Typbild“)", () => {
        const nurOrte = typbildZeilen(liste([dorf, stadt, kraftlinien]), ansicht({ filter: { objekte: "place" } }));
        expect(nurOrte.map((z) => z.category)).toEqual(["dorf", "stadt"]);
        const keines = typbildZeilen(liste([dorf, stadt, kraftlinien]), ansicht({ filter: { paar: "keines" } }));
        expect(keines.map((z) => z.category)).toEqual(["kraftlinien", "stadt"]);
        const nurKi = typbildZeilen(liste([dorf, stadt, kraftlinien]), ansicht({ filter: { paar: "nurKi" } }));
        expect(nurKi.map((z) => z.category)).toEqual(["dorf"]);
    });

    it("zählt die gesetzten Teile des Trichters", () => {
        expect(typbildFilterAnzahl({})).toBe(0);
        expect(typbildFilterAnzahl({ objekte: "path" })).toBe(1);
        expect(typbildFilterAnzahl({ objekte: "path", paar: "unvollstaendig" })).toBe(2);
    });

    it("nennt im Stand die gezeigten Kategorien, die ohne ★ und die übernehmbaren des Servers", () => {
        const ganz = liste([dorf, stadt, kraftlinien], 2);
        const zeilen = typbildZeilen(ganz, ansicht({ filter: { objekte: "place" } }));
        // `uebernehmbar` ist die Zahl des Servers über ALLE Kategorien, nicht die der gefilterten Ansicht.
        expect(typbildStand(zeilen, ganz)).toEqual({ gezeigt: 2, ohneStern: 1, unvollstaendig: 1, uebernehmbar: 2 });
    });

    it("findet die gewählte Kategorie nur, solange der Trichter sie zeigt", () => {
        const zeilen = typbildZeilen(liste([dorf, stadt]), ansicht({ filter: { paar: "nurKi" } }));
        expect(typbildZeile(zeilen, "dorf")?.label).toBe("Dorf");
        expect(typbildZeile(zeilen, "stadt")).toBeUndefined();
        expect(typbildZeile(zeilen, undefined)).toBeUndefined();
    });

    it("gibt ohne Liste keine Zeilen - kein Absturz, solange sie lädt", () => {
        expect(typbildZeilen(undefined, ansicht())).toEqual([]);
        expect(typbildStand([], undefined)).toEqual({ gezeigt: 0, ohneStern: 0, unvollstaendig: 0, uebernehmbar: 0 });
    });
});

describe("Welches Bild eine Zeile zeigt", () => {
    const adresse = (kategorie: string): string => `/icons/header/${kategorie}.webp`;

    it("zeigt ohne ★ die eingebaute Grafik", () => {
        const ohne = eintrag({ category: "stadt", label: "Stadt" });
        expect(typbildBild(ohne, adresse as never).art).toBe("eingebaut");
    });

    it("zeigt den freigegebenen ★ als öffentliches Bild", () => {
        const mit = eintrag({ category: "dorf", label: "Dorf", current: stern("a1", true) });
        expect(typbildBild(mit, adresse as never)).toEqual({
            art: "oeffentlich",
            url: "/media/abc.webp",
            width: 64,
            height: 64,
        });
    });

    it("🔴 zeigt einen NICHT freigegebenen ★ als interne Vorschau, nie als öffentliches Bild (A4)", () => {
        const intern = eintrag({ category: "dorf", label: "Dorf", current: stern("a1", false) });
        expect(typbildBild(intern, adresse as never).art).toBe("intern");
    });

    it("fällt auf die eingebaute Grafik zurück, wenn der ★ weder öffentliche Datei noch Vorschau hat", () => {
        const leer = eintrag({
            category: "dorf",
            label: "Dorf",
            current: { ...stern("a1", false), privatePreview: null },
        });
        expect(typbildBild(leer, adresse as never).art).toBe("eingebaut");
    });
});

/**
 * Typbildpaare (WI-0281, Betreiber 2026-11-05): je Kategorie eine KI- und eine Ohne-KI-Variante. Geprüft wird, was eine Liste sonst still verwechselt: die Felder der
 * Vorversion als KI-Variante, eine Antwort ohne `ohneKi`, das Paar als Filter und als Unterzeile, und welches Bild eine Zeile im Normalmodus zeigt.
 */
describe("Typbildpaare: Varianten, Paarstand, Filter", () => {
    const ohne = (assetId: string, oeffentlich: boolean) => ({
        current: { ...stern(assetId, oeffentlich), title: "Kleinstadt gezeichnet", creationMethod: "drawing" as const },
        former: 1,
        formerItems: [],
    });
    const paar = eintrag({
        category: "kleinstadt",
        label: "Kleinstadt",
        current: { ...stern("ki", true), creationMethod: "ai_generated" },
        ohneKi: ohne("ohne", true),
    });
    const nurOhne = eintrag({ category: "grotte", label: "Grotte", ohneKi: ohne("grotte-ohne", false) });
    const nurKi = eintrag({ category: "krater", label: "Krater", current: stern("krater-ki", true) });
    const keines = eintrag({ category: "wueste", label: "Wüste" });
    const alle = liste([paar, nurOhne, nurKi, keines]);

    it("🔴 die KI-Variante steht in den Feldern der Vorversion; eine Antwort ohne `ohneKi` hat eine leere Ohne-KI-Variante", () => {
        expect(typbildSlot(paar, "ki").current?.assetId).toBe("ki");
        expect(typbildSlot(paar, "ohne_ki").current?.assetId).toBe("ohne");
        expect(typbildSlot(nurKi, "ohne_ki")).toEqual({ current: null, former: 0, formerItems: [] });
    });

    it("🔴 der Paarstand: Paar, nur KI, nur ohne KI, keines", () => {
        expect([paar, nurKi, nurOhne, keines].map(paarStand)).toEqual(["paar", "nurKi", "nurOhneKi", "keines"]);
    });

    it("🔴 der Trichter findet unvollständige Paare, die Unterzeile zählt sie", () => {
        const offen = typbildZeilen(alle, ansicht({ filter: { paar: "unvollstaendig" } }));
        expect(offen.map((z) => z.category)).toEqual(["grotte", "krater"]);
        expect(typbildZeilen(alle, ansicht({ filter: { paar: "vollstaendig" } })).map((z) => z.category)).toEqual([
            "kleinstadt",
        ]);
        expect(typbildZeilen(alle, ansicht({ filter: { paar: "nurOhneKi" } })).map((z) => z.category)).toEqual([
            "grotte",
        ]);
        expect(typbildStand(typbildZeilen(alle, ansicht()), alle)).toMatchObject({
            gezeigt: 4,
            ohneStern: 1,
            unvollstaendig: 2,
        });
        // Die Suche kennt auch den Titel der Ohne-KI-Variante.
        expect(typbildZeilen(alle, ansicht({ suche: "gezeichnet" })).map((z) => z.category)).toEqual([
            "grotte",
            "kleinstadt",
        ]);
    });

    it("🔴 das ★-Asset je Variante: der Einstieg aus dem Infopanel öffnet im Modus „Ohne KI“ die Ohne-KI-Variante", () => {
        expect(sternAsset(alle, "kleinstadt")).toBe("ki");
        expect(sternAsset(alle, "kleinstadt", "ohne_ki")).toBe("ohne");
        expect(sternAsset(alle, "krater", "ohne_ki")).toBeUndefined();
    });

    it("das Bild einer Zeile ist das des Normalmodus: KI-Variante, sonst die Ohne-KI-Variante, sonst die eingebaute Grafik", () => {
        const adresse = (kategorie: string): string => `/icons/header/${kategorie}.webp`;
        expect(typbildBild(paar, adresse as never)).toMatchObject({ art: "oeffentlich" });
        expect(typbildBild(nurOhne, adresse as never).art).toBe("intern");
        expect(typbildBild(keines, adresse as never).art).toBe("eingebaut");
        // Mit Variante genau diese.
        expect(typbildBild(nurKi, adresse as never, "ohne_ki").art).toBe("eingebaut");
    });

    it("🔴 passt die Entstehung nicht (mehr) zur Variante, sagt es das Modell; ohne Angabe (Vorversion) gibt es nichts zu sagen", () => {
        expect(entstehungPasst(typbildSlot(paar, "ohne_ki"), "ohne_ki")).toBe(true);
        const umgetragen = {
            ...ohne("x", true),
            current: { ...ohne("x", true).current, creationMethod: "ai_generated" as const },
        };
        expect(entstehungPasst(umgetragen, "ohne_ki")).toBe(false);
        const unbekannt = { ...umgetragen, current: { ...umgetragen.current, creationMethod: "unknown" as const } };
        expect(entstehungPasst(unbekannt, "ohne_ki")).toBe(false);
        expect(entstehungPasst(unbekannt, "ki")).toBe(true);
        expect(entstehungPasst(typbildSlot(nurKi, "ki"), "ki")).toBe(true);
    });
});
