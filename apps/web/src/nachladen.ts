import { defineAsyncComponent } from "vue";
import { ladeSpaeteTexte } from "./i18n/i18n";

/**
 * Was Kartenbesucher nie sehen, laden sie nicht mit (WI-0235, wie Legacy seit dem 14.09.: `js/app/nur-editor.js`): die Editorfenster
 * (`app.vue`) und Konto, Verwaltung, Passwort, Passkey und Einladung (`auth/auth-fenster-host.vue`). Bis dahin lagen sie mit rund
 * 900 KB im Startpaket jedes Besuchers.
 *
 * 🔴 Wer Editorrechte hat, bekommt die Editorfenster VOR dem Einhängen der Seite geladen und aufgelöst (`ladeEditorVor`, `main.ts`): Vue
 * zeichnet sie dann beim ersten Mal sofort, wie ein statisches Bauteil. `app.vue` misst Fenster und Leisten an festen Auslösern
 * (`messeModusRand`, Laschen, Kamera beim Formmodus) und setzt voraus, dass sie beim nächsten Tick im DOM stehen; erst nachgeladen standen
 * sie dort noch nicht (Editor-Browserlauf 2026-10-19). Leisten, die beim Erscheinen vermessen werden (Entwurfs- und Ebenenleiste), bleiben
 * deshalb statisch in `app.vue`.
 *
 * 🪤 **Nur der Bau lädt nach.** Im Entwicklungsserver zeigt ein Alias (`vite.config.ts`) auf `nachladen.entwicklung.ts`, die dieselben
 * Bauteile statisch einbindet: Dort reist jedes Modul einzeln, die Verwaltung allein brauchte unter Last mehr als die 5 s, die die
 * Browserfälle warten (32 von 668 Fällen rot, 2026-10-19). Das Nachladen selbst prüft die Rauchprobe gegen den gebauten Stand.
 * Wer hier ein Bauteil ergänzt, ergänzt es dort.
 */
/** Wer Texte der Verwaltung zeigt, bekommt sie vor seinem Modul (`i18n/spaete-texte.ts`). Scheitern sie, lädt `t()` beim ersten fehlenden Text noch einmal nach. */
const mitTexten =
    <T>(laden: () => Promise<T>) =>
    (): Promise<T> =>
        ladeSpaeteTexte()
            .catch(() => undefined)
            .then(laden);

const EDITOR = {
    EditorPanel: mitTexten(() => import("./editor-panel/editor-panel.vue")),
    OrtseditorFenster: mitTexten(() => import("./ortseditor/ortseditor-fenster.vue")),
    WegeditorFenster: mitTexten(() => import("./wegeditor/wegeditor-fenster.vue")),
    LandschaftseditorFenster: mitTexten(() => import("./landschaftseditor/landschaftseditor-fenster.vue")),
    GebietseditorFenster: mitTexten(() => import("./gebietseditor/gebietseditor-fenster.vue")),
    KraftlinieneditorFenster: mitTexten(() => import("./kraftlinieneditor/kraftlinieneditor-fenster.vue")),
    SpracheditorFenster: mitTexten(() => import("./spracheditor/spracheditor-fenster.vue")),
    WettereditorFenster: mitTexten(() => import("./wettereditor/wettereditor-fenster.vue")),
    UntergrundRegler: mitTexten(() => import("./landschaftseditor/untergrund-regler.vue")),
    HandgriffGruppe: mitTexten(() => import("./editor-menu/handgriff-gruppe.vue")),
    EditorFloatingMenu: mitTexten(() => import("./editor-menu/editor-floating-menu.vue")),
    MedienFenster: mitTexten(() => import("./medien/medien-fenster.vue")),
    MedienStelleHinweis: mitTexten(() => import("./medien/medien-stelle-hinweis.vue")),
    InhalteFenster: mitTexten(() => import("./inhalte/inhalte-fenster.vue")),
    MessFenster: mitTexten(() => import("./system/mess-fenster.vue")),
    AppKopfleiste: mitTexten(() => import("./auth/app-kopfleiste.vue")),
    CommunityRedaktion: mitTexten(() => import("./community/community-redaktion.vue")),
};

export const EditorPanel = defineAsyncComponent(EDITOR.EditorPanel);
export const OrtseditorFenster = defineAsyncComponent(EDITOR.OrtseditorFenster);
export const WegeditorFenster = defineAsyncComponent(EDITOR.WegeditorFenster);
export const LandschaftseditorFenster = defineAsyncComponent(EDITOR.LandschaftseditorFenster);
export const GebietseditorFenster = defineAsyncComponent(EDITOR.GebietseditorFenster);
export const KraftlinieneditorFenster = defineAsyncComponent(EDITOR.KraftlinieneditorFenster);
export const SpracheditorFenster = defineAsyncComponent(EDITOR.SpracheditorFenster);
export const WettereditorFenster = defineAsyncComponent(EDITOR.WettereditorFenster);
export const UntergrundRegler = defineAsyncComponent(EDITOR.UntergrundRegler);
export const HandgriffGruppe = defineAsyncComponent(EDITOR.HandgriffGruppe);
export const EditorFloatingMenu = defineAsyncComponent(EDITOR.EditorFloatingMenu);
export const MedienFenster = defineAsyncComponent(EDITOR.MedienFenster);
export const MedienStelleHinweis = defineAsyncComponent(EDITOR.MedienStelleHinweis);
export const InhalteFenster = defineAsyncComponent(EDITOR.InhalteFenster);
export const MessFenster = defineAsyncComponent(EDITOR.MessFenster);
export const AppKopfleiste = defineAsyncComponent(EDITOR.AppKopfleiste);
export const CommunityRedaktion = defineAsyncComponent(EDITOR.CommunityRedaktion);

// Konto und Verwaltung: erst beim Öffnen. WebAuthn startet im Passkey-Fenster erst beim Klick, die Nutzergeste bleibt.
export const EinladungFenster = defineAsyncComponent(mitTexten(() => import("./auth/einladung-fenster.vue")));
export const KontoFenster = defineAsyncComponent(mitTexten(() => import("./auth/konto-fenster.vue")));
export const PasskeyFenster = defineAsyncComponent(mitTexten(() => import("./auth/passkey-fenster.vue")));
export const PasswortFenster = defineAsyncComponent(mitTexten(() => import("./auth/passwort-fenster.vue")));
export const KartenExportFenster = defineAsyncComponent(
    mitTexten(() => import("./karten-export/karten-export-fenster.vue")),
);
export const KartenPaketFenster = defineAsyncComponent(
    mitTexten(() => import("./karten-export/karten-paket-fenster.vue")),
);
export const VerwaltungFenster = defineAsyncComponent(mitTexten(() => import("./auth/verwaltung-fenster.vue")));

/**
 * Was Besucher selten öffnen (2026-11-01, Besucherpaket 1.184 KB gegen die Grenze von 1.025): die Formulare der Community und der Reisebilder, der Screenshot, die Hinweise, die Kataloge
 * und die zwei Erklärfenster des Planers. `app.vue` und der Planer hängen sie erst beim ersten Öffnen ein (`einmal-offen.ts`). 🪤 Wer ein Fenster öffnet und im selben Takt misst, löst es
 * vorher auf (`ladeBauteilVor`): „Screenshot machen“ ruft das Bauteil auf, „Eigenes Bild hinzufügen“ misst das Fenster für den Flug zur Stelle (`photobox/stelle-layer.ts`).
 */
export const CommunityBesucher = defineAsyncComponent(() => import("./community/community-besucher.vue"));
export const ReisebildBesucher = defineAsyncComponent(() => import("./photobox/reisebild-besucher.vue"));
// „Karte vorschlagen“ (WI-0275 Stufe C): Die Wörter des Fensters liegen im späten Teil der deutschen Tafel und kommen vor dem Modul.
export const KartenvorschlagFenster = defineAsyncComponent(
    mitTexten(() => import("./kartenvorschlag/kartenvorschlag-fenster.vue")),
);
export const KartenScreenshot = defineAsyncComponent(() => import("./screenshot/karten-screenshot.vue"));
export const HinweiseFenster = defineAsyncComponent(() => import("./legal/hinweise-fenster.vue"));
export const CitymapsFenster = defineAsyncComponent(() => import("./catalog/citymaps-fenster.vue"));
export const LiteratureFenster = defineAsyncComponent(() => import("./catalog/literature-fenster.vue"));
export const TransportInfoFenster = defineAsyncComponent(() => import("./route-planner/transport-info-fenster.vue"));
export const RouteOptionsInfoFenster = defineAsyncComponent(
    () => import("./route-planner/route-options-info-fenster.vue"),
);
/**
 * „Reise als PDF“ (WI-0306): das Fenster samt Aufbereitung, Dokument und Aufnahme; pdfmake, pdf.js und die Schrift lädt es selbst erst beim Öffnen.
 * Seine Wörter liegen im späten Teil der deutschen Tafel (`reisePdf.*` außer dem Knopf) und kommen vor dem Modul.
 */
export const ReisePdfFenster = defineAsyncComponent(mitTexten(() => import("./reise-pdf/reise-pdf-fenster.vue")));

/**
 * Knopf und Host der Reisebilder (WI-0272 S4): Der Knopf steht im Eckbund, der Host trägt die Leiste, die Linie und die Bildansicht. Beide kommen erst nach dem Start; ohne Reisebilder (`an`) zeichnet der Knopf nichts.
 */
export const ReisebilderKnopf = defineAsyncComponent(() => import("./photobox/reisebilder-knopf.vue"));
export const ReisebilderHost = defineAsyncComponent(() => import("./photobox/reisebilder-host.vue"));

/** Die Reisebilder auf der Karte (WI-0272 S4): Abruf, Bündeln, Ebenen und Klick. Das Startpaket trägt nur `photobox/reisebilder-start.ts`, das dieses Modul nach dem ersten ruhigen Bild lädt. */
export const ladeReisebilderKarte = (): Promise<typeof import("./photobox/reisebilder-karte")> =>
    import("./photobox/reisebilder-karte");

/**
 * Die Steuerung des Wetter-Editors (WI-0288; Besucherpaket 2026-11-08: 1.043 KB gegen die Grenze von 1.025) mit Modell, Speicher, Wiki-Suche und Leseweg: Besucher laden sie nie.
 * Editoren bekommen sie mit den Editorfenstern vor dem Einhängen (`ladeEditorVor`); dann legt `wettereditor/wettereditor-huelle.ts` den Editor beim Aufbau der Seite an wie
 * vorher. Sonst lädt das erste Öffnen sie, samt den Wörtern (`wettereditor.*` liegen im späten Teil der Tafel).
 */
type WettereditorModul = typeof import("./wettereditor/wettereditor-steuerung");
let wettereditorModul: WettereditorModul | undefined;
export const ladeWettereditor = (): Promise<WettereditorModul> =>
    mitTexten(() => import("./wettereditor/wettereditor-steuerung"))().then((modul) => (wettereditorModul = modul));
/** Die Steuerung, wenn sie schon geladen ist; sonst `undefined`. */
export const wettereditorGeladen = (): WettereditorModul | undefined => wettereditorModul;

/** Löst ein nachgeladenes Bauteil auf; danach zeichnet Vue es sofort wie ein statisches (`__asyncLoader`, siehe `ladeEditorVor`). */
export async function ladeBauteilVor(bauteil: unknown): Promise<void> {
    await (bauteil as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader?.();
}

const EDITORFENSTER = [
    EditorPanel,
    OrtseditorFenster,
    WegeditorFenster,
    LandschaftseditorFenster,
    GebietseditorFenster,
    KraftlinieneditorFenster,
    SpracheditorFenster,
    WettereditorFenster,
    UntergrundRegler,
    HandgriffGruppe,
    EditorFloatingMenu,
    MedienFenster,
    MedienStelleHinweis,
    InhalteFenster,
    MessFenster,
    AppKopfleiste,
    CommunityRedaktion,
];

/**
 * Lädt die Editorfenster und löst sie auf; nur für Editoren und vor dem Einhängen aufrufen. `__asyncLoader` ist Vues Lader des Bauteils
 * selbst (`runtime-core`, `defineAsyncComponent`): Erst über ihn weiß das Bauteil, dass es fertig ist. Scheitert ein Laden, versucht es das
 * Öffnen noch einmal.
 */
export async function ladeEditorVor(): Promise<void> {
    await Promise.all([
        ...EDITORFENSTER.map((bauteil) => (bauteil as { __asyncLoader?: () => Promise<unknown> }).__asyncLoader?.()),
        ladeWettereditor(),
    ]);
}
