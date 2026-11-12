import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "../src/database.ts";
import {
    assertCurrentDomainSeeds,
    loadContinentInput,
    mountainInputParts,
    pruefeSaaten,
} from "../src/terrain/domain/inputs.ts";

const geometry = JSON.stringify({
    type: "Polygon",
    coordinates: [
        [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
        ],
    ],
});

describe("WI-0067: continent geometry is a generator input", () => {
    it("reads the active derographic Aventurien continent in the requested domain", async () => {
        const query = vi.fn().mockResolvedValue([{ id: "continent-area", geometry }]);
        const result = await loadContinentInput(query as unknown as Queryable, "domain-id");
        const [strings, ...parameters] = query.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
        const sql = strings.join("?");
        expect(sql).toMatch(/region_area/);
        expect(sql).toMatch(/derographisch/);
        expect(sql).toMatch(/kontinent/);
        expect(sql).toMatch(/Aventurien/);
        expect(sql).toMatch(/a\.is_active/);
        expect(sql).toMatch(/r\.is_active/);
        expect(parameters).toContain("domain-id");
        expect(result.geometry).toEqual(JSON.parse(geometry));
    });

    it.each([0, 2])("rejects %i continent areas instead of guessing", async (count) => {
        const query = vi.fn().mockResolvedValue(Array.from({ length: count }, () => ({ id: "area", geometry })));
        await expect(loadContinentInput(query as unknown as Queryable, "domain-id")).rejects.toThrow(/kontinent/i);
    });
});

describe("Saaten prüfen mit zweiter Ladung (Stage-Jobs 1696, 2117)", () => {
    const altimont = { areaPublicId: "area", name: "Altimont", kammQuelle: "erzeugt", input: { kurve: [[0, 0]] } };

    it("🔴 passt die zweite Ladung zur Saat, war die erste ein Ausreißer: weiterrechnen und das Gebirge nennen", async () => {
        const nachladen = vi.fn(async () => ({ ...altimont, fingerprint: "822666a573f9aaaa" }));
        await expect(
            pruefeSaaten(
                [{ id: "area", v12_fingerprint: "822666a573f9aaaa" }],
                [{ ...altimont, fingerprint: "baeb8bff8aa6cccc", input: { kurve: [[1, 1]] } }],
                nachladen,
            ),
        ).resolves.toEqual(["Altimont"]);
        expect(nachladen).toHaveBeenCalledWith("area");
    });

    it("🔴 passt auch die zweite nicht, ist die Saat veraltet: Meldung mit den wechselnden Teilen", async () => {
        await expect(
            pruefeSaaten(
                [{ id: "area", v12_fingerprint: "822666a573f9aaaa" }],
                [{ ...altimont, fingerprint: "baeb8bff8aa6cccc", input: { kurve: [[1, 1]] } }],
                async () => ({ ...altimont, fingerprint: "f4df5956fa02bbbb" }),
            ),
        ).rejects.toThrow(/stale V12 seed area .*zweite Ladung f4df5956fa02, wechselnde Teile kurve/);
    });

    it("aktuelle Saaten laden nichts nach; ein Gebirge, das es nicht mehr gibt, bleibt ein Fehler", async () => {
        const nachladen = vi.fn(async () => undefined);
        await expect(
            pruefeSaaten(
                [{ id: "area", v12_fingerprint: "x" }],
                [{ areaPublicId: "area", fingerprint: "x" }],
                nachladen,
            ),
        ).resolves.toEqual([]);
        expect(nachladen).not.toHaveBeenCalled();
        await expect(pruefeSaaten([{ id: "weg", v12_fingerprint: "alt" }], [], nachladen)).rejects.toThrow(
            /kein aktives Gebirge mehr/,
        );
    });
});

describe("Aktuelle V12-Seeds", () => {
    it("weist einen Seed aus alten Kontrollparametern zurück", () => {
        expect(() =>
            assertCurrentDomainSeeds(
                [{ id: "area", v12_fingerprint: "old" }],
                [{ areaPublicId: "area", fingerprint: "new" }],
            ),
        ).toThrow(/stale V12 seed/);
    });
    it("🔴 nennt Gebirge, Kammquelle und beide Fingerabdrücke, und auch ein Gebirge, das es nicht mehr gibt (WI-0223)", () => {
        expect(() =>
            assertCurrentDomainSeeds(
                [{ id: "area", v12_fingerprint: "822666a573f9aaaa" }],
                [{ areaPublicId: "area", fingerprint: "f4df5956fa02bbbb", name: "Altimont", kammQuelle: "erzeugt" }],
            ),
        ).toThrow(/stale V12 seed area \(Altimont, Kamm erzeugt; gespeichert 822666a573f9, jetzt f4df5956fa02\)/);
        expect(() => assertCurrentDomainSeeds([{ id: "weg", v12_fingerprint: "alt" }], [])).toThrow(
            /stale V12 seed weg \(kein aktives Gebirge mehr/,
        );
    });
    it("zerlegt die Eingabe eines Gebirges in Teile mit eigenem Hash", () => {
        const parts = mountainInputParts({
            areaPublicId: "area",
            fingerprint: "x",
            input: { geometry: [1], kurve: [[0, 0]], saat: 5 },
            durchschnittshoehe: null,
        });
        expect(Object.keys(parts)).toEqual(["geometry", "kurve", "saat", "durchschnittshoehe"]);
        const other = mountainInputParts({
            areaPublicId: "area",
            fingerprint: "x",
            input: { geometry: [1], kurve: [[0, 1]], saat: 5 },
            durchschnittshoehe: null,
        });
        expect(Object.keys(parts).filter((key) => parts[key] !== other[key])).toEqual(["kurve"]);
    });
    it("akzeptiert exakt die aktuelle Seedrevision", () => {
        expect(() =>
            assertCurrentDomainSeeds(
                [{ id: "area", v12_fingerprint: "new" }],
                [{ areaPublicId: "area", fingerprint: "new" }],
            ),
        ).not.toThrow();
    });
});
