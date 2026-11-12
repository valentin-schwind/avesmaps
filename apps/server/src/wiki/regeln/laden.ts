import { WIKISYNC_LAGE_RICHTUNGEN, isLandscapeHandle, type WikisyncLageRichtung } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { isMissingTable } from "../../system/state-row.ts";
import { Begriffstafel } from "./begriffe.ts";
import type { Bed } from "./ableiten.ts";
import type { Flaeche } from "./lesen.ts";
import type { BestehendeRegel, FlaechenKatalog, RegelKontext } from "./vorschlag.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
import { ladeSiedlungen } from "./siedlungen.ts";

/**
 * Was die Regelableitung aus der Datenbank liest (WI-0253 Scheibe Regelvorschläge, §24): die Flächen der Karte, die Begriffstafel der Umgebung und die Regeln, die die Vorkommen heute haben.
 * Nur lesend; die Aufträge und die Routen benutzen dieselben Funktionen.
 */

type Zeile = Record<string, unknown>;

const text = (wert: unknown): string | null => (typeof wert === "string" && wert !== "" ? wert : null);

/** Die Flächen der Karte (`region`, ohne die Klimabänder), nach dem Titel ihres Wiki-Artikels und nach ihrem Namen. */
export async function ladeFlaechenKatalog(db: Queryable): Promise<FlaechenKatalog> {
    const zeilen = await db<Zeile[]>`
        SELECT id::text AS id, public_id::text AS kennung, name, region_type, wiki_url
          FROM region
         WHERE is_active AND region_layer <> 'klima'
         ORDER BY id
    `;
    const nachTitel = new Map<string, Flaeche[]>();
    const nachName = new Map<string, Flaeche[]>();
    for (const zeile of zeilen) {
        const name = String(zeile["name"] ?? "").trim();
        const titel = titelAusWikiAdresse(text(zeile["wiki_url"]));
        const flaeche: Flaeche = {
            id: String(zeile["id"]),
            kennung: String(zeile["kennung"]),
            name,
            titel: titel === null ? null : titel.replaceAll("_", " ").trim(),
        };
        if (flaeche.titel !== null && flaeche.titel !== "") {
            const schluessel = flaeche.titel.toLowerCase();
            nachTitel.set(schluessel, [...(nachTitel.get(schluessel) ?? []), flaeche]);
        }
        // Ein Griff („Wald-925“) ist kein Name, und ein Name unter vier Zeichen findet im Text zu viel.
        if (name.length >= 4 && !isLandscapeHandle(name, String(zeile["region_type"] ?? ""))) {
            const schluessel = name.toLowerCase();
            nachName.set(schluessel, [...(nachName.get(schluessel) ?? []), flaeche]);
        }
    }
    return { nachTitel, nachName };
}

/** Die Abweichungen der Begriffstafel und ihre Revision. Fehlt die Tafel (vor 0248), gilt der Startwert (`revision: null`). */
export async function ladeBegriffeAbweichungen(
    db: Queryable,
    /** Mit dem Namen der Person, die eine Zeile zuletzt geändert hat (die Routen; die Aufträge lesen das geschützte Schema nicht). */
    mitNamen = false,
): Promise<{
    revision: number | null;
    abweichungen: Map<string, string[]>;
    geaendert: Map<string, { am: string | null; von: string | null }>;
}> {
    try {
        const [stand] = await db<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM wikisync_begriff_state WHERE id = 1`;
        const zeilen = mitNamen
            ? await db<Zeile[]>`
                  SELECT s.wort, s.pillen, s.changed_at, COALESCE(p.display_name, s.changed_by_label) AS wer
                    FROM wikisync_begriff_setting s LEFT JOIN avesmaps_auth.person p ON p.id = s.changed_by
                   ORDER BY s.wort
              `
            : await db<Zeile[]>`
                  SELECT s.wort, s.pillen, s.changed_at, s.changed_by_label AS wer FROM wikisync_begriff_setting s ORDER BY s.wort
              `;
        return {
            revision: stand?.revision ?? null,
            abweichungen: new Map(
                zeilen.map((zeile) => [String(zeile["wort"]), (zeile["pillen"] as string[] | null) ?? []]),
            ),
            geaendert: new Map(
                zeilen.map((zeile) => [
                    String(zeile["wort"]),
                    {
                        am: zeile["changed_at"] instanceof Date ? zeile["changed_at"].toISOString() : null,
                        von: text(zeile["wer"]),
                    },
                ]),
            ),
        };
    } catch (error) {
        if (isMissingTable(error)) return { revision: null, abweichungen: new Map(), geaendert: new Map() };
        throw error;
    }
}

/** Alles, was die Ableitung in der Vorschau braucht: Flächen, Begriffstafel und die Siedlungen für die Lage zu einer Linie. */
export async function ladeRegelKontext(db: Queryable): Promise<RegelKontext> {
    const flaechen = await ladeFlaechenKatalog(db);
    const begriffe = await ladeBegriffeAbweichungen(db);
    const siedlungen = await ladeSiedlungen(db);
    return {
        flaechen,
        tafel: new Begriffstafel(begriffe.abweichungen),
        begriffeRevision: begriffe.revision,
        siedlungen,
    };
}

function herkunftDerRegel(wert: unknown): BestehendeRegel["herkunft"] {
    return wert === "manual" ? "manual" : wert === "wiki_verbreitung" ? "wiki_verbreitung" : "unknown";
}

/**
 * Die aktiven Regeln aller Einträge (Waren, Fauna, Flora, Spezies), nach der öffentlichen Kennung des Eintrags (`lore_entry.public_id`), mit ihren Bedingungen zum Anzeigen („bisher“). Eine Bedingung mit Lage zu einer
 * Linie (Migration 0250) trägt Richtung und Orte (Kennung, Name, Stelle); ohne Lage fehlt das Feld.
 */
export async function ladeRegelBestand(db: Queryable): Promise<Map<string, BestehendeRegel[]>> {
    const regeln = await db<Zeile[]>`
        SELECT r.id::text AS id, e.public_id::text AS eintrag, r.relation, r.rule_key, r.legacy_origin
          FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id
         WHERE r.state = 'active' AND e.state IN ('active', 'suppressed')
         ORDER BY r.lore_entry_id, r.sort_order, r.id
    `;
    const jeEintrag = new Map<string, BestehendeRegel[]>();
    if (regeln.length === 0) return jeEintrag;
    const ids = regeln.map((regel) => String(regel["id"]));
    const bedingungen = await db<Zeile[]>`
        SELECT t.lore_rule_id::text AS rule_id, t.seq::int AS seq, t.join_op, t.area_region_id::text AS area_region_id, t.legacy_area_public_id, t.wiki_area_title,
               t.climate_from, t.climate_to, t.legacy_climate_from, t.legacy_climate_to,
               t.line_direction, t.line_place_a_id::text AS line_place_a_id, t.line_place_b_id::text AS line_place_b_id,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('ebene', y.region_layer, 'art', y.region_type) ORDER BY y.region_layer, y.region_type)
                           FROM lore_rule_term_type y WHERE y.lore_rule_term_id = t.id), '[]'::jsonb) AS arten
          FROM lore_rule_term t WHERE t.lore_rule_id = ANY(${ids}::bigint[]) ORDER BY t.lore_rule_id, t.seq
    `;
    const flaechenIds = [
        ...new Set(bedingungen.map((b) => text(b["area_region_id"])).filter((id): id is string => id !== null)),
    ];
    const namen = new Map<string, { name: string; kennung: string }>();
    if (flaechenIds.length > 0) {
        for (const zeile of await db<
            Zeile[]
        >`SELECT id::text AS id, public_id::text AS kennung, name FROM region WHERE id = ANY(${flaechenIds}::bigint[])`)
            namen.set(String(zeile["id"]), { name: String(zeile["name"] ?? ""), kennung: String(zeile["kennung"]) });
    }
    // Die Orte der Linien (Lage zu einer Linie): auch ein still gelegter Ort bleibt sichtbar, die Regel sagt, was sie sagte.
    const ortIds = [
        ...new Set(
            bedingungen.flatMap((b) =>
                [text(b["line_place_a_id"]), text(b["line_place_b_id"])].filter((id): id is string => id !== null),
            ),
        ),
    ];
    const orte = new Map<string, { kennung: string; name: string; x: number; y: number }>();
    if (ortIds.length > 0) {
        for (const zeile of await db<Zeile[]>`
            SELECT p.id::text AS id, p.public_id::text AS kennung, p.name, round(ST_X(p.geom)::numeric, 2)::float8 AS x, round(ST_Y(p.geom)::numeric, 2)::float8 AS y
              FROM place p WHERE p.id = ANY(${ortIds}::bigint[])
        `)
            orte.set(String(zeile["id"]), {
                kennung: String(zeile["kennung"]),
                name: String(zeile["name"] ?? ""),
                x: Number(zeile["x"]),
                y: Number(zeile["y"]),
            });
    }
    const jeRegel = new Map<string, Bed[]>();
    for (const zeile of bedingungen) {
        const regelId = String(zeile["rule_id"]);
        const flaecheId = text(zeile["area_region_id"]);
        const bekannt = flaecheId === null ? undefined : namen.get(flaecheId);
        const wikiTitel = text(zeile["wiki_area_title"]);
        const legacyKennung = text(zeile["legacy_area_public_id"]);
        const von = text(zeile["climate_from"]) ?? text(zeile["legacy_climate_from"]);
        const bis = text(zeile["climate_to"]) ?? text(zeile["legacy_climate_to"]);
        const verknuepfung = zeile["join_op"] === "oder" ? "oder" : zeile["join_op"] === "ohne" ? "ohne" : "und";
        const richtung = text(zeile["line_direction"]);
        const lageOrte = [text(zeile["line_place_a_id"]), text(zeile["line_place_b_id"])]
            .filter((id): id is string => id !== null)
            .map((id) => orte.get(id));
        const lage =
            richtung !== null &&
            (WIKISYNC_LAGE_RICHTUNGEN as readonly string[]).includes(richtung) &&
            lageOrte.length > 0 &&
            lageOrte.every((ort) => ort !== undefined)
                ? { richtung: richtung as WikisyncLageRichtung, orte: lageOrte.map((ort) => ({ ...ort! })) }
                : undefined;
        const liste = jeRegel.get(regelId) ?? [];
        liste.push({
            verknuepfung: liste.length === 0 ? "und" : verknuepfung,
            flaeche:
                bekannt !== undefined
                    ? {
                          name: bekannt.name,
                          id: flaecheId,
                          kennung: bekannt.kennung,
                          offen: false,
                          titel: null,
                          kandidat: null,
                      }
                    : wikiTitel !== null
                      ? { name: wikiTitel, id: null, kennung: null, offen: true, titel: wikiTitel, kandidat: null }
                      : legacyKennung !== null
                        ? {
                              name: legacyKennung,
                              id: null,
                              kennung: legacyKennung,
                              offen: false,
                              titel: null,
                              kandidat: null,
                          }
                        : null,
            arten: ((zeile["arten"] ?? []) as { ebene: string; art: string }[]).map((a) => ({
                ebene: a.ebene,
                art: a.art,
            })),
            klima: von !== null && bis !== null ? { von, bis } : null,
            ...(lage === undefined ? {} : { lage }),
            woerter: [],
            rueckfragen: [],
        });
        jeRegel.set(regelId, liste);
    }
    for (const regel of regeln) {
        const liste = jeEintrag.get(String(regel["eintrag"])) ?? [];
        liste.push({
            id: String(regel["id"]),
            beziehung: String(regel["relation"]),
            ruleKey: String(regel["rule_key"]),
            herkunft: herkunftDerRegel(regel["legacy_origin"]),
            bedingungen: jeRegel.get(String(regel["id"])) ?? [],
        });
        jeEintrag.set(String(regel["eintrag"]), liste);
    }
    return jeEintrag;
}
