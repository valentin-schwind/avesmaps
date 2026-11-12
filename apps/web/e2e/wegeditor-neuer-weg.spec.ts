import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorPathTargets, PathCreateBody, PathCreateReceipt } from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS, GRATENFELS_LAGE } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Neuer Weg“ am echten Stack (WI-0177; EDIT-0003 T40 (3), R3, R7, R12, T24, G13): das gemeinsame Zeichnen des Geometrie-Moduls
 * (Modus „Anlegen“) mit der Art Weg, gestartet am Ort und unter „Hier hinzufügen ›“.
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung (W15): der Ort, die Ziele im Kasten und `path.create` kommen aus einem Stub;
 * den echten Schreibweg samt Rechten prüfen `apps/server/test/editor-path-create.test.ts` und `map-grants.test.ts`. Geklickt wird mit
 * der Maus auf der Karte; gemessen wird, was gesendet wird und was das Modul zeichnet.
 */

declare global {
    /** Die Steuerung „Neuer Weg“ (nur Entwicklung, `neuer-weg-anbindung.ts`). */
    var avesmapsNeuerWeg:
        | {
              starte(anfang: { ort: string } | { punkt: { x: number; y: number } }): Promise<void>;
              laufend: { value: { phase: string; stand: { punkte: number; abschnitte: number } } | undefined };
          }
        | undefined;
}

test.use({ viewport: { width: 1920, height: 1080 } });

const RECHTE = [
    "use_editor_menu",
    "edit_map_objects",
    "edit_map_geometry",
    "edit_territories",
    "edit_landscapes",
    "edit_territory_form",
    "edit_landscape_form",
    "edit_mountains",
];
const LANDSTRASSE = "0b6f0c55-0000-4000-8000-0000000000e1";
const ZIELORT = "0b6f0c55-0000-4000-8000-0000000000e2";
const NEU = "0b6f0c55-0000-4000-8000-0000000000e3";

const G = GRATENFELS_LAGE;
const p = (dx: number, dy: number) => ({
    x: Math.round((G.x + dx) * 1e5) / 1e5,
    y: Math.round((G.y + dy) * 1e5) / 1e5,
});
/** Ein Stützpunkt der Landstraße: Der Klick dort rastet nur ein. */
const STUETZPUNKT = p(5, 3);
/** Ein Ort: Der Klick dort beendet den Weg. */
const ZIEL = p(10, 0);

const ZIELE: EditorPathTargets = {
    margin: 0,
    peaks: [],
    places: [
        { publicId: GRATENFELS, name: "Gratenfels", ...G },
        { publicId: ZIELORT, name: "Zielhausen", ...ZIEL },
    ],
    vertices: [{ pathId: LANDSTRASSE, name: "Landstraße", index: 2, ...STUETZPUNKT, end: false, revision: 4 }],
};

interface Server {
    gesendet: PathCreateBody[];
    /** Wie oft die Ziele gelesen wurden. */
    zielfragen: number;
    /** Antwortet das Anlegen mit diesem Fehler (500 wie auf der Stage am 2026-10-17)? */
    fehler?: number;
    /** Hält das Anlegen die Antwort zurück, bis `gib()` sie freigibt? */
    haelt?: { gib?: () => void };
}

async function stub(page: Page): Promise<Server> {
    const server: Server = { gesendet: [], zielfragen: 0 };
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await stubAdmin(page, { capabilities: RECHTE, role: "editor" });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(/\/api\/editor\/locks(\?.*)?$/, (route) => json(route, 200, { locks: [] }));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) =>
        json(route, 200, { publicId: GRATENFELS, name: "Gratenfels", position: G, active: true }),
    );
    await page.route(/\/api\/editor\/path-targets\?/, (route) => {
        server.zielfragen += 1;
        return json(route, 200, ZIELE);
    });
    // Nach dem Anlegen öffnet das Wege-Fenster den neuen Weg: Liste und Straße aus dem Stub, nie vom Server der Entwicklung.
    await page.route(/\/api\/editor\/paths(\?.*)?$/, (route) => {
        if (route.request().method() !== "POST") return json(route, 200, { rows: [] });
        const body = route.request().postDataJSON() as PathCreateBody;
        server.gesendet.push(body);
        if (server.fehler !== undefined)
            return json(route, server.fehler, {
                error: { code: "internal_error", message: "Ein interner Fehler ist aufgetreten." },
            });
        const amZiel = body.points.at(-1)!.x === ZIEL.x && body.points.at(-1)!.y === ZIEL.y;
        const quittung: PathCreateReceipt = {
            operationId: body.operationId,
            status: "applied",
            environment: "development",
            affected: [{ kind: "path", id: NEU, revision: 1 }],
            derivedWork: [],
            warnings: [],
            mapRevision: 90 + server.gesendet.length,
            publicId: NEU,
            name: "Weg-7001",
            subtype: "Weg",
            ends: {
                start: { kind: "place", publicId: GRATENFELS, name: "Gratenfels" },
                end: amZiel ? { kind: "place", publicId: ZIELORT, name: "Zielhausen" } : { kind: "free" },
            },
        };
        if (server.haelt !== undefined) {
            const halt = server.haelt;
            return new Promise<void>((weiter) => {
                halt.gib = () => void json(route, 200, quittung).then(weiter);
            });
        }
        return json(route, 200, quittung);
    });
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}(\/street)?$/, (route) => route.fulfill({ status: 404 }));
    return server;
}

/** Ein Kartenpunkt in Seitenkoordinaten. */
async function aufSeite(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((pt) => {
        const map = globalThis.avesmapsMap!;
        const render = globalThis.avesmapsRenderProjection!.toRenderLngLat(pt);
        const at = map.project(render);
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

const leiste = (page: Page) => page.getByTestId("neuer-weg-leiste");
const ungespeichert = (page: Page) => page.getByTestId("neuer-weg-leiste-ungespeichert");
const hinweis = (page: Page) => page.getByTestId("toast");
const schild = (page: Page) => page.getByTestId("anlegen-schild");
const modusAktiv = (page: Page) =>
    page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.some((l) => l.id === "geometrie-kante") === true);
const punkte = (page: Page) => page.evaluate(() => globalThis.avesmapsNeuerWeg?.laufend.value?.stand.punkte ?? 0);
const phase = (page: Page) => page.evaluate(() => globalThis.avesmapsNeuerWeg?.laufend.value?.phase);

async function karte(page: Page): Promise<Server> {
    const server = await stub(page);
    await openMap(page, EDITOR_MODE);
    await showPlace(page, p(5, 1), 7);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    return server;
}

async function starteAmOrt(page: Page): Promise<Server> {
    const server = await karte(page);
    await page.waitForFunction(() => globalThis.avesmapsNeuerWeg !== undefined);
    await page.evaluate((id) => globalThis.avesmapsNeuerWeg!.starte({ ort: id }), GRATENFELS);
    await expect.poll(() => modusAktiv(page)).toBe(true);
    await expect(leiste(page)).toBeVisible();
    return server;
}

async function klicke(page: Page, punkt: { x: number; y: number }, dx = 0, dy = 0): Promise<void> {
    const at = await aufSeite(page, punkt);
    await page.mouse.click(at.x + dx, at.y + dy);
}

test("🔴 ab einem Ort: Gummiband, der Stützpunkt rastet nur ein, der Klick am Ort beendet und schreibt EINE Operation", async ({
    page,
}) => {
    const server = await starteAmOrt(page);
    await expect(leiste(page)).toContainText("Neuer Weg");
    await expect(leiste(page)).toContainText("ab Gratenfels");
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");

    // Das Gummiband folgt dem Zeiger und rastet wie der nächste Klick; das Schild sagt, was der Klick tut (R12).
    const stuetz = await aufSeite(page, STUETZPUNKT);
    await page.mouse.move(stuetz.x + 3, stuetz.y + 2, { steps: 4 });
    await expect(schild(page)).toContainText("Hier anschließen");
    await expect(schild(page)).toContainText("Landstraße");
    await page.mouse.click(stuetz.x + 3, stuetz.y + 2);
    await expect.poll(() => punkte(page)).toBe(2);
    await expect(leiste(page)).toBeVisible();
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");

    const ziel = await aufSeite(page, ZIEL);
    await page.mouse.move(ziel.x - 2, ziel.y + 3, { steps: 4 });
    await expect(schild(page)).toContainText("Weg hier abschließen");
    await expect(schild(page)).toContainText("Zielhausen");
    await page.mouse.click(ziel.x - 2, ziel.y + 3);

    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.points).toEqual([G, STUETZPUNKT, ZIEL]);
    await expect(leiste(page)).toBeHidden();
    await expect.poll(() => modusAktiv(page)).toBe(false);
    await expect(hinweis(page)).toContainText("Neuer Weg angelegt");
    await expect(hinweis(page)).toContainText("Gratenfels");
    await expect(hinweis(page)).toContainText("Zielhausen");
    // Kein Zurücknehmen-Feld nach dem Anlegen (T24).
    await expect(hinweis(page)).not.toContainText("Zurücknehmen");
});

test("🔴 Rechtsklick und ⌫ nehmen den letzten Punkt zurück, ohne Menü; Doppelklick beendet (R3, T24 (4))", async ({
    page,
}) => {
    const server = await starteAmOrt(page);
    await klicke(page, p(3, -3));
    await klicke(page, p(6, -4));
    await expect.poll(() => punkte(page)).toBe(3);
    const at = await aufSeite(page, p(6, -4));
    await page.mouse.click(at.x, at.y, { button: "right" });
    await expect.poll(() => punkte(page)).toBe(2);
    // Kein Kartenmenü beim Zeichnen.
    await expect(page.getByTestId("context-editor-hier-hinzufuegen")).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await expect.poll(() => punkte(page)).toBe(1);
    // Den festen Anfang nimmt nichts zurück.
    await page.keyboard.press("Backspace");
    await expect.poll(() => punkte(page)).toBe(1);

    const frei = await aufSeite(page, p(4, -5));
    await page.mouse.click(frei.x, frei.y);
    const ende = await aufSeite(page, p(8, -6));
    await page.mouse.dblclick(ende.x, ende.y);
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.points).toHaveLength(3);
    // Der Doppelklick zoomt nicht.
    await expect(leiste(page)).toBeHidden();
});

test("🔴 Esc fragt, sobald ein Abschnitt steht; „Verwerfen“ beendet ohne Schreiben", async ({ page }) => {
    const server = await starteAmOrt(page);
    await page.keyboard.press("Escape");
    // Ohne Abschnitt endet der Modus sofort.
    await expect(leiste(page)).toBeHidden();
    await page.evaluate((id) => globalThis.avesmapsNeuerWeg!.starte({ ort: id }), GRATENFELS);
    await expect(leiste(page)).toBeVisible();
    await klicke(page, p(3, -3));
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("neuer-weg-leiste-frage")).toContainText("Neuen Weg verwerfen?");
    await page.getByTestId("neuer-weg-leiste-frage-ja").click();
    await expect(leiste(page)).toBeHidden();
    await expect(hinweis(page)).toContainText("Neuer Weg verworfen");
    expect(server.gesendet).toEqual([]);
});

test("🔴 ein verwackelter Klick (8 px) setzt einen Punkt und schiebt die Karte nicht (G13)", async ({ page }) => {
    await starteAmOrt(page);
    const mitte = await page.evaluate(() => {
        const c = globalThis.avesmapsMap!.getCenter();
        return [c.lng, c.lat];
    });
    const at = await aufSeite(page, p(3, -3));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 6, at.y + 5, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => punkte(page)).toBe(2);
    expect(
        await page.evaluate(() => {
            const c = globalThis.avesmapsMap!.getCenter();
            return [c.lng, c.lat];
        }),
    ).toEqual(mitte);
});

test("🔴 „Hier hinzufügen › Neuer Weg“ beginnt an der Stelle des Rechtsklicks; Enter schreibt", async ({ page }) => {
    const server = await karte(page);
    const stelle = await aufSeite(page, p(2, 5));
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    const eintrag = page.getByTestId("context-editor-neuer-weg");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    await expect(leiste(page)).toBeVisible();
    await expect(leiste(page)).toContainText("ab freier Stelle");
    await klicke(page, p(7, 6));
    await expect.poll(() => punkte(page)).toBe(2);
    await page.keyboard.press("Enter");
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.points).toHaveLength(2);
    expect(server.zielfragen).toBeGreaterThan(0);
});

/** Wählt „Hier hinzufügen › Neuer Fluss/Bach › <art>“ an der Stelle `bei`. */
async function neuerFluss(page: Page, bei: { x: number; y: number }, art: "fluss" | "bach"): Promise<void> {
    const stelle = await aufSeite(page, bei);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    await page.getByTestId("context-editor-neuer-fluss").hover();
    const eintrag = page.getByTestId(`context-editor-neuer-fluss-${art}`);
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
}

const kameraMitte = (page: Page) =>
    page.evaluate(() => {
        const c = globalThis.avesmapsMap!.getCenter();
        return [c.lng, c.lat];
    });

test("🔴 „Hier hinzufügen › Neuer Fluss/Bach › Bach“ (Plan Fluss/Bach, Knopf „A · Untermenü“): aus Standard in die Topographie, die Kamera bleibt, gezeichnet ab der Stelle; „Fertig“ schreibt die Art Bach, die Ansicht bleibt", async ({
    page,
}) => {
    const server = await karte(page);
    await expect(page).toHaveURL(/view=standard/);
    const mitte = await kameraMitte(page);
    const stelle = await aufSeite(page, p(2, 5));
    await neuerFluss(page, p(2, 5), "bach");
    // Betreiber 2026-10-20: „Neuer Fluss/Bach -> sind im standard unsichtbar, wär cool, wenn die ansicht auf die topographie wechselt“.
    await expect(page).toHaveURL(/view=landscapes/);
    await expect(page).toHaveURL(/layer=topographie/);
    await expect(leiste(page)).toBeVisible();
    // Die Leiste nennt, was entsteht (Befund der Hauptorchestrierung auf der Stage, 2026-10-20: dort stand „Neuer Weg“).
    await expect(leiste(page)).toContainText("Neuer Bach");
    await expect(leiste(page)).not.toContainText("Neuer Weg");
    await expect(leiste(page)).toContainText("ab freier Stelle");
    await expect(page.getByTestId("neuer-weg-leiste-fertig")).toHaveAttribute(
        "title",
        "Ein Bach braucht mindestens zwei Punkte.",
    );
    await expect.poll(() => punkte(page)).toBe(1);
    // Die Karte steht: dieselbe Mitte, und die Stelle des Rechtsklicks liegt am selben Bildpunkt.
    expect(await kameraMitte(page)).toEqual(mitte);
    expect(await aufSeite(page, p(2, 5))).toEqual(stelle);
    await klicke(page, p(7, 6));
    await expect.poll(() => punkte(page)).toBe(2);
    await page.keyboard.press("Enter");
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]).toMatchObject({ art: "bach" });
    expect(server.gesendet[0]!.points).toHaveLength(2);
    // Der erste Punkt ist die Stelle des Rechtsklicks (auf den Bildpunkt genau).
    const erster = server.gesendet[0]!.points[0]!;
    expect(Math.abs(erster.x - p(2, 5).x)).toBeLessThan(0.3);
    expect(Math.abs(erster.y - p(2, 5).y)).toBeLessThan(0.3);
    await expect.poll(() => phase(page)).toBeUndefined();
    await expect(page).toHaveURL(/view=landscapes/);
    await expect(page).toHaveURL(/layer=topographie/);
});

test("🔴 „Neuer Fluss/Bach › Fluss“ abgebrochen: Esc stellt die Ansicht von vorher wieder her", async ({ page }) => {
    await karte(page);
    await neuerFluss(page, p(2, 5), "fluss");
    await expect(page).toHaveURL(/layer=topographie/);
    await expect(leiste(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => phase(page)).toBeUndefined();
    await expect(page).toHaveURL(/view=standard/);
});

test("🔴 Fund von Thomas (Stage, 2026-10-17): antwortet der Server 500, sagt der Hinweis es mit Status; Klick am Ziel, Doppelklick und „Fertig“ bleiben im Entwurf, zweimal Esc verlässt den Modus", async ({
    page,
}) => {
    const server = await starteAmOrt(page);
    server.fehler = 500;
    await klicke(page, p(3, -3));
    await expect.poll(() => punkte(page)).toBe(2);
    // Der Klick am Ort beendet das Zeichnen: Das Anlegen scheitert, der Entwurf bleibt, der Hinweis nennt den Fehler.
    const ziel = await aufSeite(page, ZIEL);
    await page.mouse.click(ziel.x - 2, ziel.y + 3);
    await expect.poll(() => server.gesendet.length).toBe(1);
    await expect(hinweis(page).first()).toContainText("Der Server konnte den Weg nicht anlegen (Fehler 500).");
    // Erst wenn die Antwort da ist, nimmt der Modus wieder Klicks an (beim Schreiben ist er gesperrt).
    await expect.poll(() => phase(page)).toBe("bereit");
    // „Fertig“ oben versucht es noch einmal.
    await leiste(page)
        .getByRole("button", { name: /Fertig/ })
        .click();
    await expect.poll(() => server.gesendet.length).toBe(2);
    await expect.poll(() => phase(page)).toBe("bereit");
    // Der Doppelklick ebenso.
    const ende = await aufSeite(page, p(8, -6));
    await page.mouse.dblclick(ende.x, ende.y);
    await expect.poll(() => server.gesendet.length).toBe(3);
    await expect.poll(() => phase(page)).toBe("bereit");
    // 🔴 Esc fragt, das zweite Esc verwirft und beendet (vorher schaltete es die Frage nur wieder aus).
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("neuer-weg-leiste-frage")).toContainText("Neuen Weg verwerfen?");
    await page.keyboard.press("Escape");
    await expect(leiste(page)).toBeHidden();
    await expect.poll(() => modusAktiv(page)).toBe(false);
    await expect(hinweis(page).filter({ hasText: "Neuer Weg verworfen" })).toHaveCount(1);
});

test("🔴 Esc während des Schreibens verlässt den Modus ohne zu warten", async ({ page }) => {
    const server = await starteAmOrt(page);
    server.haelt = {};
    await klicke(page, p(3, -3));
    await leiste(page)
        .getByRole("button", { name: /Fertig/ })
        .click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    await page.keyboard.press("Escape");
    await expect(leiste(page)).toBeHidden();
    await expect.poll(() => modusAktiv(page)).toBe(false);
    server.haelt.gib?.();
});
