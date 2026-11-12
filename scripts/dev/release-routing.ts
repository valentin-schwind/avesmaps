// Das Routing-Gate im Release-Test bei bewegten Daten (WI-0248; Vali wählte am 2026-10-26: „Ja: Der Runner prüft vor dem Lauf, ob die Routing-Revision
// zur Basislinie passt, und macht bei Abweichung die Gegenprobe mit dem Code der Basislinie selbst.“).
//
// 🔴 Anlass: Der Korpus des Release-Tests ist der Dump der Entwicklungsdatenbank. Jeder Legacy-Zug, jede Ableitung und jeder Geländelauf dort ändert die
// Routing-Revision; das Gate (`route-corpus-gate.test.ts`) übersprang dann die Fälle der Teilmenge als `DATA_CHANGE`, und der Lauf war rot (Läufe
// a947660e und 08a5d3d6ba56), ohne dass ein Codefehler da war und ohne dass eine echte Regression zu sehen gewesen wäre.
//
// Vor dem Vitest-Teil, gegen den schon eingespielten Korpus:
//   - **Basislinie passt** (Kurzschlüssel der Routing-Revision des Korpus = `keys.routing_graph_revision` der Basislinie): nichts weiter, wie bisher.
//   - **Gegenprobe:** Sonst rechnet der Runner die Fälle des Kandidaten mit dem Code der Basislinie auf genau diesem Korpus. Der Code der Basislinie ist
//     der Stand des letzten Commits, der `route-gate-baseline.json` geändert hat (so wird sie aufgenommen: im selben Commit wie eine gewollte Änderung
//     des Routers, `docs/regeln/entwicklung.md`). Ausgecheckt wird nur, was die Routenrechnung braucht (`BASISLINIE_CODE_PFADE`), in den Laufordner,
//     mit eigenem Index, ohne den Klon des Kandidaten anzufassen; `node_modules` ist ein Verweis auf die Installation des Kandidaten, `shared` wird aus
//     dem alten Stand gebaut. Das Ergebnis ist der Vergleichsstand des Laufs (`routing-vergleich.json`, nur im Laufordner, nie ein Commit); das Gate
//     vergleicht den Kandidaten dann damit (`AVESMAPS_ROUTING_VERGLEICH`). Gleiche Daten, anderer Code: Jede Abweichung ist eine REGRESSION, wie bei
//     passender Basislinie. Der alte Code wird gleich danach wieder entfernt (Verweise zuerst, nie verfolgt).
//   - **Gescheitert:** Lässt sich die Revision nicht lesen oder die Gegenprobe nicht rechnen (Commit fehlt, alter Code baut nicht, rechnet nicht), ist
//     der Vitest-Teil rot mit genau diesem Grund. Kein stilles Überspringen.
//
// `routing-gate.json` im Laufordner hält fest, welcher Weg galt; der Bericht (`release-seite.ts`) zeigt es in einer Zeile, bei der Gegenprobe mit den
// Ausreißern der Daten (über 15 % Reisezeit gegenüber der Basislinie, oder ein anderer Ausgang). Die Ausreißer sagen nichts über den Code: Sie
// vergleichen die Basislinie mit dem Code der Basislinie auf den neuen Daten.
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Befund } from "./release-ablauf.ts";
import { entferneLaufOrdner } from "./release-aufraeumen.ts";

/** Welcher Weg galt, im Laufordner. */
export const ROUTING_DATEI = "routing-gate.json";
/** Der Vergleichsstand der Gegenprobe, im Laufordner. */
export const ROUTING_VERGLEICH_DATEI = "routing-vergleich.json";
/** Nennt dem Gate den Vergleichsstand; derselbe Name steht in `apps/server/src/routing/corpus-gate-run.ts` (`GATE_VERGLEICH_ENV`). */
export const ROUTING_VERGLEICH_ENV = "AVESMAPS_ROUTING_VERGLEICH";
/** Das Protokoll der Vorbereitung (bewusst kein `.log`: So heißen die Schrittprotokolle, die Oberfläche liest ihre Namen als Schritte). */
export const ROUTING_PROTOKOLL = "routing-gate.txt";
export const BASISLINIE_PFAD = "project-control/discovery/corpus/route-gate-baseline.json";
/** Was vom Code der Basislinie ausgecheckt wird: nur, was die Routenrechnung braucht. */
export const BASISLINIE_CODE_PFADE = [
    "package.json",
    "tsconfig.base.json",
    "config",
    "packages/shared",
    "apps/server/package.json",
    "apps/server/src",
] as const;
/** Ab welcher Änderung der Reisezeit ein Fall als Ausreißer der Daten im Bericht steht. */
export const AUSREISSER_GRENZE = 0.15;
/** Das Kindskript, das mit dem Code eines Stands rechnet (gehört zum Werkzeugklon des Runners). */
export const RECHNEN_SKRIPT = fileURLToPath(new URL("./routing-gate-rechnen.ts", import.meta.url));

export interface FallErgebnis {
    readonly label: string;
    readonly result: { readonly outcome: string; readonly travelHours: number } & Readonly<Record<string, unknown>>;
}
export type Faelle = Readonly<Record<string, FallErgebnis>>;

export interface DatenAusreisser {
    readonly id: string;
    readonly label: string;
    /** Reisezeit in Stunden laut Basislinie und mit dem Code der Basislinie auf dem Korpus. */
    readonly vorher: number;
    readonly nachher: number;
    /** Relative Änderung der Reisezeit; `null`, wenn sich der Ausgang änderte (etwa keine Route mehr). */
    readonly anteil: number | null;
    /** Bei geändertem Ausgang: `vorher → nachher`. */
    readonly ausgang?: string;
}

export type RoutingWeg =
    | { readonly weg: "passt"; readonly revision: string }
    | {
          readonly weg: "gegenprobe";
          readonly commit: string;
          readonly revision: string;
          readonly basislinie: string;
          readonly ausreisser: readonly DatenAusreisser[];
      }
    | { readonly weg: "gescheitert"; readonly grund: string };

/** Passt die Basislinie zum Korpus? Verglichen werden die Kurzschlüssel der Routing-Revision (`routing_graph_revision`). */
export function entscheideRoutingWeg(korpus: string, basislinie: string): "passt" | "gegenprobe" {
    return korpus === basislinie ? "passt" : "gegenprobe";
}

/**
 * Die Ausreißer der Daten: Fälle, deren Reisezeit sich zwischen Basislinie und Vergleichsstand um mehr als `grenze` änderte oder deren Ausgang sich
 * änderte; der größte zuerst. Ein Fall, den die Basislinie nicht kennt, ist kein Ausreißer der Daten.
 */
export function datenAusreisser(basislinie: Faelle, vergleich: Faelle, grenze = AUSREISSER_GRENZE): DatenAusreisser[] {
    const gefunden: DatenAusreisser[] = [];
    for (const [id, jetzt] of Object.entries(vergleich)) {
        const vorher = basislinie[id];
        if (vorher === undefined) continue;
        const a = vorher.result;
        const b = jetzt.result;
        if (a.outcome !== b.outcome) {
            gefunden.push({
                id,
                label: jetzt.label,
                vorher: a.travelHours,
                nachher: b.travelHours,
                anteil: null,
                ausgang: `${a.outcome} → ${b.outcome}`,
            });
            continue;
        }
        if (!(a.travelHours > 0)) continue;
        const anteil = (b.travelHours - a.travelHours) / a.travelHours;
        if (Math.abs(anteil) > grenze)
            gefunden.push({ id, label: jetzt.label, vorher: a.travelHours, nachher: b.travelHours, anteil });
    }
    return gefunden.sort(
        (x, y) =>
            (y.anteil === null ? Infinity : Math.abs(y.anteil)) - (x.anteil === null ? Infinity : Math.abs(x.anteil)),
    );
}

const stunden = (h: number): string => h.toFixed(1).replace(".", ",");
const prozent = (anteil: number): string => `${anteil >= 0 ? "+" : "−"}${String(Math.round(Math.abs(anteil) * 100))} %`;

/** Die Zeilen im Kopf des Berichts: eine Zeile für den Weg, bei der Gegenprobe darunter die Ausreißer der Daten. */
export function routingZeilen(weg: RoutingWeg): string[] {
    if (weg.weg === "passt") return [`- Routing-Gate: Basislinie passt (Revision \`${weg.revision}\`)`];
    if (weg.weg === "gescheitert") return [`- Routing-Gate: gescheitert, der Vitest-Teil ist rot: ${weg.grund}`];
    const kopf = `- Routing-Gate: Gegenprobe mit \`${weg.commit.slice(0, 12)}\` auf Revision \`${weg.revision}\` (Basislinie \`${weg.basislinie}\`)`;
    if (weg.ausreisser.length === 0)
        return [`${kopf}; keine Ausreißer der Daten über ${String(Math.round(AUSREISSER_GRENZE * 100))} %`];
    return [
        `${kopf}; Ausreißer der Daten über ${String(Math.round(AUSREISSER_GRENZE * 100))} % Reisezeit: ${String(weg.ausreisser.length)}`,
        ...weg.ausreisser.map(
            (a) =>
                `  - ${a.id} (${a.label}): ${
                    a.ausgang ?? `${stunden(a.vorher)} → ${stunden(a.nachher)} h (${prozent(a.anteil ?? 0)})`
                }`,
        ),
    ];
}

/** `routing-gate.json` eines Laufordners; `undefined`, wenn es sie nicht gibt (Läufe von vorher, Lauf ohne Vitest-Teil) oder sie unlesbar ist. */
export function leseRoutingWeg(ordner: string): RoutingWeg | undefined {
    try {
        const roh = JSON.parse(readFileSync(join(ordner, ROUTING_DATEI), "utf8")) as { weg?: unknown };
        return roh.weg === "passt" || roh.weg === "gegenprobe" || roh.weg === "gescheitert"
            ? (roh as RoutingWeg)
            : undefined;
    } catch {
        return undefined;
    }
}

/** Was die Vorbereitung vom Runner braucht. Ersetzbar für Tests. */
export interface RoutingIo {
    /** Ein Kindprozess mit Protokoll (`ROUTING_PROTOKOLL`): sein Exitcode, oder `zeit` über seiner Grenze. */
    prozess(exe: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number | "zeit">;
    /** Ausgabe eines Git-Befehls im Klon des Kandidaten. */
    git(args: readonly string[]): string;
}

export interface RoutingVorbereitung {
    readonly weg: RoutingWeg;
    /** Der Vergleichsstand für das Gate (`ROUTING_VERGLEICH_ENV`), nur bei der Gegenprobe. */
    readonly vergleich: string | null;
    /** Rot, wenn die Vorbereitung scheiterte; sonst `null`. */
    readonly befund: Befund | null;
}

class Gescheitert extends Error {}

const exitText = (code: number | "zeit"): string => (code === "zeit" ? "Zeitüberschreitung" : `Exit ${String(code)}`);

function liesJson<T>(pfad: string, was: string): T {
    try {
        return JSON.parse(readFileSync(pfad, "utf8")) as T;
    } catch {
        throw new Gescheitert(`${was} fehlt oder ist unlesbar`);
    }
}

/**
 * Bereitet das Routing-Gate des Vitest-Teils vor (siehe Kopf). `kopie` ist der Klon des Kandidaten mit Installation, `env` die Umgebung der Schritte
 * mit `DATABASE_URL` auf dem eingespielten Korpus. Wirft nicht: Ein Fehler ist der Weg `gescheitert` mit Befund.
 */
export async function bereiteRoutingGateVor(o: {
    readonly basis: string;
    readonly kopie: string;
    readonly sha: string;
    readonly env: NodeJS.ProcessEnv;
    readonly io: RoutingIo;
    readonly heute?: string;
    readonly skript?: string;
}): Promise<RoutingVorbereitung> {
    const { basis, kopie, sha, env, io } = o;
    const skript = o.skript ?? RECHNEN_SKRIPT;
    const ablage = (weg: RoutingWeg): void =>
        writeFileSync(join(basis, ROUTING_DATEI), `${JSON.stringify(weg, null, 2)}\n`);
    const code = join(basis, "routing-basislinie");
    const index = join(basis, "routing-basislinie.index");
    let commit: string | undefined;
    try {
        // 1. Die Revision des Korpus nach dem Code des Kandidaten, dazu seine Fälle.
        const kandidatDatei = join(basis, "routing-kandidat.json");
        const revisionLauf = await io.prozess(process.execPath, [skript, "revision", kopie, kandidatDatei], basis, env);
        if (revisionLauf !== 0)
            throw new Gescheitert(
                `Routing-Revision des Korpus nicht lesbar (${exitText(revisionLauf)}, ${ROUTING_PROTOKOLL})`,
            );
        const kandidat = liesJson<{ revision: unknown; schluessel: string; faelle: { id: string }[] }>(
            kandidatDatei,
            "Revision des Kandidaten",
        );
        const basislinie = liesJson<{ keys?: { routing_graph_revision?: string }; cases?: Faelle }>(
            join(kopie, ...BASISLINIE_PFAD.split("/")),
            "Basislinie im Kandidaten",
        );
        const basisSchluessel = basislinie.keys?.routing_graph_revision;
        if (typeof basisSchluessel !== "string" || basislinie.cases === undefined)
            throw new Gescheitert("Basislinie im Kandidaten ohne Revision oder Fälle");

        // 2. Passt sie, gilt die Basislinie wie bisher.
        if (entscheideRoutingWeg(kandidat.schluessel, basisSchluessel) === "passt") {
            const weg: RoutingWeg = { weg: "passt", revision: kandidat.schluessel };
            ablage(weg);
            return { weg, vergleich: null, befund: null };
        }

        // 3. Sonst die Gegenprobe: der Code der Basislinie, nur was die Routenrechnung braucht, mit eigenem Index (der Klon bleibt unberührt).
        const gefunden = io.git(["log", "-1", "--format=%H", sha, "--", BASISLINIE_PFAD]).trim();
        if (!/^[0-9a-f]{40}$/u.test(gefunden)) throw new Gescheitert("Commit der Basislinie nicht gefunden");
        commit = gefunden;
        const kurz = commit.slice(0, 12);
        if (existsSync(code)) await entferneLaufOrdner(code);
        rmSync(index, { force: true });
        mkdirSync(code, { recursive: true });
        const auschecken = await io.prozess(
            "git",
            ["--git-dir", join(kopie, ".git"), "--work-tree", code, "checkout", commit, "--", ...BASISLINIE_CODE_PFADE],
            basis,
            { ...env, GIT_INDEX_FILE: index },
        );
        if (auschecken !== 0)
            throw new Gescheitert(`Code der Basislinie ${kurz} ließ sich nicht auschecken (${exitText(auschecken)})`);
        // Die Installation des Kandidaten, aber das eigene `shared` des alten Stands (näher am Code, darum zuerst gefunden).
        symlinkSync(join(kopie, "node_modules"), join(code, "node_modules"), "junction");
        const geteilt = join(code, "apps", "server", "node_modules", "@avesmaps3d");
        mkdirSync(geteilt, { recursive: true });
        symlinkSync(join(code, "packages", "shared"), join(geteilt, "shared"), "junction");
        const bau = await io.prozess(
            process.execPath,
            [join(kopie, "node_modules", "typescript", "bin", "tsc"), "--build"],
            join(code, "packages", "shared"),
            env,
        );
        if (bau !== 0)
            throw new Gescheitert(`Code der Basislinie ${kurz} lässt sich nicht bauen (shared, ${exitText(bau)})`);

        // 4. Die Fälle des Kandidaten mit dem Code der Basislinie auf genau diesem Korpus.
        const faelleDatei = join(basis, "routing-faelle.json");
        writeFileSync(faelleDatei, JSON.stringify(kandidat.faelle));
        const ergebnisDatei = join(basis, "routing-basislinie-ergebnis.json");
        const rechnen = await io.prozess(
            process.execPath,
            [skript, "faelle", code, faelleDatei, ergebnisDatei],
            basis,
            env,
        );
        if (rechnen !== 0)
            throw new Gescheitert(
                `Gegenprobe mit ${kurz}: Der Code der Basislinie rechnet die Fälle nicht (${exitText(rechnen)}, ${ROUTING_PROTOKOLL})`,
            );
        const ergebnis = liesJson<{ faelle?: Faelle }>(ergebnisDatei, "Ergebnis der Gegenprobe");
        const faelle = ergebnis.faelle ?? {};
        const fehlt = kandidat.faelle.filter((fall) => faelle[fall.id] === undefined).map((fall) => fall.id);
        if (fehlt.length > 0) throw new Gescheitert(`Gegenprobe mit ${kurz} ohne Ergebnis für ${fehlt.join(", ")}`);

        // 5. Der Vergleichsstand: die Revision dieses Korpus (nach dem Code des Kandidaten, wie das Gate sie liest), die Ergebnisse des alten Codes.
        const vergleich = join(basis, ROUTING_VERGLEICH_DATEI);
        writeFileSync(
            vergleich,
            `${JSON.stringify(
                {
                    recorded: o.heute ?? new Date().toISOString().slice(0, 10),
                    code: commit,
                    revision: kandidat.revision,
                    keys: { routing_graph_revision: kandidat.schluessel, map_revision: "", terrain_revision: null },
                    cases: faelle,
                },
                null,
                2,
            )}\n`,
        );
        const weg: RoutingWeg = {
            weg: "gegenprobe",
            commit,
            revision: kandidat.schluessel,
            basislinie: basisSchluessel,
            ausreisser: datenAusreisser(basislinie.cases, faelle),
        };
        ablage(weg);
        return { weg, vergleich, befund: null };
    } catch (e) {
        const grund =
            e instanceof Gescheitert
                ? e.message
                : `Vorbereitung abgebrochen (${e instanceof Error ? e.message.split(/\r?\n/u, 1)[0] : "Fehler"})`;
        const weg: RoutingWeg = { weg: "gescheitert", grund };
        try {
            ablage(weg);
        } catch {
            /* Der Befund trägt den Grund ohnehin. */
        }
        return {
            weg,
            vergleich: null,
            befund: { meldung: `Routing-Gate: ${grund}`, kurz: "Routing-Gate: Vorbereitung gescheitert" },
        };
    } finally {
        // Der alte Code bleibt nicht liegen: Verweise zuerst, nie verfolgt (`entferneLaufOrdner`).
        if (existsSync(code)) await entferneLaufOrdner(code);
        rmSync(index, { force: true });
    }
}

/**
 * Der Befund des Vitest-Teils mit dem der Vorbereitung: Ist sie gescheitert, steht ihr Grund vorn (er erklärt die übersprungenen Fälle), danach,
 * was Vitest sonst meldet. Beginnt mit `Vitest:`, damit Bericht und Karte die Zeile dem Schritt `tests` zuordnen.
 */
export function vitestMitRouting(routing: Befund | null, vitest: Befund | null): Befund | null {
    if (routing === null) return vitest;
    const rest = (text: string): string => text.replace(/^Vitest:\s*/u, "");
    return {
        meldung: `Vitest: ${routing.meldung}${vitest === null ? "" : `; ${rest(vitest.meldung)}`}`,
        kurz: `Vitest: ${routing.kurz}${vitest === null ? "" : `; ${rest(vitest.kurz)}`}`,
    };
}
