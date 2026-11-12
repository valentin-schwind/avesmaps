import { describe, expect, it, vi } from "vitest";
import { createNeueVersion, einstieg, istNeu, moduleAusHtml, stamm } from "../src/system/neue-version.ts";
import { hatUngespeichert, meldeQuelle } from "../src/system/ungespeichert.ts";

/**
 * „Neue Version“ ohne Browser (WI-0136 N1, NACHRICHT-0001 §2):
 * - Der Einstieg kommt aus den Modul-Skripten; der Stamm ohne Hash entscheidet, ob es dieselbe Seite ist.
 * - 🔴 Neu nur bei gleichem Stamm und anderem Einstieg; eine Umleitung, ein Fehler oder ein fremder Stamm ist kein Fehlalarm.
 * - 🔴 Nie automatisch neu laden; im Takt nur, solange der Tab sichtbar ist.
 * - Ungespeicherte Arbeit meldet eine Quelle; eine Quelle, die wirft, zählt als „ja“.
 */

const seite = (src: string): string =>
    `<!doctype html><html><head><script type="module" src="/@vite/client"></script><script type="module" crossorigin src="${src}"></script></head></html>`;

const antwort = (html: string, extra: Partial<Response> = {}): Response =>
    ({ ok: true, redirected: false, text: async () => html, ...extra }) as Response;

describe("Einstieg und Stamm", () => {
    it("liest die Modul-Skripte und nimmt den ersten, der nicht zum Entwicklungsserver gehört", () => {
        const html = seite("/assets/index-AbCd1234.js") + `<script src="/x.js"></script>`;
        expect(moduleAusHtml(html)).toEqual(["/@vite/client", "/assets/index-AbCd1234.js"]);
        expect(einstieg(moduleAusHtml(html))).toBe("/assets/index-AbCd1234.js");
        expect(stamm("/assets/index-AbCd1234.js")).toBe("index");
        expect(stamm("/src/main.ts?v=2")).toBe("main");
    });

    it("🔴 neu nur bei gleichem Stamm und anderem Einstieg", () => {
        expect(istNeu("/assets/index-AAAAAAAA.js", "/assets/index-BBBBBBBB.js")).toBe(true);
        expect(istNeu("/assets/index-AAAAAAAA.js", "/assets/index-AAAAAAAA.js")).toBe(false);
        // Eine andere Seite (etwa die Anmeldung) ist keine neue Version.
        expect(istNeu("/assets/index-AAAAAAAA.js", "/assets/anmelden-BBBBBBBB.js")).toBe(false);
        expect(istNeu(undefined, "/assets/index-BBBBBBBB.js")).toBe(false);
        expect(istNeu("/assets/index-AAAAAAAA.js", undefined)).toBe(false);
    });
});

describe("Prüfen", () => {
    const eigen = (): string => "/assets/index-AAAAAAAA.js";

    it("🔴 gleiche Seite: nichts; neue Seite: Hinweis; nie von selbst neu laden", async () => {
        const neuLaden = vi.fn();
        let html = seite("/assets/index-AAAAAAAA.js");
        const fetch = vi.fn(async () => antwort(html));
        const v = createNeueVersion({
            fetch: fetch as never,
            eigen,
            pfad: () => "/edit",
            sichtbar: () => true,
            neuLaden,
        });
        await v.pruefe();
        expect(v.neu.value).toBe(false);
        html = seite("/assets/index-BBBBBBBB.js");
        await v.pruefe();
        expect(v.neu.value).toBe(true);
        expect(fetch).toHaveBeenLastCalledWith(
            "/edit",
            expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
        );
        // Einmal neu, bleibt neu; kein weiterer Abruf.
        await v.pruefe();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(neuLaden).not.toHaveBeenCalled();
    });

    it("🔴 kein Fehlalarm: Umleitung, Fehlerstatus, gescheiterter Abruf", async () => {
        for (const fetch of [
            async () => antwort(seite("/assets/index-BBBBBBBB.js"), { redirected: true }),
            async () => antwort(seite("/assets/index-BBBBBBBB.js"), { ok: false }),
            async () => {
                throw new TypeError("offline");
            },
        ]) {
            const v = createNeueVersion({ fetch: fetch as never, eigen, pfad: () => "/", sichtbar: () => true });
            await v.pruefe();
            expect(v.neu.value).toBe(false);
        }
    });

    it("im Takt nur, solange der Tab sichtbar ist", async () => {
        vi.useFakeTimers();
        try {
            let sichtbar = false;
            const fetch = vi.fn(async () => antwort(seite("/assets/index-BBBBBBBB.js")));
            const v = createNeueVersion({
                fetch: fetch as never,
                eigen,
                pfad: () => "/",
                sichtbar: () => sichtbar,
                taktMs: 1000,
            });
            v.start();
            await vi.advanceTimersByTimeAsync(3000);
            expect(fetch).not.toHaveBeenCalled();
            sichtbar = true;
            await vi.advanceTimersByTimeAsync(1000);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect(v.neu.value).toBe(true);
            v.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("Ungespeicherte Arbeit", () => {
    it("eine Quelle meldet; abgemeldet zählt sie nicht mehr; eine, die wirft, zählt als ja", () => {
        expect(hatUngespeichert()).toBe(false);
        let offen = true;
        const ab = meldeQuelle(() => offen);
        expect(hatUngespeichert()).toBe(true);
        offen = false;
        expect(hatUngespeichert()).toBe(false);
        const ab2 = meldeQuelle(() => {
            throw new Error("kaputt");
        });
        expect(hatUngespeichert()).toBe(true);
        ab2();
        ab();
        expect(hatUngespeichert()).toBe(false);
    });
});
