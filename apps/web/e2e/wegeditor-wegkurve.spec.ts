import { expect, test, type Page, type Route } from "@playwright/test";
import { catmullRomLine } from "@avesmaps3d/shared";
import type {
    EditorPathDetail,
    EditorPathEnds,
    EditorPathStreet,
    EditorPathTargets,
    PathCarriedPoint,
    PathUpdateBody,
    PathUpdateReceipt,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS, GRATENFELS_LAGE, editorPanelVorn } from "./ortseditor-stub.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Wegkurve bearbeiten“ am echten Stack (WI-0177; Blatt A2 und B; EDIT-0003 F11, T27): ein Entwurf, den „Fertig“ in EINER Operation
 * schreibt, mit der gemeinsamen Leiste oben mittig über der Karte.
 *
 * Seit W5b Schritt 3 ist die Kurve die Form im EINEN Entwurf der Straße: Der Start öffnet ihr Fenster, „Fertig“ schreibt `path.update`
 * mit `shape` samt der Revisionen aller Abschnitte.
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung (W15): Weg, Straße, Andockziele, der Partnerweg und `path.update` kommen aus
 * einem Stub; den echten Schreibweg samt Mitziehen und Bestätigung prüft `apps/server/test/editor-path-edit.test.ts` gegen die
 * Testdatenbank. Gezogen wird mit der Maus an den Anfassern des Geometrie-Moduls; gemessen wird, was gesendet wird und was gezeichnet
 * ist (Ebenen des Moduls, Ringe der SVG-Lage).
 */

declare global {
    /** Die Steuerung der Wegkurve (nur Entwicklung, `app.vue`). */
    var avesmapsWegkurve:
        { starte(publicId: string): Promise<void>; laufend: { value: { publicId: string } | undefined } } | undefined;
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
const WEG = "0b6f0c55-0000-4000-8000-0000000000f1";
const STICH = "0b6f0c55-0000-4000-8000-0000000000f2";
const LANDSTRASSE = "0b6f0c55-0000-4000-8000-0000000000f3";

const G = GRATENFELS_LAGE;
const p = (dx: number, dy: number) => ({
    x: Math.round((G.x + dx) * 1e5) / 1e5,
    y: Math.round((G.y + dy) * 1e5) / 1e5,
});
/** Der Weg beginnt an Gratenfels, am zweiten Stützpunkt hängt der Stich, das Ende ist frei. */
const PUNKTE = [p(0, 0), p(4, 2), p(8, 0), p(12, 3)];
/** Ein Stützpunkt der Landstraße, an dem das freie Ende einrasten kann. */
const ANDOCK = p(14, 2);

const ENDEN_FREI: EditorPathEnds = {
    start: { kind: "place", publicId: GRATENFELS, name: "Gratenfels" },
    end: { kind: "free" },
};

function wegDetail(revision: number, punkte = PUNKTE): EditorPathDetail {
    return {
        publicId: WEG,
        revision,
        name: "Gratenfelser Weg",
        subtype: "Weg",
        labelVisible: true,
        isBach: false,
        flowDirection: null,
        sourceSystem: "legacy",
        active: true,
        points: punkte,
        ends: ENDEN_FREI,
    };
}

const STICH_WEG: EditorPathDetail = {
    ...wegDetail(8, [PUNKTE[1]!, p(4, 8)]),
    publicId: STICH,
    name: "Pfad-3443",
    subtype: "Pfad",
    ends: { start: { kind: "free" }, end: { kind: "free" } },
};

const ZIELE: EditorPathTargets = {
    margin: 15,
    peaks: [],
    places: [{ publicId: GRATENFELS, name: "Gratenfels", ...G }],
    vertices: [
        { pathId: STICH, name: "Pfad-3443", index: 0, ...PUNKTE[1]!, end: true, revision: 8 },
        { pathId: STICH, name: "Pfad-3443", index: 1, ...p(4, 8), end: true, revision: 8 },
        { pathId: LANDSTRASSE, name: "Landstraße", index: 2, ...ANDOCK, end: false, revision: 4 },
    ],
};

/** Ein Seeufer neben dem Weg, waagrecht von (6|-1,5) bis (10|-1,5), und ein anderer Fluss senkrecht bei x = 13, hinter dem freien Ende (Vali 2026-11-08). */
const SEE = "0b6f0c55-0000-4000-8000-0000000000a1";
const NEBENFLUSS = "0b6f0c55-0000-4000-8000-0000000000f4";
const UFER = { a: p(6, -1.5), b: p(10, -1.5) };
const FLUSS_ZIELE: EditorPathTargets = {
    ...ZIELE,
    areaEdges: [{ areaId: SEE, name: "Probesee", a: [UFER.a.x, UFER.a.y], b: [UFER.b.x, UFER.b.y] }],
    riverEdges: [
        { pathId: NEBENFLUSS, name: "Nebenbach", index: 0, a: [p(13, -1).x, p(13, -1).y], b: [p(13, 5).x, p(13, 5).y] },
    ],
};

/** Was „Fertig“ von der Kurve geschickt hat: der Abschnitt mit seiner Revision aus `sections`, Punkte und Mitgezogene. */
interface Kurve {
    operationId: string;
    publicId: string;
    baseRevision: number | undefined;
    points: { x: number; y: number }[];
    carried: PathCarriedPoint[];
}

/** Die Straße eines Abschnitts, wie das Wege-Fenster sie liest: der Abschnitt ist ihr Anker und ihr einziger Abschnitt. */
const strasseVon = (id: string, revision: number, punkte: number): EditorPathStreet => ({
    id,
    name: "Gratenfelser Weg",
    subtype: "Weg",
    isBach: false,
    circle: "halb-rechts",
    labelVisible: true,
    segments: [{ id, revision, labelVisible: true, wiki: false, points: punkte }],
});

interface Server {
    gesendet: Kurve[];
    /** Die Aufrufe der Sperre (nehmen, schlagen, freigeben), ohne Liste. */
    sperren: string[];
    /** Hält ein anderer den Weg, heißt er so; sonst nimmt der Test die Sperre. */
    gehaltenVon: string | undefined;
    revision: number;
    /** Was zuletzt gespeichert ist: Das frische Lesen nach der Quittung liefert es. */
    punkte: { x: number; y: number }[];
    /** Hält ein anderer den Weg beim Schreiben (409 `object_locked`), heißt er so. */
    schreibenGesperrtVon?: string | undefined;
    /** Was die Wegkurve je Zielabfrage als `?layers=` mitschickte (`null`: nichts). */
    ebenen: (string | null)[];
}

async function stub(page: Page, fluss = false): Promise<Server> {
    const server: Server = {
        gesendet: [],
        sperren: [],
        gehaltenVon: undefined,
        revision: 5,
        punkte: PUNKTE,
        ebenen: [],
    };
    const ziele = fluss ? FLUSS_ZIELE : ZIELE;
    const weg = (revision: number, punkte = PUNKTE): EditorPathDetail => ({
        ...wegDetail(revision, punkte),
        ...(fluss ? { subtype: "Flussweg", name: "Gratenbach" } : {}),
    });
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    // Ein Abschnitt aus den echten Kacheln (Rechtsklick): Er bekommt den Weg des Tests unter seiner Kennung. Zuerst eingehängt, damit die
    // genaueren Routen unten vorgehen.
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}$/, (route) => {
        const id = route.request().url().split("/").at(-1)!;
        return json(route, 200, { ...weg(server.revision, server.punkte), publicId: id });
    });
    // Mit `?layers=…`: die sichtbaren Ebenen der Derographie, deren Flächen ein Fluss als Ziele bekommt (Vali 2026-11-08).
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/targets(\?.*)?$/, (route) => json(route, 200, ziele));
    // Die Straße des Abschnitts für sein Fenster (W5b): Er ist ihr Anker.
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        const id = route.request().url().split("/").at(-2)!;
        return json(route, 200, strasseVon(id, server.revision, server.punkte.length));
    });
    // Die Sperre während der Bearbeitung (EDIT-0003 §4): nehmen, schlagen, freigeben, nie gegen die Datenbank der Entwicklung.
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET") return json(route, 200, { locks: [] });
        server.sperren.push(url.slice(url.indexOf("/api/editor/locks")));
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat")) return json(route, 200, { lost: [] });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        const lock = {
            kind: body.kind,
            id: body.id,
            part: body.part,
            person: { id: "a4a4a4a4-0000-4000-8000-0000000000f1", name: server.gehaltenVon ?? "Rondrikan" },
            since: "2026-10-16T12:00:00.000Z",
            heartbeatAt: "2026-10-16T12:00:00.000Z",
            own: server.gehaltenVon === undefined,
        };
        return server.gehaltenVon === undefined
            ? json(route, 200, { lock })
            : json(route, 409, { error: { code: "object_locked", message: "…", details: { lock } } });
    });
    await stubAdmin(page, { capabilities: RECHTE, role: "editor" });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(`**/api/editor/paths/${WEG}`, (route) => json(route, 200, weg(server.revision, server.punkte)));
    await page.route(`**/api/editor/paths/${STICH}`, (route) => json(route, 200, STICH_WEG));
    await page.route(new RegExp(`/api/editor/paths/${WEG}/targets(\\?.*)?$`), (route) => {
        server.ebenen.push(new URL(route.request().url()).searchParams.get("layers"));
        return json(route, 200, ziele);
    });
    // Jeder Abschnitt, auch einer aus den echten Kacheln (Rechtsklick): Nie geht ein Schreiben an den Server der Entwicklung.
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/update$/, (route) => {
        const anker = route.request().url().split("/").at(-2)!;
        const update = route.request().postDataJSON() as PathUpdateBody;
        const shape = update.shape;
        if (shape === undefined)
            return json(route, 400, { error: { code: "validation_failed", message: "ohne Kurve" } });
        const id = shape.publicId;
        const body: Kurve = {
            operationId: update.operationId,
            publicId: id,
            baseRevision: update.sections.find((teil) => teil.publicId === id)?.baseRevision,
            points: shape.points,
            carried: shape.carried,
        };
        if (server.schreibenGesperrtVon !== undefined)
            return json(route, 409, {
                error: {
                    code: "object_locked",
                    message: `${server.schreibenGesperrtVon} bearbeitet das gerade.`,
                    details: {
                        lock: {
                            kind: "path",
                            id: anker,
                            part: "form",
                            person: { id: "x", name: server.schreibenGesperrtVon },
                        },
                    },
                },
            });
        server.gesendet.push(body);
        server.revision += 1;
        server.punkte = body.points;
        const angedockt = body.points.at(-1)!.x === ANDOCK.x && body.points.at(-1)!.y === ANDOCK.y;
        const quittung: PathUpdateReceipt = {
            operationId: body.operationId,
            status: "applied",
            environment: "development",
            affected: [
                { kind: "path", id, revision: server.revision },
                ...body.carried.map((c) => ({ kind: "path" as const, id: c.pathId, revision: c.baseRevision + 1 })),
            ],
            derivedWork: [],
            warnings: [],
            mapRevision: 70 + server.gesendet.length,
            ends: angedockt
                ? {
                      start: ENDEN_FREI.start,
                      end: {
                          kind: "path",
                          publicId: LANDSTRASSE,
                          name: "Landstraße",
                          subtype: "Strasse",
                          isBach: false,
                          contact: "stuetzpunkt",
                      },
                  }
                : ENDEN_FREI,
        };
        return json(route, 200, quittung);
    });
    return server;
}

/** Wo ein Anfasser des Moduls steht, in Seitenkoordinaten. */
async function anfasser(page: Page, index: number): Promise<{ x: number; y: number }> {
    await page.waitForFunction(
        (i) =>
            (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }) ?? []).some(
                (f) => f.properties["index"] === i,
            ),
        index,
    );
    return page.evaluate((i) => {
        const map = globalThis.avesmapsMap!;
        const feature = map
            .queryRenderedFeatures({ layers: ["geometrie-anfasser"] })
            .find((f) => f.properties["index"] === i)!;
        const [lng, lat] = feature.geometry.coordinates;
        const at = map.project({
            lng,
            lat,
        });
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, index);
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

const ringe = (page: Page, art: string) => page.locator(`[data-testid="geometrie-ringe"] circle[data-ring="${art}"]`);
const leiste = (page: Page) => page.getByTestId("wegkurve-leiste");
const ungespeichert = (page: Page) => page.getByTestId("wegkurve-leiste-ungespeichert");
const hinweis = (page: Page) => page.getByTestId("toast");
/** Ein Stützpunkt ziehen und loslassen. */
async function ziehe(page: Page, index: number, dx: number, dy: number): Promise<void> {
    const griff = await anfasser(page, index);
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x + dx, griff.y + dy, { steps: 8 });
    await page.mouse.up();
}
const modusAktiv = (page: Page) =>
    page.evaluate(() => globalThis.avesmapsMap?.getStyle().layers.some((l) => l.id === "geometrie-kante") === true);

async function starte(page: Page): Promise<Server> {
    const server = await stub(page);
    await openMap(page, EDITOR_MODE);
    await showPlace(page, p(6, 2), 7);
    await page.waitForFunction(() => globalThis.avesmapsWegkurve !== undefined);
    await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
    await expect.poll(() => modusAktiv(page)).toBe(true);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    // Der Start öffnet das Fenster der Straße (W5b): Weg und Andockziel in die freie Mitte daneben.
    await showPlace(page, p(7, 2), 7);
    return server;
}

test("🔴 der Modus zeichnet den Weg rot mit einem Anfasser je Stützpunkt, die Leiste steht oben mittig über der Karte", async ({
    page,
}) => {
    await starte(page);
    await expect(leiste(page)).toBeVisible();
    await expect(leiste(page)).toContainText("Wegkurve bearbeiten");
    await expect(leiste(page)).toContainText("Gratenfelser Weg");
    await expect(leiste(page)).toContainText("Enter schreibt");
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");
    // Oben auf der Karte, nicht in einem eingeklappten Fenster (EDIT-0003 §2a).
    const karte = (await page.locator(".maplibregl-canvas").boundingBox())!;
    const box = (await leiste(page).boundingBox())!;
    expect(box.y).toBeLessThan(karte.y + karte.height / 4);
    const anzahl = await page.evaluate(
        () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }).length,
    );
    expect(anzahl).toBe(PUNKTE.length);
    await expect(ringe(page, "huelle")).toHaveCount(2);
    await expect(ringe(page, "frei")).toHaveCount(1);
});

test("🔴 jede Handbewegung ist ein Schritt ohne Serverfrage; „Fertig“ schreibt EINE Operation samt Mitgezogenem und beendet den Modus", async ({
    page,
}) => {
    const server = await starte(page);
    const fragen: string[] = [];
    // Die Besuchsmeldung (`/api/besuch`) zählt nicht: Sie meldet die Sitzung, sie fragt nichts zum Weg.
    page.on("request", (request) => {
        if (request.url().includes("/api/") && !request.url().includes("/api/besuch")) fragen.push(request.url());
    });
    await ziehe(page, 1, 40, -30);
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await ziehe(page, 2, 20, 20);
    await expect(ungespeichert(page)).toHaveText("2 ungespeichert");
    expect(fragen).toEqual([]);
    expect(server.gesendet).toEqual([]);

    const neueKacheln = page.waitForRequest((request) =>
        /\/tiles\/vector\/path_render\/.*\?r=71$/u.test(request.url()),
    );
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await neueKacheln;
    expect(server.gesendet).toHaveLength(1);
    const body = server.gesendet[0]!;
    expect(body.baseRevision).toBe(5);
    expect(body.points).toHaveLength(PUNKTE.length);
    expect(body.points[0]).toEqual(PUNKTE[0]);
    expect(body.points[1]!.x).toBeGreaterThan(PUNKTE[1]!.x);
    expect(body.points[2]!.x).toBeGreaterThan(PUNKTE[2]!.x);
    // Der Stich hing genau am gezogenen Stützpunkt, ohne Ort: Sein Anfang zieht mit, gegen seine Revision.
    expect(body.carried).toEqual([{ pathId: STICH, index: 0, baseRevision: 8, from: PUNKTE[1], to: body.points[1] }]);
    await expect(hinweis(page)).toContainText(
        "✓ „Gratenfelser Weg“ gespeichert. Anfang hängt an Gratenfels, das Ende ist frei. Mitgezogen: Unbezeichneter Pfad.",
    );
    await expect.poll(() => modusAktiv(page)).toBe(false);
    await expect(leiste(page)).toHaveCount(0);
});

test("🔴 das freie Ende rastet im Fangradius an einem Stützpunkt ein: Kringel VOR dem Loslassen; Enter schreibt genau den Punkt", async ({
    page,
}) => {
    const server = await starte(page);
    const ende = await anfasser(page, PUNKTE.length - 1);
    const ziel = await aufSeite(page, ANDOCK);
    await page.mouse.move(ende.x, ende.y);
    await page.mouse.down();
    await page.mouse.move(ziel.x + 5, ziel.y - 4, { steps: 10 });
    await expect(ringe(page, "kringel")).toHaveCount(1);
    await page.mouse.up();
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await page.keyboard.press("Enter");
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.points.at(-1)).toEqual(ANDOCK);
    await expect(hinweis(page)).toContainText("Anfang hängt an Gratenfels, Ende an Landstraße.");
});

test.describe("Ein Fluss rastet überall an Flächen und Flüssen ein (Vali 2026-11-08), bei 900 px Breite", () => {
    test.use({ viewport: { width: 900, height: 900 } });

    test("🔴 ein innerer Flusspunkt rastet am Seeufer auf der Linie ein, das Ende am anderen Fluss: Kringel VOR dem Loslassen; Enter schreibt genau die Fußpunkte", async ({
        page,
    }) => {
        // In 900 px decken Routenplaner, Editorpanel und das angedockte Wege-Fenster zusammen fast die ganze Karte (gemessen: freieste
        // Stelle 54 px; das Fenster liegt dann sogar über dem Knopf des Routenplaners). Wie man es in dieser Breite tut: Routenplaner und
        // Editorpanel vor dem Start einklappen (auch „Liste schließen“ im Fenster ist dann verdeckt). Dann Ufer, Punkt und der andere Fluss
        // etwas kleiner an die freieste Stelle (die Rasterstelle mit dem größten Abstand zu allem, was die Karte verdeckt).
        const server = await stub(page, true);
        await openMap(page, EDITOR_MODE);
        await page.getByRole("button", { name: "Routenplaner", exact: true }).click();
        await page.getByRole("button", { name: "Editor", exact: true }).click();
        await showPlace(page, p(6, 2), 7);
        await page.waitForFunction(() => globalThis.avesmapsWegkurve !== undefined);
        await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
        await expect.poll(() => modusAktiv(page)).toBe(true);
        // Standard: alle drei Ebenen der Derographie gehen mit.
        expect(server.ebenen.at(-1)).toBe("derographisch,vegetation,topographie");
        await expect(leiste(page)).toBeVisible();
        await showPlace(page, p(10.5, 0.75), 5.5);
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        const mitte = await aufSeite(page, p(10.5, 0.75));
        const frei = await page.evaluate(() => {
            const rahmen = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
            const schritt = 15;
            const punkte: { x: number; y: number; frei: boolean }[] = [];
            for (let y = rahmen.top + schritt / 2; y < rahmen.bottom; y += schritt)
                for (let x = rahmen.left + schritt / 2; x < rahmen.right; x += schritt)
                    punkte.push({ x, y, frei: document.elementFromPoint(x, y)?.closest(".maplibregl-map") != null });
            const zu = punkte.filter((q) => !q.frei);
            let best = { x: rahmen.left + rahmen.width / 2, y: rahmen.top + rahmen.height / 2, r: 0 };
            for (const q of punkte) {
                if (!q.frei) continue;
                let r = Math.min(q.x - rahmen.left, rahmen.right - q.x, q.y - rahmen.top, rahmen.bottom - q.y);
                for (const z of zu) r = Math.min(r, Math.hypot(z.x - q.x, z.y - q.y));
                if (r > best.r) best = { x: q.x, y: q.y, r };
            }
            return best;
        });
        test.info().annotations.push({
            type: "900 px",
            description: `freieste Stelle ${JSON.stringify(frei)}, Wegmitte vorher ${JSON.stringify(mitte)}`,
        });
        expect(frei.r).toBeGreaterThan(85);
        await page.evaluate(
            ([dx, dy]) => {
                const map = globalThis.avesmapsMap!;
                const rahmen = map.getCanvas().getBoundingClientRect();
                map.jumpTo({ center: map.unproject([rahmen.width / 2 + dx!, rahmen.height / 2 + dy!]) });
            },
            [mitte.x - frei.x, mitte.y - frei.y],
        );
        await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
        const aufKarte = (q: { x: number; y: number }) =>
            page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.closest(".maplibregl-map") != null, q);
        const innen = await anfasser(page, 2);
        const ufer = await aufSeite(page, p(8, -1.5));
        for (const q of [innen, ufer, await anfasser(page, PUNKTE.length - 1), await aufSeite(page, p(13, 3))])
            expect(await aufKarte(q)).toBe(true);
        await page.mouse.move(innen.x, innen.y);
        await page.mouse.down();
        // Senkrecht neben das Ufer, innerhalb des Fangradius: Der Punkt springt auf die Linie, nicht auf eine Ecke.
        await page.mouse.move(ufer.x, ufer.y + (ufer.y > innen.y ? 5 : -5), { steps: 10 });
        await expect(ringe(page, "kringelKante")).toHaveCount(1);
        await page.mouse.up();
        const ende = await anfasser(page, PUNKTE.length - 1);
        const fluss = await aufSeite(page, p(13, 3));
        await page.mouse.move(ende.x, ende.y);
        await page.mouse.down();
        await page.mouse.move(fluss.x - 5, fluss.y, { steps: 10 });
        await expect(ringe(page, "kringelKante")).toHaveCount(1);
        await page.mouse.up();
        await expect(ungespeichert(page)).toHaveText("2 ungespeichert");
        await page.keyboard.press("Enter");
        await expect.poll(() => server.gesendet.length).toBe(1);
        const punkte = server.gesendet[0]!.points;
        expect(punkte[2]!.y).toBeCloseTo(UFER.a.y, 6);
        expect(punkte[2]!.x).toBeCloseTo(p(8, 0).x, 1);
        expect(punkte.at(-1)!.x).toBeCloseTo(p(13, 0).x, 6);
        expect(punkte.at(-1)!.y).toBeCloseTo(p(0, 3).y, 1);
    });
});

test("🔴 Strg beim Ziehen: nichts rastet ein, nichts zieht mit", async ({ page }) => {
    const server = await starte(page);
    const ende = await anfasser(page, PUNKTE.length - 1);
    const ziel = await aufSeite(page, ANDOCK);
    await page.mouse.move(ende.x, ende.y);
    await page.mouse.down();
    await page.mouse.move(ende.x + 10, ende.y + 10, { steps: 3 });
    await page.keyboard.down("Control");
    await page.mouse.move(ziel.x + 5, ziel.y - 4, { steps: 6 });
    await expect(ringe(page, "kringel")).toHaveCount(0);
    await page.keyboard.up("Control");
    await page.mouse.up();
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.points.at(-1)).not.toEqual(ANDOCK);
    expect(server.gesendet[0]!.carried).toEqual([]);
});

test("🔴 Strg VOR dem Druck auf dem Stützpunkt, den der Stich teilt: die Karte dreht nicht, der Stich bleibt liegen (Thomas 2.2)", async ({
    page,
}) => {
    const server = await starte(page);
    const richtung = () => page.evaluate(() => globalThis.avesmapsMap!.getBearing());
    const vorher = await richtung();
    const griff = await anfasser(page, 1);
    await page.keyboard.down("Control");
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x + 50, griff.y - 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    // Nur der gezogene Weg nimmt den Punkt mit: kein Mitgezogenes, der Stich liegt, wo er lag.
    expect(server.gesendet[0]!.carried).toEqual([]);
    expect(server.gesendet[0]!.points[1]).not.toEqual(PUNKTE[1]);
    expect(await richtung()).toBeCloseTo(vorher, 5);
});

test("🔴 im Modus dreht Strg + Ziehen die Karte auch neben dem Weg nicht, die Mitteltaste schon (Vali 2026-11-06)", async ({
    page,
}) => {
    await starte(page);
    const richtung = () => page.evaluate(() => globalThis.avesmapsMap!.getBearing());
    const vorher = await richtung();
    const griff = await anfasser(page, 1);
    const frei = { x: griff.x, y: griff.y + 150 };
    await page.keyboard.down("Control");
    await page.mouse.move(frei.x, frei.y);
    await page.mouse.down();
    await page.mouse.move(frei.x + 100, frei.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    expect(await richtung()).toBeCloseTo(vorher, 5);
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");

    await page.mouse.move(frei.x, frei.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(frei.x + 50, frei.y, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    expect(await richtung()).toBeCloseTo(vorher + 40, 0);
});

test("🔴 Doppelklick setzt und löscht Stützpunkte als Schritte, an einem Ende nichts; ↶ ↷ mit Taste und Knopf", async ({
    page,
}) => {
    const server = await starte(page);
    const zahl = () =>
        page.evaluate(() => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-anfasser"] }).length);
    // Auf die Kurve zwischen dem dritten und vierten Stützpunkt, aus derselben Rechnung wie die Karte: acht Stellen je Abschnitt.
    const linie = await aufSeite(page, catmullRomLine(PUNKTE)[2 * 8 + 4]!);
    await page.mouse.dblclick(linie.x, linie.y);
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await expect.poll(zahl).toBe(PUNKTE.length + 1);
    const innen = await anfasser(page, 1);
    await page.mouse.dblclick(innen.x, innen.y);
    await expect(ungespeichert(page)).toHaveText("2 ungespeichert");
    await expect.poll(zahl).toBe(PUNKTE.length);
    const anfang = await anfasser(page, 0);
    await page.mouse.dblclick(anfang.x, anfang.y);
    await page.waitForTimeout(400);
    await expect(ungespeichert(page)).toHaveText("2 ungespeichert");

    await page.keyboard.press("Control+z");
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await expect.poll(zahl).toBe(PUNKTE.length + 1);
    await page.keyboard.press("Control+y");
    await expect(ungespeichert(page)).toHaveText("2 ungespeichert");
    await page.getByTestId("wegkurve-leiste-zurueck").click();
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    expect(server.gesendet).toEqual([]);
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    expect(server.gesendet[0]!.points).toHaveLength(PUNKTE.length + 1);
});

test("🔴 Esc im Zug: der Punkt zurück, kein Schritt; ohne Schritte beendet Esc den Modus", async ({ page }) => {
    const server = await starte(page);
    const griff = await anfasser(page, 2);
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(griff.x + 60, griff.y + 50, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // Die Karte zeichnet den Rückweg erst im nächsten Bild: so lange zeigt sie den Anfasser noch am Zeiger.
    await expect.poll(async () => Math.abs((await anfasser(page, 2)).x - griff.x)).toBeLessThan(1.5);
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");
    expect(await modusAktiv(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect.poll(() => modusAktiv(page)).toBe(false);
    await expect(leiste(page)).toHaveCount(0);
    await expect(page.locator('[data-testid="geometrie-ringe"]')).toHaveCount(0);
    expect(server.gesendet).toEqual([]);
});

test("🔴 Esc mit ungespeicherten Schritten fragt (R2): „Weiter bearbeiten“ bleibt, „Verwerfen“ endet ohne zu senden", async ({
    page,
}) => {
    const server = await starte(page);
    await ziehe(page, 2, 30, 30);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("wegkurve-leiste-frage")).toContainText("1 ungespeichert.");
    await page.getByTestId("wegkurve-leiste-frage-nein").click();
    await expect(page.getByTestId("wegkurve-leiste-frage")).toHaveCount(0);
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await page.keyboard.press("Escape");
    await page.getByTestId("wegkurve-leiste-frage-ja").click();
    await expect.poll(() => modusAktiv(page)).toBe(false);
    expect(server.gesendet).toEqual([]);
});

test("„Verwerfen“ in der Leiste stellt den Stand vom Start her, der Modus bleibt", async ({ page }) => {
    const server = await starte(page);
    const vorher = await anfasser(page, 2);
    await ziehe(page, 2, 40, 30);
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    await page.getByTestId("wegkurve-leiste-verwerfen").click();
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");
    await expect.poll(async () => Math.abs((await anfasser(page, 2)).x - vorher.x)).toBeLessThan(1.5);
    await expect(hinweis(page)).toContainText("Änderungen an „Gratenfelser Weg“ verworfen.");
    expect(await modusAktiv(page)).toBe(true);
    expect(server.gesendet).toEqual([]);
});

test("🔴 die Sperre: nehmen beim Start, freigeben beim Ende; hält ein anderer den Weg, beginnt der Modus nicht", async ({
    page,
}) => {
    const server = await starte(page);
    // Die Straße vorab (der Modus beginnt erst, wenn sie gilt) und die Bearbeitung, die sie übernimmt: dieselbe Kennung.
    expect(server.sperren).toEqual(["/api/editor/locks", "/api/editor/locks"]);
    await page.keyboard.press("Escape");
    await expect.poll(() => modusAktiv(page)).toBe(false);
    await expect.poll(() => server.sperren.at(-1)).toBe("/api/editor/locks/release");

    server.gehaltenVon = "Thomas";
    await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
    await expect(hinweis(page)).toContainText("„Gratenfelser Weg“ bearbeitet gerade Thomas.");
    expect(await modusAktiv(page)).toBe(false);
    await expect(leiste(page)).toHaveCount(0);
});

/** Eine Stelle auf einem gezeichneten Weg, von der Mitte aus gesucht, samt der Kennung seines Abschnitts. */
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

async function karteMitWegen(page: Page): Promise<Server> {
    const server = await stub(page);
    await openMap(page, EDITOR_MODE);
    await showPlace(page, p(6, 2), 7);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    return server;
}

test("🔴 hält beim „Fertig“ ein anderer den Weg (409 object_locked): Die Meldung nennt ihn, der Modus und der Entwurf bleiben", async ({
    page,
}) => {
    const server = await starte(page);
    server.schreibenGesperrtVon = "Thomas";
    await ziehe(page, 1, 30, 20);
    await expect(ungespeichert(page)).toContainText("1");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(/^wegeditor-fenster-\d+-zustand$/)).toContainText("Thomas bearbeitet das gerade.");
    expect(await modusAktiv(page)).toBe(true);
    await expect(ungespeichert(page)).toContainText("1");
    expect(server.gesendet).toEqual([]);
    // Ohne fremde Sperre schreibt dasselbe „Fertig“ wie bisher.
    server.schreibenGesperrtVon = undefined;
    await page.keyboard.press("Enter");
    await expect.poll(() => server.gesendet.length).toBe(1);
    await expect.poll(() => modusAktiv(page)).toBe(false);
});

test("🔴 Rechtsklick auf einen Weg: „Wegkurve bearbeiten“ im Kartenmenü startet den Modus am Abschnitt unter dem Zeiger", async ({
    page,
}) => {
    const server = await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-weg-wegkurve");
    await expect(eintrag).toBeEnabled();
    await expect(eintrag).toContainText("Wegkurve bearbeiten");
    await expect(page.getByTestId("context-editor-weg-vereinfachen")).toContainText("Wegkurve vereinfachen");
    await eintrag.click();
    await expect.poll(() => modusAktiv(page)).toBe(true);
    await expect(leiste(page)).toBeVisible();
    expect(server.sperren).toEqual(["/api/editor/locks", "/api/editor/locks"]);
    // Der Modus gilt dem Abschnitt unter dem Zeiger: Gelesen und gesperrt wurde seine Kennung.
    const gelesen = await page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId);
    expect(gelesen).toBe(stelle.id);
});

test("🔴 erster Klick die ganze Straße, zweiter der Abschnitt: dann steht „Wegkurve bearbeiten“ im Menü am Objekt (T24 (1))", async ({
    page,
}) => {
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    const leuchtet = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const ids = map.queryRenderedFeatures({ layers: ["area-selection-path"] }).map((f) => f.id);
            return [...new Set(ids)];
        });
    await page.mouse.click(stelle.x, stelle.y);
    await expect.poll(async () => (await leuchtet()).length).toBeGreaterThan(0);
    // Die ganze Straße: Am Objekt steht keine Wegkurve (wie Legacy).
    await expect(page.getByTestId("editor-action-weg-wegkurve-abschnitt")).toHaveCount(0);
    await page.waitForTimeout(450);
    await page.mouse.click(stelle.x, stelle.y);
    await expect.poll(leuchtet).toEqual([stelle.id]);
    const eintrag = page.getByTestId("editor-action-weg-wegkurve-abschnitt");
    await expect(eintrag).toBeVisible();
    await eintrag.click();
    await expect.poll(() => modusAktiv(page)).toBe(true);
    const gelesen = await page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId);
    expect(gelesen).toBe(stelle.id);
});

test("🔴 „Wegkurve vereinfachen“ am Rechtsklick: Regler in der Leiste, Vorschau sofort, ↶ als Taste, „Fertig“ schreibt EINE Operation ohne Mitgezogene (W3)", async ({
    page,
}) => {
    const server = await karteMitWegen(page);
    // Ein zittriger Weg: Anfang an Gratenfels, Knoten mit dem Stich, freies Ende; dazwischen drei Punkte, die kaum von der Geraden
    // zum Ende abweichen.
    const zittrig = [p(0, 0), PUNKTE[1]!, p(6, 2.26), p(8, 2.49), p(10, 2.76), p(12, 3)];
    server.punkte = zittrig;
    const stelle = await wegStelle(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-weg-vereinfachen");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    await expect.poll(() => modusAktiv(page)).toBe(true);
    await expect(leiste(page)).toContainText("Wegkurve vereinfachen");
    // Der Regler steht IN der Leiste, unter ihrer Zeile; die Vorgabe ist der erste Schritt.
    const regler = page.getByTestId("wegkurve-leiste-zusatz").getByTestId("vereinfachen-staerke");
    await expect(regler).toHaveValue("4");
    await expect(ungespeichert(page)).toContainText("1");
    const zahlen = page.getByTestId("vereinfachen-zahlen");
    await expect(zahlen).toContainText("6 → 3 Stützpunkte · 3 fest");
    // Keine Anfasser zum Ziehen; der alte Verlauf gestrichelt, die wegfallenden Punkte als Ringe.
    const gezeichnet = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            const zahl = (layer: string) => map.queryRenderedFeatures({ layers: [layer] }).length;
            return { alt: zahl("geometrie-alt") > 0, weg: zahl("geometrie-andock") };
        });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await expect.poll(gezeichnet).toEqual({ alt: true, weg: 3 });
    // Auf 0: nichts fällt weg, ein zweiter Schritt; Strg+Z mit dem Regler in der Hand nimmt ihn zurück.
    await regler.fill("0");
    await expect(zahlen).toContainText("6 → 6 Stützpunkte");
    await expect(ungespeichert(page)).toContainText("2");
    await regler.focus();
    await page.keyboard.press("Control+z");
    await expect(regler).toHaveValue("4");
    await expect(ungespeichert(page)).toContainText("1");
    expect(server.gesendet).toEqual([]);
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await expect.poll(() => modusAktiv(page)).toBe(false);
    expect(server.gesendet).toHaveLength(1);
    expect(server.gesendet[0]!.points).toEqual([zittrig[0], zittrig[1], zittrig[5]]);
    expect(server.gesendet[0]!.carried).toEqual([]);
    expect(server.sperren).toEqual(["/api/editor/locks", "/api/editor/locks", "/api/editor/locks/release"]);
    await expect(hinweis(page)).toContainText("6 → 3 Stützpunkte");
});

test("🔴 Doppelklick auf einen Weg startet die Wegkurve am Abschnitt unter dem Zeiger, ohne dass die Karte zoomt (R3)", async ({
    page,
}) => {
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    const zoomVorher = await page.evaluate(() => globalThis.avesmapsMap!.getZoom());
    await page.mouse.dblclick(stelle.x, stelle.y);
    await expect.poll(() => modusAktiv(page)).toBe(true);
    const gelesen = await page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId);
    expect(gelesen).toBe(stelle.id);
    await page.waitForTimeout(400);
    // Ein Hinflug darf kommen (der Testweg liegt bei Gratenfels); gezoomt um eine Stufe am Zeiger wird nicht.
    expect(await page.evaluate(() => globalThis.avesmapsMap!.getZoom())).not.toBeCloseTo(zoomVorher + 1, 1);
    await page.keyboard.press("Escape");
    await expect.poll(() => modusAktiv(page)).toBe(false);
});

test("🔴 im Modus heißt der Doppelklick ins Leere „Fertig“: EINE Operation, der Modus endet (R3)", async ({ page }) => {
    const server = await starte(page);
    await ziehe(page, 2, 30, 20);
    await expect(ungespeichert(page)).toContainText("1");
    // Weit weg vom Weg (rund 380 Bildpunkte darunter), aber noch auf der Karte.
    const leer = await aufSeite(page, p(6, -4));
    await page.mouse.dblclick(leer.x, leer.y);
    await expect.poll(() => modusAktiv(page)).toBe(false);
    expect(server.gesendet).toHaveLength(1);
});

/** Eine Stelle, an der zwei verschiedene Wege übereinander laufen (eine Kreuzung ohne Ort, etwa Straße über Fluss). */
async function zweiWegeStelle(page: Page): Promise<{ x: number; y: number; namen: string[] }> {
    const gefunden = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const layers = map
            .getStyle()
            .layers.map((l) => l.id)
            .filter((id) => id.startsWith("path-hit-"));
        const ortsLayers = map
            .getStyle()
            .layers.map((l) => l.id)
            .filter((id) => id === "place-marker" || id === "place-marker-structure");
        const leinwand = map.getCanvas();
        const breite = leinwand.clientWidth;
        const hoehe = leinwand.clientHeight;
        for (let y = Math.round(hoehe * 0.15); y < hoehe * 0.9; y += 5) {
            for (let x = Math.round(breite * 0.2); x < breite * 0.75; x += 5) {
                if (map.queryRenderedFeatures([x, y], { layers: ortsLayers }).length > 0) continue;
                const strassen = new Set<string>();
                for (const f of map.queryRenderedFeatures([x, y], { layers })) {
                    // Wie `editorPathGroupKey` (WI-0177 Schritt 2a): ein Weg ist sein echter Name, über Wegtypen hinweg; ohne echten
                    // Namen (leer, die eigene Wegart, ein Griff wie „Pfad-3443“, `isPathHandle`) ist jeder Abschnitt ein Weg für sich.
                    const name = String(f.properties["name"] ?? "").trim();
                    const griff = name === "" || name === String(f.properties["subtype"]) || /^\S+-\d+$/.test(name);
                    strassen.add(griff ? `#${String(f.properties["public_id"] ?? f.id)}` : `name:${name}`);
                }
                if (strassen.size >= 2) {
                    const rahmen = leinwand.getBoundingClientRect();
                    return { x: rahmen.left + x, y: rahmen.top + y, namen: [...strassen] };
                }
            }
        }
        return undefined;
    });
    expect(gefunden, "eine Stelle mit zwei Wegen").toBeDefined();
    return gefunden!;
}

// Gezählt wie die Wegeliste (`zweiWegeStelle`): Zwei Abschnitte desselben Griffs sind zwei Wege, ein Name über zwei Wegtypen einer.
test("🔴 laufen mehrere Wege unter dem Rechtsklick: „Hier laufen N Wege“, je Weg sein Untermenü (T25)", async ({
    page,
}) => {
    await karteMitWegen(page);
    const stelle = await zweiWegeStelle(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await expect(page.getByTestId("context-editor-kopf-wege")).toContainText(
        `Hier laufen ${String(stelle.namen.length)} Wege`,
    );
    const eintraege = page.locator('[data-testid^="context-editor-weg-path:"]:not([data-testid$="-unter"])');
    await expect(eintraege).toHaveCount(stelle.namen.length);
    // Der zweite Weg: sein Untermenü startet die Wegkurve an SEINEM Abschnitt.
    const zweiter = eintraege.nth(1);
    // Die Kennung im Eintrag nennt den Abschnitt dieses Wegs: `weg-path:<public_id>`.
    const abschnitt = (await zweiter.getAttribute("data-testid"))!.replace("context-editor-weg-path:", "");
    await zweiter.hover();
    const unter = page.getByTestId(`context-editor-path:${abschnitt}|weg-wegkurve`);
    await expect(unter).toBeVisible();
    // Mit der Tastatur wie im Menü vorgesehen: den Eintrag fassen, Enter.
    await unter.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => modusAktiv(page), { timeout: 15_000 }).toBe(true);
    expect(await page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId)).toBe(abschnitt);
});

test("🔴 Rechtsklick auf einen inneren Stützpunkt: nur die Editor-Karte mit „Hier teilen“ und „Stützpunkt entfernen“; Teilen ist EINE Operation", async ({
    page,
}) => {
    const geteilt: unknown[] = [];
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/split$/, (route) => {
        const body = route.request().postDataJSON() as { operationId: string };
        geteilt.push(body);
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [
                    { kind: "path", id: WEG, revision: 6 },
                    { kind: "path", id: "0b6f0c55-0000-4000-8000-0000000000f9", revision: 1 },
                ],
                derivedWork: [],
                warnings: [],
                mapRevision: 80,
                publicId: "0b6f0c55-0000-4000-8000-0000000000f9",
                ends: { vorne: ENDEN_FREI, hinten: ENDEN_FREI },
            }),
        });
    });
    await starte(page);
    const griff = await anfasser(page, 2);
    await page.mouse.click(griff.x, griff.y, { button: "right" });
    await expect(page.getByTestId("context-editor")).toBeVisible();
    await expect(page.getByTestId("context-editor")).toContainText("Stützpunkt 3");
    // Die Karte der Besucher fehlt („nur Editor-Karte“).
    await expect(page.getByTestId("map-context-menu")).toHaveCount(0);
    await expect(page.getByTestId("context-editor-weg-stuetzpunkt-entfernen")).toBeEnabled();
    await page.getByTestId("context-editor-weg-stuetzpunkt-teilen").click();
    await expect.poll(() => geteilt.length).toBe(1);
    expect(geteilt[0]).toMatchObject({ baseRevision: 5, index: 2, at: PUNKTE[2] });
    await expect(leiste(page)).toBeHidden();
    await expect(hinweis(page)).toContainText("geteilt");

    // Am Ende steht beides gesperrt; ein Klick auf „Stützpunkt entfernen“ am inneren Punkt ist ein Schritt im Entwurf.
    await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
    await expect(leiste(page)).toBeVisible();
    const ende = await anfasser(page, 3);
    await page.mouse.click(ende.x, ende.y, { button: "right" });
    await expect(page.getByTestId("context-editor-weg-stuetzpunkt-teilen")).toBeDisabled();
    await page.keyboard.press("Escape");
    const innen = await anfasser(page, 1);
    await page.mouse.click(innen.x, innen.y, { button: "right" });
    await page.getByTestId("context-editor-weg-stuetzpunkt-entfernen").click();
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
});

test("🔴 „Weg hier teilen“ im Rechtsklick auf den Weg: teilt am inneren Stützpunkt unter dem Zeiger, EINE Operation (Thomas 2.1)", async ({
    page,
}) => {
    const geteilt: { url: string; body: unknown }[] = [];
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/split$/, (route) => {
        const body = route.request().postDataJSON() as { operationId: string };
        geteilt.push({ url: route.request().url(), body });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 82,
                publicId: "0b6f0c55-0000-4000-8000-0000000000fa",
                ends: { vorne: ENDEN_FREI, hinten: ENDEN_FREI },
            }),
        });
    });
    const server = await karteMitWegen(page);
    const stelle = await wegStelle(page);
    // Der Abschnitt unter dem Rechtsklick hat genau dort seinen inneren Stützpunkt.
    const hier = await page.evaluate(({ x, y }) => {
        const map = globalThis.avesmapsMap!;
        const rahmen = map.getCanvas().getBoundingClientRect();
        return globalThis.avesmapsRenderProjection!.fromRenderLngLat(map.unproject([x - rahmen.left, y - rahmen.top]));
    }, stelle);
    server.punkte = [{ x: hier.x - 5, y: hier.y - 5 }, hier, { x: hier.x + 5, y: hier.y + 5 }];
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    const eintrag = page.getByTestId("context-editor-weg-hier-teilen");
    await expect(eintrag).toContainText("Weg hier teilen");
    await expect(eintrag).toBeEnabled();
    await eintrag.click();
    await expect.poll(() => geteilt.length).toBe(1);
    expect(geteilt[0]!.url).toContain(stelle.id);
    expect(geteilt[0]!.body).toMatchObject({ baseRevision: 5, index: 1, at: hier });
    await expect(hinweis(page)).toContainText("geteilt");
    expect(await modusAktiv(page)).toBe(false);
});

test("🔴 „Weg entfernen …“ am Rechtsklick öffnet das Blatt: „Von der Karte nehmen“ und „Ganz löschen“ je EINE Operation", async ({
    page,
}) => {
    const geloescht: { url: string; body: unknown }[] = [];
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/(delete|take-off-map)$/, (route) => {
        const body = route.request().postDataJSON() as { operationId: string };
        geloescht.push({ url: route.request().url(), body });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 81,
            }),
        });
    });
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-weg-entfernen").click();
    const blatt = page.getByTestId("weg-entfernen");
    await expect(blatt).toBeVisible();
    await expect(page.getByTestId("weg-entfernen-los")).toBeDisabled();
    await page.getByTestId("weg-entfernen-abnehmen").click();
    await expect(page.getByTestId("weg-entfernen-los")).toHaveText("Von der Karte nehmen");
    await page.getByTestId("weg-entfernen-los").click();
    await expect.poll(() => geloescht.length).toBe(1);
    expect(geloescht[0]!.url).toContain(`/api/editor/paths/${stelle.id}/take-off-map`);
    expect(geloescht[0]!.body).toMatchObject({ baseRevision: 5 });
    await expect(blatt).toBeHidden();
    await expect(hinweis(page)).toContainText("von der Karte genommen");

    await page.mouse.click(stelle.x, stelle.y, { button: "right" });
    await page.getByTestId("context-editor-weg-entfernen").click();
    await page.getByTestId("weg-entfernen-loeschen").click();
    await expect(page.getByTestId("weg-entfernen-los")).toHaveText("Ganz löschen");
    await page.getByTestId("weg-entfernen-los").click();
    await expect.poll(() => geloescht.length).toBe(2);
    expect(geloescht[1]!.url).toContain(`/api/editor/paths/${stelle.id}/delete`);
    await expect(hinweis(page)).toContainText("gelöscht");
});

/** Ein zweiter Abschnitt der Straße, fern im Westen: Er steht im Untermenü als „außerhalb“ (T49). */
const FERN = "0b6f0c55-0000-4000-8000-0000000000f9";

/**
 * Die Straße zu jedem Abschnitt aus dem Stub (T49): erst der Abschnitt der Stelle, dann der ferne. 🪤 Gefragt wird mit dem Anker des
 * Gegenstands, und der ist nach der Antwort des Servers ein beliebiger Abschnitt der echten Straße: Die Antwort nennt deshalb immer
 * die Stelle, gemerkt wird sie trotzdem unter der Frage.
 */
async function strasseAusStub(page: Page, stelle: { id: string }, weitere = 0): Promise<string[]> {
    const gefragt: string[] = [];
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street$/, (route) => {
        gefragt.push(route.request().url().split("/").at(-2)!);
        const strasse: EditorPathStreet = {
            id: stelle.id,
            name: "Gratenfelser Weg",
            subtype: "Weg",
            isBach: false,
            circle: "halb-rechts",
            labelVisible: true,
            segments: [
                { id: stelle.id, revision: 5, labelVisible: true, wiki: false, points: 4, von: "Gratenfels" },
                {
                    id: FERN,
                    revision: 9,
                    labelVisible: true,
                    wiki: false,
                    points: 3,
                    bounds: [1, 1, 2, 2],
                    von: "Ferdok",
                    bis: "Angbar",
                },
                // Eine lange Straße (Reichsstraße 2 hat 75 Abschnitte): weitere ferne Abschnitte.
                ...Array.from({ length: weitere }, (_, i) => ({
                    id: `0b6f0c55-0000-4000-8000-${String(i).padStart(12, "0")}`,
                    revision: 1,
                    labelVisible: true,
                    wiki: false,
                    points: 2,
                    bounds: [1, 1, 2, 2] as [number, number, number, number],
                })),
            ],
        };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(strasse) });
    });
    return gefragt;
}

/** Was die Ebenen der Abschnitte gerade zeigen: den hervorgehobenen Abschnitt und die Nummern im Bild. */
const abschnitteAufKarte = (page: Page) =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        if (map.getLayer("weg-abschnitte-hervor") === undefined) return undefined;
        // Hervorgehoben ist seit der Wahl mehrerer Abschnitte eine Liste (`["literal", [...]]`); hier als Kennungen mit Komma.
        const roh = (map.getFilter("weg-abschnitte-hervor") as unknown[]).at(-1);
        const hervor = Array.isArray(roh) && roh[0] === "literal" ? (roh[1] as string[]).join(",") : roh;
        const nummern = map
            .queryRenderedFeatures({ layers: ["weg-abschnitte-nummern-text"] })
            .map((f) => String(f.properties["nr"]));
        return { hervor, nummern: [...new Set(nummern)].sort() };
    });

test("🔴 Abschnitte im Menü (T49): erster Klick – „Wegkurve bearbeiten ›“ nennt die Abschnitte, Zeigen leuchtet, die Wahl startet den Modus", async ({
    page,
}) => {
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await strasseAusStub(page, stelle);
    await page.mouse.click(stelle.x, stelle.y);
    const gruppe = page.getByTestId("context-editor-weg-wegkurve-strasse");
    await expect(gruppe).toContainText("Wegkurve bearbeiten");
    await expect(page.getByTestId("context-editor-weg-vereinfachen-strasse")).toContainText("Wegkurve vereinfachen");
    await expect(page.getByTestId("context-editor-weg-entfernen-strasse")).toBeVisible();
    // Der zweite Klick bleibt wie gebaut: Die flachen Einträge am markierten Abschnitt fehlen beim ersten.
    await expect(page.getByTestId("editor-action-weg-wegkurve-abschnitt")).toHaveCount(0);

    await gruppe.hover();
    const unter = page.getByTestId("context-editor-weg-wegkurve-strasse-unter");
    await expect(unter).toBeVisible();
    const erster = page.getByTestId(`context-editor-weg-wegkurve-strasse#${stelle.id}`);
    const ferner = page.getByTestId(`context-editor-weg-wegkurve-strasse#${FERN}`);
    await expect(erster).toHaveText("1 · Gratenfels – Abzweig");
    await expect(ferner).toContainText("2 · Ferdok – Angbar");
    await expect(ferner).toContainText("außerhalb");
    // Offenes Untermenü: die Nummern auf der Karte; Zeigen lässt den Abschnitt leuchten.
    await expect.poll(() => abschnitteAufKarte(page)).toEqual({ hervor: "", nummern: ["1"] });
    await erster.hover();
    await expect.poll(async () => (await abschnitteAufKarte(page))?.hervor).toBe(stelle.id);

    await erster.click();
    await expect.poll(() => modusAktiv(page)).toBe(true);
    const gelesen = await page.evaluate(() => globalThis.avesmapsWegkurve!.laufend.value?.publicId);
    expect(gelesen).toBe(stelle.id);
    // Das Menü ist zu; die Nummern auf der Karte sind jetzt die des Wege-Fensters (Leiste (W) (1) (2), Betreiber 2026-10-19), ohne
    // Leuchten: (W) ist der ganze Weg.
    await expect.poll(() => abschnitteAufKarte(page)).toEqual({ hervor: "", nummern: ["1"] });
});

test("🔴 „Wegkurve vereinfachen ›“ über „Wegkurve bearbeiten ›“ erreicht (T49): Nummern und Leuchten bleiben, auch wenn die Maus weiterzieht", async ({
    page,
}) => {
    // Befund des Betreibers auf der Stage (2026-10-18): Die Nummern standen nur kurz und verschwanden beim Weiterziehen. Wer zu
    // „vereinfachen ›“ will, fährt über „bearbeiten ›“; dessen Schließfrist lief NACH dem Öffnen von „vereinfachen“ ab und meldete
    // dem Menü „kein Untermenü offen“.
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await strasseAusStub(page, stelle);
    await page.mouse.click(stelle.x, stelle.y);
    await page.getByTestId("context-editor-weg-wegkurve-strasse").hover();
    await expect(page.getByTestId("context-editor-weg-wegkurve-strasse-unter")).toBeVisible();
    await page.getByTestId("context-editor-weg-vereinfachen-strasse").hover();
    const unter = page.getByTestId("context-editor-weg-vereinfachen-strasse-unter");
    await expect(unter).toBeVisible();
    // Über die Schließfrist der verlassenen Gruppe hinaus (300 ms): Die Nummern stehen weiter.
    await page.waitForTimeout(600);
    await expect.poll(() => abschnitteAufKarte(page)).toEqual({ hervor: "", nummern: ["1"] });
    const erster = page.getByTestId(`context-editor-weg-vereinfachen-strasse#${stelle.id}`);
    const ferner = page.getByTestId(`context-editor-weg-vereinfachen-strasse#${FERN}`);
    await erster.hover();
    await expect.poll(async () => (await abschnitteAufKarte(page))?.hervor).toBe(stelle.id);
    // Weiterziehen über den Eintrag, zum nächsten und zurück: Die Nummern bleiben, das Leuchten folgt dem Eintrag.
    const box = (await erster.boundingBox())!;
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 6 });
    await expect.poll(() => abschnitteAufKarte(page)).toEqual({ hervor: stelle.id, nummern: ["1"] });
    await ferner.hover();
    await expect.poll(async () => (await abschnitteAufKarte(page))?.hervor).toBe(FERN);
    await erster.hover();
    await page.mouse.move(box.x + 6, box.y + box.height / 2, { steps: 6 });
    await expect.poll(() => abschnitteAufKarte(page)).toEqual({ hervor: stelle.id, nummern: ["1"] });
});

test("🔴 Nummern folgen der Kamera („beim anklicken kommen nicht die zahlen“), bei (W) tritt nichts zurück und nichts ist gestrichelt („wenn ich wege editier wird es automatisch gestrichelt“)", async ({
    page,
}) => {
    // Stage-Funde des Betreibers 2026-10-19. Die Nummern wurden nur beim Zeigen gerechnet: Öffnet die Liste das Fenster, während die
    // Karte woanders steht, fliegt die Kamera erst danach hin, und die Nummern fehlten. Gestrichelt heißt Tunnel; die übrigen Abschnitte
    // traten gestrichelt zurück, bei (W) der ganze Weg.
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await strasseAusStub(page, stelle);
    // Der Rahmen des Abschnitts aus den Kacheln: Der Klick in der Liste fliegt dorthin, und seine Mitte (dort steht die Nummer) liegt
    // im Bild.
    const rahmen = await page.evaluate((id) => {
        // Der Griff der Browsertests ist schmal getypt; hier braucht es den Filter und die Linien der Kachel.
        const map = globalThis.avesmapsMap as unknown as {
            querySourceFeatures(
                quelle: string,
                wahl: { sourceLayer: string; filter: unknown[] },
            ): { geometry: { type: string; coordinates: unknown } }[];
        };
        const projektion = globalThis.avesmapsRenderProjection!;
        const punkte = map
            .querySourceFeatures("paths", { sourceLayer: "path_render", filter: ["==", ["get", "public_id"], id] })
            .flatMap((f) =>
                f.geometry.type === "LineString"
                    ? (f.geometry.coordinates as [number, number][])
                    : f.geometry.type === "MultiLineString"
                      ? (f.geometry.coordinates as [number, number][][]).flat()
                      : [],
            )
            .map(([lng, lat]) => projektion.fromRenderLngLat({ lng, lat }));
        const xs = punkte.map((q) => q.x);
        const ys = punkte.map((q) => q.y);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
    }, stelle.id);
    const da = { x: (rahmen[0] + rahmen[2]) / 2, y: (rahmen[1] + rahmen[3]) / 2 };
    await page.route("**/api/editor/paths", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rows: [
                    {
                        id: stelle.id,
                        name: "Gratenfelser Weg",
                        subtype: "Weg",
                        isBach: false,
                        circle: "halb-rechts",
                        segments: 2,
                        bounds: rahmen,
                    },
                ],
            }),
        }),
    );
    // Weit weg: Dort hat die Karte keine Kachel der Stelle.
    await showPlace(page, p(120, 90), 7);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
    await page
        .locator('[data-testid^="wegeditor-"][data-testid$="-liste"]')
        .getByText("Gratenfelser Weg")
        .first()
        .dblclick();
    // Erst der Doppelklick fliegt (T32); die Nummern rechnete die Schicht schon beim ersten Klick, als die Karte noch woanders stand.
    await expect.poll(() => abschnitteAufKarte(page), { timeout: 20_000 }).toEqual({ hervor: "", nummern: ["1"] });
    const blass = () =>
        page.evaluate(() => {
            const map = globalThis.avesmapsMap!;
            return {
                ids: ((map.getFilter("weg-abschnitte-gedaempft") as unknown[]).at(-1) as [string, string[]])[1],
                strich: map.getPaintProperty("weg-abschnitte-gedaempft", "line-dasharray") ?? null,
            };
        });
    // (W): Nichts tritt zurück, nichts ist gestrichelt.
    expect(await blass()).toEqual({ ids: [], strich: null });
    // (1): Der andere tritt zurück, blass und durchgezogen.
    await page.getByTestId(/^wegeditor-fenster-\d+-wahl-1$/).click();
    await expect.poll(async () => (await abschnitteAufKarte(page))?.hervor).toBe(stelle.id);
    expect(await blass()).toEqual({ ids: [FERN], strich: null });
    // Verschieben und zurück: Die Nummer steht wieder.
    await showPlace(page, p(120, 90), 7);
    await expect.poll(async () => (await abschnitteAufKarte(page))?.nummern).toEqual([]);
    await page.evaluate(
        (punkt) =>
            globalThis.avesmapsMap!.jumpTo({ center: globalThis.avesmapsRenderProjection!.toRenderLngLat(punkt) }),
        da,
    );
    await expect.poll(async () => (await abschnitteAufKarte(page))?.nummern, { timeout: 20_000 }).toEqual(["1"]);
});

test("🔴 Ein Klick in der Liste holt einen verdeckten Weg in die freie Fläche, ein sichtbarer bleibt stehen (Betreiber 2026-10-19 „Ja, wenn verdeckt“)", async ({
    page,
}) => {
    // Sonst gilt EDIT-0001 D17 (G3): Der Einfachklick wählt und öffnet, die Karte steht. Anlass: Der Breitenstieg lag nach dem Klick unter
    // dem angedockten Fenster, und seine Nummern waren nicht zu sehen.
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await strasseAusStub(page, stelle);
    const rahmen = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap as unknown as {
            querySourceFeatures(
                quelle: string,
                wahl: { sourceLayer: string; filter: unknown[] },
            ): { geometry: { type: string; coordinates: unknown } }[];
        };
        const projektion = globalThis.avesmapsRenderProjection!;
        const punkte = map
            .querySourceFeatures("paths", { sourceLayer: "path_render", filter: ["==", ["get", "public_id"], id] })
            .flatMap((f) =>
                f.geometry.type === "LineString"
                    ? (f.geometry.coordinates as [number, number][])
                    : f.geometry.type === "MultiLineString"
                      ? (f.geometry.coordinates as [number, number][][]).flat()
                      : [],
            )
            .map(([lng, lat]) => projektion.fromRenderLngLat({ lng, lat }));
        const xs = punkte.map((q) => q.x);
        const ys = punkte.map((q) => q.y);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
    }, stelle.id);
    const zeile = (id: string, name: string, bounds: readonly number[]) => ({
        id,
        name,
        subtype: "Weg",
        isBach: false,
        circle: "halb-rechts",
        segments: 1,
        bounds,
    });
    await page.route("**/api/editor/paths", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rows: [
                    zeile(stelle.id, "Gratenfelser Weg", rahmen),
                    zeile(FERN, "Naher Weg", rahmen),
                    zeile("0b6f0c55-0000-4000-8000-0000000000fa", "Ferner Weg", [1, 1, 2, 2]),
                ],
            }),
        }),
    );
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
    const liste = page.locator('[data-testid^="wegeditor-"][data-testid$="-liste"]');
    // Der Doppelklick holt den Gratenfelser Weg in die freie Fläche neben dem Fenster.
    await liste.getByRole("option", { name: /Gratenfelser Weg/ }).dblclick();
    await page.waitForTimeout(500);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    const mitte = () =>
        page.evaluate(() => {
            const c = globalThis.avesmapsMap!.getCenter();
            return [Math.round(c.lng * 1e6), Math.round(c.lat * 1e6)];
        });
    const vorher = await mitte();
    // Sichtbar: Der Klick auf einen Weg an derselben Stelle lässt die Karte stehen.
    await liste.getByRole("option", { name: /Naher Weg/ }).click();
    await page.waitForTimeout(1500);
    expect(await mitte()).toEqual(vorher);
    // Verdeckt (ganz außerhalb): Der Klick holt ihn.
    await liste.getByRole("option", { name: /Ferner Weg/ }).click();
    await expect.poll(mitte, { timeout: 15_000 }).not.toEqual(vorher);
});

test("eine lange Straße (T49): Das Untermenü der Abschnitte rollt im Fenster, statt hinauszuragen", async ({
    page,
}) => {
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await strasseAusStub(page, stelle, 40);
    await page.mouse.click(stelle.x, stelle.y);
    await page.getByTestId("context-editor-weg-wegkurve-strasse").hover();
    const unter = page.getByTestId("context-editor-weg-wegkurve-strasse-unter");
    await expect(unter.getByRole("menuitem")).toHaveCount(42);
    const masse = await unter.evaluate((el) => ({
        oben: el.getBoundingClientRect().top,
        unten: el.getBoundingClientRect().bottom,
        rollt: el.scrollHeight > el.clientHeight,
    }));
    expect(masse.rollt).toBe(true);
    expect(masse.oben).toBeGreaterThanOrEqual(0);
    expect(masse.unten).toBeLessThanOrEqual(page.viewportSize()!.height);
    // Der letzte Abschnitt ist erreichbar.
    const letzter = unter.getByRole("menuitem").last();
    await letzter.scrollIntoViewIfNeeded();
    await expect(letzter).toBeInViewport();
});

test("🔴 „Weg entfernen › Ganze Straße (n Abschnitte) …“ (T49) öffnet das Blatt für die Straße; „Ganz löschen“ ist EINE Operation über alle", async ({
    page,
}) => {
    const gesendet: { url: string; body: unknown }[] = [];
    await page.route(/\/api\/editor\/paths\/[0-9a-f-]{36}\/street\/(delete|take-off-map)$/, (route) => {
        const body = route.request().postDataJSON() as { operationId: string };
        gesendet.push({ url: route.request().url(), body });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                operationId: body.operationId,
                status: "applied",
                environment: "development",
                affected: [],
                derivedWork: [],
                warnings: [],
                mapRevision: 82,
            }),
        });
    });
    await karteMitWegen(page);
    const stelle = await wegStelle(page);
    await strasseAusStub(page, stelle);
    await page.mouse.click(stelle.x, stelle.y);
    await page.getByTestId("context-editor-weg-entfernen-strasse").hover();
    const ganz = page.getByTestId("context-editor-weg-entfernen-strasse#strasse");
    await expect(ganz).toHaveText("Ganze Straße (2 Abschnitte) …");
    await ganz.hover();
    // Die ganze Straße gezeigt: kein Abschnitt hervorgehoben, die Nummern stehen.
    await expect.poll(() => abschnitteAufKarte(page)).toEqual({ hervor: "", nummern: ["1"] });
    await ganz.click();
    const blatt = page.getByTestId("weg-entfernen");
    await expect(blatt).toBeVisible();
    await expect(blatt).toContainText("ganze Straße, 2 Abschnitte");
    await page.getByTestId("weg-entfernen-loeschen").click();
    await page.getByTestId("weg-entfernen-los").click();
    await expect.poll(() => gesendet.length).toBe(1);
    expect(gesendet[0]!.url).toContain(`/api/editor/paths/${stelle.id}/street/delete`);
    expect(gesendet[0]!.body).toMatchObject({
        sections: [
            { publicId: stelle.id, baseRevision: 5 },
            { publicId: FERN, baseRevision: 9 },
        ],
    });
    await expect(blatt).toBeHidden();
});

test("🔴 Liste beim Modus (WI-0177 Stufe 4): das angedockte Wege-Fenster zieht seine Liste ein, solange die Wegkurve läuft, und stellt sie her", async ({
    page,
}) => {
    await stub(page);
    await page.route("**/api/editor/paths", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rows: [
                    {
                        id: WEG,
                        name: "Gratenfelser Weg",
                        subtype: "Weg",
                        isBach: false,
                        circle: "halb-rechts",
                        segments: 1,
                    },
                ],
            }),
        }),
    );
    await openMap(page, EDITOR_MODE);
    await showPlace(page, p(6, 2), 7);
    await editorPanelVorn(page);
    await page.getByTestId("editorpanel-kachel-wege").click();
    await page.getByTestId("editorpanel-verb").click();
    const schalter = page.getByTestId(/^wegeditor-fenster-\d+-listenschalter$/);
    await expect(schalter).toHaveAttribute("aria-expanded", "true");
    await page.waitForFunction(() => globalThis.avesmapsWegkurve !== undefined);
    await page.evaluate((id) => globalThis.avesmapsWegkurve!.starte(id), WEG);
    await expect.poll(() => modusAktiv(page)).toBe(true);
    await expect(schalter).toHaveAttribute("aria-expanded", "false");
    // „Fertig“ ohne Schritte beendet den Modus; die Liste kommt wieder.
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await expect.poll(() => modusAktiv(page)).toBe(false);
    await expect(schalter).toHaveAttribute("aria-expanded", "true");
});

test("🔴 Strg + Klick auf den Weg setzt vier Stützpunkte auf die Strecke (Betreiber 2026-10-20, Legacy), EIN Schreiben; Strg + Doppelklick nicht doppelt", async ({
    page,
}) => {
    const server = await starte(page);
    const teilung = () =>
        page.evaluate(
            () => globalThis.avesmapsMap!.queryRenderedFeatures({ layers: ["geometrie-teilung-punkt"] }).length,
        );
    // Die Mitte der geraden Strecke vom zweiten zum dritten Stützpunkt.
    const mitte = await aufSeite(page, {
        x: (PUNKTE[1]!.x + PUNKTE[2]!.x) / 2,
        y: (PUNKTE[1]!.y + PUNKTE[2]!.y) / 2,
    });
    await page.mouse.move(mitte.x, mitte.y + 4);
    await page.keyboard.down("Control");
    await expect.poll(teilung).toBe(4);
    await page.mouse.dblclick(mitte.x, mitte.y + 4);
    await page.keyboard.up("Control");
    // Die vier Punkte sind EIN Schritt im Entwurf (nicht zwei durch den Doppelklick); geschrieben wird erst mit „Fertig“.
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    expect(server.gesendet).toEqual([]);
    await page.getByTestId("wegkurve-leiste-fertig").click();
    await expect.poll(() => server.gesendet.length).toBe(1);
    await page.waitForTimeout(500);
    expect(server.gesendet).toHaveLength(1);
    const punkte = server.gesendet[0]!.points;
    expect(punkte).toHaveLength(PUNKTE.length + 4);
    // Gleichmäßig zwischen dem zweiten und dritten Stützpunkt, nicht am Zeiger.
    for (const [k, q] of punkte.slice(2, 6).entries()) {
        const t = (k + 1) / 5;
        expect(q.x).toBeCloseTo(PUNKTE[1]!.x + (PUNKTE[2]!.x - PUNKTE[1]!.x) * t, 5);
        expect(q.y).toBeCloseTo(PUNKTE[1]!.y + (PUNKTE[2]!.y - PUNKTE[1]!.y) * t, 5);
    }
    await expect.poll(teilung).toBe(0);
});
