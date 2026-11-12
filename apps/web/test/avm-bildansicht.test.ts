import { describe, expect, it } from "vitest";
import type { MediaGalleryDetail } from "@avesmaps3d/shared";
import {
    blaettern,
    einpassen,
    HOECHSTENS_VERGROESSERT,
    stelleNachTaste,
    wischRichtung,
} from "../src/controls/avm-bildansicht-modell.ts";
import { ansichtFolge } from "../src/medien/medien-inspektor-modell.ts";

/**
 * Die Bildansicht (Betreiber 2026-10-11, wörtlich: „kannst du bei einem klick auf ein bild einer lightbox vollansicht machen (mit < und >
 * wenns mehrere (1,2,3) oder in eine galerie gibt, ESC lässt es wieder verschwinden“; Guide §13.46).
 */
describe("Bildansicht: einpassen und blättern", () => {
    it("passt ein, ohne das Seitenverhältnis zu ändern, und verdoppelt ein kleines Bild höchstens", () => {
        // Ein Kopfbild 800 × 450 auf 1360 × 800 Platz: begrenzt von der Breite? 1360/800 = 1,7, 800/450 = 1,78 → 1,7.
        expect(einpassen({ breite: 800, hoehe: 450 }, { breite: 1360, hoehe: 800 })).toEqual({
            breite: 1360,
            hoehe: 765,
        });
        // Ein Wappen 512 × 512 auf großem Schirm: höchstens doppelt.
        expect(einpassen({ breite: 512, hoehe: 512 }, { breite: 3000, hoehe: 2000 })).toEqual({
            breite: 512 * HOECHSTENS_VERGROESSERT,
            hoehe: 512 * HOECHSTENS_VERGROESSERT,
        });
        // Eine große Karte wird kleiner, hochkant begrenzt von der Höhe.
        expect(einpassen({ breite: 2000, hoehe: 3000 }, { breite: 1000, hoehe: 600 })).toEqual({
            breite: 400,
            hoehe: 600,
        });
        // Ohne Maße oder ohne Platz: nichts gerechnet, der Browser nimmt die natürliche Größe.
        expect(einpassen({}, { breite: 1000, hoehe: 600 })).toBeUndefined();
        expect(einpassen({ breite: 800, hoehe: 450 }, { breite: 0, hoehe: 0 })).toBeUndefined();
    });

    it("blättert im Kreis, nur bei mehreren Bildern; Pfeiltasten, Pos1 und Ende", () => {
        expect(blaettern(2, 1, 3)).toBe(0);
        expect(blaettern(0, -1, 3)).toBe(2);
        expect(blaettern(0, 1, 1)).toBeNull();
        expect(stelleNachTaste("ArrowRight", 0, 7)).toBe(1);
        expect(stelleNachTaste("ArrowLeft", 0, 7)).toBe(6);
        expect(stelleNachTaste("End", 2, 7)).toBe(6);
        expect(stelleNachTaste("Home", 5, 7)).toBe(0);
        expect(stelleNachTaste("Home", 0, 1)).toBeNull();
        expect(stelleNachTaste("Enter", 0, 7)).toBeNull();
    });

    it("eine Wischgeste blättert nur, wenn sie weit genug und mehr waagerecht ist", () => {
        expect(wischRichtung(-80, 10)).toBe(1);
        expect(wischRichtung(80, -10)).toBe(-1);
        expect(wischRichtung(-30, 0)).toBe(0);
        expect(wischRichtung(-60, 90)).toBe(0);
    });
});

describe("Bildansicht im Inspector: die Folge", () => {
    const vorschau = (n: number) => ({
        url: `/media/published/sha256/aa/bb/${String(n).padStart(64, "a")}.webp`,
        width: 800,
        height: 450,
    });
    const eintrag = (
        id: string,
        position: number,
        extra: { retired?: boolean; ohneBild?: boolean; titel?: string } = {},
    ) => ({
        asset: {
            id,
            revision: 1,
            title: extra.titel ?? null,
            kind: "image" as const,
            technicalState: "ok" as const,
            clearance: null,
            preview: extra.ohneBild === true ? null : vorschau(position),
        },
        position,
        retired: extra.retired ?? false,
    });
    const galerie = (items: ReturnType<typeof eintrag>[]) => ({ items }) as unknown as MediaGalleryDetail;
    const einzeln = { url: "/media/published/einzeln.webp", breite: 512, hoehe: 512, titel: "Wappen von Gareth" };

    it("steht das Asset in einer Galerie, blättert die Ansicht durch ihre Bilder (1, 2, 3), ab dem gewählten", () => {
        const folge = ansichtFolge(
            [
                galerie([
                    eintrag("a", 1, { titel: "Bild von Gareth (1)" }),
                    eintrag("b", 2, { titel: "Bild von Gareth (2)" }),
                    eintrag("x", 3, { retired: true }),
                    eintrag("y", 4, { ohneBild: true }),
                    eintrag("c", 5, { titel: "Bild von Gareth (3)" }),
                ]),
            ],
            "b",
            einzeln,
        );
        expect(folge?.stelle).toBe(1);
        expect(folge?.bilder.map((bild) => bild.titel)).toEqual([
            "Bild von Gareth (1)",
            "Bild von Gareth (2)",
            "Bild von Gareth (3)",
        ]);
    });

    it("ohne Galerie das eine Bild; ohne Bild keine Ansicht", () => {
        expect(ansichtFolge([], "w", einzeln)).toEqual({ bilder: [einzeln], stelle: 0 });
        // Eine Galerie, in der das Asset allein steht, blättert nicht.
        expect(ansichtFolge([galerie([eintrag("w", 1)])], "w", einzeln)).toEqual({ bilder: [einzeln], stelle: 0 });
        expect(ansichtFolge([], "w", undefined)).toBeUndefined();
    });
});
