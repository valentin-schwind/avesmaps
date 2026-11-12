import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
    OperationReceipt,
    RuecknahmeReceipt,
    type EditorPlaceDetail,
    type EditorPlaceList,
    type PlaceRemoval,
} from "@avesmaps3d/shared";
import { clickMap, EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { FERDOK, GRATENFELS, GRATENFELS_LAGE, editorPanelVorn, fenster } from "./ortseditor-stub.ts";
import { hebeSperrenAuf } from "./tor-hilfen.ts";
import { vertragGilt } from "./vertrag.ts";
import { OHNE_WELT, WELT_TOKEN_DATEI, beobachte, meldeAn, weltToken, type Beobachtung } from "./welt.ts";

/**
 * Release-Tor, Kernabläufe 8 bis 12: Orte, gegen den ECHTEN Server des Kandidaten (WI-0264, `release-tor.json`). Kein `page.route` auf
 * `/api`: Liste, Detail, Anlegen, Speichern, Verschieben, Entfernen, Verlauf und Sperre kommen aus der Datenbank des Laufs (Testpaket, echte
 * Legacy-Orte wie Gratenfels und Ferdok). Jeder Schreibfall belegt das Ergebnis doppelt: Die Antwort des Servers ist 200 und eine frische
 * Lesung (Neuladen oder `GET`) zeigt die Folge.
 *
 * Was die Fachspecs im Detail prüfen (Beschriftungen, Abstände, Einrasten), gehört nicht hierher: Das Tor soll nur fallen, wenn eine
 * Kernfunktion fehlt.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

/** Ein Lauf, ein Namenszusatz: Eine Wiederholung stößt nie an den Namen des ersten Versuchs (Orte heißen eindeutig). */
const LAUF = String(Date.now());
/** Eine leere Stelle im Meer (wie `ortseditor-setzen.spec.ts`), an der ein neuer Ort nichts berührt. */
const MEER = { x: 120, y: 520 };

function keinFehler(beob: Beobachtung): void {
    expect(beob.fehler, "kein 5xx, kein Fehler der Seite").toEqual([]);
}

/** Der Ort, wie der echte Server ihn dem Ortseditor liest. */
async function ortLesen(page: Page, id: string): Promise<EditorPlaceDetail> {
    const antwort = await page.request.get(`/api/editor/places/${id}`);
    expect(antwort.status(), `GET /api/editor/places/${id}: ${await antwort.text()}`).toBe(200);
    return (await antwort.json()) as EditorPlaceDetail;
}

/** Das Fenster des Ortseditors über das Editorpanel, wie ein Mensch es öffnet; die Liste lädt aus dem echten Server. */
async function oeffneOrtseditor(page: Page): Promise<void> {
    await meldeAn(page);
    await openMap(page, EDITOR_MODE);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-verb").click();
    await expect(fenster(page)).toBeVisible({ timeout: 30_000 });
}

/** Die Zeile eines Orts der Liste (nach seiner Kennung): Die Liste rollt, darum sucht der Fall zuerst nach dem Namen. */
async function waehleOrt(page: Page, id: string, suchwort: string): Promise<void> {
    await fenster(page).locator('[data-testid$="-orte-leiste-suche"] input').fill(suchwort);
    const zeile = fenster(page).locator(`[data-testid$="-orte-zeile"][data-key="${id}"]`);
    await expect(zeile).toBeVisible({ timeout: 30_000 });
    await zeile.click();
}

const status = (page: Page) => fenster(page).locator('[data-testid$="-status"]');
const feld = (page: Page, name: string) =>
    fenster(page)
        .locator(`[data-testid$="-feld-${name}"]`)
        .locator("xpath=descendant-or-self::*[self::input or self::textarea]")
        .first();

/** Die Quittung einer Schreibroute: 200 und in der Form des Vertrags (dieselbe Prüfung wie die Antwortschemas des Servers). */
async function quittung(antwort: Awaited<ReturnType<Page["waitForResponse"]>>): Promise<OperationReceipt> {
    expect(antwort.status(), await antwort.text()).toBe(200);
    return vertragGilt(OperationReceipt, await antwort.json(), "Die Quittung des echten Servers");
}

/** Eine Stelle der Karte (Canvas-Pixel), an der zuoberst die Karte liegt, kein Panel und kein Fenster: von links gesucht. */
async function freieStelle(page: Page): Promise<{ x: number; y: number }> {
    await settleFrame(page);
    return page.locator(".maplibregl-canvas").evaluate((canvas) => {
        const rahmen = canvas.getBoundingClientRect();
        const y = rahmen.height / 2;
        const frei = (x: number) => document.elementFromPoint(rahmen.left + x, rahmen.top + y) === canvas;
        for (let x = 60; x < rahmen.width - 60; x += 20) if (frei(x) && frei(x + 40)) return { x: x + 20, y };
        return { x: rahmen.width / 2, y };
    });
}

test.describe("Tor: Orte", () => {
    test.skip(WELT_TOKEN_DATEI === undefined, OHNE_WELT);

    // Sperren überleben das Ende eines Falls (ein geschlossener Browser gibt nichts frei): jeder Fall beginnt und endet ohne.
    test.beforeEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));
    test.afterEach(async ({ request, baseURL }) => hebeSperrenAuf(request, new URL(baseURL!).origin));

    test("8 ein neuer Ort auf der Karte ist nach dem Neuladen da", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        const name = `Tor-Ort ${LAUF}`;
        await meldeAn(page);
        await openMap(page, EDITOR_MODE);
        await showPlace(page, MEER, 6);
        // Rechtsklick auf die leere Karte › Hier hinzufügen › Neuer Ort: Das Formular trägt die angeklickte Lage.
        await clickMap(page, await freieStelle(page), { button: "right" });
        await page.getByTestId("context-editor-hier-hinzufuegen").hover();
        await page.getByTestId("context-editor-neuer-ort").click();
        const formular = fenster(page).locator('form[data-testid$="-neu"]');
        await expect(formular.locator('[data-testid$="-neu-lage"]')).not.toHaveText("Nicht auf der Karte");
        await formular.locator('[data-testid$="-neu-name"] input').fill(name);

        const [antwort] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith("/api/editor/places") && r.request().method() === "POST"),
            formular.locator('[data-testid$="-neu-anlegen"]').click(),
        ]);
        const beleg = await quittung(antwort);
        const neu = beleg.affected.find((e) => e.kind === "place");
        expect(neu, "die Quittung nennt den neuen Ort").toBeDefined();
        await expect(page.getByText(`${name} angelegt.`)).toBeVisible();

        // Nach dem Neuladen ist er da: im echten Server mit Namen und Lage, und in der Liste des Ortseditors.
        await page.reload();
        await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, {
            timeout: 60_000,
        });
        const gelesen = await ortLesen(page, neu!.id);
        expect(gelesen.name).toBe(name);
        expect(gelesen.position, "der Ort hat die Lage des Klicks").toBeDefined();
        expect(Math.abs(gelesen.position!.x - MEER.x)).toBeLessThan(120);
        const liste = (await (await page.request.get("/api/editor/places")).json()) as EditorPlaceList;
        expect(liste.rows.some((zeile) => zeile.key === neu!.id && zeile.name === name)).toBe(true);
        await editorPanelVorn(page);
        await page.getByTestId("editorpanel-verb").click();
        await fenster(page).locator('[data-testid$="-orte-leiste-suche"] input').fill(name);
        await expect(fenster(page).locator(`[data-testid$="-orte-zeile"][data-key="${neu!.id}"]`)).toBeVisible({
            timeout: 30_000,
        });
        keinFehler(beob);
    });

    test("9 ein Feld ändern und speichern: die Revision steigt", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        const wert = `Tor ${LAUF}`;
        await oeffneOrtseditor(page);
        const vorher = await ortLesen(page, GRATENFELS);
        await waehleOrt(page, GRATENFELS, "Gratenfels");
        await expect(status(page)).toHaveText(`Keine Änderung · Revision ${String(vorher.revision)}`, {
            timeout: 30_000,
        });

        await feld(page, "einwohner").fill(wert);
        await expect(status(page)).toHaveText("Ungespeichert: Einwohner");
        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith(`/api/editor/places/${GRATENFELS}`) && r.request().method() === "PATCH",
            ),
            fenster(page).locator('[data-testid$="-speichern"]').click(),
        ]);
        const beleg = await quittung(antwort);
        const nachher = beleg.affected.find((e) => e.kind === "place" && e.id === GRATENFELS);
        expect(nachher?.revision, "die Revision steigt").toBeGreaterThan(vorher.revision);
        await expect(status(page)).toHaveText(`Gespeichert als Revision ${String(nachher!.revision)}.`);

        // Eine frische Lesung des echten Servers hat den Wert und die neue Revision.
        const gelesen = await ortLesen(page, GRATENFELS);
        expect(gelesen.revision).toBe(nachher!.revision);
        expect(gelesen.fields.einwohner.value).toBe(wert);
        keinFehler(beob);
    });

    test("10 einen Ort verschieben", async ({ page }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        await oeffneOrtseditor(page);
        const vorher = await ortLesen(page, GRATENFELS);
        await waehleOrt(page, GRATENFELS, "Gratenfels");
        await expect(status(page)).toContainText("Keine Änderung", { timeout: 30_000 });
        await showPlace(page, { x: GRATENFELS_LAGE.x - 40, y: GRATENFELS_LAGE.y }, 7);
        await fenster(page).locator('[data-testid$="-verschieben"]').click();
        // Der Modus ist da, wenn die Karte den Griff zeichnet; erst dann greift die Maus ihn.
        await expect
            .poll(() => page.evaluate(() => globalThis.avesmapsMap?.getLayer("geometrie-anfasser") !== undefined), {
                timeout: 30_000,
            })
            .toBe(true);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        await settleFrame(page);
        await page.waitForFunction(
            () => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }).length ?? 0) > 0,
        );
        const griff = await page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const punkt = map.queryRenderedFeatures({ layers: ["geometrie-anfasser"] })[0]!;
            const [lng, lat] = (punkt.geometry as { coordinates: [number, number] }).coordinates;
            const bild = map.project({ lng, lat });
            const rahmen = map.getCanvas().getBoundingClientRect();
            return { x: rahmen.left + bild.x, y: rahmen.top + bild.y };
        });
        await page.mouse.move(griff.x, griff.y);
        await page.mouse.down();
        await page.mouse.move(griff.x - 160, griff.y + 90, { steps: 8 });
        await page.mouse.up();
        // Das Loslassen ist ein Schritt im Entwurf; erst „Fertig“ in der Leiste über der Karte schreibt (EDIT-0003 G4).
        await expect(page.getByTestId("ort-verschieben-leiste-ungespeichert")).toHaveText("1 ungespeichert");
        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith(`/api/editor/places/${GRATENFELS}/move`) && r.request().method() === "POST",
            ),
            page.getByTestId("ort-verschieben-leiste-fertig").click(),
        ]);
        const beleg = await quittung(antwort);
        const neu = beleg.affected.find((e) => e.kind === "place" && e.id === GRATENFELS);
        expect(neu?.revision).toBeGreaterThan(vorher.revision);
        await expect(status(page)).toContainText(`Verschoben als Revision ${String(neu!.revision)}`);

        // Der echte Server liest den Ort an der neuen Stelle (links und tiefer als vorher, in Karteneinheiten).
        const gelesen = await ortLesen(page, GRATENFELS);
        expect(gelesen.revision).toBe(neu!.revision);
        expect(gelesen.position!.x).toBeLessThan(vorher.position!.x);
        expect(
            Math.hypot(gelesen.position!.x - vorher.position!.x, gelesen.position!.y - vorher.position!.y),
        ).toBeGreaterThan(0.5);
        keinFehler(beob);
    });

    test("11 einen Ort entfernen, ↺ holt ihn zurück", async ({ page }) => {
        test.setTimeout(300_000);
        const beob = beobachte(page);
        await meldeAn(page);
        // Ein echter Ort ohne Hindernis: auf der Karte, ohne Stätten und ohne Kraftlinie, mit mindestens einem Wegende (Wege gehen mit).
        const liste = (await (await page.request.get("/api/editor/places")).json()) as EditorPlaceList;
        let ziel: PlaceRemoval | undefined;
        for (const zeile of liste.rows.filter((r) => r.origin === "karte" && r.subtype === "dorf").slice(0, 60)) {
            const antwort = await page.request.get(`/api/editor/places/${zeile.key}/removal`);
            if (antwort.status() !== 200) continue;
            const vorschau = (await antwort.json()) as PlaceRemoval;
            if (
                vorschau.onMap &&
                vorschau.staetten.length === 0 &&
                vorschau.kraftlinien.length === 0 &&
                vorschau.gebiete.length === 0 &&
                vorschau.wegenden.length >= 1
            ) {
                ziel = vorschau;
                break;
            }
        }
        expect(ziel, "ein Dorf der echten Daten, das sich ohne Hindernis entfernen lässt").toBeDefined();
        const { publicId: id, name } = ziel!;

        await openMap(page, EDITOR_MODE);
        await editorPanelVorn(page);
        await page.getByTestId("editorpanel-verb").click();
        await expect(fenster(page)).toBeVisible({ timeout: 30_000 });
        await waehleOrt(page, id, name);
        await expect(status(page)).toContainText("Keine Änderung", { timeout: 30_000 });
        await fenster(page).locator('[data-testid$="-leiste-entfernen"]').click();
        const blatt = page.getByTestId("ort-entfernen");
        await expect(blatt).toBeVisible({ timeout: 30_000 });
        await page.getByTestId("ort-entfernen-loeschen").check();
        const [antwort] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith(`/api/editor/places/${id}/delete`) && r.request().method() === "POST",
            ),
            page.getByTestId("ort-entfernen-los").click(),
        ]);
        await quittung(antwort);
        await expect(blatt).toBeHidden();
        // Gelöscht ist er für den Server weg: kein aktiver Ort mehr.
        const weg = await page.request.get(`/api/editor/places/${id}`);
        const abgelegt = weg.status() === 200 ? ((await weg.json()) as EditorPlaceDetail) : undefined;
        expect(
            weg.status() === 404 || abgelegt?.active === false,
            `der Ort ist entfernt (Status ${String(weg.status())})`,
        ).toBe(true);

        // ↺ unter „Änderungen“ nimmt das Löschen zurück: Vorprüfung des Servers, Rückfrage, EINE Rücknahme (`restore-series`, WI-0265 B5c).
        await page.getByTestId("editorpanel-reiter-aenderungen").click();
        const eintrag = page
            .getByTestId("editorpanel-aenderung")
            .filter({ hasText: `${name} gelöscht` })
            .first();
        await expect(eintrag).toBeVisible({ timeout: 30_000 });
        await eintrag.getByTestId("editorpanel-aenderung-zeile").click();
        await eintrag.getByTestId("editorpanel-aenderung-ruecknahme").click();
        const frage = eintrag.getByTestId("editorpanel-aenderung-ruecknahme-frage");
        await expect(frage).toBeVisible({ timeout: 30_000 });
        const [zurueck] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().endsWith(`/api/editor/places/${id}/restore-series`) && r.request().method() === "POST",
            ),
            frage.getByRole("button", { name: "Zurücknehmen", exact: true }).click(),
        ]);
        expect(zurueck.status(), await zurueck.text()).toBe(200);
        vertragGilt(RuecknahmeReceipt, await zurueck.json(), "Die Quittung der Rücknahme des echten Servers");
        const da = await ortLesen(page, id);
        expect(da.active, "der Ort ist wieder aktiv").toBe(true);
        expect(da.position, "mit seiner Lage").toBeDefined();
        keinFehler(beob);
    });

    test("12 ein fremd gesperrter Ort: die Änderung wird abgewiesen, der Name des Bearbeiters steht da", async ({
        page,
        request,
        baseURL,
    }) => {
        test.setTimeout(240_000);
        const beob = beobachte(page);
        const herkunft = new URL(baseURL!).origin;
        const lauf = randomUUID();
        const alsZweiter = { cookie: `avesmaps-session=${weltToken("editor2")}`, origin: herkunft };
        // „Tor-Zweiter“ nimmt die Sperre am echten Server.
        const nehmen = await request.post("/api/editor/locks", {
            headers: alsZweiter,
            data: { kind: "place", id: FERDOK, part: "felder", run: lauf },
        });
        expect(nehmen.status(), await nehmen.text()).toBe(200);
        try {
            await oeffneOrtseditor(page);
            const vorher = await ortLesen(page, FERDOK);
            await waehleOrt(page, FERDOK, "Ferdok");
            await expect(status(page)).toHaveText(`Keine Änderung · Revision ${String(vorher.revision)}`, {
                timeout: 30_000,
            });
            const alt = await feld(page, "einwohner").inputValue();
            const [abgewiesen] = await Promise.all([
                page.waitForResponse((r) => r.url().endsWith("/api/editor/locks") && r.request().method() === "POST", {
                    timeout: 30_000,
                }),
                feld(page, "einwohner").fill(`Tor ${LAUF}`),
            ]);
            // Der echte Server weist die Sperre ab und nennt den Halter; die Oberfläche nimmt die Änderung zurück und sagt, wer sie hält.
            expect(abgewiesen.status(), await abgewiesen.text()).toBe(409);
            const fehler = (await abgewiesen.json()) as {
                error: { code: string; details: { lock: { person: { name: string } } } };
            };
            expect(fehler.error.code).toBe("object_locked");
            expect(fehler.error.details.lock.person.name).toBe("Tor-Zweiter");
            await expect(status(page)).toContainText("Tor-Zweiter bearbeitet die Eigenschaften seit");
            await expect(feld(page, "einwohner")).toHaveValue(alt);
            // Nichts wurde geschrieben: dieselbe Revision.
            expect((await ortLesen(page, FERDOK)).revision).toBe(vorher.revision);
        } finally {
            await request.post("/api/editor/locks/release", {
                headers: alsZweiter,
                data: { kind: "place", id: FERDOK, run: lauf },
            });
        }
        keinFehler(beob);
    });
});
