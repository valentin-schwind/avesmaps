import { describe, expect, it } from "vitest";
import { alsCidr, ipv4Zahl, regionKennung, verschmelze, zeileLesen } from "../src/besucher/geo-import.ts";

/**
 * Das Nachschlagewerk „Netz → Land“ (WI-0138 V6): die Umrechnung von Bereichen in CIDR-Netze, die Kennung des
 * Bundeslands und das Verschmelzen. Alles rein — hier entscheidet sich, ob später das richtige Land herauskommt.
 */

describe("Bereich in CIDR-Netze", () => {
    it("nimmt den größten Block, der ausgerichtet ist und hineinpasst", () => {
        expect(alsCidr(ipv4Zahl("10.0.0.0")!, ipv4Zahl("10.0.0.255")!)).toEqual(["10.0.0.0/24"]);
        expect(alsCidr(ipv4Zahl("10.0.0.0")!, ipv4Zahl("10.0.1.255")!)).toEqual(["10.0.0.0/23"]);
        expect(alsCidr(ipv4Zahl("10.0.0.5")!, ipv4Zahl("10.0.0.5")!)).toEqual(["10.0.0.5/32"]);
    });

    it("🔴 reicht nie über das Ende hinaus: ein Block zu viel hieße, der Nachbar bekäme unser Land", () => {
        const bloecke = alsCidr(ipv4Zahl("10.0.0.0")!, ipv4Zahl("10.0.0.9")!);
        expect(bloecke).toEqual(["10.0.0.0/29", "10.0.0.8/31"]);
        // Die Summe der Blöcke ist genau der Bereich, keine Adresse mehr und keine weniger.
        const adressen = bloecke.reduce((summe, netz) => summe + 2 ** (32 - Number(netz.split("/")[1])), 0);
        expect(adressen).toBe(10);
    });

    it("beginnt mitten im Block und bleibt ausgerichtet", () => {
        // 🪤 Wer nur „passt es noch rein“ prüft, nimmt hier /30 ab .1 — ein Netz, das es nicht gibt.
        expect(alsCidr(ipv4Zahl("192.168.1.1")!, ipv4Zahl("192.168.1.6")!)).toEqual([
            "192.168.1.1/32",
            "192.168.1.2/31",
            "192.168.1.4/31",
            "192.168.1.6/32",
        ]);
    });

    it("🔴 rechnet ab 128.0.0.0 richtig (Bitoperatoren kippten dort ins Negative: 128.0.0.0/NaN)", () => {
        const start = 128 * 2 ** 24;
        expect(alsCidr(start, start + 2 ** 24 - 1)).toEqual(["128.0.0.0/8"]);
        expect(alsCidr(start, start + 255)).toEqual(["128.0.0.0/24"]);
        expect(alsCidr(0xc0_a8_00_00, 0xc0_a8_ff_ff)).toEqual(["192.168.0.0/16"]);
        for (const netz of alsCidr(start + 5, start + 2 ** 20)) expect(netz).not.toMatch(/NaN/);
    });

    it("kommt bis an das obere Ende, ohne überzulaufen", () => {
        expect(alsCidr(ipv4Zahl("255.255.255.254")!, ipv4Zahl("255.255.255.255")!)).toEqual(["255.255.255.254/31"]);
    });
});

describe("Die Kennung des Bundeslands", () => {
    it("kennt beide Schreibweisen des Datensatzes", () => {
        expect(regionKennung("DE", "North Rhine-Westphalia")).toBe("NW");
        expect(regionKennung("DE", "Nordrhein-Westfalen")).toBe("NW");
        expect(regionKennung("DE", "Bavaria")).toBe("BY");
        expect(regionKennung("DE", "Thüringen")).toBe("TH");
        expect(regionKennung("DE", "DE-HH")).toBe("HH");
    });

    it("🔴 füllt sie nur für Deutschland und nie mit Freitext", () => {
        expect(regionKennung("AT", "Tirol")).toBe("");
        expect(regionKennung("DE", "Irgendwas")).toBe("");
        expect(regionKennung("DE", "")).toBe("");
    });
});

describe("Zeilen lesen und verschmelzen", () => {
    it("überspringt IPv6, Kopfzeile und Kaputtes", () => {
        expect(zeileLesen("ip_start,ip_end,continent,country,stateprov,city,lat,lon")).toBeUndefined();
        expect(zeileLesen("2001:db8::,2001:db8::ffff,EU,DE,Berlin,Berlin,0,0")).toBeUndefined();
        expect(zeileLesen("10.0.0.5,10.0.0.1,EU,DE,Berlin,Berlin,0,0")).toBeUndefined();
        expect(zeileLesen("10.0.0.1,10.0.0.5,EU,Deutschland,Berlin,Berlin,0,0")).toBeUndefined();
    });

    it("liest Land und Kennung", () => {
        expect(zeileLesen("1.2.3.0,1.2.3.255,EU,DE,Bavaria,München,0,0")).toEqual({
            start: ipv4Zahl("1.2.3.0"),
            ende: ipv4Zahl("1.2.3.255"),
            land: "DE",
            region: "BY",
        });
    });

    it("🔴 macht aus den Stadtbereichen eines Landes eine Zeile", () => {
        const zeilen = [
            { start: 0, ende: 99, land: "FR", region: "" },
            { start: 100, ende: 199, land: "FR", region: "" },
            { start: 200, ende: 299, land: "DE", region: "BY" },
            { start: 300, ende: 399, land: "DE", region: "BY" },
            { start: 400, ende: 499, land: "DE", region: "NW" },
        ];
        expect(verschmelze(zeilen)).toEqual([
            { start: 0, ende: 199, land: "FR", region: "" },
            { start: 200, ende: 399, land: "DE", region: "BY" },
            { start: 400, ende: 499, land: "DE", region: "NW" },
        ]);
    });

    it("lässt eine Lücke eine Lücke sein", () => {
        const zeilen = [
            { start: 0, ende: 99, land: "DE", region: "" },
            { start: 200, ende: 299, land: "DE", region: "" },
        ];
        expect(verschmelze(zeilen)).toHaveLength(2);
    });
});
