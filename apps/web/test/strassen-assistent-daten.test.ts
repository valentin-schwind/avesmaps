import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrasseStreckeAntwort } from "@avesmaps3d/shared";
import {
    RUHE_MS,
    createStrassenAssistentDaten,
    createStreckenLeser,
    fehlerSchluessel,
    type LeserStand,
    type StreckeAntwort,
} from "../src/wegeditor/strassen-assistent-daten";

/**
 * Die Daten des Straßen-Assistenten (WI-0310). Problemfälle: Jede Änderung der Liste fragt den Server sofort; eine ältere Antwort überholt
 * die jüngere; ein Abbruch meldet einen Fehler; 409 und 403 sagen dasselbe wie ein Netzfehler.
 */
const ANKER = "a0a0a0a0-0000-4000-8000-000000000001";
const LEER = {
    artikel: null,
    name: "",
    orte: [],
    unbekannt: [],
    teile: [],
    abschnitte: {},
    abseits: [],
    vorschlaege: [],
    quellen: [],
} satisfies StrasseStreckeAntwort;
const ok = (name: string): StreckeAntwort => ({ ok: true, antwort: { ...LEER, name } });

describe("Die Strecke lesen", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("🔴 wartet 250 ms Stille ab und fragt dann einmal", async () => {
        const strecke = vi.fn((): Promise<StreckeAntwort> => Promise.resolve(ok("A")));
        const stande: LeserStand[] = [];
        const leser = createStreckenLeser({ strecke }, (s) => stande.push(s));
        leser.frage({ anker: ANKER });
        await vi.advanceTimersByTimeAsync(RUHE_MS - 10);
        leser.frage({ anker: ANKER, orte: [] });
        await vi.advanceTimersByTimeAsync(RUHE_MS - 10);
        expect(strecke).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20);
        expect(strecke).toHaveBeenCalledTimes(1);
        expect(stande.at(-1)).toMatchObject({ phase: "bereit" });
    });

    it("sofort fragt ohne Ruhe", async () => {
        const strecke = vi.fn((): Promise<StreckeAntwort> => Promise.resolve(ok("A")));
        createStreckenLeser({ strecke }, () => undefined).frage({ anker: ANKER }, true);
        await vi.advanceTimersByTimeAsync(0);
        expect(strecke).toHaveBeenCalledTimes(1);
    });

    it("🪤 eine jüngere Frage bricht die ältere ab, deren Antwort meldet nichts mehr", async () => {
        const wartende: ((a: StreckeAntwort) => void)[] = [];
        const signale: AbortSignal[] = [];
        const strecke = vi.fn(
            (_b: unknown, signal: AbortSignal) =>
                new Promise<StreckeAntwort>((fertig) => {
                    signale.push(signal);
                    wartende.push(fertig);
                }),
        );
        const stande: LeserStand[] = [];
        const leser = createStreckenLeser({ strecke }, (s) => stande.push(s));
        leser.frage({ anker: ANKER }, true);
        leser.frage({ anker: ANKER, key: "x" }, true);
        expect(signale[0]?.aborted).toBe(true);
        wartende[1]?.(ok("neu"));
        wartende[0]?.(ok("alt"));
        await vi.advanceTimersByTimeAsync(0);
        const bereit = stande.filter((s) => s.phase === "bereit");
        expect(bereit).toHaveLength(1);
        expect(bereit[0]).toMatchObject({ antwort: { name: "neu" } });
    });

    it("ein Fehler des Servers wird ein Satz; stopp meldet nichts mehr", async () => {
        const stande: LeserStand[] = [];
        const leser = createStreckenLeser(
            { strecke: () => Promise.resolve({ ok: false, status: 403, fehler: { code: "forbidden", message: "x" } }) },
            (s) => stande.push(s),
        );
        leser.frage({ anker: ANKER }, true);
        await vi.advanceTimersByTimeAsync(0);
        expect(stande.at(-1)).toEqual({ phase: "fehler", satz: "wegeditor.assistent.fehler.recht" });
        const n = stande.length;
        leser.frage({ anker: ANKER });
        leser.stopp();
        await vi.advanceTimersByTimeAsync(RUHE_MS * 2);
        expect(stande).toHaveLength(n + 1);
    });
});

describe("Die Sätze zu den Fehlern", () => {
    it("🔴 409 und 403 sagen, was zu tun ist; ohne Verbindung ein eigener Satz", () => {
        expect(fehlerSchluessel(409, "edit_conflict")).toBe("wegeditor.assistent.fehler.konflikt");
        expect(fehlerSchluessel(409, "object_locked")).toBe("wegeditor.assistent.fehler.gesperrt");
        expect(fehlerSchluessel(403, "forbidden")).toBe("wegeditor.assistent.fehler.recht");
        expect(fehlerSchluessel(0, "network_error")).toBe("wegeditor.assistent.fehler.netz");
        expect(fehlerSchluessel(500, "x")).toBe("wegeditor.assistent.fehler.allgemein");
        expect(fehlerSchluessel(500, "x", true)).toBe("wegeditor.assistent.fehler.lesen");
    });
});

describe("Die Routen", () => {
    it("Strecke und Zuweisen gehen als POST an ihre Adresse", async () => {
        const aufrufe: [string, string | undefined][] = [];
        const abruf = ((url: string, init?: RequestInit) => {
            aufrufe.push([url, init?.method]);
            return Promise.resolve(new Response(JSON.stringify({ ...LEER, anker: ANKER }), { status: 200 }));
        }) as unknown as typeof fetch;
        const daten = createStrassenAssistentDaten(abruf);
        const lesen = await daten.strecke({ anker: ANKER }, new AbortController().signal);
        expect(lesen.ok).toBe(true);
        await daten.zuweisen({
            operationId: "o1",
            name: "A",
            key: null,
            quellen: false,
            sections: [],
            entfernen: [],
        });
        expect(aufrufe).toEqual([
            ["/api/editor/paths/strassen-assistent/strecke", "POST"],
            ["/api/editor/paths/strassen-assistent/zuweisen", "POST"],
        ]);
    });
});
