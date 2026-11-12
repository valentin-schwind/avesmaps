import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";

/**
 * Sichtvergleich Legacy ↔ Avesmaps3D an denselben Kartenstellen (WI-0014, Finding MCS-015).
 *
 * 💣 DIESER LAUF PRÜFT NICHTS. Er legt eine Entscheidung vor, die nur ein Mensch treffen kann, und
 * die Frage ist ausdrücklich nicht „sind die Hexwerte gleich", sondern: **wirkt Avesmaps3D wie
 * Avesmaps und ist es mindestens genauso gut lesbar?**
 *
 * 🪤 DIE ZOOMZAHLEN DER BEIDEN SIND NICHT DIESELBEN. Legacy zeichnet mit Leaflet auf 0..1024 und
 * hat bei Zoom z genau 2^z Bildpunkte je Karteneinheit; MapLibre spannt dieselben 1024 Einheiten
 * über seine Weltbreite. Ein Bild „beide auf z5" vergliche deshalb zwei verschiedene Ausschnitte,
 * und jeder Unterschied in der Schriftgröße wäre ein Artefakt des Vergleichs statt ein Befund. Der
 * Lauf misst stattdessen Legacys Ausschnitt und zwingt Avesmaps3D auf **dieselben Kartenkoordinaten**
 * — danach zeigen beide Bilder denselben Weltausschnitt, und was sich unterscheidet, ist Gestaltung.
 *
 * 🪤 Legacys Randleisten werden nur unsichtbar gemacht (`visibility: hidden`), nichts angeklickt und
 * nichts gespeichert. Der Zugriff auf avesmaps.de bleibt lesend und auf diese wenigen Seitenaufrufe
 * begrenzt.
 *
 * 💣 UND BEIDE MUESSEN DENSELBEN UNTERGRUND ZEIGEN. Der erste Lauf verglich Legacys „Modern" gegen
 * unser „Original" - zwei verschiedene Rasterkarten. Jeder Unterschied im Bild war damit erst
 * einmal der falsche Untergrund, und die Frage nach der Beschriftung liess sich gar nicht stellen.
 * Legacy heisst die Serie `original`, wir auch; gesetzt wird sie auf beiden Seiten ausdruecklich.
 *
 *   npm run review:parity
 */

/** Der Untergrund, auf dem verglichen wird - auf BEIDEN Seiten derselbe. */
const SERIE = "original";

const OUTPUT = resolve(import.meta.dirname, "../../../review/design-parity");
const LEGACY = "https://avesmaps.de/";

/** Die Stellen, an denen verglichen wird - jede mit einer Absicht. */
const VIEWS = [
    { id: "uebersicht-z2", x: 512, y: 512, legacyZoom: 2, frage: "Ganz Aventurien: tragen die Namen den Überblick?" },
    {
        id: "nordmarken-z4",
        x: 520,
        y: 500,
        legacyZoom: 4,
        frage: "Landschaftsnamen in Versalien gegen Ortsnamen — stimmt die Hierarchie?",
    },
    {
        id: "gareth-z5",
        x: 551.625,
        y: 532.969,
        legacyZoom: 5,
        frage: "Dichtestes Gedränge der Karte: bleibt jeder Name lesbar?",
    },
    {
        id: "perricum-kueste-z6",
        x: 610,
        y: 520,
        legacyZoom: 6,
        frage: "Helle Wasserflächen: trägt der Saum die hellen Namen?",
    },
    {
        id: "ruine-wuestung-loskarn-z7",
        // Genau auf der Ruine, nicht ungefaehr: bei z7 ist der Ausschnitt nur zehn Karteneinheiten
        // breit, und ein Name, der knapp daneben liegt, beantwortet die Frage nicht.
        x: 588.06,
        y: 575.83,
        legacyZoom: 7,
        frage: 'Ruinen kursiv: „Wuestung Loskarn" steht in der Bildmitte.',
    },
] as const;

/**
 * Leaflets Karteninstanz ist bei Legacy modul-lokal, also über keinen Globalzeiger erreichbar.
 *
 * ⭐ Sie lässt sich trotzdem einfangen, ohne die Seite zu verändern: jeder Mausbewegungs-Handler
 * ruft `mouseEventToContainerPoint` mit `this` = Karte. Der Prototyp wird kurz umgelenkt, ein
 * Mausereignis ausgelöst, der Prototyp zurückgesetzt.
 */
const CAPTURE_LEAFLET = `
const proto = L.Map.prototype, orig = proto.mouseEventToContainerPoint;
proto.mouseEventToContainerPoint = function (...a) { globalThis.__k = this; return orig.apply(this, a); };
const el = document.querySelector(".leaflet-container");
const r = el.getBoundingClientRect();
el.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
proto.mouseEventToContainerPoint = orig;
`;

interface Bounds {
    west: number;
    east: number;
    south: number;
    north: number;
}

async function shootLegacy(page: Page, view: (typeof VIEWS)[number]): Promise<Bounds> {
    await page.goto(LEGACY, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    await page.evaluate(CAPTURE_LEAFLET);
    const bounds = await page.evaluate(
        async ({ x, y, zoom, serie }) => {
            const m = (globalThis as unknown as { __k: never }).__k as unknown as {
                setView(c: [number, number], z: number, o: unknown): void;
                getBounds(): {
                    getWest(): number;
                    getEast(): number;
                    getSouth(): number;
                    getNorth(): number;
                };
            };
            // Denselben Untergrund wie Avesmaps3D zeigen.
            (globalThis as unknown as { setMapStyle(id: string): void }).setMapStyle(serie);
            // Alles, was nicht Karte ist, ausblenden - nur sichtbar, nicht entfernt.
            for (const selector of [
                "#search",
                "#toggle-button",
                ".avesmaps-infopanel",
                "#panel-tabs",
                ".leaflet-control-container",
            ]) {
                document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
                    node.style.visibility = "hidden";
                });
            }
            m.setView([y, x], zoom, { animate: false });
            await new Promise((done) => setTimeout(done, 4000));
            const b = m.getBounds();
            return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
        },
        { x: view.x, y: view.y, zoom: view.legacyZoom, serie: SERIE },
    );
    await page.screenshot({ path: resolve(OUTPUT, `${view.id}-legacy.png`) });
    return bounds;
}

async function shootAvesmaps3d(page: Page, view: (typeof VIEWS)[number], bounds: Bounds): Promise<number> {
    await page.goto(`/#x=512&y=512&z=4&series=${SERIE}&view=standard&layer=alle`);
    await page.waitForFunction(() => Boolean(globalThis.avesmapsMap?.isStyleLoaded()));
    // Die eigenen Bedienflächen ebenso ausblenden - verglichen wird die KARTE.
    await page.addStyleTag({
        content:
            ".route-planner, .fan, .camera-controls, .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right { visibility: hidden; }",
    });
    const zoom = await page.evaluate(async (box: Bounds) => {
        const projection = globalThis.avesmapsRenderProjection!;
        const map = globalThis.avesmapsMap as unknown as {
            fitBounds(b: [[number, number], [number, number]], o: unknown): void;
            getZoom(): number;
            once(event: string, handler: () => void): void;
        };
        const southWest = projection.toRenderLngLat({ x: box.west, y: box.south });
        const northEast = projection.toRenderLngLat({ x: box.east, y: box.north });
        map.fitBounds(
            [
                [southWest.lng, southWest.lat],
                [northEast.lng, northEast.lat],
            ],
            { animate: false, padding: 0 },
        );
        await new Promise((done) => setTimeout(done, 4000));
        return map.getZoom();
    }, bounds);
    await page.screenshot({ path: resolve(OUTPUT, `${view.id}-a3d.png`) });
    return zoom;
}

test("legt Legacy und Avesmaps3D nebeneinander", async ({ page }) => {
    test.setTimeout(420_000);
    mkdirSync(OUTPUT, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    const zeilen: string[] = [
        "# Sichtvergleich Legacy ↔ Avesmaps3D",
        "",
        "Erzeugt von `npm run review:parity` (WI-0014). Jede Zeile zeigt **denselben Kartenausschnitt**:",
        "Legacys Ausschnitt wird gemessen, Avesmaps3D auf dieselben Kartenkoordinaten gezwungen.",
        "",
        "🔴 Die Frage ist nicht, ob die Werte gleich sind, sondern: **wirkt es wie Avesmaps und ist es",
        "mindestens genauso gut lesbar?**",
        "",
    ];

    for (const view of VIEWS) {
        const bounds = await shootLegacy(page, view);
        const zoom = await shootAvesmaps3d(page, view, bounds);
        zeilen.push(
            `## ${view.id}`,
            "",
            `${view.frage}`,
            "",
            `Ausschnitt: x ${bounds.west.toFixed(2)}…${bounds.east.toFixed(2)}, y ${bounds.south.toFixed(2)}…${bounds.north.toFixed(2)}`,
            `· Legacy z${view.legacyZoom} · Avesmaps3D z${zoom.toFixed(2)}`,
            "",
            `| Legacy | Avesmaps3D |`,
            `|---|---|`,
            `| ![Legacy](${view.id}-legacy.png) | ![Avesmaps3D](${view.id}-a3d.png) |`,
            "",
        );
        console.warn(`${view.id}: Legacy z${view.legacyZoom} -> Avesmaps3D z${zoom.toFixed(2)}`);
    }

    writeFileSync(resolve(OUTPUT, "index.md"), `${zeilen.join("\n")}\n`);
});
