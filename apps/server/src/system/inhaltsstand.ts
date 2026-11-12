import {
    AVENTURIA_SERIES,
    CONTENT_SWITCHES,
    LICENSE_SWITCH_PREFIX,
    SERIES_SWITCH_PREFIX,
    contentSwitchSpec,
    type AdminContentSwitches,
    type ContentSwitchSpec,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { kartenserienKatalog, leseKartenserien } from "../map-series/stand.ts";
import { isMissingTable } from "./state-row.ts";

/**
 * Der Stand der Inhaltsschalter auf dem Server, nur lesend (WI-0127 SYS-10, SYS-0001 §3.4): welche Schalter es gibt (Katalog plus
 * Lizenzfamilien und Kartenserien), was gerade gilt (Store je Instanz, nachgelesen, sobald sich `system_state.content_revision` ändert),
 * und für Wirkungsorte, die nur die Datenbank kennen, `inhaltsstandFuer`. Umschalten und Lesemodell stehen in `inhaltsschalter.ts`.
 *
 * 🔴 Ohne Fastify und ohne `ApiError`: Werkzeuge wie der Binärimport und `verify-media` laden dieses Modul über Resolver und Quarantäne.
 *
 * - **Fehlerrichtung:** Ist die Tafel nie gelesen worden (Datenbank weg seit dem Start, oder die Rolle darf sie nicht lesen), gelten die
 *   Bilder-Schalter als „aus“ (`closed`), alle übrigen als an. Danach gilt der letzte gelesene Stand. Fehlt die Tafel (vor 0102), gilt die
 *   Vorgabe (alles an) wie bisher. Der Fehler steht dabei im Protokoll (einmal je Fehler), nie stumm.
 * - Ein Schlüssel in der Tafel, den der Katalog nicht kennt, wird ignoriert und gemeldet (`unknownKeys`).
 */

/**
 * Die Kartenserien der Vorgabe, die Besucher sehen (Blatt A5): nur noch der Stand, bevor die Tafel gelesen ist. Seit WI-0220 lässt
 * sich JEDE Serie des wirksamen Katalogs ausschalten (Sichtbarkeit „Niemand“, Vorlage Fassung 4, Betreiber 2026-10-18 abgenommen),
 * auch eine nur für Editoren; mindestens eine für alle sichtbare bleibt an (409 `last_series`, gezählt über `oeffentlicheSerien`).
 */
export const SCHALTBARE_SERIEN: readonly string[] = AVENTURIA_SERIES.series
    .filter((series) => series.visibility !== "EDITOR_ONLY" && !series.labelsInImage)
    .map((series) => series.id);

export interface Bekannt {
    licenseFamilies: readonly string[];
    series: readonly string[];
    /** Die für alle sichtbaren Serien; ohne Angabe gelten `series` (vor WI-0220 waren das dieselben). */
    oeffentlicheSerien?: readonly string[];
}

/** Die Lizenzfamilien aus `license_catalog` (fehlt die Tafel, keine) und die Serien des wirksamen Katalogs (WI-0220). */
export async function bekannteSchalter(db: Queryable): Promise<Bekannt> {
    const katalog = kartenserienKatalog(await leseKartenserien(db));
    const serien = {
        series: katalog.series.map((s) => s.id),
        // Mit Beschriftung im Bild sehen Besucher eine Serie nur unter „Nur Karte“ (Betreiber 2026-11-10): Sie hält die Karte nicht.
        oeffentlicheSerien: katalog.series
            .filter((s) => s.visibility !== "EDITOR_ONLY" && !s.labelsInImage)
            .map((s) => s.id),
    };
    try {
        const rows = await db<{ family: string }[]>`SELECT DISTINCT family FROM license_catalog ORDER BY family`;
        return { licenseFamilies: rows.map((row) => row.family), ...serien };
    } catch (error) {
        if (isMissingTable(error)) return { licenseFamilies: [], ...serien };
        throw error;
    }
}

/** Alle Schalter in der Reihenfolge der Tafeln: die festen, dann je Lizenzfamilie, dann je Kartenserie. */
export function alleSchalter(bekannt: Bekannt): ContentSwitchSpec[] {
    const fest = CONTENT_SWITCHES;
    const rechte = fest.filter((entry) => entry.group === "media_rights");
    const lizenzen = bekannt.licenseFamilies.map((family) =>
        contentSwitchSpec(`${LICENSE_SWITCH_PREFIX}${family}`, bekannt)!,
    );
    const serien = bekannt.series.map((id) => contentSwitchSpec(`${SERIES_SWITCH_PREFIX}${id}`, bekannt)!);
    return [
        ...fest.filter((entry) => entry.group === "media_role"),
        ...rechte,
        ...lizenzen,
        ...fest.filter((entry) => entry.group === "panel"),
        ...serien,
        ...fest.filter((entry) => entry.group === "map"),
        ...fest.filter((entry) => entry.group === "betrieb"),
    ];
}

export interface SchalterZeile {
    enabled: boolean;
    changedAt: Date;
    changedBy: string | null;
}

export interface Inhaltsstand {
    source: AdminContentSwitches["source"];
    revision: number | null;
    zeilen: ReadonlyMap<string, SchalterZeile>;
    bekannt: Bekannt;
    unknownKeys: string[];
}

/** Ist der Schalter gerade aus? Nie gelesen: Bilder aus (`closed`), Rest an; ein unbekannter Schlüssel ist nie aus. */
export function istAus(stand: Inhaltsstand, key: string): boolean {
    const spec = contentSwitchSpec(key, stand.bekannt);
    if (spec === undefined) return false;
    if (stand.source === "unknown") return spec.failure === "closed";
    const zeile = stand.zeilen.get(key);
    return zeile !== undefined && !zeile.enabled;
}

/** Die Schlüssel, die gerade aus sind (für `GET /api/content-state` und die Zeile „Gerade pausiert“). */
export function ausgeschaltet(stand: Inhaltsstand): string[] {
    return alleSchalter(stand.bekannt)
        .map((spec) => spec.key)
        .filter((key) => istAus(stand, key));
}

/**
 * Liest Tafel, Lizenzfamilien und die Inhaltsrevision AUS DER DATENBANK (nie aus dem Speicher des Betriebszustands, der den Weckruf erst
 * nach dem COMMIT bekommt: sonst trüge die Antwort nach dem eigenen Umschalten eine veraltete `baseRevision`). `unprovisioned`, wenn die
 * Tafel fehlt. Fehler der Datenbank wirft der Aufrufer weiter.
 */
/**
 * Liest den Stand. `personen: false` für Rollen ohne Zugriff auf das Anmeldeschema (die Jobs-Rolle im Quarantäne-Abgleich): `changedBy`
 * trägt dann nur das Etikett der Kommandozeile.
 */
export async function leseInhaltsstand(
    db: Queryable,
    { personen = true }: { personen?: boolean } = {},
): Promise<Inhaltsstand> {
    const bekannt = await bekannteSchalter(db);
    let revision: number | null = null;
    try {
        const [state] = await db<
            { revision: number }[]
        >`SELECT content_revision::int AS revision FROM system_state WHERE id = 1`;
        revision = state?.revision ?? null;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    let rows: { key: string; enabled: boolean; changed_at: Date; changed_by: string | null }[];
    try {
        rows = personen
            ? await db`
                SELECT c.key, c.enabled, c.changed_at, COALESCE(p.display_name, c.changed_by_label) AS changed_by
                  FROM content_switch c
                  LEFT JOIN avesmaps_auth.person p ON p.id = c.changed_by
            `
            : await db`SELECT key, enabled, changed_at, changed_by_label AS changed_by FROM content_switch`;
    } catch (error) {
        if (isMissingTable(error))
            return { source: "unprovisioned", revision, zeilen: new Map(), bekannt, unknownKeys: [] };
        throw error;
    }
    const zeilen = new Map<string, SchalterZeile>();
    const unknownKeys: string[] = [];
    for (const row of rows) {
        if (contentSwitchSpec(row.key, bekannt) === undefined) unknownKeys.push(row.key);
        else zeilen.set(row.key, { enabled: row.enabled, changedAt: row.changed_at, changedBy: row.changed_by });
    }
    return { source: "database", revision, zeilen, bekannt, unknownKeys: unknownKeys.sort() };
}

/** Die Inhaltsschalter, wie `decidePublication` sie fragt (`switches`). */
export function schalterVon(stand: Inhaltsstand): { isOff(key: string): boolean } {
    return { isOff: (key) => istAus(stand, key) };
}

const UNBEKANNT: Inhaltsstand = {
    source: "unknown",
    revision: null,
    zeilen: new Map(),
    bekannt: { licenseFamilies: [], series: SCHALTBARE_SERIEN },
    unknownKeys: [],
};

/** Der Store je Datenbank der Anwendung; ein Store meldet sich hier selbst an (`inhaltsstandFuer`). */
const STORES = new WeakMap<Queryable, InhaltsschalterStore>();

/** Ein Lesefehler als eine Zeile für das Protokoll: SQLSTATE und Text. */
function lesefehlerText(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    const text = error instanceof Error ? error.message : String(error);
    return typeof code === "string" ? `${code}: ${text}` : text;
}

/** Der Lesefehler, den `inhaltsstandFuer` zuletzt gemeldet hat: derselbe steht nicht bei jedem Bild wieder im Protokoll, nach einem gelungenen Lesen wieder. */
let letzterLesefehler: string | undefined;

/**
 * Der Stand für einen Wirkungsort, der nur die Datenbank kennt (der Medien-Resolver): über den Store der Anwendung, wenn `db` ihre
 * Datenbank ist; sonst (eine Transaktion, ein Werkzeug, ein Auftrag) frisch gelesen, ohne Lesen `unknown` (Bilder aus). Dieser Rückfall
 * ist gewollt (`failure: closed`), darf aber nicht stumm bleiben: Das Scheitern steht auf stderr.
 */
export async function inhaltsstandFuer(db: Queryable): Promise<Inhaltsstand> {
    const store = STORES.get(db);
    if (store !== undefined) return store.read();
    try {
        // Ohne Namen der Personen: Die Wirkungsorte brauchen nur „an/aus“, und die Jobs-Rolle darf das Anmeldeschema nicht lesen. Mit Namen
        // scheiterte das Lesen dort, `unknown` schaltete alle Bildrollen aus (2026-11-03: Social Hub „Die Rechte des Bildes lassen keinen Beitrag zu“
        // in allen vier Kanälen, obwohl das Bild gemeinfrei und geprüft war).
        const stand = await leseInhaltsstand(db, { personen: false });
        letzterLesefehler = undefined;
        return stand;
    } catch (error) {
        const text = lesefehlerText(error);
        if (text !== letzterLesefehler) {
            letzterLesefehler = text;
            process.stderr.write(
                `Inhaltsschalter: Stand ohne Store nicht lesbar (${text}), die Schalter der Bilder gelten als aus\n`,
            );
        }
        return UNBEKANNT;
    }
}

/**
 * Der Stand je Instanz. Nachgelesen wird, wenn sich die Inhaltsrevision des Betriebszustands geändert hat (der Weckruf aus 0087 trägt sie
 * binnen einer Sekunde zu jeder Instanz, der Takt spätestens nach 5 s); dazwischen kostet ein Blick nichts. Scheitert das Lesen, gilt der
 * letzte Stand, oder, wenn es nie einen gab, `unknown` (Bilder aus).
 */
export class InhaltsschalterStore {
    readonly #database: Queryable;
    readonly #revision: () => number | null;
    readonly #warn: (message: string) => void;
    #cached: Inhaltsstand | undefined;
    #laden: Promise<Inhaltsstand> | undefined;
    #letzterFehler: string | undefined;

    constructor(options: { database: Queryable; revision: () => number | null; warn?: (message: string) => void }) {
        this.#database = options.database;
        this.#revision = options.revision;
        this.#warn = options.warn ?? (() => undefined);
        STORES.set(options.database, this);
    }

    async read(): Promise<Inhaltsstand> {
        const revision = this.#revision();
        const cached = this.#cached;
        // Neu gelesen wird erst, wenn der Speicher des Betriebszustands eine NEUERE Revision kennt; hinkt er nach dem eigenen Umschalten
        // noch hinterher, bleibt der frische Stand stehen.
        if (cached !== undefined && cached.revision !== null && revision !== null && revision <= cached.revision)
            return cached;
        this.#laden ??= this.#lies().finally(() => {
            this.#laden = undefined;
        });
        return this.#laden;
    }

    /** Nach dem eigenen Umschalten sofort neu lesen (die eigene Instanz wartet nicht auf den Weckruf). */
    forget(): void {
        this.#cached = undefined;
    }

    async #lies(): Promise<Inhaltsstand> {
        try {
            const stand = await leseInhaltsstand(this.#database);
            if (stand.unknownKeys.length > 0 && stand.unknownKeys.join() !== this.#cached?.unknownKeys.join()) {
                this.#warn(
                    `Inhaltsschalter: unbekannte Schlüssel in content_switch ignoriert (${stand.unknownKeys.join(", ")})`,
                );
            }
            this.#cached = stand;
            this.#letzterFehler = undefined;
            return stand;
        } catch (error) {
            // Der Rückfall bleibt (letzter Stand, sonst `unknown`), aber nicht stumm: derselbe Fehler steht einmal im Protokoll, nach einem gelungenen Lesen wieder.
            const text = lesefehlerText(error);
            if (text !== this.#letzterFehler) {
                this.#letzterFehler = text;
                this.#warn(
                    `Inhaltsschalter: Stand nicht lesbar (${text}), ${
                        this.#cached === undefined
                            ? "die Schalter der Bilder gelten als aus"
                            : "es gilt der letzte gelesene Stand"
                    }`,
                );
            }
            return this.#cached ?? UNBEKANNT;
        }
    }
}
