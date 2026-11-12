import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_INPUT_TABLES, PIPELINE_STEPS } from "../src/migration/pipeline-steps.ts";

/**
 * M5c (Hardening Review 2026-09-28): reiner Textabgleich, führt KEIN Bash aus - der Betreiberauftrag
 * für den ganzen Review war "keine allgemeine Refactoring-Kampagne", und ein Shell-Interpreter im
 * Testlauf wäre eine neue Abhängigkeit, keine kleine. Vier Prüfungen:
 *
 * 1. Abhängigkeiten ohne Zyklus: jede in `pipeline-steps.ts` gelesene Tabelle wurde entweder von einem
 *    FRÜHEREN Schritt geschrieben oder steht in `LEGACY_INPUT_TABLES` (Tabellen direkt aus den
 *    Legacy-Snapshot-Dateien, ohne pipeline-interne Vorstufe).
 * 2. Fachlich harte Kanten (Anhang E des Befunds): I2→I3; I2→I10→I11→I12→I13; I5→I6→I7; I5→I11;
 *    {I1,I2,I4}→I9; I14→I15 (WI-0062); I16→I3 (WI-0064: die Nummer folgt der Einfuehrung, die Tafel steht vor I3). I13 gibt es noch nicht (kommt mit WI-0055) - eine Kante zu einem noch fehlenden
 *    Schritt ist keine Verletzung, sie aktiviert sich von selbst, sobald `pipeline-steps.ts` ihn bekommt.
 * 3. Die CLI (`legacy-update-cli.ts`) nimmt IDs/Labels ausschließlich über `step("Ix")` aus
 *    `pipeline-steps.ts` (M5b) - die Folge dieser Aufrufe im Quelltext muss `PIPELINE_STEPS` entsprechen.
 * 4. `ops/deploy/staging-import.sh`, NUR die Funktion `do_import()` (der doppelte Marker
 *    "I6 Zweiter Durchlauf" in `idempotence()` liegt bewusst außerhalb und wird hier nicht gelesen -
 *    ihn umzubenennen ist ein Auftrag an Claudio, nicht dieser Test): die `step "Ix "`-Folge muss
 *    `PIPELINE_STEPS` entsprechen (nur die Schritte ohne `stagePending` - ein Schritt, der den
 *    Stage-Korridor noch nicht erreicht hat, fehlt dort legitim). Je Schritt ruft `do_import()` eine
 *    Wrapper-Funktion (`importer_*`/`derive_*`/`terrain_*`/`relief_*`) NAMENTLICH auf; deren eigene
 *    Definition (irgendwo im selben Skript, nicht auf `do_import()` beschränkt - sie by Namen
 *    aufzulösen ist kein Bash-Ausführen, nur Text zu Text) muss `dist/<stageCli>.js` mit jedem
 *    Pflichtargument aus `stageFlags` aufrufen.
 */

const SERVER_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(SERVER_ROOT, "..", "..");
const cliSource = readFileSync(resolve(SERVER_ROOT, "src", "migration", "legacy-update-cli.ts"), "utf8");
const stagingScript = readFileSync(resolve(REPO_ROOT, "ops", "deploy", "staging-import.sh"), "utf8");

/**
 * Kommentare weg (`#` am Zeilenanfang oder nach Leerraum bis zum Zeilenende): Sonst zählt ein Schalter, der nur
 * im Kommentar über dem Aufruf steht, als vorhanden (Befund Claudio 2026-09-29, `--expose-gc` bei I12/I13).
 * `$#` und `${#x}` bleiben stehen, denn dort steht vor dem `#` kein Leerraum.
 */
export function stripBashComments(text: string): string {
    return text.replace(/(^|[ \t])#[^\n]*/gm, "$1");
}

/** Text zu Text: der Körper einer bash-Funktion, definiert als `name() {`, bis zur nächsten Top-Level-Funktion. */
function bashFunctionBody(source: string, name: string): string {
    const start = new RegExp(`^${name}\\(\\)\\s*\\{`, "m").exec(source);
    if (!start) throw new Error(`Bash-Funktion ${name} nicht gefunden`);
    const rest = source.slice(start.index + start[0].length);
    const next = /^[a-zA-Z_][a-zA-Z0-9_]*\(\)\s*\{/m.exec(rest);
    return stripBashComments(next ? rest.slice(0, next.index) : rest);
}

describe("stripBashComments", () => {
    it("nimmt Kommentarzeilen und Kommentare am Zeilenende, nicht aber $# oder ${#x}", () => {
        const text = "  # nutzt --expose-gc\n  run node a.js # --expose-gc\n  echo $# ${#liste}\n";
        const stripped = stripBashComments(text);
        expect(stripped).not.toContain("--expose-gc");
        expect(stripped).toContain("run node a.js");
        expect(stripped).toContain("$# ${#liste}");
    });
});

describe("Abhaengigkeiten ohne Zyklus", () => {
    it("jede gelesene Tabelle wurde von einem frueheren Schritt geschrieben oder ist eine Legacy-Eingabe", () => {
        const writtenSoFar = new Set<string>(LEGACY_INPUT_TABLES);
        const violations: string[] = [];
        for (const step of PIPELINE_STEPS) {
            for (const table of step.reads) {
                if (!writtenSoFar.has(table)) {
                    violations.push(`${step.id} (${step.label}) liest "${table}", das kein frueherer Schritt schreibt`);
                }
            }
            for (const table of step.writes) writtenSoFar.add(table);
        }
        expect(violations).toEqual([]);
    });
});

const HARD_EDGES: readonly [string, string][] = [
    ["I2", "I3"],
    ["I2", "I10"],
    ["I10", "I11"],
    ["I11", "I12"],
    ["I12", "I13"],
    ["I5", "I6"],
    ["I6", "I7"],
    ["I5", "I11"],
    ["I1", "I9"],
    ["I2", "I9"],
    ["I4", "I9"],
    ["I14", "I15"],
    // WI-0064: die Schriftlaeufe fallen auf die Darstellungstafel zurueck, sie muss also VOR ihnen stehen.
    ["I16", "I3"],
    // WI-0063 P3 (Vertraege subject-details.yaml und sources.yaml): D6 haengt an den Traegern (Orte, Regionen samt Beschriftungen,
    // Wege, Kraftlinien, Gelaende-Eingaben); D1 steht nach D6 und nach den Herrschaftsgebieten.
    ["I1", "I17"],
    ["I2", "I17"],
    ["I5", "I17"],
    ["I8", "I17"],
    ["I10", "I17"],
    ["I17", "I18"],
    ["I14", "I18"],
    // WI-0055 (Migration 0067): die Landflaechen werden aus den Flaechen und Regionen von I2 abgeleitet; seit WI-0077
    // (Migration 0072) auch die Klimabaender aus den Teilern von I4.
    ["I2", "I19"],
    ["I4", "I19"],
    // WI-0063 P3 (Vertraege literature.yaml und citymaps.yaml): die Ortsbezuege loesen gegen die Traeger auf (Orte I1, Regionen I2, Wege I5,
    // Gelaende-Eingaben I10, Herrschaftsgebiete I14) und ueber die Wiki-Zuordnung von D6 (I17); die Kartensammlung nimmt ausserdem den
    // Quellenkatalog von D1 (I18). Spielliteratur und Kartensammlung sind voneinander unabhaengig.
    ["I1", "I20"],
    ["I2", "I20"],
    ["I5", "I20"],
    ["I10", "I20"],
    ["I14", "I20"],
    ["I17", "I20"],
    ["I18", "I20"],
    ["I1", "I21"],
    ["I2", "I21"],
    ["I5", "I21"],
    ["I10", "I21"],
    ["I14", "I21"],
    ["I17", "I21"],
    ["I18", "I21"],
    // WI-0063 P3 (Vertraege reviews.yaml und territory-details.yaml): die Bewertungen loesen ihren Ort gegen aktive `place`-Zeilen auf
    // (I1); die Gebietsdetails haengen an den Zeilen der Herrschaftsgebiete (I14) und lesen dieselbe Datei. Beide sind voneinander und von
    // D6, D1, D3 und D2 unabhaengig.
    ["I1", "I22"],
    ["I14", "I23"],
    // WI-0063 P3 (Vertrag lore.yaml): die Ortszeilen der Lore loesen ueber DENSELBEN Lookup nach Wiki-Key auf wie die Objektlinks, gespeist aus der
    // Zuordnung X2 (I24); der Lookup liest die Traeger (Orte I1, Regionen I2 samt Beschriftungen, Wege I5, Kraftlinien I8, Gelaende-Eingaben I10,
    // Herrschaftsgebiete I14 mit ihren abgeleiteten Formen I15); die Quellen der Verknuepfungen haengen am Katalog von D1 (I18). Lore, Spielliteratur
    // und Kartensammlung sind voneinander unabhaengig.
    ["I1", "I25"],
    ["I2", "I25"],
    ["I5", "I25"],
    ["I8", "I25"],
    ["I10", "I25"],
    ["I14", "I25"],
    ["I15", "I25"],
    ["I18", "I25"],
    ["I24", "I25"],
    // WI-0063 MEDIA-M8 (Vertrag media.yaml): die Medien binden an Orte (I1), Gebiete (I14), Werke (I20) und Karten (I21) ueber die
    // Legacy-Kennung; die Fachobjekte muessen also vorher stehen.
    ["I1", "I26"],
    ["I14", "I26"],
    ["I20", "I26"],
    ["I21", "I26"],
];

describe("Fachlich harte Kanten (Anhang E)", () => {
    const order = new Map(PIPELINE_STEPS.map((step, index) => [step.id, index]));
    it.each(HARD_EDGES)("%s vor %s", (before, after) => {
        if (!order.has(before) || !order.has(after)) return; // z. B. I13: kommt erst mit WI-0055
        expect(order.get(before)).toBeLessThan(order.get(after) as number);
    });
});

describe("Reihenfolge in legacy-update-cli.ts", () => {
    it('record()-Aufrufe nehmen id/label ueber step("Ix") aus pipeline-steps.ts, in dessen Reihenfolge', () => {
        const calls = [...cliSource.matchAll(/step\("(I\d+)"\)/g)].map((match) => match[1] as string);
        const sequence: string[] = [];
        for (const id of calls) {
            if (sequence[sequence.length - 1] !== id) sequence.push(id);
        }
        expect(sequence).toEqual(PIPELINE_STEPS.map((step) => step.id));
    });
});

/**
 * Die neun Schritte, die mit Claudios Branch `claudio/korridor-i17-i26` in den Stage-Korridor gekommen sind
 * (Merge 2026-10-06; I19 stand schon vorher darin). Sie tragen seither KEIN `stagePending` mehr - und genau das
 * hält die Markerprobe unten zusammen: ohne diese Liste könnte ein wieder eingetragenes `stagePending` einen
 * Schritt still aus `stageSteps` nehmen, der Marker dürfte dann fehlen, und der Schnitt wäre unbemerkt verloren.
 * Sie ist der Nachfolger der Zusicherung `expect(step?.stagePending).toContain("I24")` aus WI-0063 27.12.
 */
const CORRIDOR_SINCE_2026_10_06 = ["I17", "I18", "I20", "I21", "I22", "I23", "I24", "I25", "I26"] as const;

describe("ops/deploy/staging-import.sh, nur do_import()", () => {
    const doImportBody = bashFunctionBody(stagingScript, "do_import");
    const stepMarkers = [...doImportBody.matchAll(/step\s+"(I\d+)\s/g)].map((match) => match[1] as string);
    const stageSteps = PIPELINE_STEPS.filter((step) => step.stagePending === undefined);

    it('die step "Ix "-Folge entspricht PIPELINE_STEPS (nur die bereits im Stage-Korridor angekommenen Schritte)', () => {
        expect(stepMarkers).toEqual(stageSteps.map((step) => step.id));
    });

    it("I17, I18 und I20 bis I26 stehen im Korridor: kein stagePending und je ein Marker in do_import()", () => {
        const pending = PIPELINE_STEPS.filter(
            (step) =>
                (CORRIDOR_SINCE_2026_10_06 as readonly string[]).includes(step.id) && step.stagePending !== undefined,
        ).map((step) => step.id);
        expect(pending).toEqual([]);
        for (const id of CORRIDOR_SINCE_2026_10_06) {
            expect(stepMarkers, `Marker fuer ${id} fehlt in do_import()`).toContain(id);
        }
    });

    it.each(stageSteps)("$id ruft dist/$stageCli.js mit allen Pflichtargumenten auf", (step) => {
        const marker = new RegExp(`step\\s+"${step.id}\\s[^"]*"`).exec(doImportBody);
        expect(marker, `Marker fuer ${step.id} nicht gefunden`).not.toBeNull();
        const afterMarker = doImportBody.slice(
            (marker as RegExpExecArray).index + (marker as RegExpExecArray)[0].length,
        );
        const nextMarkerAt = afterMarker.search(/step\s+"I\d+\s/);
        const block = nextMarkerAt < 0 ? afterMarker : afterMarker.slice(0, nextMarkerAt);
        // Der Aufruf einer Wrapper-Funktion sieht aus wie "importer_places 1" oder "importer_powerlines probe ...".
        const wrapperCall = /\b([a-z][a-z0-9_]*)\s+(?:probe\b|\d)/.exec(block);
        expect(
            wrapperCall,
            `Aufruf einer Wrapper-Funktion fuer ${step.id} nicht gefunden in:\n${block}`,
        ).not.toBeNull();
        const wrapperBody = bashFunctionBody(stagingScript, (wrapperCall as RegExpExecArray)[1] as string);
        expect(wrapperBody).toContain(`apps/server/dist/${step.stageCli}.js`);
        for (const flag of step.stageFlags) {
            expect(wrapperBody, `Pflichtargument ${flag} fehlt bei ${step.id}`).toContain(flag);
        }
    });
});

describe("I24 Wiki-Linkziele und Zuordnung (WI-0063 27.12)", () => {
    const step = PIPELINE_STEPS.find((candidate) => candidate.id === "I24");
    const migration = readFileSync(resolve(SERVER_ROOT, "migrations", "0073_wiki_link_targets.sql"), "utf8");

    it("steht hinter D3, D2, den Bewertungen und den Gebietsdetails (I20 bis I23) und unmittelbar vor der Lore (I25, die über seinen Lookup auflöst), und ist mit den acht anderen im Stage-Korridor angekommen", () => {
        expect(step).toBeDefined();
        const order = PIPELINE_STEPS.map((candidate) => candidate.id);
        // Die tragende Aussage ist die Nachbarschaft I24 -> I25 (die Lore löst über den Lookup aus X2 auf), nicht, wer am Ende
        // steht: seit MEDIA-M8 war I26 der letzte Schritt, seit WI-0109 (Stätten) ist es I27. 🪤 Darum steht hier nur, dass I24
        // NICHT der letzte ist - wer am Ende steht, wandert mit jedem neuen Schritt und ist keine Zusicherung über I24.
        expect(order.at(-1)).not.toBe("I24");
        expect(order.indexOf("I25")).toBe(order.indexOf("I24") + 1);
        expect(order.indexOf("I24")).toBeGreaterThan(order.indexOf("I23"));
        // Vor dem Merge von `claudio/korridor-i17-i26` stand hier `expect(step?.stagePending).toContain("I24")`.
        // Seit dem Schnitt (2026-10-06) ist die Zusicherung umgedreht; dass es für alle NEUN Schritte dieses Merges
        // gilt und sie wirklich einen Marker in `do_import()` haben, verlangt der Fall „I17, I18 und I20 bis I26
        // stehen im Korridor" oben (`CORRIDOR_SINCE_2026_10_06`) - hier bleibt die Aussage über I24 selbst.
        expect(step?.stagePending).toBeUndefined();
        expect(step?.gate).toBe("0073_wiki_link_targets");
    });

    it("schreibt genau die Tabellen, die Migration 0073 anlegt, und liest keine Trägertabelle (der Leser löst Legacys Kennung zur Laufzeit auf)", () => {
        const created = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1] as string);
        expect([...(step?.writes ?? [])].sort()).toEqual([...created].sort());
        expect(step?.reads).toEqual([]);
    });

    it("🔴 die zwei Abrufe stehen nur im Zweig mit Zuruf: ohne `--operator-said` holt der Zug nichts, und beide gehen durch EINE Funktion", () => {
        // Dieselbe Funktion holt seit WI-0128 E4 auch X3 (I28, eigener Fall unten); hier zählen die zwei Abrufe von I24.
        const calls = [...cliSource.matchAll(/await fetchWikiExport\(\s*"legacy-wiki-(?:linkziele|zuordnung)\.json"/g)];
        expect(calls).toHaveLength(2);
        const apply = cliSource.indexOf("const catalogs: Catalogs = {");
        expect(apply).toBeGreaterThan(0);
        for (const call of calls) expect(call.index).toBeGreaterThan(apply);
        // Der Zweig mit dem Zuruf beginnt mit dem Aufzeichnen des Zuges.
        expect(cliSource.indexOf("await recorder.start(")).toBeLessThan(apply);
    });

    it("🔴 der Prüfer wird erst im Zug geladen: als Import am Kopf machte er das bloße Laden der Datei langsamer, als ihr Wächtertest erlaubt", () => {
        expect(cliSource).not.toMatch(/^import .* from "\.\/verify-wiki-link-targets\.ts";$/m);
        expect(cliSource).toContain('await import("./verify-wiki-link-targets.ts")');
    });
});

describe("I28 Wiki-Siedlungsregistry (WI-0128 E4, X3)", () => {
    const step = PIPELINE_STEPS.find((candidate) => candidate.id === "I28");
    const migration = readFileSync(resolve(SERVER_ROOT, "migrations", "0089_wiki_settlement_registry.sql"), "utf8");
    // WI-0134: die Linkziele der Standortkette stehen in Migration 0099, als Kind der Registry.
    const linkMigration = readFileSync(resolve(SERVER_ROOT, "migrations", "0099_site_identities.sql"), "utf8");

    it("steht hinter I24 (der Leser fragt über die Zuordnung X2), hinter der Migration 0089 und noch nicht im Stage-Korridor", () => {
        const order = PIPELINE_STEPS.map((candidate) => candidate.id);
        expect(order.indexOf("I28")).toBeGreaterThan(order.indexOf("I24"));
        expect(step?.gate).toBe("0089_wiki_settlement_registry");
        expect(step?.stagePending).toContain("I28");
    });

    it("schreibt genau die Tabelle der Migration 0089 samt ihrer Linkziele aus 0099 und liest keine: platziert oder nicht entscheidet der Leser zur Laufzeit", () => {
        const created = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1] as string);
        const links = [...linkMigration.matchAll(/CREATE TABLE IF NOT EXISTS (wiki_settlement_registry_\w+)/g)].map(
            (match) => match[1] as string,
        );
        expect(links).toEqual(["wiki_settlement_registry_named_place"]);
        expect([...(step?.writes ?? [])].sort()).toEqual([...created, ...links].sort());
        expect(step?.reads).toEqual([]);
    });

    it("🔴 der Abruf steht nur im Zweig mit Zuruf, genau einmal, durch dieselbe Funktion wie X1 und X2; der Prüfer lädt erst im Zug", () => {
        const calls = [...cliSource.matchAll(/await fetchWikiExport\(\s*"legacy-wiki-siedlungen\.json"/g)];
        expect(calls).toHaveLength(1);
        expect(calls[0]?.index ?? 0).toBeGreaterThan(cliSource.indexOf("const catalogs: Catalogs = {"));
        expect(cliSource).not.toMatch(/^import .* from "\.\/verify-wiki-settlements\.ts";$/m);
        expect(cliSource).toContain('await import("./verify-wiki-settlements.ts")');
    });
});
