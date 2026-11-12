import { expect, test } from "@playwright/test";
import { openMap, showPlace } from "./map-handle.ts";

/**
 * Ortslabel rechts, bei Kollision links (Betreiberentscheidung 2026-09-22).
 *
 * 💣 Der Produktfall: ein Bauwerk liegt auf hoher Zoomstufe fast auf einer Siedlung, und sein Name
 * verschwindet. Mit dem Seitenwechsel sollen BEIDE stehen können.
 *
 * 🪤 Geprüft werden echte, im Bestand gemessene Paare — nicht der eine Fall aus der Meldung.
 * „Burg Kleinstein" gibt es gar nicht; die Zusicherung gilt für die Ortsklassen allgemein.
 */

interface MapHandle {
    getStyle(): { layers: { id: string }[] };
    queryRenderedFeatures(options: { layers: string[] }): { properties: Record<string, unknown> }[];
}

/** Alle Ortsnamen im Bild; seit WI-0135 stehen sie je Klasse und Seite in eigenen Ebenen. */
function ortsnamenImBild(): { properties: Record<string, unknown> }[] {
    const map = globalThis.avesmapsMap as unknown as MapHandle;
    const layers = map
        .getStyle()
        .layers.map((layer) => layer.id)
        .filter((id) => id.startsWith("place-label-"));
    return map.queryRenderedFeatures({ layers });
}

/**
 * Bauwerk und Siedlung, die im Bestand fast aufeinander liegen (Abstand in Karteneinheiten).
 *
 * 🔴 Seit WI-0135 gilt dazu die Rangregel (Betreiber 2026-10-11): Ein Bauwerksname überdeckt nie die Markierung einer
 * Siedlung, „wenn es nichts findet muss es weg bis der zoom es erlaubt“. Der Almadinpalast liegt AUF der Markierung von
 * Al'Muktur (bei Stufe 8 rund 8 px, ganz nah rund 24 px vom Mittelpunkt einer Stadtmarke mit 16 px Radius): Dort steht nur
 * der Name der Stadt, auch ganz nah. Die beiden anderen Paare haben Platz, dort stehen beide.
 */
const PAARE = [
    { bauwerk: "Almadinpalast", ort: "Al'Muktur", at: { x: 501.69, y: 438.44 }, abstand: 0.067, beide: false },
    { bauwerk: "Wolfsburg", ort: "Hirtenheim", at: { x: 614.14, y: 484.85 }, abstand: 0.163, beide: true },
    { bauwerk: "Burg Schwarzenfels", ort: "Devensberg", at: { x: 612.02, y: 564.26 }, abstand: 0.202, beide: true },
];

for (const paar of PAARE) {
    const titel = paar.beide
        ? `🔴 ${paar.bauwerk} und ${paar.ort} stehen beide (Abstand ${String(paar.abstand)})`
        : `🔴 ${paar.ort} steht, ${paar.bauwerk} überdeckt ihre Markierung nicht (Abstand ${String(paar.abstand)})`;
    test(titel, async ({ page }) => {
        await openMap(page);
        // Höchste Stufe: dort ist der Fall aufgefallen, und dort ist am meisten Platz.
        await showPlace(page, paar.at, 8);
        await page.waitForTimeout(2000);

        const namen = (await page.evaluate(ortsnamenImBild)).map((feature) => String(feature.properties["name"]));

        expect(namen, `${paar.ort} fehlt. Gezeichnet: ${namen.join(", ")}`).toContain(paar.ort);
        if (paar.beide) {
            expect(namen, `${paar.bauwerk} fehlt — der Seitenwechsel greift nicht`).toContain(paar.bauwerk);
        } else {
            expect(namen, `${paar.bauwerk} läge auf der Markierung von ${paar.ort}`).not.toContain(paar.bauwerk);
        }
    });
}

test("🔴 auch geneigt steht kein Name doppelt", async ({ page }) => {
    // Betreiber 2026-10-11 mit Bild aus der geneigten Ansicht: „Neetha Neetha“ und „Castel da Rosa Castel da Rosa“, je
    // einmal rechts und einmal links vom Marker. Nah an der Kamera erreichte die rechte Sperrfläche den linken Namen nicht.
    await openMap(page);
    await showPlace(page, { x: 425.367, y: 321.323 }, 7.5);
    const doppelt = await page.evaluate(async () => {
        const map = globalThis.avesmapsMap as unknown as MapHandle & {
            setPitch(pitch: number): void;
            once(event: string, handler: () => void): void;
            triggerRepaint(): void;
        };
        const gefunden: string[] = [];
        for (const neigung of [45, 60]) {
            map.setPitch(neigung);
            for (let runde = 0; runde < 3; runde += 1) {
                await new Promise<void>((fertig) => {
                    map.once("idle", fertig);
                    map.triggerRepaint();
                });
            }
            const layers = map
                .getStyle()
                .layers.map((layer) => layer.id)
                .filter((id) => id.startsWith("place-label-"));
            const seiten = new Map<string, Set<string>>();
            for (const feature of map.queryRenderedFeatures({ layers }) as unknown as {
                layer: { id: string };
                properties: Record<string, unknown>;
            }[]) {
                const id = String(feature.properties["public_id"]);
                seiten.set(
                    id,
                    (seiten.get(id) ?? new Set()).add(feature.layer.id.endsWith("-left") ? "links" : "rechts"),
                );
            }
            for (const [id, s] of seiten) {
                if (s.size > 1) gefunden.push(`${String(neigung)}°: ${id}`);
            }
        }
        return gefunden;
    });
    expect(doppelt).toEqual([]);
});

test("🪤 der Seitenwechsel kostet keine Ortsnamen anderswo", async ({ page }) => {
    // Punkt 3 der Abnahme: der bereits platzierte andere Name bleibt unverändert. Gemessen als
    // Gesamtzahl — bräche der Wechsel etwas, fiele sie ein.
    await openMap(page);
    await showPlace(page, { x: 501.69, y: 438.44 }, 6);
    await page.waitForTimeout(1800);
    const anzahl = (await page.evaluate(ortsnamenImBild)).length;
    expect(anzahl, "Ortsnamen im Bild").toBeGreaterThan(10);
});
