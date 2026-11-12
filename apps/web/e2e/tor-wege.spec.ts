import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
    PathCreateReceipt,
    PathUpdateReceipt,
    type EditorPathDetail,
    type EditorPathRow,
    type PathCreateBody,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { editorPanelGemerktZu } from "./ortseditor-stub.ts";
import { hebeSperrenAuf } from "./tor-hilfen.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn, type Beobachtung } from "./welt.ts";

/**
 * Release-Tor, Kernabläufe 13 und 14: Wege, gegen den ECHTEN Server des Kandidaten (WI-0264, `release-tor.json`). Kein `page.route` auf
 * `/api`: Orte, Andockziele, Anlegen, Stützpunkte und Sperren kommen aus der Datenbank des Laufs (Testpaket, echte Legacy-Orte). Ablauf 15
 * („Weg entfernen, ↺“) ist `wegeditor-echt.spec.ts`.
 *
 * Jeder Schreibfall belegt das Ergebnis doppelt: Die Antwort des Servers ist 200 und eine frische Lesung zeigt die Folge.
 */

declare global {
    /** Die Steuerung der Wegkurve (nur Entwicklung, `app.vue`). */
    var avesmapsWegkurve:
        { starte(publicId: string): Promise<void>; laufend: { value: { publicId: string } | undefined } } | undefined;
}

test.use({ viewport: { width: 1920, height: 1080 } });

/** Zwei echte Kleinstädte ohne Straße dazwischen (Legacy-Orte des Testpakets), rund neun Karteneinheiten auseinander. */
const PERI = { x: 428.57, y: 66.54 };
const VAHYT = { x: 436.95, y: 63.63 };
/** Eine leere Stelle im Meer (wie `ortseditor-setzen.spec.ts`): Dort liegt kein Weg, an dem ein Stützpunkt einrasten könnte. */
const MEER = { x: 120, y: 520 };

function keinFehler(beob: Beobachtung): void {
    expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
}

/** Ein Kartenpunkt in Seitenkoordinaten, über die Projektion der Darstellung. */
async function aufSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(pt));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

/** Der Weg, wie der echte Server ihn dem Wegeditor liest. */
async function wegLesen(page: Page, id: string): Promise<EditorPathDetail> {
    const antwort = await page.request.get(`/api/editor/paths/${id}`);
    expect(antwort.status(), `GET /api/editor/paths/${id}: ${await antwort.text()}`).toBe(200);
    return (await antwort.json()) as EditorPathDetail;
}

test.describe("Tor: Wege", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    // Sperren überleben das Ende eines Falls (ein geschlossener Browser gibt nichts frei): jeder Fall beginnt und endet ohne.
    test.beforeEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));
    test.afterEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));

    test("13 einen neuen Weg zwischen zwei Orten zeichnen", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        // Das Infopanel eines Orts soll vorn stehen, nicht das Editorpanel.
        await editorPanelGemerktZu(page);
        await meldeAn(page);
        await openMap(page, EDITOR_MODE);
        await showPlace(page, { x: (PERI.x + VAHYT.x) / 2, y: (PERI.y + VAHYT.y) / 2 }, 8);
        await settleFrame(page);

        // Ein Klick auf den ersten Ort, im Infopanel „Neuer Weg ab hier“.
        const start = await aufSeite(page, PERI);
        await page.mouse.click(start.x, start.y);
        await expect(page.getByTestId("info-title")).toHaveText("Peri", { timeout: 30_000 });
        await page.getByTestId("griff-weg-neu").click();
        const leiste = page.getByTestId("neuer-weg-leiste");
        await expect(leiste).toBeVisible();
        await expect(leiste).toContainText("ab Peri");

        // Ein Zwischenpunkt auf freier Fläche, dann der Klick am zweiten Ort beendet den Weg und schreibt EINE Operation.
        const mitte = await aufSeite(page, { x: (PERI.x + VAHYT.x) / 2, y: PERI.y - 2 });
        await page.mouse.click(mitte.x, mitte.y);
        await expect(page.getByTestId("neuer-weg-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        const ziel = await aufSeite(page, VAHYT);
        await page.mouse.move(ziel.x - 2, ziel.y + 3, { steps: 4 });
        await expect(page.getByTestId("anlegen-schild")).toContainText("Weg hier abschließen", { timeout: 30_000 });
        const [antwort] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith("/api/editor/paths") && r.request().method() === "POST"),
            page.mouse.click(ziel.x - 2, ziel.y + 3),
        ]);
        expect(antwort.status(), await antwort.text()).toBe(200);
        const beleg = vertragGilt(PathCreateReceipt, await antwort.json(), "Die Quittung des echten Servers");
        // Der Server hat beide Enden an die Orte gehängt.
        expect(beleg.ends.start).toMatchObject({ kind: "place", name: "Peri" });
        expect(beleg.ends.end).toMatchObject({ kind: "place", name: expect.stringMatching(/^V.hyt$/) as unknown });
        await expect(page.getByTestId("toast")).toContainText("Neuer Weg angelegt");
        await expect(leiste).toBeHidden();

        // Eine frische Lesung des echten Servers kennt den Weg mit drei Stützpunkten und denselben Enden.
        const gelesen = await wegLesen(page, beleg.publicId);
        expect(gelesen.name).toBe(beleg.name);
        expect(gelesen.points).toHaveLength(3);
        expect(gelesen.active).toBe(true);
        expect(gelesen.ends.start).toMatchObject({ kind: "place", name: "Peri" });
        const liste = (await (await page.request.get("/api/editor/paths")).json()) as { rows: EditorPathRow[] };
        expect(liste.rows.some((zeile) => zeile.id === beleg.publicId)).toBe(true);
        keinFehler(beob);
    });

    test("14 einen Stützpunkt eines Wegs verschieben und speichern", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await meldeAn(page);
        // Der Weg entsteht über den Server (Vorbereitung), die Bearbeitung ist der Fall: ein freier Weg im Meer, an dem nichts mitzieht.
        const punkte = [
            { x: MEER.x - 8, y: MEER.y },
            { x: MEER.x - 3, y: MEER.y + 4 },
            { x: MEER.x + 3, y: MEER.y },
            { x: MEER.x + 8, y: MEER.y + 4 },
        ];
        const body: PathCreateBody = { operationId: randomUUID(), points: punkte };
        const angelegt = await page.request.post("/api/editor/paths", {
            headers: { origin: new URL(page.url()).origin },
            data: body,
        });
        expect(angelegt.status(), await angelegt.text()).toBe(200);
        const weg = vertragGilt(PathCreateReceipt, await angelegt.json(), "Die Quittung des echten Servers");
        const vorher = await wegLesen(page, weg.publicId);

        await openMap(page, EDITOR_MODE);
        await showPlace(page, MEER, 8);
        await settleFrame(page);
        // Rechtsklick auf den Weg › „Wegkurve bearbeiten“ startet den Modus am Abschnitt unter dem Zeiger. Liegt eine Wiederholung auf dem
        // Weg des ersten Versuchs, laufen dort zwei Wege (T25): Dann wählt der Fall den eigenen im Untermenü.
        const stelle = await aufSeite(page, punkte[1]!);
        await page.mouse.click(stelle.x, stelle.y, { button: "right" });
        await expect(page.getByTestId("context-editor")).toBeVisible({ timeout: 30_000 });
        if ((await page.getByTestId("context-editor-kopf-wege").count()) > 0) {
            await page.getByTestId(`context-editor-weg-path:${weg.publicId}`).hover();
            await page.getByTestId(`context-editor-path:${weg.publicId}|weg-wegkurve`).click();
        } else {
            const eintrag = page.getByTestId("context-editor-weg-wegkurve");
            await expect(eintrag).toBeEnabled({ timeout: 30_000 });
            await eintrag.click();
        }
        await expect(page.getByTestId("wegkurve-leiste")).toBeVisible({ timeout: 30_000 });
        await expect
            .poll(() => page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId), { timeout: 30_000 })
            .toBe(weg.publicId);
        // Das Fenster der Straße ist aufgegangen; die Karte neben es rücken, dann den zweiten Stützpunkt greifen.
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await showPlace(page, MEER, 8);
        await settleFrame(page);
        await page.waitForFunction(
            () =>
                (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }) ?? []).some(
                    (f) => f.properties["index"] === 1,
                ),
            undefined,
            { timeout: 30_000 },
        );
        const griff = await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const punkt = map
                .queryRenderedFeatures({ layers: ["geometrie-anfasser"] })
                .find((f) => f.properties["index"] === 1)!;
            const [lng, lat] = punkt.geometry.coordinates;
            const bild = map.project({ lng, lat });
            const rahmen = map.getCanvas().getBoundingClientRect();
            return { x: rahmen.left + bild.x, y: rahmen.top + bild.y };
        });
        await page.mouse.move(griff.x, griff.y);
        await page.mouse.down();
        await page.mouse.move(griff.x + 40, griff.y - 30, { steps: 8 });
        // Unter Last zeichnet die Karte den Zug in Bildern nach: erst loslassen, wenn der Griff am Ziel steht.
        await settleFrame(page);
        await page.mouse.up();
        // Das Loslassen schreibt nichts: Der Zug ist ein Schritt im Entwurf, erst „Fertig“ schreibt (EDIT-0003 G4).
        await expect(page.getByTestId("wegkurve-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => /\/api\/editor\/paths\/[0-9a-f-]{36}\/update$/.test(r.url()) && r.request().method() === "POST",
            ),
            page.getByTestId("wegkurve-leiste-fertig").click(),
        ]);
        // Der Server nimmt EINE Operation an.
        expect(antwort.status(), await antwort.text()).toBe(200);
        const beleg = vertragGilt(PathUpdateReceipt, await antwort.json(), "Die Quittung des echten Servers");
        const neu = beleg.affected.find((e) => e.kind === "path" && e.id === weg.publicId);
        expect(neu?.revision, "die Revision des Wegs steigt").toBeGreaterThan(vorher.revision);
        await expect(page.getByTestId("wegkurve-leiste")).toHaveCount(0);

        // Eine frische Lesung zeigt den Stützpunkt an der neuen Stelle, die anderen unverändert.
        const nachher = await wegLesen(page, weg.publicId);
        expect(nachher.revision).toBe(neu!.revision);
        expect(nachher.points).toHaveLength(punkte.length);
        expect(nachher.points[1]!.x).toBeGreaterThan(vorher.points[1]!.x + 0.01);
        expect(nachher.points[1]!.y).not.toBe(vorher.points[1]!.y);
        expect(nachher.points[2]).toEqual(vorher.points[2]);
        keinFehler(beob);
    });
});
