/**
 * Die rechtlich wirkenden Sätze der Reisebilder, die in den Sprachen außer Deutsch und Englisch englisch stehen, bis der Betreiber eine eigene Fassung abgenommen hat
 * (WI-0272, Review S2b I4; `docs/regeln/oberflaeche.md` „Rechtstexte wirken rechtlich“; Muster `apps/web/src/legal/legal-texts.ts`).
 *
 * - Formular: die Erklärung am Häkchen (`photobox.haken.*`, ein Satz in drei Teilen), die Folgen der Nutzungswahl „Nur für Avesmaps“ und CC BY samt der gesperrten Wahl bei einer Avesmaps-Aufnahme,
 *   der Datenschutz-Kurzsatz.
 * - Bestätigung nach dem Einreichen: der Satz im Kasten „Persönlicher Link“ (`photobox.fertig.linkHinweis`: was nur der Link kann; Entwurf 8, 2026-11-01; seit Entwurf 9 ohne den Satz „Der Link selbst wird nirgends gespeichert“, weil das Häkchen „Auf diesem Gerät merken“ ihn im Browser ablegen kann).
 * - Statusseite: Frage und Folge der Umstellung auf CC BY („lässt sich nicht zurücknehmen“) und die zwei Sätze zum Offline-Nehmen („lässt sich nicht rückgängig machen“, Fristen der Angaben).
 *
 * Keine Testdatei (kein `.test.ts`): `i18n.test.ts` nimmt diese Schlüssel von den Satzzeichenregeln der Zielsprache aus (ein englischer Satz trägt kein spanisches „¿“), und
 * `photobox-rechtssaetze.test.ts` hält fest, dass sie Zeichen für Zeichen die englische Fassung sind.
 */
export const RECHTSSAETZE_ENGLISCH: readonly string[] = [
    "photobox.nutzung.erklaerung.avesmaps_only",
    "photobox.nutzung.erklaerung.cc-by-4.0",
    "photobox.nutzung.gesperrtAufnahme",
    "photobox.haken.vor",
    "photobox.haken.link",
    "photobox.haken.nach",
    "photobox.datenschutz",
    "photobox.fertig.linkHinweis",
    "photobox.status.nutzung.ccBy.frage",
    "photobox.status.nutzung.ccBy.folge",
    "photobox.status.text.offline",
    "photobox.status.offline.folge",
];

/** Die Sprachen, die diese Sätze englisch zeigen (alle außer Deutsch und Englisch). */
export const SPRACHEN_MIT_ENGLISCHEN_RECHTSSAETZEN = ["da", "es", "fr", "it", "nl", "pl", "sv"] as const;
