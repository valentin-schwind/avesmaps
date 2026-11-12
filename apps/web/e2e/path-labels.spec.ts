import { expect, test, type Page } from "@playwright/test";
import { renderZoomForBand } from "@avesmaps3d/shared";
import { openMap, showPlace, GARETH } from "./map-handle.ts";

/**
 * Die Wegbeschriftung auf der echten Karte (WI-0010 P5/P6).
 *
 * 💣 Der Anlass: ohne abgeleitete Schriftläufe stand von 149 Wegnamen im Bild EINER auf der Karte.
 * Nicht wegen der Ortsnamen und nicht wegen der Segmentlänge, sondern weil eine Kette wie
 * „Reichsstraße 2" ein MultiLineString aus 74 Abschnitten über die halbe Karte ist.
 *
 * 🪤 Gemessen wird, was GEZEICHNET ist, nicht was im Stil steht.
 */

interface MapHandle {
    getStyle(): { layers: { id: string }[] };
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
    setZoom(zoom: number): void;
}

async function gezeichnet(page: Page, layers: string[]): Promise<string[]> {
    await page.waitForTimeout(1500);
    return page.evaluate(
        (ids) =>
            (globalThis.avesmapsMap as unknown as MapHandle)
                .queryRenderedFeatures({ layers: ids })
                .map((feature) => String(feature.properties["name"])),
        layers,
    );
}

/** Die Ebenen der Ortsnamen: seit WI-0135 je Klasse und Seite eine. */
async function ortsnamenEbenen(page: Page): Promise<string[]> {
    return ebenenDerFamilie(page, ["place-label"]);
}

/** Die Ebenen einer Namensfamilie im Stil: seit WI-0135 je Klasse (Orte) oder Landschaftsebene (Namen) eine. */
async function ebenenDerFamilie(page: Page, familien: string[]): Promise<string[]> {
    return page.evaluate(
        (prefixe) =>
            (globalThis.avesmapsMap as unknown as MapHandle)
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => prefixe.some((prefix) => id.startsWith(`${prefix}-`))),
        familien,
    );
}

/** Punin: viele Wege und Flüsse, wenig Gedränge von Orten - bei z6 stehen dort sieben Wegnamen (2026-09-24). */
const PUNIN = { x: 518.257, y: 441.229 };

test("🔴 Wegnamen stehen auf der Karte", async ({ page }) => {
    // 🪤 Nicht mehr um Gareth: Seit dem Legacy-Stand vom 24.09. (145 neue Orte im Umkreis) lassen
    // Burgen, Güter und Hügelnamen dort bei z6 nur einen Wegnamen stehen - und das ist gewollt
    // (Betreiber 2026-09-24: „es ist gut, wenn nicht alles überwuchert … man kann ja reinzoomen“,
    // legacy-visueller-katalog.md). Gezählt wird deshalb an einer Stelle ohne dieses Gedränge.
    await openMap(page);
    await showPlace(page, PUNIN, 6);
    const namen = await gezeichnet(page, ["path-label"]);
    const verschieden = new Set(namen);

    // Die Schwelle ist bewusst niedrig: geprüft wird, dass die Beschriftung ÜBERHAUPT trägt.
    // Wie viele es genau sind, hängt vom Kartenausschnitt ab und wäre eine Zahl, die bei jeder
    // Datenänderung nachgezogen werden müsste.
    expect(verschieden.size, `gezeichnete Wegnamen: ${[...verschieden].join(", ")}`).toBeGreaterThanOrEqual(5);
});

test("💣 kein Name steht siebenundsiebzig Mal", async ({ page }) => {
    // Der Kern des Umbaus. „Reichsstraße 2" verteilt sich auf 74 Abschnitte; ohne Kettenbildung
    // bäte jeder einzeln um Platz.
    // 🪤 Bei Punin, nicht bei Gareth: Seit Satz map154313 steht dort bei z6 kein Wegname mehr, und der
    // Test war grün, ohne etwas geprüft zu haben.
    await openMap(page);
    await showPlace(page, PUNIN, 6);
    const namen = await gezeichnet(page, ["path-label"]);
    expect(namen.length, "es werden überhaupt Wegnamen gezeichnet").toBeGreaterThan(0);

    const haeufigkeit = new Map<string, number>();
    for (const name of namen) {
        haeufigkeit.set(name, (haeufigkeit.get(name) ?? 0) + 1);
    }
    for (const [name, anzahl] of haeufigkeit) {
        // Mehrere Instanzen entlang einer langen Straße sind gewollt - eine Reichsstraße quer
        // durchs Bild soll nicht nur einmal heißen. Was nicht sein darf, ist die Vervielfachung
        // pro Abschnitt.
        expect(anzahl, `${name} steht ${String(anzahl)} Mal`).toBeLessThanOrEqual(4);
    }
});

test("🔴 der Name läuft auf seinem Weg, nicht daneben", async ({ page }) => {
    // Die Zusicherung, für die auf jede Glättung verzichtet wurde. In der Datenbank ist sie exakt
    // (`verify:path-runs`, Prüfung `auf_dem_weg`); hier wird sie auf der KARTE gegengeprüft: unter
    // jedem Schriftlauf muss eine Weglinie derselben Art liegen.
    //
    // 🪤 Die Standardansicht startet OHNE Flusslinien (WI-0028, Legacys Besucherprofil): die Kachel
    // malt die Flüsse, und ihr Name steht über dem gemalten Fluss. Damit auch Flussnamen gegen ihre
    // Linie geprüft werden, schaltet der Test „Flüsse" im Auge-Menü zu.
    await openMap(page);
    await page.getByTestId("display-open").click();
    await page.getByTestId("display-rivers").click();
    await page.getByTestId("display-open").click();
    // Bei Punin: Um Gareth verdrängen seit Satz map154313 die vielen Orte bei z6 jeden Wegnamen.
    await showPlace(page, PUNIN, 6);
    await page.waitForTimeout(1800);

    const treffer = await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as MapHandle & {
            project(c: [number, number]): { x: number; y: number };
            queryRenderedFeatures(
                p: [[number, number], [number, number]] | { layers: string[] },
                o?: { layers: string[] },
            ): unknown[];
            getStyle(): { layers: { id: string }[] };
        };
        // 🪤 ALLE Wegebenen aus dem Stil, keine Liste von Hand. Hier standen sechs Namen; seit den
        // Wegbreiten (V12) gibt es eigene Ebenen für Bäche, Pässe und Wüstenpfade, und ein Name auf
        // einem Bach galt dem Test als „daneben". Eine Liste, die jemand nachziehen muss, veraltet.
        const weglinien = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("path-center-"));
        // Die EXAKTE Lage prüft die Datenbank (`verify:path-runs`, auf_der_sichtbaren_linie). Hier
        // geht es um das Bild, und dort rundet die Kachel auf ihr Raster: 2 px Spielraum. Gemessen
        // 2026-09-23 an „Gardel": der Punkt verfehlt die dünne Linie um ein Pixel.
        const SPIEL = 2;
        const labels = map.queryRenderedFeatures({ layers: ["path-label"] }) as {
            properties: Record<string, unknown>;
            geometry: { type: string; coordinates: number[][] };
        }[];
        let geprueft = 0;
        let daneben = 0;
        for (const label of labels.slice(0, 12)) {
            const linie = label.geometry.coordinates;
            if (!Array.isArray(linie) || linie.length === 0) {
                continue;
            }
            const mitte = linie[Math.floor(linie.length / 2)] as number[];
            const punkt = map.project([mitte[0] as number, mitte[1] as number]);
            const unten = map.queryRenderedFeatures(
                [
                    [punkt.x - SPIEL, punkt.y - SPIEL],
                    [punkt.x + SPIEL, punkt.y + SPIEL],
                ],
                { layers: weglinien },
            );
            geprueft += 1;
            if (unten.length === 0) {
                daneben += 1;
            }
        }
        return { geprueft, daneben };
    });

    expect(treffer.geprueft, "es wurde überhaupt etwas geprüft").toBeGreaterThan(0);
    expect(
        treffer.daneben,
        `${String(treffer.daneben)} von ${String(treffer.geprueft)} Namen liegen auf keiner Weglinie`,
    ).toBe(0);
});

test("🪤 die Beschriftung trägt über mehrere Zoomstufen", async ({ page }) => {
    // Ohne Zoombänder stünden am unteren Rand drei Namen auf einer Strecke, auf die keiner passt -
    // und MapLibre liesse dann alle weg.
    //
    // 🪤 BÄNDER, über `renderZoomForBand`: Avesmaps3D z = Band + 1 (WI-0015). Hier standen rohe
    // MapLibre-Stufen, und seit dem Zoomversatz fragte der Test eine Stufe zu weit draußen.
    //
    // 💣 DIE ANDEREN NAMEN SIND HIER AUSGEBLENDET, und das ist keine Schonung, sondern die Frage des
    // Tests: tragen die ZOOMBÄNDER DER LÄUFE? Über Gareth liegen auf Band 4 genug Läufe (allein
    // stünden vier Wegnamen), sie verlieren aber jede Kollision gegen Orts- und Landschaftsnamen.
    // Das ist ein ECHTER Unterschied zu Legacy, das dort Reichsstraße 2, Rakula und Warna zeigt —
    // festgehalten als eigener Befund (project-control/state/current.md, 2026-09-23), nicht hier
    // weggetestet. Seine Ursachen: mehr Landschaftsnamen als Legacy, und Legacy lässt einen Wegnamen
    // bis 160 px an seiner Linie entlang ausweichen. Bei uns darf er seit Migration 0030 nur ±¼
    // seiner Länge ausweichen — mehr gibt MapLibre ohne doppelte Namen nicht her —, und das reicht
    // auf Band 4 über Gareth noch nicht.
    await openMap(page);
    await showPlace(page, GARETH, renderZoomForBand(4));
    await page.evaluate(() => {
        const map = globalThis.avesmapsMap as unknown as {
            getLayer(id: string): unknown;
            getStyle(): { layers: { id: string }[] };
            setLayoutProperty(id: string, property: string, value: unknown): void;
        };
        // Die Ortsnamen stehen seit WI-0135 je Klasse und Seite in eigenen Ebenen. Dazu weichen die Wegnamen seitdem jeder
        // Ortsmarkierung aus (Sperrflächen `place-collision-*`): Über Gareth stand auf Band 4 dann keiner mehr. Gefragt ist
        // hier aber nur, ob die Zoombänder der Läufe tragen, also gehen auch die Sperrflächen aus.
        const ortsnamen = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter(
                (id) =>
                    id.startsWith("place-label-") ||
                    id.startsWith("place-collision-") ||
                    id.startsWith("map-label-") ||
                    id.startsWith("landscape-label-run-"),
            );
        for (const id of ortsnamen) {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, "visibility", "none");
            }
        }
    });

    const proStufe: Record<number, number> = {};
    for (const zoom of [4, 5, 6, 7]) {
        await page.evaluate((z) => {
            (globalThis.avesmapsMap as unknown as MapHandle).setZoom(z);
        }, renderZoomForBand(zoom));
        proStufe[zoom] = new Set(await gezeichnet(page, ["path-label"])).size;
    }
    for (const [zoom, anzahl] of Object.entries(proStufe)) {
        expect(anzahl, `auf Band ${zoom} steht kein einziger Wegname`).toBeGreaterThan(0);
    }
});

test("💣 ein Lauf steht nie doppelt, auch nicht zwischen zwei ganzen Stufen", async ({ page }) => {
    // Seit Migration 0030 liefert die Kachel je Lauf bis zu fünf AUSWEICHKANDIDATEN. Dass höchstens
    // einer erscheint, hängt allein daran, dass sie sich gegenseitig überdecken — und das gilt nur,
    // solange ihr größter Abstand die halbe Namenslänge nicht übersteigt (SLIDE_SHARE ¼). Die
    // gefährliche Stelle ist KURZ VOR der nächsten ganzen Stufe: dort ist der Name auf der Karte nur
    // noch halb so lang wie beim Schneiden der Kachel.
    await openMap(page);
    const doppelt: string[] = [];
    for (const zoom of [5.95, 6, 6.95, 7, 7.95]) {
        await showPlace(page, GARETH, zoom);
        const funde = await page.evaluate(() => {
            const map = globalThis.avesmapsMap as unknown as MapHandle;
            const zaehler = new Map<string, number>();
            for (const feature of map.queryRenderedFeatures({ layers: ["path-label"] })) {
                const p = feature.properties;
                const schluessel = `${String(p["name"])}|${String(p["subtype"])}|${String(p["part"])}|${String(p["instance"])}`;
                zaehler.set(schluessel, (zaehler.get(schluessel) ?? 0) + 1);
            }
            return [...zaehler].filter(([, anzahl]) => anzahl > 1).map(([schluessel]) => schluessel);
        });
        doppelt.push(...funde.map((f) => `z${String(zoom)}: ${f}`));
    }
    expect(doppelt).toEqual([]);
});

test("🔴 die Orts- und Landschaftsnamen bleiben unberührt", async ({ page }) => {
    // Keine Änderung an ihnen, um den Wegen Platz zu schaffen - das war die Leitplanke. Gemessen
    // wird, dass beide Gruppen weiterhin in normaler Zahl auf der Karte stehen.
    await openMap(page);
    await showPlace(page, GARETH, 5);
    const orte = await gezeichnet(page, await ortsnamenEbenen(page));
    const landschaften = await gezeichnet(page, await ebenenDerFamilie(page, ["map-label", "landscape-label-run"]));

    expect(orte.length, "Ortsnamen").toBeGreaterThan(20);
    expect(landschaften.length, "Landschaftsnamen").toBeGreaterThan(10);
});
