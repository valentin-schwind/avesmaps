import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorLockIncoming, EditorLockRequest } from "@avesmaps3d/shared";
import { EDITOR_LOCKS_URL } from "@avesmaps3d/shared";
import { createEditorSperre, type FreigabeAngebot } from "../src/editor-sperre/sperre.ts";

/**
 * Die Bitte um Freigabe im Baustein der Sperre (WI-0262, OPS-000059): die Wege zum Server und die Schnittstelle zum Speichern.
 *
 * Problemfälle: Die Bitten des Inhabers kommen nur mit dem Herzschlag und nie aus einer freigegebenen Sperre; die Antwort des Servers auf
 * eine zweite Bitte (409 `request_open`) geht als Fehler verloren statt als die offene Bitte; ein Lauf gibt die Sperre ab, bevor ALLE
 * Bearbeitungen des Objekts gespeichert haben, oder trotz eines gescheiterten Speicherns; ohne Angebot wird still freigegeben; die
 * eigenen Bitten verschwinden, wenn die Liste einmal nicht antwortet.
 */
const LAUF = "d1d1d1d1-0000-4000-8000-000000000001";
const ZIEL = { kind: "place", id: "d1d1d1d1-0000-4000-8000-0000000000a1" } as const;
const ANDERES = { kind: "place", id: "d1d1d1d1-0000-4000-8000-0000000000a2" } as const;
const BITTE: EditorLockIncoming = {
    requestId: "d1d1d1d1-0000-4000-8000-0000000000b1",
    kind: "place",
    id: ZIEL.id,
    from: { id: "d1d1d1d1-0000-4000-8000-0000000000f1", name: "Thomas" },
    createdAt: "2026-10-30T10:00:00.000Z",
    expiresAt: "2026-10-30T10:05:00.000Z",
};
const EIGENE: EditorLockRequest = {
    requestId: BITTE.requestId,
    kind: "place",
    id: ZIEL.id,
    state: "open",
    createdAt: BITTE.createdAt,
    expiresAt: BITTE.expiresAt,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const lock = (id: string) => ({
    kind: "place",
    id,
    part: "felder",
    person: { id: "d1d1d1d1-0000-4000-8000-0000000000f2", name: "Ich" },
    since: "2026-10-30T09:00:00.000Z",
    heartbeatAt: "2026-10-30T09:00:00.000Z",
    own: true,
});

function aufbau(antworten: (url: string, body: Record<string, unknown>) => Response) {
    const aufrufe: { url: string; body: Record<string, unknown> }[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        aufrufe.push({ url: String(url), body });
        return antworten(String(url), body);
    });
    vi.useFakeTimers();
    const sperre = createEditorSperre({ fetcher: fetcher as unknown as typeof fetch, lauf: LAUF });
    return { sperre, aufrufe };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("Bitten um Freigabe: vom Server", () => {
    it("🔴 die Bitten des Inhabers kommen nur mit dem Herzschlag, ganz, und nie aus einer freigegebenen Sperre", async () => {
        let bitten: EditorLockIncoming[] = [BITTE];
        const { sperre, aufrufe } = aufbau((url) =>
            url.endsWith("/heartbeat")
                ? json(200, bitten.length === 0 ? { lost: [] } : { lost: [], requests: bitten })
                : json(200, { lock: lock(ZIEL.id) }),
        );
        const gehoert: (readonly EditorLockIncoming[])[] = [];
        sperre.beiAnfragen((liste) => gehoert.push(liste));
        await sperre.nimm(ZIEL, "felder");
        // Ohne Herzschlag keine Meldung, und kein eigener Takt: Die Bitte kommt mit dem Schlag nach einer Minute.
        expect(gehoert).toEqual([]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(gehoert).toEqual([[BITTE]]);
        expect(aufrufe.filter((a) => a.url.endsWith("/heartbeat"))).toHaveLength(1);
        // Eine beantwortete Bitte fehlt im nächsten Schlag: Die Liste ist leer, der Zuhörer erfährt es.
        bitten = [];
        await vi.advanceTimersByTimeAsync(60_000);
        expect(gehoert.at(-1)).toEqual([]);
        // Gibt der Lauf die Sperre ab, bevor der nächste Schlag kommt, trifft eine alte Bitte keine Sperre mehr.
        bitten = [BITTE];
        await vi.advanceTimersByTimeAsync(60_000);
        expect(gehoert.at(-1)).toEqual([BITTE]);
        sperre.gib(ZIEL);
        expect(gehoert.at(-1)).toEqual([]);
        sperre.destroy();
    });

    it("🔴 bitten: gestellt, schon offen (409 mit der Bitte), nicht gesperrt, die eigene Sperre, ein Fehler", async () => {
        const antworten = new Map<string, Response>();
        const { sperre, aufrufe } = aufbau(() => antworten.get("antwort") ?? json(500, {}));
        antworten.set("antwort", json(200, { request: EIGENE }));
        expect(await sperre.frage(ZIEL)).toEqual({ art: "gestellt", anfrage: EIGENE });
        expect(aufrufe[0]).toEqual({ url: `${EDITOR_LOCKS_URL}/request`, body: { ...ZIEL, run: LAUF } });
        antworten.set(
            "antwort",
            json(409, { error: { code: "request_open", message: "offen", details: { request: EIGENE } } }),
        );
        expect(await sperre.frage(ZIEL)).toEqual({ art: "offen", anfrage: EIGENE });
        antworten.set("antwort", json(409, { error: { code: "not_locked", message: "frei" } }));
        expect((await sperre.frage(ZIEL)).art).toBe("frei");
        antworten.set("antwort", json(409, { error: { code: "own_lock", message: "deine" } }));
        expect((await sperre.frage(ZIEL)).art).toBe("eigene");
        antworten.set("antwort", json(423, { error: { code: "map_editing_off", message: "aus" } }));
        expect(await sperre.frage(ZIEL)).toMatchObject({ art: "fehler", fehler: { code: "map_editing_off" } });
        sperre.destroy();
    });

    it("antworten: der Lauf geht mit, 204 heißt angenommen, alles andere nicht", async () => {
        let status = 204;
        const { sperre, aufrufe } = aufbau(() => new Response(null, { status }));
        expect(await sperre.antworte(BITTE.requestId, "released")).toBe(true);
        expect(aufrufe[0]).toEqual({
            url: `${EDITOR_LOCKS_URL}/request/answer`,
            body: { requestId: BITTE.requestId, run: LAUF, answer: "released" },
        });
        status = 409;
        expect(await sperre.antworte(BITTE.requestId, "later")).toBe(false);
        sperre.destroy();
    });

    it("🔴 die eigenen Bitten kommen mit der Liste; fällt sie einmal aus, bleibt der letzte Stand", async () => {
        let ausfall = false;
        const { sperre } = aufbau((url) => {
            if (ausfall) throw new Error("kein Netz");
            return url.includes("kind=place") ? json(200, { locks: [], requests: [EIGENE] }) : json(200, { locks: [] });
        });
        expect(sperre.anfragen("place")).toEqual([]);
        await sperre.liste("place");
        expect(sperre.anfragen("place")).toEqual([EIGENE]);
        // Eine andere Art bringt keine; ohne Netz bleibt die Antwort stehen (eine Antwort verschwindet nicht, weil das Netz hakt).
        await sperre.liste("path");
        expect(sperre.anfragen("path")).toEqual([]);
        ausfall = true;
        expect(await sperre.liste("place")).toEqual([]);
        expect(sperre.anfragen("place")).toEqual([EIGENE]);
        sperre.destroy();
    });
});

describe("Freigabe auf Bitte: die Schnittstelle zum Speichern", () => {
    const angebot = (
        ereignisse: string[],
        name: string,
        ausgang: Awaited<ReturnType<FreigabeAngebot["speichere"]>> = { ok: true },
        titel?: string,
    ): FreigabeAngebot => ({
        titel,
        async speichere() {
            ereignisse.push(name);
            return ausgang;
        },
    });

    it("🔴 alle Bearbeitungen des Objekts speichern der Reihe nach, DANN gibt der Lauf die Sperre ab", async () => {
        const { sperre, aufrufe } = aufbau((url) =>
            url.endsWith("/release") ? json(204, null) : json(200, { lock: lock(ZIEL.id) }),
        );
        await sperre.nimm(ZIEL, "felder");
        const ereignisse: string[] = [];
        sperre.bieteFreigabe(ZIEL, angebot(ereignisse, "fenster", { ok: true }, "Gareth"));
        sperre.bieteFreigabe(ZIEL, angebot(ereignisse, "verschieben"));
        expect(sperre.titelVon(ZIEL)).toBe("Gareth");
        expect(sperre.titelVon(ANDERES)).toBeUndefined();
        expect(await sperre.gibFreiAufBitte(ZIEL)).toEqual({ ok: true });
        expect(ereignisse).toEqual(["fenster", "verschieben"]);
        expect(sperre.haelt(ZIEL)).toBe(false);
        expect(aufrufe.at(-1)).toEqual({ url: `${EDITOR_LOCKS_URL}/release`, body: { run: LAUF, ...ZIEL } });
        sperre.destroy();
    });

    it("🔴 scheitert das Speichern, bleibt die Sperre, die folgenden Angebote laufen nicht, und der Grund geht zurück", async () => {
        const { sperre, aufrufe } = aufbau(() => json(200, { lock: lock(ZIEL.id) }));
        await sperre.nimm(ZIEL, "felder");
        const ereignisse: string[] = [];
        sperre.bieteFreigabe(ZIEL, angebot(ereignisse, "fenster", { ok: false, grund: "Ein Feld fehlt." }));
        sperre.bieteFreigabe(ZIEL, angebot(ereignisse, "verschieben"));
        expect(await sperre.gibFreiAufBitte(ZIEL)).toEqual({ ok: false, grund: "Ein Feld fehlt." });
        expect(ereignisse).toEqual(["fenster"]);
        expect(sperre.haelt(ZIEL)).toBe(true);
        expect(aufrufe.some((a) => a.url.endsWith("/release"))).toBe(false);
        // Ein Angebot, das wirft, zählt als gescheitert und lässt die Sperre ebenso stehen.
        const wirft: FreigabeAngebot = {
            speichere: () => Promise.reject(new Error("kaputt")),
        };
        const sperre2 = createEditorSperre({
            fetcher: (async () => json(200, { lock: lock(ANDERES.id) })) as unknown as typeof fetch,
            lauf: LAUF,
        });
        await sperre2.nimm(ANDERES, "felder");
        sperre2.bieteFreigabe(ANDERES, wirft);
        expect(await sperre2.gibFreiAufBitte(ANDERES)).toEqual({ ok: false, grund: undefined });
        expect(sperre2.haelt(ANDERES)).toBe(true);
        sperre2.destroy();
        sperre.destroy();
    });

    it("🔴 ohne Angebot wird nicht still freigegeben: Eine Bearbeitung, die sich nicht gemeldet hat, behält ihre Sperre", async () => {
        const { sperre, aufrufe } = aufbau(() => json(200, { lock: lock(ZIEL.id) }));
        await sperre.nimm(ZIEL, "felder");
        expect(await sperre.gibFreiAufBitte(ZIEL)).toEqual({ ok: false, grund: undefined });
        expect(sperre.haelt(ZIEL)).toBe(true);
        expect(aufrufe.some((a) => a.url.endsWith("/release"))).toBe(false);
        sperre.destroy();
    });

    it("das Abmelden nimmt nur das eigene Angebot weg", async () => {
        const { sperre } = aufbau(() => json(200, { lock: lock(ZIEL.id) }));
        await sperre.nimm(ZIEL, "felder");
        const ereignisse: string[] = [];
        const weg = sperre.bieteFreigabe(ZIEL, angebot(ereignisse, "a"));
        sperre.bieteFreigabe(ZIEL, angebot(ereignisse, "b"));
        weg();
        await sperre.gibFreiAufBitte(ZIEL);
        expect(ereignisse).toEqual(["b"]);
        sperre.destroy();
    });
});
