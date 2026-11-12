import { describe, expect, it } from "vitest";
import { einzelnLaden } from "../src/editor/einzeln-laden.ts";

/** Ein Versprechen, das der Test von außen erfüllt. */
function offen<T>(): { versprechen: Promise<T>; erfuelle: (wert: T) => void; verwirf: (fehler: Error) => void } {
    let erfuelle!: (wert: T) => void;
    let verwirf!: (fehler: Error) => void;
    const versprechen = new Promise<T>((ja, nein) => {
        erfuelle = ja;
        verwirf = nein;
    });
    return { versprechen, erfuelle, verwirf };
}

describe("einzelnLaden (WI-0298 Stufe 5)", () => {
    it("gleiche Anfragen teilen sich eine Abfrage", async () => {
        const einzeln = einzelnLaden<string>();
        const abfrage = offen<string>();
        let aufrufe = 0;
        const laden = (): Promise<string> => {
            aufrufe += 1;
            return abfrage.versprechen;
        };
        const erste = einzeln("meer|topographie", laden);
        const zweite = einzeln("meer|topographie", laden);
        expect(zweite).toBe(erste);
        await Promise.resolve();
        abfrage.erfuelle("{}");
        await expect(Promise.all([erste, zweite])).resolves.toEqual(["{}", "{}"]);
        expect(aufrufe).toBe(1);
        // Danach fragt eine gleiche Anfrage neu.
        await einzeln("meer|topographie", () => Promise.resolve("neu"));
        await expect(einzeln("meer|topographie", () => Promise.resolve("frisch"))).resolves.toBe("frisch");
    });

    it("verschiedene Anfragen laufen nacheinander, nie zwei zugleich", async () => {
        const einzeln = einzelnLaden<string>();
        const a = offen<string>();
        let gestartet: string[] = [];
        const erste = einzeln("a", () => {
            gestartet = [...gestartet, "a"];
            return a.versprechen;
        });
        const zweite = einzeln("b", () => {
            gestartet = [...gestartet, "b"];
            return Promise.resolve("b");
        });
        await new Promise((fertig) => setTimeout(fertig, 5));
        expect(gestartet).toEqual(["a"]);
        a.erfuelle("a");
        await expect(Promise.all([erste, zweite])).resolves.toEqual(["a", "b"]);
        expect(gestartet).toEqual(["a", "b"]);
    });

    it("ein Fehler trifft nur seine Anfrage, die nächste läuft", async () => {
        const einzeln = einzelnLaden<string>();
        const a = offen<string>();
        const erste = einzeln("a", () => a.versprechen);
        const zweite = einzeln("b", () => Promise.resolve("b"));
        a.verwirf(new Error("kaputt"));
        await expect(erste).rejects.toThrow("kaputt");
        await expect(zweite).resolves.toBe("b");
        await expect(einzeln("a", () => Promise.resolve("wieder"))).resolves.toBe("wieder");
    });
});
