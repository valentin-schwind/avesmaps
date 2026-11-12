import { releaseStand, type UmgebungGegenseite } from "@avesmaps3d/shared";

/**
 * Der Stand der Gegenseite für das Umgebungsmenü (WI-0180 §9; Vertrag mit Claudio,
 * `project-control/handovers/2026-10-16-umgebungsmenue-stand-und-tailnet-an-claudia.md`):
 *
 * - Gefragt wird `/health` der anderen Umgebung auf Loopback. Die Adresse kommt nur aus der Konfiguration
 *   (`GEGENSEITE_HEALTH_URL`), nie aus einer Anfrage: Ein Ziel, das nicht auf 127.0.0.1, `localhost` oder `[::1]` zeigt, gilt als
 *   nicht eingerichtet. So gibt es keinen Weg, den Server nach außen fragen zu lassen.
 * - Frist 1 s (die Antwort kommt in Millisekunden), Zwischenspeicher 30 s für alle Anfragen zusammen, damit nicht jeder offene Tab
 *   nachfragt. Während eine Frage läuft, warten weitere auf dieselbe.
 * - Weiter geht nur `releaseId` in der Form eines `RELEASE_ID` (`releaseStand`) und „erreichbar“; was die Gegenseite sonst schickt,
 *   bleibt hier.
 * - Ein Fehler ist nie ein 500: Antwortet die Gegenseite nicht, heißt es „nicht erreichbar“.
 */

export interface GegenseiteOptionen {
    abrufen?: typeof fetch;
    jetzt?: () => number;
    fristMs?: number;
    haltenMs?: number;
    warn?: (meldung: string) => void;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Die geprüfte Adresse oder undefined; eine ungültige meldet `warn` einmal beim Start. */
export function gegenseiteAdresse(
    roh: string | undefined,
    warn: (meldung: string) => void = () => {},
    name = "GEGENSEITE_HEALTH_URL",
): URL | undefined {
    if (roh === undefined || roh.trim() === "") return undefined;
    let url: URL;
    try {
        url = new URL(roh);
    } catch {
        warn(`${name} ist keine Adresse und bleibt ungenutzt: ${roh}`);
        return undefined;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !LOOPBACK.has(url.hostname)) {
        warn(`${name} zeigt nicht auf Loopback und bleibt ungenutzt: ${url.origin}`);
        return undefined;
    }
    return url;
}

/** Ein Leser mit Zwischenspeicher; ohne gültige Adresse liefert er immer null. */
export function gegenseiteLeser(
    roh: string | undefined,
    { abrufen = fetch, jetzt = Date.now, fristMs = 1_000, haltenMs = 30_000, warn }: GegenseiteOptionen = {},
): () => Promise<UmgebungGegenseite | null> {
    const adresse = gegenseiteAdresse(roh, warn);
    if (adresse === undefined) return () => Promise.resolve(null);
    let gemerkt: { bis: number; stand: Promise<UmgebungGegenseite> } | undefined;
    return () => {
        const nun = jetzt();
        if (gemerkt === undefined || nun >= gemerkt.bis) {
            gemerkt = { bis: nun + haltenMs, stand: fragen(adresse, abrufen, fristMs) };
        }
        return gemerkt.stand;
    };
}

async function fragen(adresse: URL, abrufen: typeof fetch, fristMs: number): Promise<UmgebungGegenseite> {
    try {
        const antwort = await abrufen(adresse, { signal: AbortSignal.timeout(fristMs), redirect: "error" });
        if (!antwort.ok) return { releaseId: null, erreichbar: false };
        const inhalt: unknown = await antwort.json().catch(() => null);
        const roh =
            typeof inhalt === "object" && inhalt !== null && "releaseId" in inhalt
                ? (inhalt as { releaseId: unknown }).releaseId
                : null;
        return { releaseId: typeof roh === "string" && releaseStand(roh) !== null ? roh : null, erreichbar: true };
    } catch {
        return { releaseId: null, erreichbar: false };
    }
}
