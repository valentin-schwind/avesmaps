import { pathReaderName, type WikiTreffer } from "@avesmaps3d/shared";
import { ApiError } from "../../http/api-error.ts";
import { wegSchreiber } from "../abgleich/uebernahme/weg.ts";
import {
    TREFFER_MAX,
    herkunftDerTafel,
    legeX2Still,
    schreibeX2,
    sucheMuster,
    titelOderAdresse,
    type AbschnittsAnschluss,
    type AbschnittsStand,
    type Anschluss,
    type BoxObjekt,
    type WeitereAnschluss,
    type Zuordnungsherkunft,
} from "./anschluss.ts";

/**
 * Der Weg an der Wiki-Box (WI-0253): eine Straße besteht aus Abschnitten (`path`, gleicher echter Name, Regel (c) der Wegliste), und der Artikel hängt je STRASSE an allen (`path_wiki_assignment` je Abschnitt, Rolle
 * `main`, Wiki-Stand `wiki_path_snapshot`, einer je Artikel). Die Kennung der Box ist ein Abschnitt (der Anker der Oberfläche); die Straße löst `strassenAbschnitte` auf, wie die Wegliste es tut: gleicher Name,
 * derselbe Stand (auf der Karte, von der Karte genommen, gelöscht), keine Seewege; ein Abschnitt ohne echten Namen (ein Griff wie „Weg-6029“) ist nur er selbst.
 *
 * - **Zuweisen:** an allen Abschnitten die Hauptzuweisung (`main`: die Zeile des Abschnitts wird an Ort und Stelle belegt oder belebt, es gibt je Abschnitt nur eine), Zustand `assigned`, Herkunft `editor`;
 *   eine weitere Zuweisung auf denselben Artikel würde die Tafel doppelt halten und wird still gelegt. Dazu die Tafel X2 (Art `weg`, an den Abschnitten).
 * - **Entfernen:** die Hauptzuweisung der Abschnitte wird still gelegt (nie gelöscht; `retired_origin = 'editor'`, die der Import nie belebt). Der Name bleibt, wie er ist; der Vermerk „wiki“ an Name, Wegtyp und
 *   Kennzeichen (`field_origin`, Art `path`) wird „manual“. Die weiteren Artikel bleiben stehen (WI-0300): Ein Weg kann danach weitere Artikel ohne Hauptartikel tragen.
 * - **Weitere Artikel** (WI-0300, OPS-000108; Legacy `wiki_path_weitere`, `api/_internal/wiki/path-weitere.php`): Zuweisungen mit der Rolle `further` an Abschnitten der Straße, etwa ein Pilgerweg über einer
 *   Reichsstraße. Die Box zeigt sie nur an (`lies`); geschrieben werden sie seit WI-0302 je Abschnitt als weitere Straßennamen im Wegeditor (`path.update`, `editor/path-weitere.ts`). Die Schritte, die die Box
 *   unter WI-0300 schrieb, nimmt die Rücknahme weiter zurück: Sie belebt oder legt still genau die Zeilen, die der Schritt schrieb (`anschluss.ts`, `WeitereAnschluss`). Die Tafel X2 kennt nur den Hauptartikel.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

/** Die Abschnitte der Straße, zu der `anker` gehört (öffentliche Kennungen, sortiert); leer, wenn es den Abschnitt nicht gibt. */
export async function strassenAbschnitte(
    db: Parameters<Anschluss["lies"]>[0],
    anker: string,
): Promise<{ ids: string[]; name: string; mapDomainId: string }> {
    const [kopf] = await db<
        { name: string; subtype: string; map_domain_id: string; is_active: boolean; off_map: boolean }[]
    >`SELECT name, subtype, map_domain_id, is_active, off_map FROM path WHERE public_id = ${anker}::uuid AND subtype <> 'Seeweg'`;
    if (kopf === undefined) return { ids: [], name: "", mapDomainId: "" };
    if (pathReaderName(kopf.name, kopf.subtype) === null) {
        return { ids: [anker], name: kopf.name, mapDomainId: kopf.map_domain_id };
    }
    const zeilen = await db<{ id: string }[]>`
        SELECT public_id::text AS id FROM path
         WHERE map_domain_id = ${kopf.map_domain_id} AND subtype <> 'Seeweg' AND name = ${kopf.name} AND btrim(name) <> subtype
           AND is_active = ${kopf.is_active} AND off_map = ${kopf.off_map}
         ORDER BY public_id
    `;
    return { ids: zeilen.map((zeile) => zeile.id), name: kopf.name, mapDomainId: kopf.map_domain_id };
}

/** Die weiteren Artikel einer Straße (WI-0300; siehe Kopf der Datei). */
const wegWeitere: WeitereAnschluss = {
    async lies(db, objekt) {
        const zeilen = await db<{ wiki_key: string; url: string; name: string | null; mit: number }[]>`
            SELECT s.wiki_key, min(w.wiki_url) AS url, s.name, count(DISTINCT w.path_id)::int AS mit
              FROM path p
              JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'further' AND w.is_active
              JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
             WHERE p.public_id = ANY(${objekt.ids}::uuid[])
             GROUP BY s.wiki_key, s.name
             ORDER BY lower(coalesce(s.name, s.wiki_key)), s.wiki_key
        `;
        return zeilen.map((zeile) => ({
            key: zeile.wiki_key,
            url: zeile.url,
            name: text(zeile.name) ?? titelOderAdresse(zeile.url),
            ...(zeile.mit < objekt.ids.length ? { anteil: { mit: zeile.mit, von: objekt.ids.length } } : {}),
        }));
    },

    async belebe(tx, zeilen) {
        if (zeilen.length === 0) return 0;
        const belebt = await tx<{ id: string }[]>`
            UPDATE path_wiki_assignment w
               SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, assignment_origin = z.herkunft, updated_at = now()
              FROM unnest(${zeilen.map((zeile) => zeile.id)}::bigint[], ${zeilen.map((zeile) => zeile.herkunft)}::text[]) AS z(id, herkunft)
             WHERE w.id = z.id AND NOT w.is_active AND w.role = 'further'
               AND NOT EXISTS (
                   SELECT 1 FROM path_wiki_assignment a WHERE a.path_id = w.path_id AND a.is_active AND a.snapshot_id = w.snapshot_id
               )
            RETURNING w.id::text AS id
        `;
        return belebt.length;
    },

    async legeStill(tx, zeilen) {
        if (zeilen.length === 0) return 0;
        const still = await tx<{ id: string }[]>`
            UPDATE path_wiki_assignment
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor', updated_at = now()
             WHERE id = ANY(${zeilen.map((zeile) => zeile.id)}::bigint[]) AND is_active AND role = 'further'
            RETURNING id::text AS id
        `;
        return still.length;
    },

    async pruefe(db, zeilen) {
        if (zeilen.length === 0) return { aktiv: 0, zwilling: 0 };
        const [zahl] = await db<{ aktiv: number; zwilling: number }[]>`
            SELECT count(*) FILTER (WHERE w.is_active)::int AS aktiv,
                   count(*) FILTER (WHERE NOT w.is_active AND EXISTS (
                       SELECT 1 FROM path_wiki_assignment a WHERE a.path_id = w.path_id AND a.is_active AND a.snapshot_id = w.snapshot_id
                   ))::int AS zwilling
              FROM path_wiki_assignment w
             WHERE w.id = ANY(${zeilen.map((zeile) => zeile.id)}::bigint[])
        `;
        return zahl ?? { aktiv: 0, zwilling: 0 };
    },
};

/**
 * Der Stand je Abschnitt (OPS-000112; siehe `AbschnittsStand`): „An alle Abschnitte“ im Wegeditor weist einen Artikel, der nur an einem Teil der Abschnitte hing, der ganzen Straße zu. Die Rücknahme gibt
 * jedem Abschnitt seine Hauptzuordnung von vorher zurück: wo keine war, wird sie still gelegt (nie gelöscht) samt Tafel X2; wo eine war, kommt sie mit Herkunft zurück; die weiteren Zeilen desselben Artikels, die das
 * Zuweisen still legte, leben wieder auf. Der Vermerk „wiki“ der Felder bleibt, wie er ist (das Zuweisen hat ihn nicht geändert).
 */
const wegAbschnitte: AbschnittsAnschluss = {
    async lies(db, objekt, ziel) {
        const haupt = await db<
            { id: string; zustand: string | null; herkunft: string | null; system: string | null; key: string | null }[]
        >`
            SELECT p.public_id::text AS id, w.assignment_state AS zustand, w.assignment_origin AS herkunft, w.source_system AS system, s.wiki_key AS key
              FROM path p
              LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
              LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
             WHERE p.public_id = ANY(${objekt.ids}::uuid[])
        `;
        const ziele = objekt.ids.map((id) => ziel(id) ?? "");
        const weitere = await db<{ path: string; id: string; herkunft: string }[]>`
            SELECT p.public_id::text AS path, w.id::text AS id, w.assignment_origin AS herkunft
              FROM unnest(${objekt.ids}::uuid[], ${ziele}::text[]) AS z(id, key)
              JOIN path p ON p.public_id = z.id
              JOIN wiki_path_snapshot s ON s.wiki_key = z.key AND s.is_active
              JOIN path_wiki_assignment w ON w.path_id = p.id AND w.snapshot_id = s.id AND w.role = 'further' AND w.is_active
             ORDER BY w.id
        `;
        const stand = new Map<string, AbschnittsStand>();
        for (const zeile of haupt)
            stand.set(zeile.id, {
                haupt:
                    zeile.zustand === null
                        ? null
                        : {
                              key: zeile.key,
                              zustand: zeile.zustand,
                              herkunft: zeile.herkunft ?? "",
                              system: zeile.system ?? "",
                          },
                weitere: [],
            });
        for (const zeile of weitere) stand.get(zeile.path)?.weitere.push({ id: zeile.id, herkunft: zeile.herkunft });
        return stand;
    },

    async stelleHer(tx, objekt, ziel) {
        const ohne: string[] = [];
        const mit = new Map<string, { key: string; ids: string[] }>();
        const herkunft = new Map<string, { wert: Zuordnungsherkunft; ids: string[] }>();
        for (const id of objekt.ids) {
            const stand = ziel.get(id);
            if (stand === undefined) continue;
            if (stand.haupt === null) {
                ohne.push(id);
                continue;
            }
            const { key, zustand, herkunft: von, system } = stand.haupt;
            if (key === null)
                throw new ApiError(409, "edit_conflict", "Den Wiki-Stand des Artikels von vorher gibt es nicht mehr.", {
                    currentRevision: 0,
                });
            const gruppe = mit.get(key) ?? { key, ids: [] as string[] };
            gruppe.ids.push(id);
            mit.set(key, gruppe);
            const wert = { zustand, herkunft: von, system };
            const schluessel = JSON.stringify(wert);
            const teil = herkunft.get(schluessel) ?? { wert, ids: [] as string[] };
            teil.ids.push(id);
            herkunft.set(schluessel, teil);
        }
        if (ohne.length > 0) {
            await tx`
                UPDATE path_wiki_assignment w
                   SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor', updated_at = now()
                  FROM path p
                 WHERE p.id = w.path_id AND p.public_id = ANY(${ohne}::uuid[]) AND w.is_active AND w.role = 'main'
            `;
            await legeX2Still(tx, "weg", ohne);
        }
        for (const gruppe of mit.values()) await wegAnschluss.weise(tx, { ...objekt, ids: gruppe.ids }, gruppe.key);
        for (const teil of herkunft.values())
            await wegAnschluss.setzeHerkunft!(tx, { ...objekt, ids: teil.ids }, teil.wert);
        const zeilen = [...ziel.values()].flatMap((stand) => stand.weitere);
        if ((await wegWeitere.belebe(tx, zeilen)) !== zeilen.length)
            throw new ApiError(409, "edit_conflict", "Eine Zuordnung am Weg hat sich inzwischen geändert.", {
                currentRevision: 0,
            });
    },
};

export const wegAnschluss: Anschluss = {
    art: "weg",
    schreiber: wegSchreiber,
    weitere: wegWeitere,
    abschnitte: wegAbschnitte,

    ...herkunftDerTafel({ zuordnung: "path_wiki_assignment", schluessel: "path_id", traeger: "path", haupt: true }),

    async lies(db, id) {
        const strasse = await strassenAbschnitte(db, id);
        if (strasse.ids.length === 0) return undefined;
        const zeilen = await db<Zeile[]>`
            SELECT p.public_id::text AS id, w.assignment_state, w.wiki_url, s.id AS stand_id, s.wiki_key AS s_key, s.name AS s_name
              FROM path p
              LEFT JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
              LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
             WHERE p.public_id = ANY(${strasse.ids}::uuid[])
             ORDER BY p.public_id
        `;
        const mitArtikel = (zeile: Zeile): boolean =>
            (zeile["assignment_state"] === "assigned" || zeile["assignment_state"] === "address_only") &&
            text(zeile["wiki_url"]) !== null;
        const fuehrend =
            zeilen.find((zeile) => mitArtikel(zeile) && zeile["stand_id"] !== null) ?? zeilen.find(mitArtikel);
        const url = fuehrend === undefined ? null : text(fuehrend["wiki_url"]);
        const anzahl =
            url === null ? 0 : zeilen.filter((zeile) => mitArtikel(zeile) && text(zeile["wiki_url"]) === url).length;
        const objekt: BoxObjekt = {
            art: "weg",
            id,
            name: strasse.name,
            mapDomainId: strasse.mapDomainId,
            ids: zeilen.map((zeile) => String(zeile["id"])),
            artikel:
                fuehrend === undefined || url === null
                    ? null
                    : {
                          key: text(fuehrend["s_key"]) ?? titelOderAdresse(url),
                          url,
                          name: text(fuehrend["s_name"]) ?? titelOderAdresse(url),
                      },
            mitStand: fuehrend !== undefined && fuehrend["stand_id"] !== null,
            ...(anzahl > 0 && anzahl < zeilen.length ? { anteil: { mit: anzahl, von: zeilen.length } } : {}),
        };
        return objekt;
    },

    async suche(db, objekt, q) {
        const muster = sucheMuster(q);
        const zeilen = await db<Zeile[]>`
            SELECT s.wiki_key, s.wiki_url, coalesce(s.name, s.wiki_key) AS name, s.art, s.lage,
                   (SELECT min(p.name) FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                     WHERE w.snapshot_id = s.id AND w.is_active AND w.role = 'main' AND p.is_active AND NOT (p.public_id = ANY(${objekt.ids}::uuid[]))) AS belegt
              FROM wiki_path_snapshot s
             WHERE s.is_active AND (${muster}::text IS NULL OR coalesce(s.name, '') ILIKE ${muster} ESCAPE '\\' OR s.wiki_key ILIKE ${muster} ESCAPE '\\')
             ORDER BY lower(coalesce(s.name, s.wiki_key)), s.wiki_key
             LIMIT ${TREFFER_MAX}
        `;
        return zeilen.map((zeile): WikiTreffer => {
            const werte: Record<string, string> = {};
            const art = text(zeile["art"]);
            if (art !== null) werte["art"] = art;
            const lage = text(zeile["lage"]);
            if (lage !== null) werte["lage"] = lage;
            const belegt = text(zeile["belegt"]);
            return {
                key: String(zeile["wiki_key"]),
                url: String(zeile["wiki_url"]),
                name: String(zeile["name"]),
                werte,
                ...(belegt === null ? {} : { belegt }),
            };
        });
    },

    async sperre(tx, objekt) {
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision FROM path WHERE public_id = ANY(${objekt.ids}::uuid[])
             ORDER BY public_id FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async weise(tx, objekt, key) {
        const [stand] = await tx<{ id: string; wiki_key: string; wiki_url: string; name: string | null }[]>`
            SELECT id::text AS id, wiki_key, wiki_url, name FROM wiki_path_snapshot WHERE wiki_key = ${key} AND is_active
        `;
        if (stand === undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
        // Eine weitere Zuweisung auf denselben Artikel hielte die Tafel doppelt (ein Abschnitt nennt einen Artikel höchstens einmal).
        await tx`
            UPDATE path_wiki_assignment w SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
              FROM path p
             WHERE p.id = w.path_id AND p.public_id = ANY(${objekt.ids}::uuid[]) AND w.is_active AND w.role = 'further' AND w.snapshot_id = ${stand.id}::bigint
        `;
        await tx`
            INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
            SELECT id, 'main', ${stand.wiki_url}, ${stand.id}::bigint, 'assigned', 'editor', 'avesmaps3d', TRUE
              FROM path WHERE public_id = ANY(${objekt.ids}::uuid[])
            ON CONFLICT (path_id) WHERE role = 'main' DO UPDATE
               SET wiki_url = EXCLUDED.wiki_url, snapshot_id = EXCLUDED.snapshot_id, assignment_state = 'assigned', assignment_origin = 'editor',
                   source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
        `;
        await schreibeX2(tx, "weg", objekt.ids, { key: stand.wiki_key, url: stand.wiki_url, name: stand.name });
        return { key: stand.wiki_key, url: stand.wiki_url, name: stand.name ?? titelOderAdresse(stand.wiki_url) };
    },

    async entferne(tx, objekt) {
        // Name, Wegtyp und Kennzeichen behalten ihren Wert; der Vermerk „wiki“ wird „manual“.
        await tx`
            UPDATE field_origin SET origin = 'manual', set_at = now()
             WHERE object_kind = 'path' AND object_id = ANY(${objekt.ids}::uuid[]) AND origin = 'wiki'
        `;
        await tx`
            UPDATE path_wiki_assignment w
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor', updated_at = now()
              FROM path p
             WHERE p.id = w.path_id AND p.public_id = ANY(${objekt.ids}::uuid[]) AND w.is_active AND w.role = 'main'
        `;
        await legeX2Still(tx, "weg", objekt.ids);
    },

    async beruehre(tx, objekt) {
        const zeilen = await tx<{ id: string; revision: number }[]>`
            UPDATE path SET name = name WHERE public_id = ANY(${objekt.ids}::uuid[]) RETURNING public_id::text AS id, revision::int AS revision
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },
};
