import { TILE_REVISIONS_URL, readTileRevisions, type TileRevisions } from "@avesmaps3d/shared";
import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Die Kachelrevision der Quellen, die ein Editor ändert (WI-0128 E13; EDIT-0001 §6.3, N7): Orte, Wege und Wegnamen. Nach einer
 * Kartenoperation tragen ihre Kachel-URLs `?r=<Revision>`; die Revision ist die Nummer des Ereignisses `map.changed`, dieselbe in der
 * Quittung der eigenen Operation und im Ereignis, das jede andere Karte über `/ws` hört.
 *
 * - Die Revision geht nur vorwärts: Die eigene Quittung und das Ereignis derselben Operation laden einmal, nicht zweimal.
 * - `url` baut die Adresse, mit der der Stil die Quellen anlegt; `advance` tauscht sie an der laufenden Karte (`setTiles`). So fragt ein
 *   späterer Stilwechsel (`setStyle` mit `diff`) dieselben Adressen wieder an und lädt nicht noch einmal neu.
 * - 🔴 Die Revision hilft nur gegen Browser und Zwischenspeicher davor. Martin hält seinen eigenen Kachelspeicher und lässt ihn sich
 *   von `?r=` nicht ausreden (Befund N7, gemessen): Lokal läuft er ohne (`scripts/dev/start-martin.mjs`), Stage schätzt Claudio ein.
 * - 🔴 **Hängende Kacheln lösen** (Stage 2026-10-19, Thomas 4.2; `loeseHaengendeKacheln`): Nach jedem Wechsel sieht sie nach
 *   `NACHSCHAU_MS` nach, ob eine Kachel der Quellen hängt, und lädt sie frisch.
 * - **Nur, was sich geändert hat** (WI-0177, Thomas 2.3; Hauptorchestrierung 2026-10-19): Mit `nur` lädt `advance` nur diese Quellen
 *   (eine Wegänderung lädt Wege und Wegnamen, nicht die Orte; eine der Derographie Flächen, Schriftläufe, Kartennamen, Gewässer und
 *   Gipfel, Editor-Orchestrierung 2026-10-19), und nur die Hörer, die eine davon nennen. Jede Quelle merkt sich, mit
 *   welcher Revision sie zuletzt geladen hat: Eine, die so zurückblieb, holt mit der nächsten Revision auf, die sie betrifft, auch wenn
 *   diese nicht neuer ist als die jüngste (ein fremdes Ereignis, das nach der eigenen Quittung ankommt).
 * - 🔴 **Ein angehaltener Kachelverwalter verliert das Neuladen** (WI-0261 S5d2, Fund der Sichtprüfung 2026-10-30: nach „Fertig“ einer
 *   Farbe blieb Garethi in der alten Farbe, obwohl die Quelle `?r=` der neuen Revision trug; `nachladenWennAngehalten`). MapLibre 6.10
 *   hält den Verwalter einer Quelle an, sobald sich an einer ihrer Ebenen eine datengetriebene Eigenschaft, ein Filter oder eine Ebene
 *   ändert (`Style._updateLayer` → `pause()`), bis zum nächsten Bild. Kommt in dieser Zeit das Neuladen von `setTiles`
 *   (`sourceDataChanged`), verwirft `TileManager._dataHandler` es; beim Weiterlaufen lädt er nur „reloading“, und der Worker liest dabei die
 *   alte Kachel noch einmal (`reloadTile`), statt die neue Adresse zu holen. Die Quelle trägt dann die neue Revision und zeigt für immer
 *   den alten Stand. Darum sieht `advance` nach dem `setTiles` nach, ob der Verwalter beim Eintreffen des Inhalts angehalten war, und holt
 *   die Kacheln nach dem nächsten Bild frisch (`refreshTiles`, Zustand „expired“).
 * - **Die Revision von Anfang an** (WI-0283 H3): Eine Karte ohne `/ws` hört nie ein Ereignis, ihre Kacheln gingen ohne Revision; Nginx
 *   sagt dazu `no-cache`, und der Browser fragte jedes Mal nach. `beginne` setzt je Quelle das jüngste Ereignis, das sie betrifft, vor dem
 *   ersten Stil. Damit trägt dieselbe Kachel bei allen dieselbe Adresse, auch bei einer Karte, die das Ereignis gehört hat (K1 hält sie
 *   für alle). `current` bleibt davon unberührt: Es zählt, was diese Karte gehört hat.
 */
export interface EditRevision {
    /** Die aktuelle Revision; 0, solange diese Karte von keiner Änderung gehört hat. */
    readonly current: number;
    /** Die Kachel-URL einer Quelle mit der Revision, die diese Quelle gerade trägt. */
    url(base: string): string;
    /** Vor dem ersten Stil: die Revisionen vom Server, je Quelle das jüngste Ereignis, das sie betrifft (`quellenFuer` als Regel). */
    beginne(stand: TileRevisions, nachArt: Readonly<Record<string, readonly string[]>>): void;
    /**
     * Eine Revision: die Quellen der laufenden Karte neu laden, mit `nur` nur diese. `false`, wenn sie nicht neuer ist als die jüngste
     * (dann holen höchstens zurückgebliebene Quellen aus `nur` auf).
     */
    advance(map: MapLibreMap | undefined, revision: number, nur?: readonly string[]): boolean;
    /**
     * Hört jede neuere Revision, auch ohne Karte: für Daten, die keine Kachelquelle sind (die Bögen der Kraftlinien laden ihr Netz neu,
     * WI-0205 K5). Mit `quellen` nur, wenn eine Revision eine davon betrifft (ohne `nur` betrifft sie alle).
     */
    hoere(beiNeuer: (revision: number) => void, quellen?: readonly string[]): void;
}

interface TileSource {
    setTiles(tiles: string[]): unknown;
}

/** So lange nach einem Wechsel sieht sie nach hängenden Kacheln: gleich, wenn die Kacheln neu angefragt sind, und noch einmal später. */
export const NACHSCHAU_MS = [1500, 6000] as const;

/** Was MapLibre 6.10 innen an einer Kachel führt; nur gelesen und an einer hängenden der Zustand gesetzt. */
interface InnereKachel {
    state: string;
    abortController?: unknown;
    reloadPromise?: unknown;
    tileID?: { canonical?: { x: number; y: number; z: number } };
}
interface InnereKarte {
    style?: { tileManagers?: Record<string, { _inViewTiles?: { getAllTiles(): InnereKachel[] } }> };
    refreshTiles?(sourceId: string, tileIds: { x: number; y: number; z: number }[]): void;
}

/**
 * Löst Kacheln, die nie fertig werden (Stage 2026-10-19, Thomas 4.2: „Neue Fläche“ hing, Teile der Karte blieben leer). 🪤 MapLibre 6.10:
 * Scheitert eine Kachel (eine 503-Welle beim Neustart von Martin), steht sie auf „errored“; ein `setTiles` danach (die nächste Revision)
 * setzt sie auf „loading“ (`reload(true)`), und `loadTile` wartet dann auf die Antwort einer Anfrage, die längst vorbei ist
 * (`reloadPromise`, kein `abortController`). Sie bleibt für immer „loading“: Die Karte gilt nie als geladen, `idle` kommt nie, und die
 * Kachel bleibt leer. Gelöst: als gescheitert markiert und über `refreshTiles` neu geladen, der Weg „expired“ fragt frisch.
 *
 * Greift auf Innereien von MapLibre zu (`style.tileManagers`, `_inViewTiles`); fehlen sie in einer anderen Fassung, tut sie nichts.
 * Gibt die Zahl der gelösten Kacheln zurück.
 */
export function loeseHaengendeKacheln(map: MapLibreMap, quellen: readonly string[]): number {
    const innen = map as unknown as InnereKarte;
    const manager = innen.style?.tileManagers;
    if (manager === undefined || typeof innen.refreshTiles !== "function") return 0;
    let geloest = 0;
    for (const id of quellen) {
        const kacheln = manager[id]?._inViewTiles?.getAllTiles?.() ?? [];
        const haengend = kacheln.filter(
            (kachel) =>
                kachel.state === "loading" &&
                kachel.abortController === undefined &&
                kachel.reloadPromise !== undefined &&
                kachel.reloadPromise !== null &&
                kachel.tileID?.canonical !== undefined,
        );
        if (haengend.length === 0) continue;
        for (const kachel of haengend) kachel.state = "errored";
        innen.refreshTiles(
            id,
            haengend.map((kachel) => {
                const { x, y, z } = kachel.tileID!.canonical!;
                return { x, y, z };
            }),
        );
        geloest += haengend.length;
    }
    return geloest;
}

/** Was MapLibre 6.10 innen am Verwalter einer Quelle führt: ob er gerade angehalten ist (`pause()`). */
interface AngehalteneKarte {
    style?: { tileManagers?: Record<string, { _paused?: boolean } | undefined> };
}
/** Der Teil der Karte, den das Nachladen braucht; ein Test gibt eine Attrappe. */
type NachladeKarte = Pick<MapLibreMap, "on" | "off" | "once" | "refreshTiles" | "triggerRepaint">;

const angehalten = (map: unknown, id: string): boolean =>
    (map as AngehalteneKarte).style?.tileManagers?.[id]?._paused === true;

/** So viele Bilder wartet das Nachladen höchstens darauf, dass der Verwalter wieder läuft. */
const NACHLADEN_BILDER = 5;

/**
 * Lädt eine Quelle frisch, deren Neuladen nach `setTiles` ein angehaltener Verwalter verworfen hat (Kopf, „Ein angehaltener
 * Kachelverwalter“): nach dem nächsten Bild, wenn er wieder läuft, mit `refreshTiles` (alle Kacheln „expired“, also neu geholt).
 */
function holeNach(map: NachladeKarte, id: string, bilder = NACHLADEN_BILDER): void {
    map.once("render", () => {
        if (angehalten(map, id) && bilder > 1) {
            holeNach(map, id, bilder - 1);
            return;
        }
        try {
            map.refreshTiles(id);
        } catch {
            // Die Quelle ist inzwischen weg (ein anderer Stil): nichts nachzuholen.
        }
    });
    map.triggerRepaint();
}

/**
 * Setzt die neue Adresse einer Quelle und wacht darüber, dass sie wirklich geholt wird: Kommt der Inhalt von `setTiles`, während MapLibre den
 * Verwalter angehalten hat, ging das Neuladen verloren, und es wird nachgeholt (`holeNach`). Ein Wächter je Quelle; ein neuer ersetzt den
 * alten.
 */
export function setzeKachelnBewacht(
    map: NachladeKarte,
    id: string,
    source: TileSource,
    tiles: string[],
    waechter: Map<string, (event: unknown) => void>,
): void {
    // Eine Karte ohne Ereignisse (Attrappe) bekommt nur die Adresse.
    if (typeof map.on !== "function" || typeof map.off !== "function") {
        source.setTiles(tiles);
        return;
    }
    const alt = waechter.get(id);
    if (alt !== undefined) map.off("sourcedata", alt);
    const beiInhalt = (event: unknown): void => {
        const e = event as { sourceId?: unknown; sourceDataType?: unknown; sourceDataChanged?: unknown };
        if (e.sourceId !== id || e.sourceDataType !== "content" || e.sourceDataChanged !== true) return;
        map.off("sourcedata", beiInhalt);
        if (waechter.get(id) === beiInhalt) waechter.delete(id);
        if (angehalten(map, id)) holeNach(map, id);
    };
    waechter.set(id, beiInhalt);
    map.on("sourcedata", beiInhalt);
    source.setTiles(tiles);
}

const hasSetTiles = (source: unknown): source is TileSource =>
    typeof source === "object" && source !== null && typeof (source as TileSource).setTiles === "function";

interface Hoerer {
    readonly beiNeuer: (revision: number) => void;
    readonly quellen: readonly string[] | undefined;
    zuletzt: number;
}

/**
 * Liest die Revisionen vor dem ersten Stil. Scheitert das, startet die Karte wie zuvor ohne Revision: Das kostet nur Rückfragen, nie Inhalt.
 */
export async function ladeKachelStand(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<TileRevisions | undefined> {
    try {
        const antwort = await fetcher(TILE_REVISIONS_URL, { headers: { accept: "application/json" } });
        if (antwort.status !== 200) return undefined;
        return readTileRevisions(await antwort.json());
    } catch {
        return undefined;
    }
}

/** Die Adresse einer Quelle, die keinem Ereignis folgt, sondern einem Zeiger oder einem festen Stand: `?rev=`, wie die Gebiete. */
export const mitStand = (base: string, stand: string): string => `${base}?rev=${stand}`;

/** `sources`: Quelle der Karte → Kachel-URL ohne Revision. */
export function createEditRevision(
    sources: Readonly<Record<string, string>>,
    uhr: {
        setTimeout?: (callback: () => void, ms: number) => unknown;
        clearTimeout?: (handle: unknown) => void;
    } = {},
): EditRevision {
    const spaeter = uhr.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
    const abbrechen =
        uhr.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    let current = 0;
    const hoerer: Hoerer[] = [];
    /** Welche Revision diese Karte für jede Quelle zuletzt gehört hat; vorher gilt `start`. */
    const geladen = new Map<string, number>();
    /** Mit welcher Revision jede Quelle an den Start ging (`beginne`). */
    const start = new Map<string, number>();
    const quelleZu = new Map(Object.entries(sources).map(([id, base]) => [base, id]));
    /** Je Quelle der Wächter, der nach `setTiles` auf den Inhalt wartet (`setzeKachelnBewacht`). */
    const waechter = new Map<string, (event: unknown) => void>();
    let nachschau: unknown[] = [];
    /**
     * Je Quelle ihre eigene Revision: So fragt ein Stilwechsel nach einer reinen Wegänderung die Orte unter derselben Adresse wie zuvor an,
     * statt sie neu zu laden und den Zwischenspeicher zu verfehlen.
     */
    const url = (base: string): string => {
        const id = quelleZu.get(base);
        const revision = id === undefined ? current : (geladen.get(id) ?? start.get(id) ?? 0);
        return revision > 0 ? `${base}${base.includes("?") ? "&" : "?"}r=${String(revision)}` : base;
    };
    const betrifft = (nur: readonly string[] | undefined, quellen: readonly string[]): boolean =>
        nur === undefined || quellen.some((id) => nur.includes(id));
    return {
        get current() {
            return current;
        },
        url,
        beginne(stand, nachArt) {
            const alle = Object.keys(sources);
            // Mindestens 1: Sind alle Ereignisse aus der Aufbewahrung gefallen, trägt die Kachel trotzdem eine Revision.
            for (const id of alle) start.set(id, Math.max(1, stand.ohneArt));
            for (const [art, seq] of Object.entries(stand.arten)) {
                const zu = Object.hasOwn(nachArt, art) ? nachArt[art] : undefined;
                for (const id of zu ?? alle) {
                    const bisher = start.get(id);
                    if (bisher !== undefined && seq > bisher) start.set(id, seq);
                }
            }
        },
        advance(map, revision, nur) {
            if (!Number.isInteger(revision)) return false;
            const neu = revision > current;
            if (neu) current = revision;
            for (const h of hoerer) {
                if (h.zuletzt >= current) continue;
                if (h.quellen === undefined ? !neu : !betrifft(nur, h.quellen)) continue;
                h.zuletzt = current;
                h.beiNeuer(current);
            }
            let gewechselt = false;
            for (const [id, base] of Object.entries(sources)) {
                if (!betrifft(nur, [id]) || (geladen.get(id) ?? 0) >= current) continue;
                geladen.set(id, current);
                // Ohne Karte trägt der erste Stil die Revision (`url`).
                if (!map) continue;
                const source = map.getSource(id);
                if (hasSetTiles(source)) setzeKachelnBewacht(map, id, source, [url(base)], waechter);
                gewechselt = true;
            }
            if (map && gewechselt) {
                for (const handle of nachschau) abbrechen(handle);
                nachschau = NACHSCHAU_MS.map((ms) =>
                    spaeter(() => loeseHaengendeKacheln(map, Object.keys(sources)), ms),
                );
            }
            return neu;
        },
        hoere(beiNeuer, quellen) {
            hoerer.push({ beiNeuer, quellen, zuletzt: current });
        },
    };
}

/**
 * Was eine Operation an der Karte neu lädt, aus `affected` ihres Ereignisses: die Quellen, die `nachArt` den berührten Arten zuordnet
 * (Wege: Wege und Wegnamen; Landschaften, Teilflächen, Beschriftungen und Gipfel: die der Derographie); berührt sie eine Art ohne
 * Eintrag, alle (`undefined`). Ein Ereignis ohne `affected` (ein Auftrag) betrifft alle.
 */
export function quellenFuer(
    affected: unknown,
    nachArt: Readonly<Record<string, readonly string[]>>,
): readonly string[] | undefined {
    if (!Array.isArray(affected) || affected.length === 0) return undefined;
    const quellen = new Set<string>();
    for (const a of affected) {
        const art = typeof a === "object" && a !== null ? (a as { kind?: unknown }).kind : undefined;
        const zu = typeof art === "string" && Object.hasOwn(nachArt, art) ? nachArt[art] : undefined;
        if (zu === undefined) return undefined;
        for (const id of zu) quellen.add(id);
    }
    return [...quellen];
}

/**
 * Fremde Ereignisse höchstens alle `abstandMs` (WI-0177, Thomas 2.3; Hauptorchestrierung 2026-10-19: „Andere Karten nehmen eine neue
 * Revision höchstens alle 3 s, die letzte gewinnt“). Schreiben Editoren in kurzer Folge (mehrere „Fertig“, mehrere Bearbeiter), lädt eine
 * zuschauende Karte sonst bei jedem fremden Ereignis nach (gemessen alle zwei Sekunden, als die Wegkurve jeden Handgriff schrieb;
 * Rückbau 2026-10-31, EDIT-0003 G4). Ein fremdes Ereignis wartet `abstandMs` und nimmt mit, was in der Zwischenzeit kommt: die höchste Revision, die Quellen
 * aller Ereignisse. Die eigene Quittung geht nicht hier durch, sie lädt sofort.
 */
export interface RevisionsDrossel {
    melde(revision: number, nur: readonly string[] | undefined): void;
    destroy(): void;
}

export function createRevisionsDrossel(optionen: {
    readonly abstandMs: number;
    anwenden(revision: number, nur: readonly string[] | undefined): void;
    readonly now?: () => number;
    readonly setTimeout?: (fn: () => void, ms: number) => unknown;
    readonly clearTimeout?: (handle: unknown) => void;
}): RevisionsDrossel {
    const now = optionen.now ?? (() => Date.now());
    const planen = optionen.setTimeout ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
    const absagen =
        optionen.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let letzte = Number.NEGATIVE_INFINITY;
    let wartend: { revision: number; nur: readonly string[] | undefined } | undefined;
    let uhr: unknown;
    const wendeAn = (): void => {
        uhr = undefined;
        const jetzt = wartend;
        wartend = undefined;
        if (jetzt === undefined) return;
        letzte = now();
        optionen.anwenden(jetzt.revision, jetzt.nur);
    };
    return {
        melde(revision, nur) {
            wartend =
                wartend === undefined
                    ? { revision, nur }
                    : {
                          revision: Math.max(wartend.revision, revision),
                          nur:
                              wartend.nur === undefined || nur === undefined
                                  ? undefined
                                  : [...new Set([...wartend.nur, ...nur])],
                      };
            if (uhr !== undefined) return;
            // Erst sammeln, dann laden: `abstandMs` nach diesem Ereignis, frühestens `abstandMs` nach dem letzten Laden.
            const t = now();
            uhr = planen(wendeAn, Math.max(t + optionen.abstandMs, letzte + optionen.abstandMs) - t);
        },
        destroy() {
            if (uhr !== undefined) absagen(uhr);
            uhr = undefined;
            wartend = undefined;
        },
    };
}
