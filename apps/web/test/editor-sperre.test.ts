import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_LOCKS_URL, type EditorLock } from "@avesmaps3d/shared";
import { createEditorSperre } from "../src/editor-sperre/sperre.ts";

/**
 * Die Sperre während der Bearbeitung im Browser (EDIT-0003 §4). Problemfälle: Ein gehaltenes Objekt bekommt keinen Herzschlag oder
 * einen je Sperre statt einen für alle; ohne Sperre schlägt die Uhr weiter; eine fremde Sperre kommt als Fehler statt mit dem, der
 * hält; eine verlorene Sperre bleibt still; Freigeben trifft eine Sperre, die der Lauf nicht hält.
 */
const LAUF = "b9b9b9b9-0000-4000-8000-000000000001";
const ZIEL = { kind: "landscape", id: "b9b9b9b9-0000-4000-8000-0000000000a1" } as const;
const FREMD: EditorLock = {
    kind: "landscape",
    id: ZIEL.id,
    part: "form",
    person: { id: "b9b9b9b9-0000-4000-8000-0000000000f1", name: "Thomas" },
    since: "2026-10-16T12:00:00.000Z",
    heartbeatAt: "2026-10-16T12:05:00.000Z",
    own: false,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

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

describe("Sperre im Browser", () => {
    it("🔴 genommen: ein Herzschlag je Minute für alle Sperren; freigegeben: keine Uhr mehr", async () => {
        const { sperre, aufrufe } = aufbau((url) =>
            url.endsWith("/heartbeat") ? json(200, { lost: [] }) : json(200, { lock: { ...FREMD, own: true } }),
        );
        expect((await sperre.nimm(ZIEL, "form")).art).toBe("genommen");
        expect(aufrufe[0]).toEqual({ url: EDITOR_LOCKS_URL, body: { ...ZIEL, part: "form", run: LAUF } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(aufrufe.filter((aufruf) => aufruf.url.endsWith("/heartbeat"))).toEqual([
            { url: `${EDITOR_LOCKS_URL}/heartbeat`, body: { run: LAUF, locks: [ZIEL] } },
        ]);
        sperre.gib(ZIEL);
        expect(aufrufe.at(-1)).toEqual({ url: `${EDITOR_LOCKS_URL}/release`, body: { run: LAUF, ...ZIEL } });
        const vorher = aufrufe.length;
        await vi.advanceTimersByTimeAsync(180_000);
        expect(aufrufe).toHaveLength(vorher);
        // Was der Lauf nicht hält, gibt er nicht frei.
        sperre.gib(ZIEL);
        expect(aufrufe).toHaveLength(vorher);
        sperre.destroy();
    });

    it("🔴 hält ein anderer das Objekt, kommt seine Sperre zurück, nicht ein Fehler", async () => {
        const { sperre } = aufbau(() =>
            json(409, { error: { code: "object_locked", message: "…", details: { lock: FREMD } } }),
        );
        expect(await sperre.nimm(ZIEL, "form")).toEqual({ art: "gesperrt", sperre: FREMD });
        sperre.destroy();
    });

    it("🔴 verloren: der Zuhörer erfährt es, und die Uhr steht", async () => {
        const { sperre, aufrufe } = aufbau((url) =>
            url.endsWith("/heartbeat") ? json(200, { lost: [ZIEL] }) : json(200, { lock: { ...FREMD, own: true } }),
        );
        const verloren = vi.fn();
        sperre.beiVerlust(verloren);
        await sperre.nimm(ZIEL, "form");
        await vi.advanceTimersByTimeAsync(60_000);
        expect(verloren).toHaveBeenCalledWith(ZIEL);
        const vorher = aufrufe.length;
        await vi.advanceTimersByTimeAsync(180_000);
        expect(aufrufe).toHaveLength(vorher);
        sperre.destroy();
    });

    it("ohne Server ist das Nehmen ein Fehler, kein „gesperrt“", async () => {
        const { sperre } = aufbau(() => json(503, { error: { code: "database_unavailable", message: "…" } }));
        expect((await sperre.nimm(ZIEL, "felder")).art).toBe("fehler");
        sperre.destroy();
    });
});
