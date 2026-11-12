import { describe, expect, it, vi } from "vitest";
import { PATH_WEITERE_MAX, type EditorPathStreet, type EditorPathWeiterer } from "@avesmaps3d/shared";
import { createWegArt, felderAus, type WegStand } from "../src/wegeditor/weg-art";
import {
    chipsDerWahl,
    mitWeiterem,
    naechsterWaehlbar,
    ohneWeiteren,
    trefferGesperrt,
    trefferLage,
    weitereWechsel,
} from "../src/wegeditor/weg-weitere";
import { weitereAbsageSatz, weitereNamenText } from "../src/wegeditor/wegeditor-texte";
import { locale } from "../src/i18n/i18n";

/**
 * Die weiteren Straßennamen je Abschnitt (WI-0302, OPS-000108; Bauvorlage Entwurf „Weitere Straßennamen“ Fassung 2). Problemfälle: Ein Name
 * an einem Teil der gewählten Abschnitte steht doppelt oder gar nicht; „allen geben“ legt ihn doppelt an; ✕ löst ihn auch an nicht gewählten
 * Abschnitten; „Fertig“ schickt alle Abschnitte mit oder nur den neuen Schlüssel statt der ganzen Liste; eine umgeordnete Liste gilt als
 * Änderung; ein Konflikt verliert die eigene Liste oder überschreibt eine fremde; eine alte Sicherung ohne Namen wird geladen; der Hauptartikel
 * oder ein Name, den schon alle tragen, ist in der Suche wählbar; eine Absage des Servers steht als deutscher Satz des Servers da.
 */

const A = "0b0b0b0b-0000-4000-8000-0000000000a1";
const B = "0b0b0b0b-0000-4000-8000-0000000000a2";
const C = "0b0b0b0b-0000-4000-8000-0000000000a3";
const GOLD: EditorPathWeiterer = {
    key: "goldfelser-stieg",
    name: "Goldfelser Stieg",
    url: "https://de.wiki-aventurica.de/wiki/Goldfelser_Stieg",
};
const PILGER: EditorPathWeiterer = { key: "pilgerweg", name: "Pilgerweg" };
const STRASSE: EditorPathStreet = {
    id: A,
    name: "Sikramstieg",
    subtype: "Strasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: true,
    segments: [
        { id: A, revision: 3, labelVisible: true, wiki: true, points: 4 },
        { id: B, revision: 5, labelVisible: true, wiki: true, points: 3, weitere: [GOLD] },
        { id: C, revision: 7, labelVisible: true, wiki: true, points: 6, weitere: [GOLD, PILGER] },
    ],
};
const start: WegStand = { felder: felderAus(STRASSE), form: undefined };
const mit = (weitere: WegStand["felder"]["weitere"]): WegStand => ({
    felder: { ...start.felder, weitere },
    form: undefined,
});

describe("Weitere Straßennamen: Rechnung (WI-0302)", () => {
    it("gelesen je Abschnitt aus `segments[].weitere`; ohne Namen eine leere Liste", () => {
        expect(start.felder.weitere).toEqual({ [A]: [], [B]: [GOLD], [C]: [GOLD, PILGER] });
    });

    it("🔴 Teil-Chips: jeder Name EINMAL, mit „n von m“ der gewählten Abschnitte, in der Folge der Abschnitte", () => {
        expect(chipsDerWahl(start.felder.weitere, [A, B, C])).toEqual([
            { ...GOLD, anzahl: 2, von: 3 },
            { ...PILGER, anzahl: 1, von: 3 },
        ]);
        expect(chipsDerWahl(start.felder.weitere, [B])).toEqual([{ ...GOLD, anzahl: 1, von: 1 }]);
        expect(chipsDerWahl(start.felder.weitere, [A])).toEqual([]);
    });

    it("🔴 „allen geben“ gibt den Namen jedem gewählten Abschnitt, wo er fehlt, nie doppelt; die nicht gewählten bleiben", () => {
        const neu = mitWeiterem(start.felder.weitere, [A, B], GOLD);
        expect(neu[A]).toEqual([GOLD]);
        expect(neu[B]).toEqual([GOLD]);
        expect(neu[C]).toBe(start.felder.weitere[C]);
        expect(chipsDerWahl(neu, [A, B, C])[0]).toMatchObject({ key: GOLD.key, anzahl: 3, von: 3 });
        // Ein Abschnitt mit der Höchstzahl bleibt, wie er ist (der Server lehnte ihn sonst ab).
        const voll = Array.from({ length: PATH_WEITERE_MAX }, (_, i) => ({
            key: `k${String(i)}`,
            name: `N${String(i)}`,
        }));
        expect(mitWeiterem({ [A]: voll }, [A], GOLD)[A]).toHaveLength(PATH_WEITERE_MAX);
    });

    it("🔴 ✕ löst den Namen von allen gewählten Abschnitten und nur von ihnen", () => {
        const neu = ohneWeiteren(start.felder.weitere, [B], GOLD.key);
        expect(neu[B]).toEqual([]);
        expect(neu[C]).toEqual([GOLD, PILGER]);
        expect(ohneWeiteren(start.felder.weitere, [A, B, C], GOLD.key)).toEqual({ [A]: [], [B]: [], [C]: [PILGER] });
    });

    it("eine andere Folge derselben Artikel ist keine Änderung", () => {
        expect(weitereWechsel(start.felder.weitere, { ...start.felder.weitere, [C]: [PILGER, GOLD] })).toEqual([]);
        expect(weitereWechsel(start.felder.weitere, mitWeiterem(start.felder.weitere, [A], PILGER))).toEqual([A]);
    });

    it("🔴 die Suche sperrt den Hauptartikel und einen Namen, den alle gewählten tragen; an einem Teil bleibt er wählbar", () => {
        const chips = chipsDerWahl(start.felder.weitere, [B, C]);
        expect(trefferLage(chips, "sikramstieg", "sikramstieg")).toEqual({ art: "haupt" });
        expect(trefferLage(chips, "sikramstieg", GOLD.key)).toEqual({ art: "schon", von: 2 });
        expect(trefferLage(chips, "sikramstieg", PILGER.key)).toEqual({ art: "teil", anzahl: 1, von: 2 });
        expect(trefferLage(chips, undefined, "baerenpfad")).toBeUndefined();
        expect(trefferGesperrt({ art: "haupt" })).toBe(true);
        expect(trefferGesperrt({ art: "schon", von: 2 })).toBe(true);
        expect(trefferGesperrt({ art: "teil", anzahl: 1, von: 2 })).toBe(false);
        expect(trefferGesperrt(undefined)).toBe(false);
    });

    it("die Pfeiltasten springen über gesperrte Vorschläge und laufen rund; ohne wählbare keiner", () => {
        const gesperrt = [true, false, true, false];
        expect(naechsterWaehlbar(gesperrt, -1, 1)).toBe(1);
        expect(naechsterWaehlbar(gesperrt, 1, 1)).toBe(3);
        expect(naechsterWaehlbar(gesperrt, 3, 1)).toBe(1);
        expect(naechsterWaehlbar(gesperrt, -1, -1)).toBe(3);
        expect(naechsterWaehlbar([true, true], -1, 1)).toBe(-1);
        expect(naechsterWaehlbar([], -1, 1)).toBe(-1);
    });
});

describe("Weitere Straßennamen in `path.update` (WI-0302)", () => {
    const art = createWegArt(vi.fn() as never);

    it("🔴 „Fertig“ schickt `sections[].weitere` nur an Abschnitte, deren Liste sich geändert hat, dann vollständig als Schlüssel", () => {
        const jetzt = mit(mitWeiterem(start.felder.weitere, [A, B], PILGER));
        const body = art.operation(STRASSE, start, jetzt, "op");
        expect(body?.sections).toEqual([
            { publicId: A, baseRevision: 3, weitere: [PILGER.key] },
            { publicId: B, baseRevision: 5, weitere: [GOLD.key, PILGER.key] },
            { publicId: C, baseRevision: 7 },
        ]);
        expect(body).not.toHaveProperty("name");
        expect(art.geaendert(STRASSE, jetzt)).toEqual(["weitere"]);
    });

    it("🔴 ✕ am letzten Namen schickt die leere Liste; zurück auf den Stand des Lesens schickt nichts", () => {
        const ohne = mit(ohneWeiteren(start.felder.weitere, [B], GOLD.key));
        expect(art.operation(STRASSE, start, ohne, "op")?.sections[1]).toEqual({
            publicId: B,
            baseRevision: 5,
            weitere: [],
        });
        const wieder = mit(mitWeiterem(ohne.felder.weitere, [B], GOLD));
        expect(art.operation(STRASSE, start, wieder, "op")).toBeUndefined();
        expect(
            art.operation(STRASSE, start, mit({ ...start.felder.weitere, [C]: [PILGER, GOLD] }), "op"),
        ).toBeUndefined();
    });

    it("🔴 Konflikt: die eigene Liste eines Abschnitts bleibt, eine fremde Änderung an einem anderen kommt; fremd heißt `weitere`", () => {
        const fremd: EditorPathStreet = {
            ...STRASSE,
            segments: STRASSE.segments.map((s) =>
                s.id === C ? { ...s, revision: 8, weitere: [PILGER] } : { ...s, revision: s.revision + 1 },
            ),
        };
        expect(art.fremde(STRASSE, fremd)).toContain("weitere");
        const eigener = mit(mitWeiterem(start.felder.weitere, [A], PILGER));
        expect(art.aufNeuenStand(STRASSE, fremd, eigener).felder.weitere).toEqual({
            [A]: [PILGER],
            [B]: [GOLD],
            [C]: [PILGER],
        });
    });

    it("🔴 die Sicherung trägt die Namen (Version 9); ohne sie oder kaputt ist der Stand nicht heil", () => {
        const s = art.sicherung!;
        expect(s.version).toBe(9);
        const gesichert = mit(mitWeiterem(start.felder.weitere, [A], PILGER));
        expect(s.ein(JSON.parse(JSON.stringify(s.aus(gesichert))))?.felder.weitere).toEqual(gesichert.felder.weitere);
        const ohne = Object.fromEntries(Object.entries(start.felder).filter(([feld]) => feld !== "weitere"));
        expect(s.ein({ felder: ohne })).toBeUndefined();
        expect(s.ein({ felder: { ...start.felder, weitere: { [A]: [{ key: 3 }] } } })).toBeUndefined();
        expect(s.ein({ felder: { ...start.felder, weitere: { [A]: "Pilgerweg" } } })).toBeUndefined();
    });

    it("🔴 eine Absage zu den weiteren Straßennamen steht als Satz der Seite da, andere Absagen behalten den Satz des Servers", async () => {
        locale.value = "de";
        const antworte = (code: string, details?: Record<string, unknown>) =>
            createWegArt(
                vi.fn(async () =>
                    Response.json(
                        { error: { code, message: "Satz des Servers", ...(details ? { details } : {}) } },
                        { status: 400 },
                    ),
                ) as never,
            ).schreibe(A, { operationId: "op", sections: [] });
        const haupt = await antworte("ist_hauptartikel");
        expect(haupt.ok).toBe(false);
        if (!haupt.ok) {
            expect(haupt.fehler.code).toBe("ist_hauptartikel");
            expect(haupt.fehler.message).toContain("Hauptartikel");
        }
        const ungueltig = await antworte("validation_failed", { field: "weitere" });
        if (!ungueltig.ok) expect(ungueltig.fehler.message).toContain(`höchstens ${String(PATH_WEITERE_MAX)}`);
        const tief = await antworte("validation_failed", { field: "sections.2.weitere" });
        if (!tief.ok) expect(tief.fehler.message).not.toBe("Satz des Servers");
        const anderes = await antworte("validation_failed", { field: "name" });
        if (!anderes.ok) expect(anderes.fehler.message).toBe("Satz des Servers");
        expect(weitereAbsageSatz({ code: "edit_conflict" })).toBeUndefined();
    });

    it("im Verlauf stehen die Namen mit Komma, ohne Namen der Schlüssel, leer „keine“", () => {
        locale.value = "de";
        expect(weitereNamenText([{ key: "goldfelser-stieg", name: "Goldfelser Stieg" }, { key: "pilgerweg" }])).toBe(
            "Goldfelser Stieg, pilgerweg",
        );
        expect(weitereNamenText([])).toBe("keine");
    });
});
