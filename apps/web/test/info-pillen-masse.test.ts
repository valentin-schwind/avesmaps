import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESIGN_CANON } from "@avesmaps3d/shared";

/**
 * Die Pillen im Kopf des Infopanels sind EINE Rezeptur (WI-0080 Nachtrag, Betreiber 2026-10-05: „kannst du eine weitere pille in lila
 * neben ‚offiziell/inoffiziell‘ mit den titel ‚Verborgen‘“), und ihre Mitte kommt aus der Hausregel, die alle Leisten teilen.
 *
 * 💣 Warum dieser Test: Es sind zwei Dateien, `info-canon-pill.vue` und `info-hidden-pill.vue`, und sie müssen gleich hoch sein und ihre
 * Schrift gleich setzen, sonst stehen zwei verschieden große Etiketten nebeneinander. Legacy hat gemessen, was ohne so eine Bindung
 * passiert: 13 Rezepturen für EINEN Schließknopf. Wer eines der Maße ändert, muss beide ändern - sonst wird hier rot, nicht erst am Bild.
 *
 * Die Mitte der Versalhöhe selbst misst der Browser (`e2e/leisten-mitte.spec.ts` und `e2e/info-panel-canon-pill.spec.ts`); hier steht
 * nur, dass beide Dateien dieselben Angaben dafür tragen und dass die Regel nicht ein drittes Mal abgeschrieben wurde.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const KANON_PILLE = "apps/web/src/info-panel/info-canon-pill.vue";
const VERBORGEN_PILLE = "apps/web/src/info-panel/info-hidden-pill.vue";
const CANON_CSS = "apps/web/src/styles/canon.css";

/** Die Angaben, die die Gestalt und die Maße einer Pille tragen - jede in beiden Dateien wortgleich. */
const MASSE = [
    "box-sizing: border-box",
    "height: var(--space-16)",
    "border: 1px solid transparent",
    "border-radius: var(--radius-lg)",
    "font-size: var(--font-size-kanon)",
    "letter-spacing: var(--letter-spacing-caps)",
    "line-height: 1",
    "text-transform: uppercase",
    "white-space: nowrap",
    "padding: 0 var(--space-6)",
    "font-weight: var(--font-weight-bold)",
    "font-synthesis-weight: auto",
];

const datei = (pfad: string): string => readFileSync(join(repositoryRoot, pfad), "utf8");

/** Die Zeilen ohne Kommentare: Ein Kommentar darf ein Maß nennen, er erklärt es ja (wie in `design-canon.test.ts`). */
function ohneKommentare(text: string): string {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((zeile) => zeile.replace(/\/\/.*$/, ""))
        .join("\n");
}

const codeZeilen = (pfad: string): string => ohneKommentare(datei(pfad));

describe("Die Pillen im Panelkopf: eine Rezeptur, zwei Dateien", () => {
    it("💣 beide Pillen tragen dieselben Maße und dieselbe Schriftsetzung", () => {
        const kanon = codeZeilen(KANON_PILLE);
        const verborgen = codeZeilen(VERBORGEN_PILLE);
        const fehlt = MASSE.filter((angabe) => !kanon.includes(angabe) || !verborgen.includes(angabe)).map(
            (angabe) =>
                `${angabe} (Kanon: ${String(kanon.includes(angabe))}, Verborgen: ${String(verborgen.includes(angabe))})`,
        );
        expect(fehlt).toEqual([]);
    });

    it("🔴 die Pille „Verborgen“ liest ihre Farbe aus dem Kanon, nicht aus einem Literal", () => {
        const verborgen = codeZeilen(VERBORGEN_PILLE);
        expect(verborgen).toContain("background: var(--color-pill-hidden)");
        expect(verborgen).toContain("color: var(--color-pill-hidden-text)");
        // Keine der beiden Kanonfarben: Die Pille sagt etwas anderes als Kanon.
        expect(verborgen).not.toContain("--color-kanon-");
    });

    it("🔴 der Wortlaut kommt aus der Sprachtafel, nicht als Literal im Bauteil", () => {
        expect(codeZeilen(VERBORGEN_PILLE)).toContain('t("infoPanel.hidden")');
    });
});

describe("Die Hausregel „Versalhöhe in der Mitte“ steht an EINER Stelle (Guide §3.2)", () => {
    /**
     * 💣 Dreimal verlangt (2026-09-25 Sprachschalter, 2026-10-04 Kanon-Pille, 2026-10-05 Abschnittskopf), dreimal einzeln repariert.
     * Seitdem ist es eine Regel: `.avm-versalmitte` in der erzeugten `canon.css`. Wer `text-box` in ein Bauteil schreibt, hat sie zum
     * vierten Mal - und dann laufen die Leisten wieder auseinander.
     */
    it("🔴 `text-box` steht nur in `canon.css`, nirgends in einem Bauteil", () => {
        const wurzel = join(repositoryRoot, "apps", "web", "src");
        const funde: string[] = [];
        const lauf = (verzeichnis: string): void => {
            for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
                const pfad = join(verzeichnis, eintrag.name);
                if (eintrag.isDirectory()) {
                    lauf(pfad);
                    continue;
                }
                if (!/[.](vue|css|ts)$/.test(eintrag.name)) continue;
                if (ohneKommentare(readFileSync(pfad, "utf8")).includes("text-box:")) {
                    funde.push(relative(repositoryRoot, pfad).split("\\").join("/"));
                }
            }
        };
        lauf(wurzel);
        expect(funde).toEqual([CANON_CSS]);
    });

    it("🔴 die Regel nennt ihren Grund und die drei Betreiberwünsche", () => {
        const css = datei(CANON_CSS);
        expect(css).toContain(".avm-versalmitte");
        expect(css).toContain("text-box: trim-both cap alphabetic");
        for (const beleg of ["2026-09-25", "2026-10-04", "2026-10-05"]) expect(css, beleg).toContain(beleg);
    });

    it("die Leisten und Pillen, die sie heute tragen", () => {
        // Eine Liste, kein Suchlauf: Wer eine Leiste neu baut, trägt sie hier ein und misst sie in `e2e/leisten-mitte.spec.ts`.
        for (const pfad of [
            "apps/web/src/controls/lang-toggle.vue",
            KANON_PILLE,
            VERBORGEN_PILLE,
            "apps/web/src/info-panel/info-section.vue",
            "apps/web/src/info-panel/info-lid.vue",
            "apps/web/src/info-panel/info-source-box.vue",
        ]) {
            expect(datei(pfad), pfad).toContain("avm-versalmitte");
        }
    });
});

/** WCAG-Kontrast zweier Farben (dieselbe Rechnung wie `climate-colours.test.ts`). */
function contrast(a: string, b: string): number {
    const luminance = (hex: string): number => {
        const [r, g, b2] = [1, 3, 5].map((at) => {
            const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
    };
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
    return (x + 0.05) / (y + 0.05);
}

describe("Der Lilaton der Pille „Verborgen“ (Kanon)", () => {
    const hell = DESIGN_CANON.colour as unknown as Record<string, string>;
    const dunkel = (DESIGN_CANON.colourDark ?? {}) as unknown as Record<string, string>;

    it("🔴 er trägt in BEIDEN Themen: Fläche gegen das Panel und Schrift gegen die Fläche", () => {
        // Die Pille ist Oberfläche, nicht Karte - also hat sie einen Dunkelwert (Guide §23.1).
        expect(dunkel["pillHidden"], "Dunkelwert der Fläche").toBeDefined();
        expect(dunkel["pillHiddenText"], "Dunkelwert der Schrift").toBeDefined();
        const faelle = [
            ["hell", hell["pillHidden"], hell["pillHiddenText"], hell["panel"]],
            ["dunkel", dunkel["pillHidden"], dunkel["pillHiddenText"], dunkel["panel"]],
        ] as const;
        for (const [thema, flaeche, schrift, panel] of faelle) {
            // 9 px Versalien: die Schrift steht deutlich über der 4,5:1 des Fließtexts.
            expect(
                contrast(flaeche as string, schrift as string),
                `${thema}: Schrift auf Fläche`,
            ).toBeGreaterThanOrEqual(4.5);
            // Die Fläche ist eine grafische Form und muss sich vom Panel abheben (3:1).
            expect(contrast(flaeche as string, panel as string), `${thema}: Fläche auf Panel`).toBeGreaterThanOrEqual(
                3,
            );
        }
    });

    it("⭐ er ist das Geschwister der beiden Kanon-Pillen, nicht lauter und nicht leiser", () => {
        // Gemessen 2026-10-05: hell 5,27 / 5,73 gegen Gold 4,79 / 4,93 und Blaugrün 5,83 / 6,18; dunkel 7,90 / 7,05 gegen
        // 9,26 / 8,08 und 7,24 / 6,83. Eine spätere Änderung, die aus der Pille das lauteste Etikett des Kopfes macht, fällt hier auf.
        for (const [thema, farben, panel] of [
            ["hell", hell, hell["panel"]],
            ["dunkel", dunkel, dunkel["panel"]],
        ] as const) {
            const gegenPanel = (name: string): number => contrast(farben[name] as string, panel as string);
            const lila = gegenPanel("pillHidden");
            const kanon = [gegenPanel("kanonOfficial"), gegenPanel("kanonUnofficial")];
            expect(lila, `${thema}: nicht leiser als die leisere Kanon-Pille`).toBeGreaterThanOrEqual(
                Math.min(...kanon) - 0.5,
            );
            expect(lila, `${thema}: nicht lauter als die lautere Kanon-Pille`).toBeLessThanOrEqual(
                Math.max(...kanon) + 0.5,
            );
        }
    });
});
