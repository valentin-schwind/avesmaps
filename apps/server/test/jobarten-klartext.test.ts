import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOB_KIND_CATALOG } from "../src/jobs/kinds.ts";

/**
 * Jede Jobart hat einen Klartext (Betreiber 2026-10-19 über die Hauptorchestrierung: In der Warteschlange stand „territory_derive“, „den
 * namen noch auflösen“). Die Warteschlange und der Kopf lesen `status.kind.<art>` (`apps/web/src/auth/warteschlange-reihe.ts`,
 * `dataLabel`); fehlt der Schlüssel, zeigen sie die Kennung. Geprüft wird die deutsche Tafel; dass jede andere Sprache jeden Schlüssel
 * trägt, halten die Wächter der Sprachtafeln fest.
 */
const deutscheTafel = fileURLToPath(new URL("../../web/src/i18n/de.ts", import.meta.url));

describe("Klartext der Jobarten", () => {
    it("🔴 jede Art des Katalogs steht als status.kind.<art> in der Sprachtafel", async () => {
        const tafel = await readFile(deutscheTafel, "utf8");
        const ohne = Object.keys(JOB_KIND_CATALOG).filter((kind) => !tafel.includes(`"status.kind.${kind}":`));
        expect(ohne).toEqual([]);
    });
});
