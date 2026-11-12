/**
 * Lehnt der Server wegen Last ab, fragt der Browser selbst noch einmal (Betreiber 2026-09-27): nach der Pause aus
 * `Retry-After`, höchstens dreimal. Die Route (`route-client.ts`) sagt danach, warum sie fehlt; die Landschaften
 * (`route-landscapes.ts`) bleiben still weg (`holeBeigabe`); das Infopanel (`info-panel/subject-client.ts`) zeigt seine Meldung wie bisher.
 * Die Wappen der Gebiete (`map/territory-coat-images.ts`, WI-0123) holen einen gescheiterten Abruf ebenso nach.
 */
export const LOAD_ATTEMPTS = 3;
/** Ohne Angabe 2 s, wie der Server sie nennt (routes/route.ts, routes/landscapes.ts); länger als 5 s wartet niemand gern. */
const RETRY_AFTER_DEFAULT_MS = 2000;
const RETRY_AFTER_MAX_MS = 5000;

/** Die Pause vor dem nächsten Versuch; ohne Antwort (Netzfehler) oder ohne `Retry-After` die Vorgabe. */
export function retryAfterMs(response?: { headers?: Pick<Headers, "get"> }): number {
    const seconds = Number.parseFloat(response?.headers?.get("retry-after") ?? "");
    return Number.isFinite(seconds) && seconds >= 0
        ? Math.min(seconds * 1000, RETRY_AFTER_MAX_MS)
        : RETRY_AFTER_DEFAULT_MS;
}

/** Eine Pause, die der Planer abbrechen kann, mit demselben `AbortError` wie `fetch`. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        function onAbort(): void {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Die Drossel vor der Anwendung (WI-0292, Vali 2026-11-09: der Planer lief in Production schnell in sie hinein): Nginx zählt je Adresse jede Frage der Reise (Route,
 * Landschaften, Unterwegs, Etappe) in EINER Zone und antwortet über der Grenze mit 429 `rate_limited` und `Retry-After 60` (`location @zu_viel`). Die Zone gibt alle drei
 * Sekunden wieder eine Frage frei (20 je Minute); länger als bis dahin wartet eine Beigabe nicht, auch wenn der Kopf 60 s nennt.
 */
export const DROSSEL_PAUSE_MAX_MS = 3000;

/** Die Absage wegen Last eines Beigaben-Dienstes: 503 `busy` mit `Retry-After` (Zweierschranke je Prozess, `routes/landscapes.ts`, `routes/stage-lore.ts`). */
async function isBusy(response: Response): Promise<boolean> {
    if (response.status !== 503) return false;
    const body = (await response.json().catch(() => ({}))) as { error?: unknown };
    return body.error === "busy";
}

/** Was eine Beigabe bringt: die Antwort oder `null`; `gedrosselt`, wenn es an der Drossel scheiterte (dann fragt niemand gleich noch einmal). */
export interface Beigabe<T> {
    antwort: T | null;
    gedrosselt: boolean;
}

/**
 * Eine Beigabe holen (Landschaften, Unterwegs, Vorkommen der Etappe): still, ohne Meldung. Eine Absage wegen Last (503 `busy`) fragt bis zu `LOAD_ATTEMPTS`-mal, nach der Pause
 * aus `Retry-After`. Die Drossel (429) fragt EINMAL still nach, nach höchstens `DROSSEL_PAUSE_MAX_MS` (WI-0292: vorher fiel die Zeile bei 429 einfach weg). Jeder andere Fehler, ein
 * Netzfehler und der Abbruch geben `null`.
 */
export async function holeBeigabe<T>(
    url: string,
    init: RequestInit,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<Beigabe<T>> {
    const signal = init.signal ?? undefined;
    let nachgeholt = false;
    try {
        for (let attempt = 1; ; attempt += 1) {
            const response = await fetcher(url, init);
            if (response.ok) return { antwort: (await response.json()) as T, gedrosselt: false };
            if (response.status === 429) {
                if (nachgeholt) return { antwort: null, gedrosselt: true };
                nachgeholt = true;
                await pause(Math.min(retryAfterMs(response), DROSSEL_PAUSE_MAX_MS), signal);
                continue;
            }
            if (attempt >= LOAD_ATTEMPTS || !(await isBusy(response))) return { antwort: null, gedrosselt: false };
            await pause(retryAfterMs(response), signal);
        }
    } catch {
        return { antwort: null, gedrosselt: false };
    }
}
