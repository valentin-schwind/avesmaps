import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        // Tests lesen `@avesmaps3d/shared` aus den Quellen DIESES Checkouts, nicht aus dem gebauten `dist` (WI-0189, Review
        // L7-02): Nach einem Pull lief sonst jeder Test gegen den alten Stand oder scheiterte an fehlenden Exporten, und in
        // einer Arbeitskopie zeigte der Paketname in den Hauptcheckout. Der Pfad hängt an dieser Datei, gilt also auch dort.
        alias: [
            {
                find: /^@avesmaps3d\/shared$/,
                replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
            },
        ],
    },
    test: {
        include: ["apps/*/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
        environment: "node",
        // The database-backed tests share one test database and clear it between cases, so two
        // files running at the same time delete each other's fixtures. The suite is fast enough
        // that serial files cost nothing, and a flaky migration test would cost a lot.
        //
        // 🪤 Das gilt nur INNERHALB dieses Prozesses. Mehrere Sitzungen am selben Rechner heben die
        // Zusage auf, und dann löschen sich die Fixtures wieder gegenseitig. Gemessen in WI-0101.
        // Dieselbe Zusage über Prozessgrenzen hält `vitest.setup.ts` mit einer Advisory-Sperre je
        // Testdatei (`apps/server/test/support/test-db-lock.ts`).
        fileParallelism: false,
        // Local development loads .env; CI and deployments provide the environment themselves.
        setupFiles: ["./vitest.setup.ts"],
        // Einmal je Lauf: meldet am Ende, wie viele Dateien mangels Datenbank übersprungen wurden (WI-0189).
        globalSetup: ["./vitest.global-setup.ts"],
    },
});
