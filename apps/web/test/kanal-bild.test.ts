import { describe, expect, it } from "vitest";
import { neuerName, zielMasse } from "../src/auth/kanal-bild.ts";

/** Das Verkleinern im Browser (KANAL-0001 §6.1 Schritt 0): nur verkleinern, nie vergrößern; der Name bekommt die neue Endung. */
describe("Bilder im Kanal vorbereiten", () => {
    it("🔴 ein Telefonfoto 4032 × 3024 wird auf 2560 an der langen Kante verkleinert, hochkant ebenso", () => {
        expect(zielMasse(4032, 3024, 2560)).toEqual({ breite: 2560, hoehe: 1920 });
        expect(zielMasse(3024, 4032, 2560)).toEqual({ breite: 1920, hoehe: 2560 });
        expect(zielMasse(4032, 3024, 1920)).toEqual({ breite: 1920, hoehe: 1440 });
    });

    it("ein kleines Bild bleibt in seiner Größe (es wird trotzdem neu kodiert)", () => {
        expect(zielMasse(1280, 900, 2560)).toEqual({ breite: 1280, hoehe: 900 });
        expect(zielMasse(2560, 10, 2560)).toEqual({ breite: 2560, hoehe: 10 });
        expect(zielMasse(9000, 1, 2560)).toEqual({ breite: 2560, hoehe: 1 });
    });

    it("der Name trägt die Endung der neuen Kodierung, ohne Pfad", () => {
        expect(neuerName("IMG_2041.HEIC.jpg", "image/webp")).toBe("IMG_2041.HEIC.webp");
        expect(neuerName("bildschirmfoto.png", "image/png")).toBe("bildschirmfoto.png");
        expect(neuerName(".jpg", "image/webp")).toBe("bild.webp");
    });
});
