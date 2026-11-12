import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ein Knopf des Hauses sperrt über `gesperrt`, nie über `disabled` (Guide §7: „Ein ausgegrauter Knopf ohne Grund ist eine Sackgasse“).
 *
 * 🪤 Bis 2026-10-19 überschrieb `AvmKnopf` ein `disabled` des Aufrufers still: Die Freigabe nach Production und die Knöpfe der Neuigkeiten
 * sahen bedienbar aus, obwohl sie es nicht waren (Fund des Betreibers). Seither achtet der Knopf es, und es fiel auf, dass dreizehn Stellen
 * so ohne Grund sperrten. `gesperrt` nimmt den Satz; ein leerer Satz (`''`) ist allein für das kurze „wird gerade gespeichert“ da.
 */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("Knöpfe sperren mit Grund", () => {
    it("🔴 kein `Avm…Knopf` trägt `disabled` oder `:disabled`", () => {
        const wurzel = join(repositoryRoot, "apps/web/src");
        const funde: string[] = [];
        for (const pfad of readdirSync(wurzel, { recursive: true, encoding: "utf8" })) {
            if (!pfad.endsWith(".vue")) continue;
            const text = readFileSync(join(wurzel, pfad), "utf8");
            for (const treffer of text.matchAll(/<(Avm[A-Z]\w*Knopf|AvmKnopf)\b([^>]*?)>/gsu)) {
                if (/(^|\s)(:|v-bind:)?disabled\s*=/u.test(treffer[2] ?? "")) {
                    const zeile = text.slice(0, treffer.index).split("\n").length;
                    funde.push(`apps/web/src/${pfad.replace(/\\/gu, "/")}:${String(zeile)}`);
                }
            }
        }
        expect(funde).toEqual([]);
    });
});
