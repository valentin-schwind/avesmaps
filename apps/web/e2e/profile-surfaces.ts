import { expect, type Locator, type Page } from "@playwright/test";
import { AIR_TYPE, type ElevationSurface, type RouteResponse } from "@avesmaps3d/shared";
import { routeAnswer } from "./route-evidence.ts";

/**
 * Hilfen für die Höhenlinie nach Art (WI-0065 Nachtrag 2026-10-03): Land, Fluss, Meer, Flughöhe.
 * Die Farben stehen als Token im Designkanon; hier wird nie ein Wert verglichen, sondern die gezeichnete Linie
 * gegen die Variable, die sie tragen soll.
 */

export type Tone = "land" | "river" | "sea" | "air";

/**
 * Eine Reise mit allen drei Arten am Boden: Land, Fluss und Meer (Strasse, die Tommel abwärts, Seeweg, Küstenpfad nach Thures Tor;
 * gemessen 2026-10-12 auf Satz 179380 in der Folge Land, Fluss, Meer, Land). 🪤 Die Strecke ist nur Träger, die Zusicherung gilt den
 * Arten. 🔴 Die FOLGE der Arten nennt die Antwort des Servers (`expectedSurfaceOrder`), nicht der Test: Am 2026-10-29 fuhr dieselbe
 * Reise Land, Fluss, Land, Meer, Land - ein Stück Land zwischen Fluss und Meer, weil sich die Wege geändert haben, nicht das Profil.
 * Bis 2026-10-12 war es Boronaya → Moorburg; seit dem Wegezug vom 2026-10-10 (Legacy-Satz 179380: alle 28 Abschnitte des Yaquir
 * stillgelegt, 34 neu gezeichnet) fährt sie ohne Fluss, mit dem Code von vor Release N ebenso. Fällt Fluss oder Meer hier einmal weg,
 * eine andere Strecke suchen, nicht die Folge kürzen.
 */
export const LAND_RIVER_SEA = "?route=Alderstein~Thures%20Tor";

/**
 * Die Arten, in denen das Profil die Reise zeichnen muss, in der Folge der Reise und benachbarte gleiche zusammengefasst: aus der
 * Antwort des Servers, die das Profil selbst bekommt (`segmentRuns`: je Abschnitt seine `elevation_surface`, ohne Angabe Land; ein
 * Abschnitt ohne Messwert zeichnet nichts). Unter einem Flug ist die Art Sache des Geländes darunter; diese Hilfe gilt Reisen am Boden.
 */
export function expectedSurfaceOrder(route: RouteResponse): ElevationSurface[] {
    const kinds = route.segments
        .filter(
            (segment) =>
                segment.subtype !== AIR_TYPE && (segment.elevation_profile ?? []).some(([, height]) => height !== null),
        )
        .map((segment): ElevationSurface => segment.elevation_surface ?? "land");
    return kinds.filter((kind, index) => kind !== kinds[index - 1]);
}

/**
 * Wie `openProfile`, dazu die unveränderte Antwort des Servers, aus der die Folge der Arten folgt. Die Voraussetzung, dass die Reise
 * Land, Fluss und Meer hat, prüft diese Hilfe selbst: Ohne sie bewiese die Folge nichts über die drei Farben.
 */
export async function openProfileWithRoute(
    page: Page,
    search: string,
): Promise<{ chart: Locator; route: RouteResponse; order: ElevationSurface[] }> {
    const answer = routeAnswer(page);
    // Scheitert das Öffnen, wartet die Antwort weiter; ihr Ablauf soll den Fehler des Öffnens nicht überdecken.
    answer.catch(() => undefined);
    const chart = await openProfile(page, search);
    const route = await answer;
    const order = expectedSurfaceOrder(route);
    expect(order, "Voraussetzung: die Reise hat Land, Fluss und Meer").toEqual(
        expect.arrayContaining(["land", "river", "sea"]),
    );
    return { chart, route, order };
}

/** Öffnet die Strecke, am Telefon auch den Planer, klappt die Profilbox auf und wartet auf das Diagramm. */
export async function openProfile(page: Page, search: string): Promise<Locator> {
    await page.goto(`/${search}`);
    await page.waitForFunction(() => globalThis.avesmapsMap?.isStyleLoaded() === true, undefined, { timeout: 30_000 });
    const phone = await page.evaluate(() => globalThis.matchMedia("(pointer: coarse)").matches);
    const tab = page.getByTestId("route-planner-tab");
    if (phone && (await tab.getAttribute("aria-expanded")) !== "true") await tab.tap();
    await expect(tab).toHaveAttribute("aria-expanded", "true");
    const toggle = page.getByTestId("profile-toggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    if (phone) await toggle.tap();
    else await toggle.click();
    const chart = page.getByTestId("elevation-chart");
    await expect(chart.locator("svg")).toBeVisible();
    // Das Aufklappen läuft als Animation; erst danach stehen die Maße. Eine abgebrochene Animation ist auch fertig.
    await page.getByTestId("planning-profile").evaluate(async (element) => {
        await Promise.all(
            element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)),
        );
    });
    return chart;
}

/** Die Arten der Läufe in Zeichenreihenfolge, benachbarte gleiche zusammengefasst. */
export async function surfaceOrder(chart: Locator): Promise<string[]> {
    const kinds = await chart
        .locator("[data-surface]")
        .evaluateAll((groups) => groups.map((group) => group.getAttribute("data-surface") ?? ""));
    return kinds.filter((kind, index) => kind !== kinds[index - 1]);
}

/** Die gezeichnete Farbe einer Linie und die Farbe, die ihr Token trägt: beide als `rgb(...)`. */
export async function strokeAgainstToken(
    chart: Locator,
    selector: string,
    token: string,
): Promise<{ stroke: string; token: string }> {
    return chart
        .locator(selector)
        .first()
        .evaluate((line, name) => {
            const probe = document.createElement("span");
            probe.style.color = `var(${name})`;
            document.body.append(probe);
            const token = getComputedStyle(probe).color;
            probe.remove();
            return { stroke: getComputedStyle(line).stroke, token };
        }, token);
}

/** Die Farbe der Linie je Art, wie sie auf dem Bildschirm steht. */
export async function strokes(chart: Locator): Promise<Record<string, string>> {
    return chart.locator("[data-surface]").evaluateAll((groups) => {
        const result: Record<string, string> = {};
        for (const group of groups) {
            const line = group.querySelector("path.profile__terrain");
            const kind = group.getAttribute("data-surface") ?? "";
            if (line && !(kind in result)) result[kind] = getComputedStyle(line).stroke;
        }
        return result;
    });
}

/** Der waagerechte Bereich jedes Laufs in Einheiten des Diagramms (`getBBox`, ohne Strichbreite). */
export async function runExtents(chart: Locator): Promise<{ x: number; right: number }[]> {
    return chart.locator("[data-surface] path.profile__terrain").evaluateAll((lines) =>
        lines.map((line) => {
            const box = (line as unknown as SVGGraphicsElement).getBBox();
            return { x: box.x, right: box.x + box.width };
        }),
    );
}
