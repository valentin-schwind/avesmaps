import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Jede Datei, die das Regelwerk nennt, gibt es (WI-0169, Prüfung des Regelwerks 2026-10-15, Empfehlung 6: „ein Test, dass
 * jede in `AGENTS.md` genannte Datei existiert“). Geprüft werden der Kern `AGENTS.md` und die Nachschlageteile unter
 * `docs/regeln/`: jeder Pfad in Backticks, der mit einem Verzeichnis des Repositoriums beginnt.
 *
 * Übersprungen werden Platzhalter (`<…>`, `*`, `…`) und Codeblöcke. Groß- und Kleinschreibung zählt, auch unter Windows:
 * Die Stage läuft unter Linux. Der Wächter meldet als Testfehler und hält keinen Lauf an (AGENTS.md, „Blockierende
 * Prüfungen im Betrieb“, nimmt Tests aus).
 */

const wurzel = fileURLToPath(new URL("../../../", import.meta.url));
const PRAEFIX = /^(apps|packages|scripts|config|ops|docs|project-control)\//;
const PLATZHALTER = /[<>*…]/;

/** Genannt, aber mit Absicht nicht im Arbeitsbaum. 🔴 Die Liste darf nur schrumpfen. */
const AUSNAHMEN: Record<string, string> = {
    "docs/abenteuer-feature-design.md":
        "liegt im Legacy-Repository; `docs/regeln/oberflaeche.md` zitiert dort Legacys §5",
};

interface Verweis {
    datei: string;
    zeile: number;
    pfad: string;
}

/** Die Pfade in Backticks außerhalb von Codeblöcken; vom Span zählt das erste Wort, ohne `:zeile`, `#anker` und Satzzeichen. */
function verweiseIn(datei: string, text: string): Verweis[] {
    const raus: Verweis[] = [];
    let imBlock = false;
    text.split(/\r?\n/).forEach((zeile, index) => {
        if (/^\s*(```|~~~)/.test(zeile)) {
            imBlock = !imBlock;
            return;
        }
        if (imBlock) return;
        for (const treffer of zeile.matchAll(/`([^`\n]+)`/g)) {
            const span = (treffer[1] as string).trim();
            if (!PRAEFIX.test(span) || PLATZHALTER.test(span)) continue;
            const pfad = (span.split(/\s/)[0] as string)
                .replace(/[#?].*$/, "")
                .replace(/:\d+(-\d+)?$/, "")
                .replace(/[),.;:]+$/, "")
                .replace(/\/$/, "");
            raus.push({ datei, zeile: index + 1, pfad });
        }
    });
    return raus;
}

/** Gibt es den Pfad, in genau dieser Schreibweise? */
function existiert(pfad: string): boolean {
    let ort = wurzel;
    for (const teil of pfad.split("/")) {
        try {
            if (!readdirSync(ort).includes(teil)) return false;
        } catch {
            return false;
        }
        ort = join(ort, teil);
    }
    return true;
}

const regelwerk = [
    "AGENTS.md",
    ...readdirSync(join(wurzel, "docs/regeln"))
        .filter((name) => name.endsWith(".md"))
        .map((name) => `docs/regeln/${name}`),
];
const alle = regelwerk.flatMap((datei) => verweiseIn(datei, readFileSync(join(wurzel, datei), "utf8")));

describe("Verweise im Regelwerk", () => {
    it("jede genannte Datei gibt es", () => {
        expect(alle.length).toBeGreaterThan(50);
        const kaputt = alle
            .filter((v) => !(v.pfad in AUSNAHMEN) && !existiert(v.pfad))
            .map((v) => `${v.datei}:${String(v.zeile)}  ${v.pfad}`);
        expect(
            kaputt,
            "Verweis berichtigen; liegt die Datei mit Absicht nicht im Arbeitsbaum, in AUSNAHMEN eintragen",
        ).toEqual([]);
    });

    it("jede Ausnahme wird noch genannt", () => {
        const genannt = new Set(alle.map((v) => v.pfad));
        expect(Object.keys(AUSNAHMEN).filter((pfad) => !genannt.has(pfad))).toEqual([]);
    });

    it("liest Pfade, nicht Platzhalter, Befehle oder Codeblöcke", () => {
        const text = [
            "Siehe `apps/server/src/db/migrate.ts:39` und `scripts/dev/start-local-stack.ps1 -Action status`.",
            "Ordner `apps/web/src/map/interaction/`, Muster `apps/server/migrations/0126_*`, `.claude/worktrees/<name>`.",
            "Kein Pfad: `npm run anspruch`, `config.writeClass`, `project-control/handovers/JJJJ-…`.",
            "```",
            "node `scripts/fehlt/im-block.ts`",
            "```",
            "`docs/regeln/befehle.md#projektbefehle`, zuletzt `ops/deploy/auto-stage.sh`.",
        ].join("\n");
        expect(verweiseIn("probe.md", text).map((v) => `${String(v.zeile)} ${v.pfad}`)).toEqual([
            "1 apps/server/src/db/migrate.ts",
            "1 scripts/dev/start-local-stack.ps1",
            "2 apps/web/src/map/interaction",
            "7 docs/regeln/befehle.md",
            "7 ops/deploy/auto-stage.sh",
        ]);
        expect(existiert("AGENTS.md")).toBe(true);
        expect(existiert("agents.md")).toBe(false);
    });
});
