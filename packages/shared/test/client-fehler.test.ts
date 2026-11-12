import { describe, expect, it } from "vitest";
import {
    bereinigeDiagnose,
    bereinigeMeldung,
    bereinigeName,
    CLIENT_FEHLER_GRENZEN,
    diagnoseAus,
    eigeneStellen,
    seitenSignatur,
    stelleGueltig,
} from "../src/index.ts";

/**
 * Die Bereinigung der Diagnosen (WI-0202 §3.2). Die Fälle sind die Zusagen der Datenschutzzeile: keine Adresse, kein Parameter,
 * keine Zahlenfolge, keine Eingabe, nur Stellen im eigenen Bündel.
 */
const URSPRUNG = "https://stage.avesmaps.de";

describe("bereinigeMeldung", () => {
    it("nimmt Adressen samt Abfrage heraus", () => {
        expect(
            bereinigeMeldung(
                "AJAXError: Service Unavailable (503): https://stage.avesmaps.de/tiles/places/8/12/34?rev=abc",
            ),
        ).toBe("AJAXError: Service Unavailable (503): <adresse>");
        expect(bereinigeMeldung("GET /api/subjects/place/gareth?tab=lore antwortete 503")).toBe(
            "GET <adresse> antwortete 503",
        );
        expect(bereinigeMeldung("Failed to load blob:https://x.de/1234-abcd")).toBe("Failed to load <adresse>");
        expect(bereinigeMeldung("Schreib an jemand@example.org")).toBe("Schreib an <adresse>");
        expect(bereinigeMeldung("Datei C:\\Users\\thomas\\karte.png fehlt")).toBe("Datei <adresse> fehlt");
    });

    it("macht aus Zahlenfolgen #, lässt aber einen HTTP-Status stehen", () => {
        expect(bereinigeMeldung("Kamera bei 12.5, -48.25 und Zoom 7")).toBe("Kamera bei #, -# und Zoom #");
        expect(bereinigeMeldung("Antwort 404 nach 1234 ms")).toBe("Antwort 404 nach # ms");
        expect(bereinigeMeldung("WebGL2 wird gebraucht")).toBe("WebGL2 wird gebraucht");
        expect(bereinigeMeldung("Wert x12345 ungültig")).toBe("Wert x# ungültig");
    });

    it("ersetzt Kennungen", () => {
        expect(bereinigeMeldung("Ort 3f2c9a1e-7b4d-4c2a-9e1f-0a1b2c3d4e5f fehlt")).toBe("Ort <kennung> fehlt");
        expect(bereinigeMeldung("Sitzung a1b2c3d4e5f6 abgelaufen")).toBe("Sitzung <kennung> abgelaufen");
    });

    it("entfernt Text in Anführungszeichen, lässt Bezeichner lesbar", () => {
        expect(bereinigeMeldung("Cannot read properties of undefined (reading 'getZoom')")).toBe(
            "Cannot read properties of undefined (reading 'getZoom')",
        );
        expect(bereinigeMeldung('Suche "Gareth Stadt am See" fehlgeschlagen')).toBe('Suche "<text>" fehlgeschlagen');
        expect(bereinigeMeldung("Name „Rondra Tempel“ ungültig")).toBe("Name „<text>“ ungültig");
        expect(bereinigeMeldung("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")).toBe(
            "Unexpected token '<text>', \"<text>\"... is not valid JSON",
        );
        expect(bereinigeMeldung("can't find 'x'")).toBe("can't find 'x'");
        expect(bereinigeMeldung('leer ""')).toBe('leer ""');
    });

    it("kürzt auf die Grenze und zieht Leerraum zusammen", () => {
        const lang = bereinigeMeldung(`Fehler   ${"a".repeat(400)}\n\nweiter`);
        expect(Array.from(lang)).toHaveLength(CLIENT_FEHLER_GRENZEN.meldung);
        expect(lang.endsWith("…")).toBe(true);
        expect(bereinigeMeldung(" a \n\t b ")).toBe("a b");
    });

    it("macht aus Nicht-Text eine leere Meldung", () => {
        expect(bereinigeMeldung(undefined)).toBe("");
        expect(bereinigeMeldung({ toString: () => "geheim" })).toBe("");
    });
});

describe("bereinigeName", () => {
    it("lässt Bezeichner stehen und ersetzt alles andere", () => {
        expect(bereinigeName("TypeError")).toBe("TypeError");
        expect(bereinigeName("Fehler mit Leerzeichen")).toBe("Error");
        expect(bereinigeName(undefined, false)).toBe("NonError");
        expect(bereinigeName("x".repeat(41))).toBe("Error");
    });
});

describe("eigeneStellen", () => {
    const chrome = [
        "TypeError: Cannot read properties of undefined (reading 'getZoom')",
        "    at Xe (https://stage.avesmaps.de/assets/index-AbCd1234.js:1:23456)",
        "    at https://stage.avesmaps.de/assets/index-AbCd1234.js:1:99",
        "    at chrome-extension://abcdef/inject.js:3:4",
        "    at https://cdn.example.org/lib.js:1:1",
        "    at Ye (https://stage.avesmaps.de/assets/index-AbCd1234.js:1:23456)",
    ].join("\n");

    it("nimmt nur Stellen der eigenen Seite, ohne Ursprung, doppelte einmal", () => {
        expect(eigeneStellen(chrome, URSPRUNG)).toEqual([
            "assets/index-AbCd1234.js:1:23456",
            "assets/index-AbCd1234.js:1:99",
        ]);
    });

    it("liest die Form von Firefox und Safari und die der Entwicklung", () => {
        const firefox =
            "Xe@https://stage.avesmaps.de/assets/maplibre-Zz99.js:2:15\n@https://stage.avesmaps.de/assets/index-A1.js:1:7";
        expect(eigeneStellen(firefox, URSPRUNG)).toEqual(["assets/maplibre-Zz99.js:2:15", "assets/index-A1.js:1:7"]);
        const vite = "    at setup (http://localhost:5173/src/app.vue?t=1712:45:6)";
        expect(eigeneStellen(vite, "http://localhost:5173")).toEqual(["src/app.vue:45:6"]);
    });

    it("verwirft Vites Abhängigkeiten, Arbeiter und fremde Ursprünge", () => {
        expect(
            eigeneStellen(
                "at x (http://localhost:5173/node_modules/.vite/deps/maplibre-gl.js?v=1:1:2)",
                "http://localhost:5173",
            ),
        ).toEqual([]);
        expect(eigeneStellen("at blob:https://stage.avesmaps.de/1234:1:2", URSPRUNG)).toEqual([]);
        expect(eigeneStellen("at https://avesmaps.de/assets/index-A.js:1:2", URSPRUNG)).toEqual([]);
    });

    it("hält die Grenze der Stellen", () => {
        const viele = Array.from({ length: 12 }, (_, i) => `at f (${URSPRUNG}/assets/index-A.js:1:${i + 1})`).join(
            "\n",
        );
        expect(eigeneStellen(viele, URSPRUNG)).toHaveLength(CLIENT_FEHLER_GRENZEN.stellen);
    });
});

describe("stelleGueltig", () => {
    it("lässt nur Bündelstellen zu", () => {
        expect(stelleGueltig("assets/index-AbCd1234.js:1:23456")).toBe(true);
        expect(stelleGueltig("src/map/camera/camera.ts:12:3")).toBe(true);
        expect(stelleGueltig("assets/../../etc/passwd.js:1:1")).toBe(false);
        expect(stelleGueltig("https://x.de/assets/a.js:1:1")).toBe(false);
        expect(stelleGueltig("assets/a.js:1")).toBe(false);
        expect(stelleGueltig("assets/Gareth Stadt.js:1:1")).toBe(false);
    });
});

describe("diagnoseAus", () => {
    it("baut aus einem Fehler genau die erlaubten Felder", () => {
        const fehler = new TypeError("Cannot read properties of undefined (reading 'x') bei 12.5");
        fehler.stack = `TypeError: …\n    at f (${URSPRUNG}/assets/index-A.js:1:2)`;
        const diagnose = diagnoseAus("vue", fehler, { ursprung: URSPRUNG, grafik: "webgl2" });
        expect(diagnose).toEqual({
            art: "vue",
            name: "TypeError",
            meldung: "Cannot read properties of undefined (reading 'x') bei #",
            stellen: ["assets/index-A.js:1:2"],
            grafik: "webgl2",
        });
        expect(Object.keys(diagnose).sort()).toEqual(["art", "grafik", "meldung", "name", "stellen"]);
    });

    it("nennt einen geworfenen Nicht-Fehler NonError und verrät kein Objekt", () => {
        expect(diagnoseAus("unbehandelt", { passwort: "x" }, { ursprung: URSPRUNG })).toEqual({
            art: "unbehandelt",
            name: "NonError",
            meldung: "object",
            stellen: [],
        });
        expect(diagnoseAus("unbehandelt", "kaputt bei 4711", { ursprung: URSPRUNG }).meldung).toBe("kaputt bei #");
    });
});

describe("bereinigeDiagnose (Server)", () => {
    it("bereinigt noch einmal und lässt Ungültiges fallen", () => {
        expect(
            bereinigeDiagnose({
                art: "karte",
                name: "AJAXError",
                meldung: "Laden von https://x.de/a?b=1 bei 47.1 scheiterte",
                stellen: ["assets/index-A.js:1:2", "https://x.de/a.js:1:1", "src/x.ts:9:9"],
                grafik: "webgl1",
            }),
        ).toEqual({
            art: "karte",
            name: "AJAXError",
            meldung: "Laden von <adresse> bei # scheiterte",
            stellen: ["assets/index-A.js:1:2", "src/x.ts:9:9"],
            grafik: "webgl1",
        });
    });

    it("verwirft eine unbekannte Art und eine unbekannte Grafikklasse", () => {
        expect(bereinigeDiagnose({ art: "boese", name: "Error", meldung: "", stellen: [] })).toBeUndefined();
        expect(
            bereinigeDiagnose({ art: "vue", name: "Error", meldung: "", stellen: [], grafik: "NVIDIA RTX 4090" }),
        ).toEqual({ art: "vue", name: "Error", meldung: "", stellen: [] });
    });
});

describe("seitenSignatur", () => {
    it("erkennt denselben Fehler an Art, Name, Meldung und oberster Stelle", () => {
        const a = { art: "vue" as const, name: "TypeError", meldung: "m", stellen: ["src/a.ts:1:1", "src/b.ts:2:2"] };
        expect(seitenSignatur(a)).toBe(seitenSignatur({ ...a, stellen: ["src/a.ts:1:1"] }));
        expect(seitenSignatur(a)).not.toBe(seitenSignatur({ ...a, art: "karte" }));
    });
});
