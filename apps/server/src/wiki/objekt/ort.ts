import { wikiLinkKey, type WikiTreffer } from "@avesmaps3d/shared";
import { ApiError } from "../../http/api-error.ts";
import { ortSchreiber } from "../abgleich/uebernahme/ort.ts";
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
 * Der Ort an der Wiki-Box (WI-0253): `place` mit seiner Zuordnung `place_wiki_assignment` (eine Zeile je Ort) und dem Wiki-Stand `wiki_settlement_snapshot` (einer je Artikel). Dazu die Tafel X2
 * (`wiki_key_assignment`, Art `siedlung`).
 *
 * - **Zuweisen:** Zustand `assigned`, Herkunft `editor`, Zeiger auf den Wiki-Stand. Das Gleiche schreibt `place.create` aus „Nicht auf der Karte“ (`address_only`); hier gibt es den Stand schon.
 * - **Entfernen:** Zustand `separated` („kein Artikel“, ohne Adresse und Zeiger; die Entscheidung des Editors, die der Import nie überschreibt). Vorher behalten die Felder ihre Werte: ein Wert mit dem
 *   Vermerk „wiki“ wird ein eigener (Name und Ortsgröße in `field_origin`, Einwohner, Lage und Oberhaupt an der Spalte), und ein leeres Feld, dessen Wert nur der Leser aus dem Wiki-Stand zeigte
 *   („eigen, sonst Wiki“), bekommt diesen Wert als eigenen. Sonst stünde nach dem Lösen ein leeres Feld da.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" && wert.trim() !== "" ? wert : null);

export const ortAnschluss: Anschluss = {
    art: "ort",
    schreiber: ortSchreiber,

    ...herkunftDerTafel({ zuordnung: "place_wiki_assignment", schluessel: "place_id", traeger: "place" }),

    async lies(db, id) {
        const [zeile] = await db<Zeile[]>`
            SELECT p.public_id::text AS id, p.name, p.map_domain_id, a.assignment_state, a.wiki_url, (a.snapshot_id IS NOT NULL AND s.id IS NOT NULL) AS mit_stand,
                   s.wiki_key AS s_key, coalesce(s.wiki_title, s.wiki_name) AS s_name, x.wiki_key AS x_key, x.wiki_title AS x_titel
              FROM place p
              LEFT JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active
              LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
              LEFT JOIN wiki_key_assignment x ON x.legacy_art = 'siedlung' AND x.object_public_id = p.public_id AND x.is_active
             WHERE p.public_id = ${id}::uuid AND p.is_active
        `;
        if (zeile === undefined) return undefined;
        const url = text(zeile["wiki_url"]);
        const hatArtikel =
            (zeile["assignment_state"] === "assigned" || zeile["assignment_state"] === "address_only") && url !== null;
        const objekt: BoxObjekt = {
            art: "ort",
            id,
            name: String(zeile["name"]),
            mapDomainId: String(zeile["map_domain_id"]),
            ids: [id],
            artikel: hatArtikel
                ? {
                      key: text(zeile["s_key"]) ?? text(zeile["x_key"]) ?? wikiLinkKey(url),
                      url,
                      name: text(zeile["s_name"]) ?? text(zeile["x_titel"]) ?? titelOderAdresse(url),
                  }
                : null,
            mitStand: zeile["mit_stand"] === true,
        };
        return objekt;
    },

    async suche(db, objekt, q) {
        const muster = sucheMuster(q);
        const zeilen = await db<Zeile[]>`
            SELECT s.wiki_key, s.wiki_url, coalesce(s.wiki_title, s.wiki_name, s.wiki_key) AS name, s.settlement_class, s.settlement_class_guessed, s.building_type,
                   coalesce(s.region_text, s.staat_text) AS region,
                   (SELECT min(p.name) FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id
                     WHERE a.snapshot_id = s.id AND a.is_active AND p.is_active AND p.public_id <> ${objekt.id}::uuid) AS belegt
              FROM wiki_settlement_snapshot s
             WHERE s.is_active AND (${muster}::text IS NULL OR coalesce(s.wiki_title, s.wiki_name, '') ILIKE ${muster} ESCAPE '\\' OR s.wiki_key ILIKE ${muster} ESCAPE '\\')
             ORDER BY lower(coalesce(s.wiki_title, s.wiki_name, s.wiki_key)), s.wiki_key
             LIMIT ${TREFFER_MAX}
        `;
        return zeilen.map((zeile): WikiTreffer => {
            const werte: Record<string, string> = {};
            const groesse = text(zeile["settlement_class"]);
            if (groesse !== null && zeile["settlement_class_guessed"] !== true) werte["groesse"] = groesse;
            const bau = text(zeile["building_type"]);
            if (bau !== null) werte["bauwerk"] = bau;
            const region = text(zeile["region"]);
            if (region !== null) werte["region"] = region;
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
            SELECT public_id::text AS id, revision::int AS revision FROM place WHERE public_id = ANY(${objekt.ids}::uuid[]) AND is_active
             ORDER BY public_id FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async weise(tx, objekt, key) {
        const [stand] = await tx<{ id: string; wiki_key: string; wiki_url: string; name: string | null }[]>`
            SELECT id::text AS id, wiki_key, wiki_url, coalesce(wiki_title, wiki_name) AS name
              FROM wiki_settlement_snapshot WHERE wiki_key = ${key} AND is_active
        `;
        if (stand === undefined)
            throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "key" });
        await tx`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
            SELECT id, ${stand.wiki_url}, ${stand.id}::bigint, 'assigned', 'editor', 'avesmaps3d', TRUE FROM place WHERE public_id = ${objekt.id}::uuid
            ON CONFLICT (place_id) DO UPDATE
               SET wiki_url = EXCLUDED.wiki_url, snapshot_id = EXCLUDED.snapshot_id, assignment_state = 'assigned', assignment_origin = 'editor',
                   source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
        `;
        await schreibeX2(tx, "siedlung", objekt.ids, { key: stand.wiki_key, url: stand.wiki_url, name: stand.name });
        return { key: stand.wiki_key, url: stand.wiki_url, name: stand.name ?? titelOderAdresse(stand.wiki_url) };
    },

    async entferne(tx, objekt) {
        const [ort] = await tx<{ id: string }[]>`SELECT id::text AS id FROM place WHERE public_id = ${objekt.id}::uuid`;
        if (ort === undefined) return;
        // 1. Ein Feld, das nur dem Wiki folgte, bekommt den Wert als eigenen; der Leser zeigt ohne Artikel nichts mehr.
        const [stand] = await tx<Zeile[]>`
            SELECT s.description, s.einwohner, s.oberhaupt, s.region_text, s.staat_text
              FROM place_wiki_assignment a JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE a.place_id = ${ort.id}::bigint AND a.is_active
        `;
        if (stand !== undefined) {
            const lage = [
                ...new Set(
                    [text(stand["region_text"]), text(stand["staat_text"])].filter((t): t is string => t !== null),
                ),
            ].join(" · ");
            const wiki = {
                description: text(stand["description"]),
                einwohner: text(stand["einwohner"]),
                oberhaupt: text(stand["oberhaupt"]),
                lage: lage === "" ? null : Array.from(lage).slice(0, 300).join(""),
            };
            const [satz] = await tx<Zeile[]>`
                SELECT description, einwohner, lage, oberhaupt, is_active FROM place_detail WHERE place_id = ${ort.id}::bigint FOR UPDATE
            `;
            const eigen = (feld: keyof typeof wiki): string | null =>
                satz === undefined || satz["is_active"] !== true ? null : text(satz[feld]);
            const neu = {
                description: eigen("description") ?? wiki.description,
                einwohner: eigen("einwohner") ?? wiki.einwohner,
                oberhaupt: eigen("oberhaupt") ?? wiki.oberhaupt,
                lage: eigen("lage") ?? wiki.lage,
            };
            const etwas = Object.values(neu).some((wert) => wert !== null);
            if (etwas) {
                if (satz === undefined) {
                    await tx`
                        INSERT INTO place_detail (place_id, description, einwohner, lage, oberhaupt, einwohner_origin, lage_origin, oberhaupt_origin)
                        VALUES (${ort.id}::bigint, ${neu.description}, ${neu.einwohner}, ${neu.lage}, ${neu.oberhaupt},
                                ${neu.einwohner === null ? null : "manual"}, ${neu.lage === null ? null : "manual"}, ${neu.oberhaupt === null ? null : "manual"})
                    `;
                } else {
                    // Jedes Feld mit Wert trägt danach „manual“; der Satz lebt wieder auf, wenn er still lag und jetzt etwas trägt.
                    await tx`
                        UPDATE place_detail SET
                            description = ${neu.description}, einwohner = ${neu.einwohner}, lage = ${neu.lage}, oberhaupt = ${neu.oberhaupt},
                            einwohner_origin = CASE WHEN ${neu.einwohner}::text IS NULL THEN NULL ELSE 'manual' END,
                            lage_origin = CASE WHEN ${neu.lage}::text IS NULL THEN NULL ELSE 'manual' END,
                            oberhaupt_origin = CASE WHEN ${neu.oberhaupt}::text IS NULL THEN NULL ELSE 'manual' END,
                            is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                         WHERE place_id = ${ort.id}::bigint
                    `;
                }
            }
        }
        // Name und Ortsgröße: der Vermerk „wiki“ wird „manual“ (der Wert bleibt, was er ist).
        await tx`
            UPDATE field_origin SET origin = 'manual', set_at = now()
             WHERE object_kind = 'place' AND object_id = ${objekt.id}::uuid AND origin = 'wiki'
        `;
        // 2. Die Zuordnung: „kein Artikel“, wie der Editor es entscheidet.
        await tx`
            UPDATE place_wiki_assignment
               SET assignment_state = 'separated', wiki_url = NULL, snapshot_id = NULL, assignment_origin = 'editor', source_system = 'avesmaps3d', updated_at = now()
             WHERE place_id = ${ort.id}::bigint AND is_active
        `;
        await legeX2Still(tx, "siedlung", objekt.ids);
    },

    async beruehre(tx, objekt) {
        const zeilen = await tx<{ id: string; revision: number }[]>`
            UPDATE place SET name = name WHERE public_id = ${objekt.id}::uuid AND is_active RETURNING public_id::text AS id, revision::int AS revision
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },
};
