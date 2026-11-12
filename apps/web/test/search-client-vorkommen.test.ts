import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBeispiele, fetchEintrag, fetchLeuchten, fetchZahlen, leuchtenUrl } from "../src/search/search-client";

/**
 * Die Wege der Vorkommen im Suchclient (WI-0257 S3b): die flache Adresse des Leuchtens, 404 als „gibt es nicht“, 503 `busy` als „gleich noch einmal“ (höchstens dreimal), jeder andere Fehler wirft.
 */

const ID = "165000d1-21db-479c-a677-a9f21686c517";
const ORT = "80558060-4299-54aa-b520-814b10819885";

const antwort = (status: number, body: unknown = {}): Response =>
    ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) }) as unknown as Response;

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("leuchtenUrl", () => {
    it("trägt Eintrag, Landschaften (mit Komma), Gebiet, Lage und Orte flach", () => {
        expect(leuchtenUrl({ eintrag: ID })).toBe(`/api/search/leuchten?eintrag=${ID}`);
        expect(leuchtenUrl({ eintrag: ID, landschaften: [ID, ORT] })).toBe(
            `/api/search/leuchten?eintrag=${ID}&landschaften=${ID},${ORT}`,
        );
        expect(leuchtenUrl({ eintrag: ID, lage: "zwischen", orte: [ORT, ID] })).toBe(
            `/api/search/leuchten?eintrag=${ID}&lage=zwischen&orte=${ORT},${ID}`,
        );
        expect(leuchtenUrl({ art: "wald", gebiet: ID })).toBe(`/api/search/leuchten?art=wald&gebiet=${ID}`);
    });
});

describe("die Abrufe", () => {
    it("404 heißt „gibt es nicht (mehr)“: null, ohne zu werfen", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(404)));
        await expect(fetchLeuchten({ eintrag: ID })).resolves.toBeNull();
        await expect(fetchEintrag(ID)).resolves.toBeNull();
    });

    it("🔴 503 `busy` fragt nach kurzer Pause noch einmal, danach gilt die Antwort", async () => {
        vi.useFakeTimers();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(antwort(503))
            .mockResolvedValueOnce(antwort(200, { zahlen: [{ id: ID, gegenden: 4, orte: 0, nurKontinent: false }] }));
        vi.stubGlobal("fetch", fetchMock);
        const ergebnis = fetchZahlen([ID]);
        await vi.advanceTimersByTimeAsync(1100);
        const zahlen = await ergebnis;
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(zahlen.get(ID)?.gegenden).toBe(4);
    });

    it("nach dem dritten 503 ist es ein Fehler, nicht „keine Treffer“", async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue(antwort(503));
        vi.stubGlobal("fetch", fetchMock);
        const ergebnis = fetchLeuchten({ eintrag: ID });
        const abgefangen = ergebnis.catch((fehler: unknown) => fehler);
        await vi.advanceTimersByTimeAsync(3000);
        expect(await abgefangen).toBeInstanceOf(Error);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("ein anderer Fehler wirft sofort", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(500)));
        await expect(fetchEintrag(ID)).rejects.toThrow(/500/u);
    });

    it("ohne Kennungen fragt `zahlen` gar nicht", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        expect((await fetchZahlen([])).size).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("die Beispiele sind die Liste der Antwort", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(antwort(200, { beispiele: [{ text: "Fasar", art: "ort" }] })));
        await expect(fetchBeispiele()).resolves.toEqual([{ text: "Fasar", art: "ort" }]);
    });
});
