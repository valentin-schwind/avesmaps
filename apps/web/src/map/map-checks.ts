import { computed, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { isMapCheck, MAP_CHECKS, MAP_CHECKS_URL, type MapCheck, type MapCheckResult } from "@avesmaps3d/shared";
import { authState, type AuthSnapshot } from "../auth/session-state";

/**
 * Die Prüfhaken im Auge (WI-0131 Stufe 1): welche an sind, und was ihr Prüfer meldet.
 *
 * - 🔴 **Nicht in der Adresse.** Ein geteilter Link schaltet bei Besuchern nichts ein. Der Browser merkt sich die Haken je Person
 *   (`localStorage`, jeder Zugriff in try/catch: gesperrte Website-Daten werfen schon beim Lesen).
 * - **Laden erst beim Einschalten.** Jeder Haken holt seine Funde einzeln (`GET /api/editor/checks/:check`); ein unveränderter Stand
 *   kommt mit dem ETag als 304 aus dem Cache des Browsers (`cache: "no-cache"`, wie die Ortsliste des Ortseditors). Ausschalten
 *   bricht ein laufendes Laden ab und wirft die Funde weg.
 * - **Ohne Recht nichts.** Wer `use_editor_menu` nicht hat, sieht die Haken nicht, und gemerkte Haken laden nicht. Der Server prüft
 *   trotzdem jede Anfrage.
 * - 🔴 **Die Sitzung entscheidet, nicht die gemeldete Ansicht** (Fehlerbericht 2026-10-10): Ohne Anmeldung meldet der Server die
 *   Übergangsansicht samt `use_editor_menu`, der Leseweg verlangt aber eine Sitzung (401). Bei eingerichteter Anmeldung zählen
 *   deshalb nur eine angemeldete Person und ihr Recht (`checksAllowedBySession`), und das folgt der Sitzung, wenn sie sich ändert.
 * - **Eine Absage steht am Haken** (`problems`): 401/403 als „nur angemeldet mit Editorrechten“, alles andere als „gerade nicht
 *   ladbar“. Der Haken bleibt an; ausschalten nimmt den Satz weg.
 */

/** Warum ein Haken nichts zeigt: keine Rechte (401/403) oder eine Störung (alles andere). */
export type MapCheckProblem = "rechte" | "stoerung";

/**
 * Dürfen die Haken laden? Bei eingerichteter Anmeldung nur mit angemeldeter Person, die `use_editor_menu` hat. Ohne eingerichtete
 * Anmeldung (lokal hinter Basic Auth) oder ohne Antwort des Servers entscheidet allein die Ansicht (`bootstrap-viewer.ts`).
 */
export function checksAllowedBySession(session: AuthSnapshot): boolean {
    if (!session.known || !session.authEnabled) return true;
    return session.person !== null && session.capabilities.includes("use_editor_menu");
}

/** Die Absagen je Haken für das Auge: dieselbe Tafel, die `useMapChecks` füllt (das Auge hängt nicht an `app.vue`). */
export const mapCheckProblems = shallowRef<Partial<Record<MapCheck, MapCheckProblem>>>({});

/** Ein Haken, den der Server abgesagt hat, mit seinem Status. */
export class MapCheckRefused extends Error {
    readonly check: MapCheck;
    readonly status: number;
    constructor(check: MapCheck, status: number) {
        super(`Prüfhaken ${check}: HTTP ${String(status)}`);
        this.check = check;
        this.status = status;
    }
}

/** Was vom Speicher gebraucht wird; `localStorage` erfüllt es, ein Test legt eine Tafel hin. */
export type ChecksStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_PREFIX = "avesmaps3d.pruefhaken";

/** Der Schlüssel je Person; ohne bekannte Person (Instanz ohne Anmeldung) einer für diesen Browser. */
export function checksStorageKey(personId: string | undefined): string {
    return personId === undefined ? STORAGE_PREFIX : `${STORAGE_PREFIX}.${personId}`;
}

/** Die gemerkten Haken, in der Reihenfolge des Auges; Unbekanntes und Kaputtes zählt nicht. */
export function readStoredChecks(storage: ChecksStorage | undefined, key: string): MapCheck[] {
    let raw: string | null;
    try {
        raw = storage?.getItem(key) ?? null;
    } catch {
        return [];
    }
    if (raw === null) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        const known = new Set(parsed.filter((entry): entry is string => typeof entry === "string").filter(isMapCheck));
        return MAP_CHECKS.filter((check) => known.has(check));
    } catch {
        return [];
    }
}

export function storeChecks(storage: ChecksStorage | undefined, key: string, checks: readonly MapCheck[]): void {
    try {
        storage?.setItem(key, JSON.stringify(checks));
    } catch {
        // Gesperrter oder voller Speicher: Die Haken gelten bis zum Neuladen.
    }
}

export function browserChecksStorage(): ChecksStorage | undefined {
    try {
        return globalThis.localStorage ?? undefined;
    } catch {
        return undefined;
    }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Die Funde eines Hakens. Wirft bei einem Fehler; der Aufrufer zeigt dann für diesen Haken nichts. */
export async function fetchMapCheck(
    check: MapCheck,
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<MapCheckResult> {
    const response = await fetcher(`${MAP_CHECKS_URL}/${check}`, {
        method: "GET",
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-cache",
        signal,
    });
    if (!response.ok) throw new MapCheckRefused(check, response.status);
    const body = (await response.json()) as MapCheckResult;
    if (body.check !== check) throw new Error(`Prüfhaken ${check}: Antwort für ${String(body.check)}`);
    return body;
}

/** Die Funde je eingeschaltetem Haken, sobald sie da sind. */
export type MapCheckResults = Partial<{ [K in MapCheck]: Extract<MapCheckResult, { check: K }> }>;

export interface MapChecksState {
    /** Die eingeschalteten Haken, in der Reihenfolge des Auges. */
    enabled: Ref<readonly MapCheck[]>;
    /** Was die Karte zeichnet: die geladenen Funde der eingeschalteten Haken. */
    results: Readonly<ShallowRef<MapCheckResults>>;
    /** Warum ein eingeschalteter Haken nichts zeigt. */
    problems: Readonly<ShallowRef<Partial<Record<MapCheck, MapCheckProblem>>>>;
}

export function useMapChecks(options: {
    /** Darf dieser Betrachter die Haken sehen (`use_editor_menu`)? */
    allowed: boolean;
    /** Die Person, für die der Browser die Haken merkt. */
    personId: string | undefined;
    storage?: ChecksStorage | undefined;
    fetcher?: Fetcher;
    /** Die Sitzung; ohne Angabe die des Browsers (`authState`). */
    session?: Readonly<Ref<AuthSnapshot>>;
}): MapChecksState {
    const storage = options.storage ?? browserChecksStorage();
    const key = checksStorageKey(options.personId);
    const session = options.session ?? authState;
    const allowed = computed(() => options.allowed && checksAllowedBySession(session.value));
    const enabled = shallowRef<readonly MapCheck[]>(allowed.value ? readStoredChecks(storage, key) : []);
    const results = shallowRef<MapCheckResults>({});
    const problems = mapCheckProblems;
    problems.value = {};
    const loading = new Map<MapCheck, AbortController>();
    const setProblem = (check: MapCheck, problem: MapCheckProblem | undefined): void => {
        const next = { ...problems.value };
        if (problem === undefined) delete next[check];
        else next[check] = problem;
        problems.value = next;
    };

    const load = (check: MapCheck): void => {
        const controller = new AbortController();
        loading.set(check, controller);
        fetchMapCheck(check, controller.signal, options.fetcher)
            .then((result) => {
                if (controller.signal.aborted) return;
                results.value = { ...results.value, [check]: result };
                setProblem(check, undefined);
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                const refused = error instanceof MapCheckRefused && (error.status === 401 || error.status === 403);
                setProblem(check, refused ? "rechte" : "stoerung");
            })
            .finally(() => {
                if (loading.get(check) === controller) loading.delete(check);
            });
    };

    // Ändert sich die Sitzung (abgemeldet, ein anderes Konto), fallen die Haken aus, die nicht mehr dürfen.
    watch(allowed, (may) => {
        if (!may) enabled.value = [];
    });
    watch(
        enabled,
        (next, before) => {
            if (!allowed.value && next.length > 0) {
                enabled.value = [];
                return;
            }
            const on = new Set(next);
            for (const check of before ?? []) {
                if (on.has(check)) continue;
                loading.get(check)?.abort();
                loading.delete(check);
                setProblem(check, undefined);
                if (check in results.value) {
                    const rest = { ...results.value };
                    delete rest[check];
                    results.value = rest;
                }
            }
            for (const check of next) if (!(before ?? []).includes(check)) load(check);
            if (before !== undefined) storeChecks(storage, key, next);
        },
        { immediate: true },
    );

    return { enabled, results, problems };
}
