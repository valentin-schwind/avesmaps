import { expect, test, type Page } from "@playwright/test";
import {
    AVENTURIA_POLITICAL_CARTOGRAPHY,
    politicalMinZoom,
    type EditorTerritoryDetail,
    type EditorTerritoryList,
} from "@avesmaps3d/shared";
import { EDITOR_MODE, onPage, readCamera, settleFrame } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * „Neue Fläche“ an den Herrschaftsgebieten (WI-0209 C3; EDIT-0003 T47, abgenommen 2026-10-18: „Nach dem Zeichnen / Fertig: bleiben ·
 * Abbruch: zurück“; §6 „Neue Fläche“ Fragen 2 bis 4). Die Gebiete kommen aus den Kacheln der lokalen Karte wie in
 * `gebietseditor-einstiege.spec.ts`; Liste, Detail, Ziele und das Schreiben aus Stubs. 🔴 Kein Test schreibt in die Datenbank der
 * Entwicklung.
 *
 * Problemfälle: Nach „Fertig“ springt die Ansicht zurück, oder nach dem Abbruch bleibt sie auf „Politisch“; während des Zeichnens wechselt
 * der Kartenfächer die Ansicht; die Leiste nennt kein Obergebiet; „Fertig“ schreibt mehr als EINE Operation oder ein anderes Obergebiet;
 * nach dem Anlegen öffnet das Fenster das neue Gebiet nicht, oder sein Name steht nicht markiert; „Grenze zeichnen“ schreibt ohne Revision.
 */

const bandBeginn = (band: number): number => politicalMinZoom(band, AVENTURIA_POLITICAL_CARTOGRAPHY.bandLeadZoom);
/** Mitten im Kosch (wie `gebietseditor-einstiege.spec.ts`). */
const KOSCH = { x: 450, y: 560 };
/** Breit: Das angedockte Fenster ist 960 px breit; daneben bleibt Karte für die Ecken. */
const BREIT = { width: 2400, height: 1000 };
const NEU = "c3c3c3c3-0000-4000-8000-0000000000a1";

let geschrieben: { method: string; url: string; body: unknown }[] = [];
let detailAbrufe: string[] = [];
/** Das Gebiet unter der Stelle, an der der Test es öffnet; die Liste des Stubs führt es (sonst zeigt das Fenster „Kein Gebiet gewählt“). */
let gebietImStub: string | undefined;

const hashParams = async (page: Page): Promise<URLSearchParams> =>
    new URLSearchParams((await page.evaluate(() => globalThis.location.hash)).slice(1));

async function oeffne(page: Page, ansicht: "political" | "standard" = "political"): Promise<void> {
    geschrieben = [];
    detailAbrufe = [];
    gebietImStub = undefined;
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
    const zeile = (id: string, name: string) => ({ id, name, circle: "leer", color: "#b2b065", order: 0 });
    const liste = (): EditorTerritoryList =>
        ({
            yearBf: 1049,
            rows: [
                ...(gebietImStub === undefined ? [] : [zeile(gebietImStub, "Probe")]),
                ...(geschrieben.some((g) => g.url === "/api/editor/territories")
                    ? [zeile(NEU, "Neues Herrschaftsgebiet (3)")]
                    : []),
            ],
        }) as EditorTerritoryList;
    /** Der Auftrag `territory_derive` der Quittung; meldet er `map.changed`, zeichnen die Kacheln die Fläche selbst. */
    const ABLEITUNG = "c3c3c3c3-0000-4000-8000-0000000000d1";
    const quittung = (extra: Record<string, unknown>) =>
        JSON.stringify({
            operationId: "c3c3c3c3-0000-4000-8000-0000000000e1",
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [{ kind: "territory_derive", jobId: ABLEITUNG, state: "queued" }],
            warnings: [],
            mapRevision: 4712,
            ...extra,
        });
    await page.route("**/api/editor/territories", (route) => {
        if (route.request().method() === "GET")
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liste()) });
        geschrieben.push({ method: "POST", url: "/api/editor/territories", body: route.request().postDataJSON() });
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: quittung({ publicId: NEU, name: "Neues Herrschaftsgebiet (3)", areaId: NEU.replace("a1", "b1") }),
        });
    });
    await page.route(/\/api\/editor\/territories\/targets\?/, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ corners: [], edges: [], truncated: false }),
        }),
    );
    await page.route(/\/api\/editor\/territories\/[^/]+\/areas$/, (route) => {
        const url = route.request().url();
        geschrieben.push({
            method: "POST",
            url: url.slice(url.indexOf("/api/")),
            body: route.request().postDataJSON(),
        });
        const id = url.split("/territories/")[1]?.split("/")[0] ?? "";
        return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: quittung({ publicId: id, name: "Probe", areaId: NEU.replace("a1", "b2") }),
        });
    });
    await page.route(/\/api\/editor\/territories\/[^/?]+$/, (route) => {
        const url = route.request().url();
        const id = url.split("/").at(-1) ?? "";
        if (route.request().method() !== "GET") {
            geschrieben.push({
                method: route.request().method(),
                url: url.slice(url.indexOf("/api/")),
                body: undefined,
            });
            return route.fulfill({ status: 500 });
        }
        detailAbrufe.push(id);
        const detail: Partial<EditorTerritoryDetail> = {
            id,
            revision: 1,
            name: id === NEU ? "Neues Herrschaftsgebiet (3)" : "Probe",
            color: "#b2b065",
            opacity: 0.7,
            order: 0,
            parents: [],
            children: [],
            details: {},
            areas: [],
            claimedBy: [],
            claims: [],
        };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) });
    });
    await page.route(/\/api\/editor\/locks(\/(heartbeat|release|lift))?(\?.*)?$/, (route) => {
        const url = route.request().url();
        if (route.request().method() === "GET")
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ locks: [] }) });
        if (url.endsWith("/release")) return route.fulfill({ status: 204 });
        if (url.endsWith("/heartbeat"))
            return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lost: [] }) });
        const body = route.request().postDataJSON() as { kind: string; id: string; part: string };
        const lock = {
            ...body,
            person: { id: "c3c3c3c3-0000-4000-8000-0000000000f1", name: "Ich" },
            since: "2026-10-18T12:00:00.000Z",
            heartbeatAt: "2026-10-18T12:00:00.000Z",
            own: true,
        };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ lock }) });
    });
    await page.route("**/api/editor/status", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ mapEditing: "testwelt" }),
        }),
    );
    await page.setViewportSize(BREIT);
    await page.goto(
        `${EDITOR_MODE}#x=${String(KOSCH.x)}&y=${String(KOSCH.y)}&z=${String(bandBeginn(6) + 0.5)}&series=original&view=${ansicht}`,
    );
    await page.waitForFunction(() => globalThis.avesmapsMap?.loaded() === true, undefined, { timeout: 30_000 });
    await settleFrame(page);
}

/** Eine Stelle mitten in der freien Karte, an der die Karte ein Gebiet zeigt; dort öffnet der Rechtsklick sein Fenster. */
async function oeffneGebiet(page: Page): Promise<{ x: number; y: number }> {
    const gefunden = await page.evaluate(() => {
        const map = globalThis.avesmapsMap!;
        const mitte = globalThis.avesmapsVisibleArea!.centre();
        for (let r = 0; r < 200; r += 2)
            for (let w = 0; w < 360; w += 20) {
                const x = Math.round(mitte.x + r * Math.cos((w * Math.PI) / 180));
                const y = Math.round(mitte.y + r * Math.sin((w * Math.PI) / 180));
                const ids = new Set(
                    map
                        .queryRenderedFeatures([x, y], { layers: ["territory-fill"] })
                        .map((f) => String(f.properties["territory_public_id"])),
                );
                if (ids.size === 1) return { x, y, id: [...ids][0]! };
            }
        return undefined;
    });
    expect(gefunden, "eine Stelle mit genau einem Gebiet").toBeDefined();
    gebietImStub = gefunden!.id;
    const at = await onPage(page, gefunden!);
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor").getByTestId("context-editor-gebiet-bearbeiten").click();
    await expect(
        page.locator('[data-testid^="gebietseditor-fenster-"]').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect.poll(() => detailAbrufe.length).toBeGreaterThan(0);
    return at;
}

/** Eine Ansicht über den Kartenfächer wählen; er klappt erst auf. */
async function waehleAnsicht(page: Page, ansicht: "standard" | "political"): Promise<void> {
    const zelle = page.getByTestId(`fan-view-${ansicht}`);
    if (!(await zelle.isVisible())) await page.getByTestId("fan-toggle").click();
    await zelle.click();
}

/** Drei Ecken links von `at`, in freier Karte (das Fenster dockt rechts an). */
const ecken = (at: { x: number; y: number }) => [
    { x: at.x - 120, y: at.y - 60 },
    { x: at.x - 30, y: at.y - 60 },
    { x: at.x - 70, y: at.y + 20 },
];

async function klicke(page: Page, punkte: readonly { x: number; y: number }[]): Promise<void> {
    for (const p of punkte) {
        await page.mouse.click(p.x, p.y);
        // Kein Doppelklick: zwei Klicks in 400 ms an derselben Stelle beenden.
        await page.waitForTimeout(450);
    }
}

test("🔴 beim Zeichnen gehört Strg dem Einrasten: Die Karte dreht nicht, auch ein verwackelter Klick setzt die Ecke, die Mitteltaste dreht weiter (Vali 2026-11-06)", async ({
    page,
}) => {
    await oeffne(page);
    const at = await oeffneGebiet(page);
    await page.getByTestId(/^gebietseditor-fenster-\d+-reiter-untergebiete$/).click();
    await page.getByTestId(/^gebietseditor-fenster-\d+-untergebiet-anlegen$/).click();
    await expect(page.getByTestId("neue-flaeche-leiste")).toBeVisible();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    const [a, b, c] = ecken(at);

    await page.keyboard.down("Control");
    await klicke(page, [a!]);
    // Verwackelt, unter der Klicktoleranz der Zeichenmodi von 12 px.
    await page.mouse.move(b!.x, b!.y);
    await page.mouse.down();
    await page.mouse.move(b!.x + 6, b!.y, { steps: 3 });
    await page.mouse.up();
    await expect(page.getByTestId("neue-flaeche-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    const ungedreht = async (): Promise<void> => {
        const kamera = await readCamera(page);
        expect(kamera.bearing).toBeCloseTo(0, 3);
        expect(kamera.pitch).toBeCloseTo(0, 3);
    };
    await ungedreht();

    await page.waitForTimeout(450);
    // Ein langer Zug dreht nicht, schiebt nicht und setzt nichts.
    const mitte = () => page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    const vorher = await mitte();
    await page.mouse.move(c!.x, c!.y);
    await page.mouse.down();
    await page.mouse.move(c!.x + 100, c!.y + 60, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up("Control");
    await ungedreht();
    expect(await mitte()).toEqual(vorher);
    await expect(page.getByTestId("neue-flaeche-leiste-ungespeichert")).toHaveText("1 ungespeichert");

    await page.mouse.move(c!.x, c!.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(c!.x + 50, c!.y, { steps: 10 });
    await page.mouse.up({ button: "middle" });
    expect((await readCamera(page)).bearing).toBeCloseTo(40, 0);
});

test("🔴 „Untergebiet anlegen“: die Leiste nennt das Obergebiet, „Fertig“ schreibt EINE Operation, die Ansicht BLEIBT, der Name steht markiert", async ({
    page,
}) => {
    await oeffne(page);
    const at = await oeffneGebiet(page);
    const obergebiet = detailAbrufe.at(-1)!;
    await page.getByTestId(/^gebietseditor-fenster-\d+-reiter-untergebiete$/).click();
    await page.getByTestId(/^gebietseditor-fenster-\d+-untergebiet-anlegen$/).click();
    const leiste = page.getByTestId("neue-flaeche-leiste");
    await expect(leiste).toBeVisible();
    await expect(leiste).toContainText("Neue Fläche");
    await expect(leiste).toContainText("Herrschaftsgebiet · wird Untergebiet von Probe");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);

    const [a, b, c] = ecken(at);
    await klicke(page, [a!, b!, c!]);
    await expect(page.getByTestId("neue-flaeche-leiste-ungespeichert")).toHaveText("2 ungespeichert");
    // Der Klick auf die erste Ecke schließt die Fläche und schreibt.
    await page.mouse.click(a!.x, a!.y);
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    expect(geschrieben[0]).toMatchObject({ method: "POST", url: "/api/editor/territories" });
    const body = geschrieben[0]!.body as { parent: string; color: string; ring: number[][] };
    expect(body.parent).toBe(obergebiet);
    expect(body.ring).toHaveLength(3);
    expect(body.color).toMatch(/^#[0-9a-f]{6}$/u);
    await expect(page.getByTestId("toast")).toContainText("Neues Herrschaftsgebiet (3)");
    // Bis die Ableitung zeichnet, steht die gespeicherte Fläche gestrichelt da (Betreiber 2026-10-19: „sofort von der karte verschwunden“).
    await expect
        .poll(() =>
            page.evaluate(() => {
                const karte = globalThis.avesmapsMap as unknown as
                    { getSource(id: string): unknown; getLayer(id: string): unknown } | undefined;
                const quelle = karte?.getSource("editor-entwurf-flaechen") as
                    { serialize(): { data: { features: { properties: { ebene: string } }[] } } } | undefined;
                const flaechen = quelle?.serialize().data.features ?? [];
                return {
                    gebiete: flaechen.filter((f) => f.properties.ebene === "herrschaftsgebiete").length,
                    kante: karte?.getLayer("editor-entwurf-kante") !== undefined,
                };
            }),
        )
        .toEqual({ gebiete: 1, kante: true });
    await page.screenshot({ path: "test-results/neue-flaeche-gebiet-ausstehend.png" });
    // Fertig: bleiben, das Fenster am neuen Gebiet, sein Name markiert (Frage 3).
    expect((await hashParams(page)).get("view")).toBe("political");
    await expect.poll(() => detailAbrufe.includes(NEU)).toBe(true);
    await expect
        .poll(() =>
            page.evaluate(() => {
                const feld = document.activeElement as HTMLInputElement | null;
                return feld?.closest('[data-testid$="-feld-name"]') !== null &&
                    feld?.value === "Neues Herrschaftsgebiet (3)" &&
                    feld.selectionStart === 0 &&
                    feld.selectionEnd === feld.value.length
                    ? "markiert"
                    : (feld?.outerHTML ?? "nichts");
            }),
        )
        .toBe("markiert");
});

test("🔴 Abbruch: zurück in die Ansicht von vorher; während des Zeichnens wechselt der Kartenfächer die Ansicht nicht", async ({
    page,
}) => {
    await oeffne(page);
    const at = await oeffneGebiet(page);
    await waehleAnsicht(page, "standard");
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("standard");
    await page.getByTestId(/^gebietseditor-fenster-\d+-reiter-untergebiete$/).click();
    await page.getByTestId(/^gebietseditor-fenster-\d+-untergebiet-anlegen$/).click();
    await expect(page.getByTestId("neue-flaeche-leiste")).toBeVisible();
    // Die Ansicht der Art: Politisch, und sie bleibt, solange gezeichnet wird.
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("political");
    await waehleAnsicht(page, "standard");
    await expect(page.getByTestId("toast")).toContainText("Erst fertig zeichnen oder mit Esc abbrechen.");
    expect((await hashParams(page)).get("view")).toBe("political");

    const [a, b] = ecken(at);
    await klicke(page, [a!, b!]);
    // Esc fragt (eine Kante steht), das zweite Esc verwirft: zurück nach „Standard“, nichts geschrieben.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("neue-flaeche-leiste-frage")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("neue-flaeche-leiste")).toHaveCount(0);
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("standard");
    expect(geschrieben).toEqual([]);
});

test("🔴 „Grenze zeichnen“ an einem Gebiet ohne eigene Fläche: Enter schreibt territory_area.create gegen die Revision", async ({
    page,
}) => {
    await oeffne(page);
    const at = await oeffneGebiet(page);
    const gebiet = detailAbrufe.at(-1)!;
    await page.getByTestId(/^gebietseditor-fenster-\d+-reiter-form$/).click();
    await page.getByTestId(/^gebietseditor-fenster-\d+-grenze-zeichnen$/).click();
    const leiste = page.getByTestId("neue-flaeche-leiste");
    await expect(leiste).toContainText("Grenze von Probe");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    await klicke(page, ecken(at));
    await page.keyboard.press("Enter");
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toEqual([
        {
            method: "POST",
            url: `/api/editor/territories/${gebiet}/areas`,
            body: expect.objectContaining({ baseRevision: 1, ring: expect.any(Array) }),
        },
    ]);
    expect((await hashParams(page)).get("view")).toBe("political");
});

test("🔴 Kartenmenü in Standard: „Hier hinzufügen › Neues Herrschaftsgebiet“ wechselt auf Politisch, nennt das Obergebiet an der Stelle und schreibt", async ({
    page,
}) => {
    await oeffne(page, "standard");
    const box = await page.getByTestId("map").boundingBox();
    const at = { x: (box?.x ?? 0) + (box?.width ?? 0) * 0.35, y: (box?.y ?? 0) + (box?.height ?? 0) * 0.5 };
    await page.mouse.click(at.x, at.y, { button: "right" });
    await page.getByTestId("context-editor-hier-hinzufuegen").hover();
    // Ein eigener Eintrag auf oberster Ebene, nicht im Untermenü der Fläche (Betreiber 2026-10-18).
    const eintrag = page.getByTestId("context-editor-neues-gebiet");
    await expect(eintrag).toHaveText(/Neues Herrschaftsgebiet/);
    await eintrag.click();
    const leiste = page.getByTestId("neue-flaeche-leiste");
    await expect(leiste).toBeVisible();
    await expect.poll(async () => (await hashParams(page)).get("view")).toBe("political");
    // Die Stelle des Menüs ist die erste Ecke; dort zeigt die Karte ein Gebiet, das wird das Obergebiet (Frage 2).
    await expect(leiste).toContainText("Herrschaftsgebiet · wird Untergebiet von");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);
    await klicke(page, [
        { x: at.x + 90, y: at.y - 40 },
        { x: at.x + 50, y: at.y + 60 },
    ]);
    await page.keyboard.press("Enter");
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    const body = geschrieben[0]!.body as { parent?: string; ring: number[][] };
    expect(body.parent).toMatch(/^[0-9a-f-]{36}$/u);
    expect(body.ring).toHaveLength(3);
    expect((await hashParams(page)).get("view")).toBe("political");
    await expect.poll(() => detailAbrufe.includes(NEU)).toBe(true);
});

test("🔴 OPS-000040 Leertaste: gehalten setzen zwei schnelle Klicks dicht beieinander zwei Ecken und schließen nicht; ohne Leertaste schließt der Doppelklick", async ({
    page,
}) => {
    await oeffne(page);
    const at = await oeffneGebiet(page);
    await page.getByTestId(/^gebietseditor-fenster-\d+-reiter-untergebiete$/).click();
    await page.getByTestId(/^gebietseditor-fenster-\d+-untergebiet-anlegen$/).click();
    const leiste = page.getByTestId("neue-flaeche-leiste");
    await expect(leiste).toBeVisible();
    await expect(leiste).toContainText("Leertaste");
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    await settleFrame(page);

    const [a, b, c] = ecken(at);
    await klicke(page, [a!, b!]);
    await expect(page.getByTestId("neue-flaeche-leiste-ungespeichert")).toHaveText("1 ungespeichert");
    // Gehalten: zwei schnelle Klicks 5 px auseinander, genau das Muster eines Doppelklicks, sind zwei Ecken (wie Legacy, dessen Entwurf
    // kein Einrastziel ist). 🪤 Die Taste öffnete zugleich die Suche (Kürzel), ihr Schleier fing den ersten Klick ab.
    await page.keyboard.down(" ");
    // Erst nach einem Bild: Das Kürzel öffnete die Suche mit dem nächsten Durchlauf von Vue.
    await page.evaluate(() => new Promise((fertig) => requestAnimationFrame(() => requestAnimationFrame(fertig))));
    await expect(page.getByTestId("search")).toHaveCount(0);
    await page.mouse.click(c!.x, c!.y);
    await page.mouse.click(c!.x + 5, c!.y);
    await expect(page.getByTestId("neue-flaeche-leiste-ungespeichert")).toHaveText("3 ungespeichert");
    await expect(leiste).toBeVisible();
    // Gehalten steht die Karte auch beim Ziehen (Legacy; Register 2026-10-19), und ein Druck, bei dem die Hand weiterzieht, ist trotzdem ein Klick: die Ecke beim
    // Loslassen. 🪤 Legacy verwirft ihn nicht, weil das Ziehen gesperrt ist; MapLibre verwarf ihn an der Klicktoleranz, und schnelles Klicken verlor Ecken.
    const mitte = () => page.evaluate(() => globalThis.avesmapsMap!.getCenter());
    const vorher = await mitte();
    await page.mouse.move(c!.x - 60, c!.y + 60);
    await page.mouse.down();
    await page.mouse.move(c!.x - 160, c!.y + 120, { steps: 8 });
    await page.mouse.up();
    expect(await mitte()).toEqual(vorher);
    await expect(page.getByTestId("neue-flaeche-leiste-ungespeichert")).toHaveText("4 ungespeichert");
    await page.keyboard.up(" ");
    await page.waitForTimeout(450);
    // Losgelassen zieht die Karte wieder.
    await page.mouse.move(c!.x - 60, c!.y + 60);
    await page.mouse.down();
    await page.mouse.move(c!.x - 100, c!.y + 80, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => globalThis.avesmapsMap?.isMoving() === false);
    expect(await mitte()).not.toEqual(vorher);
    await page.waitForTimeout(450);
    // Ohne Leertaste: der Doppelklick setzt die Ecke und schließt die Fläche.
    await page.mouse.click(c!.x + 20, c!.y + 30);
    await page.mouse.click(c!.x + 20, c!.y + 30);
    await expect(leiste).toHaveCount(0);
    expect(geschrieben).toHaveLength(1);
    expect((geschrieben[0]!.body as { ring: number[][] }).ring).toHaveLength(6);
});
