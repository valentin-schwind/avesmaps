import { describe, expect, it, vi } from "vitest";
import {
    territoryDefaultZoomRange,
    type EditorLock,
    type EditorLockTarget,
    type EditorTerritoryHierarchy,
    type EditorTerritoryHierarchyTerritory,
    type TerritoryDisplayBody,
} from "@avesmaps3d/shared";
import type { NimmErgebnis } from "../src/editor-sperre/sperre.ts";
import { befundeVon, hierarchieVon, mitEntwurf, type HierarchieZeile } from "../src/gebietseditor/hierarchie.ts";
import {
    createZoombaender,
    farbenAusHierarchie,
    mitgezogen,
    mitgezogeneSpannen,
    type ZoombandAntwort,
} from "../src/gebietseditor/zoombaender.ts";

/**
 * „Farben und Zoombänder“ im Reiter „Hierarchie“ (WI-0209 D2, D4; EDIT-0005 §7 D2 und D4; T23 Frage 6 und 7, H2). Benannte Fälle: die Vorgabe nach
 * Tiefe aus Legacys WikiSync-Tafel bis 8, die Vorschau des Entwurfs mit derselben Regel wie N2, die Befunde, und der Modus (Sperre nur der
 * geänderten Gebiete, ↶ ↷, Verwerfen, Esc, EINE Operation bei „Fertig“), die Farben im selben Entwurf. Den Server prüft
 * `apps/server/test/territory-display.test.ts`.
 *
 * Problemfälle: Eine Baronie mit Spanne 4 bis 8 fehlt in der Vorschau in Band 7 und 8, weil ihre Fläche ihr eigenes Band behält; ⇉
 * sperrt Gebiete, die sich nicht ändern, oder schreibt über eine fremde Sperre; „Fertig“ schickt unveränderte Gebiete mit; eine Lücke
 * hält „Fertig“ auf; nach dem Verwerfen bleiben Sperren hängen; eine Farbänderung leert die Bänder der Flächen oder schickt eine Spanne
 * mit; das Mitziehen erreicht die Enkel nicht oder geht von der Farbe vor dem Entwurf aus.
 */

const REICH = "d2000000-0000-4000-8000-000000000001";
const PROVINZ = "d2000000-0000-4000-8000-000000000002";
const NORD = "d2000000-0000-4000-8000-000000000003";
const SUED = "d2000000-0000-4000-8000-000000000004";
const WEST = "d2000000-0000-4000-8000-000000000005";

const gebiet = (
    id: string,
    name: string,
    parent: string | undefined,
    [minZoom, maxZoom]: [number, number],
    extra: Partial<EditorTerritoryHierarchyTerritory> = {},
): EditorTerritoryHierarchyTerritory => ({
    id,
    name,
    ...(parent ? { parent } : {}),
    minZoom,
    maxZoom,
    color: "#808080",
    order: 0,
    revision: 3,
    ...extra,
});
/** Reich 0–1, Provinz 2–3, drei Baronien 4–6, deren Flächen ihr eigenes Band 4–6 tragen (Legacys Skala). */
const daten = (): EditorTerritoryHierarchy => ({
    yearBf: 1049,
    derivedMaxBand: 8,
    territories: [
        gebiet(REICH, "Reich", undefined, [0, 1], { revision: 1 }),
        gebiet(PROVINZ, "Provinz", REICH, [2, 3], { revision: 2 }),
        gebiet(NORD, "Nord", PROVINZ, [4, 6], { order: 1 }),
        gebiet(SUED, "Süd", PROVINZ, [4, 6], { order: 2 }),
        gebiet(WEST, "West", PROVINZ, [4, 6], { order: 3 }),
    ],
    areas: [NORD, SUED, WEST].map((territory, i) => ({
        id: `d2000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
        territory,
        minZoom: 4,
        maxZoom: 6,
    })),
});
const zeile = (h: ReturnType<typeof hierarchieVon>, id: string): HierarchieZeile => {
    const z = h?.zeilen.find((x) => x.id === id);
    if (!z) throw new Error(`keine Zeile ${id}`);
    return z;
};
const gezeigt = (z: HierarchieZeile): number[] => z.stufen.flatMap((s, b) => (s === "gezeigt" ? [b] : []));

describe("Vorgabe nach Tiefe (T23 Frage 7)", () => {
    it("🔴 Legacys WikiSync-Tafel, die unterste Ebene bis 8", () => {
        const tafel = (laenge: number): string[] =>
            Array.from({ length: laenge }, (_, i) => territoryDefaultZoomRange(laenge, i)).map(
                (r) => `${String(r.min)}–${String(r.max)}`,
            );
        expect(tafel(1)).toEqual(["0–8"]);
        expect(tafel(2)).toEqual(["0–1", "2–8"]);
        expect(tafel(3)).toEqual(["0–1", "2–2", "3–8"]);
        expect(tafel(5)).toEqual(["0–1", "2–2", "3–3", "4–4", "5–8"]);
        // Längere Ketten: ab der sechsten Stelle 6 bis 8.
        expect(tafel(7)).toEqual(["0–1", "2–2", "3–3", "4–4", "5–5", "6–8", "6–8"]);
    });

    it("je Zeile nach der Kette durch das Gebiet: Reich, Provinz, Baronie ergeben 0–1, 2–2, 3–8", () => {
        const h = hierarchieVon(daten(), REICH);
        expect([REICH, PROVINZ, NORD].map((id) => zeile(h, id).vorgabe)).toEqual([
            { min: 0, max: 1 },
            { min: 2, max: 2 },
            { min: 3, max: 8 },
        ]);
    });

    it("Geschwister für ⇉ und die Revision je Zeile; die Wurzel hat im Reiter keine Geschwister", () => {
        const h = hierarchieVon(daten(), PROVINZ);
        expect(zeile(h, NORD).geschwister).toEqual([SUED, WEST]);
        expect(zeile(h, PROVINZ).geschwister).toEqual([]);
        expect(zeile(h, NORD).revision).toBe(3);
    });
});

describe("Vorschau des Entwurfs (dieselbe Regel wie N2)", () => {
    it("🔴 Spanne 4 bis 8 einer Baronie: Band 7 und 8 zeigen sie, weil ihre Fläche das eigene Band verliert", () => {
        const vorher = hierarchieVon(daten(), PROVINZ);
        expect(gezeigt(zeile(vorher, NORD))).toEqual([4, 5, 6]);
        const nachher = hierarchieVon(mitEntwurf(daten(), new Map([[NORD, { spanne: { min: 4, max: 8 } }]])), PROVINZ);
        expect(gezeigt(zeile(nachher, NORD))).toEqual([4, 5, 6, 7, 8]);
        // Die anderen Baronien behalten Spanne und Flächenband.
        expect(gezeigt(zeile(nachher, SUED))).toEqual([4, 5, 6]);
    });

    it("🔴 Lücke und Überlappung sind Befunde: Süd auf 6–6 lässt Band 4 und 5 leer, Nord auf 3–8 trifft die Provinz", () => {
        const h = hierarchieVon(
            mitEntwurf(
                daten(),
                new Map([
                    [SUED, { spanne: { min: 6, max: 6 } }],
                    [NORD, { spanne: { min: 3, max: 8 } }],
                ]),
            ),
            REICH,
        );
        expect(h).toBeDefined();
        // Darunter zeigen Reich und Provinz die Fläche (Band 0 bis 3); in 4, 5, 7 und 8 zeigt sie niemand.
        expect(zeile(h, SUED).luecken).toEqual([4, 5, 7, 8]);
        expect(zeile(h, NORD).ueber.map((u) => u.id)).toEqual([PROVINZ]);
        // West endet noch bei 6 (Legacys Skala): Lücke in 7 und 8. Die Überlappung zählt an Nord und an der Provinz.
        expect(befundeVon(h!)).toEqual({ baender: [4, 5, 7, 8], gebiete: 2, ueberlappungen: 2 });
    });
});

/** Eine Sperre zum Testen: hält ein anderer `fremd`, sonst genommen; was freigegeben wird, steht in `frei`. */
function testSperre(fremd: string[] = []) {
    const genommen: string[] = [];
    const frei: string[] = [];
    return {
        genommen,
        frei,
        sperre: {
            nimm: vi.fn(async (ziel: EditorLockTarget): Promise<NimmErgebnis> => {
                await Promise.resolve();
                if (fremd.includes(ziel.id))
                    return {
                        art: "gesperrt",
                        sperre: { kind: "territory", id: ziel.id, person: { id: "p", name: "Anna" } } as EditorLock,
                    };
                genommen.push(ziel.id);
                return { art: "genommen", sperre: {} as EditorLock };
            }),
            gib: vi.fn((ziel: EditorLockTarget) => void frei.push(ziel.id)),
            beiVerlust: () => () => undefined,
        },
    };
}
function testModus(
    antwort: ZoombandAntwort = { ok: true, quittung: { mapRevision: 77 } as never },
    fremd: string[] = [],
    hierarchie: (id: string) => EditorTerritoryHierarchy | undefined = () => undefined,
) {
    const gesendet: TerritoryDisplayBody[] = [];
    const s = testSperre(fremd);
    const geaendert = vi.fn();
    const gespeichert = vi.fn();
    const modus = createZoombaender({
        daten: {
            sende: async (body) => {
                gesendet.push(body);
                return antwort;
            },
            hierarchie: async (id) => {
                await Promise.resolve();
                return hierarchie(id);
            },
        },
        anderswo: (name) => `anderswo: ${name}`,
        sperre: s.sperre,
        geaendert,
        gespeichert,
        neueKennung: () => "op-1",
    });
    return { modus, gesendet, geaendert, gespeichert, ...s };
}

describe("Der Modus „Zoombänder bearbeiten“", () => {
    it("🔴 die erste Änderung beginnt den Modus und sperrt nur das geänderte Gebiet; „Fertig“ schreibt EINE Operation", async () => {
        const t = testModus();
        await t.modus.aendere(daten(), PROVINZ, [{ id: NORD, min: 4, max: 8 }]);
        expect(t.modus.laufend.value).toMatchObject({ wurzel: PROVINZ, name: "Provinz", ungespeichert: 1 });
        expect(t.genommen).toEqual([NORD]);
        expect(t.sperre.nimm).toHaveBeenCalledWith({ kind: "territory", id: NORD }, "felder");
        // Ein zweiter Schritt am selben Gebiet sperrt nicht neu.
        await t.modus.aendere(daten(), PROVINZ, [{ id: NORD, min: 5, max: 8 }]);
        expect(t.sperre.nimm).toHaveBeenCalledTimes(1);
        await t.modus.fertig();
        expect(t.gesendet).toEqual([
            { operationId: "op-1", territories: [{ id: NORD, baseRevision: 3, zoom: { minZoom: 5, maxZoom: 8 } }] },
        ]);
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.frei).toEqual([NORD]);
        expect(t.geaendert).toHaveBeenCalledWith(77);
        expect(t.gespeichert).toHaveBeenCalledOnce();
        expect(t.modus.meldung.value).toEqual({ art: "gespeichert", namen: ["Nord"], farben: false, spannen: true });
    });

    it("🔴 Freigabe auf Bitte (WI-0262): je gehaltenes Gebiet ein Angebot; es schreibt EINMAL über „Fertig“, beendet den Modus und meldet sich ab", async () => {
        const t = testModus();
        const angebote = new Map<string, () => Promise<unknown>>();
        const abgemeldet: string[] = [];
        const bieteFreigabe = vi.fn((ziel: EditorLockTarget, angebot: { speichere(): Promise<unknown> }) => {
            angebote.set(ziel.id, () => angebot.speichere());
            return () => void abgemeldet.push(ziel.id);
        });
        const modus = createZoombaender({
            daten: {
                sende: async (body) => (t.gesendet.push(body), { ok: true, quittung: { mapRevision: 77 } as never }),
                hierarchie: async () => undefined,
            },
            anderswo: (name) => name,
            sperre: { ...t.sperre, bieteFreigabe },
            neueKennung: () => "op-1",
        });
        await modus.aendere(daten(), PROVINZ, [
            { id: NORD, min: 4, max: 8 },
            { id: SUED, min: 4, max: 8 },
        ]);
        expect([...angebote.keys()].sort()).toEqual([NORD, SUED].sort());
        // Die Bitte an das erste Gebiet speichert beide in EINER Operation; die an das zweite findet nichts mehr zu tun und gilt als erfüllt.
        expect(await angebote.get(NORD)!()).toEqual({ ok: true });
        expect(await angebote.get(SUED)!()).toEqual({ ok: true });
        expect(t.gesendet).toHaveLength(1);
        expect(modus.laufend.value).toBeUndefined();
        expect(abgemeldet.sort()).toEqual([NORD, SUED].sort());
    });

    it("🔴 Freigabe auf Bitte: ein abgelehntes Speichern lässt den Modus stehen und nennt den Satz des Servers", async () => {
        const t = testModus({
            ok: false,
            status: 400,
            fehler: { code: "validation_failed", message: "Spanne unzulässig." },
        } as never);
        let angebot: { speichere(): Promise<unknown> } | undefined;
        const modus = createZoombaender({
            daten: {
                sende: async () =>
                    ({
                        ok: false,
                        status: 400,
                        fehler: { code: "validation_failed", message: "Spanne unzulässig." },
                    }) as never,
                hierarchie: async () => undefined,
            },
            anderswo: (name) => name,
            sperre: { ...t.sperre, bieteFreigabe: (_ziel, a) => ((angebot = a), () => undefined) },
            neueKennung: () => "op-1",
        });
        await modus.aendere(daten(), PROVINZ, [{ id: NORD, min: 4, max: 8 }]);
        expect(await angebot!.speichere()).toEqual({ ok: false, grund: "Spanne unzulässig." });
        expect(modus.laufend.value).toBeDefined();
        expect(t.frei).toEqual([]);
    });

    it("🔴 ⇉ über eine fremde Sperre: das gesperrte Geschwister fällt weg, der Satz nennt wer, die übrigen gelten", async () => {
        const t = testModus(undefined, [WEST]);
        await t.modus.aendere(daten(), PROVINZ, [
            { id: SUED, min: 4, max: 8 },
            { id: WEST, min: 4, max: 8 },
        ]);
        expect([...t.modus.stand.value.keys()]).toEqual([SUED]);
        expect(t.modus.meldung.value).toEqual({ art: "gesperrt", name: "West", wer: "Anna" });
    });

    it("unverändert zurückgezogen ist nicht geändert; ↶ ↷ und Verwerfen (der Modus bleibt offen, F20)", async () => {
        const t = testModus();
        await t.modus.aendere(daten(), PROVINZ, [{ id: NORD, min: 4, max: 8 }]);
        await t.modus.aendere(daten(), PROVINZ, [{ id: NORD, min: 4, max: 6 }]);
        expect(t.modus.stand.value.size).toBe(0);
        t.modus.zurueck();
        expect(t.modus.stand.value.get(NORD)).toEqual({ spanne: { min: 4, max: 8 } });
        t.modus.wieder();
        expect(t.modus.stand.value.size).toBe(0);
        t.modus.verwerfen();
        expect(t.modus.laufend.value).toMatchObject({ ungespeichert: 0 });
        // Nichts geändert: „Fertig“ schreibt nichts und beendet.
        await t.modus.fertig();
        expect(t.gesendet).toEqual([]);
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.frei).toEqual([NORD]);
    });

    it("🔴 eine Lücke hält „Fertig“ nicht auf; ein Konflikt behält den Entwurf und sagt wer", async () => {
        const t = testModus({
            ok: false,
            status: 409,
            fehler: {
                code: "edit_conflict",
                message: "x",
                details: { changedBy: { displayName: "Thomas" }, changedAt: "2026-10-17T10:00:00Z" },
            },
        });
        await t.modus.aendere(daten(), PROVINZ, [{ id: SUED, min: 6, max: 6 }]);
        await t.modus.fertig();
        expect(t.gesendet).toHaveLength(1);
        expect(t.modus.laufend.value).toMatchObject({ phase: "bereit", ungespeichert: 1 });
        expect(t.modus.meldung.value).toMatchObject({ art: "konflikt", wer: "Thomas" });
        expect(t.frei).toEqual([]);
    });

    it("Esc mit Ungeschriebenem fragt; „Verwerfen“ beendet und gibt jede Sperre frei", async () => {
        const t = testModus();
        await t.modus.aendere(daten(), PROVINZ, [
            { id: NORD, min: 4, max: 8 },
            { id: SUED, min: 4, max: 8 },
        ]);
        expect(t.modus.abbrechen()).toBe(true);
        expect(t.modus.laufend.value?.frage).toBe(true);
        t.modus.antworte(true);
        expect(t.modus.laufend.value).toBeUndefined();
        expect(t.frei.sort()).toEqual([NORD, SUED].sort());
        expect(t.modus.meldung.value).toEqual({ art: "verworfen", name: "Provinz" });
        // Ohne Modus nimmt Esc nichts.
        expect(t.modus.abbrechen()).toBe(false);
    });
});

describe("Farben im selben Entwurf (D4, H2)", () => {
    /** Ein Enkel unter Nord, damit das Mitziehen zwei Ebenen tief geht. */
    const mitEnkel = (): EditorTerritoryHierarchy => {
        const d = daten();
        return {
            ...d,
            territories: [
                ...d.territories.map((g) =>
                    g.id === PROVINZ ? { ...g, color: "#5FB068" } : g.id === NORD ? { ...g, color: "#5dac60" } : g,
                ),
                gebiet(ENKEL, "Enkel", NORD, [6, 6], { color: "#60a75a" }),
            ],
        };
    };
    const ENKEL = "d2000000-0000-4000-8000-000000000006";

    it("🔴 eine Farbe ändern: die Untergebiete ziehen um dieselbe Verschiebung mit, bis zum Enkel; abgewählt nur das Gebiet", () => {
        const d = mitEnkel();
        const mit = mitgezogen(d, new Map(), PROVINZ, "#b0685f", true);
        expect(mit.map((a) => a.id)).toEqual([PROVINZ, NORD, SUED, WEST, ENKEL]);
        expect(mit[0]).toEqual({ id: PROVINZ, farbe: "#b0685f" });
        expect(new Set(mit.map((a) => a.farbe)).size).toBe(4);
        expect(mitgezogen(d, new Map(), PROVINZ, "#B0685F", false)).toEqual([{ id: PROVINZ, farbe: "#b0685f" }]);
        // Vom Stand im Entwurf aus: Hat Nord schon eine neue Farbe, zieht der Enkel von dort mit.
        const stand = new Map([[NORD, { farbe: "#5cadb0" }]]);
        const zweiter = mitgezogen(d, stand, NORD, "#5cadb0", true);
        expect(zweiter).toEqual([
            { id: NORD, farbe: "#5cadb0" },
            { id: ENKEL, farbe: "#60a75a" },
        ]);
    });

    it("🔴 Farben schreiben nur Farben: „Fertig“ schickt color ohne zoom, die Flächen behalten in der Vorschau ihr Band", async () => {
        const t = testModus();
        const d = mitEnkel();
        await t.modus.faerbe(d, PROVINZ, mitgezogen(d, t.modus.stand.value, NORD, "#b0685f", true));
        expect(t.modus.laufend.value).toMatchObject({ farben: true, spannen: false, ungespeichert: 1 });
        expect(t.genommen.sort()).toEqual([NORD, ENKEL].sort());
        const vorschau = mitEntwurf(d, t.modus.stand.value);
        expect(vorschau.territories.find((g) => g.id === NORD)?.color).toBe("#b0685f");
        expect(vorschau.areas).toEqual(d.areas);
        // Und eine Spanne dazu: derselbe Entwurf, EINE Operation mit beidem.
        await t.modus.aendere(d, PROVINZ, [{ id: NORD, min: 4, max: 8 }]);
        expect(t.modus.laufend.value).toMatchObject({ farben: true, spannen: true, ungespeichert: 2 });
        await t.modus.fertig();
        expect(t.gesendet).toHaveLength(1);
        expect(t.gesendet[0]!.territories).toEqual([
            { id: NORD, baseRevision: 3, zoom: { minZoom: 4, maxZoom: 8 }, color: "#b0685f" },
            { id: ENKEL, baseRevision: 3, color: expect.stringMatching(/^#[0-9a-f]{6}$/u) as unknown as string },
        ]);
    });

    it("🔴 die alte Farbe zurück ist unverändert; ↶ nimmt die Farbhierarchie als EINEN Schritt zurück", async () => {
        const t = testModus();
        const d = mitEnkel();
        await t.modus.faerbe(d, PROVINZ, [{ id: NORD, farbe: "#ffffff" }]);
        await t.modus.faerbe(d, PROVINZ, [{ id: NORD, farbe: "#5DAC60" }]);
        expect(t.modus.stand.value.size).toBe(0);
        const plan = farbenAusHierarchie(d, t.modus.stand.value, PROVINZ, [38, 33, 28, 25, 25, 25], 7);
        expect(plan.map((a) => a.id).sort()).toEqual([NORD, SUED, WEST, ENKEL].sort());
        await t.modus.faerbe(d, PROVINZ, plan);
        expect(t.modus.stand.value.size).toBeGreaterThanOrEqual(3);
        t.modus.zurueck();
        expect(t.modus.stand.value.size).toBe(0);
    });
});

describe("Die Farbe aus den Eigenschaften (T51)", () => {
    const ab = (wurzel: string): EditorTerritoryHierarchy => {
        const d = daten();
        return {
            ...d,
            // Die Glieder darüber tragen keine Revision (der Reiter ändert sie nicht).
            territories: d.territories.map((g) => {
                if (g.id === wurzel || g.parent === wurzel) return g;
                const oben = { ...g };
                delete oben.revision;
                return { ...oben, above: true as const };
            }),
        };
    };

    it("🔴 ohne Entwurf: liest den Reiter des Gebiets und beginnt dort, die Untergebiete ziehen mit (derselbe Schalter)", async () => {
        const t = testModus(undefined, [], (id) => (id === PROVINZ ? ab(PROVINZ) : undefined));
        await t.modus.faerbeGebiet(PROVINZ, "#B0685F");
        expect(t.modus.laufend.value).toMatchObject({ wurzel: PROVINZ, farben: true });
        expect([...t.modus.stand.value.keys()].sort()).toEqual([PROVINZ, NORD, SUED, WEST].sort());
        expect(t.modus.stand.value.get(PROVINZ)).toEqual({ farbe: "#b0685f" });
        // Abgewählt: nur das Gebiet.
        t.modus.ziehtMit(false);
        await t.modus.faerbeGebiet(NORD, "#123456");
        expect(t.modus.stand.value.get(NORD)).toEqual({ farbe: "#123456" });
        expect(t.modus.laufend.value?.ungespeichert).toBe(2);
    });

    it("🔴 den Schalter stellt nur der Besitzer um: Wer das Band-Objekt hält, ändert es nicht (Lint vue/no-mutating-props)", () => {
        const t = testModus();
        const warnung = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        // So schrieb früher ein Kind in das Objekt seiner Eltern; jetzt ist es nur lesbar und bleibt, wie es war.
        (t.modus.mitziehen as { value: boolean }).value = false;
        expect(t.modus.mitziehen.value).toBe(true);
        warnung.mockRestore();
        t.modus.ziehtMit(false);
        expect(t.modus.mitziehen.value).toBe(false);
    });

    it("🔴 läuft ein Entwurf ab einem anderen Gebiet, in dem es nicht steht: nichts ändert sich, die Meldung sagt warum", async () => {
        const t = testModus(undefined, [], () => ab(PROVINZ));
        await t.modus.aendere(ab(NORD), NORD, [{ id: NORD, min: 4, max: 8 }]);
        await t.modus.faerbeGebiet(SUED, "#123456");
        expect(t.modus.stand.value.has(SUED)).toBe(false);
        expect(t.modus.meldung.value).toEqual({ art: "abgelehnt", satz: "anderswo: Nord" });
    });
});

describe("Die Zoomspanne aus den Eigenschaften (T51, Entscheid A: „Untergebiete ziehen mit, ein Haken für Farbe und Zoomspanne“)", () => {
    it("🔴 mit dem Haken rücken alle Untergebiete bis zum Enkel um die Bänder des oberen Endes, innerhalb 0–8; ohne nur das Gebiet", () => {
        // Provinz 2–3 → 2–4: die Baronien 4–6 → 5–7.
        expect(mitgezogeneSpannen(daten(), new Map(), PROVINZ, { min: 2, max: 4 }, true)).toEqual([
            { id: PROVINZ, min: 2, max: 4 },
            { id: NORD, min: 5, max: 7 },
            { id: SUED, min: 5, max: 7 },
            { id: WEST, min: 5, max: 7 },
        ]);
        // Reich 0–1 → 0–3: die Provinz 4–5, die Enkel 6–8.
        const reich = mitgezogeneSpannen(daten(), new Map(), REICH, { min: 0, max: 3 }, true);
        expect(reich.find((a) => a.id === PROVINZ)).toEqual({ id: PROVINZ, min: 4, max: 5 });
        expect(reich.find((a) => a.id === NORD)).toEqual({ id: NORD, min: 6, max: 8 });
        // An der Kante: alles bleibt in 0–8, „bis“ nie unter „von“.
        expect(mitgezogeneSpannen(daten(), new Map(), PROVINZ, { min: 2, max: 8 }, true)).toContainEqual({
            id: NORD,
            min: 8,
            max: 8,
        });
        expect(mitgezogeneSpannen(daten(), new Map(), PROVINZ, { min: 2, max: 4 }, false)).toEqual([
            { id: PROVINZ, min: 2, max: 4 },
        ]);
        // Nur „von“ geändert: nichts rückt.
        expect(mitgezogeneSpannen(daten(), new Map(), PROVINZ, { min: 1, max: 3 }, true)).toHaveLength(1);
    });

    it("🔴 ohne Entwurf: liest den Reiter und beginnt dort; die Folgen nennen jedes Untergebiet vorher und jetzt", async () => {
        const t = testModus(undefined, [], (id) => (id === PROVINZ ? daten() : undefined));
        await t.modus.spanneGebiet(PROVINZ, { min: 2, max: 4 });
        expect(t.modus.laufend.value).toMatchObject({ wurzel: PROVINZ, spannen: true });
        expect(t.modus.stand.value.get(NORD)).toEqual({ spanne: { min: 5, max: 7 } });
        expect(t.modus.spannenFolgen(PROVINZ)).toContainEqual({
            id: NORD,
            name: "Nord",
            vorher: { min: 4, max: 6 },
            nachher: { min: 5, max: 7 },
        });
        expect(t.modus.spannenFolgen(NORD)).toEqual([]);
        await t.modus.fertig();
        expect(t.gesendet[0]?.territories).toHaveLength(4);
    });
});
