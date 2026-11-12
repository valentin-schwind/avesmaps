/**
 * Welche Schlüssel der deutschen Tafel nicht im Start jedes Besuchers liegen (2026-11-01, WI-0235, Besucherpaket): die Wörter der Verwaltung, der Medienverwaltung, des Kanals und der
 * Statistik, zusammen 79 KB gzip, die ein Besucher nie liest. Der Bau legt sie in einen eigenen Chunk (`vite.config.ts`, `deutscheTafelTeilen`), `i18n.ts` lädt ihn nach
 * (`ladeSpaeteTexte`). Im Entwicklungsserver und in den Tests bleibt die Tafel ganz; `de.ts` bleibt die eine Quelle.
 *
 * Seit WI-0275 Stufe C gehören die Wörter von „Karte vorschlagen“ dazu (`kartenvorschlag.*`, das Fenster lädt sie mit sich, `nachladen.ts`); im Start bleiben die Einladung im Infopanel (`kartenvorschlag.leer.*`)
 * und „Fehlt eine?“ in der Kartensammlung (`kartenvorschlag.fehltEine`).
 *
 * Seit 2026-11-04 auch die Wörter der Redaktion im Community-Modul (`community.redaktion.*`, `community.mails.*`, `community.social.*`): Ein Besucher liest sie nie, das Editorfenster lädt sie mit sich.
 *
 * Seit WI-0280 auch die Wörter von „Karten herunterladen“ (`kartenExport.*`, `kartenPaket.*`): Die zwei Fenster laden sie mit sich (`nachladen.ts`).
 *
 * Seit 2026-11-08 (WI-0288, Besucherpaket 1.043 KB gegen die Grenze von 1.025) auch die Wörter der sieben Editoren (`ortseditor.*`, `wegeditor.*`, `landschaftseditor.*`,
 * `gebietseditor.*`, `kraftlinieneditor.*`, `spracheditor.*`, `wettereditor.*`), zusammen 31 KB gzip: Nur wer `use_editor_menu` hat, sieht sie, und genau der bekommt den späten
 * Teil vor dem Einhängen der Seite (`ladeEditorVor` in `main.ts`, jedes Editorfenster lädt mit `mitTexten`); nach dem Anmelden lädt die Seite neu. Darum stehen auch die
 * Handgriffe im Kartenmenü, die Meldungen und Leisten der Editoren in `app.vue` beim ersten Rechtsklick in Worten da. 🔴 Ein Besucherweg (Infopanel, Suche, Planer, Auge,
 * Reisebilder) nennt keinen dieser Schlüssel (Suche 2026-11-08 über `apps/web/src`); wer dort einen braucht, nimmt ihn hier aus. Gegen den Bau geprobt: Ein Besucher (Start,
 * Auge mit Wetter, Suche, Planer, Rechtsklick) fragt keinen späten Text und lädt den Teil nicht. 🪤 Dafür hängt `app.vue` das Fenster „Weg entfernen“ nur für Editoren ein (es
 * nennt geschlossen seinen Titel), und was `app.vue` beim Aufbau an Editorsätzen weiterreicht, ist ein Getter (`ladefehler`): Ein `t()` beim Aufbau lädt den Teil für jeden.
 *
 * Seit WI-0306 auch die Wörter von „Reise als PDF“ (`reisePdf.*`): Das Fenster lädt sie mit sich (`nachladen.ts`); im Start bleibt nur der Knopf in der Reiseübersicht
 * (`reisePdf.knopf`).
 *
 * Ausgenommen ist, was der Code im Start selbst nennt: `admin.content.*` (die Schalter der Inhalte zeigt auch die Karte), die Schritte des Release-Tests (die Warteschlange im Kopf und die
 * Statusseite) und der Fenstertitel `medien.titel`. Gemessen an den Quellen des Start-JS; wer dort einen weiteren Schlüssel braucht, nimmt ihn hier aus. Vergisst es jemand, lädt `t()` den
 * Chunk beim ersten fehlenden Text und zeichnet neu.
 */
const SPAET =
    /^(?:reisePdf\.(?!knopf$)|kartenExport\.|kartenPaket\.|admin\.(?!content\.|umgebungen\.releaseTest\.schritt\.)|kanal\.|statistik\.|medien\.(?!titel$)|kartenvorschlag\.(?!leer\.|fehltEine$)|community\.(?:redaktion\.|mails\.(?!neu\.titel$)|social\.)|(?:orts|weg|landschafts|gebiets|kraftlinien|sprach|wetter)editor\.)/;

export function istSpaeterText(schluessel: string): boolean {
    return SPAET.test(schluessel);
}
