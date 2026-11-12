import { describe, expect, it } from "vitest";
import type { MamGallerySummary, MediaGalleryDetail } from "@avesmaps3d/shared";
import {
    entfernenHindernis,
    galerieCover,
    verschobeneFolge,
    galerieEintraege,
    galerieName,
    galerieOrte,
    galerieUnterzeile,
    istEntwurf,
} from "../src/medien/medien-galerien-modell";

/**
 * Was die Galerieliste und der Galerie-Inspector rechnen (WI-0068 P6). Die Fälle sind die, an denen eine Galerieoberfläche sonst
 * still das Falsche sagt: fast keine Galerie hat einen Titel, zurückgezogene Einträge stehen im Vertrag an ihrer Stelle, und ein
 * Cover kann auf einen Eintrag zeigen, den es nicht mehr gibt.
 */

const zeile = (teil: Partial<MamGallerySummary> = {}): MamGallerySummary => ({
    id: "aa4f8283-8a20-4141-996f-9fc7f3a3e505",
    revision: 3,
    title: null,
    kind: "object_gallery",
    origin: "legacy",
    publicationState: "published",
    items: 7,
    places: [{ id: "80558060-4299-54aa-b520-814b10819885", name: "Gareth" }],
    draft: false,
    previews: [],
    ...teil,
});

const eintrag = (id: string, retired = false): MediaGalleryDetail["items"][number] =>
    ({
        asset: { id, title: null, preview: null },
        retired,
        caption: null,
    }) as unknown as MediaGalleryDetail["items"][number];

const detail = (teil: Partial<MediaGalleryDetail> = {}): MediaGalleryDetail =>
    ({ items: [], bindings: [], coverAssetId: null, ...teil }) as unknown as MediaGalleryDetail;

describe("Der Name einer Galerie", () => {
    it("nimmt den Titel, wenn es einen gibt", () => {
        expect(galerieName(zeile({ title: "Hafenbilder" }))).toBe("Hafenbilder");
    });

    it("🔴 sonst die Orte - im Bestand trägt KEINE der 82 Galerien einen Titel", () => {
        expect(galerieName(zeile())).toBe("Gareth");
        expect(
            galerieName(
                zeile({
                    places: [
                        { id: "a", name: "Gareth" },
                        { id: "b", name: "Gareth-Oberstadt" },
                    ],
                }),
            ),
        ).toBe("Gareth · Gareth-Oberstadt");
    });

    it("ein leerer Titel zählt nicht als Titel", () => {
        expect(galerieName(zeile({ title: "   " }))).toBe("Gareth");
    });

    it("ohne Titel und ohne Ort der Platzhalter - nie eine nackte Kennung", () => {
        expect(galerieName(zeile({ places: [] }))).not.toContain("aa4f8283");
    });
});

describe("Die Unterzeile", () => {
    it("nennt Bilder, Orte und Herkunft", () => {
        expect(galerieUnterzeile(zeile())).toContain("7 Bilder");
        expect(galerieUnterzeile(zeile())).toContain("an einem Ort");
        expect(galerieUnterzeile(zeile({ items: 1 }))).toContain("1 Bild");
        expect(
            galerieUnterzeile(
                zeile({
                    places: [
                        { id: "a", name: "A" },
                        { id: "b", name: "B" },
                    ],
                }),
            ),
        ).toContain("an 2 Orten");
    });

    it("🔴 ein Entwurf sagt zuerst, dass er keinem Ort gehört - nicht „an 0 Orten“", () => {
        const satz = galerieUnterzeile(zeile({ draft: true, places: [] }));
        expect(satz).toContain("noch keinem Ort zugeordnet");
        expect(satz).not.toContain("0");
    });
});

describe("Die Einträge einer Galerie", () => {
    it("🔴 zurückgezogene stehen hinten, nicht an ihrer Stelle - sie sind Verlauf, kein Teil der Galerie", () => {
        const g = detail({ items: [eintrag("a"), eintrag("b", true), eintrag("c")] });
        const { aktiv, zurueckgezogen } = galerieEintraege(g);
        expect(aktiv.map((e) => e.asset.id)).toEqual(["a", "c"]);
        expect(zurueckgezogen.map((e) => e.asset.id)).toEqual(["b"]);
    });

    it("hält eine noch nicht geladene Galerie aus", () => {
        expect(galerieEintraege(undefined)).toEqual({ aktiv: [], zurueckgezogen: [] });
    });
});

describe("Das Titelbild", () => {
    it("nimmt das gesetzte Cover", () => {
        const g = detail({ items: [eintrag("a"), eintrag("b")], coverAssetId: "b" });
        expect(galerieCover(g)).toBe("b");
    });

    it("ohne Cover den ersten aktiven Eintrag", () => {
        expect(galerieCover(detail({ items: [eintrag("a"), eintrag("b")] }))).toBe("a");
    });

    it("🔴 ein Cover auf einem zurückgezogenen Eintrag gilt nicht - sonst zeigte die Galerie ein Bild, das sie nicht mehr führt", () => {
        const g = detail({ items: [eintrag("a"), eintrag("b", true)], coverAssetId: "b" });
        expect(galerieCover(g)).toBe("a");
    });

    it("eine leere Galerie hat keines", () => {
        expect(galerieCover(detail())).toBeUndefined();
        expect(galerieCover(undefined)).toBeUndefined();
    });
});

describe("Entwurf und Orte", () => {
    const bindung = (name: string, retired = false): MediaGalleryDetail["bindings"][number] =>
        ({ subject: { id: name, name }, role: "header", origin: "legacy", retired, revision: 1 }) as never;

    it("🔴 nur AKTIVE Bindungen zählen - eine gelöste macht die Galerie wieder zum Entwurf", () => {
        expect(istEntwurf(detail({ bindings: [bindung("Gareth")] }))).toBe(false);
        expect(istEntwurf(detail({ bindings: [bindung("Gareth", true)] }))).toBe(true);
        expect(istEntwurf(detail())).toBe(true);
        expect(galerieOrte(detail({ bindings: [bindung("Gareth"), bindung("Alt", true)] }))).toHaveLength(1);
    });

    it("ohne geladene Galerie ist nichts ein Entwurf (es gibt noch keine Aussage)", () => {
        expect(istEntwurf(undefined)).toBe(false);
        expect(galerieOrte(undefined)).toEqual([]);
    });
});

describe("Ein Bild in der Folge verschieben", () => {
    const drei = detail({ items: [eintrag("a"), eintrag("b"), eintrag("c")] });

    it("tauscht mit dem Nachbarn", () => {
        expect(verschobeneFolge(drei, "b", -1)).toEqual(["b", "a", "c"]);
        expect(verschobeneFolge(drei, "b", 1)).toEqual(["a", "c", "b"]);
    });

    it("am Rand geht nichts - undefined, damit der Knopf gesperrt dasteht statt zu scheitern", () => {
        expect(verschobeneFolge(drei, "a", -1)).toBeUndefined();
        expect(verschobeneFolge(drei, "c", 1)).toBeUndefined();
        expect(verschobeneFolge(undefined, "a", 1)).toBeUndefined();
        expect(verschobeneFolge(drei, "weg", 1)).toBeUndefined();
    });

    it("🪤 zurückgezogene Einträge stehen NICHT in der Folge - sonst weist der Server sie ab", () => {
        const mitVerlauf = detail({ items: [eintrag("a"), eintrag("alt", true), eintrag("c")] });
        expect(verschobeneFolge(mitVerlauf, "a", 1)).toEqual(["c", "a"]);
        expect(verschobeneFolge(mitVerlauf, "alt", 1), "ein zurückgezogenes Bild verschiebt man nicht").toBeUndefined();
    });
});

describe("Galerie entfernen: wann es nicht geht (WI-0068 R3)", () => {
    const ICH = "1b2c3d4e-0000-4000-8000-000000000001";
    const ort = {
        subject: { kind: "place", id: "p1", name: "Gareth", active: true },
        role: "header",
        origin: "editor",
        retired: false,
        revision: 1,
    };
    it("🔴 eigene ohne Ort geht; aus Legacy, an einem Ort oder von jemand anderem nicht", () => {
        const eigene = detail({ fromLegacy: false, createdBy: { id: ICH, displayName: "Ich" } });
        expect(entfernenHindernis(eigene, ICH)).toBeUndefined();
        expect(entfernenHindernis(detail({ fromLegacy: true, createdBy: null }), ICH)).toBe("legacy");
        expect(entfernenHindernis({ ...eigene, bindings: [ort] } as unknown as MediaGalleryDetail, ICH)).toBe("bound");
        // Ein zurückgezogener Ort hindert nicht: Er ist nur noch Verlauf.
        expect(
            entfernenHindernis(
                { ...eigene, bindings: [{ ...ort, retired: true }] } as unknown as MediaGalleryDetail,
                ICH,
            ),
        ).toBeUndefined();
        expect(entfernenHindernis(eigene, "jemand-anderes")).toBe("foreign");
        // Eine ältere Antwort ohne die Felder: Die Oberfläche sperrt nicht, der Server entscheidet.
        expect(entfernenHindernis(detail(), ICH)).toBeUndefined();
    });
});
