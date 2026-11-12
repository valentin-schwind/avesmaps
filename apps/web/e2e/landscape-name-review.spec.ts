import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openMap, type MapHandle } from "./map-handle.ts";

/**
 * Operator-Review der sieben bekannten Schriftlauf-Faelle (WI-0004, ADR-0007, I5).
 *
 * 💣 Dieser Lauf prueft NICHTS und repariert NICHTS. Er bereitet eine Beurteilung vor, die nur ein
 * Mensch treffen kann: ob die Lage eines Namens kartografisch in Ordnung ist. Die Aussenlage-Metrik
 * sagt "mehrheitlich daneben"; die Sichtpruefung an den sechs Legacy-Referenzflaechen war
 * einwandfrei. Welche der beiden Aussagen fuer diese sieben zaehlt, entscheidet der Betreiber
 * (Entscheidung 2026-09-21: kein Eingriff in den Algorithmus bis dahin).
 *
 * Erzeugt je Fall ein Bild unter `review/schriftlaeufe/` und eine `README.md` mit den Messwerten.
 *
 * 🔴 Seit 2026-10-06 laeuft er nicht mehr im Standardlauf (`playwright.config.ts`, `SHEET_SPECS`),
 * sondern nur noch, wenn seine Datei genannt wird. Das einzige `expect` am Ende ist keine
 * Produktzusicherung, sondern ein Waechter ueber das BLATT: Steht im Bild ueberhaupt kein
 * Landschaftsname, ist das Bild wertlos. Was dieser Lauf an der Anwendung beruehrt, sichern
 * `landscape-names.spec.ts` (I1, I5, I7 an den Referenzflaechen) und `npm run verify:runs`
 * (dieselben Invarianten gegen den ganzen Bestand).
 *
 * ⭐ Der Legacy-Vergleich kommt OHNE Netzzugriff zustande: der Snapshot `map-features.json` traegt
 * Legacys eigene Kurve als `curve_label_line` (32 Punkte je Label) mit. Fehlt der Snapshot, laeuft
 * das Review weiter und sagt im Bericht, dass die Vergleichslinie fehlt - ein stilles Weglassen
 * waere schlimmer als ein fehlendes Bild.
 *
 *   npm run review:runs
 */

/**
 * 🔴 Seit 2026-10-06 der AKTUELLE Snapshot (`aktuell/`), vorher der Stand vom 2026-09-20 eine
 * Ebene darueber. Grund ist derselbe wie beim Kennungswechsel der Farlornschwelle unten: Legacy
 * hat sich bewegt, und ein Blatt, das die Kurve eines Standes zeigt, den Legacy verlassen hat,
 * vergleicht gegen die falsche Linie. Die aktive Farlornschwelle `0b8f5be9…` stand im alten
 * Export noch gar nicht, ihre Vergleichslinie fehlte deshalb im Blatt.
 *
 * 🪤 Ein Blatt ohne Vergleichslinie ist nicht rot, es sagt es nur im Bericht. Genau deshalb faellt
 * ein veralteter Pfad hier nicht auf - er muss gelesen werden.
 */
const SNAPSHOT = process.env["LEGACY_SNAPSHOT"] ?? "C:/avesmaps3d-data/legacy-snapshots/aktuell/map-features.json";
const OUTPUT = resolve(import.meta.dirname, "../../../review/schriftlaeufe");

/**
 * Die sieben Faelle, wie sie der Verifier fuehrt (`verify-runs.ts`, KNOWN_OUTLIERS).
 *
 * `bounds` und `innen` sind am 2026-09-21 aus der Entwicklungsdatenbank gemessen; `innen` ist der
 * Anteil der Lauflaenge ueber der eigenen Flaeche, also genau die Zahl, die I5 rot faerbt.
 * `padding` ist der einzige Wert, der hier nach Augenmass steht: er bestimmt, wieviel Umgebung im
 * Bild liegt, damit man die Flaeche im Kontext sieht statt formatfuellend.
 */
const CASES = [
    {
        name: "Dragwallthal",
        id: "d853cd47-f1e4-4349-9ad9-1125f4a3979d",
        bounds: [535.96, 651.64, 541.91, 654.22],
        inside: 0.33,
        runs: 1,
    },
    // 🔴 Seit 2026-10-06 steht hier die AKTIVE Farlornschwelle. Bis dahin war `c732cc7c…`
    // eingetragen; diese Region stand im Legacy-Snapshot vom 2026-09-24, fehlt im aktuellen
    // Export vollstaendig und ist bei uns folgerichtig stillgelegt (keine Flaeche, kein Label,
    // kein Lauf). Das Review rahmte damit ein Gebiet, das es nicht mehr gibt, und zeigte ein
    // leeres Bild. Es ist kein Dublettenbefund, sondern Legacys „Umbau der Gebirge“: der Name
    // wurde neu angelegt, die alte Region stillgelegt (MCS-028).
    //
    // Belegt am 2026-10-06: `0b8f5be9…` ist aktiv, in Legacys aktuellem Export `curve_label = true`
    // mit `curve_label_max = 1` und eigener `curve_label_line` (32 Punkte); bei uns sechs Laeufe,
    // je einer von z3 bis z8. `bounds`, `inside` und `runs` sind an DIESER Region neu gemessen.
    //
    // 🪤 `inside` ist damit 0,965 und nicht mehr unter der I5-Schwelle — die Region bleibt in
    // `KNOWN_OUTLIERS` gelistet, ist aktuell aber nicht getroffen. Gelistet und getroffen sind
    // zwei Zahlen (`verify-runs.ts`); das Blatt zeigt den gemessenen Wert, nicht den erwarteten.
    {
        name: "Farlornschwelle",
        id: "0b8f5be9-9a9d-43ac-a5b2-7b4be4878299",
        bounds: [627.31, 841.0, 696.78, 874.09],
        inside: 0.965,
        runs: 6,
    },
    {
        name: "Horobans Wälder",
        id: "f2d33c46-fea4-4aa4-a633-5f3680121024",
        bounds: [332.63, 112.63, 421.29, 213.69],
        inside: 0.37,
        runs: 1,
    },
    {
        name: "Rathilswall",
        id: "c2ae1d30-bfe5-4dd5-bc1d-7f9878a00cdc",
        bounds: [624.64, 677.48, 634.0, 689.28],
        inside: 0.46,
        runs: 2,
    },
    {
        name: "Tommellande",
        id: "8356abaf-8ec2-4c06-b11a-9a2f67fe3079",
        bounds: [342.19, 528.88, 454.94, 580.76],
        inside: 0.48,
        runs: 6,
    },
    {
        name: "Dschungel von Atoum",
        id: "f48b5ca5-a0a5-4865-9530-b0fa01614501",
        bounds: [489.25, 71.89, 583.93, 114.95],
        inside: 0.5,
        runs: 1,
    },
    // 🔴 Seit 2026-10-06 steht hier der AKTIVE Amboss. Bis dahin war `bc471846…` eingetragen; diese
    // Region fehlt im aktuellen Legacy-Export vollstaendig und ist bei uns stillgelegt (Flaeche
    // vorhanden, aber inaktiv, kein Label, kein Lauf). Derselbe Vorgang wie bei der Farlornschwelle
    // darueber: Legacys „Umbau der Gebirge“ legt den Namen neu an und legt die alte Region still
    // (MCS-028).
    //
    // 🪤 Hier gibt es ZWEI aktive Nachfolger, `5e0a6f49…` (3 Laeufe) und `ebb606e1…` (6 Laeufe) —
    // die Kennung ist deshalb GEMESSEN und nicht gewaehlt. Alle drei Masse zeigen auf `5e0a6f49…`:
    // sie liegt mit 99,6 Prozent ihrer Flaeche INNERHALB der stillgelegten und deckt 64,3 Prozent
    // von ihr (IoU 0,641 gegen 0,362), ihr Mittelpunkt steht 1,24 Einheiten vom alten entfernt
    // (gegen 3,98), ihre Hausdorff-Distanz ist 5,11 (gegen 17,16). Und Legacys eigene 32-Punkte-
    // Kurve teilt mit der alten Kurve aus dem Snapshot 2026-09-24 die obere rechte Ecke auf zwei
    // Stellen (xmax 506,73 gegen 506,77, ymax 483,17 gegen 483,11; Mittenabstand 1,66 gegen 5,06).
    // `ebb606e1…` ist mit 678,93 Flaecheneinheiten die 2,6-fach groessere Nachbarin, die die alte
    // Flaeche umschliesst, nicht ersetzt.
    //
    // `bounds`, `inside` und `runs` sind an DIESER Region neu gemessen (2026-10-06), nicht von der
    // stillgelegten uebernommen: drei Laeufe, je einer auf z6, z7 und z8, alle drei vollstaendig
    // ueber der eigenen Flaeche.
    //
    // 🪤 `inside` ist damit 1,0. Wie bei der Farlornschwelle bleibt „Amboss“ in `KNOWN_OUTLIERS`
    // gelistet, ist aktuell aber nicht getroffen — gelistet und getroffen sind zwei Zahlen.
    {
        name: "Amboss",
        id: "5e0a6f49-9676-4f1e-ac3d-135b3b307e71",
        bounds: [481.67, 463.76, 506.81, 487.16],
        inside: 1.0,
        runs: 3,
    },
] as const;

interface LegacyFeature {
    properties?: {
        name?: string;
        ecosystem_region_public_id?: string;
        curve_label_line?: [number, number][];
    };
}

/**
 * Legacys eigene Kurven aus dem Snapshot, nach der `public_id` der REGION.
 *
 * 🪤 Nicht nach dem Namen. Label und Region tragen denselben Namen nur meistens, und eine Zuordnung
 * ueber den Namen faellt genau dort aus, wo sie gebraucht wird. Die Werte liegen ausserdem unter
 * `properties`, nicht am Feature selbst - beides hat beim ersten Versuch alle sieben
 * Vergleichslinien verschluckt, ohne dass irgendetwas rot wurde.
 */
function legacyCurves(): Map<string, [number, number][]> {
    const curves = new Map<string, [number, number][]>();
    try {
        const payload = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { features?: LegacyFeature[] };
        for (const feature of payload.features ?? []) {
            const properties = feature.properties;
            const line = properties?.curve_label_line;
            if (properties?.ecosystem_region_public_id && line && line.length > 1) {
                curves.set(properties.ecosystem_region_public_id, line);
            }
        }
    } catch {
        // Der Snapshot liegt ausserhalb des Repositories; ohne ihn entfaellt nur die Vergleichslinie.
    }
    return curves;
}

interface CaseReport {
    name: string;
    zoom: number;
    drawnRuns: number;
    /** Welche Landschaftsnamen sonst im Bild stehen - die Erklaerung, wenn der eigene fehlt. */
    neighbours: string[];
    legacyPoints: number;
    file: string;
}

/**
 * Faerbt die Flaeche des Falls hervor und legt Legacys Kurve darueber.
 *
 * 🪤 Die Hervorhebung muss UNTER den Namen liegen, sonst deckt sie zu, was beurteilt werden soll.
 * Sie wird deshalb vor `landscape-label-run` eingefuegt, nicht oben angehaengt.
 */
async function prepare(page: Page, legacy: [number, number][] | undefined): Promise<void> {
    await page.evaluate((line) => {
        const map = globalThis.avesmapsMap as unknown as MapHandle & {
            addLayer(layer: unknown, before?: string): void;
            addSource(id: string, source: unknown): void;
            getLayer(id: string): unknown;
            getSource(id: string): unknown;
            setFilter(id: string, filter: unknown): void;
        };
        const projection = globalThis.avesmapsRenderProjection;
        if (!projection) {
            throw new Error("projection handle missing");
        }
        // Seit WI-0135 je Landschaftsebene eine Ebene der Kurvennamen; eingefügt wird unter der untersten.
        const ersteKurve = map.getStyle().layers.find((layer) => layer.id.startsWith("landscape-label-run-"))?.id;

        if (!map.getLayer("review-area")) {
            map.addLayer(
                {
                    id: "review-area",
                    type: "line",
                    source: "landscapes",
                    "source-layer": "region_area_render",
                    filter: ["==", ["get", "region_public_id"], "-"],
                    paint: { "line-color": "#d0021b", "line-width": 2, "line-opacity": 0.9 },
                },
                ersteKurve,
            );
        }
        if (!map.getSource("review-legacy")) {
            map.addSource("review-legacy", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            map.addLayer(
                {
                    id: "review-legacy",
                    type: "line",
                    source: "review-legacy",
                    paint: {
                        "line-color": "#0b62a4",
                        "line-width": 2,
                        "line-dasharray": [2, 2],
                        "line-opacity": 0.9,
                    },
                },
                ersteKurve,
            );
        }

        const source = map.getSource("review-legacy") as { setData(data: unknown): void };
        source.setData({
            type: "FeatureCollection",
            features: line
                ? [
                      {
                          type: "Feature",
                          properties: {},
                          geometry: {
                              type: "LineString",
                              coordinates: line.map(([x, y]) => {
                                  const lngLat = projection.toRenderLngLat({ x, y });
                                  return [lngLat.lng, lngLat.lat];
                              }),
                          },
                      },
                  ]
                : [],
        });
    }, legacy ?? null);
}

const reports: CaseReport[] = [];
const curves = legacyCurves();

for (const entry of CASES) {
    test(`Review: ${entry.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 950 });
        await openMap(page);
        // Der Routenplaner verdeckt den linken Rand der Karte. Fuer ein Bild, das beurteilt werden
        // soll, ist das genau die Ecke zuviel - er wird nur fuer die Aufnahme ausgeblendet.
        await page.addStyleTag({ content: ".route-planner { display: none !important; }" });

        const legacy = curves.get(entry.id);
        await prepare(page, legacy);

        const zoom = await page.evaluate(
            async ({ bounds, publicId, region }) => {
                const map = globalThis.avesmapsMap as unknown as MapHandle & {
                    fitBounds(bounds: [[number, number], [number, number]], options: unknown): void;
                    setFilter(id: string, filter: unknown): void;
                    getZoom(): number;
                    querySourceFeatures(source: string, options: { sourceLayer: string; filter: unknown }): unknown[];
                };
                const projection = globalThis.avesmapsRenderProjection;
                if (!projection) {
                    throw new Error("projection handle missing");
                }
                map.setFilter("review-area", ["==", ["get", "region_public_id"], publicId]);
                const idle = async (): Promise<void> => {
                    await new Promise<void>((resolve_) => {
                        map.once("idle", resolve_);
                        setTimeout(resolve_, 4000);
                    });
                    // Ein Frame über `idle` hinaus (settleFrame in map-handle.ts): sonst zeigt das Bild
                    // womöglich noch die Namen einer Kachel, die MapLibre zum Ausblenden festhält.
                    await new Promise<void>((resolve_) => {
                        map.once("idle", resolve_);
                        map.triggerRepaint();
                        setTimeout(resolve_, 4000);
                    });
                };

                const maxZoom = 7;
                const lower = projection.toRenderLngLat({ x: bounds[0], y: bounds[1] });
                const upper = projection.toRenderLngLat({ x: bounds[2], y: bounds[3] });
                map.fitBounds(
                    [
                        [lower.lng, lower.lat],
                        [upper.lng, upper.lat],
                    ],
                    // Umgebung im Bild: die Flaeche soll im Kontext stehen, nicht formatfuellend.
                    //
                    // 🪤 `maxZoom` ist nicht kosmetisch. Das Dragwallthal misst 6 x 3 Karteneinheiten;
                    // eingepasst landet die Kamera bei Zoom 9 - oberhalb des Erscheinungsbands, und
                    // dort gibt es den Namen nicht mehr. Ein Review, das ueber das Band hinauszoomt,
                    // zeigt eine leere Flaeche und behauptet damit einen Fehler, den es nicht gibt.
                    { padding: 180, duration: 0, maxZoom },
                );
                await idle();

                // 🪤 Dasselbe von unten. Der Dschungel von Atoum ist breiter, als das Bild bei Zoom 5
                // fasst: eingepasst landet die Kamera bei 4,46, sein Lauf erscheint erst ab 5, und
                // darunter liefert die Kachel ihn gar nicht. Das Bild blieb leer, der Test rot
                // (2026-09-23). Beim Rathilswall (6,64 gegen ein Band ab 7) stand derselbe Fehler
                // still im Bericht - als Kollision ausgegeben.
                //
                // Die Untergrenze wird deshalb an der Kachel abgelesen und nicht als Zahl eingetragen:
                // sie ist ein Ergebnis der Ableitung und wandert mit jeder Neuableitung. Gefragt wird
                // die QUELLE, nicht das Gezeichnete - ob der Name dann gegen seine Nachbarn verliert,
                // ist genau der Befund, den der Bericht zeigen soll. Erst damit stimmt dort der Satz,
                // der Lauf liege in der Kachel.
                const delivered = (): boolean =>
                    map.querySourceFeatures("landscape-runs", {
                        sourceLayer: "landscape_label_run",
                        filter: ["==", ["get", "region_public_id"], region],
                    }).length > 0;
                while (map.getZoom() < maxZoom && !delivered()) {
                    map.jumpTo({ center: map.getCenter(), zoom: Math.floor(map.getZoom()) + 1 });
                    await idle();
                }
                return map.getZoom();
            },
            { bounds: entry.bounds, publicId: "", region: entry.id },
        );

        const drawn = await page.evaluate(
            ({ name, publicId }) => {
                const map = globalThis.avesmapsMap as unknown as MapHandle & {
                    setFilter(id: string, filter: unknown): void;
                };
                map.setFilter("review-area", ["==", ["get", "region_public_id"], publicId]);
                const all = map
                    .queryRenderedFeatures({
                        layers: map
                            .getStyle()
                            .layers.map((layer) => layer.id)
                            .filter((id) => id.startsWith("landscape-label-run-")),
                    })
                    .map((feature) => String(feature.properties["name"]));
                return { own: all.filter((entry_) => entry_ === name).length, all: [...new Set(all)] };
            },
            { name: entry.name, publicId: entry.id },
        );

        await page.waitForTimeout(400);
        const file = `${entry.name.replace(/[^\w]+/g, "-").toLowerCase()}.png`;
        mkdirSync(OUTPUT, { recursive: true });
        await page.screenshot({ path: resolve(OUTPUT, file) });

        reports.push({
            name: entry.name,
            zoom: Math.round(zoom * 100) / 100,
            drawnRuns: drawn.own,
            neighbours: drawn.all.filter((other) => other !== entry.name),
            legacyPoints: legacy?.length ?? 0,
            file,
        });

        // 🪤 Dass der eigene Name FEHLT, ist hier ein Befund und kein Testfehler: genau darueber
        // soll der Betreiber urteilen, und ein roter Lauf loescht das Bild nicht, sondern nur die
        // Uebersicht. Der Bericht fuehrt solche Faelle aus, samt den Namen, die stattdessen im Bild
        // stehen. Rot wird der Lauf nur, wenn gar nichts gezeichnet wurde - dann zeigt das Bild
        // nichts und das Review waere wertlos.
        expect(drawn.all.length, `im Bild zu ${entry.name} steht ueberhaupt ein Landschaftsname`).toBeGreaterThan(0);
    });
}

test.afterAll(() => {
    if (reports.length === 0) {
        return;
    }
    reports.sort((a, b) => a.name.localeCompare(b.name));
    const missing = reports.filter((row) => row.legacyPoints === 0);
    const absent = reports.filter((row) => row.drawnRuns === 0);
    const lines = [
        "# Schriftlauf-Review: die sieben bekannten Faelle",
        "",
        "Erzeugt von `npm run review:runs` (`apps/web/e2e/landscape-name-review.spec.ts`).",
        "**Nicht committed** - das Verzeichnis steht in `.gitignore`, die Bilder werden neu erzeugt.",
        "",
        "Zu beurteilen ist eine kartografische Frage, keine Zahl: steht der Name so, dass ein Leser",
        "ihn der Flaeche zuordnet? Die Metrik sagt fuer alle sieben \u201emehrheitlich daneben\u201c; die",
        "Sichtpruefung an den sechs Legacy-Referenzflaechen war einwandfrei.",
        "",
        "| | |",
        "|---|---|",
        "| 🔴 rote Linie | Umriss der Region, um die es geht |",
        "| 🔵 blau gestrichelt | **Legacys eigene Kurve** aus `curve_label_line` im Snapshot |",
        "| Schrift | der Avesmaps3D-Schriftlauf, so wie ihn die Karte normal zeichnet |",
        "",
        "| Region | Zoom | Namen im Bild | Laeufe gesamt | Anteil innen | Legacy-Kurve | Bild |",
        "|---|---|---|---|---|---|---|",
    ];
    for (const row of reports) {
        const source = CASES.find((entry) => entry.name === row.name);
        lines.push(
            `| ${row.name} | ${String(row.zoom)} | ${row.drawnRuns > 0 ? String(row.drawnRuns) : "**0**"} | ` +
                `${String(source?.runs ?? "?")} | ${String(source?.inside ?? "?")} | ` +
                `${row.legacyPoints > 0 ? `${String(row.legacyPoints)} Punkte` : "**fehlt**"} | ` +
                `[\`${row.file}\`](${row.file}) |`,
        );
    }
    if (absent.length > 0) {
        lines.push("", "## Faelle, in denen der Name im Bild nicht erscheint", "");
        for (const row of absent) {
            lines.push(
                `**${row.name}** — bei Zoom ${String(row.zoom)} steht der eigene Name nicht im Bild. ` +
                    `Stattdessen gezeichnet: ${row.neighbours.length > 0 ? row.neighbours.map((n) => `\`${n}\``).join(", ") : "nichts"}. ` +
                    "Das ist kein Fehler dieses Laufs, sondern der zu beurteilende Befund: der Lauf liegt in der Kachel, " +
                    "die Kollision entscheidet gegen ihn.",
                "",
            );
        }
    }
    if (missing.length > 0) {
        lines.push(
            "",
            `⚠️ Fuer ${String(missing.length)} Faelle fehlt die Legacy-Vergleichslinie. Der Snapshot ` +
                `\`${SNAPSHOT}\` wurde nicht gelesen oder traegt fuer diese Namen kein \`curve_label_line\`.`,
        );
    }
    lines.push(
        "",
        "## Was danach passiert",
        "",
        "Nichts automatisch. Die sieben bleiben in `KNOWN_OUTLIERS` (`verify-runs.ts`) stehen, bis der",
        "Betreiber entscheidet. Eine achte Region wuerde `npm run verify:runs` rot faerben.",
        "",
    );
    const target = resolve(OUTPUT, "README.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, lines.join("\n"), "utf8");
    console.warn(`Review geschrieben: ${target}`);
});
