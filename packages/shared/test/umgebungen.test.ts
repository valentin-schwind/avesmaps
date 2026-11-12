import { describe, expect, it } from "vitest";
import {
    LOKAL_NAME_MUSTER,
    PRIVATE_KARTENEINSTELLUNGEN,
    karteneinstellungImRahmen,
    lokalAdresse,
    privateKarteneinstellung,
    privateKarteneinstellungenWirksam,
    releaseStand,
} from "../src/index.ts";

/** Der Stand einer Umgebung aus ihrem `RELEASE_ID` (WI-0180 §9; Form aus `ops/corridor`, gemessen von Claudio 2026-10-16). */
describe("releaseStand", () => {
    it("zerlegt einen echten RELEASE_ID in Zeitpunkt (UTC) und kurzen Commit", () => {
        expect(releaseStand("20261016T143003Z-6e6dee0")).toEqual({
            zeit: new Date("2026-10-16T14:30:03Z"),
            commit: "6e6dee0",
        });
        expect(releaseStand("20261016T152003Z-1722fd3a9b")?.commit).toBe("1722fd3");
    });

    it("🔴 gibt null für lokal, Leeres und alles Fremde, statt einen Stand zu erfinden", () => {
        for (const wert of [
            "dev",
            "",
            null,
            undefined,
            "20261016-6e6dee0",
            "20261316T143003Z-6e6dee0",
            "20261031T250000Z-abc1234",
        ])
            expect(releaseStand(wert), String(wert)).toBeNull();
        // Kein HTML, keine Zeilen: Was die Gegenseite schickt, geht nur in dieser Form weiter.
        expect(releaseStand("20261016T143003Z-6e6dee0<script>")).toBeNull();
    });
});

/** Die Adresse von Lokal (WI-0180 §8, §11): Name und Port getrennt gespeichert, eine Regel für Menü, Probe und Anzeige. */
describe("Lokal: Adresse und private Einstellungen", () => {
    it("baut https://<name>, den Port nur, wenn er nicht 443 ist; ohne Namen keine Adresse", () => {
        expect(lokalAdresse("rechner.tailnet.ts.net", 443)).toBe("https://rechner.tailnet.ts.net");
        expect(lokalAdresse("rechner.tailnet.ts.net", 8443)).toBe("https://rechner.tailnet.ts.net:8443");
        expect(lokalAdresse("", 443)).toBeNull();
    });

    it("🔴 der Name ist ein Tailscale-Name, nichts sonst; leer heißt: kein Lokal", () => {
        const name = privateKarteneinstellung("lokalName")!;
        for (const gut of ["", "kombicompy.taila8726f.ts.net", "a-b.c-d.ts.net"])
            expect(karteneinstellungImRahmen(name, gut), gut).toBe(true);
        for (const schlecht of [
            "https://x.ts.net",
            "x.ts.net:443",
            "rechner.example.org",
            "X.TS.NET",
            "-a.ts.net",
            "a..ts.net",
            7,
        ])
            expect(karteneinstellungImRahmen(name, schlecht), String(schlecht)).toBe(false);
        expect(new RegExp(LOKAL_NAME_MUSTER).test("ts.net")).toBe(false);
    });

    it("die Vorgaben: kein Name, Port 443, Lokal nur wenn erreichbar; fremde Werte fallen auf die Vorgabe", () => {
        expect(PRIVATE_KARTENEINSTELLUNGEN.map((e) => e.id)).toEqual(["lokalName", "lokalPort", "lokalImMenue"]);
        expect(privateKarteneinstellungenWirksam({})).toEqual({
            lokalName: "",
            lokalPort: 443,
            lokalImMenue: "erreichbar",
        });
        expect(
            privateKarteneinstellungenWirksam({ lokalPort: 70000, lokalImMenue: "nie", lokalName: "x.ts.net" }),
        ).toEqual({
            lokalName: "x.ts.net",
            lokalPort: 443,
            lokalImMenue: "erreichbar",
        });
    });
});
