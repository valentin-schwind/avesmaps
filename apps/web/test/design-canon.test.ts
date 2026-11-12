import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPropertyExpression } from "@maplibre/maplibre-gl-style-spec";
import {
    AVENTURIA_CARTOGRAPHY,
    composeView,
    DEFAULT_LANDSCAPE_SELECTION,
    DESIGN_CANON,
    labelFamily,
    renderZoomForBand,
} from "@avesmaps3d/shared";
import {
    buildPlaceLayers,
    ITALIC_LABEL_FONT,
    LABEL_FONT,
    PLACE_LABEL_LAYER_IDS,
    placeLabelLayerId,
} from "../src/map/place-layers.ts";
import { mapLabelLayerId } from "../src/map/landscape-layers.ts";
import { zoomspanne } from "../src/map/zoombaender-stand.ts";

/** Die Namensebene der Dörfer rechts vom Marker; alle Namensebenen teilen Schrift und Saum (WI-0135). */
const DORFNAMEN = placeLabelLayerId("dorf", "right");
import { renderCanonCss } from "../../../scripts/dev/build-design-canon-css.mjs";
import { propertySpec } from "./style-spec.ts";

/**
 * Der Designkanon ist Visual Parity mit Legacy (WI-0014, Finding MCS-015).
 *
 * 🔴 Diese Tests prüfen NICHT, ob ein Hexwert „schön" ist - das entscheidet der Betreiber am Bild.
 * Sie prüfen die REGELN, die Legacy trägt und die man beim Nachbauen still verlieren kann: helle
 * Schrift auf dunklem Saum, ein Ton je Landschaftsart, Versalien für genau fünf Arten, Ruinen
 * kursiv, und vor allem: dass keine zweite Farbtafel entsteht.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const STANDARD = { labels: true, composition: composeView("standard", DEFAULT_LANDSCAPE_SELECTION) };
const LANDSCAPES = { labels: true, composition: composeView("landscapes", DEFAULT_LANDSCAPE_SELECTION) };
/** Die Punktnamen der Vegetation; Ton und Versalien hängen an der Art, nicht an der Ebene (WI-0135: je Ebene eine). */
const LANDSCHAFTSNAMEN = mapLabelLayerId("vegetation");

function layer(id: string, options = STANDARD) {
    const found = buildPlaceLayers(options).find((entry) => entry.id === id);
    if (!found) {
        throw new Error(`layer "${id}" is missing from the style`);
    }
    return found;
}

/** Eine Paint-Eigenschaft gegen ein Feature auswerten - mit MapLibres eigenem Rechner. */
function paintAt(
    layerId: string,
    property: string,
    properties: Record<string, unknown>,
    zoom = 5,
    options = STANDARD,
): unknown {
    const found = layer(layerId, options);
    const spec = propertySpec(`paint_${found.type}`, property);
    const value = (found.paint as Record<string, unknown>)[property];
    const compiled = createPropertyExpression(value, property, spec);
    if (compiled.result !== "success") {
        throw new Error(`${layerId}.${property} is not a valid expression: ${JSON.stringify(compiled.value)}`);
    }
    return compiled.value.evaluate({ zoom }, { type: "Point", properties } as never);
}

function layoutAt(
    layerId: string,
    property: string,
    properties: Record<string, unknown>,
    zoom = 5,
    options = STANDARD,
): unknown {
    const found = layer(layerId, options);
    const spec = propertySpec(`layout_${found.type}`, property);
    const value = (found.layout as Record<string, unknown>)[property];
    const compiled = createPropertyExpression(value, property, spec);
    if (compiled.result !== "success") {
        throw new Error(`${layerId}.${property} is not a valid expression: ${JSON.stringify(compiled.value)}`);
    }
    return compiled.value.evaluate({ zoom }, { type: "Point", properties } as never);
}

describe("Kartenbeschriftung: helle Schrift, dunkler Saum", () => {
    /**
     * 💣 Die Regel, aus der fast alle sichtbaren Unterschiede zu Legacy folgten. Auf der ganzen
     * Legacy-Karte steht kein dunkler Name auf hellem Saum; Avesmaps3D hatte genau das.
     */
    it("🔴 jede Beschriftungsfamilie ist hell auf schwarz (die Klimazonen ausgenommen, unten)", () => {
        for (const name of ["place", "landscape", "path"] as const) {
            const family = labelFamily(name);
            expect(family.haloColor, `${name}: Saum`).toBe("#000000");
            // Helligkeit grob über die Summe der Kanäle - eine dunkle Schrift fiele hier durch.
            const channels = [1, 3, 5].map((offset) => Number.parseInt(family.color.slice(offset, offset + 2), 16));
            expect(Math.min(...channels), `${name}: Schrift zu dunkel`).toBeGreaterThan(0x90);
        }
    });

    it("🔴 die eine Ausnahme: Klimazonennamen dunkel im Ton der Zone, heller Saum (Betreiber 2026-10-05)", () => {
        // „kannst du die kontur weniger krass stark machen und die font-color einem dunkleren ton der klimazone geben“.
        // Die Werte misst `climate-colours.test.ts`; hier steht nur, dass es die benannte Ausnahme ist und keine zweite.
        const climate = labelFamily("climate");
        expect(climate.toneLightness).toBeLessThan(0.5);
        expect(climate.haloToneLightness).toBeGreaterThan(0.9);
        for (const name of ["place", "landscape", "path"] as const) {
            expect(labelFamily(name).haloToneLightness, name).toBeUndefined();
        }
    });

    it("Ortsnamen sind weiß - eine Farbe für ALLE Klassen", () => {
        // Legacy unterscheidet Metropole und Dorf über Größe und Erscheinungsstufe, nie über den Ton.
        for (const subtype of ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"]) {
            expect(paintAt(placeLabelLayerId(subtype, "right"), "text-color", { subtype }), subtype).toEqual({
                a: 1,
                b: 1,
                g: 1,
                r: 1,
            });
        }
    });

    /**
     * 🪤 Der Saum wächst mit der Schrift. Ein fester Pixelwert wäre bei z2 ein Kasten und bei z8 ein
     * Haarstrich - Legacy rechnet ihn aus der Schriftgröße, und genau das wird hier gemessen.
     */
    it("🪤 der Saum der Ortsnamen wächst mit der Schriftgröße", () => {
        // 🪤 Die Stufen gehoeren zum BAND des Namens, und das beginnt erst mit seinem Zoomband. Eine Stufe darunter traegt er keine
        // Groesse, der Saum waere 0 - und der Test pruefte nichts. Gemessen an der Stadt: Seit den Zoombaendern (WI-0221, Legacys
        // gespeicherter Stand) beginnt der Dorfname auf Band 5, und von dort an hat er eine feste Groesse; der Saum kann nicht wachsen.
        const STADTNAMEN = placeLabelLayerId("stadt", "right");
        const ab = zoomspanne("orte.stadt.name").von;
        const klein = paintAt(STADTNAMEN, "text-halo-width", { subtype: "stadt" }, renderZoomForBand(ab)) as number;
        const gross = paintAt(STADTNAMEN, "text-halo-width", { subtype: "stadt" }, renderZoomForBand(7)) as number;
        expect(gross).toBeGreaterThan(klein);
        expect(klein).toBeGreaterThan(0);
    });

    it("💣 der Saum ist ein gültiger Ausdruck, nicht ein still verworfener", () => {
        // `["*", <interpolate über zoom>, faktor]` würde MapLibre ohne Fehlermeldung ablehnen und die
        // Eigenschaft auf ihrem Vorgabewert stehen lassen. Der Test oben liefe dann gegen 0.
        const found = layer(DORFNAMEN);
        for (const property of ["text-halo-width", "text-halo-blur"]) {
            const compiled = createPropertyExpression(
                (found.paint as Record<string, unknown>)[property],
                property,
                propertySpec("paint_symbol", property),
            );
            expect(compiled.result, property).toBe("success");
        }
    });
});

describe("Landschaftsnamen: ein Ton je Art, Versalien für fünf", () => {
    it("jede Art mit eigenem Ton erscheint auch im Stil", () => {
        const mitTon = Object.entries(AVENTURIA_CARTOGRAPHY.types).filter(([, style]) => style.labelColor);
        expect(mitTon.length).toBeGreaterThan(20);
        for (const [type, style] of mitTon) {
            const farbe = paintAt(LANDSCHAFTSNAMEN, "text-color", { label_type: type }, 5, LANDSCAPES) as {
                r: number;
                g: number;
                b: number;
            };
            const erwartet = [1, 3, 5].map((o) => Number.parseInt((style.labelColor as string).slice(o, o + 2), 16));
            expect(
                [farbe.r, farbe.g, farbe.b].map((v) => Math.round(v * 255)),
                type,
            ).toEqual(erwartet);
        }
    });

    /**
     * 🪤 Eine Art ohne eigenen Ton fällt auf die Vorgabe der Familie zurück, statt zu verschwinden.
     * `sonstiges` ist genau dieser Fall - Legacy kennt für sie keinen Ton (`urwald` hat seit 2026-09-30 Legacys #afc19a).
     */
    it("🪤 eine Art ohne Ton bekommt die Kanonvorgabe, nicht Schwarz", () => {
        const farbe = paintAt(LANDSCHAFTSNAMEN, "text-color", { label_type: "sonstiges" }, 5, LANDSCAPES) as {
            r: number;
            g: number;
            b: number;
        };
        const vorgabe = [1, 3, 5].map((o) => Number.parseInt(labelFamily("landscape").color.slice(o, o + 2), 16));
        expect([farbe.r, farbe.g, farbe.b].map((v) => Math.round(v * 255))).toEqual(vorgabe);
    });

    it("🔴 Versalien tragen genau fünf Arten - die Regionsuntertypen NICHT", () => {
        const caps = Object.entries(AVENTURIA_CARTOGRAPHY.types)
            .filter(([, style]) => style.labelUppercase)
            .map(([type]) => type)
            .sort();
        expect(caps).toEqual(["gebirge", "insel", "inselgruppe", "kontinent", "region"]);
        for (const type of caps) {
            expect(layoutAt(LANDSCHAFTSNAMEN, "text-transform", { label_type: type }, 5, LANDSCAPES), type).toBe(
                "uppercase",
            );
        }
        for (const type of ["steppe", "huegelland", "tundra", "wald", "see"]) {
            expect(layoutAt(LANDSCHAFTSNAMEN, "text-transform", { label_type: type }, 5, LANDSCAPES), type).toBe(
                "none",
            );
        }
    });

    it("Landschaftsnamen sind gesperrt, Ortsnamen nicht", () => {
        expect(labelFamily("landscape").letterSpacing).toBeGreaterThan(0);
        expect(labelFamily("place").letterSpacing).toBe(0);
    });
});

describe("Ruinen stehen kursiv", () => {
    /**
     * 🪤 EIN Layer mit datengetriebenem `text-font`, nicht zwei Layer. Zwei Symbollayer wären zwei
     * Kollisionsdurchgänge, und der obere gewänne - damit hinge an einer reinen Darstellungsfrage,
     * WELCHE Namen stehenbleiben. Genau das darf dieser Schritt nicht ändern.
     */
    it("🪤 derselbe Layer, nur ein anderer Glyphenstapel", () => {
        expect(layoutAt(DORFNAMEN, "text-font", { subtype: "dorf", is_ruined: true })).toEqual([ITALIC_LABEL_FONT]);
        expect(layoutAt(DORFNAMEN, "text-font", { subtype: "dorf", is_ruined: false })).toEqual([LABEL_FONT]);
        expect(layoutAt(DORFNAMEN, "text-font", { subtype: "dorf" })).toEqual([LABEL_FONT]);
        // Seit WI-0135 hat jede Klasse zwei Namensebenen (rechts, links); eine Ruine bekommt trotzdem keine eigene.
        expect(buildPlaceLayers(STANDARD).filter((entry) => entry.id.startsWith("place-label"))).toHaveLength(
            PLACE_LABEL_LAYER_IDS.length,
        );
    });

    it("der kursive Stapel ist derselbe Schnitt, kein zweiter Font", () => {
        expect(ITALIC_LABEL_FONT).toContain("Faculty Glyphic");
        expect(ITALIC_LABEL_FONT).not.toBe(LABEL_FONT);
        expect(labelFamily("place").ruinsItalic).toBe(true);
    });
});

/**
 * Die Zeilen einer Datei OHNE Kommentare.
 *
 * 🪤 Ein Kommentar darf einen Wert nennen - er erklärt, woher er kommt, und genau diese Erklärung
 * ist der Sinn der Regel. Ein Test, der sie mitzählt, bestraft die Begründung.
 */
function codeZeilen(datei: string): string[] {
    const text = readFileSync(join(repositoryRoot, datei), "utf8");
    const ohneBloecke = text.replace(/\/\*[\s\S]*?\*\//g, "");
    return ohneBloecke.split("\n").map((zeile) => zeile.replace(/\/\/.*$/, ""));
}

describe("Keine zweite Farbtafel", () => {
    /**
     * 🔴 Der eigentliche Zweck des Kanons. Ein Hexwert in einer Vue- oder Layerdatei ist eine Farbe
     * zum zweiten Mal - und bei Legacy ist genau so die Oberfläche auseinandergelaufen. Der Test
     * sucht sie mechanisch, damit es nicht an Aufmerksamkeit hängt.
     */
    it("🔴 keine Farbliterale in Kartenlayern und Oberflächenkomponenten", () => {
        const dateien = [
            "apps/web/src/app.vue",
            "apps/web/src/legal/hinweise-fenster.vue",
            "apps/web/src/legal/hinweise-abschnitt.vue",
            "apps/web/src/legal/hinweise-bedienung.vue",
            "apps/web/src/legal/hinweise-kacheln.vue",
            "apps/web/src/legal/hinweise-anker.vue",
            "apps/web/src/legal/hinweise-block.vue",
            "apps/web/src/legal/hinweise-discord-knopf.vue",
            "apps/web/src/legal/hinweise-dokument.vue",
            "apps/web/src/legal/hinweise-text.vue",
            "apps/web/src/controls/avm-kaestchen.vue",
            "apps/web/src/map/place-layers.ts",
            "apps/web/src/map/landscape-layers.ts",
            "apps/web/src/map/path-layers.ts",
            // Die Kraftlinien (WI-0025): ihre Farben stehen in config/map-cartography/.
            "apps/web/src/map/powerline-layers.ts",
            "apps/web/src/map/powerline-arcs.ts",
            // Die Flugbahn (WI-0051 F3): ihre Farben stehen im Kanon, ihre Maße in config/map-cartography/.
            "apps/web/src/map/flight-arcs.ts",
            "apps/web/src/map/flight-path.ts",
            // Die gewählte Fläche (WI-0043).
            "apps/web/src/map/area-selection.ts",
            "apps/web/src/map/area-selection-input.ts",
            // Die Kamerasäule und der Dunst (WI-0016).
            "apps/web/src/controls/camera-controls.vue",
            "apps/web/src/controls/camera-ring.vue",
            // Die Zoomstufe im Editor (WI-0129 R2): Weiß und Schatten der Kartenschrift aus dem Kanon.
            "apps/web/src/controls/zoomstufe-anzeige.vue",
            "apps/web/src/controls/map-fan.vue",
            "apps/web/src/controls/fan-thumb.vue",
            "apps/web/src/controls/fan-ohr.vue",
            "apps/web/src/search/spotlight-search.vue",
            "apps/web/src/controls/display-menu.vue",
            "apps/web/src/controls/corner-links.vue",
            "apps/web/src/map/atmosphere/atmosphere.ts",
            // Himmel, Dunst und Fläche hinter der Karte (WI-0290): Farben aus atmosphere im Kanon.
            "apps/web/src/map/atmosphere/kulisse.ts",
            "apps/web/src/map/atmosphere/kulisse-werte.ts",
            "apps/web/src/map/atmosphere/kulisse-shader.ts",
            // Hell/Dunkel (WI-0032) und der Playmode (WI-0031).
            "apps/web/src/theme/theme.ts",
            "apps/web/src/controls/theme-toggle.vue",
            "apps/web/src/route-planner/route-player.vue",
            "apps/web/src/route-planner/route-planner.vue",
            // Die Zollzeile, die Liste der Grenzübertritte und ihre Marken auf der Karte (WI-0065 Z3).
            "apps/web/src/route-planner/route-overview.vue",
            // „Reise als PDF“ (WI-0306): Fenster und Bauteile; die Farben des PDFs kommen über `canonColour` aus dem hellen Kanon.
            "apps/web/src/reise-pdf/reise-pdf-fenster.vue",
            "apps/web/src/reise-pdf/reise-pdf-formular.vue",
            "apps/web/src/reise-pdf/reise-pdf-kartenwahl.vue",
            "apps/web/src/reise-pdf/reise-pdf-vorschau.vue",
            "apps/web/src/reise-pdf/reise-pdf-fuss.vue",
            "apps/web/src/reise-pdf/reise-pdf-zeichen.vue",
            "apps/web/src/reise-pdf/dokument.ts",
            "apps/web/src/map/route-layers.ts",
            "apps/web/src/controls/map-context-menu.vue",
            // Das Infopanel am rechten Rand und das Zeiger-Schild (WI-0063 P5), seine Bausteine nach Guide §16 (P6).
            "apps/web/src/info-panel/info-actions.vue",
            "apps/web/src/info-panel/info-canon-pill.vue",
            "apps/web/src/info-panel/info-content.vue",
            "apps/web/src/info-panel/info-fields.vue",
            "apps/web/src/info-panel/info-header.vue",
            "apps/web/src/info-panel/info-hidden-pill.vue",
            "apps/web/src/info-panel/info-lid.vue",
            "apps/web/src/info-panel/info-lies-in.vue",
            "apps/web/src/info-panel/info-link.vue",
            "apps/web/src/info-panel/info-panel.vue",
            "apps/web/src/info-panel/info-source-box.vue",
            "apps/web/src/info-panel/info-source-line.vue",
            "apps/web/src/info-panel/info-source-list.vue",
            "apps/web/src/info-panel/info-stairs.vue",
            // Die Katalogfenster „Kartensammlung“ und „Literatur“ und ihre Bausteine (WI-0118).
            "apps/web/src/catalog/catalog-credit.vue",
            "apps/web/src/catalog/catalog-entry.vue",
            "apps/web/src/catalog/catalog-filter-bar.vue",
            "apps/web/src/catalog/catalog-links.vue",
            "apps/web/src/catalog/catalog-notice.vue",
            "apps/web/src/catalog/catalog-row.vue",
            "apps/web/src/catalog/citymaps-fenster.vue",
            "apps/web/src/catalog/literature-fenster.vue",
            "apps/web/src/controls/area-choice-menu.vue",
            "apps/web/src/controls/area-hover-chip.vue",
            "apps/web/src/map/map-pin-layer.ts",
            // Die Prüfhaken im Auge (WI-0131): ihre Töne stehen im Kanon (`mapCheck*`).
            "apps/web/src/map/map-checks-layers.ts",
            // Das Messwerkzeug (WI-0095): Linie, Griffe und Wertkapsel lesen den Kanon, nie einen Hexwert.
            "apps/web/src/measure/measure-layers.ts",
            "apps/web/src/measure/measure-value.vue",
            // Der Hinweis, wenn die Karte nicht lädt (WI-0127 SYS-6).
            "apps/web/src/map/karte-gestoert.vue",
            // Die Medienverwaltung (WI-0068 P3): Fenster, Spalten, Kreis und ihre Bausteine.
            "apps/web/src/fenster/fenster-spalte.vue",
            "apps/web/src/controls/avm-kreis.vue",
            "apps/web/src/medien/medien-fenster.vue",
            "apps/web/src/medien/medien-arten.vue",
            "apps/web/src/medien/medien-treffer.vue",
            "apps/web/src/medien/medien-eintrag.vue",
            "apps/web/src/medien/medien-inspektor.vue",
            "apps/web/src/medien/medien-verwendungen.vue",
            "apps/web/src/medien/medien-galerie.vue",
            "apps/web/src/medien/medien-feldliste.vue",
            // Das gemeinsame Hochladeformular (WI-0068 P4b) und das mehrzeilige Feld.
            "apps/web/src/medien/medien-hochladen.vue",
            "apps/web/src/medien/medien-hochladen-fenster.vue",
            // Die Kästen des Inspectors beim Bearbeiten (WI-0068 P4b, Blatt 1 A).
            "apps/web/src/medien/medien-kasten.vue",
            "apps/web/src/medien/medien-kasten-eigenschaften.vue",
            "apps/web/src/medien/medien-kasten-entstehung.vue",
            "apps/web/src/medien/medien-kasten-rechte.vue",
            // Die Auswahl eines Wappens oder Titelbilds (WI-0068 P4b).
            "apps/web/src/medien/medien-auswahl.vue",
            "apps/web/src/medien/medien-auswahl-fenster.vue",
            "apps/web/src/controls/avm-textbereich.vue",
            // Die Bildansicht (Betreiber 2026-10-11, Guide §13.46).
            "apps/web/src/controls/avm-bildansicht.vue",
            // Der Spracheditor (WI-0261 S5d2): Fenster, Inhaltsbauteile und Leisten. Die Farben der Sprachen sind Daten, keine Tafel.
            "apps/web/src/spracheditor/spracheditor-fenster.vue",
            "apps/web/src/spracheditor/spracheditor-seite.vue",
            "apps/web/src/spracheditor/sprache-anlegen.vue",
            "apps/web/src/spracheditor/sprache-eigenschaften.vue",
            "apps/web/src/spracheditor/sprache-farbwahl.vue",
            "apps/web/src/spracheditor/sprache-flaechen.vue",
            "apps/web/src/spracheditor/sprache-kollisionen.vue",
            "apps/web/src/spracheditor/sprache-wiki-pillen.vue",
            "apps/web/src/spracheditor/sprachflaeche-leiste.vue",
        ];
        const funde: string[] = [];
        for (const datei of dateien) {
            for (const zeile of codeZeilen(datei)) {
                if (/#[0-9a-fA-F]{3,8}\b/.test(zeile)) {
                    funde.push(`${datei}: ${zeile.trim()}`);
                }
            }
        }
        expect(funde).toEqual([]);
    });

    it("die Oberfläche kennt kein synthetisches Fett", () => {
        // Faculty Glyphic bringt nur den Regular mit; ein gerechnetes 600/700 rendert matschig.
        // 🪤 Kommentare zählen nicht - der Satz „und kein font-weight: 600" ist die Begründung der
        // Regel und darf sie nicht selbst verletzen.
        const funde: string[] = [];
        for (const datei of [
            "apps/web/src/app.vue",
            "apps/web/src/legal/hinweise-fenster.vue",
            "apps/web/src/legal/hinweise-abschnitt.vue",
            "apps/web/src/legal/hinweise-bedienung.vue",
            "apps/web/src/legal/hinweise-kacheln.vue",
            "apps/web/src/legal/hinweise-anker.vue",
            "apps/web/src/legal/hinweise-block.vue",
            "apps/web/src/legal/hinweise-discord-knopf.vue",
            "apps/web/src/legal/hinweise-dokument.vue",
            "apps/web/src/legal/hinweise-text.vue",
            "apps/web/src/controls/avm-kaestchen.vue",
            "apps/web/src/controls/camera-controls.vue",
            "apps/web/src/controls/camera-ring.vue",
            "apps/web/src/controls/map-fan.vue",
            "apps/web/src/controls/fan-thumb.vue",
            "apps/web/src/controls/fan-ohr.vue",
            "apps/web/src/search/spotlight-search.vue",
            "apps/web/src/controls/display-menu.vue",
            "apps/web/src/controls/corner-links.vue",
            "apps/web/src/info-panel/info-actions.vue",
            "apps/web/src/info-panel/info-canon-pill.vue",
            "apps/web/src/info-panel/info-content.vue",
            "apps/web/src/info-panel/info-fields.vue",
            "apps/web/src/info-panel/info-header.vue",
            "apps/web/src/info-panel/info-hidden-pill.vue",
            "apps/web/src/info-panel/info-lid.vue",
            "apps/web/src/info-panel/info-lies-in.vue",
            "apps/web/src/info-panel/info-link.vue",
            "apps/web/src/info-panel/info-panel.vue",
            "apps/web/src/info-panel/info-source-box.vue",
            "apps/web/src/info-panel/info-source-line.vue",
            "apps/web/src/info-panel/info-source-list.vue",
            "apps/web/src/info-panel/info-stairs.vue",
            // Die Katalogfenster „Kartensammlung“ und „Literatur“ und ihre Bausteine (WI-0118).
            "apps/web/src/catalog/catalog-credit.vue",
            "apps/web/src/catalog/catalog-entry.vue",
            "apps/web/src/catalog/catalog-filter-bar.vue",
            "apps/web/src/catalog/catalog-links.vue",
            "apps/web/src/catalog/catalog-notice.vue",
            "apps/web/src/catalog/catalog-row.vue",
            "apps/web/src/catalog/citymaps-fenster.vue",
            "apps/web/src/catalog/literature-fenster.vue",
            // Die Wertpille des Messwerkzeugs (WI-0095): Sie stand einmal mit gefälschtem Fett auf der Karte.
            // 🪤 Gefangen hat sie diese Liste damals NICHT, und zwar aus zwei Gründen: Die Datei stand nicht
            // darin, UND das Fett war als `var(--font-weight-bold)` geschrieben - diese Form sieht der
            // Ausdruck unten nicht. Weiten lässt er sich nicht ohne Weiteres: Das Kanon-Etikett
            // (`info-canon-pill.vue`) trägt genau diese Form, und sein Fett ist eine Betreiberentscheidung
            // vom 2026-10-04. Die Lücke ist in WI-0095 §9 benannt.
            "apps/web/src/measure/measure-value.vue",
        ]) {
            for (const zeile of codeZeilen(datei)) {
                if (/font-weight:\s*(500|600|700|800|900|bold)/.test(zeile)) {
                    funde.push(`${datei}: ${zeile.trim()}`);
                }
            }
        }
        expect(funde).toEqual([]);
        expect(DESIGN_CANON.typography.synthesisWeight).toBe(false);
    });
});

describe("Einzeilig kürzen nur über .einzeilig", () => {
    /**
     * 🔴 Ein eigenes Rezept (`overflow: hidden` + `text-overflow: ellipsis`) schneidet die
     * Unterlängen der Hausschrift ab - so geschehen an sechs Stellen (Betreiber 2026-09-25: „nicht
     * dass es woanders wieder passiert“). Erlaubt ist der Auslassungspunkt deshalb genau einmal: in
     * der Klasse `.einzeilig` in app.vue, die den Platz nach unten mitbringt.
     */
    it("🔴 `text-overflow: ellipsis` steht nur in app.vue", () => {
        const wurzel = join(repositoryRoot, "apps/web/src");
        const dateien = readdirSync(wurzel, { recursive: true, encoding: "utf8" })
            .filter((pfad) => /\.(vue|css)$/.test(pfad))
            .map((pfad) => `apps/web/src/${pfad.replace(/\\/g, "/")}`);
        const funde: string[] = [];
        for (const datei of dateien) {
            for (const zeile of codeZeilen(datei)) {
                if (/text-overflow:\s*ellipsis/.test(zeile)) {
                    funde.push(datei);
                }
            }
        }
        expect(funde).toEqual(["apps/web/src/app.vue"]);
    });

    /**
     * 🔴 **Ein aufgeklappter Kopf ist mit seinem Rumpf ein Stück** (Betreiber 2026-10-06: „die unteren border
     * corners von diesen elementen sind noch rund obwohl das ding ausgeklappt ist“). Die Aussage stand vorher an
     * einer Stelle (`avm-disclosure.vue`) und fehlte an der anderen (`route-stage-group.vue`) — genau so laufen zwei
     * Rezepturen auseinander. Sie steht jetzt EINMAL, als `.avm-kopf-offen` in `app.vue`; dieser Test hält fest, dass
     * sie dort bleibt und dass die klappbaren Köpfe sie benutzen statt sie nachzubauen.
     */
    it("🔴 `.avm-kopf-offen` steht nur in app.vue, und die klappbaren Köpfe benutzen sie", () => {
        const wurzel = join(repositoryRoot, "apps/web/src");
        const dateien = readdirSync(wurzel, { recursive: true, encoding: "utf8" })
            .filter((pfad) => /\.(vue|css)$/.test(pfad))
            .map((pfad) => `apps/web/src/${pfad.replace(/\\/g, "/")}`);
        const erklaert = dateien.filter((datei) =>
            codeZeilen(datei).some((zeile) => /^\s*\.avm-kopf-offen/.test(zeile)),
        );
        expect(erklaert).toEqual(["apps/web/src/app.vue"]);
        for (const datei of [
            "apps/web/src/controls/avm-disclosure.vue",
            "apps/web/src/route-planner/route-stage-group.vue",
        ]) {
            expect(readFileSync(join(repositoryRoot, datei), "utf8"), datei).toContain("avm-kopf-offen");
        }
    });

    /**
     * 🔴 **Eine einzeilige Klappbox hat im ganzen Haus dieselbe Kopfhöhe** (Betreiber 2026-10-07: „klappboxen … sollen
     * eine einheitliche höhe haben (beispiele oneliner), im routenplaner wie im infopanel etc.“). Gemessen standen
     * drei Höhen nebeneinander — 22,00 px im Planer, 21,94 px in den Routendetails, 16,08 px im Infopanel —, weil
     * JEDES Bauteil seine Höhe aus eigenem Polster und eigenem Zeilenkasten bekam. Die Höhe steht jetzt EINMAL, als
     * `.avm-klappbox-kopf` in `canon.css`; dieser Test hält fest, dass sie dort bleibt und dass beide klappbaren
     * Köpfe sie benutzen statt sie nachzubauen. Die Höhe selbst prüft `apps/web/e2e/klappbox-hoehe.spec.ts` am Bild.
     */
    it("🔴 `.avm-klappbox-kopf` steht nur in canon.css, und beide Klappbox-Köpfe benutzen sie", () => {
        const wurzel = join(repositoryRoot, "apps/web/src");
        const dateien = readdirSync(wurzel, { recursive: true, encoding: "utf8" })
            .filter((pfad) => /\.(vue|css)$/.test(pfad))
            .map((pfad) => `apps/web/src/${pfad.replace(/\\/g, "/")}`);
        const erklaert = dateien.filter((datei) =>
            codeZeilen(datei).some((zeile) => /^\s*\.avm-klappbox-kopf/.test(zeile)),
        );
        expect(erklaert).toEqual(["apps/web/src/styles/canon.css"]);
        for (const datei of ["apps/web/src/controls/avm-disclosure.vue", "apps/web/src/info-panel/info-lid.vue"]) {
            expect(readFileSync(join(repositoryRoot, datei), "utf8"), datei).toContain("avm-klappbox-kopf");
        }
    });

    /**
     * 🔴 Die Höhe ist ABGELEITET, nicht gesetzt: eine Symbolzeile (`icon.sm`) in gleichem Polster oben und unten
     * (`space.4`). Eine Zahl in `px` wäre die vierte Setzung derselben Höhe und würde beim nächsten Kanonwert
     * auseinanderlaufen.
     */
    it("🔴 die gemeinsame Kopfhöhe rechnet mit Kanonwerten, nicht mit einer eigenen Zahl", () => {
        const regel = readFileSync(join(repositoryRoot, "apps/web/src/styles/canon.css"), "utf8").match(
            /\.avm-klappbox-kopf \{([^}]*)\}/,
        );
        expect(regel?.[1]).toContain("min-height: calc(var(--icon-sm) + var(--space-4))");
        expect(regel?.[1]).toContain("box-sizing: border-box");
        expect((DESIGN_CANON.icon.sm ?? 0) + (DESIGN_CANON.space[4] ?? 0)).toBe(22);
    });

    it("die Klasse lässt den Unterlängen Platz und nimmt ihn im Fluss zurück", () => {
        const regel = readFileSync(join(repositoryRoot, "apps/web/src/app.vue"), "utf8").match(
            /\.einzeilig \{([^}]*)\}/,
        );
        expect(regel?.[1]).toContain("padding-bottom: var(--descender-room)");
        expect(regel?.[1]).toContain("margin-bottom: calc(-1 * var(--descender-room))");
        expect(DESIGN_CANON.typography.descenderRoom).toMatch(/em$/);
    });
});

describe("Das dunkle Thema (WI-0032, Guide §23)", () => {
    const hell = DESIGN_CANON.colour;
    const dunkel = DESIGN_CANON.colourDark ?? {};

    it("kennt nur Farben, die es hell auch gibt", () => {
        expect(Object.keys(dunkel).filter((name) => !(name in hell))).toEqual([]);
        const schatten = DESIGN_CANON.shadowDark ?? {};
        expect(Object.keys(schatten).filter((name) => !(name in DESIGN_CANON.shadow))).toEqual([]);
    });

    it("🔴 was auf der Karte liegt, hat keinen Dunkelwert - die Karte bleibt hell (§23.1)", () => {
        const karte = Object.keys(dunkel).filter((name) =>
            /^(marker|route|traveler|mapPaper|mapSelection|scrim|spotlight|loadingBar|theme)/.test(name),
        );
        expect(karte).toEqual([]);
    });

    it("die Flächen, Schriften und Knöpfe kippen alle mit", () => {
        for (const name of ["pageBg", "panel", "text", "textMuted", "border", "divider", "button", "link", "focus"]) {
            expect(dunkel[name], name).toBeDefined();
            expect(dunkel[name]).not.toBe(hell[name]);
        }
    });
});

describe("Kanon und CSS sind EINE Tafel", () => {
    /**
     * 💣 Die erzeugte Datei ist eingecheckt, damit der Bau reproduzierbar bleibt. Der Preis wäre,
     * dass sie veralten kann - dieser Test ist der Ersatz dafür: er erzeugt neu und vergleicht.
     */
    it("💣 canon.css ist der aktuelle Stand des Kanons", () => {
        const canon = JSON.parse(readFileSync(join(repositoryRoot, "config/design-canon/avesmaps.json"), "utf8"));
        const erzeugt = renderCanonCss(canon);
        const eingecheckt = readFileSync(join(repositoryRoot, "apps/web/src/styles/canon.css"), "utf8");
        expect(eingecheckt.replace(/\r\n/g, "\n")).toBe(erzeugt);
    });
});
