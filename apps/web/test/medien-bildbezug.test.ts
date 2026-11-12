import { describe, expect, it } from "vitest";
import type { MediaGalleryDetail, MediaUsage } from "@avesmaps3d/shared";
import { bezugWert, bildbezugSatz, bildbezugZeile, hatBildbezug } from "../src/medien/medien-bildbezug-modell";

/**
 * Der Bildbezug einer Verwendung im Inspector (WI-0068, Betreiber 2026-10-11). Geprüft wird vor allem das, woran die Operation
 * sonst still scheitert: die `baseRevision` kommt bei einem Galerieeintrag aus der GALERIE, nicht aus dem Eintrag.
 */

const ASSET = "6dcf1e76-4c1a-4b0e-9a6e-2f1d3c4b5a69";
const ORT = "80558060-4299-54aa-b520-814b10819885";
const GALERIE = "aa4f8283-8a20-4141-996f-9fc7f3a3e505";

const verwendung = (teil: Partial<MediaUsage> = {}): MediaUsage => ({
    via: "gallery",
    subject: { kind: "place", id: ORT, name: "Gareth", active: true },
    role: "header",
    gallery: { id: GALERIE, title: null, kind: "object_gallery", position: 1 },
    origin: "legacy",
    revision: 4,
    override: { state: "none", decidedOn: null, decidedBy: null, reason: null, operatorQuote: null },
    publication: { public: true, reason: "rule" },
    relation: { value: "place_view", rule: "place_view", override: null, places: 1 },
    ...teil,
});

const galerie = (revision: number): MediaGalleryDetail => ({ id: GALERIE, revision }) as unknown as MediaGalleryDetail;

/**
 * Eine Verwendung OHNE Bildbezug. Der Schlüssel wird ENTFERNT statt auf `undefined` gesetzt: `exactOptionalPropertyTypes` macht
 * zwischen „fehlt“ und „ist undefined“ einen Unterschied, und der Server lässt das Feld wirklich weg.
 */
const ohneBezug = (teil: Partial<MediaUsage> = {}): MediaUsage => {
    const rest: Record<string, unknown> = { ...verwendung(teil) };
    delete rest["relation"];
    return rest as unknown as MediaUsage;
};

describe("Wo es überhaupt einen Bildbezug gibt", () => {
    it("am Titelbild eines Ortes ja", () => {
        expect(hatBildbezug(verwendung())).toBe(true);
    });

    it("🔴 nirgends sonst - der Server setzt das Feld nur dort", () => {
        expect(hatBildbezug(ohneBezug())).toBe(false);
        expect(hatBildbezug(ohneBezug({ subject: null, role: null }))).toBe(false);
        expect(
            hatBildbezug(
                verwendung({
                    subject: { kind: "territory", id: ORT, name: "Garether Mark", active: true },
                    role: "coat",
                }),
            ),
        ).toBe(false);
    });
});

describe("Die Revision der Operation", () => {
    it("🔴 bei einem Galerieeintrag die der GALERIE, nicht die des Eintrags", () => {
        const zeile = bildbezugZeile(verwendung({ revision: 4 }), ASSET, [galerie(17)]);
        expect(zeile?.anfrage).toEqual({ placeId: ORT, assetId: ASSET, via: "gallery", baseRevision: 17 });
    });

    it("bei einer direkten Bindung die der Bindung", () => {
        const zeile = bildbezugZeile(verwendung({ via: "binding", gallery: null, revision: 9 }), ASSET, []);
        expect(zeile?.anfrage).toEqual({ placeId: ORT, assetId: ASSET, via: "binding", baseRevision: 9 });
    });

    it("🔴 ohne geladene Galerie KEINE Anfrage - lieber gesperrt als mit geratener Revision senden", () => {
        expect(bildbezugZeile(verwendung(), ASSET, [])?.anfrage).toBeUndefined();
        // Auch eine andere Galerie hilft nicht.
        expect(
            bildbezugZeile(verwendung(), ASSET, [
                { id: "431e25ed-044d-4217-83d6-35ae4b156f68", revision: 3 } as unknown as MediaGalleryDetail,
            ])?.anfrage,
        ).toBeUndefined();
    });

    it("gibt ohne Bildbezug gar keine Zeile", () => {
        expect(bildbezugZeile(ohneBezug(), ASSET, [galerie(1)])).toBeUndefined();
    });
});

describe("Die Stellung des Schalters und ihr Satz", () => {
    it("ohne Übersteuerung steht er auf „Regel“", () => {
        const zeile = bildbezugZeile(verwendung(), ASSET, [galerie(2)])!;
        expect(zeile.stellung).toBe("regel");
        expect(bildbezugSatz(zeile)).toEqual({ schluessel: "regelEinOrt", orte: 1 });
    });

    it("mehrere Orte: die Regel sagt Typbild und sagt auch, warum", () => {
        const zeile = bildbezugZeile(
            verwendung({ relation: { value: "type_image", rule: "type_image", override: null, places: 15 } }),
            ASSET,
            [galerie(2)],
        )!;
        expect(bildbezugSatz(zeile)).toEqual({ schluessel: "regelMehrereOrte", orte: 15 });
    });

    it("ohne Quelldatei gibt es keine Identität - Typbild, und das ist keine Null-Orte-Aussage", () => {
        const zeile = bildbezugZeile(
            verwendung({ relation: { value: "type_image", rule: "type_image", override: null, places: 0 } }),
            ASSET,
            [galerie(2)],
        )!;
        expect(bildbezugSatz(zeile)).toEqual({ schluessel: "regelOhneDatei", orte: 0 });
    });

    it("🔴 eine Übersteuerung gewinnt in BEIDE Richtungen und nennt, was die Regel sagen würde", () => {
        const gegenDieRegel = bildbezugZeile(
            verwendung({ relation: { value: "place_view", rule: "type_image", override: "place_view", places: 15 } }),
            ASSET,
            [galerie(2)],
        )!;
        expect(gegenDieRegel.stellung).toBe("place_view");
        expect(gegenDieRegel.gilt).toBe("place_view");
        expect(gegenDieRegel.regel).toBe("type_image");
        expect(bildbezugSatz(gegenDieRegel).schluessel).toBe("ueberschrieben");

        const andersherum = bildbezugZeile(
            verwendung({ relation: { value: "type_image", rule: "place_view", override: "type_image", places: 1 } }),
            ASSET,
            [galerie(2)],
        )!;
        expect(andersherum.stellung).toBe("type_image");
        expect(bildbezugSatz(andersherum).schluessel).toBe("ueberschrieben");
    });
});

describe("Was die Operation als Wert bekommt", () => {
    it("🔴 „Regel“ sendet null - das ist das Zurückgeben, nicht das Setzen eines Werts", () => {
        expect(bezugWert("regel")).toBeNull();
        expect(bezugWert("place_view")).toBe("place_view");
        expect(bezugWert("type_image")).toBe("type_image");
    });
});
