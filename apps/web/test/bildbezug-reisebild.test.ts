import { afterEach, describe, expect, it } from "vitest";
import type { MediaPublicView, SubjectDetail } from "@avesmaps3d/shared";
import { setLocale, t } from "../src/i18n/i18n.ts";
import {
    ansichtBild,
    ansichtsbilder,
    eingangsbild,
    folgeMitEingaengen,
    istReisebild,
    kopfOhneKi,
    plaketteFuer,
} from "../src/info-panel/bildbezug.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { HeaderImage, PanelModel } from "../src/info-panel/panel-types.ts";
import {
    env,
    gareth,
    gebiet,
    gipfel,
    huegel,
    kraftlinie,
    reichsstrasse,
    see,
    shown,
    waldwildnis,
} from "./panel-fixtures.ts";

/**
 * Reisebilder im Kopf der Infobox (WI-0272 S5): die Beschriftung „Reisebild von …“, die Bildansicht mit Nennung, die Folge mit den Eingängen für Editoren und der Ort, den „+ Eigenes Bild hinzufügen“ braucht.
 * Wie es aussieht und was ein Klick tut, prüft die Sichtprüfung (1920 × 1080, 1280 × 800, Telefon); die Sichtbarkeit von „+“ und ⚙ prüft `info-header-kopf.test.ts`.
 *
 * Problemfälle: aus dem Fehlen eines Namens ein leeres „Reisebild von “ machen; ein Reisebild ohne sein Feld des Servers als Reisebild nehmen; einen Eingang in die Bildansicht legen; ein Ort mit Eingängen verliert
 * seine Grafik der Art; ein Gipfel, Weg oder Gebiet trägt „+“.
 */

const bild = (id: string, relation?: "place_view" | "type_image"): HeaderImage => ({
    id,
    url: `/media/sha256/aa/bb/${id.padEnd(64, "0")}.webp`,
    width: 800,
    height: 450,
    ...(relation === undefined ? {} : { relation }),
});

afterEach(() => setLocale("de"));

describe("Reisebilder im Kopf: Beschriftung, Bildansicht und Folge", () => {
    const reisebild = (id: string, name?: string, entstehung: "photo" | "ai_generated" = "photo"): HeaderImage => ({
        ...bild(id),
        relation: "reisebild",
        reisebild: { beschreibung: `Der Blick ${id}`, ...(name === undefined ? {} : { name }), entstehung },
    });
    const eingang: HeaderImage = { ...bild("e"), eingang: true };

    it("🔴 ein Reisebild: „Reisebild von {Name}“, klickbar; ohne Namen „anonym“ (die Nennung der Karte)", () => {
        const mitName = reisebild("a", "Alrik");
        expect(plaketteFuer(mitName, [mitName])).toEqual({
            bezug: "reisebild",
            text: "infoPanel.header.bildbezug.reisebild",
            name: "Alrik",
            klickbar: true,
        });
        expect(plaketteFuer(reisebild("b"), [])).toMatchObject({ bezug: "reisebild", name: "anonym" });
        // Ein Name nur aus Leerraum zählt nicht als Name.
        expect(plaketteFuer(reisebild("c", "  "), [])).toMatchObject({ name: "anonym" });
        expect(t("infoPanel.header.bildbezug.reisebild", { name: "Alrik" })).toBe("Reisebild von Alrik");
        setLocale("en");
        expect(t("infoPanel.header.bildbezug.reisebild", { name: "Alrik" })).toBe("Travel picture by Alrik");
        expect(t("photobox.karte.anonym")).toBe("anonymous");
    });

    it("🔴 das Feld des Servers entscheidet: ein Block ohne den Bezug ist ein Typbild, ein Eingang nie ein Reisebild", () => {
        const nurBlock: HeaderImage = {
            ...bild("b", "type_image"),
            reisebild: { beschreibung: "x", entstehung: "photo" },
        };
        expect(plaketteFuer(nurBlock, [])).toMatchObject({ bezug: "typbild", klickbar: false });
        expect(istReisebild(undefined)).toBe(false);
        expect(istReisebild({ ...reisebild("c"), eingang: true })).toBe(false);
    });

    it("ein Eingang: „Eingang · wartet auf Prüfung“, nicht klickbar, auch wenn er wie ein Reisebild aussähe", () => {
        expect(plaketteFuer(eingang, [eingang])).toEqual({
            bezug: "eingang",
            text: "infoPanel.header.bildbezug.eingang",
            klickbar: false,
        });
        expect(plaketteFuer({ ...reisebild("a", "Alrik"), eingang: true }, [])).toMatchObject({ bezug: "eingang" });
        expect(t("infoPanel.header.bildbezug.eingang")).toBe("Eingang · wartet auf Prüfung");
    });

    it("die Mehrzahl „Ortsansichten“ zählt allein die Ortsansichten, nicht die Reisebilder dahinter", () => {
        const folge = [bild("a", "place_view"), reisebild("b", "Alrik"), reisebild("c")];
        expect(plaketteFuer(folge[0], folge).text).toBe("infoPanel.header.bildbezug.ortsansicht");
    });

    it("die Bildansicht zeigt Ortsansichten und Reisebilder, nie einen Eingang, ein Typbild oder die Grafik der Art", () => {
        const folge = [
            bild("a", "place_view"),
            bild("t", "type_image"),
            reisebild("b", "Alrik"),
            eingang,
            { ...bild("g", "type_image"), grafik: true as const },
        ];
        expect(ansichtsbilder(folge).map((eintrag) => eintrag.id)).toEqual(["a", "b"]);
    });

    it("🔴 ein Reisebild in der Bildansicht: Beschreibung als Titel, Nennung „Bild von …“, KI-Bild gekennzeichnet, Lizenz dahinter", () => {
        const ansicht = ansichtBild({ ...reisebild("a", "Alrik", "ai_generated"), credit: "CC BY 4.0" }, "Gareth");
        expect(ansicht).toMatchObject({
            titel: "Der Blick a",
            nennung: "Bild von Alrik · CC BY 4.0",
            ki: true,
            breite: 800,
            hoehe: 450,
        });
        expect(ansichtBild(reisebild("b"), "Gareth").nennung).toBe("Bild von anonym");
        // Eine Ortsansicht bleibt, wie sie war: der Name des Orts als Titel, die Nennung der Freigabe.
        expect(ansichtBild({ ...bild("c", "place_view"), credit: "Alrik, CC BY 4.0" }, "Gareth")).toMatchObject({
            titel: "Gareth",
            nennung: "Alrik, CC BY 4.0",
        });
    });

    it("🔴 die Folge: öffentliche Bilder, dahinter die Eingänge; ohne eigenes Bild führt die Grafik der Art, Reisebilder und Eingänge reihen sich dahinter (Vali 2026-11-09)", () => {
        const grafik: HeaderImage = { ...bild("g", "type_image"), grafik: true };
        const oeffentlich = [bild("a", "place_view"), reisebild("b", "Alrik")];
        const ids = (folge: readonly HeaderImage[]): string[] => folge.map((eintrag) => eintrag.id);
        expect(ids(folgeMitEingaengen(oeffentlich, [eingang], grafik))).toEqual(["a", "b", "e"]);
        expect(ids(folgeMitEingaengen([], [eingang], grafik))).toEqual(["g", "e"]);
        // Nur Reisebilder: Sie ersetzen das Typbild nicht mehr, die Grafik der Art steht vorn.
        expect(ids(folgeMitEingaengen([reisebild("b", "Alrik")], [], grafik))).toEqual(["g", "b"]);
        expect(ids(folgeMitEingaengen([reisebild("b", "Alrik")], [eingang], grafik))).toEqual(["g", "b", "e"]);
        expect(ids(folgeMitEingaengen([reisebild("b", "Alrik")], [], undefined))).toEqual(["b"]);
        // Ein gebundenes Typbild des Ortes steht schon vorn (der Server liefert es mit): keine Grafik dazu.
        expect(ids(folgeMitEingaengen([bild("t", "type_image"), reisebild("b", "Alrik")], [], grafik))).toEqual([
            "t",
            "b",
        ]);
        expect(ids(folgeMitEingaengen([], [eingang], undefined))).toEqual(["e"]);
        // Ohne Eingang ändert sich nichts: keine Grafik als Glied, die Folge ist die des Servers.
        expect(folgeMitEingaengen(oeffentlich, [], grafik)).toEqual(oeffentlich);
        expect(folgeMitEingaengen([], [], grafik)).toEqual([]);
    });

    it("ein Eingang des Servers wird zum gestrichelten Bild des Kopfes (Kennung, private Vorschau, Maße)", () => {
        expect(
            eingangsbild({
                publicId: "11111111-1111-4111-8111-111111111111",
                url: "/api/editor/media/x/preview/intern_photobox_2048",
                breite: 640,
                hoehe: 360,
            }),
        ).toEqual({
            id: "11111111-1111-4111-8111-111111111111",
            url: "/api/editor/media/x/preview/intern_photobox_2048",
            width: 640,
            height: 360,
            eingang: true,
        });
    });
});

describe("Das Modell des Kopfes: Reisebilder und der Ort für „+“", () => {
    const reisebildView = (id: string, name?: string): MediaPublicView => ({
        id: `${id}0000000-0000-4000-8000-000000000000`.slice(0, 36),
        role: "photobox",
        url: `/media/sha256/aa/bb/${"b".repeat(64)}.webp`,
        width: 1600,
        height: 900,
        mimeType: "image/webp",
        relation: "reisebild",
        reisebild: {
            beschreibung: "Der Blick vom Hafen",
            ...(name === undefined ? {} : { name }),
            entstehung: "photo",
        },
        credit: { creator: name ?? "x", licenseName: "CC BY 4.0", attribution: name ?? "x" },
    });
    const model = (detail: SubjectDetail): PanelModel => {
        const result = panelModelOf(shown(detail), null, env());
        if (result === undefined) throw new Error("kein Modell");
        return result;
    };

    it("🔴 ein Reisebild der Antwort wird Bild des Kopfes: Bezug und Block gehen mit, unter dem Bild steht nur die Lizenz", () => {
        const m = model({ ...gareth, media: { header: [reisebildView("1", "Alrik")] } });
        expect(m.header.images).toEqual([
            {
                id: expect.any(String),
                url: expect.stringContaining("/media/sha256/"),
                width: 1600,
                height: 900,
                credit: "CC BY 4.0",
                relation: "reisebild",
                reisebild: { beschreibung: "Der Blick vom Hafen", name: "Alrik", entstehung: "photo" },
            },
        ]);
    });

    it("🔴 ein Reisebild ohne seinen Block (eine Antwort, die es nicht gibt) wird kein Reisebild", () => {
        const ohneBlock: MediaPublicView = { ...reisebildView("1", "Alrik") };
        delete (ohneBlock as { reisebild?: unknown }).reisebild;
        const m = model({ ...gareth, media: { header: [ohneBlock] } });
        expect(m.header.images[0]).not.toHaveProperty("reisebild");
        expect(m.header.images[0]?.relation).toBeUndefined();
        expect(plaketteFuer(m.header.images[0], m.header.images)).toMatchObject({ bezug: "typbild" });
    });

    it("🔴 nur ein Ort trägt `ort` für „+ Eigenes Bild hinzufügen“: Kennung, Name, Art und Lage", () => {
        expect(model(gareth).header.ort).toEqual({
            id: gareth.subject.kind === "place" ? gareth.subject.id : "",
            name: "Gareth",
            subtype: "metropole",
            x: 551.625,
            y: 532.969,
        });
        for (const detail of [huegel, see, waldwildnis, gipfel, reichsstrasse, kraftlinie, gebiet]) {
            expect(model(detail).header.ort, detail.title ?? "").toBeUndefined();
        }
    });
});

describe("Der Kopf bei „Ohne KI“ (Vali 2026-11-03)", () => {
    const reise = (id: string, entstehung: "ai_generated" | "drawing" | "photo"): HeaderImage => ({
        ...bild(id),
        relation: "reisebild",
        reisebild: { beschreibung: id, entstehung },
    });
    const kennungen = (bilder: readonly HeaderImage[]): string[] => bilder.map((b) => b.id);

    it("🔴 KI-Reisebilder und als KI gekennzeichnete Ortsansichten fallen, alles andere bleibt in seiner Reihenfolge", () => {
        const ansicht = bild("ansicht", "place_view");
        const kiAnsicht = { ...bild("ki-ansicht", "place_view"), ki: true as const };
        const bilder = [ansicht, kiAnsicht, reise("reise-ki", "ai_generated"), reise("reise-foto", "photo")];
        expect(kennungen(kopfOhneKi(bilder, []))).toEqual(["ansicht", "reise-foto"]);
    });

    it("🔴 eine Ortsansicht ohne Kennzeichen bleibt: Unbekannte Herkunft ist kein KI-Bild, nur nicht „KI-frei“", () => {
        expect(kennungen(kopfOhneKi([bild("alt", "place_view")], [bild("typ", "type_image")]))).toEqual(["alt"]);
    });

    it("🔴 bleibt nichts, kommen die zurückgehaltenen Typbilder (Vali: „rückfall auf die typbilder wie bisher“), seit WI-0281 ohne die KI-Typbilder", () => {
        const typ = bild("typ", "type_image");
        expect(kopfOhneKi([reise("a", "ai_generated"), reise("b", "ai_generated")], [typ])).toEqual([typ]);
    });

    it("ohne eigene Typbilder bleibt die Folge leer: Dann steht die Grafik der Art, wie bei jedem Ort ohne Bild", () => {
        expect(kopfOhneKi([reise("a", "ai_generated")], [])).toEqual([]);
    });

    /**
     * 🔴 Geändert mit WI-0281 (Betreiber 2026-11-05: „Es darf niemals auf die KI-Variante zurückgefallen werden“, dazu auf die Rückfrage: „die leute sind nur allergisch
     * gegen die KI-generierten“). Bis dahin galt: „ein Typbild fällt nie, auch mit Kennzeichen nicht“. Jetzt fällt ein als KI gekennzeichnetes Typbild eines Ortes, vorn wie
     * im Rückfall; eines unbekannter Herkunft bleibt wie eine Ortsansicht unbekannter Herkunft. Bleibt nichts, kommt die Grafik der Art, im Modus „Ohne KI“ die Ohne-KI-Variante
     * der Kategorie oder die graue Fläche.
     */
    it("🔴 ein KI-Typbild fällt, eines unbekannter Herkunft bleibt wie eine Ortsansicht (WI-0281)", () => {
        const ki = { ...bild("typ-ki", "type_image"), ki: true as const };
        const unbekannt = bild("typ-unbekannt", "type_image");
        expect(kopfOhneKi([ki], [])).toEqual([]);
        expect(kennungen(kopfOhneKi([ki, unbekannt], []))).toEqual(["typ-unbekannt"]);
        // Im Rückfall dieselbe Regel: zurückgehaltene KI-Typbilder kommen nicht wieder.
        expect(kopfOhneKi([reise("a", "ai_generated")], [ki])).toEqual([]);
        expect(kennungen(kopfOhneKi([reise("a", "ai_generated")], [ki, unbekannt]))).toEqual(["typ-unbekannt"]);
    });

    it("🔴 die Vorrangregel bleibt: Ortsansicht und Reisebild ohne KI vor einem Typbild des Ortes", () => {
        const typ = bild("typ", "type_image");
        expect(kennungen(kopfOhneKi([bild("ansicht", "place_view"), reise("foto", "photo")], [typ]))).toEqual([
            "ansicht",
            "foto",
        ]);
    });

    it("das Kopfmodell trägt Kennzeichen und zurückgehaltene Typbilder aus der Antwort des Servers", () => {
        const sicht = (id: string, relation: "place_view" | "type_image", ki?: true): MediaPublicView => ({
            id,
            role: "header",
            url: `/media/sha256/aa/bb/${id.padEnd(64, "0")}.webp`,
            width: 800,
            height: 450,
            mimeType: "image/webp",
            relation,
            ...(ki === undefined ? {} : { ki }),
        });
        const kopf = panelModelOf(
            shown({
                ...gareth,
                media: {
                    header: [sicht("ansicht", "place_view", true)],
                    typbilder: [sicht("typ", "type_image", true)],
                },
            }),
            null,
            env(),
        )?.header;
        expect(kopf?.images[0]?.ki).toBe(true);
        expect(kopf?.typbilder?.map((b) => b.id)).toEqual(["typ"]);
        // Auch am zurückgehaltenen Typbild kommt das Kennzeichen mit (WI-0281: es fällt dann bei „Ohne KI“).
        expect(kopf?.typbilder?.[0]?.ki).toBe(true);
    });
});
