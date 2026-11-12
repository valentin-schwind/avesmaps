import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    ladeEnvDatei,
    legeMeldungenAn,
    MELDUNGEN_VAR,
    skipZeilen,
    zaehleSkips,
} from "./apps/server/test/support/test-umgebung.ts";

/**
 * Einmal je Lauf (WI-0189): ein leeres Meldeverzeichnis anlegen, in das jede Testdatei schreibt, wenn sie mangels Datenbank
 * überspringt, und am Ende EINE Zeile je Grund ausgeben. `vitest.setup.ts` läuft je Datei und würde die Zeile hundertfach
 * drucken. Meldet nur, hält nichts an.
 */
export default function setup(): () => void {
    ladeEnvDatei(fileURLToPath(new URL(".env", import.meta.url)));
    const dir = mkdtempSync(join(tmpdir(), "avesmaps3d-testlauf-"));
    legeMeldungenAn(dir);
    process.env[MELDUNGEN_VAR] = dir;
    return () => {
        for (const zeile of skipZeilen(zaehleSkips(dir))) console.warn(zeile);
        rmSync(dir, { recursive: true, force: true });
    };
}
