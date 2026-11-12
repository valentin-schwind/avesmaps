import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { EditorPathList, EditorPathStreet } from "@avesmaps3d/shared";
import { handgriffZeilen } from "../src/editor-menu/action.ts";
import { wegHandgriffe, wegSubjekt, type WegLage } from "../src/editor-menu/handgriffe-weg.ts";
import type { Werkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { auswahlAus, namensGrund, namensVorschlag } from "../src/wegeditor/weg-neuer-weg";
import { createWegeditorSteuerung } from "../src/wegeditor/wegeditor-steuerung";

/**
 * „Auswahl zu neuem Weg“ im Browser (WI-0252). Problemfälle: Das Namensfeld steht mit dem Namen des ersten Wegs vor, obwohl die Auswahl
 * gemischt ist; ein Griff gilt als Name; mit der Leiste ist der ganze Weg „eine Auswahl“; die Auswahl nennt einen Abschnitt, den das Fenster
 * gar nicht gelesen hat, oder eine alte Revision; nach dem Schreiben bleibt die Mehrfachauswahl an und das Fenster zeigt die alte Straße;
 * das Kartenmenü bietet die Aktion an einem fremden Abschnitt an. (Das ↺ im Verlauf ist seit WI-0265 B6a2 die Rücknahme der Wege: `ruecknahme-weg.test.ts`.)
 */

const RS = "11111111-1111-4111-8111-111111111111";
const RS2 = "11111111-1111-4111-8111-111111111112";
const RS3 = "11111111-1111-4111-8111-111111111113";
const PFAD = "33333333-3333-4333-8333-333333333333";
const strasse = (id: string): EditorPathStreet =>
    id === PFAD
        ? {
              id: PFAD,
              name: "Pfad-3443",
              subtype: "Pfad",
              isBach: false,
              circle: "leer",
              labelVisible: true,
              segments: [{ id: PFAD, revision: 2, labelVisible: true, wiki: false, points: 2, art: "Pfad" }],
          }
        : {
              id: RS,
              name: "Reichsstraße 3",
              subtype: "Reichsstrasse",
              isBach: false,
              circle: "halb-rechts",
              labelVisible: null,
              segments: [
                  { id: RS, revision: 4, labelVisible: true, wiki: true, points: 5, art: "Reichsstrasse" },
                  { id: RS2, revision: 6, labelVisible: false, wiki: false, points: 3, art: "Reichsstrasse" },
                  { id: RS3, revision: 1, labelVisible: false, wiki: false, points: 3, art: "Strasse" },
              ],
          };
const LISTE: EditorPathList = {
    rows: [
        { id: RS, name: "Reichsstraße 3", subtype: "Reichsstrasse", isBach: false, circle: "halb-rechts", segments: 3 },
        { id: PFAD, name: "Pfad-3443", subtype: "Pfad", isBach: false, circle: "leer", segments: 1 },
    ],
};

describe("Auswahl zu neuem Weg: Auswahl und Name", () => {
    it("🔴 gleiche Namen stehen vor, verschiedene heißen gemischt; ein namenloser Weg zählt als eigener Name", () => {
        const beide = auswahlAus([strasse(RS), strasse(PFAD)])!;
        expect(beide.abschnitte).toEqual([
            { publicId: RS, baseRevision: 4 },
            { publicId: RS2, baseRevision: 6 },
            { publicId: RS3, baseRevision: 1 },
            { publicId: PFAD, baseRevision: 2 },
        ]);
        expect(namensVorschlag(beide)).toEqual({ name: "", gemischt: true });
        const teil = auswahlAus([strasse(RS)], new Set([RS2, RS3]))!;
        expect(teil.abschnitte.map((a) => a.publicId)).toEqual([RS2, RS3]);
        expect(namensVorschlag(teil)).toEqual({ name: "Reichsstraße 3", gemischt: false });
        // Abseits der Karte gibt es keine Auswahl zu neuem Weg.
        expect(auswahlAus([{ ...strasse(RS), offMap: true }])).toBeUndefined();
    });

    it("🔴 leer und ein Griff sind kein Name, auch nicht der Name der eigenen Wegart", () => {
        const auswahl = auswahlAus([strasse(RS)])!;
        expect(namensGrund("   ", auswahl)).toBe("wegeditor.neuerWeg.grund.leer");
        expect(namensGrund("Pfad-77", auswahl)).toBe("wegeditor.neuerWeg.grund.griff");
        expect(namensGrund("Strasse", auswahl)).toBe("wegeditor.neuerWeg.grund.griff");
        expect(namensGrund(" Neue Allee ", auswahl)).toBeUndefined();
    });
});

interface Fenster {
    id: string;
    werkzeug: string;
    gegenstand?: string | undefined;
    lage: string;
    vorn: number;
}
function aufbau(antwort = (body: unknown) => ({ status: 200, body })) {
    const fenster = ref<Fenster[]>([]);
    let zaehler = 0;
    const neu = (f: { werkzeug: string; gegenstand?: string | undefined }): Fenster => {
        zaehler += 1;
        return {
            id: `f${String(zaehler)}`,
            werkzeug: f.werkzeug,
            gegenstand: f.gegenstand,
            lage: "angedockt",
            vorn: zaehler,
        };
    };
    const werkzeugfenster = {
        stand: computed(() => ({ fenster: fenster.value })),
        hervorholen: vi.fn(),
        markiere: vi.fn(),
        setzeLage: vi.fn(),
        oeffne: vi.fn((f: { werkzeug: string; gegenstand?: string }) => {
            const offen = neu(f);
            fenster.value = [...fenster.value, offen];
            return offen.id;
        }),
        oeffneAnStelle: vi.fn((an: string | undefined, f: { werkzeug: string; gegenstand?: string }) => {
            const alt = fenster.value.find((x) => x.id === an);
            const offen = alt === undefined ? neu(f) : { ...alt, gegenstand: f.gegenstand };
            fenster.value = [...fenster.value.filter((x) => x.id !== an), offen];
            return offen.id;
        }),
    } as unknown as Werkzeugfenster;
    const gesendet: unknown[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/editor/paths")) return new Response(JSON.stringify(LISTE));
        if (url.endsWith("/api/editor/paths/neuer-weg")) {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            gesendet.push(body);
            const { status, body: inhalt } = antwort(body);
            return new Response(JSON.stringify(inhalt), { status });
        }
        const id = url.split("/").at(-2)!;
        return new Response(JSON.stringify(strasse(id === RS2 || id === RS3 ? RS : id)));
    });
    const geaendert = vi.fn();
    const s = createWegeditorSteuerung(werkzeugfenster, fetcher as never, undefined, {
        sperre: { nimm: vi.fn(), gib: vi.fn(), beiVerlust: () => () => undefined } as never,
        geaendert,
        darfSchreiben: () => true,
    });
    return { s, fenster, gesendet, geaendert };
}
const ruhe = () => new Promise((r) => setTimeout(r, 0));

describe("Auswahl zu neuem Weg: Steuerung", () => {
    it("🔴 mit der Leiste ist nur ein TEIL der Abschnitte eine Auswahl; der ganze Weg nicht", async () => {
        const a = aufbau();
        a.s.waehle(RS);
        await ruhe();
        await ruhe();
        expect(a.s.auswahlVon()).toBeUndefined();
        a.s.schalteAbschnitt(RS, RS2);
        expect(a.s.auswahlVon()?.abschnitte).toEqual([{ publicId: RS2, baseRevision: 6 }]);
        expect(a.s.inAuswahl(RS2)).toBe(true);
        expect(a.s.inAuswahl(RS)).toBe(false);
    });

    it("🔴 mit Mehrfachauswahl alle Abschnitte der angehakten Wege; „Zu neuem Weg“ schreibt EINE Operation, danach steht der neue Weg im Fenster, die Auswahl ist aus", async () => {
        const a = aufbau(() => ({
            status: 200,
            body: {
                operationId: "x",
                status: "applied",
                environment: "test",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 77,
                anker: PFAD,
            },
        }));
        a.s.waehle(RS);
        await ruhe();
        const fensterId = a.fenster.value[0]!.id;
        a.s.setzeMehrfach(fensterId, true);
        a.s.setzeAngehakt(fensterId, [RS, PFAD]);
        await ruhe();
        await ruhe();
        expect(a.s.auswahlVon(fensterId)?.abschnitte).toHaveLength(4);
        a.s.frageNeuerWeg();
        expect(a.s.neuerWegFrage.value).toBe(fensterId);
        expect(await a.s.neuerWeg("  Neue Allee ")).toEqual({ ok: true });
        expect(a.gesendet).toEqual([
            {
                operationId: expect.any(String),
                name: "Neue Allee",
                sections: [
                    { publicId: RS, baseRevision: 4 },
                    { publicId: RS2, baseRevision: 6 },
                    { publicId: RS3, baseRevision: 1 },
                    { publicId: PFAD, baseRevision: 2 },
                ],
            },
        ]);
        expect(a.s.neuerWegFrage.value).toBeUndefined();
        expect(a.s.mehrfachVon(fensterId)).toEqual({ mehrfach: false, angehakt: [] });
        expect(a.fenster.value.map((f) => f.gegenstand)).toEqual([PFAD]);
        expect(a.geaendert).toHaveBeenCalledWith(77);
    });

    it("🔴 ein Konflikt lässt die Frage offen und nennt ihn", async () => {
        const a = aufbau(() => ({
            status: 409,
            body: { error: { code: "edit_conflict", message: "x" } },
        }));
        a.s.waehle(RS);
        await ruhe();
        await ruhe();
        a.s.schalteAbschnitt(RS, RS2);
        a.s.frageNeuerWeg();
        expect(await a.s.neuerWeg("Neue Allee")).toEqual({
            ok: false,
            satz: "Ein Abschnitt wurde inzwischen geändert; die Auswahl ist neu gelesen.",
        });
        expect(a.s.neuerWegFrage.value).toBeDefined();
    });

    it("🔴 „Weg entfernen …“ an der Mehrfachauswahl (WI-0252): erst ab zwei angehakten Wegen und nur an deren Abschnitten; das Blatt bekommt ALLE Abschnitte beider Wege mit frisch gelesenen Revisionen", async () => {
        const a = aufbau();
        a.s.waehle(RS);
        await ruhe();
        await ruhe();
        const fensterId = a.fenster.value[0]!.id;
        // Ohne Mehrfachauswahl gilt „Weg entfernen …“ dem Abschnitt unter dem Rechtsklick.
        expect(a.s.inMehrfach(RS)).toBe(false);
        expect(await a.s.entfernenAuswahl()).toBeUndefined();
        a.s.setzeMehrfach(fensterId, true);
        a.s.setzeAngehakt(fensterId, [RS, PFAD]);
        await ruhe();
        await ruhe();
        for (const abschnitt of [RS, RS2, RS3, PFAD]) expect(a.s.inMehrfach(abschnitt)).toBe(true);
        expect(a.s.inMehrfach("99999999-9999-4999-8999-999999999999")).toBe(false);
        const gelesen = await a.s.entfernenAuswahl();
        expect(gelesen).toEqual({
            wege: 2,
            abschnitte: [
                { publicId: RS, revision: 4 },
                { publicId: RS2, revision: 6 },
                { publicId: RS3, revision: 1 },
                { publicId: PFAD, revision: 2 },
            ],
        });
    });
});

describe("Auswahl zu neuem Weg: Kartenmenü und Verlauf", () => {
    const subjekt = wegSubjekt(
        { publicId: RS2, name: "Reichsstraße 3", subtype: "Reichsstrasse", isBach: false },
        "RS3",
    );
    const lage = (inAuswahl: boolean): WegLage => ({
        rechte: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        bearbeiten: { mapEditing: "testwelt" } as never,
        laeuft: false,
        inAuswahl: () => inAuswahl,
    });
    const zeilen = (inAuswahl: boolean, neuerWeg = vi.fn()) =>
        handgriffZeilen(
            wegHandgriffe(() => lage(inAuswahl), {
                eigenschaften: vi.fn(),
                wegkurve: vi.fn(),
                vereinfachen: vi.fn(),
                neuAbOrt: vi.fn(),
                neuerWeg,
            }),
            subjekt,
            "karte",
        );

    it("🔴 „Auswahl zu neuem Weg …“ steht nur an einem Abschnitt der Auswahl", () => {
        expect(zeilen(true).map((z) => z.id)).toContain("weg-neuer-weg");
        expect(zeilen(false).map((z) => z.id)).not.toContain("weg-neuer-weg");
    });
});
