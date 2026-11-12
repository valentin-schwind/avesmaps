import { expect, test, type Page, type Route } from "@playwright/test";
import type { EditorMoveTargets, EditorPlaceDetail, PlaceMoveBody, PlaceUpdateBody } from "@avesmaps3d/shared";
import { settleFrame, showPlace } from "./map-handle.ts";
import { GRATENFELS, GRATENFELS_LAGE, fenster, oeffneOrtseditor, zeile } from "./ortseditor-stub.ts";

/**
 * „✥ Ort verschieben“ am echten Stack (WI-0128 E12; EDIT-0001 §4.4, D11, Tests T12.1 bis T12.10; EDIT-0003 G4, Vali 2026-10-31: Loslassen
 * ist ein Schritt im Entwurf, erst „Fertig“ in der Leiste über der Karte schreibt `place.move`).
 *
 * 🔴 Kein Test schreibt in die Datenbank der Entwicklung (W15): Ort, Einrastziele und `place.move` kommen aus einem Stub; den echten
 * Schreibweg samt Wegenden prüft `apps/server/test/editor-place-edit.test.ts` gegen die Testdatenbank. Gezogen wird mit der Maus am Griff
 * des Modus; gemessen wird, was gesendet wird und was das Fenster danach sagt. Seit WI-0177 Stufe 4 läuft der Modus auf dem gemeinsamen
 * Geometrie-Modul: Der Griff ist sein Anfasser (`geometrie-anfasser`), eingerastet wird im Fangradius der Karteneinstellungen.
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
const WEG_A = "0b6f0c55-0000-4000-8000-00000000000a";
const WEG_B = "0b6f0c55-0000-4000-8000-00000000000b";
const WEG_C = "0b6f0c55-0000-4000-8000-00000000000c";
const FREI = { x: GRATENFELS_LAGE.x - 6, y: GRATENFELS_LAGE.y + 4 };

function ort(revision: number): EditorPlaceDetail {
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
        pathEnds: [
            {
                pathId: WEG_A,
                name: "Reichsstraße",
                end: "start",
                revision: 3,
                x: GRATENFELS_LAGE.x,
                y: GRATENFELS_LAGE.y,
                neighbor: { x: GRATENFELS_LAGE.x + 8, y: GRATENFELS_LAGE.y + 2 },
            },
            {
                pathId: WEG_B,
                name: "Pfad",
                end: "end",
                revision: 5,
                x: GRATENFELS_LAGE.x,
                y: GRATENFELS_LAGE.y,
                neighbor: { x: GRATENFELS_LAGE.x - 3, y: GRATENFELS_LAGE.y - 7 },
            },
        ],
    };
}

interface Server {
    verschoben: boolean;
    antwort: { status: number; body: unknown };
    gesendet: PlaceMoveBody[];
    gespeichert: PlaceUpdateBody[];
}

const QUITTUNG = {
    status: 200,
    body: {
        operationId: "00000000-0000-4000-8000-000000000001",
        status: "applied",
        environment: "development",
        affected: [
            { kind: "place", id: GRATENFELS, revision: 8 },
            { kind: "path", id: WEG_A, revision: 4 },
            { kind: "path", id: WEG_B, revision: 6 },
        ],
        derivedWork: [],
        warnings: [],
        mapRevision: 57,
    },
};

async function stub(page: Page, antwort: Server["antwort"] = QUITTUNG): Promise<Server> {
    const server: Server = { verschoben: false, antwort, gesendet: [], gespeichert: [] };
    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/editor/status", (route) => json(route, 200, { mapEditing: "testwelt" }));
    await page.route(`**/api/editor/places/${GRATENFELS}`, (route) => {
        if (route.request().method() === "PATCH") {
            server.gespeichert.push(route.request().postDataJSON() as PlaceUpdateBody);
            return json(route, 200, { ...QUITTUNG.body, affected: [{ kind: "place", id: GRATENFELS, revision: 9 }] });
        }
        return json(route, 200, ort(server.verschoben ? 8 : 7));
    });
    await page.route(`**/api/editor/places/${GRATENFELS}/move-targets`, (route) =>
        json(route, 200, {
            radius: 50,
            freeEnds: [{ pathId: WEG_C, name: "Landstraße", end: "end", x: FREI.x, y: FREI.y }],
        } satisfies EditorMoveTargets),
    );
    await page.route(`**/api/editor/places/${GRATENFELS}/move`, (route) => {
        server.gesendet.push(route.request().postDataJSON() as PlaceMoveBody);
        if (server.antwort.status === 200) server.verschoben = true;
        return json(route, server.antwort.status, server.antwort.body);
    });
    return server;
}

/** Die Ebene der Anfasser des Geometrie-Moduls: am Ort genau einer, der Griff. */
const GRIFF = "geometrie-anfasser";

/** Wo ein Kartenpunkt (Karteneinheiten) auf der Seite liegt: dort das freie Wegende, das der Modus erst beim Ziehen markiert. */
async function seitenpunkt(page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> {
    return page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);
}

/**
 * Die Karte so schieben, dass das freie Ende neben dem Ort nicht unter dem Planer links liegt: Das Fenster bleibt beim Verschieben
 * angedockt stehen (Liste beim Modus), die Karte rückt also nicht mehr nach. Über einem Panel kommt kein Zeigerzug bei der Karte an.
 */
async function freiInDieFreieFlaeche(page: Page): Promise<void> {
    // Wie `panBy([-300, 0])`, nur mit den Griffen des MapHandle: Die Mitte rückt 300 px nach links, der Inhalt nach rechts.
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const mitte = map.project(map.getCenter());
        map.jumpTo({ center: map.unproject([mitte.x - 300, mitte.y]) });
    });
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
}

/** Wo eine Ebene des Modus ihren ersten Punkt zeichnet, in Seitenkoordinaten. */
async function punktDer(page: Page, layer: string): Promise<{ x: number; y: number }> {
    await page.waitForFunction(
        (id) => (globalThis.avesmapsMap?.queryRenderedFeatures({ layers: [id] }).length ?? 0) > 0,
        layer,
    );
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const feature = map.queryRenderedFeatures({ layers: [id] })[0]!;
        const [lng, lat] = (feature.geometry as { coordinates: [number, number] }).coordinates;
        const at = map.project({ lng, lat });
        // Die Leinwand füllt den Kartenrahmen: ihr Rechteck ist das der Karte.
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, layer);
}

const modusAktiv = (page: Page) => page.evaluate((id) => globalThis.avesmapsMap?.getLayer(id) !== undefined, GRIFF);
/** Die Leiste des Modus über der Karte (`ort-verschieben-leiste.vue`): „n ungespeichert“, „Fertig“. */
const leiste = (page: Page) => page.getByTestId("ort-verschieben-leiste");
const ungespeichert = (page: Page) => page.getByTestId("ort-verschieben-leiste-ungespeichert");
const fertig = (page: Page) => page.getByTestId("ort-verschieben-leiste-fertig");
const status = (page: Page) => fenster(page).locator('[data-testid$="-status"]');
/**
 * Der Schalter der Liste: Beim Verschieben zieht das angedockte Fenster nur seine Liste ein und behält die Eigenschaften (Liste beim
 * Modus, Festlegung der Editor-Orchestrierung 2026-10-17; vorher klappte es ganz ein).
 */
const listenSchalter = (page: Page) => fenster(page).locator('[data-testid$="-listenschalter"]');
const listeEingezogen = (page: Page) => expect(listenSchalter(page)).toHaveAttribute("aria-expanded", "false");
const listeOffen = (page: Page) => expect(listenSchalter(page)).toHaveAttribute("aria-expanded", "true");

/**
 * Bis der Modus wirklich läuft und die Kamera steht: Die Leiste steht schon, während Ort und Einrastziele laden; erst danach schaltet
 * der Modus die Karte ein und fliegt, wenn der Ort nicht frei liegt. Wer vorher den Griff misst, greift unter Last daneben.
 */
async function modusBereit(page: Page): Promise<void> {
    await listeEingezogen(page);
    await expect.poll(() => modusAktiv(page)).toBe(true);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
}

/** Den Ortseditor mit Gratenfels öffnen, die Karte auf ihn, und den Modus starten. */
async function starte(page: Page, rechte = RECHTE): Promise<void> {
    await oeffneOrtseditor(page, { rechte });
    await zeile(page, "Gratenfels").click();
    await showPlace(page, { x: GRATENFELS_LAGE.x - 40, y: GRATENFELS_LAGE.y }, 7);
    if (!rechte.includes("edit_map_geometry")) return;
    await fenster(page).locator('[data-testid$="-verschieben"]').click();
    await modusBereit(page);
}

/**
 * Die Fragen der Seite, die im Takt laufen, solange jemand angemeldet ist, und dem Ortseditor nicht gehören (WI-0248, Release-Lauf f80bb5c83: T12.3 war rot mit
 * `["…/api/jobs/overview?eigene=true"]`). Die Zusicherung „keine Serverfrage beim Ziehen“ gilt dem Modus; jede andere Frage in `/api/` bleibt ein Fehler.
 *
 * - `jobs/overview`: die Warteschlange im Kopf (WI-0230, `warteschlange/eigene-quelle.ts`), ohne `/ws` alle 5 s (`POLL_WITHOUT_SOCKET_MS`).
 * - `benachrichtigungen`: die Glocke (`auth/benachrichtigungen.ts`), im Takt und sobald die Seite wieder sichtbar wird.
 * - `content-state`: die Inhaltsschalter (`system/inhaltsstand.ts`), alle 60 s.
 * - `besuch`, `besuch/ping`: die Besuchszählung (`besuch/besuch-melden.ts`), Ping alle 60 s und bei Sichtbarkeit.
 * - `editor/locks`: die Sperren der Editoren (`editor-sperre/`), Herzschlag und Liste alle 60 s.
 */
const HINTERGRUND = /\/api\/(jobs\/overview|benachrichtigungen|content-state|besuch(\/ping)?|editor\/locks)(\/|\?|$)/u;
/** Die Abfrage der Warteschlange im Kopf allein; der Zusatzfall löst sie mitten im Zug aus. */
const KOPFLEISTE = /\/api\/jobs\/overview(\?|$)/u;

/** Sammelt ab jetzt alle Fragen an `/api/`: `alle` und, ohne die getakteten der Seite (`HINTERGRUND`), `modus` (nur die gilt für „keine Serverfrage beim Ziehen“). */
function modusFragen(page: Page): { readonly alle: string[]; readonly modus: string[] } {
    const sammlung = { alle: [] as string[], modus: [] as string[] };
    page.on("request", (request) => {
        if (!request.url().includes("/api/")) return;
        sammlung.alle.push(request.url());
        if (!HINTERGRUND.test(request.url())) sammlung.modus.push(request.url());
    });
    return sammlung;
}

async function ziehe(page: Page, nach: (griff: { x: number; y: number }) => { x: number; y: number }): Promise<void> {
    const griff = await punktDer(page, GRIFF);
    const ziel = nach(griff);
    await page.mouse.move(griff.x, griff.y);
    await page.mouse.down();
    await page.mouse.move(ziel.x, ziel.y, { steps: 8 });
}

test("🔴 T12.1 ohne Modus ist kein Ort ziehbar; T12.10 ohne edit_map_geometry fehlt der Knopf, ein Satz sagt warum", async ({
    page,
}) => {
    await stub(page);
    await starte(page, ["use_editor_menu", "edit_map_objects", "edit_territories", "edit_landscapes"]);
    expect(await modusAktiv(page)).toBe(false);
    await expect(fenster(page).locator('[data-testid$="-verschieben"]')).toHaveCount(0);
    await expect(fenster(page).locator('[data-testid$="-verschieben-recht"]')).toHaveText(
        "Verschieben braucht das Recht „Geometrien bearbeiten“.",
    );
    await expect(fenster(page).locator('[data-testid$="-hinfliegen"]')).toBeVisible();
});

test("🔴 T12.2 T12.3 T12.7 ziehen, loslassen, „Fertig“: genau eine Operation mit beiden Wegenden erst mit „Fertig“, keine Serverfrage beim Ziehen, Quittung im Fenster", async ({
    page,
}) => {
    const server = await stub(page);
    await starte(page);
    // Die Liste ist eingezogen, die Eigenschaften bleiben; die Lage erklärt den Modus.
    await expect(fenster(page).locator('[data-testid$="-verschieben-hinweis"]')).toContainText(
        "Den Ort ziehen, auch mehrmals. „Fertig“ schreibt.",
    );
    // Die Leiste des Modus steht über der Karte, wie bei den anderen Formmodi.
    await expect(leiste(page)).toContainText("Ort verschieben");
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");
    await expect(fenster(page).getByTestId("fenster-rumpf")).toBeVisible();
    await expect(page.getByTestId("fenster-eingeklappt")).toHaveCount(0);

    const fragen = modusFragen(page);
    await ziehe(page, (griff) => ({ x: griff.x - 160, y: griff.y + 90 }));
    expect(fragen.modus).toEqual([]);
    await page.mouse.up();
    // Das Loslassen ist ein Schritt im Entwurf: nichts geht hinaus, der Modus bleibt offen.
    await expect(ungespeichert(page)).toHaveText("1 ungespeichert");
    expect(server.gesendet).toEqual([]);
    expect(await modusAktiv(page)).toBe(true);
    // E13: Nach der Quittung laden Orte und Wege mit ihrer Kachelrevision neu.
    const neueKacheln = page.waitForRequest((request) =>
        /\/tiles\/vector\/(place|path)_render\/.*\?r=57$/u.test(request.url()),
    );
    await fertig(page).click();
    await neueKacheln;

    await listeOffen(page);
    await expect(status(page)).toHaveText("Verschoben als Revision 8. 2 Wegenden mitgezogen.");
    expect(server.gesendet).toHaveLength(1);
    const body = server.gesendet[0]!;
    expect(body.baseRevision).toBe(7);
    expect(body.pathEnds.map((ende) => [ende.pathId, ende.end, ende.baseRevision])).toEqual([
        [WEG_A, "start", 3],
        [WEG_B, "end", 5],
    ]);
    expect(body.pathEnds.every((ende) => ende.to.x === body.to.x && ende.to.y === body.to.y)).toBe(true);
    expect(body.to.x).toBeLessThan(GRATENFELS_LAGE.x);
    expect(await modusAktiv(page)).toBe(false);
});

/**
 * Gegenprobe zu T12.3, ohne Zufall (WI-0248, Release-Lauf f80bb5c83: T12.3 war rot mit `["…/api/jobs/overview?eigene=true"]`): Die Seite fragt im Takt Dinge
 * ab, die dem Ortseditor nicht gehören (`HINTERGRUND`), allen voran die Warteschlange im Kopf alle fünf Sekunden (WI-0230). Ob ein Takt in das Zugfenster
 * fällt, entschied nur die Uhr; im Lauf traf es ihn einmal. Hier fällt er HINEIN, weil der Test die Abfragen mitten im Zug auslöst (Glocke, Kopfleiste und Besuchsmeldung
 * holen sofort nach, wenn die Seite wieder sichtbar wird: `visibilitychange`). Gemessen wird beides: Die Seite hat im Zug wirklich gefragt (sonst bewiese der
 * Fall nichts), und der Modus selbst hat dabei keine einzige Frage gestellt.
 */
test("🔴 T12.3 mitten im Zug fragt die Seite im Hintergrund nach (Kopfleiste, Glocke): das ist keine Frage des Modus, der Modus fragt weiter nichts", async ({
    page,
}) => {
    await stub(page);
    await starte(page);
    const fragen = modusFragen(page);
    await ziehe(page, (griff) => ({ x: griff.x - 160, y: griff.y + 90 }));
    const kopfFrage = page.waitForRequest((request) => KOPFLEISTE.test(request.url()));
    const glockenFrage = page.waitForRequest((request) => /\/api\/benachrichtigungen(\?|$)/u.test(request.url()));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await Promise.all([kopfFrage, glockenFrage]);
    // Der Zug läuft noch (Taste gedrückt), und die Seite hat gefragt: Ohne die Ausnahme wäre die Liste hier nicht leer.
    expect(fragen.alle.some((url) => KOPFLEISTE.test(url))).toBe(true);
    expect(fragen.modus).toEqual([]);
    await page.mouse.up();
});

test("🔴 T12.5 im Fangradius an einem freien Ende eingerastet: der Ort landet genau darauf", async ({ page }) => {
    const server = await stub(page);
    await starte(page);
    await freiInDieFreieFlaeche(page);
    const frei = await seitenpunkt(page, FREI);
    await ziehe(page, () => ({ x: frei.x + 4, y: frei.y - 3 }));
    await page.mouse.up();
    await fertig(page).click();
    await expect(status(page)).toHaveText(
        "Verschoben als Revision 8. 2 Wegenden mitgezogen. An ein freies Wegende eingerastet.",
    );
    expect(server.gesendet[0]!.to).toEqual(FREI);
});

test("🔴 T12.4 Strg mitten im Zug: Wegenden bleiben liegen, kein Einrasten bis zum Loslassen, auch wenn Strg vorher losgelassen wird", async ({
    page,
}) => {
    const server = await stub(page);
    await starte(page);
    await freiInDieFreieFlaeche(page);
    const frei = await seitenpunkt(page, FREI);
    await ziehe(page, (griff) => ({ x: griff.x - 40, y: griff.y + 40 }));
    await page.keyboard.down("Control");
    await page.mouse.move(frei.x - 60, frei.y + 30, { steps: 4 });
    // G9, D11: An der Ausgangslage bleiben die Wegenden liegen und hängen an nichts: ein Bernstein-Ring dort, solange gezogen wird.
    const liegen = page.locator('[data-testid="geometrie-ringe"] circle[data-ring="liegen"]');
    await expect(liegen).toHaveCount(1);
    await page.keyboard.up("Control");
    // Auf das freie Ende: ohne Strg rastete es ein, getrennt nicht (klebrig, D11).
    await page.mouse.move(frei.x + 4, frei.y - 3, { steps: 4 });
    await page.mouse.up();
    await fertig(page).click();
    await expect(status(page)).toHaveText("Verschoben als Revision 8. 2 Wegenden blieben liegen (Strg).");
    expect(server.gesendet[0]!.pathEnds).toEqual([]);
    expect(server.gesendet[0]!.to).not.toEqual(FREI);
});

test("🔴 Strg schon VOR dem Druck auf dem Griff: die Karte dreht nicht, der Ort zieht getrennt, die Wegenden bleiben liegen (Thomas 2026-10-19)", async ({
    page,
}) => {
    const server = await stub(page);
    await starte(page);
    await freiInDieFreieFlaeche(page);
    const griff = await punktDer(page, GRIFF);
    const drehung = () => page.evaluate(() => globalThis.avesmapsMap!.getBearing());
    const vorher = await drehung();
    // Vorher gehörte Strg + Ziehen immer der Kamera (Rang 100): Die Karte drehte, der Ort blieb stehen.
    await page.mouse.move(griff.x, griff.y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(griff.x - 40, griff.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    expect(await drehung(), "die Karte dreht nicht").toBe(vorher);
    await fertig(page).click();
    await expect(status(page)).toHaveText("Verschoben als Revision 8. 2 Wegenden blieben liegen (Strg).");
    expect(server.gesendet[0]!.pathEnds).toEqual([]);
});

test("🔴 im Modus öffnet ein Klick oder Rechtsklick am Griff kein Menü und sendet nichts (O2, Betreiber 2026-10-15)", async ({
    page,
}) => {
    const server = await stub(page);
    await starte(page);
    const griff = await punktDer(page, GRIFF);
    // Losgelassen ohne Bewegung: ein Klick. Vorher fiel er zum Ort darunter durch und öffnete das Menü am Objekt.
    await page.mouse.click(griff.x, griff.y);
    await page.mouse.click(griff.x, griff.y, { button: "right" });
    await expect(page.getByTestId("editor-menu")).toBeHidden();
    await expect(page.getByTestId("map-context-menu")).toBeHidden();
    expect(server.gesendet).toEqual([]);
    expect(await modusAktiv(page)).toBe(true);
});

test("🔴 T12.6 Esc im Zug bringt den Ort zurück, kein Schritt; ohne Schritte beendet Esc den Modus, nichts wird gesendet, die Liste kommt wieder", async ({
    page,
}) => {
    const server = await stub(page);
    await starte(page);
    await ziehe(page, (griff) => ({ x: griff.x - 120, y: griff.y + 60 }));
    await page.keyboard.press("Escape");
    await page.mouse.up();
    // Das erste Esc galt nur dem Zug: Der Modus läuft weiter, es steht kein Schritt im Entwurf.
    await expect(ungespeichert(page)).toHaveText("0 ungespeichert");
    expect(await modusAktiv(page)).toBe(true);
    await page.keyboard.press("Escape");
    await listeOffen(page);
    expect(await modusAktiv(page)).toBe(false);
    await expect(leiste(page)).toHaveCount(0);
    expect(server.gesendet).toEqual([]);
    // Das Fenster ist offen geblieben: Escape galt dem Modus, nicht ihm.
    await expect(fenster(page)).toHaveCount(1);
});

test("🔴 T12.9 Konflikt: der Ort geht zurück, der Hinweis nennt die Person; „Erneut verschieben“ startet neu", async ({
    page,
}) => {
    const server = await stub(page, {
        status: 409,
        body: {
            error: {
                code: "edit_conflict",
                message: "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
                details: {
                    currentRevision: 7,
                    changedAt: new Date().toISOString(),
                    changedBy: { id: "p1", displayName: "Thomas" },
                },
            },
        },
    });
    await starte(page);
    await ziehe(page, (griff) => ({ x: griff.x - 120, y: griff.y + 60 }));
    await page.mouse.up();
    await fertig(page).click();
    const meldung = fenster(page).locator('[data-testid$="-verschieben-meldung"]');
    await expect(meldung).toContainText("Jemand war schneller");
    // Der Ort selbst hat noch Revision 7: Ein Weg an ihm wurde geändert.
    await expect(meldung).toContainText("Thomas hat");
    await expect(meldung).toContainText("einen Weg an Gratenfels geändert");
    expect(await modusAktiv(page)).toBe(false);
    expect(server.gesendet).toHaveLength(1);

    await meldung.locator('[data-testid$="-verschieben-erneut"]').click();
    await listeEingezogen(page);
    await expect.poll(() => modusAktiv(page)).toBe(true);
});

test("🔴 T12.8 ein Entwurf der Felder überlebt das Verschieben; Speichern geht auf die neue Revision, kein Selbstkonflikt", async ({
    page,
}) => {
    const server = await stub(page);
    await starte(page, RECHTE);
    // Erst abbrechen, einen Entwurf anlegen, dann verschieben.
    await page.keyboard.press("Escape");
    await listeOffen(page);
    const einwohner = fenster(page)
        .locator('[data-testid$="-feld-einwohner"]')
        .locator("xpath=descendant-or-self::*[self::input or self::textarea]")
        .first();
    await einwohner.fill("2.500");
    await expect(status(page)).toHaveText("Ungespeichert: Einwohner");

    await fenster(page).locator('[data-testid$="-verschieben"]').click();
    await modusBereit(page);
    await ziehe(page, (griff) => ({ x: griff.x - 120, y: griff.y + 60 }));
    await page.mouse.up();
    // Die Felder behalten ihre eigene Speicherleiste; „Fertig“ der Leiste über der Karte schreibt nur die Lage.
    await fertig(page).click();
    await listeOffen(page);
    await expect(einwohner).toHaveValue("2.500");
    await expect(status(page)).toHaveText("Ungespeichert: Einwohner");

    await fenster(page).locator('[data-testid$="-speichern"]').click();
    await expect(status(page)).toContainText("Gespeichert als Revision 9.");
    expect(server.gespeichert).toEqual([
        { operationId: expect.any(String), baseRevision: 8, changes: { einwohner: { value: "2.500" } } },
    ]);
});

/** Zoom und Mitte der Karte, wie sie gerade stehen. */
const kameraStand = (page: Page): Promise<{ zoom: number; lng: number; lat: number }> =>
    page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const mitte = map.getCenter();
        return { zoom: map.getZoom(), lng: mitte.lng, lat: mitte.lat };
    });

/** Wo ein Kartenpunkt auf dem Schirm liegt. */
const aufDemSchirm = (page: Page, punkt: { x: number; y: number }): Promise<{ x: number; y: number }> =>
    page.evaluate((p) => {
        const map = globalThis.avesmapsMap!;
        const at = map.project(globalThis.avesmapsRenderProjection!.toRenderLngLat(p));
        const rahmen = map.getCanvas().getBoundingClientRect();
        return { x: rahmen.left + at.x, y: rahmen.top + at.y };
    }, punkt);

/**
 * Die wirklich freie Breite der Karte: zwischen dem, was links deckt (Routenplaner), und dem, was rechts deckt (Ortseditor,
 * Editorpanel). Gemessen, nicht angenommen - genau dorthin zielt `freiNachLandung`.
 */
const freieBreite = (page: Page): Promise<{ von: number; bis: number }> =>
    page.evaluate(() => {
        const karte = globalThis.avesmapsMap!.getCanvas().getBoundingClientRect();
        let von = karte.left;
        let bis = karte.right;
        for (const element of document.querySelectorAll<HTMLElement>("[data-map-overlay]")) {
            if (element.closest("[inert]") !== null || element.getClientRects().length === 0) continue;
            const box = element.getBoundingClientRect();
            if (element.getAttribute("data-map-overlay") === "left") von = Math.max(von, box.right);
            if (element.getAttribute("data-map-overlay") === "right") bis = Math.min(bis, box.left);
        }
        return { von, bis };
    });

/**
 * Zählt die Kamerafahrten in den nächsten `ms`, OHNE die Sprünge, mit denen die sichtbare Fläche nur ihren Innenabstand
 * nachführt (`LAYOUT_EVENT`): Die sind kein Flug, sie halten das Bild stehen, wenn ein Panel kommt oder geht.
 */
async function fahrtenWaehrend(page: Page, ms: number, tun: () => Promise<void>): Promise<number> {
    await page.evaluate(() => {
        const welt = globalThis as unknown as { __fahrten?: number; __an?: (e: unknown) => void };
        welt.__fahrten = 0;
        welt.__an = (event: unknown) => {
            if ((event as Record<string, unknown>)["visibleArea"] !== true) welt.__fahrten = (welt.__fahrten ?? 0) + 1;
        };
        globalThis.avesmapsMap!.on("movestart", welt.__an);
    });
    await tun();
    await page.waitForTimeout(ms);
    return page.evaluate(() => {
        const welt = globalThis as unknown as { __fahrten?: number; __an?: (e: unknown) => void };
        if (welt.__an) globalThis.avesmapsMap!.off("movestart", welt.__an);
        return welt.__fahrten ?? 0;
    });
}

test("🔴 nach dem Verschieben zentriert die Karte auf die neue Lage, in der freien Fläche und ohne den Zoom zu ändern", async ({
    page,
}) => {
    // Betreiber 2026-10-11: „schön wärs auch wenn nach dem verschieben die ansicht auf die neue position des ortes zentriert“.
    const server = await stub(page);
    await starte(page);
    const vorher = await kameraStand(page);

    await ziehe(page, (griff) => ({ x: griff.x - 200, y: griff.y + 120 }));
    await page.mouse.up();
    await fertig(page).click();
    await expect(status(page)).toContainText("Verschoben als Revision 8.");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);

    const nachher = await kameraStand(page);
    // Der Zoom bleibt, die Mitte nicht: Es wurde geflogen, nicht herangeholt.
    expect(Math.abs(nachher.zoom - vorher.zoom)).toBeLessThan(0.01);
    expect(nachher.lng).not.toBeCloseTo(vorher.lng, 6);

    // Und zwar in die Mitte der wirklich FREIEN Fläche, nicht in die Mitte der ganzen Karte.
    const ziel = await aufDemSchirm(page, server.gesendet[0]!.to);
    const frei = await freieBreite(page);
    expect(Math.abs(ziel.x - (frei.von + frei.bis) / 2)).toBeLessThan(20);
    expect(ziel.x).toBeLessThan(frei.bis);
});

test("🔴 Abbruch und Konflikt bewegen die Kamera nicht: kein Flug, nur der Innenabstand des wiederkehrenden Fensters", async ({
    page,
}) => {
    const server = await stub(page, { status: 409, body: { code: "edit_conflict", message: "Jemand war schneller." } });
    await starte(page);

    const nachEsc = await fahrtenWaehrend(page, 1200, async () => {
        await ziehe(page, (griff) => ({ x: griff.x - 200, y: griff.y + 120 }));
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await page.keyboard.press("Escape");
        await listeOffen(page);
    });
    expect(nachEsc).toBe(0);

    await fenster(page).locator('[data-testid$="-verschieben"]').click();
    await modusBereit(page);
    const nachKonflikt = await fahrtenWaehrend(page, 1200, async () => {
        await ziehe(page, (griff) => ({ x: griff.x - 160, y: griff.y + 80 }));
        await page.mouse.up();
        await fertig(page).click();
        await expect(fenster(page).locator('[data-testid$="-verschieben-meldung"]')).toBeVisible();
    });
    expect(nachKonflikt).toBe(0);
    expect(server.gesendet).toHaveLength(1);
});
