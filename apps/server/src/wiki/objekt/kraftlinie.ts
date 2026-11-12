import type { WikiTreffer } from "@avesmaps3d/shared";
import { ApiError } from "../../http/api-error.ts";
import { linienAbschnitte } from "../../editor/kraftlinien-schreiben.ts";
import { kraftlinieSchreiber } from "../abgleich/uebernahme/kraftlinie.ts";
import {
    TREFFER_MAX,
    herkunftDerTafel,
    legeX2Still,
    schreibeX2,
    sucheMuster,
    titelOderAdresse,
    type Anschluss,
    type BoxObjekt,
} from "./anschluss.ts";

/**
 * Die Kraftlinie an der Wiki-Box (WI-0253): eine Linie besteht aus Abschnitten (`powerline`, gleicher Name), und der Artikel hängt je LINIE an allen (`powerline_wiki_assignment` je Abschnitt, Wiki-Stand
 * `wiki_powerline_snapshot`, einer je Artikel). Die Kennung der Box ist ein Abschnitt der Linie (der Anker der Oberfläche); `linienAbschnitte` löst die Linie auf, wie der Editor es tut.
 *
 * - **Zuweisen:** an allen Abschnitten Zustand `assigned`, Herkunft `editor`, Zeiger auf den Wiki-Stand, dazu die Tafel X2 (Art `kraftlinie`). Dasselbe schreibt der Editor mit „Fertig“ (`kraftlinien-schreiben.ts`).
 * - **Entfernen:** die Zuordnung wird still gelegt (`retired_origin = 'editor'`, die der Import nie belebt), die Tafel X2 ebenso. Vorher behalten die Felder ihre Werte: Name und Beschreibung mit dem Vermerk
 *   „wiki“ werden eigene, und eine leere Beschreibung („leer heißt: folgt dem Wiki“) bekommt den Text des Artikels als eigenen.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

export const kraftlinieAnschluss: Anschluss = {
    art: "kraftlinie",
    schreiber: kraftlinieSchreiber,

    ...herkunftDerTafel({ zuordnung: "powerline_wiki_assignment", schluessel: "powerline_id", traeger: "powerline" }),

    async lies(db, id) {
        const ids = await linienAbschnitte(db, id);
        if (ids.length === 0) return undefined;
        const zeilen = await db<Zeile[]>`
            SELECT p.public_id::text AS id, p.name, p.map_domain_id, a.assignment_state, a.wiki_url, s.id AS stand_id, s.wiki_key AS s_key, s.name AS s_name
              FROM powerline p
              LEFT JOIN powerline_wiki_assignment a ON a.powerline_id = p.id AND a.is_active
              LEFT JOIN wiki_powerline_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE p.public_id = ANY(${ids}::uuid[])
             ORDER BY p.public_id
        `;
        const kopf = zeilen.find((zeile) => zeile["id"] === id) ?? zeilen[0];
        if (kopf === undefined) return undefined;
        const mitArtikel = (zeile: Zeile): boolean =>
            (zeile["assignment_state"] === "assigned" || zeile["assignment_state"] === "address_only") &&
            text(zeile["wiki_url"]) !== null;
        // Der Artikel der Linie: der des ersten Abschnitts, der einen aus dem Wiki-Stand trägt (wie das Detail der Linie), sonst der erste mit Adresse.
        const fuehrend =
            zeilen.find((zeile) => mitArtikel(zeile) && zeile["stand_id"] !== null) ?? zeilen.find(mitArtikel);
        const url = fuehrend === undefined ? null : text(fuehrend["wiki_url"]);
        const key = fuehrend === undefined ? null : (text(fuehrend["s_key"]) ?? null);
        const anzahl =
            fuehrend === undefined
                ? 0
                : zeilen.filter((zeile) => mitArtikel(zeile) && text(zeile["wiki_url"]) === url).length;
        const objekt: BoxObjekt = {
            art: "kraftlinie",
            id,
            name: String(kopf["name"]),
            mapDomainId: String(kopf["map_domain_id"]),
            ids: zeilen.map((zeile) => String(zeile["id"])),
            artikel:
                fuehrend === undefined || url === null
                    ? null
                    : {
                          key: key ?? titelOderAdresse(url),
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
            SELECT s.wiki_key, s.wiki_url, coalesce(s.name, s.wiki_key) AS name, s.staerke, s.regionen,
                   (SELECT min(p.name) FROM powerline_wiki_assignment w JOIN powerline p ON p.id = w.powerline_id
                     WHERE w.snapshot_id = s.id AND w.is_active AND p.is_active AND NOT (p.public_id = ANY(${objekt.ids}::uuid[]))) AS belegt
              FROM wiki_powerline_snapshot s
             WHERE s.is_active AND (${muster}::text IS NULL OR coalesce(s.name, '') ILIKE ${muster} ESCAPE '\\' OR s.wiki_key ILIKE ${muster} ESCAPE '\\')
             ORDER BY lower(coalesce(s.name, s.wiki_key)), s.wiki_key
             LIMIT ${TREFFER_MAX}
        `;
        return zeilen.map((zeile): WikiTreffer => {
            const werte: Record<string, string> = {};
            const staerke = text(zeile["staerke"]);
            if (staerke !== null) werte["staerke"] = staerke;
            const regionen = text(zeile["regionen"]);
            if (regionen !== null) werte["regionen"] = regionen;
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
            SELECT public_id::text AS id, revision::int AS revision FROM powerline WHERE public_id = ANY(${objekt.ids}::uuid[])
             ORDER BY public_id FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async weise(tx, objekt, key) {
        const [stand] = await tx<{ id: string; wiki_key: string; wiki_url: string; name: string | null }[]>`
            SELECT id::text AS id, wiki_key, wiki_url, name FROM wiki_powerline_snapshot WHERE wiki_key = ${key} AND is_active
        `;
        if (stand === undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
        await tx`
            INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
            SELECT id, ${stand.wiki_url}, ${stand.id}::bigint, 'assigned', 'editor', 'avesmaps3d', TRUE
              FROM powerline WHERE public_id = ANY(${objekt.ids}::uuid[])
            ON CONFLICT (powerline_id) DO UPDATE
               SET wiki_url = EXCLUDED.wiki_url, snapshot_id = EXCLUDED.snapshot_id, assignment_state = 'assigned', assignment_origin = 'editor',
                   source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL
        `;
        await schreibeX2(tx, "kraftlinie", objekt.ids, { key: stand.wiki_key, url: stand.wiki_url, name: stand.name });
        return { key: stand.wiki_key, url: stand.wiki_url, name: stand.name ?? titelOderAdresse(stand.wiki_url) };
    },

    async entferne(tx, objekt) {
        // 1. Name und Beschreibung: „wiki“ wird „manual“; auch eine leere Beschreibung, die dem Wiki folgte (der Leser zeigt den Text des Artikels), trägt danach den Vermerk, weil ihr gleich der Text zufällt.
        await tx`
            INSERT INTO field_origin (object_kind, object_id, field, origin)
            SELECT DISTINCT 'powerline', p.public_id, f.field, 'manual'
              FROM powerline p
              CROSS JOIN (VALUES ('name'), ('description')) AS f(field)
              LEFT JOIN powerline_wiki_assignment a ON a.powerline_id = p.id AND a.is_active
              LEFT JOIN wiki_powerline_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE p.public_id = ANY(${objekt.ids}::uuid[])
               AND (EXISTS (SELECT 1 FROM field_origin o WHERE o.object_kind = 'powerline' AND o.object_id = p.public_id AND o.field = f.field AND o.origin = 'wiki')
                    OR (f.field = 'description' AND btrim(coalesce(p.description, '')) = '' AND btrim(coalesce(s.description, '')) <> ''))
            ON CONFLICT (object_kind, object_id, field) DO UPDATE SET origin = 'manual', set_at = now()
        `;
        // 2. Eine leere Beschreibung folgte dem Wiki: Der Text des Artikels wird ihr eigener (der Leser zeigt ohne Artikel nichts).
        await tx`
            UPDATE powerline p SET description = s.description
              FROM powerline_wiki_assignment a JOIN wiki_powerline_snapshot s ON s.id = a.snapshot_id AND s.is_active AND btrim(coalesce(s.description, '')) <> ''
             WHERE a.powerline_id = p.id AND a.is_active AND p.public_id = ANY(${objekt.ids}::uuid[]) AND btrim(coalesce(p.description, '')) = ''
        `;
        // 3. Die Zuordnung: still gelegt, nie gelöscht.
        await tx`
            UPDATE powerline_wiki_assignment w
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor'
              FROM powerline p
             WHERE p.id = w.powerline_id AND p.public_id = ANY(${objekt.ids}::uuid[]) AND w.is_active
        `;
        await legeX2Still(tx, "kraftlinie", objekt.ids);
    },

    async beruehre(tx, objekt) {
        const zeilen = await tx<{ id: string; revision: number }[]>`
            UPDATE powerline SET name = name WHERE public_id = ANY(${objekt.ids}::uuid[]) RETURNING public_id::text AS id, revision::int AS revision
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },
};
