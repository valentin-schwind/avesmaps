import { describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import type { EditorPathList, EditorPathStreet } from "@avesmaps3d/shared";
import { handgriffZeilen } from "../src/editor-menu/action.ts";
import { wegHandgriffe, wegSubjekt, type WegLage } from "../src/editor-menu/handgriffe-weg.ts";
import type { Werkzeugfenster } from "../src/editor-panel/werkzeugfenster";
import { verbindenAuswahlAus, verbindenWahlen } from "../src/wegeditor/weg-verbinden";
import { createWegeditorSteuerung } from "../src/wegeditor/wegeditor-steuerung";

/**
 * „Wege verbinden ›“ im Browser (WI-0252). Problemfälle: Ein einzelner Abschnitt bietet „Wege verbinden“ an; das Untermenü steht in der
 * Folge der Auswahl statt der Kette; der Eintrag geht, bevor der Server geprüft hat, oder fehlt, wenn es nicht geht (statt grau mit dem
 * Grund); die Wahl schickt nicht die Vorlage. (Das ↺ im Verlauf ist seit WI-0265 B6a2 die Rücknahme der Wege: `ruecknahme-weg.test.ts`.)
 */

const A = "11111111-1111-4111-8111-1111111111a1";
const B = "11111111-1111-4111-8111-1111111111b1";
const C = "11111111-1111-4111-8111-1111111111c1";
const STRASSE: EditorPathStreet = {
    id: A,
    name: "Reichsstraße 3",
    subtype: "Reichsstrasse",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: true,
    segments: [
        { id: A, revision: 2, labelVisible: true, wiki: false, points: 3, art: "Reichsstrasse", von: "Calmir" },
        { id: B, revision: 5, labelVisible: true, wiki: false, points: 3, art: "Weg", von: "Rossol", bis: "Gareth" },
        { id: C, revision: 1, labelVisible: true, wiki: false, points: 2, art: "Reichsstrasse", bis: "Punin" },
    ],
};
const TEXTE = { abzweig: "Abzweig", art: (art: string) => art };

describe("Wege verbinden: Auswahl und Untermenü", () => {
    it("🔴 mindestens zwei Abschnitte; (W) heißt alle; die Wahlen in Kettenfolge mit Name, Wegtyp und Enden", () => {
        expect(verbindenAuswahlAus([STRASSE], new Set([B]))).toBeUndefined();
        const alle = verbindenAuswahlAus([STRASSE])!;
        expect(alle.map((t) => [t.publicId, t.baseRevision])).toEqual([
            [A, 2],
            [B, 5],
            [C, 1],
        ]);
        const wahlen = verbindenWahlen(
            alle,
            {
                geht: true,
                kette: [
                    { publicId: C, umgedreht: true },
                    { publicId: A, umgedreht: false },
                    { publicId: B, umgedreht: false },
                ],
            },
            TEXTE,
        );
        expect(wahlen).toEqual([
            { id: C, text: "1 · Reichsstraße 3 (Reichsstrasse) · Abzweig – Punin", vorschau: true },
            { id: A, text: "2 · Reichsstraße 3 (Reichsstrasse) · Calmir – Abzweig", vorschau: true },
            { id: B, text: "3 · Reichsstraße 3 (Weg) · Rossol – Gareth", vorschau: true },
        ]);
    });
});

interface Fenster {
    id: string;
    werkzeug: string;
    gegenstand?: string | undefined;
    lage: string;
    vorn: number;
}
function aufbau(pruefung: unknown) {
    const fenster = ref<Fenster[]>([]);
    let zaehler = 0;
    const werkzeugfenster = {
        stand: computed(() => ({ fenster: fenster.value })),
        hervorholen: vi.fn(),
        markiere: vi.fn(),
        setzeLage: vi.fn(),
        oeffne: vi.fn((f: { werkzeug: string; gegenstand?: string }) => {
            zaehler += 1;
            const offen = {
                id: `f${String(zaehler)}`,
                werkzeug: f.werkzeug,
                gegenstand: f.gegenstand,
                lage: "angedockt",
                vorn: zaehler,
            };
            fenster.value = [...fenster.value, offen];
            return offen.id;
        }),
        oeffneAnStelle: vi.fn(),
    } as unknown as Werkzeugfenster;
    const liste: EditorPathList = {
        rows: [
            {
                id: A,
                name: "Reichsstraße 3",
                subtype: "Reichsstrasse",
                isBach: false,
                circle: "halb-rechts",
                segments: 3,
            },
        ],
    };
    const gesendet: unknown[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/api/editor/paths")) return new Response(JSON.stringify(liste));
        if (url.includes("/api/editor/paths/verbinden?")) return new Response(JSON.stringify(pruefung));
        if (url.endsWith("/api/editor/paths/verbinden")) {
            gesendet.push(JSON.parse(String(init?.body)));
            return new Response(
                JSON.stringify({
                    operationId: "x",
                    status: "applied",
                    environment: "test",
                    affected: [],
                    derivedWork: [],
                    warnings: [],
                    mapRevision: 9,
                    publicId: B,
                }),
            );
        }
        return new Response(JSON.stringify(STRASSE));
    });
    const s = createWegeditorSteuerung(werkzeugfenster, fetcher as never);
    return { s, gesendet };
}
const ruhe = () => new Promise((r) => setTimeout(r, 0));

describe("Wege verbinden: Steuerung und Kartenmenü", () => {
    const lage = (s: ReturnType<typeof aufbau>["s"]): WegLage => ({
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
        verbinden: (id) => s.verbindenAn(id, TEXTE),
    });
    const zeile = (s: ReturnType<typeof aufbau>["s"], am: string, verbinden = vi.fn()) =>
        handgriffZeilen(
            wegHandgriffe(() => lage(s), {
                eigenschaften: vi.fn(),
                wegkurve: vi.fn(),
                vereinfachen: vi.fn(),
                neuAbOrt: vi.fn(),
                verbinden,
            }),
            wegSubjekt({ publicId: am, name: "Reichsstraße 3", subtype: "Reichsstrasse", isBach: false }, "RS3"),
            "karte",
        ).find((z) => z.id === "weg-verbinden");

    it("🔴 erst „wird gelesen“, dann frei mit den Abschnitten im Untermenü; die Wahl ist die Vorlage, EINE Operation", async () => {
        const a = aufbau({
            geht: true,
            kette: [
                { publicId: A, umgedreht: false },
                { publicId: B, umgedreht: false },
                { publicId: C, umgedreht: true },
            ],
        });
        a.s.waehle(A);
        await ruhe();
        await ruhe();
        expect(zeile(a.s, B)?.grund).toBe("wegeditor.griff.grund.laedt");
        await a.s.verbindenBereit();
        const frei = zeile(a.s, B);
        expect(frei?.grund).toBeUndefined();
        expect(frei?.auswahl?.map((w) => w.id)).toEqual([A, B, C]);
        expect(await a.s.verbinde(B)).toEqual({ ok: true });
        expect(a.gesendet).toEqual([
            {
                operationId: expect.any(String),
                vorlage: B,
                sections: [
                    { publicId: A, baseRevision: 2 },
                    { publicId: B, baseRevision: 5 },
                    { publicId: C, baseRevision: 1 },
                ],
            },
        ]);
    });

    it("🔴 geht es nicht, steht der Eintrag grau mit dem Grund; ein Abschnitt allein bietet ihn nicht an", async () => {
        const a = aufbau({ geht: false, grund: "netz" });
        a.s.waehle(A);
        await ruhe();
        await ruhe();
        await a.s.verbindenBereit();
        expect(zeile(a.s, A)?.grund).toBe("wegeditor.verbinden.grund.netz");
        a.s.schalteAbschnitt(A, B);
        expect(zeile(a.s, B)).toBeUndefined();
    });
});
