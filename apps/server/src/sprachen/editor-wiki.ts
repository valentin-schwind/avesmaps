import type { OperationReceipt } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { MapActor, MapAuditEntry } from "../editor/map-operation.ts";
import { SPRACHE_ART, pruefeFremdeSprachSperre, ungueltig } from "./editor-naht.ts";

/**
 * Die Wiki-Artikel einer Sprache schreiben (WI-0261 S5d, Tafel `sprache_wiki`, Migration 0255): die Pillen des Spracheditors in ihrer Reihenfolge. Der
 * WikiSync schreibt diese Tafel nie (O6); der Import ordnet beim Einspielen zu (S6), die Redaktion hier.
 *
 * - **Ein Artikel gehört höchstens einer aktiven Zuordnung** (Teilindex `sprache_wiki_artikel_aktiv`). Wer einen Artikel zuordnet, der einer anderen Sprache gehört,
 *   nimmt ihn ihr weg: Ihre Zuordnung wird still gelegt (`retired_origin = editor`), ihre Revision zählt hoch, und das Protokoll trägt eine eigene Zeile
 *   `sprache.wiki_released` an ihr. Hält ein anderer ihre Sperre, 409 `object_locked`.
 * - 🪤 **Die Stelle ist unter den aktiven Zeilen einer Sprache eindeutig** (Teilindex `sprache_wiki_position_aktiv`), und ein Teilindex lässt sich nicht aufschieben:
 *   Postgres prüft ihn je Zeile, nicht am Ende der Anweisung. Darum zweistufig: erst die gelösten Zeilen still legen und die Zeilen, die ihre Stelle wechseln, auf
 *   freie Zwischenstellen (`ZWISCHENSTELLE` + Ziel) schieben, dann jede Pille auf ihre Stelle, neue als neue Zeile.
 * - **Gelöscht wird nie.** Eine neue Zuordnung ist eine neue Zeile (Herkunft `redaktion`); eine gelöste bleibt als stille Zeile stehen. Daran erkennt der Import
 *   eine von der Redaktion gelöste Zuordnung und belebt sie nicht (`ordneWikiArtikelZu`).
 * - Die Revision der EIGENEN Sprache zählt der Aufrufer (beim Anlegen nicht, beim Setzen einmal).
 */

/** Ab hier liegen die Zwischenstellen; die Pillen einer Sprache sind höchstens `SPRACHE_WIKI_MAX` (`position` ist SMALLINT). */
const ZWISCHENSTELLE = 10_000;

/** Eine Pille im Protokoll (`changes.wiki`): der Artikel und sein Titel. */
export interface PillenProtokoll {
    id: string;
    titel: string;
}

export interface Zuordnung {
    id: string;
    artikel_id: string;
    artikel_public_id: string;
    titel: string;
    position: number;
}

export const protokoll = (zeile: Zuordnung): PillenProtokoll => ({ id: zeile.artikel_public_id, titel: zeile.titel });

/** Die aktiven Pillen einer Sprache (interne Kennung) in ihrer Reihenfolge, gesperrt. */
export async function pillenVon(tx: Sql, spracheRowId: string): Promise<Zuordnung[]> {
    return tx<Zuordnung[]>`
        SELECT w.id::text AS id, w.wiki_sprache_artikel_id::text AS artikel_id, a.public_id::text AS artikel_public_id, a.titel,
               w.position
          FROM sprache_wiki w JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
         WHERE w.sprache_id = ${spracheRowId}::bigint AND w.is_active
         ORDER BY w.position, w.id
           FOR UPDATE OF w
    `;
}

/** Zählt die Revision einer Sprache um eins hoch (der Trigger `sprache_revision` zählt, sobald `revision` gesetzt wird) und gibt sie zurück. */
export async function zaehleSprachRevision(tx: Sql, spracheRowId: string): Promise<number> {
    const [zeile] = await tx<{ revision: number }[]>`
        UPDATE sprache SET revision = revision WHERE id = ${spracheRowId}::bigint RETURNING revision::int AS revision
    `;
    return zeile!.revision;
}

/**
 * Setzt die aktiven Pillen einer Sprache auf `gewuenscht` (Kennungen der Artikel, in der neuen Reihenfolge), zweistufig (🪤 Kopf): lösen, was fehlt; wer die Stelle wechselt, erst auf
 * eine Zwischenstelle; dann jede Pille auf ihre Stelle. `aktuell` sind die aktiven Pillen (`pillenVon`, gesperrt), `artikelIds` die internen Kennungen der Artikel, die neu dazukommen.
 * Eine neue Pille ist eine neue Zeile der Redaktion; mit `beleben` (die Rücknahme, WI-0265 B6e) kommt sie stattdessen aus der Zeile zurück, die die Redaktion zuletzt von dieser Sprache
 * und diesem Artikel löste: Dann bleibt auch die Herkunft der Zuordnung (`import` oder `redaktion`) die von vorher. Der Artikel muss frei sein (Teilindex `sprache_wiki_artikel_aktiv`).
 */
export async function ordnePillen(
    tx: Sql,
    spracheRowId: string,
    aktuell: readonly Zuordnung[],
    gewuenscht: readonly string[],
    artikelIds: ReadonlyMap<string, string>,
    beleben: boolean,
): Promise<void> {
    const hier = new Map(aktuell.map((zeile) => [zeile.artikel_public_id, zeile]));
    const ziel = new Map(gewuenscht.map((id, stelle) => [id, stelle] as const));
    const geloest = aktuell.filter((zeile) => !ziel.has(zeile.artikel_public_id));
    if (geloest.length > 0) {
        await tx`
            UPDATE sprache_wiki SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE id = ANY(${geloest.map((zeile) => zeile.id)}::bigint[])
        `;
    }
    const wandern = aktuell.filter(
        (zeile) => ziel.has(zeile.artikel_public_id) && ziel.get(zeile.artikel_public_id) !== zeile.position,
    );
    for (const zeile of wandern) {
        await tx`
            UPDATE sprache_wiki SET position = ${ZWISCHENSTELLE + ziel.get(zeile.artikel_public_id)!}
             WHERE id = ${zeile.id}::bigint
        `;
    }
    for (const [stelle, id] of gewuenscht.entries()) {
        const bisher = hier.get(id);
        if (bisher !== undefined) {
            if (bisher.position !== stelle)
                await tx`UPDATE sprache_wiki SET position = ${stelle} WHERE id = ${bisher.id}::bigint`;
            continue;
        }
        const artikelId = artikelIds.get(id)!;
        if (beleben) {
            const [frueher] = await tx<{ id: string }[]>`
                SELECT id::text FROM sprache_wiki
                 WHERE sprache_id = ${spracheRowId}::bigint AND wiki_sprache_artikel_id = ${artikelId}::bigint
                   AND NOT is_active AND retired_origin = 'editor'
                 ORDER BY retired_at DESC, id DESC LIMIT 1
                   FOR UPDATE
            `;
            if (frueher !== undefined) {
                await tx`
                    UPDATE sprache_wiki SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, position = ${stelle}
                     WHERE id = ${frueher.id}::bigint
                `;
                continue;
            }
        }
        await tx`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
            VALUES (${spracheRowId}::bigint, ${artikelId}::bigint, ${stelle}, 'redaktion')
        `;
    }
}

export interface WikiErgebnis {
    vorher: PillenProtokoll[];
    nachher: PillenProtokoll[];
    /** Die Zeilen des Protokolls an den Sprachen, denen ein Artikel weggenommen wurde. */
    abgaben: MapAuditEntry[];
    /** Diese Sprachen mit ihrer neuen Revision. */
    affected: OperationReceipt["affected"];
    /** Für die Zusammenfassung: welcher Artikel von welcher Sprache kam. */
    uebernommen: { titel: string; von: string }[];
}

/**
 * Setzt die Pillen der Sprache auf `gewuenscht` (Kennungen der Artikel, in der neuen Reihenfolge). `undefined`, wenn sich nichts ändert. Ein unbekannter Artikel
 * ist 400; ein verschwundener (nicht mehr im Wiki) darf bleiben, aber nicht neu dazukommen.
 */
export async function setzeWiki(
    tx: Sql,
    actor: MapActor,
    sprache: { id: string; public_id: string },
    gewuenscht: readonly string[],
): Promise<WikiErgebnis | undefined> {
    const artikel =
        gewuenscht.length === 0
            ? []
            : await tx<{ id: string; public_id: string; titel: string; is_active: boolean }[]>`
                  SELECT id::text, public_id::text, titel, is_active FROM wiki_sprache_artikel
                   WHERE public_id = ANY(${[...gewuenscht]}::uuid[])
              `;
    const nachKennung = new Map(artikel.map((zeile) => [zeile.public_id, zeile]));
    const fehlend = gewuenscht.filter((id) => !nachKennung.has(id));
    if (fehlend.length > 0)
        throw ungueltig("Diesen Wiki-Artikel gibt es nicht.", { field: "artikel", artikel: fehlend });

    const aktuell = await pillenVon(tx, sprache.id);
    if (aktuell.map((zeile) => zeile.artikel_public_id).join("|") === gewuenscht.join("|")) return undefined;
    const hier = new Map(aktuell.map((zeile) => [zeile.artikel_public_id, zeile]));
    const neu = gewuenscht.filter((id) => !hier.has(id));
    const verschwunden = neu.filter((id) => nachKennung.get(id)?.is_active !== true);
    if (verschwunden.length > 0)
        throw ungueltig("Dieser Wiki-Artikel steht nicht mehr im Wiki; zuordnen lässt er sich nicht.", {
            field: "artikel",
            artikel: verschwunden,
        });

    // Artikel, die heute einer anderen Sprache gehören: dort lösen (im Protokoll jener Sprache), dann hier zuordnen.
    const neueIds = neu.map((id) => nachKennung.get(id)!.id);
    const fremd =
        neueIds.length === 0
            ? []
            : await tx<{ id: string; sprache_public_id: string; artikel_id: string }[]>`
                  SELECT w.id::text AS id, s.public_id::text AS sprache_public_id, w.wiki_sprache_artikel_id::text AS artikel_id
                    FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id
                   WHERE w.wiki_sprache_artikel_id = ANY(${neueIds}::bigint[]) AND w.is_active AND w.sprache_id <> ${sprache.id}::bigint
                   ORDER BY s.id, w.id
                     FOR UPDATE OF w
              `;
    const andere = [...new Set(fremd.map((zeile) => zeile.sprache_public_id))];
    await pruefeFremdeSprachSperre(tx, actor, andere);
    const titelVon = new Map(artikel.map((zeile) => [zeile.id, zeile.titel]));
    const abgaben: MapAuditEntry[] = [];
    const affected: OperationReceipt["affected"] = [];
    const uebernommen: { titel: string; von: string }[] = [];
    for (const andereId of andere) {
        const [besitzer] = await tx<{ id: string; name: string; revision: number }[]>`
            SELECT id::text, name, revision::int AS revision FROM sprache WHERE public_id = ${andereId}::uuid FOR UPDATE
        `;
        const bisher = await pillenVon(tx, besitzer!.id);
        const weg = new Set(fremd.filter((zeile) => zeile.sprache_public_id === andereId).map((zeile) => zeile.id));
        await tx`
            UPDATE sprache_wiki SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE id = ANY(${[...weg]}::bigint[])
        `;
        const revision = await zaehleSprachRevision(tx, besitzer!.id);
        abgaben.push({
            action: "sprache.wiki_released",
            spracheId: andereId,
            revisionBefore: besitzer!.revision,
            revisionAfter: revision,
            changes: {
                wiki: {
                    before: bisher.map(protokoll),
                    after: bisher.filter((zeile) => !weg.has(zeile.id)).map(protokoll),
                },
            },
        });
        affected.push({ kind: SPRACHE_ART, id: andereId, revision });
        for (const zeile of bisher.filter((z) => weg.has(z.id)))
            uebernommen.push({ titel: titelVon.get(zeile.artikel_id) ?? zeile.titel, von: besitzer!.name });
    }

    await ordnePillen(
        tx,
        sprache.id,
        aktuell,
        gewuenscht,
        new Map(gewuenscht.map((id) => [id, nachKennung.get(id)!.id] as const)),
        false,
    );
    return {
        vorher: aktuell.map(protokoll),
        nachher: gewuenscht.map((id) => ({ id, titel: nachKennung.get(id)!.titel })),
        abgaben,
        affected,
        uebernommen,
    };
}

/** Beim Stilllegen der Sprache: alle ihre Zuordnungen still legen, damit die Artikel frei sind. Gibt die Pillen vorher zurück. */
export async function loeseAlleWiki(tx: Sql, spracheRowId: string): Promise<PillenProtokoll[]> {
    const aktuell = await pillenVon(tx, spracheRowId);
    if (aktuell.length > 0) {
        await tx`
            UPDATE sprache_wiki SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE id = ANY(${aktuell.map((zeile) => zeile.id)}::bigint[])
        `;
    }
    return aktuell.map(protokoll);
}

/**
 * Beim Zurückholen der Sprache: die Zuordnungen beleben, die mit ihrem Stilllegen fielen (dieselbe Transaktion, also derselbe Zeitpunkt `now()` an Sprache und
 * Zuordnung), sofern ihr Artikel inzwischen keiner anderen Sprache gehört. Sie kommen in ihrer alten Reihenfolge hinter die Pillen, die die Sprache schon hat.
 * Vor dem Zurückholen der Sprache aufrufen: danach ist ihr Zeitpunkt leer. Gibt die Pillen vorher und nachher zurück.
 */
export async function belebeWiki(
    tx: Sql,
    spracheRowId: string,
): Promise<{ vorher: PillenProtokoll[]; nachher: PillenProtokoll[] }> {
    const aktuell = await pillenVon(tx, spracheRowId);
    const zurueck = await tx<Zuordnung[]>`
        SELECT w.id::text AS id, w.wiki_sprache_artikel_id::text AS artikel_id, a.public_id::text AS artikel_public_id, a.titel,
               w.position
          FROM sprache_wiki w
          JOIN sprache s ON s.id = w.sprache_id
          JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
         WHERE w.sprache_id = ${spracheRowId}::bigint AND NOT w.is_active AND w.retired_origin = 'editor'
           AND w.retired_at = s.retired_at
           AND NOT EXISTS (SELECT 1 FROM sprache_wiki b WHERE b.wiki_sprache_artikel_id = w.wiki_sprache_artikel_id AND b.is_active)
         ORDER BY w.position, w.id
           FOR UPDATE OF w
    `;
    let stelle = aktuell.reduce((hoechste, zeile) => Math.max(hoechste, zeile.position + 1), 0);
    for (const zeile of zurueck) {
        await tx`
            UPDATE sprache_wiki SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, position = ${stelle}
             WHERE id = ${zeile.id}::bigint
        `;
        stelle += 1;
    }
    return { vorher: aktuell.map(protokoll), nachher: [...aktuell, ...zurueck].map(protokoll) };
}
