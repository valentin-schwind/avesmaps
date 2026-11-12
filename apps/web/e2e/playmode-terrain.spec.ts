import { expect, test } from "@playwright/test";
import "./map-handle";

/** Was dieser Test zusätzlich von der Karte braucht: Gelände und die Höhe der Kameramitte. */
type TerrainHandle = { getTerrain(): unknown; getCenterElevation(): number };

/**
 * Der Playmode über Gelände (WI-0053, Betreiber 2026-09-27: „Höhe auch weich“). MapLibre setzt die
 * Kameramitte sonst in jedem Bild auf den Boden; über dem Kamm zwischen Greifenfurt und Lowangen sprang der
 * Pfeil dabei 68 px auf und ab, am Ende binnen einer Viertelsekunde. Jetzt hält die Kamera die Höhe des Bodens
 * unter dem Pfeil, weich nachgeführt: Der Pfeil wandert noch (auf 60° geneigt rund 54 px), aber langsam.
 * Gemessen wird deshalb das Tempo, nicht der Weg.
 *
 * 🪤 Mit Gelände rechnet headless SwiftShader rund 7× langsamer (WI-0049 S4). Die Grafikkarte über ANGLE
 * bringt 60 Bilder je Sekunde; fehlt sie, läuft der Test langsamer, misst aber nach Zeit dasselbe.
 */
test.use({ launchOptions: { args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"] } });

test("🔴 über dem Kamm hüpft der Pfeil nicht: die Kamera hält die Höhe weich", async ({ page, request }) => {
    test.setTimeout(90_000);
    const pointer = await request.get("/tiles/terrain/dem/current.json");
    test.skip(pointer.status() === 404, "Kein Gelände abgeleitet - erst `npm run derive:terrain`.");
    await page.goto("/?route=Greifenfurt~Lowangen");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    await expect(page.getByTestId("route-player")).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 10_000 });
    await page.getByTestId("camera-view-3d").click();
    await page.waitForFunction(
        () => (globalThis.avesmapsMap as unknown as TerrainHandle | undefined)?.getTerrain() != null,
        undefined,
        { timeout: 10_000 },
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false, undefined, { timeout: 5000 });
    await page.getByTestId("player-play").click();
    // Der Kamm liegt in Sekunde 11 bis 17 der Wiedergabe (Satz vom 2026-09-27).
    const frames = await page.evaluate(
        () =>
            new Promise<{ time: number; y: number; height: number }[]>((resolve) => {
                const map = globalThis.avesmapsMap as unknown as TerrainHandle;
                const traveler = (globalThis as unknown as { avesmapsTraveler?: { drawn(): { y: number } | null } })
                    .avesmapsTraveler;
                const seen: { time: number; y: number; height: number }[] = [];
                let start: number | undefined;
                const frame = (time: number): void => {
                    start ??= time;
                    const arrow = traveler?.drawn() ?? null;
                    if (time - start >= 10_000 && arrow)
                        seen.push({ time, y: arrow.y, height: map.getCenterElevation() });
                    if (time - start < 18_000) requestAnimationFrame(frame);
                    else resolve(seen);
                };
                requestAnimationFrame(frame);
            }),
    );
    expect(frames.length).toBeGreaterThan(5);
    // Ohne Gelände unter dem Kamm wäre der Test grün, ohne etwas zu prüfen.
    expect(Math.max(...frames.map((frame) => frame.height)), "die Kamera stand über Gelände").toBeGreaterThan(5000);
    // Das Tempo des Pfeils auf dem Schirm, je über mindestens 100 ms - so misst es bei 60 wie bei 5 Bildern je Sekunde.
    let fastest = 0;
    frames.forEach((from, index) => {
        const to = frames.slice(index + 1).find((frame) => frame.time - from.time >= 100);
        if (to) fastest = Math.max(fastest, (Math.abs(to.y - from.y) * 1000) / (to.time - from.time));
    });
    expect(fastest, `Pfeil höchstens ${fastest.toFixed(0)} px/s auf oder ab`).toBeLessThan(120);
});
