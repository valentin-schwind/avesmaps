import { describe, expect, it } from "vitest";
import { ApiFailure } from "../src/auth/api.ts";
import { createGemocht, GEMOCHT_MAX, GEMOCHT_SCHLUESSEL } from "../src/info-panel/bewertungen-gemocht.ts";
import {
    REISEBILD_GEMOCHT_SCHLUESSEL,
    createReisebildGefaellt,
    reisebildGefaelltSatz,
    sendeReisebildGefaellt,
} from "../src/photobox/reisebild-gefaellt.ts";

/**
 * „Gefällt mir“ an Reisebildern im Browser (WI-0304): das Merken je Browser unter eigenem Schlüssel, das Modell (sofort sichtbar, gesperrt während des Zählens, Rückfall mit Satz) und der Aufruf.
 *
 * Problemfälle: der Schlüssel der Bewertungen wird überschrieben oder mit dem der Reisebilder vermischt; ein zweiter Klick zählt statt zurückzunehmen; zwei Klicks gleichzeitig überholen sich;
 * ein gescheiterter Aufruf lässt Herz und Zahl falsch stehen; die Zahl sinkt unter 0.
 */

function speicher(): {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    daten: Map<string, string>;
} {
    const daten = new Map<string, string>();
    return {
        daten,
        getItem: (k) => daten.get(k) ?? null,
        setItem: (k, v) => void daten.set(k, v),
    };
}

describe("Merken je Browser mit Schlüssel", () => {
    it("🔴 der Standard bleibt der Schlüssel der Bewertungen; ein eigener Schlüssel berührt ihn nicht", () => {
        const s = speicher();
        createGemocht(s).umschalten("bewertung");
        createGemocht(s, REISEBILD_GEMOCHT_SCHLUESSEL).umschalten("bild");
        expect(JSON.parse(s.daten.get(GEMOCHT_SCHLUESSEL) ?? "[]")).toEqual(["bewertung"]);
        expect(JSON.parse(s.daten.get(REISEBILD_GEMOCHT_SCHLUESSEL) ?? "[]")).toEqual(["bild"]);
        expect(createGemocht(s).hat("bild")).toBe(false);
        expect(createGemocht(s, REISEBILD_GEMOCHT_SCHLUESSEL).hat("bewertung")).toBe(false);
        expect(createGemocht(s, REISEBILD_GEMOCHT_SCHLUESSEL).hat("bild")).toBe(true);
    });

    it("höchstens 500 Kennungen, die ältesten fallen heraus", () => {
        const s = speicher();
        const g = createGemocht(s, REISEBILD_GEMOCHT_SCHLUESSEL);
        for (let n = 0; n < GEMOCHT_MAX + 3; n++) g.umschalten(`id-${String(n)}`);
        const gespeichert = JSON.parse(s.daten.get(REISEBILD_GEMOCHT_SCHLUESSEL) ?? "[]") as string[];
        expect(gespeichert).toHaveLength(GEMOCHT_MAX);
        expect(gespeichert[0]).toBe("id-3");
    });

    it("ohne Speicher gilt es für die Sitzung der Seite", () => {
        const kaputt = {
            getItem: () => {
                throw new Error("gesperrt");
            },
            setItem: () => {
                throw new Error("gesperrt");
            },
        };
        const g = createGemocht(kaputt, REISEBILD_GEMOCHT_SCHLUESSEL);
        expect(g.umschalten("bild")).toBe(true);
        expect(g.hat("bild")).toBe(true);
        expect(g.umschalten("bild")).toBe(false);
    });
});

const bild = (extra: { gefaellt?: number } = {}) => ({ id: "00000000-0000-4000-8000-000000000001", ...extra });

function modell(senden: (id: string, delta: 1 | -1) => Promise<{ gefaellt: number }>) {
    return createReisebildGefaellt({
        gemocht: createGemocht(speicher(), REISEBILD_GEMOCHT_SCHLUESSEL),
        senden,
        satz: (fehler) => (fehler instanceof Error ? fehler.message : "?"),
    });
}

describe("Modell von „Gefällt mir“", () => {
    it("die Zahl kommt aus der Antwort der Karte; fehlt sie, ist sie 0", () => {
        const m = modell(() => Promise.resolve({ gefaellt: 0 }));
        expect(m.zahl(bild())).toBe(0);
        expect(m.zahl(bild({ gefaellt: 7 }))).toBe(7);
    });

    it("setzen und mit dem zweiten Klick zurücknehmen; die Zahl des Servers gilt", async () => {
        const aufrufe: [string, 1 | -1][] = [];
        let server = 4;
        const m = modell((id, delta) => {
            aufrufe.push([id, delta]);
            server += delta;
            return Promise.resolve({ gefaellt: server });
        });
        await m.umschalten(bild({ gefaellt: 4 }));
        expect(m.gemocht.hat(bild().id)).toBe(true);
        expect(m.zahl(bild({ gefaellt: 4 }))).toBe(5);
        await m.umschalten(bild({ gefaellt: 4 }));
        expect(m.gemocht.hat(bild().id)).toBe(false);
        expect(m.zahl(bild({ gefaellt: 4 }))).toBe(4);
        expect(aufrufe.map(([, d]) => d)).toEqual([1, -1]);
    });

    it("🔴 sofort sichtbar und gesperrt, solange der Aufruf zählt; ein zweiter Klick währenddessen tut nichts", async () => {
        let fertig!: (wert: { gefaellt: number }) => void;
        let aufrufe = 0;
        const m = modell(() => {
            aufrufe += 1;
            return new Promise((weiter) => {
                fertig = weiter;
            });
        });
        const erster = m.umschalten(bild());
        expect(m.zaehlt(bild().id)).toBe(true);
        expect(m.gemocht.hat(bild().id)).toBe(true);
        expect(m.zahl(bild())).toBe(1);
        await m.umschalten(bild());
        expect(aufrufe).toBe(1);
        expect(m.gemocht.hat(bild().id)).toBe(true);
        fertig({ gefaellt: 3 });
        await erster;
        expect(m.zaehlt(bild().id)).toBe(false);
        expect(m.zahl(bild())).toBe(3);
    });

    it("🔴 scheitert der Aufruf, fallen Herz und Zahl zurück, und ein Satz sagt, warum", async () => {
        const m = modell(() => Promise.reject(new Error("Später noch einmal.")));
        await m.umschalten(bild({ gefaellt: 2 }));
        expect(m.gemocht.hat(bild().id)).toBe(false);
        expect(m.zahl(bild({ gefaellt: 2 }))).toBe(2);
        expect(m.zaehlt(bild().id)).toBe(false);
        expect(m.problem(bild().id)).toBe("Später noch einmal.");
    });

    it("der nächste Klick räumt den Satz weg", async () => {
        let n = 0;
        const m = modell(() => {
            n += 1;
            return n === 1 ? Promise.reject(new Error("weg")) : Promise.resolve({ gefaellt: 1 });
        });
        await m.umschalten(bild());
        expect(m.problem(bild().id)).toBe("weg");
        await m.umschalten(bild());
        expect(m.problem(bild().id)).toBeUndefined();
    });

    it("🔴 die Zahl sinkt nie unter 0, auch wenn die Karte ein veraltetes 0 trägt", async () => {
        // Ein anderer Browser hat zurückgenommen, dieser Browser erinnert sich an sein Herz: Zurücknehmen zeigt 0, nicht -1.
        const s = speicher();
        s.setItem(REISEBILD_GEMOCHT_SCHLUESSEL, JSON.stringify([bild().id]));
        const m = createReisebildGefaellt({
            gemocht: createGemocht(s, REISEBILD_GEMOCHT_SCHLUESSEL),
            senden: () => Promise.resolve({ gefaellt: 0 }),
        });
        await m.umschalten(bild());
        expect(m.gemocht.hat(bild().id)).toBe(false);
        expect(m.zahl(bild())).toBe(0);
    });

    it("jedes Bild für sich: ein Aufruf sperrt nur sein Bild", async () => {
        let fertig!: (wert: { gefaellt: number }) => void;
        const m = modell(
            () =>
                new Promise((weiter) => {
                    fertig = weiter;
                }),
        );
        const a = m.umschalten({ id: "a" });
        expect(m.zaehlt("a")).toBe(true);
        expect(m.zaehlt("b")).toBe(false);
        fertig({ gefaellt: 1 });
        await a;
    });
});

describe("Aufruf und Sätze", () => {
    it("schickt nur delta an die Adresse des Bildes", async () => {
        const gesehen: { url: string; body: unknown }[] = [];
        const fetcher = ((url: string, init: RequestInit) => {
            gesehen.push({ url, body: JSON.parse(String(init.body)) });
            return Promise.resolve(
                new Response(JSON.stringify({ gefaellt: 3 }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
        }) as unknown as typeof fetch;
        expect(await sendeReisebildGefaellt("abc", -1, fetcher)).toEqual({ gefaellt: 3 });
        expect(gesehen).toEqual([{ url: "/api/photobox/reisebilder/abc/gefaellt", body: { delta: -1 } }]);
    });

    it("das Bild gibt es nicht mehr, die Drossel und der allgemeine Fall haben je ihren Satz", () => {
        const fehlt = new ApiFailure(404, "photobox_not_found", "x", { reason: "reisebild_unbekannt" });
        expect(reisebildGefaelltSatz(fehlt)).toMatch(/Reisebild/u);
        const drossel = new ApiFailure(429, "photobox_rate", "x", { retryAfterSeconds: 3600 });
        expect(reisebildGefaelltSatz(drossel)).toMatch(/Gefällt mir/u);
        expect(reisebildGefaelltSatz(new Error("netz"))).toMatch(/nicht gezählt/u);
    });
});
