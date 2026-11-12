/**
 * Der einmalige Kamera-Hinweis „Karte drehen und neigen“ (`controls/camera-controls.vue`, `avesmaps3d.hinweis-3d`) gilt in jedem
 * Browserfall als schon gesehen (Editor-Orchestrierung 2026-10-20): Er steht seit WI-0218 nach rund 1,5 s in der freien Fläche, und sein
 * „Verstanden“ fing in mindestens vier Specs Klicks ab (ortseditor T6, editor-menu, Unterflächen, neue Fläche). Bis dahin setzte jeder
 * Spec ihn einzeln.
 *
 * - **Die Vorgabe** setzt `playwright.config.ts` als `storageState` für die Herkunft der Test-Vite (`hinweisGesehen`), für alle Projekte.
 * - **Ein Spec, der den Hinweis selbst prüft**, schaltet den ersten Besuch wieder ein: `test.use(ERSTER_BESUCH)`.
 */

export const HINWEIS_3D_SCHLUESSEL = "avesmaps3d.hinweis-3d";

/** Der Stand eines Browsers, der die Karte schon besucht und den Hinweis geschlossen hat. */
export function hinweisGesehen(herkunft: string): {
    cookies: [];
    origins: { origin: string; localStorage: { name: string; value: string }[] }[];
} {
    return {
        cookies: [],
        origins: [{ origin: herkunft, localStorage: [{ name: HINWEIS_3D_SCHLUESSEL, value: "gesehen" }] }],
    };
}

/** Ein Browser beim ersten Besuch: nichts gespeichert, der Hinweis steht da. */
export const ERSTER_BESUCH = { storageState: { cookies: [], origins: [] } };
