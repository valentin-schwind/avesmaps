import { expect, type Locator } from "@playwright/test";

/**
 * Das Aussehen jedes Kartentooltips (Design Guide §15.3, Hülle `src/map/map-tooltip.vue`), gemessen am Schild: kein
 * Rahmen, Radius 5, Polster 5 × 20, Text mittig, Pfeil 15 px, Fläche und Schrift die der Oberfläche, die Hausschrift
 * (nicht Arial aus dem Stylesheet des Kartencontainers), Name 13 px und, wo es eine gibt, die zweite Zeile 11 px.
 *
 * Alle drei Schilder der Karte (Grenzübertritt, Fläche beim Zeigen, Einrast-Schild) prüfen sich daran; ein viertes
 * bekommt dieselbe Prüfung, indem es die Hülle benutzt.
 */

/** Hell: Fläche `#fffdf9`, Schrift `#2e271e`. Dunkel: `#312e26` und `#eee7da`. */
const GROUND = { light: "rgb(255, 253, 249)", dark: "rgb(49, 46, 38)" } as const;
const INK = { light: "rgb(46, 39, 30)", dark: "rgb(238, 231, 218)" } as const;

export async function expectTooltipLook(
    tooltip: Locator,
    options: { meta?: boolean; theme?: "light" | "dark" } = {},
): Promise<void> {
    const theme = options.theme ?? "light";
    const look = await tooltip.evaluate((element) => {
        const box = getComputedStyle(element);
        const name = element.querySelector(".map-tooltip__name");
        const meta = element.querySelector(".map-tooltip__meta");
        return {
            edge: box.borderTopWidth,
            radius: box.borderRadius,
            padding: box.padding,
            align: box.textAlign,
            arrow: getComputedStyle(element, "::after").borderTopWidth,
            ground: box.backgroundColor,
            ink: box.color,
            face: box.fontFamily.split(",")[0],
            name: name ? getComputedStyle(name).fontSize : null,
            meta: meta ? getComputedStyle(meta).fontSize : null,
        };
    });
    expect(look).toEqual({
        edge: "0px",
        radius: "5px",
        padding: "5px 20px",
        align: "center",
        // Die Spitze ist größer als Legacys 6 px (Betreiber 2026-10-03: „mach den pfeil 15 px“).
        arrow: "15px",
        ground: GROUND[theme],
        ink: INK[theme],
        // 🔴 Die Hausschrift, nicht Arial aus dem Stylesheet des Kartencontainers.
        face: '"Faculty Glyphic"',
        name: "13px",
        meta: options.meta ? "11px" : null,
    });
}
