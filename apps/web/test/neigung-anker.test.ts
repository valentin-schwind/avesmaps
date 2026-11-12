import { describe, expect, it } from "vitest";
import { mitteUmAnker, type AnkerTransform, type Bildpunkt } from "../src/map/camera/neigung-anker.ts";

/**
 * Die Neigung kippt um den Punkt, an dem man zoomt (WI-0016; Betreiber 2026-11-09: „das zoomtarget bleibt und verschiebt sich nicht
 * immer weiter vor“). Ein Bodenmodell in einer Richtung: Der Ort unter der Bildzeile y ist Mitte + (y − 360) · Maß der Neigung, damit
 * eine Neigung wie bei MapLibre um die Bildmitte dreht.
 */

interface Modell extends AnkerTransform<number> {
    center: number;
    pitch: number;
    hoehen: (number | undefined)[];
}

const mass = (pitch: number): number => 1 + pitch / 30;

function modell(center: number, pitch: number, extra: Partial<AnkerTransform<number>> = {}): Modell {
    const tr: Modell = {
        center,
        pitch,
        hoehen: [],
        clone: () => {
            const kopie = modell(tr.center, tr.pitch, extra);
            kopie.hoehen = tr.hoehen;
            return kopie;
        },
        setPitch: (p) => {
            tr.pitch = p;
        },
        setLocationAtPoint: (ort, punkt, hoehe) => {
            tr.center = ort - (punkt.y - 360) * mass(tr.pitch);
            tr.hoehen.push(hoehe);
        },
        screenPointToLocation: (punkt) => tr.center + (punkt.y - 360) * mass(tr.pitch),
        ...extra,
    };
    return tr;
}

const ortUnter = (center: number, pitch: number, punkt: Bildpunkt): number => center + (punkt.y - 360) * mass(pitch);

describe("Die Neigung kippt um den Punkt, an dem man zoomt", () => {
    it("🔴 der Ort unter dem Zeiger steht nach dem Neigen an derselben Stelle im Bild", () => {
        const zeiger = { x: 900, y: 500 };
        const vorher = modell(100, 45);
        const mitte = mitteUmAnker(vorher, 60, zeiger);
        expect(mitte).toBeDefined();
        expect(ortUnter(mitte!, 60, zeiger)).toBeCloseTo(ortUnter(100, 45, zeiger), 9);
        // Ohne Eingriff (Mitte bleibt) wäre er gewandert.
        expect(ortUnter(100, 60, zeiger)).not.toBeCloseTo(ortUnter(100, 45, zeiger), 3);
        // Die Kopie neigt, nicht die Vorlage des Hakens.
        expect(vorher.pitch).toBe(45);
    });

    it("in der Bildmitte bleibt die Mitte, wo sie ist", () => {
        expect(mitteUmAnker(modell(100, 45), 60, { x: 640, y: 360 })).toBeCloseTo(100, 9);
    });

    it("ohne Anker, ohne Transformation (Attrappe) oder mit dem Anker im Himmel kippt sie um die Bildmitte", () => {
        expect(mitteUmAnker(modell(100, 45), 60, undefined)).toBeUndefined();
        expect(mitteUmAnker({ center: 100 } as Partial<AnkerTransform<number>>, 60, { x: 0, y: 500 })).toBeUndefined();
        expect(
            mitteUmAnker(modell(100, 45, { isPointOnMapSurface: () => false }), 60, { x: 0, y: 10 }),
        ).toBeUndefined();
        const imHimmel = modell(100, 45, { screenTerrainPointToMercatorCoordinate: () => null });
        expect(mitteUmAnker(imHimmel, 60, { x: 0, y: 10 }, {})).toBeUndefined();
    });

    it("mit Gelände hält sie den Ort des Geländes auf seiner Höhe fest; zu nah am Auge auf der Höhe der Mitte, wie MapLibre", () => {
        const gelaende = {};
        const treffer = (z: number) => ({ z, toLngLat: () => 123 });
        const mitHoehe = modell(100, 45, {
            elevation: 0,
            getCameraAltitude: () => 1000,
            screenTerrainPointToMercatorCoordinate: () => treffer(400),
        });
        const mitte = mitteUmAnker(mitHoehe, 60, { x: 0, y: 500 }, gelaende);
        expect(ortUnter(mitte!, 60, { x: 0, y: 500 })).toBeCloseTo(123, 9);
        expect(mitHoehe.hoehen).toEqual([400]);

        const nahAmAuge = modell(100, 45, {
            elevation: 0,
            getCameraAltitude: () => 1000,
            screenTerrainPointToMercatorCoordinate: () => treffer(950),
        });
        const mitte2 = mitteUmAnker(nahAmAuge, 60, { x: 0, y: 500 }, gelaende);
        expect(ortUnter(mitte2!, 60, { x: 0, y: 500 })).toBeCloseTo(ortUnter(100, 45, { x: 0, y: 500 }), 9);
        expect(nahAmAuge.hoehen).toEqual([undefined]);
    });
});
