import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLock } from "@avesmaps3d/shared";
import { chooseView, EDITOR_MODE, GARETH, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS_LAGE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Fremde Sperren an Linien (WI-0205 K11, Anzeige; Kopf `sperren-an-linien-schnittstelle.md`, mit Wege und Kraftlinien abgestimmt): Ein
 * zweites Konto („Thomas“) hält einen Weg und eine Kraftlinie; das erste sieht das Schild, die Spur und im Kartenmenü denselben Kasten wie
 * an Flächen, als Admin mit „Aufheben“. Wege und Kacheln kommen echt von der Karte, Sperren und Rechte aus dem Stub.
 *
 * Problemfälle: Ein gesperrter Weg oder eine gesperrte Kraftlinie zeigt weder Schild noch Kasten; ein Klick auf einen anderen Abschnitt
 * der Kraftlinie als den Anker findet die Sperre nicht; „Wegkurve bearbeiten“ geht, obwohl ein anderer den Abschnitt hält.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

interface Server {
    wege: EditorLock[];
    linien: EditorLock[];
    aufgehoben: { kind: string; id: string }[];
}

async function stubs(page: Page): Promise<Server> {
    const server: Server = { wege: [], linien: [], aufgehoben: [] };
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "manage_people",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
    });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET")
            return json(route, 200, {
                locks: url.includes("kind=path") ? server.wege : url.includes("kind=powerline") ? server.linien : [],
            });
        if (url.includes("/lift")) {
            server.aufgehoben.push(route.request().postDataJSON() as { kind: string; id: string });
            server.wege = [];
            server.linien = [];
            return route.fulfill({ status: 204 });
        }
        return json(route, 200, { lost: [] });
    });
    return server;
}

/** Die Sperre von Thomas an einer Linie; `at` ist der Punkt des Schilds (MCS). */
const sperre = (
    kind: "path" | "powerline",
    id: string,
    sections: string[],
    at: { x: number; y: number },
): EditorLock => ({
    kind,
    id,
    part: "form",
    person: { id: "d1d1d1d1-0000-4000-8000-0000000000f1", name: "Thomas" },
    since: new Date(Date.now() - 9 * 60_000).toISOString(),
    heartbeatAt: new Date().toISOString(),
    own: false,
    at,
    sections,
});

/** Der Kartenpunkt (MCS) unter einer Bildschirmstelle. */
async function mcsAm(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
    return page.evaluate(
        ([sx, sy]) => {
            const map = globalThis.avesmapsMap!;
            const box = map.getCanvas().getBoundingClientRect();
            const projektion = (
                globalThis as unknown as {
                    avesmapsRenderProjection: {
                        fromRenderLngLat(lngLat: { lng: number; lat: number }): { x: number; y: number };
                    };
                }
            ).avesmapsRenderProjection;
            return projektion.fromRenderLngLat(map.unproject([sx! - box.left, sy! - box.top]));
        },
        [x, y],
    );
}

/** Eine Stelle auf einem gezeichneten Weg, von der Mitte aus gesucht, samt der Kennung seines Abschnitts (wie `wegeditor-wegkurve`). */
async function wegStelle(page: Page): Promise<{ x: number; y: number; id: string }> {
    const gefunden = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const ids = (map.getStyle().layers ?? []).map((layer) => layer.id).filter((id) => id.startsWith("path-hit-"));
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        const rahmen = map.getCanvas().getBoundingClientRect();
        for (let r = 0; r < 300; r += 6)
            for (let w = 0; w < 360; w += 20) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const f = map.queryRenderedFeatures([x, y], { layers: ids })[0];
                const id = f?.properties["public_id"] ?? f?.id;
                if (typeof id === "string") return { x: rahmen.left + x, y: rahmen.top + y, id };
            }
        return undefined;
    });
    expect(gefunden, "eine Stelle auf einem Weg").toBeDefined();
    return gefunden!;
}

/** Eine Stelle auf genau EINER Kraftlinie (die Bögen, `hit`), an einem Abschnitt, der nicht der Anker ist (wie `kraftlinie-kartenmenue`). */
async function stelleAufLinie(page: Page): Promise<{ x: number; y: number; abschnitt: string; anker: string }> {
    await page.waitForFunction(
        () =>
            (
                globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { ready: boolean; active: boolean } } }
            ).avesmapsPowerlineArcs?.state().ready === true,
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
    const ankerVon = await page.evaluate(async () => {
        const netz = (await (await fetch("/api/powerlines")).json()) as { lines: { id: string; name: string }[] };
        const gruppe = (l: { id: string; name: string }) => (l.name.trim() === "" ? `#${l.id}` : l.name);
        const anker = new Map<string, string>();
        for (const l of netz.lines) {
            const bisher = anker.get(gruppe(l));
            if (bisher === undefined || l.id < bisher) anker.set(gruppe(l), l.id);
        }
        return Object.fromEntries(netz.lines.map((l) => [l.id, anker.get(gruppe(l))!]));
    });
    const stelle = await page.evaluate((ankerVon) => {
        const map = globalThis.avesmapsMap!;
        const arcs = (
            globalThis as unknown as {
                avesmapsPowerlineArcs: {
                    hit(
                        punkt: { x: number; y: number },
                        reichweite: number,
                    ): { id: string; name: string }[] | undefined;
                };
            }
        ).avesmapsPowerlineArcs;
        const rahmen = map.getCanvas().getBoundingClientRect();
        const knoten = map.queryRenderedFeatures({ layers: ["nodix-treffer"] }).map((f) => {
            const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
            return map.project({ lng, lat });
        });
        const linien = (treffer: { id: string; name: string }[] | undefined) =>
            new Set((treffer ?? []).map((t) => (t.name.trim() === "" ? t.id : t.name)));
        for (let y = 200; y < rahmen.height - 450; y += 7)
            for (let x = 520; x < rahmen.width - 720; x += 7) {
                if (knoten.some((k) => Math.hypot(k.x - x, k.y - y) < 30)) continue;
                const nah = arcs.hit({ x, y }, 3);
                if (linien(nah).size !== 1 || linien(arcs.hit({ x, y }, 14)).size !== 1) continue;
                const getroffen = nah![0]!;
                if (ankerVon[getroffen.id] === getroffen.id) continue;
                return {
                    x: rahmen.left + x,
                    y: rahmen.top + y,
                    abschnitt: getroffen.id,
                    anker: ankerVon[getroffen.id] ?? getroffen.id,
                };
            }
        return undefined;
    }, ankerVon);
    if (stelle === undefined) throw new Error("keine Stelle auf genau einer Kraftlinie im Bild");
    return stelle;
}

const kasten = (page: Page) => page.getByTestId("context-editor-sperre-objekt");

test("🔴 ein Weg, den ein anderer bearbeitet: Schild und Spur auf der Karte, Kasten im Kartenmenü, Wegkurve gesperrt, Aufheben", async ({
    page,
}) => {
    const server = await stubs(page);
    await openMap(page, EDITOR_MODE);
    // Neben Gratenfels wie die Wege-Spec: in der Mitte liegt ein Weg, kein Ort (dessen Marke ginge dem Weg im Menü vor).
    await showPlace(page, { x: GRATENFELS_LAGE.x + 6, y: GRATENFELS_LAGE.y + 2 }, 7);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    const stelle = await wegStelle(page);
    server.wege = [sperre("path", stelle.id, [stelle.id], await mcsAm(page, stelle.x, stelle.y))];

    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await expect(kasten(page)).toContainText("🔒 Thomas bearbeitet die Form seit");
    await expect(page.getByTestId("context-editor-weg-wegkurve")).toBeDisabled();
    const schild = page.getByTestId("sperre-schild");
    await expect(schild).toBeVisible();
    await expect(schild).toContainText("🔒 Thomas · Form · seit");
    // Die Stelle liegt auf der breiten Trefferfläche des Wegs; die Spur ist schmaler: ein kleiner Kasten um die Stelle.
    await expect
        .poll(
            () =>
                page.evaluate(
                    ([x, y]) => {
                        const map = globalThis.avesmapsMap!;
                        const box = map.getCanvas().getBoundingClientRect();
                        const [px, py] = [x! - box.left, y! - box.top];
                        return map.queryRenderedFeatures(
                            [
                                [px - 12, py - 12],
                                [px + 12, py + 12],
                            ],
                            { layers: ["editor-sperre-weg"] },
                        ).length;
                    },
                    [stelle.x, stelle.y],
                ),
            { message: "die gestrichelte Spur liegt auf dem Weg" },
        )
        .toBeGreaterThan(0);
    await page.screenshot({ path: "test-results/sperre-weg.png" });

    await page.getByTestId("context-editor-sperre-objekt-aufheben").click();
    await page.getByTestId("context-editor-sperre-objekt-ja").click();
    await expect.poll(() => server.aufgehoben).toEqual([{ kind: "path", id: stelle.id }]);
    await expect(schild).toHaveCount(0);
});

test("🔴 eine Kraftlinie, die ein anderer bearbeitet: Ein Klick auf einen anderen Abschnitt als den Anker zeigt den Kasten, Schild in der Ansicht", async ({
    page,
}) => {
    const server = await stubs(page);
    await openMap(page, EDITOR_MODE);
    await chooseView(page, "powerlines");
    await showPlace(page, GARETH, 4);
    const stelle = await stelleAufLinie(page);
    server.linien = [
        sperre("powerline", stelle.anker, [stelle.anker, stelle.abschnitt], await mcsAm(page, stelle.x, stelle.y)),
    ];

    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await expect(kasten(page)).toContainText("🔒 Thomas bearbeitet die Form seit");
    await expect(page.getByTestId("sperre-schild")).toBeVisible();
    // Die Spur liegt auf der Bodenbahn der Abschnitte (unter den Bögen).
    expect(
        await page.evaluate(() => JSON.stringify(globalThis.avesmapsMap!.getFilter("editor-sperre-kraftlinie"))),
    ).toContain(stelle.abschnitt);
    await page.screenshot({ path: "test-results/sperre-kraftlinie.png" });
});
