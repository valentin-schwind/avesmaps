import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 JEDES FENSTER IST DIE HÜLLE (WI-0045, Design Guide §12.6).
 *
 * Der Betreiber, wörtlich: „mein problem ist, dass du beim bauen neuer fenster dir jedesmal neue dinge
 * überlegst was - wie bei avesmaps legacy - dazu führt, dass wir z.b. 1000 htmls dafür hinter uns
 * herschleppen.“ Legacy hatte am Ende 13 Rezepturen für EINEN Schließknopf.
 *
 * Dieser Test hält die Regel mechanisch fest, damit sie nicht an Aufmerksamkeit hängt: Ein Fenster
 * entsteht nur als `<AvmFenster>` (`src/fenster/avm-fenster.vue`). Wer ein `<dialog>`, ein
 * `role="dialog"`, ein `aria-modal`, `showModal()`, einen eigenen Schleier (`::backdrop`,
 * `--color-scrim-dialog`) oder den Fensterschatten (`--shadow-dialog`) außerhalb der Hülle schreibt,
 * bekommt diesen Test rot - und eine zweite HTML-Datei ebenso.
 *
 * ⭐ Eine absichtlich falsche Probe steht mit im Test („💣 …“): Sie beweist, dass der Test rot werden
 * KANN. Ein Wächter, der nie anschlägt, sieht genauso aus wie einer, der nichts prüft.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const webRoot = join(repositoryRoot, "apps", "web");
const HUELLE = "apps/web/src/fenster/avm-fenster.vue";

/**
 * Was kein Fenster ist oder noch keins sein darf - benannt und begründet. Ein Eintrag, dessen Datei
 * nichts mehr auffällig macht, wird rot („veraltet“): Wer ein Fenster auf die Hülle umbaut, streicht
 * es hier.
 */
const AUSNAHMEN: Readonly<Record<string, string>> = {
    "apps/web/src/search/spotlight-search.vue":
        "Die Suche ist kein Fenster, sondern eine eigene Bauart (Guide §14): heller Schleier mit Weichzeichner, am Finger unten an der Lupe.",
    "apps/web/src/controls/avm-bildansicht.vue":
        "Die Bildansicht ist kein Fenster, sondern eine eigene Bauart (Guide §13.46, Betreiber 2026-10-11): ein Bild auf fast deckendem Grund über den ganzen Schirm, ohne Kopf, Rumpf und Fuß.",
};

type Block = "vorlage" | "skript" | "stil";

/** Woran man ein Fenster erkennt - je Block einer Vue-Datei. */
const MERKMALE: Readonly<Record<Block, readonly [string, RegExp][]>> = {
    vorlage: [
        ["<dialog>", /<dialog\b/],
        ['role="dialog"', /\brole\s*=\s*["'](?:alert)?dialog["']/],
        ["aria-modal", /\baria-modal\b/],
    ],
    skript: [
        ["showModal()", /\.showModal\s*\(/],
        ['createElement("dialog")', /createElement\(\s*["']dialog["']\s*\)/],
        ['role = "dialog"', /["']role["']\s*,\s*["'](?:alert)?dialog["']/],
    ],
    // Nach der VERWENDUNG gesucht (`var(…)`), nicht nach dem Namen: `canon.css` definiert die Tokens nur.
    stil: [
        ["::backdrop", /::backdrop/],
        ["var(--color-scrim-dialog)", /var\(\s*--color-scrim-dialog\b/],
        ["var(--shadow-dialog)", /var\(\s*--shadow-dialog\b/],
        [".avm-fenster (Hüllenregel)", /\.avm-fenster\b/],
    ],
};

/** Die Blöcke einer Vue-Datei, ohne Kommentare - ein Kommentar darf das Verbotene nennen, um es zu begründen. */
function bloecke(inhalt: string): Record<Block, string> {
    const teile: Record<Block, string[]> = { vorlage: [], skript: [], stil: [] };
    let aktuell: Block | null = null;
    for (const zeile of inhalt.split("\n")) {
        const auf = /^<(template|script|style)\b/.exec(zeile);
        if (auf) {
            aktuell = auf[1] === "template" ? "vorlage" : auf[1] === "script" ? "skript" : "stil";
            continue;
        }
        if (/^<\/(template|script|style)>/.test(zeile)) {
            aktuell = null;
            continue;
        }
        if (aktuell) teile[aktuell].push(zeile);
    }
    return {
        vorlage: teile.vorlage.join("\n").replace(/<!--[\s\S]*?-->/g, ""),
        skript: teile.skript
            .join("\n")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1"),
        stil: teile.stil.join("\n").replace(/\/\*[\s\S]*?\*\//g, ""),
    };
}

/** Die Merkmale eines Fensters in einer Datei - `[]` heißt: kein eigenes Fenster darin. */
function fensterMerkmale(datei: string, inhalt: string): string[] {
    if (datei.endsWith(".vue")) {
        const teile = bloecke(inhalt);
        return (Object.keys(MERKMALE) as Block[]).flatMap((block) =>
            MERKMALE[block].filter(([, muster]) => muster.test(teile[block])).map(([name]) => name),
        );
    }
    const code = inhalt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (datei.endsWith(".css")) return MERKMALE.stil.filter(([, muster]) => muster.test(code)).map(([name]) => name);
    if (datei.endsWith(".html")) {
        return MERKMALE.vorlage
            .filter(([, muster]) => muster.test(inhalt.replace(/<!--[\s\S]*?-->/g, "")))
            .map(([n]) => n);
    }
    return MERKMALE.skript.filter(([, muster]) => muster.test(code)).map(([name]) => name);
}

function dateien(wurzel: string, endungen: RegExp): string[] {
    return (
        readdirSync(wurzel, { recursive: true, encoding: "utf8" })
            // `dist*`, nicht `dist`: Ein Wegwerf-Build neben dem echten (`dist-jetzt`, `dist-vorher`) ist beim Vergleichen normal,
            // und seine Dateien sind keine Quellen. Vorher zählte der Haken „keine zweite HTML-Datei“ sie mit und wurde rot, sobald
            // jemand einen Vergleichsbuild liegen ließ (gemessen 2026-10-12).
            .filter((pfad) => endungen.test(pfad) && !/(^|[\\/])(node_modules|dist[^\\/]*)[\\/]/.test(pfad))
            .map((pfad) => relative(repositoryRoot, join(wurzel, pfad)).replace(/\\/g, "/"))
            .sort()
    );
}

const QUELLEN = [...dateien(join(webRoot, "src"), /\.(vue|ts|css)$/), "apps/web/index.html"];

function funde(): Record<string, string[]> {
    return Object.fromEntries(
        QUELLEN.map((datei) => [datei, fensterMerkmale(datei, readFileSync(join(repositoryRoot, datei), "utf8"))]),
    );
}

describe("🔴 Jedes Fenster ist die Hülle (Guide §12.6)", () => {
    it("🔴 kein eigenes Fenster außerhalb von src/fenster/avm-fenster.vue", () => {
        const verstoesse = Object.entries(funde())
            .filter(([datei, merkmale]) => merkmale.length > 0 && datei !== HUELLE && !(datei in AUSNAHMEN))
            .map(
                ([datei, merkmale]) =>
                    `${datei}: ${merkmale.join(", ")} - baue das Fenster als <AvmFenster> (Guide §12.6)`,
            );
        expect(verstoesse).toEqual([]);
    });

    it("die Hülle selbst trägt, was sie allen abnimmt", () => {
        expect(funde()[HUELLE]).toEqual(
            expect.arrayContaining([
                "<dialog>",
                "showModal()",
                "::backdrop",
                "var(--color-scrim-dialog)",
                "var(--shadow-dialog)",
            ]),
        );
    });

    it("jede Ausnahme ist begründet, existiert und ist noch nötig - sonst gehört sie gestrichen", () => {
        const alle = funde();
        for (const [datei, grund] of Object.entries(AUSNAHMEN)) {
            expect(grund.length, datei).toBeGreaterThan(20);
            expect(alle[datei], `${datei} gibt es nicht mehr - Ausnahme streichen`).toBeDefined();
            expect(alle[datei], `${datei} ist kein eigenes Fenster mehr - Ausnahme streichen`).not.toEqual([]);
        }
    });

    it("💣 eine absichtlich falsche Probe wird rot", () => {
        const falsch = {
            "eigenes <dialog>": "<template>\n    <dialog open><h2>Titel</h2></dialog>\n</template>\n",
            'role="dialog"':
                '<template>\n    <div class="kasten" role="dialog" aria-modal="true"></div>\n</template>\n',
            "eigener Schleier": "<template>\n    <div />\n</template>\n<style scoped>\n.x::backdrop {\n}\n</style>\n",
            "Fensterschatten abgeschrieben":
                "<template>\n    <div />\n</template>\n<style>\n.box {\n    box-shadow: var(--shadow-dialog);\n}\n</style>\n",
            "showModal im Skript": '<script setup lang="ts">\nel.value?.showModal();\n</script>\n',
            "Hüllenregel kopiert": "<style>\n.avm-fenster {\n    border-radius: 3px;\n}\n</style>\n",
        };
        for (const [name, inhalt] of Object.entries(falsch)) {
            expect(fensterMerkmale("apps/web/src/probe/falsch.vue", inhalt), name).not.toEqual([]);
        }
        expect(fensterMerkmale("apps/web/src/probe/falsch.ts", 'const d = document.createElement("dialog");')).toEqual([
            'createElement("dialog")',
        ]);
    });

    it("… und ein richtig gebautes Fenster bleibt grün, auch wenn ein Kommentar das Verbotene nennt", () => {
        const richtig = [
            '<script setup lang="ts">',
            "// Kein eigenes <dialog>: die Hülle macht showModal() und den ::backdrop.",
            "</script>",
            "<template>",
            '    <!-- role="dialog" steht in der Hülle -->',
            '    <AvmFenster v-model:offen="offen" bauart="blatt" breite="tafel" :titel="t(\'x\')">',
            "        <FensterText :text=\"t('y')\" />",
            "    </AvmFenster>",
            "</template>",
        ].join("\n");
        expect(fensterMerkmale("apps/web/src/probe/richtig-fenster.vue", richtig)).toEqual([]);
        // Ein Selektor, der nach offenen Fenstern FRAGT, baut keins (keyboard/install-keyboard.ts).
        expect(
            fensterMerkmale("apps/web/src/probe/tasten.ts", `document.querySelector('dialog[open], [role="dialog"]');`),
        ).toEqual([]);
    });

    it("🔴 keine zweite HTML-Datei - ein Fenster ist ein Bauteil in der Seite, keine Seite", () => {
        // Die Statusseite ist eine SEITE, kein Fenster: Betreiber 2026-10-04 (JOBS-0001 D5 C, „alles wie empfohlen“): Etappe 1
        // baut die Seite für den Betreiber, das Fenster für Editoren kommt mit Etappe 3 als Bauteil in der Karte.
        expect(dateien(webRoot, /\.html$/)).toEqual(["apps/web/index.html", "apps/web/status.html"]);
    });

    it("ein abgebrochenes Dateifeld schließt das Fenster nicht (OPS-000011)", () => {
        // `cancel` eines <input type="file"> steigt bis zum <dialog> auf; nur das eigene `cancel` ist Escape.
        const quelle = readFileSync(join(repositoryRoot, HUELLE), "utf8");
        const abbrechen = /function abbrechen\(event: Event\): void \{([\s\S]*?)\n\}/.exec(quelle)?.[1] ?? "";
        expect(abbrechen.trimStart()).toMatch(/^if \(event\.target !== event\.currentTarget\) return;/);
    });

    it("ein Fenster heißt <name>-fenster.vue, damit man es findet", () => {
        const nutzer = QUELLEN.filter(
            (datei) =>
                datei.endsWith(".vue") && readFileSync(join(repositoryRoot, datei), "utf8").includes("<AvmFenster"),
        );
        expect(nutzer.length).toBeGreaterThan(0);
        expect(nutzer.filter((datei) => !datei.endsWith("-fenster.vue"))).toEqual([]);
    });
});

describe("Die Hülle und ihre Bausteine nehmen nur Kanonwerte (Guide §12.6)", () => {
    const canon = JSON.parse(readFileSync(join(repositoryRoot, "config/design-canon/avesmaps.json"), "utf8")) as {
        colour: Record<string, string>;
        colourDark: Record<string, string>;
        fenster: { breite: Record<string, number>; spalte: number };
    };
    const huelle = readFileSync(join(repositoryRoot, HUELLE), "utf8");

    it("sieben Teile und die Leiste, zwei Bauarten (§12.1, §12.2)", () => {
        // 🔴 Die Leiste (`__leiste`) kam mit WI-0118: Filter und Sortierung einer Liste stehen wie Kopf und Fuß, nur der Rumpf rollt.
        // Die Reiter (`__reiter`) kamen mit WI-0120 A10: Ein Fenster, dessen Reiter lange Listen tragen, lässt sie stehen.
        // Die Schiene (`__schiene` in `__mitte`, rechts daneben `__spalte`) kam mit WI-0127 SYS-1 (Guide §13.12).
        for (const teil of [
            "kopf",
            "griff",
            "titel",
            "zusatz",
            "kopffeld",
            "reiter",
            "leiste",
            "mitte",
            "schiene",
            "spalte",
            "rumpf",
            "fuss",
        ]) {
            expect(huelle, teil).toContain(`avm-fenster__${teil}`);
        }
        // 🔴 Am Telefon legt die Hülle die Schiene an den Anfang der Leiste (Blatt WI-0119 A4), die Ansicht entscheidet das nicht.
        expect(huelle).toContain('<slot v-if="schieneInLeiste" name="schiene" :telefon="true" />');
        expect(huelle).toContain('<slot name="schiene" :telefon="false" />');
        expect(huelle).toContain('bauart: "blatt" | "werkzeug"');
        expect(huelle).toContain(".avm-fenster--werkzeug");
        expect(huelle).toContain("avm-fenster__knopf--nackt");
        expect(huelle).toContain("avm-fenster__knopf--gefasst");
    });

    it("die Breiten der Hülle sind genau die benannten Breiten des Kanons", () => {
        const typ = /breite:\s*((?:"[a-z]+"\s*\|?\s*)+);/.exec(huelle)?.[1] ?? "";
        const namen = [...typ.matchAll(/"([a-z]+)"/g)].map((treffer) => treffer[1]).sort();
        expect(namen).toEqual(Object.keys(canon.fenster.breite).sort());
        expect(canon.fenster.spalte).toBeGreaterThan(0);
    });

    /**
     * Der Rumpf aus Spalten (WI-0068 P3, Guide §12.6 „Ein Rumpf aus Spalten“): Die Hülle stellt die Kinder nebeneinander, polstert und
     * rollt nicht selbst; jede `FensterSpalte` rollt für sich und nimmt ihre Breite aus dem Kanon. Ein Fenster baut das nie selbst.
     */
    it("🔴 der Rumpf aus Spalten steht in der Hülle, die Spalte ist ein Baustein mit Kanonbreiten", () => {
        expect(huelle).toContain('rumpf?: "rollt" | "spalten" | undefined;');
        expect(huelle).toContain(".avm-fenster__rumpf--spalten");
        expect(huelle).toContain("'avm-fenster--reiter': slots.reiter || slots.schiene || spalten");
        const spalte = readFileSync(join(repositoryRoot, "apps/web/src/fenster/fenster-spalte.vue"), "utf8");
        expect(spalte).toContain('breite: "facetten" | "schiene" | "fuellen" | "inspektor";');
        expect(spalte).toContain("var(--avm-fenster-facetten)");
        // Eine Spalte, die eine Schiene trägt, ist so breit wie die Schiene (Betreiber 2026-10-11, Guide §13.12).
        expect(spalte).toContain("var(--avm-fenster-schiene)");
        expect(spalte).toContain("var(--avm-fenster-inspektor)");
        const kanon = canon.fenster as unknown as { spalten: { facetten: number; inspektor: number }; kachel: number };
        expect(kanon.spalten.facetten).toBeGreaterThan(0);
        expect(kanon.spalten.inspektor).toBeGreaterThan(0);
        // Wer Spalten will, nimmt die Hülle: kein Fenster legt sich eine eigene Spaltenreihe mit Rollbalken an.
        const fenster = QUELLEN.filter((datei) => datei.endsWith("-fenster.vue"));
        const mitSpalten = fenster.filter((datei) =>
            readFileSync(join(repositoryRoot, datei), "utf8").includes("<FensterSpalte"),
        );
        for (const datei of mitSpalten) {
            expect(readFileSync(join(repositoryRoot, datei), "utf8"), datei).toContain('rumpf="spalten"');
        }
    });

    /**
     * Die Fenster der Besucher (WI-0268 C2, Bedienkonzept §1.3): ohne Ablage (kein −) und nur so hoch wie der Inhalt (Betreiber 2026-10-31). Beides ist ein
     * Angebot der Hülle, das ein Fenster einschaltet; ohne die Props bleibt jedes Fenster der Editoren, wie es war: angedockt in voller Höhe, mit −.
     */
    it("🔴 ohne Ablage und nur so hoch wie der Inhalt: zwei Angebote der Hülle, die kein Editorfenster einschaltet", () => {
        expect(huelle).toContain("ohneAblage?: boolean | undefined;");
        expect(huelle).toContain('hoehe?: "inhalt" | undefined;');
        expect(huelle).toContain('v-if="!props.ohneAblage"');
        expect(huelle).toContain("'avm-fenster--inhalt': props.hoehe === 'inhalt' && !modal");
        // Nur gelöst: Angedockt steht jedes Fenster von oben bis unten ohne Spalt am Panel (Betreiber 2026-10-31), auch mit der Prop.
        expect(huelle).toContain(".avm-fenster.avm-fenster--geloest.avm-fenster--inhalt {");
        expect(huelle).not.toContain(".avm-fenster.avm-fenster--angedockt.avm-fenster--inhalt {");
        // Die Fenster der Redaktion (WI-0268 C3 der Vorgang, WI-0269 C10 die Bewertung, WI-0270 C11 der Beitrag, WI-0268 C6a die Neue Mail): mit Ablage, siehe unten.
        const REDAKTIONSFENSTER = [
            "apps/web/src/community/bewertung-redaktion-fenster.vue",
            // Der Kartenvorschlag der Redaktion (WI-0275): ein Vorgang mit Eingabe (Blatt, Grund), darum mit Ablage und angedockt links unten.
            "apps/web/src/community/kartenvorschlag-redaktion-fenster.vue",
            "apps/web/src/community/neue-mail-fenster.vue",
            "apps/web/src/community/social-fenster.vue",
            "apps/web/src/community/vorgang-fenster.vue",
        ];
        // Die Fenster der Besucher (Meldeformular, Statusseite, Kontakt, Bewertung schreiben und melden): ohne Ablage, nur so hoch wie der Inhalt, gelöst und mittig
        // (Betreiber 2026-10-31: „im frontend standardmäßig abgedockt … und zentriert, erst der ‚andocken‘ dockt es an“).
        const eigene = QUELLEN.filter(
            (datei) =>
                datei.startsWith("apps/web/src/community/") &&
                datei.endsWith("-fenster.vue") &&
                !REDAKTIONSFENSTER.includes(datei),
        );
        expect(eigene.length).toBeGreaterThanOrEqual(2);
        for (const datei of eigene) {
            const inhalt = readFileSync(join(repositoryRoot, datei), "utf8");
            expect(inhalt, datei).toContain("ohne-ablage");
            expect(inhalt, datei).toContain('hoehe="inhalt"');
            expect(inhalt, datei).toContain('vorgabe-ecke="mitte"');
        }
        // Die Fenster der Reisebilder (WI-0272 S2b, `photobox/`): ebenfalls Besucherfenster, ohne Ablage und nur so hoch wie der Inhalt, am Telefon das Blatt unten (`telefon-blatt`). Ihre
        // Vorgabe-Ecke kommt vom Wirt (mittig, im Wählmodus oben in der Mitte), steht also nicht fest im Fenster.
        const reisebilder = QUELLEN.filter(
            (datei) => datei.startsWith("apps/web/src/photobox/") && datei.endsWith("-fenster.vue"),
        );
        expect(reisebilder.length).toBeGreaterThanOrEqual(1);
        for (const datei of reisebilder) {
            const inhalt = readFileSync(join(repositoryRoot, datei), "utf8");
            expect(inhalt, datei).toContain("ohne-ablage");
            expect(inhalt, datei).toContain('hoehe="inhalt"');
            expect(inhalt, datei).toContain("telefon-blatt");
            expect(inhalt, datei).toContain(":vorgabe-ecke=");
        }
        // Das Blatt am Telefon und die Seiten gegenüber der Stelle sind Angebote der Hülle: Ohne die Props bleibt jedes Fenster, wie es war.
        expect(huelle).toContain("telefonBlatt?: boolean | undefined;");
        expect(huelle).toContain(".avm-fenster.avm-fenster--angedockt.avm-fenster--blatt {");
        expect(huelle).toContain(".avm-fenster.avm-fenster--geloest.avm-fenster--oben-mitte {");
        // Die Seiten gegenüber der Stelle (`oben-links`, `oben-rechts`) gibt es nicht mehr: Das Fenster der Reisebilder steht immer in der Mitte (Entwurf 8).
        expect(huelle).not.toContain("avm-fenster--oben-links");
        expect(huelle).not.toContain("avm-fenster--oben-rechts");
        // Das Fenster der Redaktion (WI-0268 C3, Bedienkonzept §1.3: jedes Fenster des Moduls ist nur so hoch wie sein Inhalt) ist ebenfalls so hoch wie der Inhalt, hat aber eine Ablage
        // unter „Offene Bearbeitungen“: Der Vorgang trägt eine Eingabe, die nicht verloren gehen darf.
        const redaktion = QUELLEN.filter((datei) => REDAKTIONSFENSTER.includes(datei));
        expect([...redaktion].sort()).toEqual(REDAKTIONSFENSTER);
        for (const datei of redaktion) {
            const inhalt = readFileSync(join(repositoryRoot, datei), "utf8");
            expect(inhalt, datei).not.toContain("ohne-ablage");
            expect(inhalt, datei).toContain('hoehe="inhalt"');
            expect(inhalt, datei).toContain('vorgabe-ecke="links-unten"');
        }
        for (const datei of QUELLEN.filter(
            (d) =>
                d.endsWith("-fenster.vue") &&
                d !== HUELLE &&
                !d.startsWith("apps/web/src/community/") &&
                !d.startsWith("apps/web/src/photobox/"),
        )) {
            const inhalt = readFileSync(join(repositoryRoot, datei), "utf8");
            expect(inhalt, datei).not.toContain('hoehe="inhalt"');
        }
    });

    /**
     * 🔴 Die stabile Höhe (WI-0272, Entwurf 8; Betreiber 2026-11-01: „die abmessungen des dialogs müssen stabil bleiben sonst verschwindet der upload button unten“) ist ein Angebot der Hülle: Das
     * Fenster misst seine Höhe je Ansicht einmal und hält sie, der Rumpf rollt, der Fuß bleibt. Kein Fenster der Editoren schaltet es ein, und nur die Hülle misst und setzt die Höhe.
     */
    it("🔴 `stabil` misst die Höhe je Ansicht einmal und ist ein Angebot der Hülle, das nur die Fenster der Reisebilder einschalten (Formular und „Meine Reisebilder“)", () => {
        expect(huelle).toContain("stabil?: boolean | undefined;");
        expect(huelle).toContain("ansicht?: string | undefined;");
        expect(huelle).toContain("ansichtNieHoeher?: boolean | undefined;");
        expect(huelle).toContain('props.stabil === true && props.hoehe === "inhalt" && lage.value === "geloest"');
        // Gelöst und ohne gezogene Box: Angedockt steht jedes Fenster von oben bis unten, und wer zieht, bestimmt die Größe selbst.
        expect(huelle).toContain("haeltHoehe && festeHoehe !== undefined && !sichtBox && !props.eingeklappt");
        // Der Wechsel der Ansicht misst neu; die Höhe der vorigen Ansicht ist der Deckel, wo das verlangt ist.
        expect(huelle).toContain("() => props.ansicht");
        expect(huelle).toContain("neueAnsicht && props.ansichtNieHoeher === true ? vorher : undefined");
        expect(huelle).toContain("stabileHoehe(");
        // Eine neue Ansicht beginnt oben im Rumpf (er ist derselbe wie in der vorigen und behielte sonst ihren Rollstand).
        expect(huelle).toContain('.querySelector(".avm-fenster__rumpf")?.scrollTo({ top: 0 })');
        const stabile = QUELLEN.filter(
            (datei) =>
                datei.endsWith(".vue") && readFileSync(join(repositoryRoot, datei), "utf8").match(/^\s+stabil$/mu),
        );
        expect(stabile).toEqual([
            // Das Meldeformular der Besucher im Stil der Upload-Formulare (WI-0279): die Höhe bleibt beim Ausfüllen stehen.
            "apps/web/src/community/meldung-fenster.vue",
            "apps/web/src/photobox/meine-reisebilder-fenster.vue",
            "apps/web/src/photobox/reisebild-fenster.vue",
        ]);
    });

    it("🔴 die Hülle kennt die Unterzeile im Kopf und den freien Fuß, beides Angebote ohne Wirkung auf jedes andere Fenster", () => {
        expect(huelle).toContain("unterzeile?: string | undefined;");
        expect(huelle).toContain("'avm-fenster__kopf--gross': props.unterzeile !== undefined");
        expect(huelle).toContain("fuss?(): unknown;");
        expect(huelle).toContain("'avm-fenster__fuss--frei': Boolean(slots.fuss)");
        // Wo kein Fenster die Angebote nutzt, bleibt der Kopf, wie er war: nur die Fenster der Reisebilder und „Karte vorschlagen“ tragen eine Unterzeile (das Formular und „Meine Reisebilder“, Entwurf 9).
        const mitUnterzeile = QUELLEN.filter(
            (datei) =>
                datei !== HUELLE &&
                datei.endsWith(".vue") &&
                // `FensterSpalte` hat eine eigene `unterzeile` (Spaltenkopf); gemeint ist die der Hülle, also in einem Fenster.
                /<AvmFenster[^>]*:unterzeile=/u.test(
                    readFileSync(join(repositoryRoot, datei), "utf8").replaceAll("=>", "=&gt;"),
                ),
        );
        expect(mitUnterzeile).toEqual([
            // Das Kontaktformular im Ton der Reisebilder (WI-0268, Betreiber 2026-11-04: Besucherformulare einladend, groß, ruhig).
            "apps/web/src/community/kontakt-fenster.vue",
            // Das Meldeformular im Stil der Upload-Formulare (WI-0279, Betreiber 2026-11-11).
            "apps/web/src/community/meldung-fenster.vue",
            "apps/web/src/kartenvorschlag/kartenvorschlag-fenster.vue",
            "apps/web/src/photobox/meine-reisebilder-fenster.vue",
            "apps/web/src/photobox/reisebild-fenster.vue",
        ]);
    });

    /**
     * 🔴 Maße und Farben kommen aus dem Kanon. Pixel stehen nur als LINIENSTÄRKE da - die Haarlinie
     * (1 px, Guide §5) und die Fuge der Tempotafel (2 px, §17.9); dafür hat der Kanon keine Sprosse.
     */
    it("🔴 kein Farb- oder Maßliteral in der Hülle, den Bausteinen und den Fenstern", () => {
        const pruefen = QUELLEN.filter(
            (datei) =>
                datei.endsWith(".vue") && (datei.startsWith("apps/web/src/fenster/") || datei.endsWith("-fenster.vue")),
        );
        expect(pruefen.length).toBeGreaterThan(5);
        const verstoesse: string[] = [];
        for (const datei of pruefen) {
            // Der Rückfall am Fokusring ist das alte Muster des Hauses; seit WI-0120 A8 steht `--focus-ring` im Kanon, und der
            // Rückfall ist Altlast, die nie mehr greift. Neue Bauteile schreiben `var(--focus-ring)` ohne ihn.
            const stil = bloecke(readFileSync(join(repositoryRoot, datei), "utf8")).stil.replace(
                /var\(--focus-ring, 0 0 0 3px var\(--color-focus\)\)/g,
                "",
            );
            for (const zeile of stil.split("\n")) {
                const linie = (
                    /^\s*border(-(top|right|bottom|left))?\s*:/.test(zeile) ? zeile.replace(/\b[12]px\b/, "") : zeile
                )
                    // 🪤 `0px` ist kein Maß, sondern die Null, und in jeder Einheit dieselbe: der Boden in `max(0px, …)` und
                    // der `initial-value` einer registrierten Eigenschaft (WI-0128 P1) treffen keine Gestaltungsentscheidung.
                    .replace(/\b0px\b/g, "");
                if (/#[0-9a-fA-F]{3,8}\b|rgba?\(|\b\d+(\.\d+)?px\b/.test(linie))
                    verstoesse.push(`${datei}: ${zeile.trim()}`);
            }
        }
        expect(verstoesse).toEqual([]);
    });

    it("die Tempo-Ampel kippt ins Dunkle mit, der Schleier nicht (§17.9, §12.4, §23.1)", () => {
        for (const stufe of ["Fast", "Mid", "Slow"]) {
            for (const teil of ["Bg", "Text"]) {
                const name = `tier${stufe}${teil}`;
                expect(canon.colour[name], name).toBeDefined();
                expect(canon.colourDark[name], name).toBeDefined();
                expect(canon.colourDark[name]).not.toBe(canon.colour[name]);
            }
        }
        expect(canon.colour["scrimDialog"]).toBeDefined();
        expect(canon.colourDark["scrimDialog"]).toBeUndefined();
    });
});
