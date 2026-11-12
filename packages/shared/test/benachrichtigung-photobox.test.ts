import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    BENACHRICHTIGUNG_ARTEN,
    COMMUNITY_GLOCKEN_ARTEN,
    MEDIA_PHOTOBOX_STAPEL_URL,
    MEDIA_PHOTOBOX_URL,
    PHOTOBOX_GLOCKEN_ARTEN,
    PHOTOBOX_STAPEL_MAX,
    PhotoboxStapel,
    SOCIAL_GLOCKEN_ARTEN,
    STOERUNG_ARTEN,
    WARTESCHLANGE_ARTEN,
    photoboxEingangAnzahl,
} from "../src/index.ts";

/**
 * Die Glocke für neue Reisebilder (WI-0272 S3, Aufgabe 19): die Art `photobox_eingang`, ihre Gruppe und der Vertrag des Stapels in Community › Meldungen.
 */

describe("Glocke: Art photobox_eingang", () => {
    it("🔴 steht im Katalog und in einer eigenen Gruppe, die mit keiner anderen Gruppe Arten teilt", () => {
        expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain("photobox_eingang");
        expect(PHOTOBOX_GLOCKEN_ARTEN).toEqual(["photobox_eingang"]);
        for (const andere of [COMMUNITY_GLOCKEN_ARTEN, SOCIAL_GLOCKEN_ARTEN, STOERUNG_ARTEN, WARTESCHLANGE_ARTEN]) {
            expect(andere).not.toContain("photobox_eingang");
        }
        // Jede Art der Gruppe steht im Katalog (sonst fände die Ausnahme der Warteschlange nichts, was sie ausnehmen könnte).
        for (const art of PHOTOBOX_GLOCKEN_ARTEN) expect(BENACHRICHTIGUNG_ARTEN as readonly string[]).toContain(art);
    });

    it("die Bündelung steht als Zahl im Text; ohne Zahl (eine Einreichung, kein Text) gibt es keine Anzahl", () => {
        expect(photoboxEingangAnzahl("2")).toBe(2);
        expect(photoboxEingangAnzahl("12")).toBe(12);
        expect(photoboxEingangAnzahl(null)).toBeUndefined();
        expect(photoboxEingangAnzahl("")).toBeUndefined();
        expect(photoboxEingangAnzahl("0")).toBeUndefined();
        // Nie ein Text der Einreichung: Was keine Zahl ist, ist keine Anzahl.
        expect(photoboxEingangAnzahl("Der Blick vom Hafen")).toBeUndefined();
        expect(photoboxEingangAnzahl("COM-000123")).toBeUndefined();
        expect(photoboxEingangAnzahl("1234567")).toBeUndefined();
    });
});

describe("Stapel neuer Reisebilder (GET /api/editor/media/photobox/stapel)", () => {
    it("die Adresse hängt unter der Medienverwaltung", () => {
        expect(MEDIA_PHOTOBOX_STAPEL_URL).toBe(`${MEDIA_PHOTOBOX_URL}/stapel`);
        expect(MEDIA_PHOTOBOX_STAPEL_URL).toBe("/api/editor/media/photobox/stapel");
    });

    const vorschau = (n: number) => ({
        publicId: `0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b${String(10 + n)}`,
        url: `/api/editor/media/0b9f4c1e-6f0a-4a63-9f2b-3c1d5e7a9b${String(10 + n)}/preview/intern_photobox_2048`,
    });

    it("🔴 offen und höchstens fünf Vorschauen, nichts sonst", () => {
        expect(PHOTOBOX_STAPEL_MAX).toBe(5);
        expect(Value.Check(PhotoboxStapel, { offen: 0, vorschau: [] })).toBe(true);
        expect(Value.Check(PhotoboxStapel, { offen: 9, vorschau: [1, 2, 3, 4, 5].map(vorschau) })).toBe(true);
        expect(Value.Check(PhotoboxStapel, { offen: 9, vorschau: [1, 2, 3, 4, 5, 6].map(vorschau) })).toBe(false);
        expect(Value.Check(PhotoboxStapel, { offen: -1, vorschau: [] })).toBe(false);
        expect(Value.Check(PhotoboxStapel, { offen: 1, vorschau: [], beschreibung: "x" })).toBe(false);
        expect(Value.Check(PhotoboxStapel, { offen: 1, vorschau: [{ ...vorschau(1), name: "Alrik" }] })).toBe(false);
        expect(Value.Check(PhotoboxStapel, { offen: 1, vorschau: [{ publicId: "kein-uuid", url: "/x" }] })).toBe(false);
    });
});
