import type { VorschauAuftrag } from "./auftrag";
import { rechneVorschau } from "./rechnen";

/**
 * Der Worker der Gebirge-Vorschau (WI-0226): nimmt einen Auftrag mit Nummer, rechnet und schickt das Ergebnis zurück. Die Felder gehen
 * als übertragbare Puffer hinüber; ein Fehler kommt als `fehler` zurück, statt den Worker zu beenden.
 */
interface WorkerZiel {
    onmessage: ((ereignis: MessageEvent<{ nr: number; auftrag: VorschauAuftrag }>) => void) | null;
    postMessage(nachricht: unknown, uebertragen?: Transferable[]): void;
}
const ziel = self as unknown as WorkerZiel;

ziel.onmessage = (ereignis) => {
    const { nr, auftrag } = ereignis.data;
    try {
        const ergebnis = rechneVorschau(auftrag);
        ziel.postMessage({ nr, ergebnis }, [ergebnis.h.buffer, ergebnis.eigen.buffer]);
    } catch (fehler) {
        ziel.postMessage({ nr, fehler: fehler instanceof Error ? fehler.message : String(fehler) });
    }
};
