import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Die Hülle des Editor-Menüs (WI-0063 P9, Design Guide §18, §30): Was das Menü dem Besucher, der Karte und dem Entwurf schuldet,
 * steht hier als Prüftest, damit es nicht an Aufmerksamkeit hängt.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = join(repositoryRoot, "apps/web/src");
const directory = join(source, "editor-menu");
const read = (name: string): string => readFileSync(join(directory, name), "utf8");

/** Ein Quelltext ohne Kommentare: Ein Kommentar darf das Verbotene nennen, um es zu begründen. */
function withoutComments(text: string): string {
    return text
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCES = readdirSync(directory).filter((name) => /\.(vue|ts)$/.test(name));

/** Die `<style>`-Blöcke einer Vue-Datei, ohne Kommentare. */
function styleOf(name: string): string {
    const blocks = [...read(name).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "");
    return withoutComments(blocks.join("\n"));
}

describe("🔴 der Entwicklerschalter „Testaktionen“ existiert in Produktion nicht", () => {
    const text = (path: string): string => readFileSync(join(source, path), "utf8");

    it("sein Name steht in genau EINER Datei, und dort hinter `import.meta.env.DEV`", () => {
        const holders = readdirSync(source, { recursive: true, encoding: "utf8" })
            .map((path) => path.replace(/\\/g, "/"))
            .filter((path) => /\.(vue|ts)$/.test(path))
            .filter((path) => withoutComments(text(path)).includes("__avesmapsEditorActions"));
        expect(holders).toEqual(["editor-menu/dev-actions.ts"]);
        expect(withoutComments(text("editor-menu/dev-actions.ts"))).toMatch(
            /if \(import\.meta\.env\.DEV\) \{[\s\S]{0,120}__avesmapsEditorActions/,
        );
    });
});

describe("🔴 Besucher bekommen das Menü nicht - schon die Komponente fehlt", () => {
    const app = withoutComments(readFileSync(join(source, "app.vue"), "utf8"));

    it("`app.vue` hängt die Komponente nur an die Fähigkeit `use_editor_menu`", () => {
        expect(app).toMatch(/<EditorFloatingMenu\b[^>]*v-if="viewer\.can\('use_editor_menu'\)"/);
    });

    it("und der Controller prüft dieselbe Fähigkeit noch einmal, vor allem anderen", () => {
        expect(withoutComments(read("editor-menu.ts"))).toMatch(
            /function open\([^)]*\): boolean \{\s*if \(!viewer\.can\("use_editor_menu"\)\) return false;/,
        );
    });
});

describe("🔴 die Registry ist Daten: keine Kaskade über Arten, kein Schreibpfad", () => {
    it("keine `switch`-Anweisung in `editor-menu/`: Eine Art Subject steht nur in den Descriptors, nie in einer Bedingung des Menüs", () => {
        for (const name of SOURCES) {
            expect(withoutComments(read(name)), name).not.toMatch(/\bswitch\s*\(/);
        }
    });

    it("`app.vue` kennt keine Action: kein Descriptor, keine Aktionskennung, keine Art in der Verdrahtung des Menüs", () => {
        const app = withoutComments(readFileSync(join(source, "app.vue"), "utf8"));
        const wiring = app.slice(app.indexOf("const editorMenu = createEditorMenu"));
        const block = wiring.slice(0, wiring.indexOf("});") + 3);
        expect(block).not.toMatch(/kind\s*===|\bswitch\b|capability|\bkinds\b/);
    });

    it("kein Schreibpfad: Das Menü sendet nichts (Schreibaktionen bringt Phase 6 in ihren eigenen Modulen mit)", () => {
        for (const name of SOURCES) {
            const code = withoutComments(read(name));
            expect(code, name).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
            expect(code, name).not.toMatch(/\bfetch\s*\(/);
        }
    });
});

describe("🔴 die Komponente hält Guide §18 und §30 mechanisch", () => {
    const style = styleOf("editor-floating-menu.vue");
    const template = withoutComments(read("editor-floating-menu.vue").replace(/<script[\s\S]*?<\/script>/, ""));

    it("kein Farbliteral (Designkanon), kein `v-html`", () => {
        expect(withoutComments(read("editor-floating-menu.vue"))).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(withoutComments(read("editor-floating-menu.vue"))).not.toMatch(/v-html|innerHTML/);
    });

    it("§30.2: Deckkraft heißt „gesperrt“, nie „Hover“ - keine `opacity`; kein synthetisches Fett", () => {
        expect(style).not.toMatch(/\bopacity\s*:/);
        expect(style).not.toMatch(/font-weight:\s*(500|600|700|800|900|bold)/);
    });

    it("§30.5 Mindestliste: Hover, Aktiv, Fokus (`:focus-visible`, der Ring komponiert), Übergang, reduzierte Bewegung", () => {
        expect(style).toMatch(/:hover/);
        expect(style).toMatch(/:active/);
        expect(style).toMatch(/:focus-visible/);
        expect(style).toMatch(/box-shadow:\s*var\(--focus-ring/);
        expect(style).toMatch(/transition:/);
        expect(style).toMatch(/prefers-reduced-motion: reduce/);
    });

    it("§30.4: die Zeit ist 120 ms; keine vierte Dauer", () => {
        const durations = [...style.matchAll(/\b(\d+)ms\b/g)].map((match) => match[1]);
        expect(durations.filter((value) => !["120", "150", "220", "0"].includes(value ?? ""))).toEqual([]);
    });

    it("kein Maß als Literal: nur Haarlinien (1 px) und das Mindestmaß der Fläche stehen als Pixelzahl im Stil", () => {
        const literals = [...style.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px\b/g)].map((match) => match[1]);
        expect(literals.filter((value) => !["1", "180"].includes(value ?? ""))).toEqual([]);
    });

    it("jedes Bild trägt `alt`; die Zeilen sind Knöpfe in einem `menu`", () => {
        for (const tag of template.matchAll(/<img\b[^>]*>/g)) expect(tag[0]).toMatch(/\balt=|:alt=/);
        expect(template).toMatch(/role="menu"/);
        expect(template).toMatch(/role="menuitem"/);
        expect(template).toMatch(/<button\b/);
    });

    it("🔴 es meldet sich nicht als Rand und schreibt keine Zeigerform: Die Kamera zielt weiter in die ganze Fläche, der Cursor gehört dem Gewinner", () => {
        expect(template).not.toMatch(/data-map-overlay/);
        expect(style).not.toMatch(/\bcursor:\s*(?!pointer\b)\S/);
        expect(withoutComments(read("editor-floating-menu.vue"))).not.toMatch(/style\.cursor/);
    });

    it("es hört nicht selbst auf Escape: Die Kaskade ist die eine Stelle (`keyboard/escape-cascade.ts`)", () => {
        for (const name of SOURCES) {
            expect(withoutComments(read(name)), name).not.toMatch(/["']Escape["']|key\s*===\s*["']Esc/);
        }
    });
});
