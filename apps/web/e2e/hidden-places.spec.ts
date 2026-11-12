import { expect, test, type Page } from "@playwright/test";
import { EDITOR_MODE, onPage, openMap, settleFrame, showPlace } from "./map-handle.ts";
import { stubAdmin } from "./verwaltung-stub.ts";

/**
 * Verborgene Orte werden auf der Karte entdeckt (WI-0080).
 *
 * 🔴 Betreiber 2026-10-05: „verborgene orte sind spielerisch nur über die karte zu erkunden … können aber ganz
 * normal angeklickt und bereist werden, wenn sie entdeckt werden“ — und zur Deutlichkeit: „‚Erkunden‘ heißt ich
 * scroll auf der Karte herum. Seh ihn und klick ihn an. Ähnlich wie bei ‚Wo ist Waldo?‘“
 *
 * Gemessen wird deshalb genau der Weg des Lesers: Die Marke steht da (sonst gäbe es nichts zu finden), der Name
 * steht nicht da (sonst wäre es kein Fund), und der Klick öffnet das volle Panel.
 *
 * 🪤 An den Datensatz gebunden: Im Satz vom 2026-10-05 trägt die Karte 33 verborgene Orte, einer davon „Der
 * verlassene Ritualplatz der Orks“ bei (544,93 | 662,26). Der Test sucht sich seinen Ort aus der geladenen
 * Kachel und überspringt sichtbar, wenn dort keiner steht — statt still grün zu sein.
 */

/** Die Stelle, an der im heutigen Satz ein verborgenes Bauwerk steht. */
const RITUALPLATZ = { x: 544.93, y: 662.26 };

/**
 * OPS-068: Die Marke eines verborgenen Orts steht erst ab der fachlichen Stufe 8 (Zoomband „Verborgene Orte“), also ab MapLibre-Zoom 9
 * (`renderZoomForBand(8)`; Stufe 8 gilt bis 9,5). 9,2 liegt mit Spielraum mittendrin. Die Tests unten, die eine Marke brauchen, springen
 * hierher - vorher genügte Zoom 8, das ist heute Stufe 7.
 */
const STUFE_8 = 9.2;
/** Stufe 7: Hier steht ein gewöhnliches Bauwerk schon, ein verborgenes noch nicht. */
const STUFE_7 = 8.5;

interface VerborgenerOrt {
    id: string;
    name: string;
    screen: { x: number; y: number };
}

/** Sucht in den geladenen Kacheln einen verborgenen Ort, der im Bild liegt. */
async function verborgenerOrtImBild(page: Page): Promise<VerborgenerOrt | undefined> {
    return page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            querySourceFeatures(
                source: string,
                options: { sourceLayer: string },
            ): { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } }[];
            project(lngLat: [number, number]): { x: number; y: number };
            getCanvas(): { clientWidth: number; clientHeight: number };
        };
        const canvas = map.getCanvas();
        for (const feature of map.querySourceFeatures("places", { sourceLayer: "place_render" })) {
            if (feature.properties["is_hidden"] !== true) continue;
            const screen = map.project(feature.geometry.coordinates);
            if (screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight) {
                continue;
            }
            return {
                id: String(feature.properties["public_id"] ?? ""),
                name: String(feature.properties["name"] ?? ""),
                screen: { x: Math.round(screen.x), y: Math.round(screen.y) },
            };
        }
        return undefined;
    });
}

test("🔴 ein verborgener Ort steht als Marke auf der Karte, ohne Namen, und ein Klick öffnet sein Panel", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, RITUALPLATZ, STUFE_8);
    await settleFrame(page);

    const ort = await verborgenerOrtImBild(page);
    test.skip(ort === undefined, "kein verborgener Ort in der geladenen Kachel (anderer Datensatz?)");
    const { id, name, screen } = ort as VerborgenerOrt;
    expect(name, "der verborgene Ort trägt einen Namen in den Daten").not.toBe("");

    // 1. Die Marke ist gezeichnet - das ist die einzige Spur, die zum Fund führt.
    const gezeichnet = await page.evaluate(
        ({ screen, id }) => {
            const map = globalThis.avesmapsMap as unknown as {
                queryRenderedFeatures(
                    box: [[number, number], [number, number]],
                    options: { layers: string[] },
                ): { properties: Record<string, unknown> }[];
            };
            const box: [[number, number], [number, number]] = [
                [screen.x - 12, screen.y - 12],
                [screen.x + 12, screen.y + 12],
            ];
            const marken = map.queryRenderedFeatures(box, { layers: ["place-marker", "place-marker-structure"] });
            return marken.some((feature) => String(feature.properties["public_id"]) === id);
        },
        { screen, id },
    );
    expect(gezeichnet, `die Marke von „${name}" steht auf der Karte`).toBe(true);

    // 2. Sein Name steht nirgends im Bild - weder als Ortsname noch sonst irgendwo.
    const beschriftet = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap as unknown as {
            getStyle(): { layers: { id: string }[] };
            queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
        };
        // Die Ortsnamen stehen seit WI-0135 je Klasse und Seite in eigenen Ebenen.
        const ortsnamen = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((layer) => layer.startsWith("place-label-"));
        return map
            .queryRenderedFeatures({ layers: ortsnamen })
            .some((feature) => String(feature.properties["public_id"]) === id);
    }, id);
    expect(beschriftet, `der Name von „${name}" bleibt weg`).toBe(false);

    // 3. Der Klick darauf öffnet das volle Panel - vorher kam von `/api/subjects/place/{id}` ein 404.
    const auf = await onPage(page, screen);
    await page.mouse.click(auf.x, auf.y);
    await expect(page.getByTestId("info-panel")).toBeVisible();
    await expect(page.getByTestId("info-title")).toHaveText(name);
});

/**
 * OPS-068, Idee des Betreibers über Vali: „Verborgene Orte sollen nur ab Zoom 8 sichtbar werden, andernfalls findet man sie bereits auf
 * große Entfernung (gibt auch große Städte, die verborgen sind)“. „Zoom 8“ ist die Stufe der Zoomanzeige des Editors (MapLibre-Zoom 9).
 *
 * 🪤 Gemessen wird an der GEZEICHNETEN Marke (`queryRenderedFeatures` auf den Markenebenen), nicht an der Kachel: Die Kachel trägt den
 * Ort auf jeder Stufe, der Stil lässt ihn nur im Zoomband zeichnen. Dieselbe Naht wie oben.
 */
async function markeGezeichnet(page: Page, id: string): Promise<boolean> {
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap as unknown as {
            queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
        };
        return map
            .queryRenderedFeatures({ layers: ["place-marker", "place-marker-structure"] })
            .some((feature) => String(feature.properties["public_id"]) === id);
    }, id);
}

test("🔴 aus der Ferne (Stufe 7) steht die Marke eines verborgenen Orts nicht, ab Stufe 8 schon", async ({ page }) => {
    await openMap(page);
    await showPlace(page, RITUALPLATZ, STUFE_8);
    await settleFrame(page);
    const ort = await verborgenerOrtImBild(page);
    test.skip(ort === undefined, "kein verborgener Ort in der geladenen Kachel (anderer Datensatz?)");
    const { id, name } = ort as VerborgenerOrt;
    expect(await markeGezeichnet(page, id), `„${name}“ steht auf Stufe 8`).toBe(true);

    await showPlace(page, RITUALPLATZ, STUFE_7);
    await settleFrame(page);
    // Der Ort ist in der Kachel (sonst wäre die Aussage leer), aber nicht gezeichnet.
    expect(await verborgenerOrtImBild(page), "die Kachel trägt den Ort weiter").toBeDefined();
    expect(await markeGezeichnet(page, id), `„${name}“ steht auf Stufe 7 nicht`).toBe(false);

    // Und noch weiter weg erst recht nicht.
    await showPlace(page, RITUALPLATZ, 5);
    await settleFrame(page);
    expect(await markeGezeichnet(page, id), `„${name}“ steht auf Stufe 4 nicht`).toBe(false);
});

test("🔴 im Editor-Modus steht die Marke auch aus der Ferne: Wer Orte pflegt, findet auch verborgene", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, RITUALPLATZ, STUFE_8);
    await settleFrame(page);
    const ort = await verborgenerOrtImBild(page);
    test.skip(ort === undefined, "kein verborgener Ort in der geladenen Kachel (anderer Datensatz?)");
    const { id, name } = ort as VerborgenerOrt;

    // Ein angemeldeter Editor: Ist die Anmeldung eingerichtet, kommen die Werkzeuge aus der Sitzung, nicht aus `/edit` allein
    // (`viewer/bootstrap-viewer.ts`); ohne gestellte Sitzung wäre `/edit` die Besucheransicht.
    await stubAdmin(page, { capabilities: ["view_flow_directions", "use_editor_menu"], role: "editor" });
    await openMap(page, EDITOR_MODE);
    await showPlace(page, RITUALPLATZ, STUFE_7);
    await settleFrame(page);
    expect(await markeGezeichnet(page, id), `„${name}“ steht im Editor-Modus auf Stufe 7`).toBe(true);
});

/**
 * Die Pille „Verborgen“ (Nachtrag 2026-10-05, Betreiber: „kannst du eine weitere pille in lila neben ‚offiziell/inoffiziell‘ mit den
 * titel ‚Verborgen‘“). Sie steht NEBEN dem Kanon-Etikett und nur an einem verborgenen Ort.
 *
 * 🪤 Gemessen wird auch, dass die beiden in EINER Zeile bleiben - bei langem Namen und bei 360 px. Die Kanon-Pille darf dafür
 * schrumpfen, ihr Bezeichner endet dann an der Kontur, wie wenn sie allein steht.
 */
test("🔴 ein verborgener Ort trägt die Pille „Verborgen“ neben der Kanon-Pille, ein gewöhnlicher nicht", async ({
    page,
}) => {
    await openMap(page);
    await showPlace(page, RITUALPLATZ, STUFE_8);
    await settleFrame(page);
    const ort = await verborgenerOrtImBild(page);
    test.skip(ort === undefined, "kein verborgener Ort in der geladenen Kachel (anderer Datensatz?)");
    const { id, name } = ort as VerborgenerOrt;

    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), { kind: "place", id });
    await expect(page.getByTestId("info-title")).toHaveText(name);
    const kopf = page.getByTestId("info-header");
    await expect(kopf.getByTestId("info-hidden")).toHaveText(/Verborgen/i);

    // Beide Pillen auf einer Zeile: gleiche Oberkante, und die zweite steht rechts von der ersten.
    const kanon = kopf.getByTestId("info-canon");
    if ((await kanon.count()) > 0) {
        const links = await kanon.first().boundingBox();
        const rechts = await kopf.getByTestId("info-hidden").boundingBox();
        expect(links).not.toBeNull();
        expect(rechts).not.toBeNull();
        expect(Math.abs((links?.y ?? 0) - (rechts?.y ?? 0)), "beide Pillen auf einer Zeile").toBeLessThanOrEqual(1);
        expect((rechts?.x ?? 0) >= (links?.x ?? 0) + (links?.width ?? 0), "Verborgen steht rechts daneben").toBe(true);
    }

    // Ein gewöhnlicher Ort bekommt sie nicht - Gareth, derselbe Kopf, dieselbe Zeile.
    await page.evaluate(() =>
        globalThis.avesmapsOpenSubject?.({ kind: "place", id: "80558060-4299-54aa-b520-814b10819885" }),
    );
    await expect(page.getByTestId("info-title")).toHaveText("Gareth");
    await expect(kopf.getByTestId("info-canon")).toBeVisible();
    await expect(kopf.getByTestId("info-hidden")).toHaveCount(0);
});

test("🪤 am Telefon (360 px) stehen beide Pillen nebeneinander, ohne Umbruch und ohne Überlauf", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 });
    await openMap(page);
    await showPlace(page, RITUALPLATZ, STUFE_8);
    await settleFrame(page);
    const ort = await verborgenerOrtImBild(page);
    test.skip(ort === undefined, "kein verborgener Ort in der geladenen Kachel (anderer Datensatz?)");
    const { id } = ort as VerborgenerOrt;

    await page.evaluate((ref) => globalThis.avesmapsOpenSubject?.(ref), { kind: "place", id });
    const kopf = page.getByTestId("info-header");
    const verborgen = kopf.getByTestId("info-hidden");
    await expect(verborgen).toBeVisible();
    const kanon = kopf.getByTestId("info-canon");
    if ((await kanon.count()) > 0) {
        const links = await kanon.first().boundingBox();
        const rechts = await verborgen.boundingBox();
        expect(Math.abs((links?.y ?? 0) - (rechts?.y ?? 0)), "kein Umbruch bei 360 px").toBeLessThanOrEqual(1);
    }
    // Nichts läuft aus dem Panel heraus.
    const panel = await page.getByTestId("info-panel").boundingBox();
    const pille = await verborgen.boundingBox();
    expect((pille?.x ?? 0) + (pille?.width ?? 0)).toBeLessThanOrEqual((panel?.x ?? 0) + (panel?.width ?? 0) + 1);
});

test("🔴 die Suche nennt ihn nicht, auch nicht bei genauem Namen", async ({ page }) => {
    await openMap(page);
    await showPlace(page, RITUALPLATZ, STUFE_8);
    await settleFrame(page);
    const ort = await verborgenerOrtImBild(page);
    test.skip(ort === undefined, "kein verborgener Ort in der geladenen Kachel (anderer Datensatz?)");
    const { name } = ort as VerborgenerOrt;

    const treffer = await page.evaluate(async (name) => {
        const antwort = await fetch(`/api/search?q=${encodeURIComponent(name)}`);
        if (!antwort.ok) return { status: antwort.status, namen: [] as string[] };
        const daten = (await antwort.json()) as { hits?: { name?: string }[] };
        return { status: antwort.status, namen: (daten.hits ?? []).map((hit) => hit.name ?? "") };
    }, name);
    expect(treffer.status).toBe(200);
    expect(treffer.namen, `„${name}" darf in keiner Suche stehen`).not.toContain(name);
});
