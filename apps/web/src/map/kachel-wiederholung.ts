import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Kacheln nach einem 503 noch einmal fragen (Thomas 4.2; Claudio 2026-10-19, `project-control/handovers/
 * 2026-10-19-stage-kacheln-503-antwort-an-claudia.md`): Bei jedem Rollout startet Fastify neu, und die Anmeldetür, die Nginx für JEDE
 * Anfrage fragt, fällt 2 bis 4 s aus; bei Migrationen startet auch Martin neu. Nginx antwortet dann 503. MapLibre lässt eine Kachel, die
 * so scheitert, leer stehen, bis sie zufällig neu angefragt wird.
 *
 * - Scheitert eine Kachel mit 503, fragt sie nach `WIEDERHOLUNG_MS` noch einmal, genau diese Kachel (`refreshTiles`), höchstens so oft
 *   wie die Liste lang ist; danach bleibt sie leer wie bisher. Die Wartezeiten liegen über dem Ausfall (Retry-After der Tür), ein
 *   Zufallsanteil verhindert, dass alle Karten im selben Augenblick wiederkommen.
 * - Andere Fehler (404 heißt: keine Kachel, 4xx sind keine Störung) bleiben, wie sie sind.
 * - Greift über `refreshTiles` zu (MapLibre 6.10); fehlt es, tut sie nichts.
 */

/** Wartezeit vor dem ersten, zweiten und dritten erneuten Versuch. */
export const WIEDERHOLUNG_MS = [2000, 5000, 12000] as const;

interface KachelFehler {
    error?: { status?: number } | undefined;
    sourceId?: string | undefined;
    tile?: { tileID?: { canonical?: { x: number; y: number; z: number } } } | undefined;
}

interface Uhr {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
    zufall(): number;
}

const ECHTE_UHR: Uhr = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    zufall: () => Math.random(),
};

/** Hängt die Wiederholung an die Karte; gibt das Abhängen zurück. */
export function installKachelWiederholung(map: MapLibreMap, uhr: Uhr = ECHTE_UHR): () => void {
    const innen = map as unknown as {
        refreshTiles?(sourceId: string, tileIds: { x: number; y: number; z: number }[]): void;
    };
    /** Je Kachel (`quelle/z/x/y`) die Zahl der Versuche. */
    const versuche = new Map<string, number>();
    const wartend = new Set<unknown>();

    const beiFehler = (ereignis: unknown): void => {
        const e = ereignis as KachelFehler;
        const kachel = e.tile?.tileID?.canonical;
        if (e.error?.status !== 503 || e.sourceId === undefined || kachel === undefined) return;
        if (typeof innen.refreshTiles !== "function") return;
        const schluessel = `${e.sourceId}/${String(kachel.z)}/${String(kachel.x)}/${String(kachel.y)}`;
        const schon = versuche.get(schluessel) ?? 0;
        const warte = WIEDERHOLUNG_MS[schon];
        if (warte === undefined) return;
        versuche.set(schluessel, schon + 1);
        const quelle = e.sourceId;
        const { x, y, z } = kachel;
        const handle = uhr.setTimeout(
            () => {
                wartend.delete(handle);
                if (map.getSource(quelle) !== undefined) innen.refreshTiles?.(quelle, [{ x, y, z }]);
            },
            warte + Math.round(uhr.zufall() * 500),
        );
        wartend.add(handle);
    };
    // Eine Kachel, die geladen hat, darf beim nächsten Ausfall wieder von vorn zählen.
    const beiDaten = (ereignis: unknown): void => {
        const e = ereignis as KachelFehler & { dataType?: string };
        const kachel = e.tile?.tileID?.canonical;
        if (e.dataType !== "source" || e.sourceId === undefined || kachel === undefined) return;
        versuche.delete(`${e.sourceId}/${String(kachel.z)}/${String(kachel.x)}/${String(kachel.y)}`);
    };
    map.on("error", beiFehler);
    map.on("data", beiDaten);
    return () => {
        map.off("error", beiFehler);
        map.off("data", beiDaten);
        for (const handle of wartend) uhr.clearTimeout(handle);
        wartend.clear();
    };
}
