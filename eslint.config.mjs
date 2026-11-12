import js from "@eslint/js";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";

export default tseslint.config(
    {
        // `.claude/worktrees`: Arbeitsbäume paralleler Sitzungen, je ein eigener Checkout.
        // `review/` ist unversionierter Arbeitsplatz für Mockups und Wegwerfskripte (.gitignore).
        // `project-control/mockups/` sind die versionierten Quellen abgenommener Blätter (WI-0119 P2): von Hand gestartete
        // Zeichenskripte für Browser und Node, kein Produktcode, und so bytegleich wie bei der Abnahme gehalten.
        // `project-control/discovery/d-regionale-erosion/`, `wi-0223-grobe-stufe/`, `wi-0227-erosion/` und `wi-0229-gebietsableitung/`:
        // versionierte Messskripte eines Berichts (Prototyp D, WI-0223 §3, WI-0227 §5, WI-0229 S0 bis S2), von Hand gestartet, kein
        // Produktcode; aus demselben Grund ausgenommen.
        // `dist*`, nicht `dist`: Ein Wegwerf-Build neben dem echten (`dist-jetzt`, `dist-vorher`) ist beim Vergleichen normal,
        // und sein gebündeltes JavaScript ist keine Quelle. Ungeprüft machte es `npm run lint` für JEDE Sitzung rot (7.450
        // Meldungen aus fünf Bündeln, gemessen 2026-10-13); derselbe Grund wie in `apps/web/test/fenster-huelle.test.ts`.
        ignores: [
            "**/dist*/**",
            "**/node_modules/**",
            "**/coverage/**",
            ".claude/worktrees/**",
            "review/**",
            "project-control/mockups/**",
            "project-control/discovery/d-regionale-erosion/**",
            "project-control/discovery/wi-0223-grobe-stufe/**",
            "project-control/discovery/wi-0227-erosion/**",
            "project-control/discovery/wi-0229-gebietsableitung/**",
            // Messwerkzeuge des Wetters (WI-0288): Playwright-Skripte, deren Rümpfe im Browser laufen, wie die Erosions-Messungen oben.
            "project-control/discovery/wi-0288-wetter-messung/**",
            // Wetter-Icons aus dem Wiki (WI-0288): Lese- und Erzeugungsskripte für einen vorbereiteten Import, von Hand gestartet.
            "project-control/discovery/wi-0288-wetter-icons-aus-wiki/**",
        ],
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    ...vue.configs["flat/recommended"],
    {
        files: ["**/*.vue"],
        languageOptions: {
            parserOptions: {
                parser: tseslint.parser,
            },
        },
    },
    {
        // TypeScript resolves identifiers itself, so no-undef would only duplicate the compiler
        // and get browser and Node globals wrong on top of that (typescript-eslint recommends off).
        files: ["**/*.ts", "**/*.vue"],
        rules: { "no-undef": "off" },
    },
    {
        // Plain JavaScript tooling scripts run on Node. Some of them drive a browser and carry
        // code that is executed inside the page, so both vocabularies are in scope here.
        // `ops/` gehoert Claudio (Linux, VPS), wird hier aber mitgeprueft: ein Repository mit einem
        // Gate, das die Haelfte des Codes nicht sieht, meldet gruen und meint nichts.
        files: ["scripts/**/*.mjs", "ops/**/*.mjs", "tools/**/*.mjs"],
        languageOptions: {
            globals: {
                console: "readonly",
                process: "readonly",
                URL: "readonly",
                Buffer: "readonly",
                atob: "readonly",
                document: "readonly",
                FontFace: "readonly",
                Uint8Array: "readonly",
                globalThis: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                clearTimeout: "readonly",
            },
        },
    },
    {
        rules: {
            // Chapter 2.16: errors must not be swallowed and dependencies stay explicit.
            "no-console": ["error", { allow: ["warn", "error"] }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/explicit-module-boundary-types": "error",
            "@typescript-eslint/no-floating-promises": "off",
        },
    },
    {
        // Last, so it wins over the general rule above: a build script reports its progress on
        // stdout - that is its interface, not a leftover debug print.
        files: ["scripts/**/*.mjs", "ops/**/*.mjs", "tools/**/*.mjs"],
        rules: {
            "no-console": ["error", { allow: ["log", "warn", "error"] }],
            // Eine Regel, die Typannotationen verlangt, ist in einer `.mjs` nicht erfuellbar - dort
            // gibt es keine Syntax dafuer. Sie hier laufen zu lassen erzeugt nur Rauschen, das
            // echte Funde verdeckt.
            "@typescript-eslint/explicit-module-boundary-types": "off",
        },
    },
    {
        // Dieselbe Begruendung wie oben, eine Ebene tiefer: die `*-cli.ts` unter `apps/server` SIND
        // Kommandozeilenwerkzeuge. Was sie auf stdout schreiben, ist ihr Ergebnis - der Betreiber
        // liest es, und `derive:*` / `verify:*` haengen daran.
        //
        // 💣 Ohne diese Ausnahme meldete `npm run lint` dauerhaft 30 Fehler in Dateien, an denen
        // nichts falsch war. Ein Gate, das immer rot ist, pruefen zu duerfen heisst, es nicht mehr
        // zu lesen - und dann faellt der echte Fund daneben nicht mehr auf.
        files: ["apps/*/src/**/*-cli.ts", "scripts/**/*-cli.ts"],
        rules: {
            "no-console": ["error", { allow: ["log", "warn", "error"] }],
        },
    },
    prettier,
);
