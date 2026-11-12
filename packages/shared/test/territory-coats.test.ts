import { describe, expect, it } from "vitest";
import {
    COAT_IMAGE_PREFIX,
    coatImageId,
    coatImageUrl,
    mediaPublicUrl,
    parseTerritoryCoats,
    readTerritoryCoats,
    territoryCoatImages,
} from "../src/index.ts";

/**
 * Die Wappenliste der Gebiete (WI-0121): ein Vertrag, den der Server streng und der Client tolerant prüft.
 */

const SHA_A = "ab".repeat(32);
const SHA_B = "cd".repeat(32);
const GEBIET_A = "e201c69b-4811-48fd-826c-60ed976c73e0";
const GEBIET_B = "8358472a-b164-438b-a508-60a0a4b8e7aa";
const LISTE = {
    schemaVersion: 1,
    coats: { [GEBIET_A]: mediaPublicUrl(SHA_A), [GEBIET_B]: mediaPublicUrl(SHA_B) },
};

describe("Vertrag", () => {
    it("🔴 der Server prüft streng: nur Kennungen und Adressen des Media Core, kein Feld mehr", () => {
        expect(parseTerritoryCoats(LISTE)).toEqual(LISTE);
        expect(parseTerritoryCoats({ schemaVersion: 1, coats: {} })).toEqual({ schemaVersion: 1, coats: {} });
        expect(() => parseTerritoryCoats({ ...LISTE, neu: 1 })).toThrow(/Gebietswappenliste/);
        // Eine Kennung, die keine UUID ist, und eine Adresse außerhalb von /media/sha256 gehen nicht hinaus.
        expect(() => parseTerritoryCoats({ schemaVersion: 1, coats: { Gareth: mediaPublicUrl(SHA_A) } })).toThrow();
        expect(() =>
            parseTerritoryCoats({ schemaVersion: 1, coats: { [GEBIET_A]: "https://example.org/wappen.webp" } }),
        ).toThrow();
        expect(() =>
            parseTerritoryCoats({ schemaVersion: 1, coats: { [GEBIET_A]: `${mediaPublicUrl(SHA_A)}?v=1` } }),
        ).toThrow();
        expect(() => parseTerritoryCoats({ schemaVersion: 2, coats: {} })).toThrow();
    });

    it("🔴 der Client liest tolerant: ein neues Feld des Servers fällt weg, was er kennt, gilt weiter streng", () => {
        expect(readTerritoryCoats({ ...LISTE, neuesFeld: { x: 1 } })).toEqual(LISTE);
        expect(() => readTerritoryCoats({ schemaVersion: 1, coats: { [GEBIET_A]: "/etc/passwd" } })).toThrow();
        expect(() => readTerritoryCoats(null)).toThrow();
    });
});

describe("Bildnamen", () => {
    it("🔴 der Name ist coat:<sha256>, und zwei Gebiete mit demselben Bild teilen ihn", () => {
        expect(coatImageId(mediaPublicUrl(SHA_A))).toBe(`${COAT_IMAGE_PREFIX}${SHA_A}`);
        const geteilt = territoryCoatImages({
            schemaVersion: 1,
            coats: { [GEBIET_A]: mediaPublicUrl(SHA_A), [GEBIET_B]: mediaPublicUrl(SHA_A) },
        });
        expect(geteilt).toEqual({ [GEBIET_A]: `coat:${SHA_A}`, [GEBIET_B]: `coat:${SHA_A}` });
    });

    it("🔴 aus dem Namen wird nur die Adresse einer veröffentlichten Datei, nie eine fremde", () => {
        expect(coatImageUrl(`coat:${SHA_B}`)).toBe(mediaPublicUrl(SHA_B));
        for (const fremd of [
            "coat:../../etc/passwd",
            `coat:${SHA_A.toUpperCase()}`,
            `coat:${SHA_A}.webp`,
            `coat:${SHA_A.slice(2)}`,
            `claim-3-aabbcc-112233`,
            `https://example.org/${SHA_A}.webp`,
            "",
        ]) {
            expect(coatImageUrl(fremd), fremd).toBeUndefined();
        }
        // Und eine Adresse, die nicht aus mediaPublicUrl stammt, bekommt keinen Namen.
        expect(coatImageId(`/media/sha256/00/00/${SHA_A}.webp`)).toBeUndefined();
        expect(coatImageId(`https://example.org/${SHA_A}.webp`)).toBeUndefined();
    });
});
