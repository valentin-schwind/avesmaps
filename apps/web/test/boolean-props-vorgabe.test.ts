import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 🔴 EINE FEHLENDE BOOLEAN-PROP IST `false`, NIE `undefined`.
 *
 * Vue wandelt eine Prop vom Typ `boolean` (auch `boolean | undefined`), die der Aufrufer weglässt, in `false` um
 * (Boolean-Casting). Eine Prüfung wie `props.perLink === false` meint „ausdrücklich aus“ und trifft dann JEDEN Aufrufer,
 * der nichts angibt; `!== undefined` meint „angeboten“ und ist immer wahr. So stand es seit 2026-11-07 (WI-0287) an vier
 * Stellen still:
 *
 * - `quellen-anhaengen.vue`, `perLink`: Ein Link im Feld „＋ Quelle“ der Karteneditoren blieb eine Suche, „Kein Treffer.“
 *   statt Korpus und Titel (Vali 2026-11-09: „Die linkauflösung geht nicht, obwohl es ein korpus gibt“).
 * - `quellen-klappbox.vue`, `oeffnen`: Der Knopf „Quelle öffnen“ fehlte in allen Karteneditoren.
 * - `avm-bestaetigung.vue`, `fokus`: Der Fokus sprang nie auf „Abbrechen“.
 * - `fenster-modusleiste.vue` und `entwurf-leiste.vue`, `isoliert`: „Auswahl isolieren“ stand in jeder Entwurfsleiste.
 *
 * Wer eine andere Vorgabe meint, schreibt sie hin: `withDefaults(defineProps<…>(), { perLink: true })`, und wo `undefined`
 * etwas bedeutet („nicht angeboten“), `{ isoliert: undefined }` (dann bleibt die Prop ohne Angabe `undefined`). Dieser Test
 * findet die Prüfungen auf `false`, `undefined` und `??` an optionalen Boolean-Props ohne Vorgabe, dazu das Weiterreichen
 * einer solchen Prop an ein Kind, bei dem `undefined` etwas bedeutet (dort käme `false` an).
 *
 * ⭐ Die absichtlich falschen Proben („💣 …“) beweisen, dass der Test rot werden KANN.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const srcRoot = join(repositoryRoot, "apps", "web", "src");

interface BooleanProp {
    readonly name: string;
    /** Der Wert in `withDefaults`, als Quelltext; `undefined`, wenn es keinen gibt. */
    readonly vorgabe: string | undefined;
}

/** Der Block in geschweiften Klammern ab `start` (dort steht `{`), samt Klammern. */
function block(quelle: string, start: number): string {
    let tiefe = 0;
    for (let i = start; i < quelle.length; i++) {
        if (quelle[i] === "{") tiefe++;
        else if (quelle[i] === "}" && --tiefe === 0) return quelle.slice(start, i + 1);
    }
    return quelle.slice(start);
}

const ohneKommentare = (quelle: string): string =>
    quelle
        .replace(/<!--[\s\S]*?-->/gu, "")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/(^|[^:"'`])\/\/[^\n]*/gu, "$1");

const kebab = (name: string): string => name.replace(/[A-Z]/gu, (z) => `-${z.toLowerCase()}`);
const ohneSonderzeichen = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Die optionalen Boolean-Props einer Vue-Datei (`name?: boolean`, `name?: boolean | undefined`) mit ihrer Vorgabe. */
function booleanProps(quelle: string): { props: BooleanProp[]; typ: string } {
    const anfang = quelle.indexOf("defineProps<{");
    if (anfang < 0) return { props: [], typ: "" };
    const typ = block(quelle, anfang + "defineProps<".length);
    const nachTyp = anfang + "defineProps<".length + typ.length;
    const vorgaben = new Map<string, string>();
    if (/withDefaults\(\s*$/u.test(quelle.slice(Math.max(0, anfang - 40), anfang))) {
        const auf = quelle.indexOf("{", quelle.indexOf(",", nachTyp));
        const objekt = auf < 0 ? "" : block(quelle, auf);
        for (const treffer of objekt.matchAll(/(\w+)\s*:\s*([^,}\n]+)/gu))
            vorgaben.set(treffer[1] ?? "", (treffer[2] ?? "").trim());
    }
    const props = [
        ...ohneKommentare(typ).matchAll(
            /(?:^|[{;\n])\s*(\w+)\?\s*:\s*(?:boolean\s*\|\s*undefined|undefined\s*\|\s*boolean|boolean)\s*(?=[;}\n])/gu,
        ),
    ].map((treffer) => {
        const name = treffer[1] ?? "";
        return { name, vorgabe: vorgaben.get(name) };
    });
    return { props, typ };
}

/**
 * Die Stellen, die sich bei einer optionalen Boolean-Prop ohne Vorgabe auf `undefined` verlassen. `mitUndefinedVorgabe`: die Namen
 * der Props, die irgendwo ausdrücklich `undefined` als Vorgabe tragen (Weiterreichen an ein solches Kind).
 */
function funde(datei: string, quelle: string, mitUndefinedVorgabe: ReadonlySet<string>): string[] {
    const { props, typ } = booleanProps(quelle);
    const text = ohneKommentare(quelle.replace(typ, "{}"));
    const ergebnis: string[] = [];
    for (const { name, vorgabe } of props) {
        if (vorgabe !== undefined) continue;
        const n = ohneSonderzeichen(name);
        const zugriff = `(?:\\bprops\\.|(?<![.\\w$]))${n}\\b`;
        const muster: [string, RegExp][] = [
            ["Vergleich mit false/undefined", new RegExp(`${zugriff}\\s*[!=]==\\s*(?:false|undefined)\\b`, "u")],
            ["Vergleich mit false/undefined", new RegExp(`\\b(?:false|undefined)\\s*[!=]==\\s*${zugriff}`, "u")],
            ["?? (ist nie undefined)", new RegExp(`${zugriff}\\s*\\?\\?`, "u")],
        ];
        if (mitUndefinedVorgabe.has(name))
            muster.push([
                "an ein Kind gereicht, bei dem undefined etwas bedeutet (dort kommt false an)",
                new RegExp(`:(?:${n}|${ohneSonderzeichen(kebab(name))})="(?:props\\.)?${n}"`, "u"),
            ]);
        text.split("\n").forEach((zeile) => {
            for (const [grund, re] of muster)
                if (re.test(zeile)) ergebnis.push(`${datei} [${name}] ${grund}: ${zeile.trim()}`);
        });
    }
    return ergebnis;
}

function vueDateien(): { datei: string; quelle: string }[] {
    return readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
        .filter((pfad) => pfad.endsWith(".vue"))
        .map((pfad) => ({
            datei: relative(repositoryRoot, join(srcRoot, pfad)).replaceAll("\\", "/"),
            quelle: readFileSync(join(srcRoot, pfad), "utf8"),
        }));
}

function undefinedVorgaben(dateien: readonly { quelle: string }[]): Set<string> {
    const namen = new Set<string>();
    for (const { quelle } of dateien)
        for (const { name, vorgabe } of booleanProps(quelle).props) if (vorgabe === "undefined") namen.add(name);
    return namen;
}

describe("optionale Boolean-Props: ohne Angabe sind sie false", () => {
    it("keine Komponente verlässt sich auf undefined oder eine stille Vorgabe true", () => {
        const dateien = vueDateien();
        expect(dateien.length).toBeGreaterThan(100);
        const namen = undefinedVorgaben(dateien);
        expect(dateien.flatMap(({ datei, quelle }) => funde(datei, quelle, namen))).toEqual([]);
    });

    it("💣 eine Prüfung auf false ohne Vorgabe wird gefunden, mit Vorgabe nicht", () => {
        const falsch = `<script setup lang="ts">
const props = defineProps<{
    perLink?: boolean | undefined;
}>();
const an = props.perLink === false ? "" : "x";
</script>
<template><b v-if="perLink !== false">x</b></template>`;
        expect(funde("probe.vue", falsch, new Set())).toHaveLength(2);
        const richtig = falsch
            .replace("defineProps<{", "withDefaults(defineProps<{")
            .replace("}>();", "}>(), { perLink: true });");
        expect(funde("probe.vue", richtig, new Set())).toEqual([]);
    });

    it("💣 undefined als Bedeutung: Prüfung und Weiterreichen ohne Vorgabe werden gefunden", () => {
        const kind = `<script setup lang="ts">
withDefaults(defineProps<{ isoliert?: boolean | undefined }>(), { isoliert: undefined });
</script>`;
        const namen = undefinedVorgaben([{ quelle: kind }]);
        expect([...namen]).toEqual(["isoliert"]);
        const pruefen = `<script setup lang="ts">
defineProps<{ isoliert?: boolean | undefined }>();
</script>
<template><i v-if="isoliert !== undefined" /></template>`;
        expect(funde("pruefen.vue", pruefen, namen)).toHaveLength(1);
        const reichen = `<script setup lang="ts">
defineProps<{ isoliert?: boolean | undefined }>();
</script>
<template><Kind :isoliert="isoliert" /></template>`;
        expect(funde("reichen.vue", reichen, namen)).toHaveLength(1);
        expect(funde("reichen.vue", reichen, new Set())).toEqual([]);
        // Ein Feld eines anderen Objekts mit demselben Namen ist keine Prop.
        const fremd = pruefen.replace("isoliert !== undefined", "zug.isoliert !== undefined");
        expect(funde("fremd.vue", fremd, namen)).toEqual([]);
    });
});
