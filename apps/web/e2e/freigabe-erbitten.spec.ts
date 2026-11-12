import { expect, test, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import type { EditorPlaceDetail, PlaceUpdateBody } from "@avesmaps3d/shared";
import { hinweisGesehen } from "./erster-besuch.ts";
import { THOMAS, VALENTIN, freigabeServer, laufeAb, stubFreigabe, type FreigabeServer } from "./freigabe-stub.ts";
import { EDITOR_MODE, openMap, showPlace } from "./map-handle.ts";
import {
    GRATENFELS,
    GRATENFELS_LAGE,
    LISTE,
    editorPanelGemerktZu,
    fenster,
    oeffneOrtseditor,
    zeile,
} from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Freigabe einer Sperre erbitten (WI-0262, OPS-000059; Vali 2026-10-30): Zwei Browser, ein Server im Speicher (`freigabe-stub.ts`). Valentin
 * (Seite A) bearbeitet Gratenfels im Ortseditor und hält die Sperre; Thomas (Seite B) sieht das Schild, bittet im Kasten des Kartenmenüs
 * um Freigabe, und die Antwort kommt zurück. Die Uhren beider Seiten laufen auf `page.clock`, damit der Herzschlag (eine Minute) und der
 * schnelle Takt der Liste (zehn Sekunden) ohne Warten ablaufen. Die Rechnung dahinter prüfen `test/freigabe-*.test.ts` und
 * `apps/server/test/editor-lock-request.test.ts` (gegen echtes PostgreSQL).
 *
 * Problemfälle: Die Bitte erreicht den Inhaber nicht (kein Hinweis nach dem Herzschlag); „Freigeben“ gibt ab, ohne zu speichern, oder
 * speichert nicht, bevor der Bittende die Antwort liest; scheitert das Speichern, geht die Sperre trotzdem oder der Bittende liest
 * „freigegeben“; nach der Freigabe bleibt das Schild stehen, oder „Ort verschieben“ bleibt gesperrt, bis die Seite neu lädt; „Später“
 * und „Abgelaufen“ stehen nirgends; der Knopf bleibt neben einer offenen Anfrage stehen.
 */

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
const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

function ort(revision = 7): EditorPlaceDetail {
    return {
        publicId: GRATENFELS,
        revision,
        name: "Gratenfels",
        subtype: "stadt",
        kind: null,
        position: GRATENFELS_LAGE,
        active: true,
        hidden: false,
        ruined: false,
        nodix: false,
        seaport: false,
        underground: false,
        withdrawn: false,
        approximate: false,
        sourceSystem: "legacy",
        fields: {
            description: { value: null, origin: null, wiki: "Hauptstadt der Grafschaft Gratenfels." },
            einwohner: { value: null, origin: null, wiki: "2.200" },
            lage: { value: null, origin: null, wiki: "Kosch" },
            oberhaupt: { value: null, origin: null, wiki: null },
        },
        wiki: { url: "https://de.wiki-aventurica.de/wiki/Gratenfels", title: "Gratenfels", state: "assigned" },
        pathEnds: [],
    };
}

const quittung = (revision: number) => ({
    operationId: "00000000-0000-4000-8000-000000000001",
    status: "applied",
    environment: "development",
    affected: [{ kind: "place", id: GRATENFELS, revision }],
    derivedWork: [],
    warnings: [],
    mapRevision: 57,
});

interface Ort {
    gesendet: PlaceUpdateBody[];
    /** Die nächsten Antworten auf das Speichern; leer heißt: angenommen. */
    antworten: { status: number; body: unknown }[];
}

async function stubOrt(page: Page, stand: Ort): Promise<void> {
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) => {
        if (route.request().method() === "PATCH") {
            stand.gesendet.push(route.request().postDataJSON() as PlaceUpdateBody);
            const antwort = stand.antworten.shift();
            return antwort === undefined ? json(route, 200, quittung(8)) : json(route, antwort.status, antwort.body);
        }
        return json(route, 200, ort(stand.gesendet.length > 0 && stand.antworten.length === 0 ? 8 : 7));
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/move-targets`, (route) =>
        json(route, 200, { radius: 50, freeEnds: [] }),
    );
}

interface Seiten {
    server: FreigabeServer;
    ort: Ort;
    /** Valentin, der Inhaber. */
    a: Page;
    /** Thomas, der Bittende. */
    b: Page;
    schliessen(): Promise<void>;
}

async function kontext(browser: Browser, baseURL: string): Promise<BrowserContext> {
    return browser.newContext({
        baseURL,
        locale: "de-DE",
        viewport: { width: 1920, height: 1080 },
        storageState: hinweisGesehen(baseURL),
    });
}

/**
 * Beide Seiten stehen bereit: Valentin hat im Ortseditor-Fenster „Einwohner“ geändert (die Sperre gilt, der Entwurf steht), Thomas hat
 * die Karte im Editor-Modus offen und sieht das Schild.
 */
async function aufbau(browser: Browser, baseURL: string): Promise<Seiten> {
    const server = freigabeServer();
    const stand: Ort = { gesendet: [], antworten: [] };
    const ctxA = await kontext(browser, baseURL);
    const ctxB = await kontext(browser, baseURL);
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await a.clock.install();
    await b.clock.install();

    await stubOrt(a, stand);
    await oeffneOrtseditor(a, { rechte: RECHTE });
    await stubFreigabe(a, server, "A", VALENTIN);
    await zeile(a, "Gratenfels").click();
    await einwohner(a).fill("2.500");
    await expect.poll(() => server.sperre?.halter.name).toBe("Valentin");

    await stubAdmin(b, { capabilities: RECHTE, role: "editor" });
    await editorPanelGemerktZu(b);
    await stubOrt(b, { gesendet: [], antworten: [] });
    await b.route("**/api/editor/places", (route) => json(route, 200, LISTE));
    await stubFreigabe(b, server, "B", THOMAS);
    await openMap(b, EDITOR_MODE);
    await showPlace(b, GRATENFELS_LAGE, 7);
    return {
        server,
        ort: stand,
        a,
        b,
        schliessen: async () => {
            await ctxA.close();
            await ctxB.close();
        },
    };
}

const einwohner = (page: Page) =>
    fenster(page)
        .locator('[data-testid$="-feld-einwohner"]')
        .locator("xpath=descendant-or-self::*[self::input or self::textarea]")
        .first();

/** Rechtsklick auf den Ort bei Thomas: Das Kartenmenü mit dem Kasten zur Sperre geht auf. */
async function oeffneKastenBeiThomas(b: Page): Promise<void> {
    const at = await b.evaluate((lage) => {
        const map = globalThis.avesmapsMap!;
        const punkt = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(lage));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + punkt.x, y: rahmen.top + punkt.y };
    }, GRATENFELS_LAGE);
    await b.mouse.click(at.x, at.y, { button: "right" });
    await expect(kasten(b)).toBeVisible();
}

const kasten = (b: Page) => b.getByTestId("context-editor-sperre-objekt");
const bittenKnopf = (b: Page) => b.getByTestId("context-editor-sperre-objekt-bitten");
const kastenStatus = (b: Page) => b.getByTestId("context-editor-sperre-objekt-status");
const hinweis = (a: Page) => a.getByTestId("freigabe-hinweise");

/** Thomas bittet; Valentins Herzschlag bringt die Bitte, und der Hinweis steht da. */
async function bitteUndHinweis(s: Seiten): Promise<void> {
    await expect(s.b.getByTestId("sperre-schild")).toContainText("🔒 Valentin · Eigenschaften · seit");
    await oeffneKastenBeiThomas(s.b);
    await expect(bittenKnopf(s.b)).toHaveText("Freigabe erbitten");
    await bittenKnopf(s.b).click();
    await expect(kastenStatus(s.b)).toContainText("Anfrage gesendet, läuft ab um");
    // Neben einer offenen Anfrage steht der Knopf nicht mehr.
    await expect(bittenKnopf(s.b)).toHaveCount(0);
    expect(s.server.bitten.map((bitte) => bitte.stand)).toEqual(["open"]);
    // Valentin sieht nichts, bis sein Herzschlag kommt: Es gibt keinen eigenen Takt.
    await expect(hinweis(s.a)).toHaveCount(0);
    await s.a.clock.fastForward(60_000);
    await expect(hinweis(s.a)).toBeVisible();
    await expect(s.a.getByTestId("freigabe-hinweis-text")).toHaveText("Thomas bittet um Freigabe: „Gratenfels“");
}

test("🔴 Freigeben: Valentins Entwurf wird gespeichert, die Sperre geht zurück, Thomas liest die Antwort und bearbeitet ohne Neuladen", async ({
    browser,
    baseURL,
}) => {
    const s = await aufbau(browser, baseURL!);
    await bitteUndHinweis(s);

    await s.a.getByTestId("freigabe-hinweis-freigeben").click();
    await expect(hinweis(s.a)).toHaveCount(0);
    // Gespeichert (die Änderung ging hinaus), dann abgegeben, dann beantwortet - in dieser Reihenfolge.
    expect(s.ort.gesendet).toEqual([
        { operationId: expect.any(String), baseRevision: 7, changes: { einwohner: { value: "2.500" } } },
    ]);
    expect(s.server.sperre).toBeUndefined();
    expect(s.server.bitten.map((bitte) => bitte.stand)).toEqual(["released"]);
    const reihenfolge = s.server.aufrufe.filter((aufruf) => /^A POST \/(release|request\/answer)$/.test(aufruf));
    expect(reihenfolge[0]).toBe("A POST /release");

    // Thomas: Der schnelle Takt der Liste (zehn Sekunden, solange die Anfrage offen war) bringt die Antwort.
    await s.b.clock.fastForward(10_000);
    await expect(s.b.getByTestId("toast")).toHaveText("„Gratenfels“: Freigegeben, jetzt bearbeitbar.");
    await expect(s.b.getByTestId("sperre-schild")).toHaveCount(0);
    // Der Kasten fällt aus dem offenen Menü, und „Ort verschieben“ geht jetzt - ohne die Seite neu zu laden.
    await expect(kasten(s.b)).toHaveCount(0);
    await expect(s.b.getByTestId("context-editor-ort-verschieben")).toBeEnabled();
    await s.schliessen();
});

test("🔴 Später: Valentin behält die Sperre und den Entwurf, Thomas liest „Später“ und kann erneut bitten", async ({
    browser,
    baseURL,
}) => {
    const s = await aufbau(browser, baseURL!);
    await bitteUndHinweis(s);

    await s.a.getByTestId("freigabe-hinweis-spaeter").click();
    await expect(hinweis(s.a)).toHaveCount(0);
    expect(s.ort.gesendet).toEqual([]);
    expect(s.server.sperre?.halter.name).toBe("Valentin");
    expect(s.server.bitten.map((bitte) => bitte.stand)).toEqual(["later"]);
    await expect(einwohner(s.a)).toHaveValue("2.500");

    await s.b.clock.fastForward(10_000);
    await expect(s.b.getByTestId("toast")).toHaveText("„Gratenfels“: Später: wird noch bearbeitet.");
    await expect(kastenStatus(s.b)).toHaveText("Später: wird noch bearbeitet.");
    await expect(bittenKnopf(s.b)).toBeVisible();
    await expect(s.b.getByTestId("sperre-schild")).toBeVisible();
    await s.schliessen();
});

test("🔴 Abgelaufen: ohne Antwort liest Thomas nach fünf Minuten „Abgelaufen“, und Valentins Hinweis ist weg", async ({
    browser,
    baseURL,
}) => {
    const s = await aufbau(browser, baseURL!);
    await bitteUndHinweis(s);

    laufeAb(s.server);
    await s.b.clock.fastForward(10_000);
    await expect(s.b.getByTestId("toast")).toHaveText("„Gratenfels“: Abgelaufen: keine Antwort.");
    await expect(kastenStatus(s.b)).toHaveText("Abgelaufen: keine Antwort.");
    await expect(bittenKnopf(s.b)).toBeVisible();
    // Valentins nächster Herzschlag nennt die Bitte nicht mehr: Der Hinweis verschwindet.
    await s.a.clock.fastForward(60_000);
    await expect(hinweis(s.a)).toHaveCount(0);
    expect(s.server.sperre?.halter.name).toBe("Valentin");
    await s.schliessen();
});

test("🔴 Speichern scheitert (409): die Sperre bleibt, der Hinweis nennt den Grund, die Bitte bleibt unbeantwortet", async ({
    browser,
    baseURL,
}) => {
    const s = await aufbau(browser, baseURL!);
    await bitteUndHinweis(s);

    s.ort.antworten.push({
        status: 409,
        body: {
            error: {
                code: "edit_conflict",
                message: "Jemand hat das gerade geändert.",
                details: { currentRevision: 8, changedBy: { id: "p", displayName: "Rondrikan" } },
            },
        },
    });
    await s.a.getByTestId("freigabe-hinweis-freigeben").click();
    await expect(s.a.getByTestId("freigabe-hinweis-fehler")).toHaveText(
        "Nicht gespeichert, die Sperre bleibt. Ein anderer hat das Objekt inzwischen geändert; der Konflikt ist im Fenster zu lösen.",
    );
    // Der Hinweis bleibt mit beiden Knöpfen; Entwurf und Sperre stehen.
    await expect(s.a.getByTestId("freigabe-hinweis-freigeben")).toBeEnabled();
    await expect(s.a.getByTestId("freigabe-hinweis-spaeter")).toBeEnabled();
    await expect(einwohner(s.a)).toHaveValue("2.500");
    expect(s.server.sperre?.halter.name).toBe("Valentin");
    expect(s.server.bitten.map((bitte) => bitte.stand)).toEqual(["open"]);
    expect(s.server.aufrufe.some((aufruf) => aufruf === "A POST /request/answer")).toBe(false);

    // Thomas liest keine Antwort: Die Anfrage bleibt offen, das Schild steht.
    await s.b.clock.fastForward(10_000);
    await expect(kastenStatus(s.b)).toContainText("Anfrage gesendet, läuft ab um");
    await expect(s.b.getByTestId("toast")).toHaveCount(0);
    await expect(s.b.getByTestId("sperre-schild")).toBeVisible();

    // „Später“ beantwortet sie trotzdem; der Hinweis geht.
    await s.a.getByTestId("freigabe-hinweis-spaeter").click();
    await expect(hinweis(s.a)).toHaveCount(0);
    expect(s.server.bitten.map((bitte) => bitte.stand)).toEqual(["later"]);
    await s.schliessen();
});
