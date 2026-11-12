import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
    OperationReceipt,
    type EditorPlaceDetail,
    type InhalteQuelle,
    type InhalteQuellenListe,
    type InhalteTraegerQuellen,
    type PlaceCreateBody,
    type SubjectDetail,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { editorPanelVorn, fenster } from "./ortseditor-stub.ts";
import { hebeSperrenAuf } from "./tor-hilfen.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn } from "./welt.ts";

/**
 * Release-Tor, Kernablauf 19: Inhalte, gegen den ECHTEN Server des Kandidaten (WI-0264, `release-tor.json`; OPS-000066). Kein `page.route`
 * auf `/api`: Der Katalog der Quellen, das Anhängen im Reiter „Quellen“ des Ortseditors und das Etikett des Orts kommen aus der Datenbank
 * des Laufs (Testpaket, der echte Katalog mit 3.906 Quellen).
 *
 * Was der Fall zusichert (Kanon-Regel Rang 2, `sources.yaml`): Ein Ort ohne Wiki-Artikel, dem die Redaktion eine OFFIZIELLE Quelle als
 * „ausführlich“ anhängt, trägt danach das Etikett OFFIZIELL, in derselben Transaktion (`inhalte/kanon-folgen.ts`) und nicht erst mit dem
 * nächsten Legacy-Zug. Davor sagt er nicht „offiziell“.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

/** Ein Lauf, ein Namenszusatz: Orte heißen eindeutig, eine Wiederholung stößt nie an den Ort des ersten Versuchs. */
const LAUF = String(Date.now());
/** Eine leere Stelle im Meer, abseits der Orte der anderen Tor-Fälle; dort steht nur dieser Ort. */
const STELLE = { x: 96, y: 548 };
/** Eine offizielle Regionalspielhilfe des echten Katalogs (die Zeile ist eindeutig: kein anderer Titel beginnt so). */
const QUELLE = "Almanach der Ungeheuer";

async function lies<T>(page: Page, url: string): Promise<T> {
    const antwort = await page.request.get(url);
    expect(antwort.status(), `GET ${url}: ${await antwort.text()}`).toBe(200);
    return (await antwort.json()) as T;
}

test.describe("Tor: Inhalte", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    // Sperren überleben das Ende eines Falls (ein geschlossener Browser gibt nichts frei): jeder Fall beginnt und endet ohne.
    test.beforeEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));
    test.afterEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));

    test("19 eine offizielle Quelle „ausführlich“ an einen Ort hängen: das Etikett folgt", async ({ page }) => {
        test.setTimeout(300_000);
        const beob = beobachte(page);
        const name = `Tor-Quellenort ${LAUF}`;
        await meldeAn(page);

        // Vorbereitung über den echten Server: ein neuer Ort ohne Wiki-Artikel und ohne Quelle.
        const koerper: PlaceCreateBody = { operationId: randomUUID(), name, subtype: "dorf", position: STELLE };
        const angelegt = await page.request.post("/api/editor/places", {
            headers: { origin: new URL(page.url()).origin },
            data: koerper,
        });
        expect(angelegt.status(), await angelegt.text()).toBe(200);
        const ortId = vertragGilt(OperationReceipt, await angelegt.json(), "Die Quittung des echten Servers")
            .affected[0]!.id;
        const vorher = await lies<SubjectDetail>(page, `/api/subjects/place/${ortId}`);
        expect(vorher.canon?.canon, "ohne offizielle Quelle ist der Ort nicht offiziell").not.toBe("official");

        // Die Quelle aus dem Katalog des Laufs: genau eine, und sie ist offiziell.
        const katalog = await lies<InhalteQuellenListe>(
            page,
            `/api/editor/inhalte/quellen?q=${encodeURIComponent(QUELLE)}&limit=10`,
        );
        const zeile = katalog.items.find((eine) => eine.title === QUELLE);
        expect(zeile, `die Quelle „${QUELLE}“ steht im Katalog des Testpakets`).toBeDefined();
        expect((await lies<InhalteQuelle>(page, `/api/editor/inhalte/quellen/${zeile!.id}`)).isOfficial).toBe(true);

        // Der Ortseditor, der Ort, der Reiter „Quellen“, „＋ Quelle“: suchen, wählen. Ein Klick auf den Treffer hängt an (EIN Schreiben).
        await openMap(page, EDITOR_MODE);
        await editorPanelVorn(page);
        await page.getByTestId("editorpanel-verb").click();
        await expect(fenster(page)).toBeVisible({ timeout: 30_000 });
        await fenster(page).locator('[data-testid$="-orte-leiste-suche"] input').fill(name);
        const ortZeile = fenster(page).locator(`[data-testid$="-orte-zeile"][data-key="${ortId}"]`);
        await expect(ortZeile).toBeVisible({ timeout: 30_000 });
        await ortZeile.click();
        await fenster(page).locator('[data-testid$="-reiter-quellen"]').click();
        await fenster(page).locator('[data-testid$="-quelle-neu-knopf"]').click();
        await fenster(page).locator('[data-testid$="-quelle-suche"] input').fill(QUELLE);
        const treffer = fenster(page).locator('[data-testid$="-quelle-treffer-eins"]').filter({ hasText: QUELLE });
        await expect(treffer.first()).toBeVisible({ timeout: 30_000 });
        const [anhaengen] = await Promise.all([
            page.waitForResponse(
                (r) =>
                    r.url().endsWith(`/api/editor/inhalte/traeger/place/${ortId}/quellen`) &&
                    r.request().method() === "POST",
            ),
            treffer.first().click(),
        ]);
        expect(anhaengen.status(), await anhaengen.text()).toBe(200);

        // Die Art „ausführlich“ speichert beim Wählen.
        const art = fenster(page).locator('[data-testid$="-quelle-art"] select');
        await expect(art).toBeVisible({ timeout: 30_000 });
        const [artAntwort] = await Promise.all([
            page.waitForResponse(
                (r) =>
                    r.url().endsWith(`/api/editor/inhalte/traeger/place/${ortId}/quellen`) &&
                    r.request().method() === "POST",
            ),
            art.selectOption("ausfuehrlich"),
        ]);
        expect(artAntwort.status(), await artAntwort.text()).toBe(200);

        // Eine frische Lesung des echten Servers: die Quelle hängt mit der Art, und das Etikett des Orts ist OFFIZIELL.
        const quellen = await lies<InhalteTraegerQuellen>(page, `/api/editor/inhalte/traeger/place/${ortId}/quellen`);
        const angehaengt = quellen.quellen.find((eine) => eine.sourceId === zeile!.id);
        expect(angehaengt?.state).toBe("active");
        expect(angehaengt?.referenceKind).toBe("ausfuehrlich");
        const nachher = await lies<SubjectDetail>(page, `/api/subjects/place/${ortId}`);
        expect(nachher.canon?.canon, "das Etikett folgt der Quelle").toBe("official");

        // Und die Infobox des Orts zeigt es: neu laden, hinfliegen, den Ort anklicken.
        const ort = await lies<EditorPlaceDetail>(page, `/api/editor/places/${ortId}`);
        await page.reload();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 60_000,
        });
        await showPlace(page, ort.position!, 8);
        await settleFrame(page);
        const bild = await page.evaluate((lage) => {
            const map = globalThis.avesmapsMap!;
            const punkt = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(lage));
            const rahmen = map.getCanvas().getBoundingClientRect();
            return { x: rahmen.left + punkt.x, y: rahmen.top + punkt.y };
        }, ort.position!);
        await page.mouse.click(bild.x, bild.y);
        await expect(page.getByTestId("info-title")).toHaveText(name, { timeout: 30_000 });
        await expect(page.getByTestId("info-canon")).toHaveAttribute("data-state", "official", { timeout: 30_000 });
        expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
    });
});
