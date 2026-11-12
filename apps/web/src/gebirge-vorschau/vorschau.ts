import GebirgsVorschauWorker from "./vorschau-worker.ts?worker";
import { vorschauWarteschlange, type GebirgsVorschau } from "./warteschlange";

export { VORSCHAU_KANTE_FEIN, VORSCHAU_KANTE_GROB, type VorschauAuftrag, type VorschauErgebnis } from "./auftrag";
export type { GebirgsVorschau } from "./warteschlange";

/**
 * Der Einstieg der Oberfläche in die Gebirge-Vorschau (WI-0226): EIN Worker mit der V12, eine Rechnung zur Zeit (`warteschlange.ts`).
 * Die V12 steckt nur im Worker-Bündel; das Hauptbündel lädt sie erst mit dem ersten Auftrag.
 */
export function gebirgsVorschau(): GebirgsVorschau {
    return vorschauWarteschlange(() => new GebirgsVorschauWorker());
}
