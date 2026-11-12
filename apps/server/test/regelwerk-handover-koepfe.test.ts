import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { headerProblems } from "../../../scripts/coordination/handover-protocol.ts";

/**
 * Jedes neue Handover hat einen Kopf, den der Listener liest (WI-0169, Prüfung des Regelwerks 2026-10-15, W3 und
 * Empfehlung 6). Ein anderer Kopf weckt niemanden; am 2026-10-15 waren so 59 von 261 Oktober-Handovers still.
 *
 * Geprüft wird mit dem Parser des Listeners (`scripts/coordination/handover-protocol.ts`), nicht mit einer Abschrift der
 * Vorlage. 🔴 Erst ab dem Dateidatum 2026-10-16: Ältere Handovers bleiben, wie sie sind. Der Wächter meldet als
 * Testfehler und hält keinen Lauf an (AGENTS.md, „Blockierende Prüfungen im Betrieb“, nimmt Tests aus).
 */

const ordner = fileURLToPath(new URL("../../../project-control/handovers/", import.meta.url));
const AB = "2026-10-16";

const kopf = (felder: Record<string, string>): string =>
    `# Probe\n\n| Feld | Wert |\n|---|---|\n${Object.entries(felder)
        .map(([feld, wert]) => `| ${feld} | ${wert} |`)
        .join("\n")}\n\n## Kontext\n\n| from | claudio |\n`;

const gut = { from: "claudia", to: "claudio", status: "ACTION_REQUIRED", operator_decision_required: "no" };

describe("Handover-Köpfe", () => {
    it("jede Datei außer der Vorlage trägt ein Datum im Namen", () => {
        const ohneDatum = readdirSync(ordner)
            .filter((name) => name.endsWith(".md") && name !== "README.md")
            .filter((name) => !/^\d{4}-\d{2}-\d{2}-/.test(name));
        expect(ohneDatum, "Dateiname nach handovers/README.md: JJJJ-MM-TT-<kurzer-titel>.md").toEqual([]);
    });

    it(`jedes Handover ab ${AB} hat einen gültigen Kopf`, () => {
        const ungueltig = readdirSync(ordner)
            .filter((name) => name.endsWith(".md") && /^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(0, 10) >= AB)
            .flatMap((name) => {
                const probleme = headerProblems(readFileSync(join(ordner, name), "utf8"));
                return probleme.length === 0 ? [] : [`${name}: ${probleme.join("; ")}`];
            });
        expect(
            ungueltig,
            "Kopf genau nach der Vorlage in project-control/handovers/README.md: from, to, status mit INFO, " +
                "ACTION_REQUIRED, BLOCKED oder DONE vorne, operator_decision_required mit no oder yes",
        ).toEqual([]);
    });

    it("erkennt die Köpfe, die am 2026-10-15 still waren", () => {
        expect(headerProblems(kopf(gut))).toEqual([]);
        expect(headerProblems(kopf({ ...gut, status: "**DONE** (2026-10-16, Abschluss `abc1234`)" }))).toEqual([]);
        expect(headerProblems(kopf({ ...gut, operator_decision_required: "yes: Freigabe für Production" }))).toEqual(
            [],
        );

        const ohneRollen = { status: gut.status, operator_decision_required: gut.operator_decision_required };
        expect(headerProblems(kopf({ ...ohneRollen, von: "claudia", an: "claudio" }))).toHaveLength(2);
        for (const status of ["GEBAUT", "READY", "FYI", "ZUR KENNTNIS", "OPEN", "ANSWERED (als DONE in x)"]) {
            expect(headerProblems(kopf({ ...gut, status }))).toEqual([expect.stringContaining("status")]);
        }
        const ohneGate = { from: gut.from, to: gut.to, status: gut.status };
        expect(headerProblems(kopf(ohneGate))).toEqual([expect.stringContaining("operator_decision_required")]);
        expect(headerProblems(kopf({ ...ohneGate, requires_operator_approval: "no" }))).toHaveLength(1);
        expect(headerProblems(kopf({ ...gut, to: "betreiber" }))).toEqual([expect.stringContaining("to")]);
    });
});
