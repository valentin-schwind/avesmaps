/**
 * Die eine Probe ins Tailnet (WI-0180 §7, §9, §11; Vertrag mit Claudio 2026-10-16): Antwortet die lokale Instanz diesem Browser?
 * Das Umgebungsmenü und der Knopf „Prüfen“ im Reiter „Umgebungen“ (WI-0204) nehmen dieselbe Funktion.
 *
 * - `mode: "no-cors"` und `credentials: "omit"`: Für „erreichbar ja/nein“ reicht die undurchsichtige Antwort, und die lokale Instanz
 *   muss Stage und Production nicht per CORS vertrauen. Jede HTTP-Antwort zählt als erreichbar, auch ein Fehlerstatus.
 * - Kurze Frist: Eine erreichbare Instanz antwortet in Millisekunden (gemessen 16 ms), eine nicht erreichbare scheitert sofort
 *   (kein Name außerhalb des Tailnets) oder erst nach rund 2 s (Rechner aus) — die Frist schneidet das ab.
 * - Nur HTTPS: Aus einer https-Seite blockt der Browser eine http-Adresse als gemischten Inhalt, egal was die CSP sagt.
 * - 🪤 Chrome fragt beim ersten Mal, ob die Seite auf „Geräte im lokalen Netzwerk“ zugreifen darf (Local Network Access, §7). Ohne
 *   Erlaubnis scheitert die Probe, und Lokal fehlt, wie außerhalb des Tailnets. Die CSP der Seite muss die Tailnet-Domain in
 *   `connect-src` erlauben (Stage und Production: Claudio).
 */
export async function lokalErreichbar(
    adresse: string,
    { abrufen = globalThis.fetch, fristMs = 1_000 }: { abrufen?: typeof fetch; fristMs?: number } = {},
): Promise<boolean> {
    let ziel: URL;
    try {
        ziel = new URL("/", adresse);
    } catch {
        return false;
    }
    if (ziel.protocol !== "https:") return false;
    try {
        await abrufen(ziel, {
            mode: "no-cors",
            credentials: "omit",
            cache: "no-store",
            signal: AbortSignal.timeout(fristMs),
        });
        return true;
    } catch {
        return false;
    }
}
