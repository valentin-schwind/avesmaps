import { defineConfig, devices } from "@playwright/test";

/**
 * `npm run test:e2e:build --workspace @avesmaps3d/web` (WI-0189, Review T2-01): baut die Seite wie der Release, startet die Vorschau
 * auf 4181 und fährt `e2e/production-build.spec.ts` gegen das AUSGELIEFERTE Artefakt. Im Standardlauf überspringt sich diese Datei,
 * weil dort niemand baut; ein vorhandenes, älteres `dist/` nennt sie seither „veralteter Build“, statt es still zu prüfen.
 *
 * 🪤 Die Vorschau reicht Kacheln, `/api` und `/media` an Martin und Fastify des lokalen Stapels weiter (`preview.proxy` in
 * `vite.config.ts`); ohne laufenden Stapel bleibt der Fall mit den Vektorkacheln rot. `reuseExistingServer: false`: eine Vorschau
 * aus einer anderen Arbeitskopie auf 4181 würde sonst still geprüft. Freiwillig, kein Pflichtlauf vor dem Push.
 */
export default defineConfig({
    testDir: "./e2e",
    testMatch: /production-build\.spec\.ts$/,
    timeout: 60_000,
    workers: 1,
    use: { ...devices["Desktop Chrome"], headless: true, locale: "de-DE" },
    webServer: {
        command: "npm run build && npm run preview -- --port 4181 --strictPort",
        url: "http://localhost:4181",
        reuseExistingServer: false,
        timeout: 600_000,
    },
});
