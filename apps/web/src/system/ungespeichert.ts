/**
 * Gibt es gerade ungespeicherte Arbeit? (WI-0136 N1, NACHRICHT-0001 §2). „Neu laden“ fragt dann erst nach, statt sie wegzuwerfen
 * (Betreiber 2026-10-11, Formfrage 2 A). Wer Arbeit offen halten kann, meldet eine Quelle an; die Wahrheit bleibt bei ihr (für das
 * Editorpanel der Fensterstand mit `ungespeichert` je Werkzeugfenster, angemeldet in `app.vue`).
 */

type Quelle = () => boolean;

const quellen = new Set<Quelle>();

/** Meldet eine Quelle an; zurück kommt das Abmelden. */
export function meldeQuelle(quelle: Quelle): () => void {
    quellen.add(quelle);
    return () => {
        quellen.delete(quelle);
    };
}

/** Wahr, sobald eine Quelle ungespeicherte Arbeit hat; eine Quelle, die wirft, zählt als „ja“ (lieber einmal zu oft gefragt). */
export function hatUngespeichert(): boolean {
    for (const quelle of quellen) {
        try {
            if (quelle()) return true;
        } catch {
            return true;
        }
    }
    return false;
}

// Browsertests melden im Entwicklungsbuild eine Quelle an, ohne ein Werkzeugfenster zu öffnen.
if (import.meta.env.DEV)
    (globalThis as { __avesmapsUngespeichert?: typeof meldeQuelle }).__avesmapsUngespeichert = meldeQuelle;
