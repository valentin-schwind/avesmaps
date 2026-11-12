import { describe, expect, it, vi } from "vitest";
import { AVENTURIA, fromRenderLngLat, sessionViewer, type SpracheEditorDetail } from "@avesmaps3d/shared";
import { fuehreAus, handgriffZeilen, visibleActions } from "../src/editor-menu/action.ts";
import { flaecheHandgriffe } from "../src/editor-menu/handgriffe-flaeche.ts";
import {
    neueTeilflaecheEintrag,
    spracheHandgriffe,
    spracheSubjekt,
    type SpracheLage,
} from "../src/editor-menu/handgriffe-sprache.ts";
import { griffAn, kartenAbschnitte, legeAn } from "../src/editor-menu/kartenmenue.ts";
import { createWerkzeugfenster } from "../src/editor-panel/werkzeugfenster.ts";
import { sprachenAmPunkt, sprachenAnStelle } from "../src/map/sprachen-auswahl.ts";
import { SPRACHE_FILL_LAYER_ID } from "../src/map/sprachen-layers.ts";
import { useSprachWahl } from "../src/map/sprachen-wahl.ts";
import type { HitContext } from "../src/map/interaction/types.ts";
import { createSprachKartenmenue } from "../src/spracheditor/sprache-kartenmenue.ts";
import { createSpracheditorFuerSeite, type SpracheditorFuerSeite } from "../src/spracheditor/spracheditor-anbindung.ts";
import { createSpracheditorSteuerung } from "../src/spracheditor/spracheditor-steuerung.ts";
import type { SprachenDaten } from "../src/spracheditor/sprachen-daten.ts";

/**
 * Die Sprachflächen im Kartenmenü und der Klick auf eine Teilfläche (WI-0261 Stufe 1; Betreiber 2026-10-31: „die sachen mit den buttons unter den
 * teilfächen zu editieren funktioniert hinten und vorne nicht und sollten eigentlich im kontextmenü sein. ich kann auch teilfächen auf der karte nicht
 * anklicken, sodass sie in der liste selektiert werden“). Problemfälle: Ein Handgriff meint die ganze Sprache statt der Teilfläche unter dem Zeiger;
 * ein Leser ohne Recht an den Sprachen kann schreiben; die Handgriffe stehen auch im Menü am Objekt oder im Infopanel (dort gibt es keine Teilfläche);
 * mehrere Sprachen unter dem Zeiger stehen ohne Liste; „Neue Teilfläche“ steht ohne gewählte Sprache; der Klick reicht die Teilfläche nicht bis
 * zum Spracheditor; ohne offenen Spracheditor öffnet der Klick ein Fenster.
 *
 * Stufe 2 („Form ändern ›“): Ein Werkzeug trägt ein anderes Wort oder Zeichen als an der Fläche; es steht ohne Teilfläche oder ohne Recht offen; es
 * startet an der ganzen Sprache, an einer anderen Teilfläche oder ohne die Stelle des Rechtsklicks; die Werkzeuge stehen flach statt unter „Form ändern ›“.
 *
 * Stufe 3 (Zerschneiden, „Mit anderer Fläche ›“, „Unterflächen ›“, „Kopieren …“): Untergruppen, Einträge, Zeichen oder Folge weichen von der Fläche ab; ein
 * Eintrag startet ohne die Quelle der Sprache, mit einer anderen Operation oder ohne die Stelle des Rechtsklicks; „Kopieren …“ öffnet kein Blatt.
 */

const GARETHI = "5d2c0000-0000-4000-8000-000000000001";
const ORKISCH = "5d2c0000-0000-4000-8000-000000000002";
const TEIL_G = "5d2c0000-0000-4000-8000-0000000000f1";
const TEIL_O = "5d2c0000-0000-4000-8000-0000000000f2";
const ALLE = ["use_editor_menu", "edit_languages"];
const viewer = sessionViewer("test", ALLE);

const lage =
    (ueber: Partial<SpracheLage> = {}): (() => SpracheLage) =>
    () => ({
        darf: true,
        bearbeiten: { mapEditing: "testwelt" } as never,
        laeuft: false,
        teilflaeche: (id) => (id === GARETHI ? TEIL_G : id === ORKISCH ? TEIL_O : undefined),
        ...ueber,
    });
const wirkung = () => ({
    oeffnen: vi.fn(),
    bearbeiten: vi.fn(),
    entfernen: vi.fn(),
    verschieben: vi.fn(),
    malen: vi.fn(),
    vereinfachen: vi.fn(),
    zerschneiden: vi.fn(),
    mitAnderer: vi.fn(),
    unterflaechen: vi.fn(),
    kopieren: vi.fn(),
});
/** Die Werkzeuge der Form (Stufe 2, Zerschneiden aus Stufe 3) in ihrer Folge, mit Wort und Zeichen der Fläche (`handgriffe-flaeche.ts`). */
const FORM: readonly (readonly [string, string, string])[] = [
    ["sprache-verschieben", "landschaftseditor.griff.verschieben", "verschieben"],
    ["sprache-zerschneiden", "landschaftseditor.griff.zerschneiden", "zerschneiden"],
    ["sprache-malen", "landschaftseditor.griff.malen", "malen"],
    ["sprache-radieren", "landschaftseditor.griff.radieren", "radieren"],
    ["sprache-vereinfachen", "landschaftseditor.griff.vereinfachen", "vereinfachen"],
];
/** „Mit anderer Fläche ›“, „Unterflächen ›“ und „Kopieren …“ (Stufe 3): Kennung, Kennung an der Fläche, Wort, Zeichen, Abschnitt. */
const ANDERE: readonly (readonly [string, string, string, string])[] = [
    ["sprache-vereinigen", "flaeche-vereinigen", "landschaftseditor.griff.vereinigen", "vereinigen"],
    [
        "sprache-vereinigen-behalten",
        "flaeche-vereinigen-behalten",
        "landschaftseditor.griff.vereinigenBehalten",
        "vereinigen",
    ],
    ["sprache-ausschneiden", "flaeche-ausschneiden", "landschaftseditor.griff.ausschneiden", "ausschneiden"],
    [
        "sprache-ausschneiden-behalten",
        "flaeche-ausschneiden-behalten",
        "landschaftseditor.griff.ausschneidenBehalten",
        "ausschneiden",
    ],
    [
        "sprache-neu-ausschneiden",
        "flaeche-neu-ausschneiden",
        "landschaftseditor.griff.neuAusschneiden",
        "neu-ausschneiden",
    ],
];
const UNTER: readonly (readonly [string, string, string, string])[] = [
    [
        "sprache-unterflaechen-vereinigen",
        "unterflaechen-vereinigen",
        "landschaftseditor.griff.unterVereinigen",
        "vereinigen",
    ],
    [
        "sprache-unterflaeche-herausloesen",
        "unterflaeche-herausloesen",
        "landschaftseditor.griff.unterHerausloesen",
        "herausloesen",
    ],
    ["sprache-unterflaeche-loeschen", "unterflaeche-loeschen", "landschaftseditor.griff.unterLoeschen", "loeschen"],
];
const KOPIEREN = ["sprache-kopieren", "flaeche-kopieren", "landschaftseditor.griff.kopieren", "kopieren"] as const;
const STUFE3 = [...ANDERE, ...UNTER, KOPIEREN];
const uebersetze = (key: string): string => `«${key}»`;
const G = spracheSubjekt({ id: GARETHI, name: "Garethi" });
const O = spracheSubjekt({ id: ORKISCH, name: "Orkisch" });

describe("Handgriffe an der Sprachfläche", () => {
    it("🔴 Folge, Zeichen und Wörter wie an der Fläche (T5, R6); nur im Kartenmenü", () => {
        const actions = spracheHandgriffe(lage(), wirkung());
        const zeilen = handgriffZeilen(actions, G, "karte");
        expect(zeilen.map((zeile) => [zeile.id, zeile.text, zeile.zeichen, zeile.gefahr, zeile.grund])).toEqual([
            ["sprache-bearbeiten", "ortseditor.handgriff.bearbeiten", "bearbeiten", false, undefined],
            ["sprache-teilflaeche-bearbeiten", "spracheditor.griff.teilflaeche", "gebietsform", false, undefined],
            ...FORM.map(([id, text, zeichen]) => [id, text, zeichen, false, undefined]),
            ...STUFE3.map(([id, , text, zeichen]) => [id, text, zeichen, false, undefined]),
            ["sprache-teilflaeche-entfernen", "spracheditor.griff.entfernen", "loeschen", true, undefined],
        ]);
        // Wort, Zeichen und Abschnitt der Werkzeuge sind die der Fläche (EDIT-0003 R6: ein Zeichen, eine Bedeutung).
        const flaeche = flaecheHandgriffe(() => ({ rechte: [], bearbeiten: undefined, laeuft: false }), {
            oeffnen: vi.fn(),
            beschriftung: vi.fn(),
            ecken: vi.fn(),
            platz: vi.fn(),
            klicksperre: vi.fn(),
            verbergen: vi.fn(),
            entfernen: vi.fn(),
        });
        for (const [id, text, zeichen] of FORM) {
            const dort = flaeche.find((action) => action.id === id.replace("sprache-", "flaeche-"));
            expect([dort?.label, dort?.zeichen, dort?.abschnitt], id).toEqual([
                text,
                zeichen,
                "landschaftseditor.griff.abschnitt.form",
            ]);
            expect(zeilen.find((zeile) => zeile.id === id)?.abschnitt).toBe("landschaftseditor.griff.abschnitt.form");
        }
        // Stufe 3: Wort, Zeichen, Abschnitt und Zeichen der Untergruppe wie an der Fläche.
        for (const [id, dortId] of STUFE3) {
            const dort = flaeche.find((action) => action.id === dortId);
            const hier = actions.find((action) => action.id === id);
            expect(dort, dortId).toBeDefined();
            expect([hier?.label, hier?.zeichen, hier?.abschnitt, hier?.abschnittZeichen, hier?.gruppe], id).toEqual([
                dort?.label,
                dort?.zeichen,
                dort?.abschnitt,
                dort?.abschnittZeichen,
                dort?.gruppe,
            ]);
        }
        // Kein Menü am Objekt (der Linksklick wählt die Teilfläche im Spracheditor) und keine Gruppe im Infopanel (dort gibt es keine Teilfläche).
        expect(visibleActions(actions, G, viewer)).toEqual([]);
        expect(handgriffZeilen(actions, G, "infopanel")).toEqual([]);
    });

    it("🔴 jeder Handgriff meint die Teilfläche unter dem Zeiger, nicht die ganze Sprache", () => {
        const tut = wirkung();
        const actions = spracheHandgriffe(lage(), tut);
        for (const id of [
            "sprache-bearbeiten",
            "sprache-teilflaeche-bearbeiten",
            ...FORM.map(([griff]) => griff),
            ...STUFE3.map(([griff]) => griff),
            "sprache-teilflaeche-entfernen",
        ])
            expect(fuehreAus(actions, id, O, viewer), id).toBe(true);
        expect(tut.oeffnen).toHaveBeenCalledWith(ORKISCH, TEIL_O);
        expect(tut.bearbeiten).toHaveBeenCalledWith(ORKISCH, TEIL_O, "Orkisch");
        expect(tut.entfernen).toHaveBeenCalledWith(ORKISCH, TEIL_O);
        expect(tut.verschieben).toHaveBeenCalledWith(ORKISCH, TEIL_O, "Orkisch");
        expect(tut.malen.mock.calls).toEqual([
            [ORKISCH, TEIL_O, "Orkisch", "malen"],
            [ORKISCH, TEIL_O, "Orkisch", "radieren"],
        ]);
        expect(tut.vereinfachen).toHaveBeenCalledWith(ORKISCH, TEIL_O, "Orkisch");
        expect(tut.zerschneiden).toHaveBeenCalledWith(ORKISCH, TEIL_O, "Orkisch");
        expect(tut.mitAnderer.mock.calls).toEqual(
            ["vereinigen", "vereinigen-behalten", "ausschneiden", "ausschneiden-behalten", "schnittmenge"].map(
                (operation) => [ORKISCH, TEIL_O, "Orkisch", operation],
            ),
        );
        expect(tut.unterflaechen.mock.calls).toEqual(
            ["vereinigen", "herausloesen", "loeschen"].map((operation) => [ORKISCH, TEIL_O, "Orkisch", operation]),
        );
        expect(tut.kopieren).toHaveBeenCalledWith(ORKISCH, TEIL_O);
    });

    it("ohne Teilfläche unter dem Zeiger steht nur „Eigenschaften bearbeiten“; es öffnet die Sprache ohne Wahl", () => {
        const tut = wirkung();
        const actions = spracheHandgriffe(lage({ teilflaeche: () => undefined }), tut);
        expect(handgriffZeilen(actions, G, "karte").map((zeile) => zeile.id)).toEqual(["sprache-bearbeiten"]);
        expect(fuehreAus(actions, "sprache-teilflaeche-bearbeiten", G, viewer)).toBe(true);
        expect(tut.bearbeiten).not.toHaveBeenCalled();
        for (const [id] of [...FORM, ...STUFE3]) fuehreAus(actions, id, G, viewer);
        expect(
            [
                tut.verschieben,
                tut.malen,
                tut.vereinfachen,
                tut.zerschneiden,
                tut.mitAnderer,
                tut.unterflaechen,
                tut.kopieren,
            ].every((griff) => griff.mock.calls.length === 0),
        ).toBe(true);
        fuehreAus(actions, "sprache-bearbeiten", G, viewer);
        expect(tut.oeffnen).toHaveBeenCalledWith(GARETHI, undefined);
    });

    it("🔴 ohne Recht an den Sprachen: „Ansehen“, Schreibendes grau mit der zuständigen Sonderrolle (Linguist, E17a) und nie ausgeführt", () => {
        const tut = wirkung();
        const actions = spracheHandgriffe(lage({ darf: false }), tut);
        const zeilen = handgriffZeilen(actions, G, "karte");
        expect(zeilen[0]).toMatchObject({ text: "ortseditor.handgriff.ansehen", zeichen: "ansehen", grund: undefined });
        expect(zeilen.filter((zeile) => zeile.grund !== undefined).map((zeile) => [zeile.id, zeile.grund])).toEqual([
            ["sprache-teilflaeche-bearbeiten", "sonderrollen.grund.sprache"],
            ...FORM.map(([id]) => [id, "sonderrollen.grund.sprache"]),
            ...STUFE3.map(([id]) => [id, "sonderrollen.grund.sprache"]),
            ["sprache-teilflaeche-entfernen", "sonderrollen.grund.sprache"],
        ]);
        expect(fuehreAus(actions, "sprache-teilflaeche-entfernen", G, viewer)).toBe(false);
        expect(fuehreAus(actions, "sprache-teilflaeche-bearbeiten", G, viewer)).toBe(false);
        for (const [id] of [...FORM, ...STUFE3]) expect(fuehreAus(actions, id, G, viewer), id).toBe(false);
        expect(tut.entfernen).not.toHaveBeenCalled();
        expect(tut.mitAnderer).not.toHaveBeenCalled();
        expect(tut.unterflaechen).not.toHaveBeenCalled();
        expect(tut.kopieren).not.toHaveBeenCalled();
        expect(tut.bearbeiten).not.toHaveBeenCalled();
        expect(tut.verschieben).not.toHaveBeenCalled();
        expect(tut.malen).not.toHaveBeenCalled();
        expect(tut.vereinfachen).not.toHaveBeenCalled();
    });

    it("im laufenden Modus fällt Schreibendes weg (T58 (3)); bei ausgeschaltetem Bearbeiten steht es grau mit dem Grund", () => {
        const laeuft = handgriffZeilen(spracheHandgriffe(lage({ laeuft: true }), wirkung()), G, "karte");
        expect(laeuft.map((zeile) => zeile.id)).toEqual(["sprache-bearbeiten"]);
        const aus = handgriffZeilen(
            spracheHandgriffe(lage({ bearbeiten: { mapEditing: "aus" } as never }), wirkung()),
            G,
            "karte",
        );
        expect(aus.find((zeile) => zeile.id === "sprache-teilflaeche-bearbeiten")?.grund).toBe(
            "ortseditor.handgriff.grund.aus",
        );
        for (const [id] of [...FORM, ...STUFE3])
            expect(aus.find((zeile) => zeile.id === id)?.grund, id).toBe("ortseditor.handgriff.grund.aus");
    });
});

describe("Sprachen im Kartenmenü", () => {
    const actions = spracheHandgriffe(lage(), wirkung());

    it("🔴 eine Sprache: gleich ihr Menü, flach; die Werkzeuge unter „Form ändern ›“, „Mit anderer Fläche ›“ und „Unterflächen ›“ wie an der Fläche", () => {
        const [objekt] = kartenAbschnitte({
            actions,
            subject: undefined,
            liste: { id: "sprachen", titel: "spracheditor.griff.hierLiegen", gegenstaende: [G] },
            anlegen: [],
            uebersetze,
        });
        expect(objekt?.id).toBe("objekt");
        expect(objekt?.eintraege.map((eintrag) => [eintrag.id, eintrag.unter?.map((unter) => unter.id)])).toEqual([
            ["sprache-bearbeiten", undefined],
            ["sprache-teilflaeche-bearbeiten", undefined],
            ["gruppe-form", FORM.map(([id]) => id)],
            ["gruppe-andere", ANDERE.map(([id]) => id)],
            ["gruppe-unter", UNTER.map(([id]) => id)],
            ["sprache-kopieren", undefined],
            ["sprache-teilflaeche-entfernen", undefined],
        ]);
        const gruppe = objekt?.eintraege[2];
        expect([gruppe?.text, gruppe?.zeichen]).toEqual(["«landschaftseditor.griff.abschnitt.form»", "verschieben"]);
        expect([objekt?.eintraege[3]?.text, objekt?.eintraege[3]?.zeichen]).toEqual([
            "«landschaftseditor.griff.abschnitt.andere»",
            "vereinigen",
        ]);
        expect([objekt?.eintraege[4]?.text, objekt?.eintraege[4]?.zeichen]).toEqual([
            "«landschaftseditor.griff.abschnitt.unter»",
            "herausloesen",
        ]);
        expect(griffAn("sprache-teilflaeche-bearbeiten", [G]).gegenstand).toBe(G);
        expect(griffAn("sprache-malen", [G])).toEqual({ griff: "sprache-malen", gegenstand: G });
    });

    it("🔴 mehrere Sprachen: „Hier liegen N Sprachen“, je Sprache ihr Untermenü; die Kennung nennt die Sprache", () => {
        const [liste] = kartenAbschnitte({
            actions,
            subject: undefined,
            liste: { id: "sprachen", titel: "spracheditor.griff.hierLiegen", gegenstaende: [O, G] },
            anlegen: [],
            uebersetze,
        });
        expect(liste?.id).toBe("sprachen");
        expect(liste?.titel).toBe("«spracheditor.griff.hierLiegen»");
        expect(liste?.eintraege.map((eintrag) => [eintrag.id, eintrag.text])).toEqual([
            [`sprache-${ORKISCH}`, "Orkisch"],
            [`sprache-${GARETHI}`, "Garethi"],
        ]);
        const unter = liste?.eintraege[1]?.unter ?? [];
        expect(unter.map((eintrag) => eintrag.id)).toEqual([
            `${GARETHI}|sprache-bearbeiten`,
            `${GARETHI}|sprache-teilflaeche-bearbeiten`,
            `${GARETHI}|gruppe-form`,
            `${GARETHI}|gruppe-andere`,
            `${GARETHI}|gruppe-unter`,
            `${GARETHI}|sprache-kopieren`,
            `${GARETHI}|sprache-teilflaeche-entfernen`,
        ]);
        expect(unter[2]?.unter?.map((eintrag) => eintrag.id)).toEqual(FORM.map(([id]) => `${GARETHI}|${id}`));
        expect(griffAn(`${GARETHI}|sprache-teilflaeche-entfernen`, [O, G])).toEqual({
            griff: "sprache-teilflaeche-entfernen",
            gegenstand: G,
        });
        expect(griffAn(`${GARETHI}|sprache-vereinfachen`, [O, G])).toEqual({
            griff: "sprache-vereinfachen",
            gegenstand: G,
        });
    });

    it("🔴 „Neue Teilfläche“ nur in Derographie › Sprachen und nur mit gewählter Sprache; zeichnet an der Stelle des Menüs", () => {
        const zeichne = vi.fn();
        let gewaehlt: string | undefined = GARETHI;
        let gezeigt = true;
        const eintrag = neueTeilflaecheEintrag(
            lage(),
            () => gewaehlt,
            () => gezeigt,
            zeichne,
        );
        const anlegen = (ansicht: "landscapes" | "standard") =>
            kartenAbschnitte({ actions: [], subject: undefined, anlegen: [eintrag], uebersetze, ansicht })[0]
                ?.eintraege[0]?.unter;
        expect(anlegen("landscapes")).toEqual([
            {
                id: "neue-teilflaeche-sprache",
                zeichen: "neue-flaeche",
                text: "«spracheditor.griff.neueTeilflaeche»",
                grund: undefined,
                hinweis: undefined,
            },
        ]);
        expect(anlegen("standard")).toBeUndefined();
        expect(legeAn([eintrag], "neue-teilflaeche-sprache", { x: 4, y: 5 })).toBe(true);
        expect(zeichne).toHaveBeenCalledWith(GARETHI, { x: 4, y: 5 });
        gezeigt = false;
        expect(anlegen("landscapes")).toBeUndefined();
        gezeigt = true;
        gewaehlt = undefined;
        expect(anlegen("landscapes")).toBeUndefined();
        expect(legeAn([eintrag], "neue-teilflaeche-sprache", { x: 4, y: 5 })).toBe(false);
        const ohneRecht = neueTeilflaecheEintrag(
            lage({ darf: false }),
            () => GARETHI,
            () => true,
            zeichne,
        );
        expect(ohneRecht.sperre()).toBe("sonderrollen.grund.sprache");
    });
});

describe("Die Teilfläche unter Klick und Rechtsklick", () => {
    const feature = (sprache: string, schluessel: string, name: string, area: number, teil?: string, id?: string) => ({
        id,
        properties: { sprache_public_id: sprache, schluessel, name, farbe: "#aa0000", area, public_id: teil },
    });

    it("je Sprache die kleinste getroffene Teilfläche; ihre Kennung aus der Kachel, sonst aus der Feature-Id", () => {
        const sprachen = sprachenAnStelle([
            feature(GARETHI, "garethi", "Garethi", 9000, "groß"),
            feature(GARETHI, "garethi", "Garethi", 50, TEIL_G),
            feature(ORKISCH, "orkisch", "Orkisch", 400, undefined, TEIL_O),
        ]);
        expect(sprachen.map((sprache) => [sprache.id, sprache.teilflaeche])).toEqual([
            [GARETHI, TEIL_G],
            [ORKISCH, TEIL_O],
        ]);
    });

    it("das Kartenmenü fragt nur die gezeichnete Ebene Sprachen", () => {
        const queryRenderedFeatures = vi.fn(() => [feature(GARETHI, "garethi", "Garethi", 50, TEIL_G)]);
        expect(sprachenAmPunkt({ getLayer: () => undefined, queryRenderedFeatures } as never, { x: 1, y: 2 })).toEqual(
            [],
        );
        const da = sprachenAmPunkt({ getLayer: () => ({}), queryRenderedFeatures } as never, { x: 1, y: 2 });
        expect(queryRenderedFeatures).toHaveBeenCalledWith([1, 2], { layers: [SPRACHE_FILL_LAYER_ID] });
        expect(da[0]?.teilflaeche).toBe(TEIL_G);
    });

    it("🔴 der Klick auf der Karte reicht die Teilfläche mit; die Legende hat keine", () => {
        const open = vi.fn();
        const wahl = useSprachWahl({ open, hint: () => undefined });
        const owner = wahl.owner();
        const klick = {
            kind: "click",
            screen: { x: 10, y: 20 },
            features: () => [feature(GARETHI, "garethi", "Garethi", 50, TEIL_G)],
        } as unknown as HitContext;
        owner.apply("click", owner.hit(klick) as never, klick);
        expect(open).toHaveBeenLastCalledWith(
            { kind: "sprache", id: GARETHI },
            expect.objectContaining({ source: "map", teilflaeche: TEIL_G }),
        );
        wahl.waehle({ id: GARETHI, schluessel: "garethi", name: "Garethi", farbe: "#ffb901" });
        expect(open.mock.calls.at(-1)?.[1]).not.toHaveProperty("teilflaeche");
    });
});

describe("Der Spracheditor folgt der Teilfläche", () => {
    const daten = {
        liste: vi.fn(async () => ({ zeilen: [] })),
        sprache: vi.fn(async () => null),
    } as unknown as SprachenDaten;
    const klick = { source: "map", camera: "target", teilflaeche: TEIL_G } as const;

    it("🔴 offen: Reiter „Flächen“ mit der Teilfläche gewählt (Wunsch); ohne offenes Fenster öffnet der Klick nichts", () => {
        const werkzeugfenster = createWerkzeugfenster(undefined);
        const steuerung = createSpracheditorSteuerung(werkzeugfenster, daten);
        expect(steuerung.geoeffnet({ kind: "sprache", id: GARETHI }, klick, true)).toBe(false);
        expect(steuerung.flaecheWunsch.value).toBeUndefined();
        expect(steuerung.fenster.value).toHaveLength(0);

        steuerung.oeffneWerkzeug();
        expect(steuerung.geoeffnet({ kind: "sprache", id: GARETHI }, klick, true)).toBe(true);
        expect(steuerung.auswahl.value).toBe(GARETHI);
        expect(steuerung.flaecheWunsch.value).toEqual({ sprache: GARETHI, flaeche: TEIL_G, frage: false, mal: 1 });
        steuerung.flaecheGesehen();
        expect(steuerung.flaecheWunsch.value).toBeUndefined();

        // „Teilfläche entfernen …“ aus dem Kartenmenü: dieselbe Wahl, dazu die Bestätigung.
        steuerung.zeigeFlaeche(ORKISCH, TEIL_O, true);
        expect(steuerung.auswahl.value).toBe(ORKISCH);
        expect(steuerung.flaecheWunsch.value).toMatchObject({ sprache: ORKISCH, flaeche: TEIL_O, frage: true });
        // „Kopieren …“ (Stufe 3): dieselbe Wahl, dazu das Blatt „Fläche kopieren“, keine Bestätigung.
        steuerung.flaecheGesehen();
        steuerung.zeigeFlaeche(GARETHI, TEIL_G, "kopieren");
        expect(steuerung.flaecheWunsch.value).toEqual({
            sprache: GARETHI,
            flaeche: TEIL_G,
            frage: false,
            kopieren: true,
            mal: 1,
        });
        // Ohne Teilfläche (etwa aus der Legende) folgt das Fenster der Sprache wie bisher, ohne neuen Wunsch.
        steuerung.flaecheGesehen();
        steuerung.geoeffnet({ kind: "sprache", id: GARETHI }, { source: "map", camera: "target" }, true);
        expect(steuerung.auswahl.value).toBe(GARETHI);
        expect(steuerung.flaecheWunsch.value).toBeUndefined();
        steuerung.destroy();
    });

    it("🔴 ein Werkzeug und „Teilfläche bearbeiten“ stellen das offene Fenster an ihre Sprache, die Teilfläche gewählt; ohne Fenster öffnet keins (Sichtprobe 2026-10-31)", () => {
        const werkzeugfenster = createWerkzeugfenster(undefined);
        const editor = createSpracheditorFuerSeite(
            {
                werkzeugfenster,
                listenSchalter: { vorlaeufig: vi.fn(), modus: vi.fn() } as never,
                sperre: {
                    lauf: "lauf",
                    nimm: vi.fn(),
                    gib: vi.fn(),
                    beiVerlust: () => () => undefined,
                    liste: async () => [],
                } as never,
                karte: () => undefined,
                geaendert: vi.fn(),
                darfSchreiben: () => true,
                starteNeueFlaeche: vi.fn(),
                ansicht: vi.fn(),
                leuchte: vi.fn(),
                fliege: vi.fn(),
                melde: vi.fn(),
            },
            { ...daten, form: vi.fn(async () => null) } as unknown as SprachenDaten,
        );
        expect(editor.werkzeugAn(GARETHI, TEIL_G, "Garethi").id).toBe(`${GARETHI}:${TEIL_G}`);
        expect(editor.fenster.value).toHaveLength(0);
        // Das Fenster steht offen, ohne Sprache („Keine Sprache gewählt“): Das Werkzeug stellt es an Garethi, mit der Teilfläche gewählt.
        editor.oeffneWerkzeug();
        expect(editor.auswahl.value).toBeUndefined();
        editor.werkzeugAn(GARETHI, TEIL_G, "Garethi");
        expect(editor.auswahl.value).toBe(GARETHI);
        expect(editor.flaecheWunsch.value).toMatchObject({ sprache: GARETHI, flaeche: TEIL_G, frage: false });
        // „Teilfläche bearbeiten“ an einer anderen Sprache: Das Fenster bleibt nicht auf der vorher gewählten stehen.
        editor.bearbeiteFlaeche(ORKISCH, TEIL_O, "Orkisch");
        expect(editor.auswahl.value).toBe(ORKISCH);
        expect(editor.flaecheWunsch.value).toMatchObject({ sprache: ORKISCH, flaeche: TEIL_O });
        editor.form.beende();
        editor.destroy();
    });
});

describe("Die Seite bindet die Handgriffe an den Spracheditor", () => {
    function aufbau(gezeigt = true) {
        const detail = { id: GARETHI, aktiv: true } as SpracheEditorDetail;
        const editor = {
            auswahl: { value: GARETHI },
            detailVon: (id: string | undefined) => (id === GARETHI ? detail : undefined),
            zeigeFlaeche: vi.fn(),
            oeffneFuer: vi.fn(),
            bearbeiteFlaeche: vi.fn(),
            zeichneFlaeche: vi.fn(),
            werkzeugAn: vi.fn((sprache: string, flaeche: string, name?: string) => ({
                id: `${sprache}:${flaeche}`,
                quelle: { name } as never,
            })),
            sofortAn: vi.fn((_sprache: string, _flaeche: string, name?: string) => ({
                name: `${name ?? ""} · Teilfläche 1`,
                quelle: { sofort: name } as never,
            })),
        };
        const zeigeEditor = vi.fn();
        const formen = {
            verschieben: { starte: vi.fn() },
            malen: { starte: vi.fn() },
            vereinfachen: { starte: vi.fn() },
            zerschneiden: { starte: vi.fn() },
            mitAnderer: { starte: vi.fn() },
            unterflaechen: { starte: vi.fn(), vereinige: vi.fn() },
        };
        const menue = createSprachKartenmenue({
            editor: editor as unknown as SpracheditorFuerSeite,
            lage: () => ({ bearbeiten: { mapEditing: "testwelt" } as never, laeuft: false }),
            darf: () => true,
            gezeigt: () => gezeigt,
            zeigeEditor,
            formen: () => formen,
        });
        const karte = {
            getLayer: () => ({}),
            project: () => ({ x: 3, y: 4 }),
            queryRenderedFeatures: () => [
                {
                    properties: {
                        sprache_public_id: GARETHI,
                        schluessel: "garethi",
                        name: "Garethi",
                        area: 50,
                        public_id: TEIL_G,
                    },
                },
            ],
        };
        return { editor, zeigeEditor, menue, karte, formen };
    }

    it("🔴 Rechtsklick merkt die Teilfläche; Bearbeiten, Entfernen und „Eigenschaften bearbeiten“ gehen an sie", () => {
        const { editor, zeigeEditor, menue, karte } = aufbau();
        const [sprache] = menue.am(karte as never, { lng: 0, lat: 0 });
        expect(sprache).toEqual(G);
        expect(fuehreAus(menue.handgriffe, "sprache-bearbeiten", G, viewer)).toBe(true);
        expect(zeigeEditor).toHaveBeenCalledTimes(1);
        expect(editor.zeigeFlaeche).toHaveBeenLastCalledWith(GARETHI, TEIL_G);
        fuehreAus(menue.handgriffe, "sprache-teilflaeche-entfernen", G, viewer);
        expect(editor.zeigeFlaeche).toHaveBeenLastCalledWith(GARETHI, TEIL_G, true);
        fuehreAus(menue.handgriffe, "sprache-teilflaeche-bearbeiten", G, viewer);
        expect(editor.bearbeiteFlaeche).toHaveBeenCalledWith(GARETHI, TEIL_G, "Garethi");
        expect(menue.liste([G, O])).toEqual({
            id: "sprachen",
            titel: "spracheditor.griff.hierLiegen",
            gegenstaende: [G, O],
        });
        expect(legeAn([menue.anlegen], "neue-teilflaeche-sprache", { x: 7, y: 8 })).toBe(true);
        expect(editor.zeichneFlaeche).toHaveBeenCalledWith(GARETHI, { x: 7, y: 8 });
    });

    it("🔴 „Form ändern ›“ startet die Modi der Fläche an der Teilfläche, mit ihrer Quelle; Verschieben fasst sie an der Stelle des Rechtsklicks", () => {
        const { editor, menue, karte, formen } = aufbau();
        menue.am(karte as never, { lng: 1, lat: 2 });
        const kennung = `${GARETHI}:${TEIL_G}`;
        const quelle = { name: "Garethi" };
        fuehreAus(menue.handgriffe, "sprache-verschieben", G, viewer);
        expect(editor.werkzeugAn).toHaveBeenLastCalledWith(GARETHI, TEIL_G, "Garethi");
        expect(formen.verschieben.starte).toHaveBeenCalledWith(
            kennung,
            TEIL_G,
            fromRenderLngLat(AVENTURIA.coordinateSpace, { lng: 1, lat: 2 }),
            quelle,
        );
        fuehreAus(menue.handgriffe, "sprache-radieren", G, viewer);
        expect(formen.malen.starte).toHaveBeenCalledWith(kennung, TEIL_G, "radieren", quelle);
        fuehreAus(menue.handgriffe, "sprache-vereinfachen", G, viewer);
        expect(formen.vereinfachen.starte).toHaveBeenCalledWith(kennung, quelle);
    });

    it("🔴 Stufe 3: Zerschneiden, „Mit anderer Fläche ›“ und „Unterflächen ›“ starten die Modi der Fläche mit der Quelle der Sprache; „Kopieren …“ öffnet das Blatt", () => {
        const { editor, zeigeEditor, menue, karte, formen } = aufbau();
        menue.am(karte as never, { lng: 1, lat: 2 });
        const quelle = { sofort: "Garethi" };
        const start = { regionId: GARETHI, areaId: TEIL_G };
        fuehreAus(menue.handgriffe, "sprache-zerschneiden", G, viewer);
        expect(editor.sofortAn).toHaveBeenLastCalledWith(GARETHI, TEIL_G, "Garethi");
        expect(formen.zerschneiden.starte).toHaveBeenCalledWith(start, quelle);
        fuehreAus(menue.handgriffe, "sprache-ausschneiden-behalten", G, viewer);
        expect(formen.mitAnderer.starte).toHaveBeenCalledWith(
            { ...start, name: "Garethi · Teilfläche 1", operation: "ausschneiden-behalten" },
            quelle,
        );
        fuehreAus(menue.handgriffe, "sprache-unterflaechen-vereinigen", G, viewer);
        expect(formen.unterflaechen.vereinige).toHaveBeenCalledWith(start, quelle);
        fuehreAus(menue.handgriffe, "sprache-unterflaeche-loeschen", G, viewer);
        expect(formen.unterflaechen.starte).toHaveBeenCalledWith(
            { ...start, operation: "loeschen", punkt: fromRenderLngLat(AVENTURIA.coordinateSpace, { lng: 1, lat: 2 }) },
            quelle,
        );
        fuehreAus(menue.handgriffe, "sprache-kopieren", G, viewer);
        expect(zeigeEditor).toHaveBeenCalled();
        expect(editor.zeigeFlaeche).toHaveBeenLastCalledWith(GARETHI, TEIL_G, "kopieren");
    });

    it("ohne Ebene Sprachen oder mit einem anderen Gegenstand dort: keine Sprache, und die Handgriffe vergessen die alte Stelle", () => {
        const { menue, karte } = aufbau(false);
        expect(menue.am(karte as never, { lng: 0, lat: 0 })).toEqual([]);
        expect(menue.am(undefined, { lng: 0, lat: 0 })).toEqual([]);
        expect(handgriffZeilen(menue.handgriffe, G, "karte").map((zeile) => zeile.id)).toEqual(["sprache-bearbeiten"]);
    });
});
