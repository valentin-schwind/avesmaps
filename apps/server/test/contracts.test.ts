import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Migration Contracts müssen maschinenlesbar bleiben.
 *
 * 💣 `places.yaml` trug über Wochen ein `rule: >` INNERHALB einer Inline-Map `{ … }` — kein
 * gültiges YAML. Aufgefallen ist es erst, als ein Werkzeug die Datei zum ersten Mal parsen wollte;
 * bis dahin hatten sie nur Menschen gelesen, und die stolpern darüber nicht. Ein Contract, den kein
 * Parser liest, ist genau das, was er nicht sein soll: ein Text, der wie eine Zusicherung aussieht.
 *
 * 🪤 Dieser Test ist bewusst KEINE vollständige YAML-Prüfung — dafür bräuchte es einen Parser als
 * Abhängigkeit, und die wäre hier nur für einen Nebenzweck da. Er prüft den Fehlermodus, der
 * tatsächlich zugeschlagen hat, und sagt das im Namen. Wer eine vollständige Prüfung braucht,
 * nimmt `yaml` als devDependency auf und ersetzt ihn.
 */

const contractsDirectory = fileURLToPath(new URL("../../../project-control/migration/contracts/", import.meta.url));

async function contractFiles(): Promise<string[]> {
    return (await readdir(contractsDirectory)).filter((name) => name.endsWith(".yaml"));
}

describe("Migration Contracts", () => {
    it("setzen keinen Block-Skalar in eine Inline-Map", async () => {
        const files = await contractFiles();
        expect(files.length, "es gibt überhaupt Contracts").toBeGreaterThan(0);

        const broken: string[] = [];
        for (const file of files) {
            const text = await readFile(join(contractsDirectory, file), "utf8");
            for (const [index, line] of text.split(/\r?\n/).entries()) {
                // Eine Zeile, die eine Inline-Map öffnet und mit `>` oder `|` endet, bevor sie
                // geschlossen wird: genau die Konstruktion, an der places.yaml unlesbar war.
                if (/\{[^}]*:\s*[>|]\s*$/.test(line)) {
                    broken.push(`${file}:${String(index + 1)}: ${line.trim().slice(0, 70)}`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    it("nennen alle ihre Data Domain", async () => {
        const nameless: string[] = [];
        for (const file of await contractFiles()) {
            const text = await readFile(join(contractsDirectory, file), "utf8");
            if (!/^data_domain:\s*\S+/m.test(text)) {
                nameless.push(file);
            }
        }
        expect(nameless).toEqual([]);
    });
});
