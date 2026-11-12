import { describe, expect, it } from "vitest";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import {
    leereLinkZeile,
    linksAnfrage,
    linkZeilenAus,
    linkZeilenNachladen,
} from "../src/medien/medien-karte-links-modell";

type Links = Pick<MamKarteDetail, "links">;
const mitLinks: Links = {
    links: [
        { role: "primary", url: "https://example.org/karte", label: "Die Karte", isPaid: false },
        { role: "further", url: "https://example.org/band", label: "Band", isPaid: true },
        { role: "further", url: "https://example.org/offen", label: "Offen", isPaid: null },
    ],
};
const ohneLinks: Links = { links: [] };

describe("Fundstellen der Kartensammlung: die Zeilen lesen (WI-0287)", () => {
    it("die Zeilen folgen der Folge der Links, „Kostenpflichtig“ bleibt dreiwertig", () => {
        expect(linkZeilenAus(mitLinks)).toEqual([
            { text: "Die Karte", url: "https://example.org/karte", bezahlt: "nein" },
            { text: "Band", url: "https://example.org/band", bezahlt: "ja" },
            { text: "Offen", url: "https://example.org/offen", bezahlt: "" },
        ]);
    });

    it("ohne Link steht eine leere Zeile bereit", () => {
        expect(linkZeilenAus(ohneLinks)).toEqual([leereLinkZeile()]);
    });
});

describe("Fundstellen der Kartensammlung: die Prüfung (WI-0287)", () => {
    it("unverändert heißt: nichts zu senden", () => {
        const geprueft = linksAnfrage(mitLinks, linkZeilenAus(mitLinks));
        expect(geprueft).toMatchObject({ anfrage: undefined, unveraendert: true });
        expect(geprueft.befunde.size).toBe(0);
        expect(linksAnfrage(ohneLinks, linkZeilenAus(ohneLinks)).unveraendert).toBe(true);
    });

    it("gesendet wird die Folge der Zeilen, getrimmt; leere Beschriftung wird „Karte“, eine ganz leere Zeile fällt weg", () => {
        const { anfrage, befunde } = linksAnfrage(ohneLinks, [
            { text: "  ", url: " https://example.org/a ", bezahlt: "ja" },
            leereLinkZeile(),
            { text: " Zwei ", url: "http://example.org/b", bezahlt: "" },
            { text: "Drei", url: "https://example.org/c", bezahlt: "nein" },
        ]);
        expect(befunde.size).toBe(0);
        expect(anfrage).toEqual([
            { url: "https://example.org/a", label: "Karte", isPaid: true },
            { url: "http://example.org/b", label: "Zwei", isPaid: null },
            { url: "https://example.org/c", label: "Drei", isPaid: false },
        ]);
    });

    it("alle Zeilen entfernt heißt eine leere Liste, wenn der Eintrag Links hatte", () => {
        const { anfrage, unveraendert } = linksAnfrage(mitLinks, [leereLinkZeile()]);
        expect(anfrage).toEqual([]);
        expect(unveraendert).toBe(false);
    });

    it("eine geänderte Reihenfolge oder ein geändertes „Kostenpflichtig“ ist eine Änderung", () => {
        const zeilen = linkZeilenAus(mitLinks);
        expect(linksAnfrage(mitLinks, [zeilen[1]!, zeilen[0]!, zeilen[2]!]).anfrage).toHaveLength(3);
        expect(linksAnfrage(mitLinks, [{ ...zeilen[0]!, bezahlt: "" }, zeilen[1]!, zeilen[2]!]).anfrage).toHaveLength(
            3,
        );
    });

    it("eine Adresse ohne http oder https ist ein Befund an ihrer Zeile, es geht nichts mit", () => {
        const { anfrage, befunde } = linksAnfrage(ohneLinks, [
            { text: "A", url: "https://example.org/a", bezahlt: "" },
            { text: "B", url: "example.org/b", bezahlt: "" },
            { text: "nur Text", url: "", bezahlt: "" },
            { text: "C", url: "ftp://example.org/c", bezahlt: "" },
        ]);
        expect(anfrage).toBeUndefined();
        expect([...befunde.keys()]).toEqual([1, 2, 3]);
    });

    it("eine doppelte Adresse ist ein Befund an der späteren Zeile", () => {
        const { anfrage, befunde } = linksAnfrage(ohneLinks, [
            { text: "A", url: "https://example.org/a", bezahlt: "" },
            { text: "B", url: " https://example.org/a", bezahlt: "ja" },
        ]);
        expect(anfrage).toBeUndefined();
        expect([...befunde.keys()]).toEqual([1]);
    });
});

describe("Fundstellen der Kartensammlung: nach „Neu laden“ (WI-0287)", () => {
    const alt = linkZeilenAus(mitLinks);
    const neu = linkZeilenAus({ links: [mitLinks.links[0]!] });

    it("Unberührtes folgt dem neuen Stand", () => {
        expect(
            linkZeilenNachladen(
                alt,
                alt.map((zeile) => ({ ...zeile })),
                neu,
            ),
        ).toEqual(neu);
    });

    it("eigene Eingaben bleiben stehen", () => {
        const eigen = [...alt, { text: "Meine", url: "https://example.org/meine", bezahlt: "" }];
        expect(linkZeilenNachladen(alt, eigen, neu)).toEqual(eigen);
    });
});
