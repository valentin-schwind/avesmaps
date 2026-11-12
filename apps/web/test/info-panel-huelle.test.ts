import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PANEL_APPROVED_EXTRAS } from "@avesmaps3d/shared";
import { describe, expect, it } from "vitest";

/**
 * Die Hülle des Infopanels (WI-0063 P5, Design Guide §16, §17.2, AGENTS.md „Die Kamera“): Was das Panel der Karte, der Kamera
 * und dem Besucher schuldet, steht hier als Prüftest, damit es nicht an Aufmerksamkeit hängt.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const directory = join(repositoryRoot, "apps/web/src/info-panel");
const read = (name: string): string => readFileSync(join(directory, name), "utf8");

/** Ein Quelltext ohne Kommentare: Ein Kommentar darf das Verbotene nennen, um es zu begründen. */
function withoutComments(text: string): string {
    return text
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCES = readdirSync(directory).filter((name) => /\.(vue|ts)$/.test(name));

describe("💣 Ein Deckel IM Deckel: Vues Scoped CSS kennzeichnet nur den letzten Selektorteil", () => {
    /**
     * 🪤 **Gemessen am 2026-10-06 (WI-0091), und der nächste geschachtelte Deckel liefe sonst wieder hinein.** Vue hängt die
     * Kennung des Bauteils nur an den LETZTEN Teil eines Selektors: `.info-lid.is-open .info-lid__full[data-v-…]` ist ein
     * Nachfahrenselektor und trifft darum auch den Deckel IM Deckel - ein offener äußerer riss den inneren mit auf, obwohl
     * dessen Knopf `aria-expanded="false"` meldete. Beide sind dieselbe Komponente und teilen sich die Kennung.
     *
     * Der Fall, an dem es auffiel (der Deckel über „Aus der Region“), ist am 2026-10-07 wieder entfallen - die Regel bleibt.
     */
    it("`.info-lid.is-open` öffnet nur SEINEN eigenen Rumpf, nie den eines geschachtelten Deckels", () => {
        const lid = withoutComments(read("info-lid.vue"));
        for (const match of lid.matchAll(/\.info-lid\.is-open\s*([^{]*)\{/g)) {
            expect(
                match[1]?.trimStart().startsWith(">"),
                `Nachfahrenselektor: .info-lid.is-open${match[1] ?? ""}`,
            ).toBe(true);
        }
        // Und die Regel wird überhaupt geprüft: ohne Treffer wäre der Test eine leere Zusicherung.
        expect([...lid.matchAll(/\.info-lid\.is-open\s*>/g)].length).toBeGreaterThan(0);
    });
});

describe("🔴 die Hülle meldet sich als Rand und schließt unter `inert`", () => {
    const panel = withoutComments(read("info-panel.vue"));

    it('`data-map-overlay="right"`, sonst zielt die Kamera unter das Panel (docs/design/3d-navigation.md § 1a)', () => {
        expect(panel).toMatch(/data-map-overlay="right"/);
    });

    it("geschlossen oder eingeklappt ist es `inert`: Es zählt nicht als Rand und nimmt keinen Fokus", () => {
        expect(panel).toMatch(/:inert="!visible"/);
    });

    it("die Bewegung ist `transform`, nicht `right`, in 0,22 s `ease` (Guide §16); bei reduzierter Bewegung keine", () => {
        expect(panel).toMatch(/transition:\s*transform 220ms ease/);
        expect(panel).not.toMatch(/transition:[^;]*\bright\b/);
        expect(panel).toMatch(/prefers-reduced-motion: reduce/);
    });

    it("die Breite und das ✕ kommen aus dem Kanon, nicht als Zahl", () => {
        expect(panel).toContain("var(--avesmaps-infopanel-width)");
        expect(panel).toContain("var(--avesmaps-infopanel-close)");
        expect(panel).not.toMatch(/\b400px\b/);
        expect(panel).not.toMatch(/\b26px\b/);
    });

    it("die Randlasche ist die des Planers (Guide §17.2): dieselben Maße, kein eigener Satz", () => {
        expect(panel).toContain("var(--avesmaps-tab-w)");
        expect(panel).toContain("var(--avesmaps-tab-h)");
        expect(panel).toContain("var(--avesmaps-tab-top)");
    });
});

describe("Texte und Markup", () => {
    it("🔴 kein `v-html` und kein `innerHTML`: Der Server liefert keinen HTML-Text (WI-0063 11.4)", () => {
        for (const name of SOURCES) {
            expect(withoutComments(read(name)), name).not.toMatch(/v-html|innerHTML|insertAdjacentHTML/);
        }
    });

    it("🔴 kein Farbliteral in den Vue-Dateien des Panels (Designkanon)", () => {
        for (const name of SOURCES.filter((entry) => entry.endsWith(".vue"))) {
            expect(withoutComments(read(name)), name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        }
    });

    it("🔴 kein Floating Menu und kein Schreibpfad: Das Panel kennt nur Lesen (P9 und Phase 6 kommen später)", () => {
        expect(SOURCES.filter((name) => /floating|editor|write|mutation/i.test(name))).toEqual([]);
        for (const name of SOURCES) {
            expect(withoutComments(read(name)), name).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
        }
    });
});

/** Die `<style>`-Blöcke einer Vue-Datei, ohne Kommentare. */
function styleOf(name: string): string {
    const blocks = [...read(name).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "");
    return withoutComments(blocks.join("\n"));
}

const VUE = readdirSync(directory).filter((name) => name.endsWith(".vue"));

/** Das Praeludium einer Mediaabfrage ohne ihren Rumpf: `@media (max-width: 419px) {` wird zu `{`. */
const ohneMediaPrelude = (text: string): string => text.replace(/@media[^{]*\{/g, "{");

const ROT_SCHWELLE =
    "🔴 genau EINE Schwelle im Panel, und es ist die des Hauses (419 px) - eine Mediaabfrage kann keine Kanonvariable lesen";

/**
 * 🔴 Die EINE Ausnahme von §30.2 und §30.4 in diesem Panel: das Einblenden des eintreffenden Inhalts (WI-0088 P1).
 *
 * Guide §30.8 „Erscheinen und Verschwinden“: **Bewegt erscheint nur, was von selbst kommt und von selbst geht.** Toast und
 * Kartenschild tun das mit reiner Deckkraft in 140 ms `ease` - und der Inhalt des Panels kommt ebenso ungefragt, nämlich über
 * das Netz. Erlaubt ist darum GENAU das: ein `@keyframes …-arrive`, das bei `opacity: 0` beginnt, und eine Animation von
 * 140 ms damit. Eine **ruhende** Deckkraft bleibt verboten; sie hieße in diesem Haus „gesperrt“ (§30.2). Die Ausnahme ist
 * unten eigens festgenagelt, damit sie nicht zum Einfallstor wird.
 */
const arrivalKeyframes = (): RegExp => /@keyframes\s+[\w-]*arrive\s*\{[\s\S]*?\n\}/g;
const arrivalAnimation = (): RegExp => /animation:\s*[\w-]*arrive\s+140ms\s+ease;/g;
const withoutArrival = (style: string): string => style.replace(arrivalKeyframes(), "").replace(arrivalAnimation(), "");

describe("🔴 die Bausteine halten Guide §16 und §30 mechanisch (WI-0063 P6)", () => {
    it("§30.2: Deckkraft heißt „gesperrt“, nie „Hover“ - keine einzige ruhende `opacity` in den Bausteinen", () => {
        for (const name of VUE) {
            expect(withoutArrival(styleOf(name)), name).not.toMatch(/\bopacity\s*:/);
        }
    });

    it("🔴 §30.8: die Einblendung ist die einzige Deckkraft - sie beginnt bei 0, endet bei voller und schaltet sich ab", () => {
        const withFade = VUE.filter((name) => arrivalKeyframes().test(styleOf(name)));
        // Eine Liste, kein Suchlauf: Wer eine vierte Einblendung baut, trägt sie hier ein und begründet sie.
        expect(withFade.sort()).toEqual(["info-catalog.vue", "info-content.vue", "info-header.vue"]);
        for (const name of withFade) {
            const style = styleOf(name);
            for (const block of style.match(arrivalKeyframes()) ?? []) {
                // Nur `from`, nur Deckkraft: Ohne `to` endet die Bewegung beim eigenen Wert des Elements, also bei voller Deckkraft.
                expect(block, name).toMatch(/from\s*\{\s*opacity:\s*0;?\s*\}/);
                expect(block.match(/opacity\s*:/g) ?? [], name).toHaveLength(1);
                expect(block, name).not.toMatch(/\bto\s*\{/);
            }
            // §30.6: Bei reduzierter Bewegung bleibt nur der fertige Inhalt.
            expect(style, name).toMatch(/prefers-reduced-motion: reduce/);
            expect(style, name).toMatch(/animation: none;/);
        }
    });

    it("kein synthetisches Fett: Betonung trägt die Farbe, nicht das Gewicht", () => {
        for (const name of VUE) {
            expect(styleOf(name), name).not.toMatch(/font-weight:\s*(500|600|700|800|900|bold)/);
        }
    });

    it("kein Maß als Literal: nur Haarlinien (1 px, 2 px) und der Rückfall des Fokusrings (3 px) stehen als Pixelzahl im Stil", () => {
        for (const name of VUE) {
            const literals = [...ohneMediaPrelude(styleOf(name)).matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g)].map(
                (match) => match[1],
            );
            expect(
                literals.filter((value) => !["1", "2", "3"].includes(value ?? "")),
                name,
            ).toEqual([]);
        }
    });

    /**
     * 🪐 **Eine Mediaabfrage kann KEINE Kanonvariable lesen** - `@media (max-width: var(--x))` gibt es in CSS nicht.
     * Die Schwelle muss dort als Zahl stehen; die Regel oben schneidet die Praeludien deshalb heraus. Damit daraus
     * keine zweite Wertetabelle wird, gilt: 🔴 **im ganzen Infopanel genau EINE Schwelle**, und es ist die, die das
     * Haus schon fuehrt (419 px, `controls/map-fan.vue`). Eine zweite braucht eine Betreiberentscheidung.
     */
    it(ROT_SCHWELLE, () => {
        const schwellen = new Set<string>();
        for (const name of VUE) {
            for (const treffer of styleOf(name).matchAll(/@media[^{]*?\(\s*max-width:\s*([\d.]+)px\s*\)/g)) {
                schwellen.add(treffer[1] ?? "");
            }
        }
        expect([...schwellen].sort()).toEqual(schwellen.size === 0 ? [] : ["419"]);
    });

    it("§30.5 Mindestliste: wo etwas anklickbar ist, stehen Hover, Fokus (`:focus-visible`, komponiert) und ein Übergang daneben", () => {
        const clickable = VUE.filter((name) => /cursor:\s*pointer/.test(styleOf(name)));
        expect(clickable.length).toBeGreaterThan(6);
        for (const name of clickable) {
            const style = styleOf(name);
            expect(style, `${name}: Hover`).toMatch(/:hover/);
            expect(style, `${name}: Fokus`).toMatch(/:focus-visible/);
            expect(style, `${name}: Fokusring mit eigenem Schatten komponiert, nie der Browserring`).toMatch(
                /var\(--focus-ring/,
            );
            expect(style, `${name}: Übergang`).toMatch(/transition:/);
            expect(style, `${name}: reduzierte Bewegung`).toMatch(/prefers-reduced-motion: reduce/);
        }
    });

    it("§30.4: die Zeit ist 120 ms (Flächen), 150 ms (Aufklappen) oder 220 ms (Panel) - keine vierte Dauer", () => {
        for (const name of VUE) {
            // Die 140 ms der Einblendung sind oben eigens geprüft (§30.8); hier zählt alles andere.
            const durations = [...withoutArrival(styleOf(name)).matchAll(/\b(\d+)ms\b/g)].map((match) => match[1]);
            expect(
                durations.filter((value) => !["120", "150", "220", "0"].includes(value ?? "")),
                name,
            ).toEqual([]);
        }
    });

    it('jedes Bild trägt `alt` (Inhaltsbilder `alt=""` oder einen Text)', () => {
        for (const name of VUE) {
            for (const tag of withoutComments(read(name)).matchAll(/<img\b[^>]*>/g)) {
                expect(tag[0], name).toMatch(/\balt=|:alt=/);
            }
        }
    });
});

describe("🔴 der Entwicklerschalter „alle Zusatzfelder“ existiert in Produktion nicht", () => {
    const source = (name: string): string => readFileSync(join(repositoryRoot, "apps/web/src", name), "utf8");

    it("sein Name steht in genau EINER Datei, und dort hinter `import.meta.env.DEV`", () => {
        const holders = readdirSync(join(repositoryRoot, "apps/web/src"), { recursive: true, encoding: "utf8" })
            .map((path) => path.replace(/\\/g, "/"))
            .filter((path) => /\.(vue|ts)$/.test(path))
            .filter((path) => withoutComments(source(path)).includes("__avesmapsPanelExtras"));
        expect(holders).toEqual(["info-panel/panel-extras.ts"]);
        expect(withoutComments(source("info-panel/panel-extras.ts"))).toMatch(
            /if \(import\.meta\.env\.DEV\) \{[\s\S]{0,120}__avesmapsPanelExtras/,
        );
    });

    it("ohne den Schalter und für jeden Besucher gilt die Freigabe; „wie Legacy“ bleibt leer", async () => {
        const { currentPanelMode, panelRules } = await import("../src/info-panel/panel-extras.ts");
        expect(currentPanelMode()).toBe("approved");
        expect(panelRules("approved").approved).toBe(PANEL_APPROVED_EXTRAS);
        expect(panelRules("legacy").approved.place.fields).toEqual([]);
    });
});
