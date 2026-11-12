import { describe, expect, it } from "vitest";
import type { StoredRaster } from "../src/terrain/dem-tiles.ts";
import type { DomainInputs } from "../src/terrain/domain/inputs.ts";
import { gipfelUnterGrundhoehe, gipfelUnterGrundhoeheFinding } from "../src/terrain/domain/peak-floor.ts";

/**
 * Gipfel unter der Grundhöhe ihres Gebirges (Betreiber 2026-10-17: kein Deckel, dafür eine Warnung): an einem kleinen Raster.
 *
 * - 🔴 Gemeldet wird je Paar Gipfel–Gebirge, nur wo der Gipfel unter der Grundhöhe liegt; ein Gipfel in zwei Gebirgen nur bei dem,
 *   dessen Grundhöhe er unterschreitet.
 * - 🔴 Am Gipfel steht seine Höhe; „ringsum“ ist das höchste Gelände im Umkreis einer Karteneinheit, nicht weiter.
 * - Ohne betroffenen Gipfel kein Befund; ein Gipfel ohne Höhe zählt nicht.
 */

/** 8 × 8 Zellen zu einer halben Einheit, Ursprung in der Zellmitte wie beim Domain-Raster; überall 500 Schritt. */
function raster(): StoredRaster {
    return { cell: 0.5, originX: 0.25, originY: 0.25, width: 8, height: 8, samples: new Uint16Array(64).fill(500) };
}
const setze = (r: StoredRaster, col: number, row: number, wert: number) => {
    r.samples[row * r.width + col] = wert;
};

function eingaben(): DomainInputs {
    return {
        peaks: [
            { id: "p-a", name: "Avtanentige", x: 1.3, y: 1.3, h: 1111 },
            { id: "p-b", name: "Hoher Gipfel", x: 3.3, y: 3.3, h: 2500 },
            { id: "p-c", name: "Grenzstein", x: 1.3, y: 3.3, h: 900 },
            { id: "p-d", name: "Ohne Höhe", x: 3.3, y: 1.3, h: null },
        ],
        peakFloors: [
            { peakId: "p-a", areaId: "g-1", gebirge: "Rote Sichel", grundhoehe: 2000, quelle: "kammhoehe" },
            { peakId: "p-b", areaId: "g-1", gebirge: "Rote Sichel", grundhoehe: 2000, quelle: "kammhoehe" },
            { peakId: "p-c", areaId: "g-1", gebirge: "Rote Sichel", grundhoehe: 2000, quelle: "kammhoehe" },
            { peakId: "p-c", areaId: "g-2", gebirge: "Firnithing", grundhoehe: 800, quelle: "vorgabe" },
            { peakId: "p-d", areaId: "g-1", gebirge: "Rote Sichel", grundhoehe: 2000, quelle: "kammhoehe" },
        ],
    } as unknown as DomainInputs;
}

describe("Gipfel unter der Grundhöhe ihres Gebirges", () => {
    it("🔴 je Paar, nur darunter; am Gipfel seine Höhe, ringsum das höchste Gelände in einer Einheit", () => {
        const r = raster();
        // Gipfel exakt (Zelle 2,2 für x = y = 1,3), daneben ein Kamm über ihm, und weiter als eine Einheit noch höher.
        setze(r, 2, 2, 1111);
        setze(r, 3, 2, 2284);
        setze(r, 6, 2, 3000);
        setze(r, 2, 6, 900);
        expect(gipfelUnterGrundhoehe(r, eingaben())).toEqual([
            {
                areaId: "g-1",
                gebirge: "Rote Sichel",
                grundhoehe: 2000,
                quelle: "kammhoehe",
                gipfel: [
                    { id: "p-a", name: "Avtanentige", hoehe: 1111, gelaende: 1111, ringsum: 2284 },
                    { id: "p-c", name: "Grenzstein", hoehe: 900, gelaende: 900, ringsum: 900 },
                ],
            },
        ]);
    });

    it("🔴 der Befund nennt Zahlen, die Gipfel als Objekte und je Paar eine Zeile; ohne Betroffene keiner", () => {
        const r = raster();
        setze(r, 2, 2, 1111);
        setze(r, 3, 2, 2284);
        const befund = gipfelUnterGrundhoeheFinding(gipfelUnterGrundhoehe(r, eingaben()));
        expect(befund).toMatchObject({
            code: "gelaende/gipfel_unter_grundhoehe",
            numbers: { gipfel: 2, paare: 2, gebirge: 1, ringsumE: 1 },
            objectCount: 2,
            objects: [
                { table: "terrain_peak", publicId: "p-a", name: "Avtanentige" },
                { table: "terrain_peak", publicId: "p-c", name: "Grenzstein" },
            ],
        });
        expect(befund?.notes[0]).toBe(
            "Rote Sichel (Grundhöhe 2.000): Avtanentige 1.111, Gelände am Gipfel 1.111, ringsum bis 2.284",
        );
        expect(gipfelUnterGrundhoeheFinding([])).toBeNull();
        const ohne = eingaben();
        delete ohne.peakFloors;
        expect(gipfelUnterGrundhoehe(r, ohne)).toEqual([]);
    });
});
