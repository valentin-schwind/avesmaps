/**
 * Wohin „Hinweise“ beim Öffnen führen: eine Kennung aus `LEGAL_NOTICES.hinweise`. Der Abschnitt, der sie trägt, klappt auf, und die Stelle rückt ins Bild; eine unbekannte Kennung öffnet nur das Fenster.
 *
 * - `bedienung`: der Abschnitt „Bedienung“ (die Taste „?“).
 * - `reisebilder`: der Abschnitt „Reisebilder“ mit den Bedingungen (der Verweis „Bedingungen“ im Formular „Eigenes Bild hinzufügen“).
 * - `datenschutz-bei-reisebildern`: die Stelle im Abschnitt „Datenschutz“ (der Verweis unter dem Kurzsatz im Formular).
 * - jede andere Kennung kommt aus einem Link (`?hinweis=`, `hinweis-adresse.ts`).
 *
 * Eine eigene Datei, weil Fenster und Aufrufer (die Seite, das Formular der Reisebilder) denselben Typ brauchen und eine Vue-Datei keinen Typ ausführt.
 * Dass die festen Ziele im Dokument stehen, prüft `apps/web/test/hinweise-dokument.test.ts`.
 */
export type HinweiseZiel = string;

/** Die beiden Ziele, die das Formular der Reisebilder anbietet. */
export type ReisebildHinweisZiel = "reisebilder" | "datenschutz-bei-reisebildern";
