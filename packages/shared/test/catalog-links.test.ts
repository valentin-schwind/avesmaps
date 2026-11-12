import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    CatalogLink,
    CitymapEntry,
    LiteratureEntry,
    catalogLinkMeta,
    catalogLinks,
    dnbSearchUrl,
} from "../src/index.ts";

/**
 * Die Links der Katalogfenster (WI-0118): Beschriftung aus dem Host, Kostenpflicht dreiwertig, Legacys Klickreihenfolge.
 * Die Fälle sind die des Bestands (gemessen an `avesmaps3d_dev`: 502 von 565 Fundstellen heißen „Karte“).
 */

const KEY = "80000000-0000-4000-8000-000000000001";

describe("Beschriftung und Kostenpflicht aus dem Host (Legacy `advLinkMeta`)", () => {
    it("🔴 die vier Hosts, die Legacy kennt, heißen wie in Legacy - gleich, was der Titel im Bestand sagt", () => {
        expect(catalogLinkMeta("https://de.wiki-aventurica.de/wiki/Gareth", { label: "Karte" })).toMatchObject({
            label: "Wiki Aventurica",
            rank: 3,
        });
        expect(catalogLinkMeta("https://www.ulisses-ebooks.de/product/1", { label: "PDF-Shop" })).toMatchObject({
            label: "Ulisses eBook",
            rank: 1,
        });
        expect(catalogLinkMeta("https://www.f-shop.de/x", { label: "Karte" })).toMatchObject({
            label: "F-Shop",
            rank: 2,
        });
        expect(catalogLinkMeta("https://portal.dnb.de/opac/simpleSearch?query=x")).toMatchObject({
            label: "Dt. Nationalbibliothek",
            rank: 4,
        });
    });

    it("🔴 Ulisses eBook und F-Shop sind IMMER kostenpflichtig, auch wo der Bestand nichts oder `false` führt", () => {
        expect(catalogLinkMeta("https://www.f-shop.de/x", { paid: null }).paid).toBe(true);
        expect(catalogLinkMeta("https://www.ulisses-ebooks.de/x", { paid: false }).paid).toBe(true);
    });

    it("🪤 Kostenpflicht ist dreiwertig: unbekannt bleibt unbekannt, nie „frei“", () => {
        expect(catalogLinkMeta("https://de.wiki-aventurica.de/wiki/A", { paid: null })).not.toHaveProperty("paid");
        expect(catalogLinkMeta("https://de.wiki-aventurica.de/wiki/A", { paid: false }).paid).toBe(false);
        expect(catalogLinkMeta("https://example.org/a", { paid: true }).paid).toBe(true);
        expect(catalogLinkMeta("https://example.org/a")).not.toHaveProperty("paid");
    });

    it("andere Hosts bekommen ihren Namen, wo der Bestand nur „Karte“ führt (deviantArt, ArtStation …)", () => {
        expect(catalogLinkMeta("https://www.deviantart.com/x/art/y", { label: "Karte" }).label).toBe("deviantArt");
        expect(catalogLinkMeta("https://www.artstation.com/artwork/z", { label: "Karte" }).label).toBe("ArtStation");
        expect(catalogLinkMeta("https://www.reddit.com/r/dsa", { label: "Karte" }).label).toBe("Reddit");
    });

    it("ein sprechender Titel des Bestands gewinnt vor dem Namen des Hosts", () => {
        expect(catalogLinkMeta("https://ulisses-spiele.de/dl", { label: "Ulisses Spiele Downloads" }).label).toBe(
            "Ulisses Spiele Downloads",
        );
        // Dasselbe ohne Titel: der Name des Hosts.
        expect(catalogLinkMeta("https://ulisses-spiele.de/dl", { label: "Karte" }).label).toBe("Ulisses Spiele");
    });

    it("ein unbekannter Host ohne Titel heißt wie er selbst - ohne `www.`, nie „Karte“", () => {
        expect(catalogLinkMeta("https://www.beispiel.example/a", { label: "Karte" }).label).toBe("beispiel.example");
        expect(catalogLinkMeta("https://kristinheldrung.de/x").label).toBe("kristinheldrung.de");
        expect(catalogLinkMeta("https://wiki.punin.de/x", { label: "  " }).label).toBe("wiki.punin.de");
    });

    it("ein Host, der nur so heißt, ist nicht der Host: `evil-f-shop.de` ist kein F-Shop", () => {
        expect(catalogLinkMeta("https://evil-f-shop.de/x", { label: "Karte" }).label).toBe("evil-f-shop.de");
        expect(catalogLinkMeta("https://f-shop.de.evil.example/x", { label: "Karte" }).label).toBe(
            "f-shop.de.evil.example",
        );
    });
});

describe("Die Liste eines Eintrags", () => {
    it("🔴 Legacys Klickreihenfolge: Ulisses eBook, F-Shop, Wiki Aventurica, Nationalbibliothek, dann der Rest in Bestandsordnung", () => {
        const links = catalogLinks([
            { url: "https://www.deviantart.com/a", label: "Karte" },
            { url: "https://portal.dnb.de/opac/simpleSearch?query=x" },
            { url: "https://de.wiki-aventurica.de/wiki/X", label: "Karte", paid: null },
            { url: "https://www.f-shop.de/x" },
            { url: "https://www.ulisses-ebooks.de/x" },
            { url: "https://www.artstation.com/b", label: "Karte" },
        ]);
        expect(links.map((link) => link.label)).toEqual([
            "Ulisses eBook",
            "F-Shop",
            "Wiki Aventurica",
            "Dt. Nationalbibliothek",
            "deviantArt",
            "ArtStation",
        ]);
    });

    it("jede Adresse einmal (die erste gewinnt), und nur http(s)", () => {
        const links = catalogLinks([
            { url: "https://example.org/a", label: "Erste" },
            { url: "https://example.org/a", label: "Zweite" },
            { url: "javascript:alert(1)", label: "Böse" },
            { url: "ftp://example.org/x", label: "FTP" },
            { url: "//example.org/y", label: "Ohne Schema" },
            { url: "  HTTP://example.org/z  ", label: "Groß" },
        ]);
        expect(links).toEqual([
            { label: "Erste", url: "https://example.org/a" },
            { label: "Groß", url: "HTTP://example.org/z" },
        ]);
    });

    it("jeder Link ist ein gültiger Vertragsteil - `paid` fehlt, wo es unbekannt ist", () => {
        for (const link of catalogLinks([
            { url: "https://example.org/a", label: "A", paid: null },
            { url: "https://example.org/b", label: "B", paid: true },
        ])) {
            expect(Value.Check(CatalogLink, link)).toBe(true);
        }
    });
});

describe("Die Titelsuche der Nationalbibliothek (Legacy `avesmapsGameLiteratureLinks`)", () => {
    it("maskiert wie PHPs `rawurlencode`: auch `!'()*`", () => {
        expect(dnbSearchUrl("Das Dunkle Auge (Basis)")).toBe(
            "https://portal.dnb.de/opac/simpleSearch?query=Das%20Dunkle%20Auge%20%28Basis%29",
        );
        expect(dnbSearchUrl("Mord! 'Ha' *")).toBe(
            "https://portal.dnb.de/opac/simpleSearch?query=Mord%21%20%27Ha%27%20%2A",
        );
        expect(dnbSearchUrl("Rhôndur & Söhne")).toBe(
            "https://portal.dnb.de/opac/simpleSearch?query=Rh%C3%B4ndur%20%26%20S%C3%B6hne",
        );
    });
});

describe("Die erweiterten Einträge sind additiv (WI-0118)", () => {
    it("🔴 ein Eintrag im alten Umfang bleibt gültig, sobald er seine Kennung trägt", () => {
        expect(Value.Check(CitymapEntry, { id: KEY, title: "Alt" })).toBe(true);
        expect(
            Value.Check(LiteratureEntry, { id: KEY, title: "Alt", productType: "gruppenabenteuer", role: "start" }),
        ).toBe(true);
    });

    it("ein Eintrag ohne Kennung ist keiner mehr: das Fenster merkt sich den aufgeklappten Eintrag darüber", () => {
        expect(Value.Check(CitymapEntry, { title: "Ohne" })).toBe(false);
        expect(Value.Check(LiteratureEntry, { title: "Ohne", productType: "x", role: "start" })).toBe(false);
    });

    it("alle neuen Felder zusammen sind gültig, und ein fremdes Feld bleibt draußen", () => {
        const karte = {
            id: KEY,
            title: "Gareth-Karte aus der Gareth-Box",
            band: "Gareth-Box",
            types: ["stadtplan"],
            art: "derographisch",
            colorMode: "farbig",
            official: true,
            labeled: false,
            multilevel: false,
            hasScale: true,
            validFrom: 1027,
            validTo: 9999,
            format: "A2",
            author: "Elwe von Gareth",
            publisher: "Ulisses",
            widthPx: 4635,
            heightPx: 3278,
            note: "Maßstab: 1:5.000",
            links: [{ label: "Wiki Aventurica", url: "https://de.wiki-aventurica.de/wiki/Gareth-Box", paid: false }],
        };
        expect(Value.Check(CitymapEntry, karte)).toBe(true);
        expect(Value.Check(CitymapEntry, { ...karte, linkStatus: "online" })).toBe(false);
        const werk = {
            id: KEY,
            title: "Der Werkstitel",
            productType: "gruppenabenteuer",
            role: "start",
            genres: ["Stadtabenteuer", "Kriegsszenario"],
            complexity: "mittel",
            bfYear: 1044,
            official: true,
            links: [{ label: "Dt. Nationalbibliothek", url: dnbSearchUrl("Der Werkstitel"), paid: false }],
        };
        expect(Value.Check(LiteratureEntry, werk)).toBe(true);
        expect(Value.Check(LiteratureEntry, { ...werk, linkStatus: "dead" })).toBe(false);
    });

    it("🔴 `links` ist nie eine leere Liste: ein Eintrag ohne Link lässt das Feld weg", () => {
        expect(Value.Check(CitymapEntry, { id: KEY, title: "A", links: [] })).toBe(false);
    });
});
