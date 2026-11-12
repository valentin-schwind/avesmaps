import { expect, test, type Page } from "@playwright/test";
import { GARETH, openMap, settleFrame } from "./map-handle.ts";

/**
 * Hängende Kacheln nach einer 503-Welle (Stage 2026-10-19, Thomas 4.2: „Aktuell können keine neuen Landschaftsflächen erstellt werden“;
 * `map/edit-revision.ts`, `loeseHaengendeKacheln`). MapLibre 6.10 setzt eine gescheiterte Kachel bei `setTiles` auf „loading“ und wartet
 * dann auf eine Anfrage, die längst vorbei ist: Die Kachel bleibt leer, die Karte gilt nie als geladen, und „Neue Fläche“ wartete ewig
 * auf `idle`. Problemfälle: Die Falle tritt nicht auf (dann prüft der Fall nichts); die Lösung greift nicht; sie lädt Kacheln, die nur
 * unterwegs sind; nach einer kurzen Welle ohne Wechsel bleiben Kacheln leer (`map/kachel-wiederholung.ts`).
 */
const QUELLE = "places";

interface Innen {
    style: {
        tileManagers: Record<
            string,
            { _inViewTiles: { getAllTiles(): { state: string; abortController?: unknown; reloadPromise?: unknown }[] } }
        >;
    };
    loaded(): boolean;
    jumpTo(options: { center: { lng: number; lat: number }; zoom: number }): void;
}

/** Die Zustände der Kacheln der Quelle, „haengt“ = wartet auf eine vergangene Anfrage. */
async function zustaende(page: Page): Promise<Record<string, number>> {
    return page.evaluate((quelle) => {
        const map = globalThis.avesmapsMap as unknown as Innen;
        const zaehler: Record<string, number> = {};
        for (const kachel of map.style.tileManagers[quelle]?._inViewTiles.getAllTiles() ?? []) {
            const art =
                kachel.state === "loading" && kachel.abortController === undefined && kachel.reloadPromise
                    ? "haengt"
                    : kachel.state;
            zaehler[art] = (zaehler[art] ?? 0) + 1;
        }
        return zaehler;
    }, QUELLE);
}

test("🔴 nach einer 503-Welle und dem nächsten Revisionswechsel hängt keine Kachel, und die Karte kommt zur Ruhe", async ({
    page,
}) => {
    await openMap(page);
    await settleFrame(page);
    // Die Welle: Jede Vektorkachel scheitert, während die Karte neue anfragt.
    await page.route("**/tiles/vector/**", (route) => route.fulfill({ status: 503, body: "" }));
    await page.evaluate((punkt) => {
        const map = globalThis.avesmapsMap as unknown as Innen;
        map.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt), zoom: 5 });
    }, GARETH);
    await expect.poll(async () => (await zustaende(page))["errored"] ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.unroute("**/tiles/vector/**");

    // Der nächste Wechsel (eine Operation irgendwo): ohne Lösung bleiben die gescheiterten Kacheln für immer „loading“.
    await page.evaluate(() => {
        const revision = (
            globalThis as unknown as {
                avesmapsEditRevision: { current: number; advance(map: unknown, revision: number): boolean };
            }
        ).avesmapsEditRevision;
        revision.advance(globalThis.avesmapsMap, revision.current + 1);
    });
    await page.waitForTimeout(400);
    expect((await zustaende(page))["haengt"] ?? 0, "die Falle von MapLibre tritt auf").toBeGreaterThan(0);

    // Die Nachschau löst sie: keine hängt mehr, alle sind geladen, die Karte meldet sich geladen.
    await expect.poll(async () => (await zustaende(page))["haengt"] ?? 0, { timeout: 10_000 }).toBe(0);
    await expect
        .poll(() => page.evaluate(() => (globalThis.avesmapsMap as unknown as Innen).loaded()), { timeout: 20_000 })
        .toBe(true);
});

test("🔴 nach einer kurzen 503-Welle ohne Revisionswechsel füllt sich die Karte von selbst wieder (Wiederholung, Claudio 2026-10-19)", async ({
    page,
}) => {
    await openMap(page);
    await settleFrame(page);
    // Wie beim Neustart der Anmeldetür: einige Sekunden lang 503 für jede Vektorkachel, danach wieder Antworten.
    await page.route("**/tiles/vector/**", (route) =>
        route.fulfill({ status: 503, body: "", headers: { "Retry-After": "2" } }),
    );
    await page.evaluate((punkt) => {
        const map = globalThis.avesmapsMap as unknown as Innen;
        map.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt), zoom: 5 });
    }, GARETH);
    await expect.poll(async () => (await zustaende(page))["errored"] ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.unroute("**/tiles/vector/**");

    // Ohne Wiederholung blieben sie leer, bis jemand die Karte bewegt; mit ihr sind sie nach wenigen Sekunden geladen.
    await expect.poll(async () => (await zustaende(page))["errored"] ?? 0, { timeout: 15_000 }).toBe(0);
    await expect
        .poll(() => page.evaluate(() => (globalThis.avesmapsMap as unknown as Innen).loaded()), { timeout: 20_000 })
        .toBe(true);
});
