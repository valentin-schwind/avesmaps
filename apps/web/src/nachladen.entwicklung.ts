/**
 * Die Fassung von `nachladen.ts` für den Entwicklungsserver (WI-0235): dieselben Bauteile, statisch eingebunden. `vite.config.ts` lenkt
 * im Entwicklungsserver jeden Import von `nachladen` hierher; der Bau nimmt `nachladen.ts` und lädt nach. Grund steht dort.
 * Wer dort ein Bauteil ergänzt, ergänzt es hier.
 */
import * as reisebilderKarte from "./photobox/reisebilder-karte";
import * as wettereditorSteuerung from "./wettereditor/wettereditor-steuerung";
export { default as EditorPanel } from "./editor-panel/editor-panel.vue";
export { default as OrtseditorFenster } from "./ortseditor/ortseditor-fenster.vue";
export { default as WegeditorFenster } from "./wegeditor/wegeditor-fenster.vue";
export { default as LandschaftseditorFenster } from "./landschaftseditor/landschaftseditor-fenster.vue";
export { default as GebietseditorFenster } from "./gebietseditor/gebietseditor-fenster.vue";
export { default as KraftlinieneditorFenster } from "./kraftlinieneditor/kraftlinieneditor-fenster.vue";
export { default as SpracheditorFenster } from "./spracheditor/spracheditor-fenster.vue";
export { default as WettereditorFenster } from "./wettereditor/wettereditor-fenster.vue";
export { default as UntergrundRegler } from "./landschaftseditor/untergrund-regler.vue";
export { default as HandgriffGruppe } from "./editor-menu/handgriff-gruppe.vue";
export { default as EditorFloatingMenu } from "./editor-menu/editor-floating-menu.vue";
export { default as MedienFenster } from "./medien/medien-fenster.vue";
export { default as MedienStelleHinweis } from "./medien/medien-stelle-hinweis.vue";
export { default as InhalteFenster } from "./inhalte/inhalte-fenster.vue";
export { default as MessFenster } from "./system/mess-fenster.vue";
export { default as AppKopfleiste } from "./auth/app-kopfleiste.vue";
export { default as EinladungFenster } from "./auth/einladung-fenster.vue";
export { default as KontoFenster } from "./auth/konto-fenster.vue";
export { default as PasskeyFenster } from "./auth/passkey-fenster.vue";
export { default as PasswortFenster } from "./auth/passwort-fenster.vue";
export { default as KartenExportFenster } from "./karten-export/karten-export-fenster.vue";
export { default as KartenPaketFenster } from "./karten-export/karten-paket-fenster.vue";
export { default as VerwaltungFenster } from "./auth/verwaltung-fenster.vue";
export { default as CommunityRedaktion } from "./community/community-redaktion.vue";
export { default as CommunityBesucher } from "./community/community-besucher.vue";
export { default as ReisebildBesucher } from "./photobox/reisebild-besucher.vue";
export { default as KartenvorschlagFenster } from "./kartenvorschlag/kartenvorschlag-fenster.vue";
export { default as KartenScreenshot } from "./screenshot/karten-screenshot.vue";
export { default as HinweiseFenster } from "./legal/hinweise-fenster.vue";
export { default as CitymapsFenster } from "./catalog/citymaps-fenster.vue";
export { default as LiteratureFenster } from "./catalog/literature-fenster.vue";
export { default as TransportInfoFenster } from "./route-planner/transport-info-fenster.vue";
export { default as RouteOptionsInfoFenster } from "./route-planner/route-options-info-fenster.vue";
export { default as ReisePdfFenster } from "./reise-pdf/reise-pdf-fenster.vue";

export { default as ReisebilderKnopf } from "./photobox/reisebilder-knopf.vue";
export { default as ReisebilderHost } from "./photobox/reisebilder-host.vue";

/** Die Reisebilder auf der Karte: statisch eingebunden, geladen wird nichts. */
export const ladeReisebilderKarte = (): Promise<typeof reisebilderKarte> => Promise.resolve(reisebilderKarte);

/** Die Steuerung des Wetter-Editors: statisch eingebunden, also vom Start an da, wie für Editoren im Bau. */
export const ladeWettereditor = (): Promise<typeof wettereditorSteuerung> => Promise.resolve(wettereditorSteuerung);
export const wettereditorGeladen = (): typeof wettereditorSteuerung => wettereditorSteuerung;

/** Statisch ist alles schon da. */
export function ladeEditorVor(): Promise<void> {
    return Promise.resolve();
}

export function ladeBauteilVor(): Promise<void> {
    return Promise.resolve();
}
