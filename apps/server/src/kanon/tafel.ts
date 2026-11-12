import {
    KANON_OBJEKTARTEN,
    istNamespaceVorgabe,
    istObjektartVorgabe,
    kanonObjektartTafel,
    kanonObjektartVorgabe,
    pruefeNamespaceTafel,
    pruefeNamespaceZeile,
    pruefeObjektartZeile,
    wikiNamespaceTafel,
    type Capability,
    type KanonObjektart,
    type KanonObjektartZeile,
    type TafelFehler,
    type WikiNamespaceTafel,
    type WikiNamespaceZeile,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Die zwei Tafeln des Kanon-Etiketts auf dem Server (WI-0253 B-2, Migration 0223): lesen und ändern. Die Vorgabe führt das geteilte Paket
 * (`packages/shared/src/wiki-namespaces.ts`, `kanon-tafel.ts`); hier liegt keine zweite Liste. Vorbild ist `zoombaender/stand.ts`.
 *
 * - **Fehlerrichtung:** Fehlt die Tafel (vor 0223) oder die Datenbank, gilt die Vorgabe (`unprovisioned`).
 * - Es gibt noch keine Route und keinen Knopf: Das Rechte-Gate (WI-0253 6.2) ist offen, und kein Recht wird hier erfunden. Wer diese
 *   Funktionen ruft, gibt Akteur und Revision selbst mit.
 * - Eine Zeile, die der Vorgabe gleicht, wird nie gespeichert; „zurücksetzen“ und „auf die Vorgabe stellen“ löschen sie.
 */

export interface KanonTafelStand {
    source: "database" | "unprovisioned";
    revision: number | null;
    /** Die Tafel Rang 1, die Vorgabe überdeckt von den Zeilen der Umgebung, aufsteigend nach Nummer. */
    namensraeume: WikiNamespaceTafel;
    /** Die Tafel Rang 4: eine Zeile je Objektart. */
    objektarten: readonly KanonObjektartZeile[];
    /** Was die Datenbank an Namensräumen hält (ohne Vorgabe), für die Verwaltung. */
    abweichungenNamensraeume: WikiNamespaceZeile[];
    abweichungenObjektarten: KanonObjektartZeile[];
}

const DB_KANON = { official: "offiziell", unofficial: "inoffiziell" } as const;
const KANON_DB = { offiziell: "official", inoffiziell: "unofficial" } as const;

interface NamespaceRow {
    ns: number;
    prefix: string;
    canon: "official" | "unofficial";
    collect: boolean;
    designator: string;
}

interface ObjektartRow {
    object_kind: string;
    display: boolean;
    designator: string;
}

const namespaceVon = (row: NamespaceRow): WikiNamespaceZeile => ({
    ns: row.ns,
    praefix: row.prefix,
    kanon: DB_KANON[row.canon],
    einsammeln: row.collect,
    bezeichner: row.designator,
});

const objektartVon = (row: ObjektartRow): KanonObjektartZeile | undefined => {
    const art = KANON_OBJEKTARTEN.find((kandidat) => kandidat === row.object_kind);
    return art === undefined ? undefined : { art, anzeigen: row.display, bezeichner: row.designator };
};

/** Die Vorgabe, wenn es keine Tafel gibt. */
export function kanonTafelVorgabe(): KanonTafelStand {
    return {
        source: "unprovisioned",
        revision: null,
        namensraeume: wikiNamespaceTafel(),
        objektarten: kanonObjektartTafel(),
        abweichungenNamensraeume: [],
        abweichungenObjektarten: [],
    };
}

/**
 * Liest beide Tafeln und die Revision. Nicht in einer Transaktion aufrufen, in der eine fehlende Tafel sonst alles abbräche; die
 * Leser in Transaktionen nehmen `leseObjektartZeile`.
 */
export async function leseKanonTafel(db: Queryable | undefined): Promise<KanonTafelStand> {
    if (db === undefined) return kanonTafelVorgabe();
    try {
        const [state] = await db<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM canon_table_state WHERE id = 1`;
        const namensraeume = await db<NamespaceRow[]>`
            SELECT ns, prefix, canon, collect, designator FROM wiki_namespace_setting ORDER BY ns
        `;
        const objektarten = await db<ObjektartRow[]>`
            SELECT object_kind, display, designator FROM canon_object_label_setting ORDER BY object_kind
        `;
        const abweichungenNamensraeume = namensraeume.map(namespaceVon);
        const abweichungenObjektarten = objektarten.flatMap((row) => objektartVon(row) ?? []);
        return {
            source: "database",
            revision: state?.revision ?? null,
            namensraeume: wikiNamespaceTafel(abweichungenNamensraeume),
            objektarten: kanonObjektartTafel(abweichungenObjektarten),
            abweichungenNamensraeume,
            abweichungenObjektarten,
        };
    } catch (error) {
        if (isMissingTable(error)) return kanonTafelVorgabe();
        throw error;
    }
}

/**
 * Nur die Namensraum-Tafel (für den Schreibweg der Zuweisungen und die Aufträge des WikiSync). Wie `leseKanonTafel`, aber ohne die
 * Objektarten: ein Auftrag, der nur Räume braucht, liest nur sie.
 */
export async function leseNamespaceTafel(db: Queryable | undefined): Promise<{
    revision: number | null;
    namensraeume: WikiNamespaceTafel;
}> {
    const stand = await leseKanonTafel(db);
    return { revision: stand.revision, namensraeume: stand.namensraeume };
}

/**
 * Die Namensraum-Tafel für einen Leser IN einer Transaktion (die Schreibwege der Zuweisungen): Fehlt die Tafel (vor 0223), gilt die Vorgabe,
 * ohne dass eine gescheiterte Anweisung die Transaktion abbricht (`to_regclass` vorweg, nicht das Fangen von `42P01`).
 */
export async function leseNamespaceTafelImSchnitt(db: Queryable): Promise<WikiNamespaceTafel> {
    const [da] = await db<{ da: boolean }[]>`SELECT to_regclass('public.wiki_namespace_setting') IS NOT NULL AS da`;
    if (da?.da !== true) return wikiNamespaceTafel();
    const zeilen = await db<
        NamespaceRow[]
    >`SELECT ns, prefix, canon, collect, designator FROM wiki_namespace_setting ORDER BY ns`;
    return wikiNamespaceTafel(zeilen.map(namespaceVon));
}

/**
 * Die Zeile Rang 4 für EINE Art, gelesen in der Transaktion des Lesers (Subject-Detail): Fehlt die Tafel (vor 0223), gilt die Vorgabe, ohne
 * dass eine gescheiterte Anweisung die Transaktion abbricht (`to_regclass` vorweg, nicht das Fangen von `42P01`).
 */
export async function leseObjektartZeile(db: Queryable, art: KanonObjektart): Promise<KanonObjektartZeile> {
    const [da] = await db<{ da: boolean }[]>`SELECT to_regclass('public.canon_object_label_setting') IS NOT NULL AS da`;
    if (da?.da !== true) return kanonObjektartVorgabe(art);
    const [row] = await db<ObjektartRow[]>`
        SELECT object_kind, display, designator FROM canon_object_label_setting WHERE object_kind = ${art}
    `;
    return (row === undefined ? undefined : objektartVon(row)) ?? kanonObjektartVorgabe(art);
}

export const KANON_TAFEL_SPERRE = "kanon_tafel:schreiben";

/** Eine Änderung: `zeile: null` setzt zurück (die Vorgabe gilt wieder) beziehungsweise entfernt einen hinzugefügten Raum. */
export type KanonTafelAenderung =
    | { tafel: "namensraum"; ns: number; zeile: WikiNamespaceZeile | null }
    | { tafel: "objektart"; art: KanonObjektart; zeile: KanonObjektartZeile | null };

export interface KanonTafelAendern {
    aenderungen: KanonTafelAenderung[];
    baseRevision: number;
    /**
     * Wer ändert, und was er darf: Die Funktion prüft das Tafelrecht (`manage_canon_tables`, ab Admin) selbst, damit kein Weg es vergisst.
     * Den Passkey (Stufe V) verlangt der Wächter der Route (`protect`), nicht diese Funktion.
     */
    actor: { personId: string | null; label: string; capabilities: ReadonlySet<Capability> };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

function ungueltig(fehler: TafelFehler): ApiError {
    return new ApiError(400, "validation_failed", "Diese Zeile der Tafel ist nicht gültig.", {
        field: fehler.feld,
        reason: fehler.code,
        row: fehler.zeile,
    });
}

/**
 * Ändert mehrere Zeilen auf einmal („Übernehmen“), in der Transaktion des Aufrufers. Fehlt das Recht 403 `forbidden`; ungültige Zeile 400 `validation_failed` (Feld, Grund,
 * Zeile); nichts geändert 409 `no_change`; veraltet 409 `edit_conflict`; fehlt die Tafel 503 `kanon_tafel_unprovisioned`.
 * Geprüft wird die Tafel, wie sie danach aussähe: Ein Präfix gehört einem Raum, auch wenn zwei Änderungen es einander wegnehmen.
 */
export async function aendereKanonTafel(
    tx: Queryable,
    input: KanonTafelAendern,
): Promise<{ geaendert: string[]; revision: number }> {
    if (!input.actor.capabilities.has("manage_canon_tables")) {
        throw new ApiError(403, "forbidden", "Dafür fehlt das Recht.");
    }

    // 1. Form der Eingabe: jede Zeile für sich.
    for (const aenderung of input.aenderungen) {
        if (aenderung.tafel === "namensraum") {
            if (aenderung.zeile === null) {
                if (!Number.isInteger(aenderung.ns) || aenderung.ns < 0)
                    throw ungueltig({ zeile: aenderung.ns, feld: "ns", code: "ns_ungueltig" });
                continue;
            }
            if (aenderung.zeile.ns !== aenderung.ns)
                throw ungueltig({ zeile: aenderung.ns, feld: "ns", code: "ns_ungueltig" });
            const fehler = pruefeNamespaceZeile(aenderung.zeile)[0];
            if (fehler !== undefined) throw ungueltig(fehler);
        } else {
            if (aenderung.zeile !== null) {
                if (aenderung.zeile.art !== aenderung.art)
                    throw ungueltig({ zeile: aenderung.art, feld: "art", code: "art_unbekannt" });
                const fehler = pruefeObjektartZeile(aenderung.zeile)[0];
                if (fehler !== undefined) throw ungueltig(fehler);
            } else if (!KANON_OBJEKTARTEN.includes(aenderung.art)) {
                throw ungueltig({ zeile: aenderung.art, feld: "art", code: "art_unbekannt" });
            }
        }
    }

    // 2. Sperre, Revision.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${KANON_TAFEL_SPERRE}))`;
    const [state] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM canon_table_state WHERE id = 1
    `;
    if (state === undefined) {
        throw new ApiError(503, "kanon_tafel_unprovisioned", "Die Kanon-Tafeln fehlen noch in dieser Umgebung.");
    }
    if (state.revision !== input.baseRevision) {
        throw input.conflict
            ? await input.conflict({ revision: state.revision, changedAt: state.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }

    // 3. Der Stand vorher und die Tafel, wie sie nachher aussähe.
    const raeumeVorher = new Map(
        (await tx<NamespaceRow[]>`SELECT ns, prefix, canon, collect, designator FROM wiki_namespace_setting`).map(
            (row) => [row.ns, namespaceVon(row)],
        ),
    );
    const artenVorher = new Map(
        (await tx<ObjektartRow[]>`SELECT object_kind, display, designator FROM canon_object_label_setting`).flatMap(
            (row) => {
                const zeile = objektartVon(row);
                return zeile === undefined ? [] : [[zeile.art, zeile] as const];
            },
        ),
    );
    const raeumeNachher = new Map(raeumeVorher);
    const artenNachher = new Map(artenVorher);
    for (const aenderung of input.aenderungen) {
        if (aenderung.tafel === "namensraum") {
            if (aenderung.zeile === null || istNamespaceVorgabe(aenderung.zeile)) raeumeNachher.delete(aenderung.ns);
            else raeumeNachher.set(aenderung.ns, aenderung.zeile);
        } else if (aenderung.zeile === null || istObjektartVorgabe(aenderung.zeile)) {
            artenNachher.delete(aenderung.art);
        } else {
            artenNachher.set(aenderung.art, aenderung.zeile);
        }
    }
    const tafelFehler = pruefeNamespaceTafel(wikiNamespaceTafel([...raeumeNachher.values()]))[0];
    if (tafelFehler !== undefined) throw ungueltig(tafelFehler);

    // 4. Schreiben, was sich ändert.
    const geaendert: string[] = [];
    const akteur = input.actor;
    for (const [ns, nachher] of [...raeumeNachher.entries()].sort(([a], [b]) => a - b)) {
        const vorher = raeumeVorher.get(ns);
        if (
            vorher !== undefined &&
            vorher.praefix === nachher.praefix &&
            vorher.kanon === nachher.kanon &&
            vorher.einsammeln === nachher.einsammeln &&
            vorher.bezeichner === nachher.bezeichner
        )
            continue;
        await tx`
            INSERT INTO wiki_namespace_setting (ns, prefix, canon, collect, designator, changed_at, changed_by, changed_by_label)
            VALUES (${ns}, ${nachher.praefix}, ${KANON_DB[nachher.kanon]}, ${nachher.einsammeln}, ${nachher.bezeichner}, now(),
                    ${akteur.personId}::uuid, ${akteur.label})
            ON CONFLICT (ns) DO UPDATE SET
                prefix = EXCLUDED.prefix, canon = EXCLUDED.canon, collect = EXCLUDED.collect, designator = EXCLUDED.designator,
                changed_at = now(), changed_by = EXCLUDED.changed_by, changed_by_label = EXCLUDED.changed_by_label
        `;
        geaendert.push(`namensraum:${String(ns)}`);
    }
    for (const ns of [...raeumeVorher.keys()].sort((a, b) => a - b)) {
        if (raeumeNachher.has(ns)) continue;
        await tx`DELETE FROM wiki_namespace_setting WHERE ns = ${ns}`;
        geaendert.push(`namensraum:${String(ns)}`);
    }
    for (const art of KANON_OBJEKTARTEN) {
        const vorher = artenVorher.get(art);
        const nachher = artenNachher.get(art);
        if (nachher === undefined) {
            if (vorher === undefined) continue;
            await tx`DELETE FROM canon_object_label_setting WHERE object_kind = ${art}`;
            geaendert.push(`objektart:${art}`);
            continue;
        }
        if (vorher !== undefined && vorher.anzeigen === nachher.anzeigen && vorher.bezeichner === nachher.bezeichner)
            continue;
        await tx`
            INSERT INTO canon_object_label_setting (object_kind, display, designator, changed_at, changed_by, changed_by_label)
            VALUES (${art}, ${nachher.anzeigen}, ${nachher.bezeichner}, now(), ${akteur.personId}::uuid, ${akteur.label})
            ON CONFLICT (object_kind) DO UPDATE SET
                display = EXCLUDED.display, designator = EXCLUDED.designator, changed_at = now(), changed_by = EXCLUDED.changed_by,
                changed_by_label = EXCLUDED.changed_by_label
        `;
        geaendert.push(`objektart:${art}`);
    }
    if (geaendert.length === 0) throw new ApiError(409, "no_change", "Die Tafeln stehen schon so.");
    const [neu] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM canon_table_state WHERE id = 1`;
    return { geaendert, revision: neu!.revision };
}
