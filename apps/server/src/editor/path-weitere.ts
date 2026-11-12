import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";

/**
 * Die weiteren Straßennamen eines Abschnitts (WI-0302, OPS-000108; Vali 2026-11-10, Optionen „Nur Wiki-Artikel“ und „Ja, mitzählen“): Wiki-Artikel der Wege,
 * die neben dem Hauptartikel des Abschnitts an ihm hängen (`path_wiki_assignment`, Rolle `further`, je Abschnitt und Artikel eine aktive Zeile). Beispiel: Abschnitt 10 des
 * Sikramstiegs (Sibur → Radoleth) trägt „Goldfelser Stieg“ und zählt damit zum Goldfelser Stieg. Auf der Karte steht nur der Hauptname.
 *
 * - **Lesen** (`leseWeitere`): nur Zeilen mit aktivem Wiki-Stand (wie der Hauptartikel im Wegeditor und die Wegegruppen der Infobox). Eine Zeile, deren Stand das Wiki nicht
 *   mehr führt, sieht niemand und fasst darum auch das Speichern nie an.
 * - **Speichern** (`planeWeitere`, `schreibeWeitere`; aus `path.update`): Der Körper nennt je Abschnitt die vollständige Liste der Schlüssel. Ein fehlender Artikel wird
 *   angelegt; zuerst wird eine still gelegte Zeile desselben Abschnitts und Wiki-Stands belebt, damit ihre Herkunft bleibt (etwa `legacy_editor`), sonst eine neue mit
 *   Herkunft `editor`. Ein gestrichener wird still gelegt (nie gelöscht) mit `retired_origin = 'editor'`: Eine solche Zeile fasst der Import nie an
 *   (`migration/sync-table.ts`), die Herkunft der Zeile bleibt für ein späteres Beleben stehen.
 * - **Erlaubt** sind nur Artikel mit aktivem Wiki-Stand der Wege (400 `validation_failed`, Feld `weitere`), nie der Hauptartikel des Abschnitts (400 `ist_hauptartikel`).
 */

export interface Weiterer {
    key: string;
    name: string;
    url: string;
}

/** Ein weiterer Straßenname, wie er heute an einem Abschnitt hängt: dazu die Kennung seiner Zeile. */
export interface WeitererStand extends Weiterer {
    zeile: string;
}

/** Nach Namen, bei Gleichstand nach Schlüssel: Liste, Protokoll und Fenster zeigen dieselbe Folge. */
const ordnung = (a: Weiterer, b: Weiterer): number =>
    a.name.localeCompare(b.name, "de") || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

const nameVon = (name: string | null, url: string, key: string): string =>
    name !== null && name.trim() !== "" ? name : (titelAusWikiAdresse(url) ?? key);

/** Die weiteren Straßennamen der Abschnitte (öffentliche Kennungen), je Abschnitt geordnet; ein Abschnitt ohne fehlt in der Abbildung. */
export async function leseWeitere(db: Queryable, ids: readonly string[]): Promise<Map<string, WeitererStand[]>> {
    const jeAbschnitt = new Map<string, WeitererStand[]>();
    if (ids.length === 0) return jeAbschnitt;
    const zeilen = await db<{ path: string; zeile: string; key: string; name: string | null; url: string }[]>`
        SELECT p.public_id::text AS path, w.id::text AS zeile, s.wiki_key AS key, s.name, coalesce(s.wiki_url, w.wiki_url) AS url
          FROM path_wiki_assignment w
          JOIN path p ON p.id = w.path_id
          JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
         WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND w.is_active AND w.role = 'further'
    `;
    for (const z of zeilen) {
        const liste = jeAbschnitt.get(z.path) ?? [];
        liste.push({ key: z.key, name: nameVon(z.name, z.url, z.key), url: z.url, zeile: z.zeile });
        jeAbschnitt.set(z.path, liste);
    }
    for (const liste of jeAbschnitt.values()) liste.sort(ordnung);
    return jeAbschnitt;
}

/** Ein Stand im Protokoll (`path.updated`, Feld `weitere`): Schlüssel und Name, nach Namen geordnet. */
export const alsProtokoll = (liste: readonly Weiterer[]): { key: string; name: string }[] =>
    liste.map(({ key, name }) => ({ key, name }));

/** Die Schlüssel eines Stands aus dem Protokoll (für die Rücknahme); `undefined`, wenn die Form nicht stimmt. */
export function schluesselAusProtokoll(wert: unknown): string[] | undefined {
    if (!Array.isArray(wert)) return undefined;
    const keys = wert.map((eintrag) =>
        typeof eintrag === "object" && eintrag !== null && typeof (eintrag as { key?: unknown }).key === "string"
            ? (eintrag as { key: string }).key
            : undefined,
    );
    return keys.every((key): key is string => key !== undefined && key !== "") ? [...new Set(keys)] : undefined;
}

export interface WeiterePlan {
    /** Je Abschnitt, an dem sich etwas ändert: der Stand vorher und nachher (geordnet). */
    wechsel: Map<string, { vorher: Weiterer[]; nachher: Weiterer[] }>;
    /** Die Zeilen, die still gelegt werden. */
    stilllegen: string[];
    /** Die Artikel, die je Abschnitt dazukommen: Wiki-Stand und Adresse. */
    anlegen: { publicId: string; stand: string; url: string }[];
}

/**
 * Prüft die gewünschten Listen (`wunsch`: Abschnitt → vollständige Liste der Schlüssel) und rechnet, was sich ändert. Liest nur; geschrieben wird mit `schreibeWeitere`,
 * nachdem alle Prüfungen des Speicherns bestanden sind.
 */
export async function planeWeitere(
    tx: Queryable,
    wunsch: ReadonlyMap<string, readonly string[]>,
): Promise<WeiterePlan> {
    const ids = [...wunsch.keys()];
    const schluessel = [...new Set([...wunsch.values()].flat())];
    const staende =
        schluessel.length === 0
            ? []
            : await tx<{ id: string; key: string; url: string; name: string | null }[]>`
                  SELECT id::text AS id, wiki_key AS key, wiki_url AS url, name
                    FROM wiki_path_snapshot WHERE wiki_key = ANY(${schluessel}::text[]) AND is_active
              `;
    const standVon = new Map(staende.map((stand) => [stand.key, stand] as const));
    for (const [publicId, keys] of wunsch) {
        const fehlt = keys.find((key) => !standVon.has(key));
        if (fehlt !== undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel der Wege gibt es nicht.", {
                field: "weitere",
                publicId,
                key: fehlt,
            });
    }
    const haupt = await tx<{ path: string; stand: string }[]>`
        SELECT p.public_id::text AS path, w.snapshot_id::text AS stand
          FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
         WHERE p.public_id = ANY(${ids}::uuid[]) AND w.is_active AND w.role = 'main' AND w.snapshot_id IS NOT NULL
    `;
    const hauptVon = new Map(haupt.map((zeile) => [zeile.path, zeile.stand] as const));
    for (const [publicId, keys] of wunsch) {
        const istHaupt = keys.find((key) => standVon.get(key)?.id === hauptVon.get(publicId));
        if (istHaupt !== undefined)
            throw new ApiError(
                400,
                "ist_hauptartikel",
                "Der Hauptartikel des Abschnitts ist kein weiterer Straßenname.",
                {
                    field: "weitere",
                    publicId,
                    key: istHaupt,
                },
            );
    }

    const vorher = await leseWeitere(tx, ids);
    const plan: WeiterePlan = { wechsel: new Map(), stilllegen: [], anlegen: [] };
    for (const [publicId, keys] of wunsch) {
        const alt = vorher.get(publicId) ?? [];
        const bleibt = new Set(keys);
        const da = new Set(alt.map((w) => w.key));
        const weg = alt.filter((w) => !bleibt.has(w.key));
        const dazu = keys.filter((key) => !da.has(key));
        if (weg.length === 0 && dazu.length === 0) continue;
        plan.stilllegen.push(...weg.map((w) => w.zeile));
        const neu = dazu.map((key): Weiterer => {
            const stand = standVon.get(key)!;
            plan.anlegen.push({ publicId, stand: stand.id, url: stand.url });
            return { key, name: nameVon(stand.name, stand.url, key), url: stand.url };
        });
        const ohneZeile = ({ key, name, url }: Weiterer): Weiterer => ({ key, name, url });
        plan.wechsel.set(publicId, {
            vorher: alt.map(ohneZeile),
            nachher: [...alt.filter((w) => bleibt.has(w.key)).map(ohneZeile), ...neu].sort(ordnung),
        });
    }
    return plan;
}

/** Schreibt den Plan in der Transaktion des Speicherns: still legen, beleben, anlegen (siehe Kopf der Datei). */
export async function schreibeWeitere(tx: Queryable, plan: WeiterePlan): Promise<void> {
    if (plan.stilllegen.length > 0)
        await tx`
            UPDATE path_wiki_assignment
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
             WHERE id = ANY(${plan.stilllegen}::bigint[]) AND is_active AND role = 'further'
        `;
    if (plan.anlegen.length === 0) return;
    // Zuerst beleben: je Abschnitt und Wiki-Stand die zuletzt still gelegte Zeile (ein Entscheid wie „getrennt“ oder „unterdrückt“ bleibt liegen).
    const belebt = await tx<{ path: string; stand: string }[]>`
        WITH ziel AS (
            SELECT p.id AS path_id, z.stand
              FROM unnest(${plan.anlegen.map((a) => a.publicId)}::uuid[], ${plan.anlegen.map((a) => a.stand)}::bigint[]) AS z(public_id, stand)
              JOIN path p ON p.public_id = z.public_id
        ), alt AS (
            SELECT DISTINCT ON (a.path_id, a.snapshot_id) a.id, a.path_id
              FROM path_wiki_assignment a
              JOIN ziel ON ziel.path_id = a.path_id AND ziel.stand = a.snapshot_id
             WHERE NOT a.is_active AND a.role = 'further' AND a.assignment_state = 'assigned'
             ORDER BY a.path_id, a.snapshot_id, a.retired_at DESC NULLS LAST, a.id DESC
        )
        UPDATE path_wiki_assignment w
           SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
          FROM alt JOIN path p ON p.id = alt.path_id
         WHERE w.id = alt.id
        RETURNING p.public_id::text AS path, w.snapshot_id::text AS stand
    `;
    const schon = new Set(belebt.map((zeile) => `${zeile.path}|${zeile.stand}`));
    const neu = plan.anlegen.filter((a) => !schon.has(`${a.publicId}|${a.stand}`));
    if (neu.length === 0) return;
    await tx`
        INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
        SELECT p.id, 'further', z.url, z.stand, 'assigned', 'editor', 'avesmaps3d', TRUE
          FROM unnest(${neu.map((a) => a.publicId)}::uuid[], ${neu.map((a) => a.stand)}::bigint[], ${neu.map((a) => a.url)}::text[])
               AS z(public_id, stand, url)
          JOIN path p ON p.public_id = z.public_id
    `;
}
