/**
 * Das Quellsystem des Werks einer Datei (`media_asset.source_system`). Eine eigene Datei, weil der Aufseher der Aufträge sie liest (`original-loeschen.ts`) und `db.ts` über die Medienverwaltung sharp
 * mitbringt: Die Bildbibliothek lädt nur der Kindprozess eines Auftrags.
 */
export const KARTENVORSCHLAG_QUELLSYSTEM = "kartenvorschlag";
