import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectRef } from "@avesmaps3d/shared";
import { SubjectRequestError, createSubjectClient } from "../src/info-panel/subject-client.ts";

/**
 * Absagen wegen Last fragt das Infopanel selbst noch einmal, still (Regel des Betreibers vom 2026-09-27 für den Planer,
 * `load-retry.ts`): nach der Pause aus `Retry-After`, höchstens dreimal, danach die Meldung des Panels wie bisher.
 *
 * 🪤 Befund 2026-10-04: Unter paralleler Last lief der Kontext von Gareth in die Zeitgrenze der Datenbank (503
 * `database_unavailable`), das Panel zeigte sofort „Die Angaben konnten nicht geladen werden“. Die Abfrage hat seitdem
 * ihren Index (Migration 0071); die Drossel der Subjects (503 `busy`) bleibt.
 */

const GARETH: SubjectRef = { kind: "place", id: "80558060-4299-54aa-b520-814b10819885" };
const DETAIL = { subject: GARETH, revision: "r1", title: "Gareth" };

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
    );
const busy = () => answer({ error: "busy" }, 503, { "retry-after": "1" });
const unavailable = () => answer({ error: "database_unavailable" }, 503, { "retry-after": "5" });

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("Infopanel: Absage wegen Last", () => {
    it("🔴 fragt nach der Pause aus Retry-After selbst noch einmal und liefert dann den Subject", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockReturnValueOnce(busy())
            .mockReturnValueOnce(unavailable())
            .mockReturnValueOnce(answer(DETAIL));
        const detail = createSubjectClient(fetcher).detail(GARETH);

        await vi.advanceTimersByTimeAsync(999);
        expect(fetcher, "vor Ablauf von Retry-After fragt er nicht").toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5000);

        await expect(detail).resolves.toEqual(DETAIL);
        expect(fetcher).toHaveBeenCalledTimes(3);
        // Dieselbe Frage, nur Lesen: kein anderer Endpunkt, keine Methode, kein Körper.
        expect(new Set(fetcher.mock.calls.map(([url]) => String(url)))).toEqual(
            new Set([`/api/subjects/place/${GARETH.kind === "place" ? GARETH.id : ""}`]),
        );
        for (const [, init] of fetcher.mock.calls) {
            expect(init?.method).toBeUndefined();
            expect(init?.body).toBeUndefined();
        }
    });

    it("gibt nach drei Absagen auf: der Fehler trägt 503, das Panel zeigt seine Meldung", async () => {
        const fetcher = vi.fn<typeof fetch>(() => unavailable());
        const detail = createSubjectClient(fetcher).detail(GARETH);
        const settled = detail.catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(20_000);

        const error = await settled;
        expect(error).toBeInstanceOf(SubjectRequestError);
        expect((error as SubjectRequestError).status).toBe(503);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it("wiederholt nichts anderes: 404 heißt „gibt es nicht“, 500 ist ein Fehler", async () => {
        const missing = vi.fn<typeof fetch>(() => answer({ error: "not_found" }, 404));
        await expect(createSubjectClient(missing).detail(GARETH)).resolves.toBeNull();
        expect(missing).toHaveBeenCalledTimes(1);

        const broken = vi.fn<typeof fetch>(() => answer({ error: "internal_error" }, 500));
        await expect(createSubjectClient(broken).detail(GARETH)).rejects.toBeInstanceOf(SubjectRequestError);
        expect(broken).toHaveBeenCalledTimes(1);
    });

    it("hört in der Pause auf, sobald ein anderer Subject gewählt wird", async () => {
        const fetcher = vi.fn<typeof fetch>(() => busy());
        const controller = new AbortController();
        const detail = createSubjectClient(fetcher).detail(GARETH, controller.signal);
        const settled = detail.catch((error: unknown) => error);

        await vi.advanceTimersByTimeAsync(500);
        controller.abort();
        await vi.advanceTimersByTimeAsync(5000);

        expect(((await settled) as Error).name).toBe("AbortError");
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("🔴 ein Objektlink (`?siedlung=`) fragt ebenso noch einmal", async () => {
        const resolved = { ref: GARETH };
        const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(busy()).mockReturnValueOnce(answer(resolved));
        const link = createSubjectClient(fetcher).resolveLink({ param: "siedlung", name: "siedlung", value: "Gareth" });

        await vi.advanceTimersByTimeAsync(1000);

        await expect(link).resolves.toEqual(resolved);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});

describe("Infopanel: ein Editor liest das Detail frisch (WI-0193, EDIT-0003 T35 (1))", () => {
    // Nginx der Stage hält `public, max-age=60` für alle; nach „Verbergen“ las das Menü am Ort sonst den alten Stand.
    const adresse = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>): string => String(fetcher.mock.calls[0]?.[0]);

    it("🔴 als Editor mit ?editor=true, als Besucher ohne", async () => {
        const editor = vi.fn<typeof fetch>().mockReturnValue(answer(DETAIL));
        await createSubjectClient(editor, () => true).detail(GARETH);
        expect(adresse(editor)).toBe(`/api/subjects/place/${GARETH.id}?editor=true`);
        const besucher = vi.fn<typeof fetch>().mockReturnValue(answer(DETAIL));
        await createSubjectClient(besucher, () => false).detail(GARETH);
        expect(adresse(besucher)).toBe(`/api/subjects/place/${GARETH.id}`);
    });

    it("hängt sich an eine Adresse mit Abfrage an (ein Weg mit Wiki-Schlüssel)", async () => {
        const fetcher = vi.fn<typeof fetch>().mockReturnValue(answer(DETAIL));
        await createSubjectClient(fetcher, () => true).detail({
            kind: "path",
            chain: "Reichsstrasse:reichsstrasse",
            wiki: "w",
        });
        expect(adresse(fetcher)).toMatch(/\?wiki=w&editor=true$/u);
    });
});
