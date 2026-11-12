import type {
    WikisyncArtikelVergleich,
    WikisyncBereichZahlen,
    WikisyncEigentuemer,
    WikisyncLaufStatus,
    WikisyncStatus,
    WikisyncWertZustand,
    WikisyncWirkung,
    WikisyncBefund,
    WikisyncBereich,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { isMissingTable } from "../../system/state-row.ts";
import { kuerze } from "../infobox/text.ts";
import type { PlanZeile } from "../abgleich/plan.ts";

/**
 * Die Ablage der Vergleiche einzelner Artikel (WI-0253 D-2, Migration 0237 `wikisync_artikel`): anlegen, abschließen, aufräumen, lesen. Geschrieben wird nur als Jobs-Rolle (der Auftrag `wiki_artikel`),
 * gelesen auch als App-Rolle (die Route). Hier steht keine Fachtafel; ein Vergleich ändert nichts an der Karte.
 */

/** Wie viele Vergleiche bleiben stehen; ältere räumt der nächste ab. */
export const BEHALTENE_VERGLEICHE = 20;
/** Ein Vergleich, der so lange `laeuft`, ohne dass jemand an ihm arbeitet, gilt als abgebrochen (der Prozess endete). */
export const VERWAIST_NACH_MINUTEN = 15;

type Zeile = Record<string, unknown>;

export interface VergleichAnfang {
    titel: string;
    parserVersion: string;
    tafelRevision: number | null;
    jobPublicId: string;
    ausgeloestVon: string | null;
    ausgeloestLabel: string | null;
}

export async function legeVergleichAn(db: Queryable, anfang: VergleichAnfang): Promise<number> {
    const [zeile] = await db<{ id: number }[]>`
        INSERT INTO wikisync_artikel (titel, parser_version, tafel_revision, job_public_id, ausgeloest_von, ausgeloest_label)
        VALUES (${kuerze(anfang.titel, 500)}, ${anfang.parserVersion}, ${anfang.tafelRevision}, ${anfang.jobPublicId}::uuid,
                ${anfang.ausgeloestVon}::uuid, ${anfang.ausgeloestLabel === null ? null : kuerze(anfang.ausgeloestLabel, 80)})
        RETURNING id::int AS id
    `;
    if (zeile === undefined) throw new Error("wikisync_artikel: keine Nummer erhalten");
    // Ein Vergleich von früher, an dem niemand mehr arbeitet, steht nicht ewig auf „läuft“.
    await db`
        UPDATE wikisync_artikel
           SET status = 'fehlgeschlagen', beendet_am = now(), fehler_code = 'abgebrochen', fehler = 'Der Prozess endete vor dem Abschluss'
         WHERE status = 'laeuft' AND id <> ${zeile.id} AND gestartet_am < now() - make_interval(mins => ${VERWAIST_NACH_MINUTEN})
    `;
    return zeile.id;
}

export interface VergleichEnde {
    status: Exclude<WikisyncLaufStatus, "laeuft">;
    wikiTitel?: string | null;
    wikiNamensraum?: number | null;
    wikiRevision?: number | null;
    wikiStand?: Date | null;
    fehlerCode?: string | null;
    fehler?: string | null;
    zeilen?: readonly PlanZeile[];
    zahlen?: Partial<Record<WikisyncBereich, WikisyncBereichZahlen>>;
}

export async function schliesseVergleich(db: Queryable, id: number, ende: VergleichEnde): Promise<void> {
    await db`
        UPDATE wikisync_artikel
           SET status = ${ende.status}, beendet_am = now(),
               wiki_titel = ${ende.wikiTitel === undefined || ende.wikiTitel === null ? null : kuerze(ende.wikiTitel, 500)},
               wiki_namensraum = ${ende.wikiNamensraum ?? null}, wiki_revision = ${ende.wikiRevision ?? null}, wiki_stand = ${ende.wikiStand ?? null},
               fehler_code = ${ende.fehlerCode === undefined || ende.fehlerCode === null ? null : kuerze(ende.fehlerCode, 64)},
               fehler = ${ende.fehler === undefined || ende.fehler === null ? null : kuerze(ende.fehler, 500)},
               zeilen = ${db.json((ende.zeilen ?? []) as never)}, zahlen = ${db.json((ende.zahlen ?? {}) as never)}
         WHERE id = ${id} AND status = 'laeuft'
    `;
    // Die letzten BEHALTENE_VERGLEICHE bleiben.
    await db`
        DELETE FROM wikisync_artikel
         WHERE id NOT IN (SELECT id FROM wikisync_artikel ORDER BY id DESC LIMIT ${BEHALTENE_VERGLEICHE})
    `;
}

const text = (wert: unknown): string | null => (typeof wert === "string" ? wert : null);
const datum = (wert: unknown): string | null => (wert instanceof Date ? wert.toISOString() : null);

/** Die Planzeile als Zeile des Berichts: dieselbe Form, die Nummer der Zeile ist ihre Stelle, die des Laufs die des Vergleichs. */
function alsBerichtszeile(
    vergleichId: number,
    index: number,
    zeile: Record<string, unknown>,
): WikisyncArtikelVergleich["zeilen"][number] {
    return {
        id: index + 1,
        laufId: vergleichId,
        bereich: zeile["bereich"] as WikisyncBereich,
        objektArt: String(zeile["objektArt"] ?? ""),
        objektId: text(zeile["objektId"]),
        objektName: text(zeile["objektName"]),
        objekte: Number(zeile["objekte"] ?? 1),
        artikel: text(zeile["artikel"]),
        namensraum: typeof zeile["namensraum"] === "number" ? zeile["namensraum"] : null,
        feld: text(zeile["feld"]),
        alt: text(zeile["alt"]),
        altZustand: zeile["altZustand"] as WikisyncWertZustand,
        neu: text(zeile["neu"]),
        neuZustand: zeile["neuZustand"] as WikisyncWertZustand,
        eigentuemer: zeile["eigentuemer"] as WikisyncEigentuemer,
        wirkung: zeile["wirkung"] as WikisyncWirkung,
        status: zeile["status"] as WikisyncStatus,
        befund: (zeile["befund"] as WikisyncBefund | null) ?? null,
        grund: text(zeile["grund"]),
    };
}

/** Die jüngsten Vergleiche mit ihren Zeilen, der jüngste zuerst. Fehlt die Tafel (vor Migration 0237), gibt es keine. */
export async function leseVergleiche(db: Queryable, limit = BEHALTENE_VERGLEICHE): Promise<WikisyncArtikelVergleich[]> {
    try {
        const zeilen = await db<Zeile[]>`
            SELECT a.id::int AS id, a.titel, a.wiki_titel, a.wiki_namensraum, a.wiki_revision::bigint::int AS wiki_revision, a.wiki_stand, a.status,
                   a.gestartet_am, a.beendet_am, COALESCE(p.display_name, a.ausgeloest_label, 'automatisch') AS wer, a.fehler_code, a.fehler, a.zeilen, a.zahlen
              FROM wikisync_artikel a LEFT JOIN avesmaps_auth.person p ON p.id = a.ausgeloest_von
             ORDER BY a.id DESC LIMIT ${limit}
        `;
        return zeilen.map((zeile) => {
            const id = Number(zeile["id"]);
            return {
                id,
                titel: String(zeile["titel"]),
                wikiTitel: text(zeile["wiki_titel"]),
                wikiNamensraum: typeof zeile["wiki_namensraum"] === "number" ? zeile["wiki_namensraum"] : null,
                wikiRevision: typeof zeile["wiki_revision"] === "number" ? zeile["wiki_revision"] : null,
                wikiStand: datum(zeile["wiki_stand"]),
                status: zeile["status"] as WikisyncLaufStatus,
                gestartetAm: datum(zeile["gestartet_am"]) ?? "",
                beendetAm: datum(zeile["beendet_am"]),
                ausgeloestVon: text(zeile["wer"]),
                fehlerCode: text(zeile["fehler_code"]),
                fehler: text(zeile["fehler"]),
                zahlen: (zeile["zahlen"] ?? {}) as Record<string, WikisyncBereichZahlen>,
                zeilen: ((zeile["zeilen"] ?? []) as Record<string, unknown>[]).map((roh, index) =>
                    alsBerichtszeile(id, index, roh),
                ),
            };
        });
    } catch (fehler) {
        if (isMissingTable(fehler)) return [];
        throw fehler;
    }
}
