import { describe, expect, it } from "vitest";
import { createWikisync } from "../src/wikisync/wikisync.ts";
import { hoereWikiSyncMeldung, meldeWikiSync } from "../src/wikisync/wikisync-melde.ts";

/**
 * Das ↺ in „Änderungen“ stößt eine Rücknahme des WikiSync an (WI-0265 B8d): Eine offene Ansicht des WikiSync liest dann neu (sie kennt den neuen Auftrag sonst erst beim nächsten Lesen), eine geschlossene nicht;
 * das Fenster der Regeln meldet sich über denselben Weg an. Der Server ist nachgebaut und zählt die Lesewege.
 */

function server() {
    const gelesen: string[] = [];
    const fetcher = (async (url: RequestInfo | URL) => {
        gelesen.push(String(url).split("?")[0] ?? "");
        await Promise.resolve();
        // Der Inhalt zählt hier nicht, nur DASS gelesen wird: eine Antwort ohne Daten lässt das Lesen enden, ohne dass der Stand gerechnet wird.
        return new Response(JSON.stringify({ error: { code: "unavailable", message: "x" } }), { status: 503 });
    }) as typeof fetch;
    return { gelesen, fetcher };
}

describe("Meldung an den WikiSync", () => {
    it("🔴 die offene Ansicht liest neu, die geschlossene nicht; nach dem Schließen meldet sie sich ab", async () => {
        const { gelesen, fetcher } = server();
        const ws = createWikisync({ fetcher, setTimer: () => 0, clearTimer: () => undefined });
        meldeWikiSync();
        await Promise.resolve();
        expect(gelesen).toHaveLength(0);

        ws.follow(true);
        meldeWikiSync();
        await new Promise((fertig) => setTimeout(fertig, 0));
        const nachMeldung = gelesen.length;
        expect(nachMeldung).toBeGreaterThan(0);
        // Mehrfaches Öffnen meldet nicht mehrfach an: EINE Meldung, EIN Lesen (derselbe Satz Lesewege).
        ws.follow(true);
        meldeWikiSync();
        await new Promise((fertig) => setTimeout(fertig, 0));
        expect(gelesen.length).toBe(nachMeldung * 2);

        ws.follow(false);
        meldeWikiSync();
        await new Promise((fertig) => setTimeout(fertig, 0));
        expect(gelesen.length).toBe(nachMeldung * 2);
    });

    it("ein Hörer (das Fenster der Regeln) bekommt die Meldung bis zur Abmeldung", () => {
        let n = 0;
        const abmelden = hoereWikiSyncMeldung(() => {
            n += 1;
        });
        meldeWikiSync();
        meldeWikiSync();
        abmelden();
        meldeWikiSync();
        expect(n).toBe(2);
    });
});
