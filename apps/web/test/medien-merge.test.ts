import { describe, expect, it } from "vitest";
import type { MediaAssetDetail, MediaUsageResult } from "@avesmaps3d/shared";
import {
    masseSatz,
    mergeKandidaten,
    mergeSatz,
    rechteWeichenAb,
    vorgabeBleibt,
} from "../src/medien/medien-merge-modell";

/**
 * Was das Fenster „Zusammenführen“ rechnet (WI-0068 D1). Die Fälle sind die, an denen eine Vorgabe sonst still das Falsche
 * vorschlägt: ein fehlendes Maß, das die Wahl entscheidet, und abweichende Rechte, die niemandem auffallen.
 */

const kandidat = (id: string, flaeche: number | undefined, rechte = "own_work", verwendungen = 1) => ({
    assetId: id,
    revision: 1,
    name: id,
    flaeche,
    masse: "—",
    rechte,
    verwendungen,
});

const detail = (breite: number | null, hoehe: number | null): MediaAssetDetail =>
    ({
        asset: { id: "a", revision: 7 },
        rights: { basis: "own_work" },
        representations: [
            { storageClass: "derivative", width: 99, height: 99 },
            { storageClass: "private_source", width: breite, height: hoehe },
        ],
    }) as unknown as MediaAssetDetail;

describe("Welches Bild bleibt", () => {
    it("🔴 die größte Auflösung - so hat es der Betreiber entschieden", () => {
        expect(vorgabeBleibt([kandidat("klein", 100), kandidat("gross", 900), kandidat("mittel", 400)])).toBe("gross");
    });

    it("🪤 ein Bild OHNE bekannte Maße gewinnt nie - sonst entschiede ein fehlender Wert die Frage", () => {
        expect(vorgabeBleibt([kandidat("ohne", undefined), kandidat("mit", 1)])).toBe("mit");
        // Nur wenn gar nichts bekannt ist, gilt das erste.
        expect(vorgabeBleibt([kandidat("erstes", undefined), kandidat("zweites", undefined)])).toBe("erstes");
    });

    it("bei gleicher Fläche bleibt das erste", () => {
        expect(vorgabeBleibt([kandidat("a", 500), kandidat("b", 500)])).toBe("a");
    });

    it("eine leere Liste hat keine Vorgabe", () => {
        expect(vorgabeBleibt([])).toBeUndefined();
    });
});

describe("Die Rechte", () => {
    it("🔴 weichen sie ab, muss ein Mensch hinsehen", () => {
        expect(rechteWeichenAb([kandidat("a", 1, "own_work"), kandidat("b", 1, "public_domain")])).toBe(true);
        expect(rechteWeichenAb([kandidat("a", 1, "own_work"), kandidat("b", 1, "own_work")])).toBe(false);
    });
});

describe("Die Maße", () => {
    it("kommen aus dem ORIGINAL, nicht aus einer gerechneten Fassung", () => {
        expect(masseSatz(detail(2000, 1200))).toContain("2");
        expect(masseSatz(detail(2000, 1200))).not.toContain("99");
    });

    it("ohne Maße ein Strich, nie eine erfundene Zahl", () => {
        expect(masseSatz(detail(null, null))).toBe("—");
        expect(masseSatz(undefined)).toBe("—");
    });
});

describe("Der Satz unter der Liste", () => {
    it("🔴 nennt die Zahl der Verwendungen, die umziehen - das ist die Veränderung", () => {
        const satz = mergeSatz([kandidat("bleibt", 9, "own_work", 2), kandidat("geht", 1, "own_work", 3)], "bleibt");
        expect(satz).toContain("3");
    });

    it("ohne Wahl und ohne aufgehendes Bild steht derselbe Satz", () => {
        expect(mergeSatz([kandidat("a", 1)], undefined)).toBe(mergeSatz([], "a"));
    });
});

describe("Die Kandidaten einer Gruppe", () => {
    const verwendung = {
        asset: { id: "selbst", revision: 3 },
        usages: [{}, {}],
        retired: 0,
        sameFile: [{ asset: { id: "anderes", revision: 5, title: "Anderes", kind: "image" }, usages: [{}] }],
    } as unknown as MediaUsageResult;

    it("nehmen das eigene Werk MIT - es ist Teil der Gruppe, nicht ihr Gegenüber", () => {
        const liste = mergeKandidaten(verwendung, "Eigenes", new Map());
        expect(liste.map((eintrag) => eintrag.assetId)).toEqual(["selbst", "anderes"]);
        expect(liste[0]?.name).toBe("Eigenes");
        expect(liste[0]?.verwendungen).toBe(2);
    });

    it("🪤 ohne geladenes Detail bleibt die Revision aus der Reverse Usage - geraten wird nichts", () => {
        const liste = mergeKandidaten(verwendung, "Eigenes", new Map());
        expect(liste.map((eintrag) => eintrag.revision)).toEqual([3, 5]);
        const mitDetail = mergeKandidaten(verwendung, "Eigenes", new Map([["selbst", detail(10, 10)]]));
        expect(mitDetail[0]?.revision, "mit Detail gilt dessen Revision").toBe(7);
        expect(mitDetail[0]?.flaeche).toBe(100);
    });
});
