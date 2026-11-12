import { expect, test, type Page } from "@playwright/test";
import { openMap, showLandscapes, showPlace, type MapHandle } from "./map-handle.ts";

/**
 * Die Landschaftsnamen auf ihrem Schriftlauf (WI-0004, ADR-0007).
 *
 * Gemessen wird an sechs Flaechen, an denen Legacy seine Kurvenbeschriftung abgenommen hat
 * (MCS-008), plus einer mit mehreren Instanzen. Geprueft wird das, was auf der Karte falsch
 * aussehen wuerde: erscheint der Name ueberhaupt, steht er genau einmal da, und steht er ueber
 * SEINER Flaeche - nicht daneben.
 *
 * 🪤 Die sechs sind die ABNAHMEBASIS, nicht eine feste Namensliste: Wer in Legacy seine Kurve
 * abschaltet, faellt heraus und wird durch eine andere Legacy-Kurvenflaeche ersetzt, damit die
 * Basis sechs bleibt. Einmal geschehen am 2026-10-06, siehe den Eintrag Raschtulswall unten.
 *
 * 🪤 Ein Test, der nur zaehlt, ob Symbole da sind, faellt auf jede dieser Fragen herein. Ein Name,
 * der zweimal steht, ist ein Symbol mehr; ein Name, der neben seiner Flaeche steht, ist genau ein
 * Symbol. Deshalb wird die Position gegen die Flaeche gemessen, nicht die Anzahl gegen null.
 */

const RUN_LAYER = "landscape-label-run";
const AREA_LAYERS = ["landscape-fill-topographie", "landscape-fill-vegetation", "landscape-fill-derographisch"];

/**
 * Die sechs Legacy-Referenzflaechen mit ihrem `label_curve_max`.
 *
 * 🪤 `curveMax` ist eine OBERgrenze fuer das, was im Bild stehen darf - keine Sollzahl. Bei einem
 * Zoom, auf dem drei Instanzen gelten, ist die Kurve regelmaessig laenger als der Bildschirm: die
 * Koschberge messen bei Zoom 6 rund 4000 Pixel, das Fenster 1280. Zwei der drei Namen stehen dann
 * ausserhalb, und genau dafuer gibt es sie. Ein Test, der drei ZAEHLT, prueft die Fenstergroesse.
 */
const REFERENCES = [
    { name: "Drachensteine", at: { x: 677.0, y: 661.8 }, zoom: 5, curveMax: 2 },
    { name: "Koschberge", at: { x: 458.2, y: 538.6 }, zoom: 5, curveMax: 2 },
    { name: "Schwarze Sichel", at: { x: 625.3, y: 606.6 }, zoom: 5, curveMax: 2 },
    // 🔴 Seit 2026-10-06 steht hier der Raschtulswall statt des „Östlichen Hangwalds des
    // Raschtulswalls“ (`eff4d764…`). Grund: Ein Editor hat in Legacy dessen Kurvenbeschriftung
    // abgeschaltet — `curve_label` ging zwischen den Snapshots 2026-09-24 und 2026-10-05 von `true`
    // auf `false`, und sein Feature führt keine `curve_label_line` mehr. Die Ableitung lässt ihn
    // folgerichtig aus, sein Name steht seither als Punktlabel (I7). Der Test maß damit eine
    // Zusicherung, die für sein Messobjekt nicht mehr gilt; die Referenz nachzuziehen ist Pflege,
    // keine Produktänderung — die Zusicherung selbst ist unverändert (MCS-028, MCS-011).
    //
    // Der Ersatz ist belegt, nicht geraten (gemessen 2026-10-06): `0f3b210b-d356-4797-bb12-5f44a153ff3c`,
    // in Legacys aktuellem Export `curve_label = true`, `curve_label_max = 2`, eigene
    // `curve_label_line` mit 32 Punkten; bei uns 12 Läufe im Band z2..z8 (zwei Instanzen ab z4),
    // mindestens 98,5 % jeder Lauflänge über der eigenen Fläche. Der Name ist unter den aktiven
    // Regionen eindeutig — anders als „Koschberge“, das es zweimal gibt.
    //
    // ⭐ Und es ist dieselbe Stelle der Karte: Der Raschtulswall ist der Nachbar, der dem Hangwald
    // in MCS-011 den Platz nahm. Die Abnahmebasis aus MCS-008 behält damit sechs Flächen, und der
    // Test misst weiter in genau der dichten Ecke, an der die Kollisionskette gemessen wurde.
    { name: "Raschtulswall", at: { x: 564.2, y: 456.3 }, zoom: 5, curveMax: 2 },
    // 🔴 Seit 2026-10-11 stehen hier Thasch und Flusslande statt des „Südlichen Hangwalds des Finsterkamms“
    // (`ef52ca4d…`) und des „Westlichen Hangwalds des Raschtulswalls“ (`ab6243fa…`). Grund: Beide tragen in Legacy
    // „Regionname anzeigen = aus“ (`show_name = false` in `map-features.json`, schon im Snapshot 2026-09-28), und seit
    // ad57a814 (WI-0105 Nachtrag, Migration 0084) zeichnen wir solche Namen wie Legacy nicht. Ihre Läufe liegen weiter vor,
    // aber `landscape_label_run_render` lässt sie aus; der Test maß zwei Namen, die bewusst nicht erscheinen. Wie am
    // 2026-10-06: Die Referenz zu tauschen ist Pflege, die Zusicherung bleibt.
    //
    // Der Ersatz ist belegt, nicht geraten (gemessen 2026-10-11 am Satz map179380), jeweils mit derselben Kurvenklasse:
    // - Thasch (`065eb066…`, Gebirge): in Legacys Export `curve_label = true`, `curve_label_max = 1`, `show_name = true`,
    //   eigene `curve_label_line` mit 32 Punkten; bei uns 6 Läufe z3..z8, jeder zu 100 % über der eigenen Fläche. Der nähere
    //   Schwarzberger Forst erfüllt die Daten ebenso, wird auf z5 aber nicht gezeichnet (im Renderer gemessen); er misst
    //   deshalb nicht, was dieser Test zusichert.
    // - Flusslande (`0aa3602c…`), der Fall mit mehreren Instanzen: `curve_label = true`, `curve_label_max = 3`,
    //   `show_name = true`, 32 Punkte; bei uns 15 Läufe z4..z8, auf z5 drei Instanzen. Die Mitte liegt auf der dritten
    //   (100 % über der Fläche); die anderen beiden liegen auf z5 außerhalb des Bildes.
    // Beide Namen sind unter den aktiven Regionen eindeutig.
    //
    // 🔴 Seit 2026-10-29 steht hier Blutzinnen statt Thasch. Grund: Die Region `065eb066…` gibt es in den Kacheln der Entwicklungsdatenbank nicht mehr
    // (weder als Fläche noch als Name noch als Lauf); „Thasch“ ist dort jetzt ein anderes Gebirge (`e3f5427a…`, Topographie) ohne Schriftlauf, sein Name
    // steht als Punktlabel (I7, `has_curve_run = false`). Der Test maß damit einen Namen, der keine Kurve mehr hat; die Referenz zu tauschen ist Pflege,
    // die Zusicherung bleibt (MCS-008, MCS-028). Ob Thasch eine Kurve haben soll, ist eine Frage an die Daten, nicht an diesen Test.
    //
    // Der Ersatz ist belegt, nicht geraten (gemessen 2026-10-29 an den Kacheln der Entwicklungsdatenbank und im Renderer): Blutzinnen
    // (`afede6f8…`, Gebirge, Topographie), `instance_count = 1` wie Thasch, Läufe in den Kacheln z3 bis z6 (z7 und z8 nicht ausgezählt), auf z5 genau ein
    // gezeichneter Lauf, davon 89 % über der eigenen Fläche. Der Name ist unter den aktiven Regionen eindeutig (kein zweites Blutzinnen in den
    // Flächenkacheln von z4). Der nächste Kandidat mit 100 % läge 88 Karteneinheiten weiter und gleich neben den Koschbergen.
    { name: "Blutzinnen", at: { x: 447.2, y: 691.3 }, zoom: 5, curveMax: 1 },
    { name: "Flusslande", at: { x: 488.7, y: 519.4 }, zoom: 5, curveMax: 3 },
] as const;

interface DrawnName {
    name: string;
    /** Anteil der Stuetzpunkte des Laufs, unter denen die eigene Flaeche liegt. */
    overOwnArea: number;
}

/**
 * Was der Renderer wirklich gezeichnet hat, samt der Frage, ob unter dem Namen seine eigene
 * Flaeche liegt. Die Antwort kommt aus dem Renderer selbst (`queryRenderedFeatures` am Punkt),
 * nicht aus nachgerechneter Geometrie - sonst prueft der Test seine eigene Rechnung.
 *
 * 🪤 Gemessen wird ueber den GANZEN Lauf, nicht an seinem Mittelpunkt. Ein Hangwald ist ein
 * schmaler Streifen am Gebirgsrand; dort liegt ein einzelner Punkt schnell eine Pixelbreite
 * daneben, waehrend der Name auf der Karte genau richtig am Hang entlanglaeuft. Ein Test auf den
 * Mittelpunkt misst dann die Breite der Flaeche und nennt es einen Fehler.
 */
async function drawnNames(page: Page): Promise<DrawnName[]> {
    return page.evaluate(
        ({ runLayer, areaLayers }) => {
            const map = globalThis.avesmapsMap as unknown as MapHandle & {
                project(lngLat: [number, number]): { x: number; y: number };
            };
            // Seit WI-0135 je Landschaftsebene eine Ebene der Kurvennamen.
            const laeufe = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => id.startsWith(`${runLayer}-`));
            const drawn = map.queryRenderedFeatures({ layers: laeufe }) as unknown as {
                properties: Record<string, unknown>;
                geometry: { coordinates: [number, number][] };
            }[];

            return drawn.map((feature) => {
                const line = feature.geometry.coordinates;
                const own = feature.properties["region_public_id"];
                let hits = 0;
                const samples = 9;
                for (let index = 0; index < samples; index += 1) {
                    const at = line[Math.round((index / (samples - 1)) * (line.length - 1))] as [number, number];
                    const screen = map.project(at);
                    const below = map.queryRenderedFeatures([screen.x, screen.y], { layers: areaLayers });
                    if (below.some((area) => area.properties["region_public_id"] === own)) {
                        hits += 1;
                    }
                }
                return { name: String(feature.properties["name"]), overOwnArea: hits / samples };
            });
        },
        { runLayer: RUN_LAYER, areaLayers: AREA_LAYERS },
    );
}

for (const reference of REFERENCES) {
    test(`${reference.name} traegt seinen Namen ueber seiner Flaeche`, async ({ page }) => {
        await openMap(page);
        await showPlace(page, reference.at, reference.zoom);
        await showLandscapes(page);

        const names = await drawnNames(page);
        const own = names.filter((entry) => entry.name === reference.name);

        // I7: der Name erscheint. Sein Fehlen waere der Fehler, den niemand bemerkt.
        expect(own.length, `${reference.name} wird gezeichnet`).toBeGreaterThan(0);
        // I1: nie oefter als erlaubt. Die Kachelgrenze darf nicht verdoppeln - dass die Zahl der
        // Instanzen im Datenbestand stimmt, prueft `verify:runs` (I1_satz_vollzaehlig).
        expect(own.length, `${reference.name} steht hoechstens ${String(reference.curveMax)} mal`).toBeLessThanOrEqual(
            reference.curveMax,
        );
        // I5, auf der Karte gemessen statt in Karteneinheiten: der Name laeuft ueber seiner
        // Flaeche. Die Mehrheit seiner Laenge genuegt - eine Kurve darf eine Bucht ueberbruecken
        // und tut es bei Legacy ausdruecklich auch (MCS-008).
        for (const entry of own) {
            expect(entry.overOwnArea, `${reference.name} laeuft ueber seiner Flaeche`).toBeGreaterThan(0.5);
        }
    });
}

test("kein Landschaftsname steht doppelt", async ({ page }) => {
    await openMap(page);
    // Ein Ausschnitt ueber mehreren Kurvenregionen: hier laufen die Kacheln aneinander.
    await showPlace(page, { x: 660, y: 620 }, 5);
    await showLandscapes(page);

    const names = await drawnNames(page);
    const counted = new Map<string, number>();
    for (const entry of names) {
        counted.set(entry.name, (counted.get(entry.name) ?? 0) + 1);
    }

    // Mehrfachnennung ist erlaubt, aber sie kommt aus `label_curve_max` und damit aus den Daten -
    // hoechstens drei, nie mehr.
    const tooMany = [...counted.entries()].filter(([, count]) => count > 3);
    expect(tooMany).toEqual([]);
    expect(names.length, "es werden ueberhaupt Namen gezeichnet").toBeGreaterThan(0);
});

test("I7 - ein Name ohne Kurve steht als Punktlabel", async ({ page }) => {
    await openMap(page);
    // Albernia ist die Referenz fuer den Rueckfall: aktives Label, keine Kurve eingeschaltet.
    // 💣 Ohne den Punktlabel-Layer stand dieser Name auf der Karte nirgends - I7 war erfuellt
    // formuliert und unerfuellt gezeichnet.
    // 🪤 Kein Wechsel in die Landschaftsansicht: geprueft wird ein NAME, keine Flaeche, und Namen
    // stehen in beiden Ansichten. In der Landschaftsansicht fehlen die Ortsnamen, und damit faellt
    // die Kollisionsrechnung anders aus - Albernia verlor dort seinen Platz an einen Nachbarn.
    await showPlace(page, { x: 382.4, y: 516.3 }, 2);

    const drawn = await page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as MapHandle)
            .queryRenderedFeatures({
                layers: (globalThis.avesmapsMap as unknown as MapHandle)
                    .getStyle()
                    .layers.map((l) => l.id)
                    .filter((id) => id.startsWith("map-label-")),
            })
            .map((feature) => String(feature.properties["name"])),
    );
    expect(drawn, "Albernia steht als Punktlabel").toContain("Albernia");

    // Und nicht zweimal: wer eine Kurve traegt, steht auf ihr und nicht zusaetzlich als Punkt.
    const onCurve = await page.evaluate(() =>
        (globalThis.avesmapsMap as unknown as MapHandle)
            .queryRenderedFeatures({
                layers: (globalThis.avesmapsMap as unknown as MapHandle)
                    .getStyle()
                    .layers.map((l) => l.id)
                    .filter((id) => id.startsWith("landscape-label-run-")),
            })
            .map((feature) => String(feature.properties["name"])),
    );
    expect(drawn.filter((name) => onCurve.includes(name))).toEqual([]);
});

test("I3 - der Landschaftsname weicht keinem Ortsnamen", async ({ page }) => {
    await openMap(page);
    // Ueber den Koschbergen stehen vier Landschaftsnamen zwischen dichten Ortsnamen. Genau hier
    // ist der Rang gemessen worden - und genau hier war er falsch.
    await showPlace(page, { x: 458.2, y: 538.6 }, 5);
    await showLandscapes(page);

    const withPlaces = await drawnNames(page);
    const withoutPlaces = await page.evaluate(async () => {
        const map = globalThis.avesmapsMap as unknown as MapHandle & {
            setLayoutProperty(id: string, key: string, value: unknown): void;
        };
        // Die Ortsnamen stehen seit WI-0135 je Klasse und Seite in eigenen Ebenen.
        for (const { id } of map.getStyle().layers) {
            if (id.startsWith("place-label-")) map.setLayoutProperty(id, "visibility", "none");
        }
        await new Promise<void>((resolve) => {
            map.once("idle", resolve);
            setTimeout(resolve, 3000);
        });
        return map
            .queryRenderedFeatures({
                layers: map
                    .getStyle()
                    .layers.map((l) => l.id)
                    .filter((id) => id.startsWith("landscape-label-run-")),
            })
            .map((f) => String(f.properties["name"]));
    });

    // 💣 Die Aussage ist nicht "der Layer steht an Position n", sondern: die Ortsnamen kosten
    // keinen einzigen Landschaftsnamen. Gemessen, weil die naheliegende Lesart der
    // Layerreihenfolge falsch ist - MapLibre platziert von oben nach unten, der OBERE gewinnt.
    expect(withoutPlaces.length, "ohne Ortsnamen stehen Landschaftsnamen da").toBeGreaterThan(0);
    expect(withPlaces.map((entry) => entry.name).sort()).toEqual([...withoutPlaces].sort());
});
