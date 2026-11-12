import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorLandscapeList, EditorPlaceList } from "@avesmaps3d/shared";
import { chooseView, EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { editorPanelVorn, GRATENFELS_LAGE, LISTE as ORTE, oeffneOrtseditor } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Umschalt-Klick auf der Karte in allen Editoren (Betreiber 2026-10-20, wörtlich: „umschalten soll eigentlich ermöglichen die einzelnen
 * objekte auf der karte zusätzlich auszuwählen“; Schnittstelle `map/mehrfach-markierung.ts`, `ziel` und `umschalteAufKarte`): Ein
 * Umschalt-Klick auf ein Objekt nimmt es in die Auswahl auf, ein zweiter nimmt es wieder heraus. Ist die Mehrfachauswahl aus, schaltet er
 * sie ein, und das bisher gewählte zählt mit. Bei den Gebieten seit 9db37c72b (`gebietseditor.spec.ts`), hier Orte, Landschaften, Gipfel
 * und Kraftlinien. Die Objekte kommen aus den Kacheln der lokalen Karte, die Listen aus Stubs. 🔴 Kein Test schreibt in die Datenbank.
 *
 * 🪤 Welches Objekt an einer Stelle gewählt wird, entscheidet der Besitzer mit seinem Fangradius, nicht `queryRenderedFeatures` an einem
 * Punkt (gemessen: ein Weg neben einer Fläche nahm den Klick, ein Nachbarort den Ort). Darum prüft ein gewöhnlicher Klick an jeder Stelle
 * zuerst, was dort gewählt wird; erst mit zwei so gefundenen Objekten folgt der Umschalt-Klick.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

interface Objekt {
    readonly at: { x: number; y: number };
    readonly id: string;
}

/** Ein Klick mit gedrücktem Umschalt, wie ihn ein Mensch macht (MapLibre beginnt den Rechteck-Zoom und bricht ihn ohne Zug ab). */
async function umschaltKlick(page: Page, at: { x: number; y: number }): Promise<void> {
    await page.keyboard.down("Shift");
    await page.mouse.click(at.x, at.y);
    await page.keyboard.up("Shift");
}

/**
 * Stellen mit gezeichneten Objekten dieser Ebenen, an denen die Leinwand obenauf liegt (Seitenkoordinaten), im Streifen zwischen Planer
 * und angedocktem Fenster (bei 1920 px rund 460 bis 860).
 */
async function stellen(page: Page, ebenen: readonly string[]): Promise<{ x: number; y: number }[]> {
    return page.evaluate((praefixe) => {
        const map = globalThis.avesmapsMap as unknown as {
            getStyle(): { layers?: { id: string }[] };
            getCanvas(): HTMLCanvasElement;
            queryRenderedFeatures(punkt: [number, number], optionen: { layers: string[] }): unknown[];
        };
        const ids = (map.getStyle().layers ?? [])
            .map((l) => l.id)
            .filter((id) => praefixe.some((p) => id === p || id.startsWith(`${p}-`)));
        const leinwand = map.getCanvas();
        const rahmen = leinwand.getBoundingClientRect();
        const gefunden: { x: number; y: number }[] = [];
        for (let y = 120; y < rahmen.height - 100; y += 24)
            for (let x = 460; x < 860; x += 24) {
                if (document.elementFromPoint(x, rahmen.top + y) !== leinwand) continue;
                if (map.queryRenderedFeatures([x - rahmen.left, y], { layers: ids }).length > 0)
                    gefunden.push({ x, y: rahmen.top + y });
            }
        return gefunden;
    }, ebenen);
}

/** Was nach einem gewöhnlichen Klick an der Stelle gewählt ist: Art und Kennung (eine Kraftlinie nennt ihren Anker). */
async function gewaehltNach(
    page: Page,
    at: { x: number; y: number },
): Promise<{ kind: string; id: string } | undefined> {
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    return page.evaluate(() => {
        const s = globalThis.avesmapsSelectedSubject?.() as { kind: string; id?: string; anchor?: string } | undefined;
        return s === undefined ? undefined : { kind: s.kind, id: s.id ?? s.anchor ?? "" };
    });
}

/** Zwei Stellen, an denen ein gewöhnlicher Klick zwei verschiedene Objekte dieser Art wählt. */
async function zweiObjekte(page: Page, ebenen: readonly string[], art: string): Promise<Objekt[]> {
    const gefunden: Objekt[] = [];
    for (const at of await stellen(page, ebenen)) {
        const wahl = await gewaehltNach(page, at);
        if (wahl?.kind !== art || wahl.id === "" || gefunden.some((g) => g.id === wahl.id)) continue;
        // Nur eine Stelle mit EINEM Objekt: Liegen dort mehrere, schaltet ein zweiter Klick zum nächsten weiter.
        if ((await gewaehltNach(page, at))?.id !== wahl.id) continue;
        gefunden.push({ at, id: wahl.id });
        if (gefunden.length === 2) return gefunden;
    }
    throw new Error(`keine zwei wählbaren Objekte der Art ${art} in ${ebenen.join(", ")}`);
}

/** Erwartet den Umschalter der Mehrfachauswahl an und die Zahl der Haken. */
async function haken(page: Page, liste: string, n: number): Promise<void> {
    // Im offenen Fenster: Ein abgelegtes Fenster trägt seine Liste weiter im DOM (gemessen: dessen Schalter stand aus).
    const offen = page.locator("dialog[open]");
    await expect(offen.locator(`[data-testid$="-${liste}-mehrfach"]`).first()).toHaveAttribute("aria-pressed", "true");
    await expect(offen.locator(`[data-testid$="-${liste}-haken"]`).first()).toContainText(`${String(n)} angehakt`);
}

/** A gewählt (gewöhnlicher Klick), dann Umschalt-Klick auf B: zwei angehakt; noch einmal: eins. */
async function nimmAufUndHeraus(page: Page, liste: string, paar: readonly Objekt[]): Promise<void> {
    const [a, b] = paar;
    expect((await gewaehltNach(page, a!.at))?.id).toBe(a!.id);
    await umschaltKlick(page, b!.at);
    await haken(page, liste, 2);
    // Zwei Klicks am selben Fleck binnen 400 ms sind ein Doppelklick (`object-dblclick`, gemessen bei den Kraftlinien).
    await page.waitForTimeout(500);
    await umschaltKlick(page, b!.at);
    await haken(page, liste, 1);
}

test("🔴 Orte: Umschalt-Klick auf der Karte nimmt einen Ort zur gewählten auf und wieder heraus", async ({ page }) => {
    const liste: EditorPlaceList = { ...ORTE, rows: ORTE.rows.filter((row) => row.origin === "karte") };
    await oeffneOrtseditor(page, { liste, verb: false });
    await showPlace(page, GRATENFELS_LAGE, 7);
    await settleFrame(page);
    // Alle gezeichneten Orte in die Liste, bevor das Fenster sie liest: Welcher Ort an einer Stelle gewählt wird, sagt erst der Klick.
    const gezeichnet = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getStyle(): { layers?: { id: string }[] };
            queryRenderedFeatures(o: { layers: string[] }): { properties: Record<string, unknown> }[];
        };
        const ebenen = (map.getStyle().layers ?? []).map((l) => l.id).filter((id) => id.startsWith("place-"));
        const je = new Map<string, string>();
        for (const f of map.queryRenderedFeatures({ layers: ebenen })) {
            const id = String(f.properties["public_id"] ?? "");
            if (id !== "" && !je.has(id)) je.set(id, String(f.properties["name"] ?? "Ort"));
        }
        return [...je];
    });
    for (const [id, name] of gezeichnet)
        if (!liste.rows.some((row) => row.key === id))
            liste.rows.push({
                key: id,
                origin: "karte",
                name,
                circle: "voll",
                assignment: "assigned",
                subtype: "dorf",
                x: GRATENFELS_LAGE.x,
                y: GRATENFELS_LAGE.y,
            });
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator('dialog[data-lage][open][data-testid^="ortseditor-"]')).toHaveCount(1);
    await nimmAufUndHeraus(page, "orte", await zweiObjekte(page, ["place-marker"], "place"));
});

/** Der Editor-Modus der Landschaften mit Stubs. */
async function oeffneLandschaften(
    page: Page,
    liste: EditorLandscapeList,
    ebene: string,
    lage = { x: 450, y: 560, z: 6.5 },
): Promise<void> {
    await stubAdmin(page, {
        capabilities: [
            "use_editor_menu",
            "edit_map_objects",
            "edit_map_geometry",
            "edit_territories",
            "edit_landscapes",
            "edit_territory_form",
            "edit_landscape_form",
            "edit_mountains",
        ],
        role: "editor",
    });
    await page.route("**/api/editor/status", (route) => json(route, { mapEditing: "testwelt" }));
    await page.route("**/api/editor/landscapes", (route) => json(route, liste));
    await page.route(/\/api\/editor\/landscapes\/[^/?]+(\?.*)?$/, (route) => {
        const id = /landscapes\/([^/?]+)/.exec(route.request().url())?.[1] ?? "";
        return json(route, {
            id,
            name: "Probe",
            layer: "vegetation",
            circle: "voll",
            order: 1,
            clickLocked: false,
            areas: [],
            labels: [],
            neighbors: [],
            revision: 1,
        });
    });
    // Ein Gipfel öffnet sein Fenster mit dem Detail (wie `landschaftseditor-gipfel.spec.ts`).
    await page.route(/\/api\/editor\/peaks\/[0-9a-f-]{36}$/, (route) => {
        const id = route.request().url().split("/").at(-1)!;
        return json(route, {
            id,
            name: "Probezinne",
            subtype: "berggipfel",
            showName: true,
            position: [lage.x, lage.y],
            revision: 1,
        });
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release))?(\?.*)?$/, (route) =>
        route.request().method() === "GET" ? json(route, { locks: [] }) : json(route, { lost: [] }),
    );
    await page.goto(
        `${EDITOR_MODE}#x=${String(lage.x)}&y=${String(lage.y)}&z=${String(lage.z)}&series=original&view=landscapes&layer=${ebene}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

/** Das Fenster der Landschaften offen, dann die Stelle in die freie Fläche daneben: Dort suchen und klicken die Fälle. */
async function fensterOffen(page: Page, stelle: { x: number; y: number }, zoom: number): Promise<void> {
    await page.getByTestId("editorpanel-kachel-regionen").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator('dialog[data-lage][open][data-testid^="landschaftseditor-"]')).toHaveCount(1);
    await showPlace(page, stelle, zoom);
    await settleFrame(page);
}

test("🔴 Landschaften: Umschalt-Klick auf eine zweite Fläche schaltet die Mehrfachauswahl ein, die gewählte zählt mit", async ({
    page,
}) => {
    await oeffneLandschaften(page, { rows: [] }, "vegetation");
    await fensterOffen(page, { x: 450, y: 560 }, 6.5);
    await nimmAufUndHeraus(page, "landschaften", await zweiObjekte(page, ["landscape-fill"], "area"));
});

test("🔴 Gipfel: Umschalt-Klick auf einen zweiten Gipfel nimmt ihn auf und wieder heraus", async ({ page }) => {
    // Ein Gipfelfeld im Kosch (wie `landschaftseditor-gipfel.spec.ts`).
    await oeffneLandschaften(page, { rows: [], peaks: [] }, "topographie", { x: 467, y: 545, z: 6 });
    await fensterOffen(page, { x: 467, y: 545 }, 6);
    await nimmAufUndHeraus(page, "landschaften", await zweiObjekte(page, ["gipfel"], "peak"));
});

/** Die Bögen stehen und haben ein Bild gezeigt: Erst danach rechnet ein Klick an ihnen (`avesmapsPowerlineArcs.hit`), vorher an den Kacheln. */
async function bogenStehen(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const bogen = (
                globalThis as unknown as { avesmapsPowerlineArcs?: { state(): { ready: boolean; active: boolean } } }
            ).avesmapsPowerlineArcs?.state();
            return bogen?.ready === true && bogen.active;
        },
        undefined,
        { timeout: 30_000 },
    );
    await settleFrame(page);
}

/**
 * 🪤 Zwei Quellen von Zufall, beide gemessen (WI-0248, Release-Lauf f80bb5c83; im Wiederholungslauf waren 3 von 6 rot, mit den Änderungen unten 8 von 8 grün, und
 * die Treffer der Bögen waren in 6 Wiederholungen Punkt für Punkt dieselben):
 *
 * 1. **Die Bögen schwingen.** Ein Klick rechnet an den GEZEICHNETEN Bögen, mit ihrer Welle zur Zeit des letzten Bildes (`powerline-arcs.ts`, `arcHits`:
 *    „Gesehen ist das, was gezeichnet wurde“), die Stellen dieses Falls kommen aus den geraden Trefferflächen der Kacheln. Am selben Punkt lag der nächste
 *    Faden mal 0,1, mal 9,6 Bildpunkte entfernt, und der Klick wählte mal die Linie, mal nichts (ein Klick ins Leere hebt die Auswahl auf). „Bewegung
 *    reduzieren“ hält die Zeit der Bögen auf 0 (`ruhig()`): dieselbe Stelle trifft immer oder nie. Der Fall prüft den Umschalt-Klick, nicht die Bewegung.
 * 2. **Die Kennung der Auswahl wechselt.** Ein Klick wählt mit dem Anker des Segments; die Antwort des Servers löst zur Gruppe auf und tauscht ihn aus
 *    (`subject-selection.ts`, `settle`). Sie kam je nach Last nach 0,5 bis 1,1 s, der Fall las nach 0,5 s: dieselbe Stelle lieferte zwei Kennungen. Die Antwort
 *    kommt hier vom Test, sofort und mit demselben Anker.
 */
test("🔴 Kraftlinien: Umschalt-Klick auf eine zweite Linie nimmt sie zur gewählten auf und wieder heraus", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubAdmin(page, { capabilities: ["use_editor_menu"], role: "reviewer" });
    // Die Liste nennt die gezeichneten Linien (wie `mehrfach-markierung-kraftlinien.spec.ts`), damit der Umschalter in einer Liste steht.
    let linien: { id: string; name: string }[] = [];
    await page.route("**/api/editor/powerlines", (route) =>
        json(route, { rows: linien.map((l) => ({ ...l, circle: "voll", shape: "strang", segments: 1, nodes: 2 })) }),
    );
    await page.route("**/api/subjects/powerline/*", (route) => {
        const anker = /\/powerline\/([^/?]+)/u.exec(route.request().url())?.[1] ?? "";
        return json(route, {
            subject: { kind: "powerline", anchor: anker },
            revision: "abcdefabcdef",
            title: linien.find((linie) => linie.id === anker)?.name ?? "Kraftlinie",
        });
    });
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await chooseView(page, "powerlines");
    await showPlace(page, { x: 551.625, y: 532.969 }, 6);
    await settleFrame(page);
    await bogenStehen(page);
    linien = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            queryRenderedFeatures(o: { layers: string[] }): { properties: Record<string, unknown> }[];
        };
        const je = new Map<string, string>();
        for (const f of map.queryRenderedFeatures({ layers: ["powerline-hit"] }))
            je.set(String(f.properties["public_id"]), String(f.properties["name"] ?? "Linie"));
        return [...je].map(([id, name]) => ({ id, name }));
    });
    await page.getByTestId("editorpanel-kachel-kraftlinien").click();
    await page.getByTestId("editorpanel-verb").click();
    await expect(page.locator('dialog[data-lage][open][data-testid^="kraftlinieneditor-"]')).toHaveCount(1);
    await nimmAufUndHeraus(page, "linien", await zweiObjekte(page, ["powerline-hit"], "powerline"));
});
