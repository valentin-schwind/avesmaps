import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";
import { onPage, openMap, settleFrame, showCamera, showLandscapes } from "./map-handle.ts";

/**
 * Abnahmeblatt WI-0093: **Der Name einer gewählten Fläche behält seine Form; nur die Farbe wechselt.**
 *
 * 💣 Dieser Lauf prüft NICHTS. Er legt EIN Blatt vor. Die Prüfungen stehen in `area-name.spec.ts`,
 * `test/area-selection.test.ts` und `test/area-selection-name.test.ts`.
 *
 *   npm run review:flaechenname
 *
 * Ablage: `review/wi-0093/blatt.png` (`review/` ist nicht versioniert).
 *
 * 🪤 **Die Spalte „bisher" ist NACHGESTELLT, nicht fotografiert.** Der alte Code ist weg; das Blatt baut seinen
 * sichtbaren Zustand in der laufenden Karte nach: Melder abschalten, den gewöhnlichen Namen der gewählten Region
 * aus beiden Namensebenen filtern, den Ersatznamen mit den alten Werten setzen (feste 22 px, Saum als Anteil
 * davon, Versalien aus der Art der REGION). Welche Werte dabei gesetzt werden, steht unter jedem Bild. Dasselbe
 * Verfahren wie beim Legacy-Vergleich der Schriftläufe (`landscape-name-review.spec.ts`).
 */

const OUTPUT = resolve(import.meta.dirname, "../../../review/wi-0093");
const CANON = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/design-canon/avesmaps.json"), "utf8"),
) as {
    colour: Record<string, string>;
    mapSelection: { labelSize: number };
    mapLabel: { families: { landscape: { haloWidthRatio: number; haloBlurRatio: number } } };
};
const CARTOGRAPHY = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../../config/map-cartography/aventuria.json"), "utf8"),
) as { types: Record<string, { labelUppercase?: boolean }> };

/** Der freie Streifen der Karte: rechts vom Routenplaner, links vom Infopanel. */
const STRIP = { left: 400, width: 470, height: 300 };

interface Fall {
    key: string;
    name: string;
    art: string;
    layer: string;
    /** Die Zoomstufe, auf der der gewöhnliche Name steht (am laufenden Stack gemessen). */
    zoom: number;
    /** Die Stufe, auf der er verschwindet - „zu nah dran". */
    tooClose?: number;
    /** Wie gewählt wird: mit dem Zeiger (wie im Nutzertest) oder über die Suche. */
    weg: "klick" | "suche";
    lead: string;
}

const FAELLE: Fall[] = [
    {
        key: "herz",
        name: "Herz des Kontinents",
        art: "region",
        layer: "derographisch",
        zoom: 4,
        tooClose: 5,
        weg: "klick",
        lead:
            "Die Fläche aus dem Befund. Punktbeschriftung, Band 1 bis 3. 💣 Ihre REGIONSART fehlt (Legacy-Bestand), " +
            "ihre BESCHRIFTUNGSART ist „region“ und trägt Versalien. Der alte Code fragte beim Klick die Regionsart.",
    },
    {
        key: "wall",
        name: "Raschtulswall",
        art: "gebirge",
        layer: "topographie",
        zoom: 4,
        weg: "suche",
        lead:
            "Ein Gebirgszug: Sein Name läuft auf der abgeleiteten Kurve, über die halbe Fläche. Hier war der Sprung " +
            "am größten - aus einer gebogenen Zeile wurde eine kurze gerade an anderer Stelle.",
    },
];

interface Messung {
    namen: { layer: string; text: string; size: string; type: string }[];
    ersatz: number;
}

interface Aufnahme extends Messung {
    bild: string;
}

// -----------------------------------------------------------------------------------------------------------------

async function flaeche(page: Page, fall: Fall): Promise<{ region: string; x: number; y: number }> {
    const hit = await page.evaluate(
        async ({ query, art }) => {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const body = (await response.json()) as {
                hits: { kind: string; name: string; subtype?: string; region?: string; x: number; y: number }[];
            };
            return body.hits.find(
                (entry) => entry.kind === "landschaft" && entry.name === query && entry.subtype === art,
            );
        },
        { query: fall.name, art: fall.art },
    );
    if (!hit?.region) throw new Error(`die Suche kennt „${fall.name}" nicht als Fläche`);
    return { region: hit.region, x: hit.x, y: hit.y };
}

/** Zwei gesetzte Bilder: Die Entscheidung fällt einen Frame nach `idle` (`area-selection-name.ts`). */
async function decided(page: Page): Promise<void> {
    await settleFrame(page);
    await settleFrame(page);
}

async function messung(page: Page, region: string): Promise<Messung> {
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const present = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("map-label-") || id.startsWith("landscape-label-run-"));
        const namen =
            present.length === 0
                ? []
                : map
                      .queryRenderedFeatures({ layers: present })
                      .filter((feature) => feature.properties["region_public_id"] === id)
                      .map((feature) => ({
                          layer: feature.layer.id,
                          text: String(feature.properties["name"] ?? ""),
                          size: String(feature.properties["label_size"] ?? "—"),
                          type: String(feature.properties["label_type"] ?? "—"),
                      }));
        const ersatz = map.getLayer("area-selection-label")
            ? map.queryRenderedFeatures({ layers: ["area-selection-label"] }).length
            : 0;
        return { namen, ersatz };
    }, region);
}

/**
 * Wo der Name dieser Region gerade im Bild steht - der gewöhnliche, sonst der versetzte der Auswahl.
 *
 * 🪤 Daran wird der Ausschnitt ausgerichtet, nicht an der Fenstermitte: Beim Wählen fährt das Infopanel herein
 * und die Karte hält ihre Mitte im freien Streifen. Ein fester Ausschnitt zeigte dann links und rechts zwei
 * verschiedene Gegenden, und das Blatt verglich zwei Stellen statt zwei Zustände.
 */
async function nameAt(page: Page, region: string): Promise<{ x: number; y: number } | undefined> {
    return page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const mitte = (feature: { geometry: { coordinates: unknown } }): { x: number; y: number } => {
            const raw = feature.geometry.coordinates as [number, number] | [number, number][];
            const point = Array.isArray(raw[0])
                ? (raw as [number, number][])[Math.floor(raw.length / 2)]!
                : (raw as [number, number]);
            const at = map.project({ lng: point[0], lat: point[1] });
            return { x: Math.round(at.x), y: Math.round(at.y) };
        };
        const namen = map
            .getStyle()
            .layers.map((layer) => layer.id)
            .filter((id) => id.startsWith("map-label-") || id.startsWith("landscape-label-run-"));
        const meine =
            namen.length === 0
                ? []
                : map
                      .queryRenderedFeatures({ layers: namen })
                      .filter((feature) => feature.properties["region_public_id"] === id);
        if (meine[0]) return mitte(meine[0]);
        const ersatz = map.getLayer("area-selection-label")
            ? map.queryRenderedFeatures({ layers: ["area-selection-label"] })
            : [];
        return ersatz[0] ? mitte(ersatz[0]) : undefined;
    }, region);
}

/** Der feste Ausschnitt: der freie Streifen zwischen Planer und Infopanel. */
function fenster(page: Page): { x: number; y: number; width: number; height: number } {
    const size = page.viewportSize();
    const breite = size?.width ?? 1280;
    const hoehe = size?.height ?? 900;
    if (breite < 700) {
        // 🪤 Am Telefon OBEN: Das Infopanel ist dort kein Streifen neben der Karte, sondern deckt sie - und seine
        // Lasche gibt es nur am Rechner (`info-panel.vue`, `v-if="!phone"`). Der obere Rand bleibt Karte.
        return { x: 0, y: 70, width: breite, height: 240 };
    }
    return {
        x: STRIP.left,
        y: Math.max(120, Math.round((hoehe - STRIP.height) / 2)),
        width: Math.min(STRIP.width, breite - STRIP.left - 410),
        height: STRIP.height,
    };
}

/**
 * Rückt die Karte so, dass der Name der Region in der Mitte des Ausschnitts steht.
 *
 * 💣 Ohne das verglich das Blatt zwei STELLEN statt zweier Zustände: Beim Wählen fährt das Infopanel herein,
 * die Karte hält ihre Mitte im freien Streifen, und derselbe Name lag links und rechts hundert Bildpunkte
 * auseinander - auf der ersten Fassung stand er ungewählt halb außerhalb. Geschoben wird die KAMERA, nicht der
 * Ausschnitt: So zeigen beide Bilder dieselbe Gegend in derselben Größe.
 */
async function ruecke(page: Page, region: string): Promise<void> {
    const named = await nameAt(page, region);
    if (!named) return;
    // Der Ausschnitt ist in Seitenkoordinaten, der Name in Kartenkoordinaten (im Editor-Modus steht über der Karte die Kopfleiste).
    const at = await onPage(page, named);
    const box = fenster(page);
    const ziel = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.evaluate(
        ({ von, nach }) => {
            const map = globalThis.avesmapsMap as unknown as {
                panBy(offset: [number, number], options?: unknown): void;
            };
            map.panBy([von.x - nach.x, von.y - nach.y], { duration: 0 });
        },
        { von: at, nach: ziel },
    );
    await settleFrame(page);
}

async function closeUp(page: Page, file: string): Promise<string> {
    const path = resolve(OUTPUT, "bilder", file);
    mkdirSync(resolve(OUTPUT, "bilder"), { recursive: true });
    await page.screenshot({ path, clip: fenster(page) });
    return path;
}

async function aufnahme(page: Page, region: string, file: string): Promise<Aufnahme> {
    await ruecke(page, region);
    return { ...(await messung(page, region)), bild: await closeUp(page, file) };
}

/** Wählt über die Suche: der Weg, der bei ineinanderliegenden Gebirgen den ganzen Zug meint. */
async function waehleUeberSuche(page: Page, name: string, region: string): Promise<void> {
    await page.getByTestId("search-open").click();
    await page.getByTestId("search-input").fill(name);
    await page
        .locator('[data-testid="search-hit"][data-kind="landschaft"]')
        .filter({ has: page.locator(".spotlight__name", { hasText: new RegExp(`^${name}$`) }) })
        .first()
        .click();
    await page.waitForFunction((id) => globalThis.avesmapsAreaSelection?.()?.id === id, region, { timeout: 20_000 });
}

/** Wählt mit dem Zeiger - der Weg aus dem Nutzertest. */
async function waehleMitKlick(page: Page, region: string): Promise<void> {
    const box = await page.getByTestId("map").boundingBox();
    const spot = await page.evaluate((id) => {
        const map = globalThis.avesmapsMap!;
        const fills = (map.getStyle().layers ?? [])
            .map((layer) => layer.id)
            .filter((layer) => layer.startsWith("landscape-fill-"));
        const marker = ["place-marker", "place-marker-structure"].filter((entry) => map.getLayer(entry));
        const canvas = map.getCanvas();
        for (let y = 200; y < canvas.clientHeight - 200; y += 7) {
            for (let x = 430; x < canvas.clientWidth - 440; x += 7) {
                const at: [number, number] = [x, y];
                const hit = map
                    .queryRenderedFeatures(at, { layers: fills })
                    .some((feature) => feature.properties["region_public_id"] === id);
                if (!hit) continue;
                if (marker.length > 0 && map.queryRenderedFeatures(at, { layers: marker }).length > 0) continue;
                return { x, y };
            }
        }
        return undefined;
    }, region);
    if (!spot) throw new Error("keine freie Stelle der Fläche im Bild");
    await page.mouse.click((box?.x ?? 0) + spot.x, (box?.y ?? 0) + spot.y);
    await page.waitForFunction((id) => globalThis.avesmapsAreaSelection?.()?.id === id, region, { timeout: 20_000 });
}

async function waehle(page: Page, fall: Fall, region: string): Promise<void> {
    if (fall.weg === "klick") await waehleMitKlick(page, region);
    else await waehleUeberSuche(page, fall.name, region);
}

/**
 * Stellt den Zustand VOR WI-0093 in der laufenden Karte nach und gibt zurück, welche Werte dabei gesetzt wurden.
 *
 * 🪤 Kein Code von früher, sondern dessen sichtbares Ergebnis: Der Melder wird abgeschaltet, der gewöhnliche Name
 * der gewählten Region aus beiden Namensebenen gefiltert, und der Ersatzname bekommt die alten Werte.
 */
async function stelleAltenStandNach(
    page: Page,
    region: string,
): Promise<{ size: number; transform: string; halo: number }> {
    const auswahl = await page.evaluate(() => globalThis.avesmapsAreaSelection?.());
    const art = auswahl?.type ?? "";
    const transform = CARTOGRAPHY.types[art]?.labelUppercase === true ? "uppercase" : "none";
    const size = CANON.mapSelection.labelSize;
    const halo = size * CANON.mapLabel.families.landscape.haloWidthRatio;
    const werte = { size, transform, halo, blur: size * CANON.mapLabel.families.landscape.haloBlurRatio };
    await page.evaluate(
        ({ id, look }) => {
            const map = globalThis.avesmapsMap as unknown as {
                getLayer(layer: string): unknown;
                getFilter(layer: string): unknown;
                getStyle(): { layers: { id: string }[] };
                setFilter(layer: string, filter: unknown): void;
                setLayoutProperty(layer: string, name: string, value: unknown): void;
                setPaintProperty(layer: string, name: string, value: unknown): void;
                getSource(source: string): { setData(data: unknown): void } | undefined;
                triggerRepaint(): void;
            };
            // Der Melder von heute darf nicht dazwischenfunken.
            (
                globalThis as unknown as { avesmapsAreaSelectionName?: { remove(): void } }
            ).avesmapsAreaSelectionName?.remove();
            // So war es: der gewöhnliche Name der gewählten Region wich dem Namen der Auswahl.
            for (const layer of map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => id.startsWith("map-label-") || id.startsWith("landscape-label-run-"))) {
                const filter = map.getFilter(layer);
                map.setFilter(layer, [
                    "all",
                    filter ?? ["literal", true],
                    ["!", ["in", ["get", "region_public_id"], ["literal", [id]]]],
                ]);
            }
            // Und so sah der Name der Auswahl aus: feste Größe, Saum als Anteil davon, Versalien aus der Regionsart.
            map.setLayoutProperty("area-selection-label", "text-size", look.size);
            map.setLayoutProperty("area-selection-label", "text-transform", look.transform);
            map.setPaintProperty("area-selection-label", "text-halo-width", look.halo);
            map.setPaintProperty("area-selection-label", "text-halo-blur", look.blur);
            const auswahl = globalThis.avesmapsAreaSelection?.();
            const projektion = globalThis.avesmapsRenderProjection!;
            if (auswahl) {
                const at = projektion.toRenderLngLat(auswahl.anchor);
                map.getSource("area-selection-label")?.setData({
                    type: "FeatureCollection",
                    features: [
                        {
                            type: "Feature",
                            properties: { name: auswahl.label, label_size: look.size, label_type: "" },
                            geometry: { type: "Point", coordinates: [at.lng, at.lat] },
                        },
                    ],
                });
            }
            map.triggerRepaint();
        },
        { id: region, look: werte },
    );
    await settleFrame(page);
    return { size, transform, halo };
}

// -----------------------------------------------------------------------------------------------------------------

test("Abnahmeblatt WI-0093: der Name einer gewählten Fläche", async ({ page }, testInfo) => {
    test.setTimeout(900_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });

    interface Zeile {
        fall: Fall;
        ungewaehlt: Aufnahme;
        jetzt: Aufnahme;
        bisher: Aufnahme;
        bisherWerte: { size: number; transform: string; halo: number };
        nah?: Aufnahme;
    }
    const zeilen: Zeile[] = [];

    for (const fall of FAELLE) {
        await openMap(page);
        const ziel = await flaeche(page, fall);
        await showLandscapes(page, fall.layer);
        await showCamera(page, { point: { x: ziel.x, y: ziel.y }, zoom: fall.zoom });
        await decided(page);
        const ungewaehlt = await aufnahme(page, ziel.region, `${fall.key}-ungewaehlt.png`);

        await waehle(page, fall, ziel.region);
        await showCamera(page, { point: { x: ziel.x, y: ziel.y }, zoom: fall.zoom });
        await decided(page);
        const jetzt = await aufnahme(page, ziel.region, `${fall.key}-jetzt.png`);

        let nah: Aufnahme | undefined;
        if (fall.tooClose !== undefined) {
            await showCamera(page, { point: { x: ziel.x, y: ziel.y }, zoom: fall.tooClose });
            await decided(page);
            nah = await aufnahme(page, ziel.region, `${fall.key}-nah.png`);
            await showCamera(page, { point: { x: ziel.x, y: ziel.y }, zoom: fall.zoom });
            await decided(page);
        }

        const bisherWerte = await stelleAltenStandNach(page, ziel.region);
        const bisher = await aufnahme(page, ziel.region, `${fall.key}-bisher.png`);

        zeilen.push({ fall, ungewaehlt, jetzt, bisher, bisherWerte, ...(nah ? { nah } : {}) });
        testInfo.annotations.push({ type: "Blatt", description: `${fall.name} aufgenommen` });
    }

    // Hell und dunkel: 🔴 Die KARTE bleibt hell (Designkanon, WI-0032); dunkel wird, was über ihr liegt.
    const themen: { scheme: string; bild: string }[] = [];
    for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await openMap(page);
        const ziel = await flaeche(page, FAELLE[0]!);
        await showLandscapes(page, FAELLE[0]!.layer);
        await showCamera(page, { point: { x: ziel.x, y: ziel.y }, zoom: FAELLE[0]!.zoom });
        await decided(page);
        await waehle(page, FAELLE[0]!, ziel.region);
        await showCamera(page, { point: { x: ziel.x, y: ziel.y }, zoom: FAELLE[0]!.zoom });
        await decided(page);
        await ruecke(page, ziel.region);
        themen.push({ scheme, bild: await closeUp(page, `thema-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });

    // 360 px: der schmale Fall.
    //
    // 🪤 Erst am Rechner wählen, dann verkleinern. Die Suche sieht am Telefon anders aus (eigene Touch-Specs),
    // und das Blatt will hier nicht den Weg hinein zeigen, sondern den NAMEN in der schmalen Breite.
    // 💣 Von Anfang an schmal laden. Wer am Rechner lädt und dann verkleinert, behält den offenen Routenplaner -
    // und der deckt am Telefon die halbe Karte (`app.vue`: der Planer fährt nur am Rechner selbst herein).
    await page.setViewportSize({ width: 360, height: 780 });
    await openMap(page);
    const schmalZiel = await flaeche(page, FAELLE[0]!);
    // 🪤 Den Planer zuklappen. 360 px ist hier ein schmales RECHNERfenster, kein Telefon - der Zeiger bleibt fein
    // (`phone-viewport.ts`: grober Zeiger UND kurze Seite). Der Planer fährt deshalb herein und deckt die Karte.
    await page.getByTestId("route-planner-tab").click();
    await page.waitForTimeout(400);
    // 🪤 Ohne den Kartenfächer: Die Landschaftsnamen stehen in JEDER Ansicht - nur die Flächen hängen an der
    // Ebene (WI-0009), und der Fächer ist in der schmalen Breite ein eigenes Bedienteil.
    await showCamera(page, { point: { x: schmalZiel.x, y: schmalZiel.y }, zoom: FAELLE[0]!.zoom });
    await decided(page);
    const schmalOhne = await aufnahme(page, schmalZiel.region, "schmal-360-ungewaehlt.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // Echte Größe: das ganze Fenster mit dem gewählten Raschtulswall.
    await openMap(page);
    const vollZiel = await flaeche(page, FAELLE[1]!);
    await showLandscapes(page, FAELLE[1]!.layer);
    await waehleUeberSuche(page, FAELLE[1]!.name, vollZiel.region);
    await showCamera(page, { point: { x: vollZiel.x, y: vollZiel.y }, zoom: FAELLE[1]!.zoom });
    await decided(page);
    mkdirSync(resolve(OUTPUT, "bilder"), { recursive: true });
    const voll = resolve(OUTPUT, "bilder", "echte-groesse.png");
    await page.screenshot({ path: voll });

    writeFileSync(
        resolve(OUTPUT, "messwerte.json"),
        JSON.stringify(
            { zeilen: zeilen.map(({ fall, ...rest }) => ({ fall: fall.key, ...rest })), schmalOhne },
            null,
            2,
        ),
        "utf8",
    );

    // ---------------------------------------------------------------------------------------------------------
    // Das Blatt
    // ---------------------------------------------------------------------------------------------------------

    const colour = CANON.colour;
    const escape = (value: string): string =>
        value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
    const bild = (file: string | undefined, width: number): string =>
        file === undefined || !existsSync(file)
            ? `<p class="fehlt">— nicht aufgenommen</p>`
            : `<img width="${String(width)}" src="data:image/png;base64,${readFileSync(file).toString("base64")}" alt="">`;
    const mess = (auf: Aufnahme | undefined): string => {
        if (!auf) return `<p class="mess">—</p>`;
        const namen =
            auf.namen.length === 0
                ? `<span class="nein">kein gewöhnlicher Name im Bild</span>`
                : auf.namen
                      .map(
                          (entry) =>
                              `<b>${escape(entry.text)}</b> · ${
                                  entry.layer.startsWith("landscape-label-run-") ? "auf der Kurve" : "Punktlabel"
                              } · ${escape(entry.size)} px · Beschriftungsart ${escape(entry.type)}`,
                      )
                      .join("<br>");
        const ersatz =
            auf.ersatz === 0
                ? `<span class="nein">kein versetzter Name</span>`
                : `<span class="ja">versetzter Name: ${String(auf.ersatz)}</span>`;
        return `<p class="mess">${namen}<br>${ersatz}</p>`;
    };

    const spalte = (titel: string, auf: Aufnahme | undefined, zusatz = ""): string =>
        `<td><p class="stand">${titel}</p>${bild(auf?.bild, 470)}${mess(auf)}${zusatz}</td>`;

    const fallBlock = (zeile: Zeile): string => `
<h2>${escape(zeile.fall.name)}</h2>
<p class="lead">${zeile.fall.lead} Gewählt wurde ${zeile.fall.weg === "klick" ? "<b>mit dem Zeiger</b>" : "<b>über die Suche</b>"}.</p>
<table class="grid"><tr>
${spalte("ungewählt", zeile.ungewaehlt)}
${spalte("gewählt — jetzt", zeile.jetzt)}
${spalte(
    "gewählt — bisher (nachgestellt)",
    zeile.bisher,
    `<p class="mess nachgestellt">nachgestellt mit: feste <b>${String(zeile.bisherWerte.size)} px</b>, Saum ${
        Math.round(zeile.bisherWerte.halo * 100) / 100
    } px, Versalien <b>${escape(zeile.bisherWerte.transform)}</b> aus der Regionsart; der gewöhnliche Name
    herausgefiltert.</p>`,
)}
</tr></table>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
@font-face { font-family: "Faculty Glyphic"; src: url("${String(testInfo.project.use.baseURL)}/fonts/FacultyGlyphic-Regular.woff2") format("woff2"); }
body { margin: 0; padding: 26px 30px 36px; width: 1620px; background: ${colour["pageBg"]}; color: ${colour["text"]};
    font: 14px/1.45 "Faculty Glyphic", Arial, sans-serif; }
h1 { margin: 0 0 4px; font-size: 23px; font-weight: 400; color: ${colour["textStrong"]}; }
h2 { margin: 26px 0 10px; font-size: 18px; font-weight: 400; color: ${colour["textStrong"]};
    border-top: 1px solid ${colour["border"]}; padding-top: 14px; }
.lead { margin: 0 0 10px; color: ${colour["textMuted"]}; font-size: 13px; max-width: 1200px; }
.satz { margin: 10px 0 0; padding: 10px 14px; border-left: 3px solid ${colour["accentStrong"]};
    background: ${colour["surface"]}; font-size: 15px; color: ${colour["textStrong"]}; max-width: 1200px; }
table.grid { border-collapse: collapse; width: 100%; }
table.grid td { vertical-align: top; padding: 6px 10px; width: 33%; }
img { display: block; border: 1px solid ${colour["border"]}; border-radius: 6px; }
.mess { font-size: 12px; margin: 5px 0 10px; color: ${colour["textMuted"]}; }
.nachgestellt { font-style: italic; }
.stand { font-size: 12px; margin: 0 0 5px; color: ${colour["textStrong"]}; letter-spacing: .07em; text-transform: uppercase; }
.ja { color: ${colour["accentStrong"]}; }
.nein { color: ${colour["textMuted"]}; }
.fehlt { color: ${colour["textMuted"]}; font-size: 12px; margin: 0; }
.offen { margin: 18px 0 0; padding: 12px 16px; background: ${colour["surface"]};
    border: 1px solid ${colour["border"]}; border-radius: 6px; max-width: 1200px; font-size: 13px; }
.offen b { color: ${colour["textStrong"]}; }
.offen ul { margin: 8px 0 0; padding-left: 20px; }
.offen li { margin: 0 0 8px; }
</style></head><body>

<h1>Der Name einer gewählten Fläche</h1>
<p class="lead">WI-0093 · dieselbe Fläche ungewählt und gewählt nebeneinander, dazu der alte Zustand. Alles im
laufenden Browser gemessen; die Zeilen unter jedem Bild kommen aus der Karte, nicht aus dem Text.
🪤 <b>Die dritte Spalte ist nachgestellt, nicht fotografiert</b> — der alte Code ist weg, also baut das Blatt
seinen sichtbaren Zustand nach und schreibt darunter, mit welchen Werten.</p>
<p class="satz"><b>Gewählt ist derselbe Name in Gold.</b> Schreibung, Schrift, Größe, Sperrung, Saum und der Lauf
auf der Kurve bleiben, weil es nur noch <b>ein</b> Symbol gibt: Der gewöhnliche Name wird umgefärbt, statt durch
einen zweiten ersetzt zu werden. Ein <b>versetzter</b> Name tritt nur noch an, wo der gewöhnliche gerade nicht
gezeichnet ist.</p>

${zeilen.map(fallBlock).join("\n")}

<h2>Zu nah dran — hier ist die Verschiebung nützlich</h2>
<p class="lead">Eine Stufe weiter hinein zeichnet die Karte den gewöhnlichen Namen nicht mehr (sein Band endet bei
3, MapLibre also bei z4). Erst dann tritt der versetzte an seine Stelle — in der Form, die der Name eben noch
hatte: <b>24 px</b> und Versalien aus der Beschriftungsart, nicht in der alten festen Größe.</p>
<table class="grid"><tr>${spalte("gewählt, eine Stufe näher", zeilen[0]?.nah)}<td></td><td></td></tr></table>

<h2>Hell und dunkel</h2>
<p class="lead">🔴 Die <b>Karte bleibt hell</b> (Designkanon, WI-0032): Dunkel bekommt nur, was über ihr liegt.</p>
<table class="grid"><tr>${themen
        .map(
            (entry) =>
                `<td><p class="stand">${entry.scheme === "light" ? "hell" : "dunkel"}</p>${bild(entry.bild, 470)}</td>`,
        )
        .join("")}<td></td></tr></table>

<h2>In 360 px Breite</h2>
<p class="lead">Derselbe Name im schmalen Fenster: Er trägt seine eigene Größe aus der Kachel, nicht eine feste.
Der Routenplaner ist für das Bild zugeklappt. 🪤 <b>Gewählt ist hier nichts zu sehen:</b> Sobald etwas gewählt
ist, fährt das Infopanel über die ganze Breite und deckt die Karte. Das war vor dieser Änderung genauso und
gehört zu WI-0063, nicht hierher. 🪤 Und: 360 px ist ein schmales <b>Rechner</b>fenster, kein Telefon - ein
Telefon braucht auch einen groben Zeiger (<code>phone-viewport.ts</code>).</p>
<table class="grid"><tr>
<td><p class="stand">ungewählt</p>${bild(schmalOhne.bild, 360)}${mess(schmalOhne)}</td>
<td></td><td></td></tr></table>

<h2>In echter Größe (1280 × 900), Raschtulswall gewählt</h2>
<p class="lead">Der Name läuft auf seiner Kurve über den ganzen Zug — golden, aber an derselben Stelle und in
derselben Form wie ungewählt.</p>
<table class="grid"><tr><td colspan="3">${bild(voll, 1100)}</td></tr></table>

<h2>Was bewusst so bleibt — bitte widersprechen, wenn es nicht gewollt ist</h2>
<div class="offen">
<ul>
<li><b>Ein gewähltes Herrschaftsgebiet behielt damals seinen eigenen Namen</b> in fester Größe, mit dem Obergebiet in
einer zweiten Zeile (WI-0062, F7). Das ist seit dem Nachtrag zu WI-0121 erledigt (Betreiber 2026-10-09): Auch dort wird
nur umgefärbt, die zweite Zeile ist weg, das Infopanel nennt das Obergebiet.</li>
<li><b>Der versetzte Name steht da, wo der gewöhnliche stünde</b> — an dessen Anker, nicht an der Klickstelle.
Zoomt man so weit hinein, dass dieser Anker aus dem Bild fällt, ist auch der versetzte Name draußen. Das war
schon vorher so; ob er dann <i>mitwandern</i> soll, wie die Zonennamen der Klimaansicht es tun, ist eine eigene
Frage.</li>
<li><b>Hat die Karte eine Beschriftung in dieser Sitzung noch nie gezeigt</b> und liegt ihre Kachel nicht im
Bild, tritt der versetzte Name in der Rückfallgröße des Kanons auf und nimmt die Versalien aus der Regionsart.
Das betrifft nur Flächen, die man ausschließlich aus großer Entfernung über die Suche wählt.</li>
</ul>
</div>
</body></html>`;

    mkdirSync(OUTPUT, { recursive: true });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(OUTPUT, "blatt.png"), fullPage: true });
    testInfo.annotations.push({ type: "Blatt", description: resolve(OUTPUT, "blatt.png") });
});
