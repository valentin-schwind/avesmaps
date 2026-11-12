import type {
    WikisyncBereich,
    WikisyncEigentuemer,
    WikisyncUebernahmeArt,
    WikisyncUebernahmeBefund,
    WikisyncUebernahmeStatus,
    WikisyncWertZustand,
    WikisyncWirkung,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../../database.ts";
import { kuerze } from "../../infobox/text.ts";
import type { BefundSchritt } from "./schreiber.ts";

/**
 * Das Protokoll der Übernahme und der Rücknahme (WI-0253 D-1, Migration 0225): lesen, was eine Vorschau sagte, und festhalten, was daraus wurde. Hier steht keine
 * Fachtafel; `wikisync_uebernahme` und `wikisync_uebernahme_befund` schreibt allein die Jobs-Rolle (Vorlage `apps/server/src/db/system-grants.psql`), die App liest.
 */

/** Wie viele Befunde je Lauf als Zeile stehen bleiben; die Zahl daneben ist ungekappt. */
export const MAX_BEFUND_ZEILEN = 1000;

/** Ein Lauf der Vorschau, so weit die Übernahme ihn braucht. */
export interface VorschauLauf {
    id: number;
    bereiche: WikisyncBereich[];
    parserVersion: string;
    dump: { datei: string | null; sha256: string | null; stand: string | null };
    /** Die Kategorien-Datei, die diese Vorschau gelesen hat (WI-0294); `null`: keine (ein Lauf ohne Datei oder vor WI-0294). */
    kategorien: KategorienPin | null;
}

/** Der Pin der Kategorien-Datei an einem Lauf oder einer Übernahme: Dateiname, Prüfsumme, Stand aus der Endzeile (ISO, UTC). */
export interface KategorienPin {
    datei: string;
    sha256: string;
    stand: string;
}

/** Eine Feldzeile des Laufs (`wikisync_lauf_zeile`, `feld IS NOT NULL`). */
export interface VorschauZeile {
    id: number;
    bereich: WikisyncBereich;
    objektArt: string;
    objektId: string | null;
    objektName: string | null;
    objekte: number;
    /** Alle Objekte, die die Zeile zusammenfasst; bei einem Lauf von vor D-1 leer, dann nur `objektId`. */
    objektIds: string[];
    artikel: string | null;
    feld: string;
    alt: string | null;
    altZustand: WikisyncWertZustand;
    neu: string | null;
    neuZustand: WikisyncWertZustand;
    eigentuemer: WikisyncEigentuemer;
    wirkung: WikisyncWirkung;
}

type Zeile = Record<string, unknown>;

function laufAus(zeile: Zeile): VorschauLauf {
    return {
        id: Number(zeile["id"]),
        bereiche: zeile["bereiche"] as WikisyncBereich[],
        parserVersion: String(zeile["parser_version"]),
        dump: {
            datei: (zeile["dump_datei"] as string | null) ?? null,
            sha256: (zeile["dump_sha256"] as string | null) ?? null,
            stand: (zeile["dump_stand"] as string | null) ?? null,
        },
        kategorien:
            typeof zeile["kategorien_sha256"] === "string" && zeile["kategorien_stand"] instanceof Date
                ? {
                      datei: String(zeile["kategorien_datei"] ?? ""),
                      sha256: zeile["kategorien_sha256"],
                      stand: zeile["kategorien_stand"].toISOString(),
                  }
                : null,
    };
}

/**
 * Der Lauf der Vorschau, aus dem übernommen wird: der genannte, wenn er fertig ist und den Bereich rechnete; ohne Nennung der jüngste fertige, der den Bereich
 * rechnete. `undefined`, wenn es keinen gibt.
 */
export async function ladeVorschauLauf(
    db: Queryable,
    bereich: WikisyncBereich,
    laufId?: number,
): Promise<VorschauLauf | undefined> {
    const [zeile] =
        laufId === undefined
            ? await db<Zeile[]>`
                  SELECT id::int AS id, bereiche, parser_version, dump_datei, dump_sha256, dump_stand, kategorien_datei, kategorien_sha256, kategorien_stand
                    FROM wikisync_lauf
                   WHERE status = 'fertig' AND art = 'vorschau' AND ${bereich} = ANY(bereiche)
                   ORDER BY id DESC LIMIT 1
              `
            : await db<Zeile[]>`
                  SELECT id::int AS id, bereiche, parser_version, dump_datei, dump_sha256, dump_stand, kategorien_datei, kategorien_sha256, kategorien_stand
                    FROM wikisync_lauf
                   WHERE id = ${laufId} AND status = 'fertig' AND art = 'vorschau' AND ${bereich} = ANY(bereiche)
              `;
    return zeile === undefined ? undefined : laufAus(zeile);
}

/** Hat die Vorschau diesen Bereich gerechnet, solange er noch dem Legacy-Zug gehörte? Dann trägt keine Zeile das Wiki als Eigentümer, und sie ist keine Grundlage. */
export async function laufRechneteFuerLegacy(
    db: Queryable,
    laufId: number,
    bereich: WikisyncBereich,
): Promise<boolean> {
    const [zeile] = await db<{ n: number }[]>`
        SELECT count(*)::int AS n FROM wikisync_lauf_zeile WHERE lauf_id = ${laufId} AND bereich = ${bereich} AND eigentuemer = 'legacy'
    `;
    return (zeile?.n ?? 0) > 0;
}

/** Die Feldzeilen eines Bereichs im Lauf, in der Reihenfolge des Plans. */
export async function ladeLaufZeilen(
    db: Queryable,
    laufId: number,
    bereich: WikisyncBereich,
): Promise<VorschauZeile[]> {
    const zeilen = await db<Zeile[]>`
        SELECT id::int AS id, bereich, objekt_art, objekt_id::text AS objekt_id, objekt_name, objekte, objekt_ids::text[] AS objekt_ids, artikel, feld,
               alt, alt_zustand, neu, neu_zustand, eigentuemer, wirkung
          FROM wikisync_lauf_zeile
         WHERE lauf_id = ${laufId} AND bereich = ${bereich} AND feld IS NOT NULL
         ORDER BY position
    `;
    return zeilen.map((zeile) => {
        const objektId = (zeile["objekt_id"] as string | null) ?? null;
        const ids = (zeile["objekt_ids"] as string[] | null) ?? [];
        return {
            id: Number(zeile["id"]),
            bereich: zeile["bereich"] as WikisyncBereich,
            objektArt: String(zeile["objekt_art"]),
            objektId,
            objektName: (zeile["objekt_name"] as string | null) ?? null,
            objekte: Number(zeile["objekte"]),
            // Ein Lauf von vor D-1 nennt nur den Vertreter; für eine Zeile mit mehreren Objekten reicht das nicht (siehe `pruefen.ts`).
            objektIds: ids.length > 0 ? ids : objektId === null ? [] : [objektId],
            artikel: (zeile["artikel"] as string | null) ?? null,
            feld: String(zeile["feld"]),
            alt: (zeile["alt"] as string | null) ?? null,
            altZustand: zeile["alt_zustand"] as WikisyncWertZustand,
            neu: (zeile["neu"] as string | null) ?? null,
            neuZustand: zeile["neu_zustand"] as WikisyncWertZustand,
            eigentuemer: zeile["eigentuemer"] as WikisyncEigentuemer,
            wirkung: zeile["wirkung"] as WikisyncWirkung,
        };
    });
}

/**
 * Hat der Lauf Feldzeilen, die mehrere Objekte zusammenfassen, ohne deren Kennungen zu nennen (ein Lauf von vor D-1)? Dann lässt sich nichts sicher übernehmen.
 * Ein Befund schreibt nie und zählt darum nicht (Stage 2026-10-27: die Quellen-Zeilen `ohne_produktseite` nennen keine Kennungen, jede Vorschau galt als veraltet).
 */
export async function laufOhneKennungen(db: Queryable, laufId: number, bereich: WikisyncBereich): Promise<boolean> {
    const [zeile] = await db<{ n: number }[]>`
        SELECT count(*)::int AS n FROM wikisync_lauf_zeile
         WHERE lauf_id = ${laufId} AND bereich = ${bereich} AND feld IS NOT NULL AND wirkung <> 'befund'
           AND objekte > 1 AND cardinality(objekt_ids) = 0
    `;
    return (zeile?.n ?? 0) > 0;
}

export interface UebernahmeAnfang {
    art: WikisyncUebernahmeArt;
    bereich: WikisyncBereich;
    laufId: number;
    /** Nur bei einer Rücknahme: die Übernahme, die sie zurücknimmt. */
    zurueckVon?: number;
    dump: VorschauLauf["dump"];
    /** Aus welcher Kategorien-Datei die Übernahme übernahm (WI-0294); fehlt bei einer Rücknahme und einer Ablehnung. */
    kategorien?: KategorienPin | null;
    jobPublicId: string;
    ausgeloestVon: string | null;
    ausgeloestLabel: string | null;
}

/** Legt die Zeile an, bevor etwas geschrieben wird: `laeuft`. Liefert ihre Nummer. */
export async function legeUebernahmeAn(db: Queryable, anfang: UebernahmeAnfang): Promise<number> {
    const [zeile] = await db<{ id: number }[]>`
        INSERT INTO wikisync_uebernahme (
            art, bereich, lauf_id, zurueck_von, status, dump_datei, dump_sha256, dump_stand, kategorien_datei, kategorien_sha256, kategorien_stand,
            job_public_id, ausgeloest_von, ausgeloest_label
        ) VALUES (
            ${anfang.art}, ${anfang.bereich}, ${anfang.laufId}, ${anfang.zurueckVon ?? null}, 'laeuft', ${anfang.dump.datei}, ${anfang.dump.sha256},
            ${anfang.dump.stand}, ${anfang.kategorien?.datei ?? null}, ${anfang.kategorien?.sha256 ?? null}, ${anfang.kategorien?.stand ?? null}::timestamptz, ${anfang.jobPublicId}::uuid, ${anfang.ausgeloestVon}::uuid, ${anfang.ausgeloestLabel}
        )
        RETURNING id::int AS id
    `;
    if (zeile === undefined) throw new Error("wikisync_uebernahme: keine Nummer erhalten");
    return zeile.id;
}

export interface UebernahmeEnde {
    status: Exclude<WikisyncUebernahmeStatus, "laeuft">;
    grund?: string | null;
    operationId?: string | null;
    zahlen: Record<string, number>;
}

/** Schließt die Zeile ab (`beendet_am` gesetzt). Läuft in der Transaktion der Operation, damit „fertig“ nie vor dem Geschriebenen steht. */
export async function schliesseUebernahme(tx: Queryable, id: number, ende: UebernahmeEnde): Promise<void> {
    await tx`
        UPDATE wikisync_uebernahme
           SET status = ${ende.status}, beendet_am = now(), grund = ${ende.grund === undefined || ende.grund === null ? null : kuerze(ende.grund, 500)},
               operation_id = ${ende.operationId ?? null}::uuid, zahlen = ${tx.json(ende.zahlen as never)}
         WHERE id = ${id} AND status = 'laeuft'
    `;
}

/** Schreibt die Befunde einer Übernahme; höchstens `MAX_BEFUND_ZEILEN`, ohne Doppelte desselben Objekts, Felds und Befunds. */
export async function schreibeBefunde(
    tx: Queryable,
    uebernahmeId: number,
    befunde: readonly BefundSchritt[],
): Promise<number> {
    const gesehen = new Set<string>();
    const zeilen: Record<string, unknown>[] = [];
    for (const befund of befunde) {
        const schluessel = `${befund.objektId}|${befund.feld ?? ""}|${befund.befund}`;
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);
        if (zeilen.length >= MAX_BEFUND_ZEILEN) continue;
        zeilen.push({
            uebernahme_id: uebernahmeId,
            position: zeilen.length,
            objekt_art: befund.objektArt,
            objekt_id: befund.objektId,
            objekt_name: befund.objektName === null ? null : kuerze(befund.objektName, 500),
            feld: befund.feld,
            befund: befund.befund satisfies WikisyncUebernahmeBefund,
            grund: kuerze(befund.grund, 200),
        });
    }
    if (zeilen.length > 0) {
        await tx`
            INSERT INTO wikisync_uebernahme_befund ${tx(
                zeilen as never,
                "uebernahme_id",
                "position",
                "objekt_art",
                "objekt_id",
                "objekt_name",
                "feld",
                "befund",
                "grund",
            )}
        `;
    }
    return gesehen.size;
}

/** Eine Übernahme, die noch `laeuft`, obwohl niemand mehr an ihr arbeitet (der Prozess endete): Sie wird `fehlgeschlagen`. Liefert, wie viele es waren. */
export async function raeumeVerwaisteAb(db: Queryable, bereich: WikisyncBereich, ausser: number): Promise<number> {
    const zeilen = await db<{ id: number }[]>`
        UPDATE wikisync_uebernahme
           SET status = 'fehlgeschlagen', beendet_am = now(), grund = 'Der Prozess endete vor dem Abschluss'
         WHERE bereich = ${bereich} AND status = 'laeuft' AND id <> ${ausser}
        RETURNING id::int AS id
    `;
    return zeilen.length;
}
