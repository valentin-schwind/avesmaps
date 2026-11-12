import {
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    UUID_PATTERN,
    WIKISYNC_LAGE_ORTSARTEN,
    type InhalteVorkommenArt,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { titelAusWikiAdresse } from "../../wiki/vorschau/adresse.ts";
import { ladeKetten, titelNorm } from "../vorkommen-regeln-lesen.ts";
import {
    baueWelt,
    type Welt,
    type WeltDaten,
    type WeltEintrag,
    type WeltFlaeche,
    type WeltOrt,
    type WeltQuelle,
    type WeltRegel,
} from "./welt.ts";

/**
 * Die Welt des Lesers aus der Datenbank (WI-0254 §13): nur lesend, EINE Abfrage je Tafel, bei jeder Anfrage neu (die Redaktion soll nie gegen einen Stand von vor einer Stunde prüfen).
 *
 * - **Flächen** wie die Route `…/vorkommen-flaechen`: aktive `region` außerhalb der Klima-Ebene mit ihrem Wiki-Titel (`region.wiki_url`); dazu, was vorhandene Regeln nennen und der Katalog nicht führt (stillgelegt, Klima-Ebene,
 *   ohne Namen), mit Name und Stand: Sie lassen sich über `[[#Kennung|Name]]` lesen, wenn eine Regel des Eintrags sie nennt, und nie neu anlegen.
 * - **Orte** wie die Route `…/vorkommen-orte`: aktive Siedlungen (`WIKISYNC_LAGE_ORTSARTEN`) mit der Stelle auf der Karte.
 * - **Einträge**: aktive `lore_entry` mit Name, Art und dem Wiki-Titel (`wiki_title`, sonst der Titel der Wiki-Adresse). **Quellen**: aktive `feature_source` mit Titel.
 * - **Regeln**: die aktiven Regeln aller aktiven Einträge im Lesemodell (`ladeKetten`), mit dem gespeicherten Fingerabdruck.
 * - **Wartende Titel** (für `(wartet)`, wie `ladeBekannteTitel` im Schreiber): `wiki_area_title` aller Bedingungen des Eintrags in jedem Zustand und die offenen Flächen im Vorschlag des WikiSync (jüngster fertiger Lauf).
 *   Dazu die Wiki-Titel, die inzwischen eine aktive Fläche trägt.
 */

export interface WeltOptionen {
    /**
     * Nur für „Als Text“: Es genügt dieser Eintrag (auch ein stillgelegter) mit seinen Regeln; Quellen, Quellenverknüpfungen und wartende Titel entfallen. Die Orte und Flächen kommen ganz, denn sie
     * entscheiden, ob ein Name allein genügt oder `[[#Kennung|Name]]` nötig ist.
     */
    nurEintrag?: string;
}

const UUID = new RegExp(UUID_PATTERN, "u");
const BEZIEHUNGEN: ReadonlySet<string> = new Set(INHALTE_VORKOMMEN_BEZIEHUNGEN);

interface FlaecheZeile {
    id: string;
    name: string | null;
    ebene: string;
    art: string | null;
    wiki_url: string | null;
}

export async function ladeWelt(db: Queryable, optionen: WeltOptionen = {}): Promise<Welt> {
    const { nurEintrag } = optionen;
    const katalog = await db<FlaecheZeile[]>`
        SELECT r.public_id::text AS id, r.name, r.region_layer AS ebene, r.region_type AS art, r.wiki_url
          FROM region r WHERE r.is_active AND r.region_layer <> 'klima' AND r.name IS NOT NULL AND btrim(r.name) <> ''
         ORDER BY r.id
    `;
    const flaechen: WeltFlaeche[] = [];
    const titelMitFlaeche = new Set<string>();
    for (const zeile of katalog) {
        const titel = titelAusWikiAdresse(zeile.wiki_url);
        const wikiTitel = titel === null ? "" : titel.replaceAll("_", " ").trim();
        if (wikiTitel !== "") titelMitFlaeche.add(titelNorm(wikiTitel));
        flaechen.push({
            id: zeile.id,
            name: zeile.name!.trim(),
            ebene: zeile.ebene,
            art: zeile.art ?? "",
            aktiv: true,
            wikiTitel,
        });
    }
    // `titelMitFlaeche` wie der Schreiber ihn rechnet (`ladeTitelMitFlaeche`): jede aktive Fläche außerhalb der Klima-Ebene mit Wiki-Adresse, auch eine ohne Namen.
    for (const zeile of await db<{ wiki_url: string }[]>`
        SELECT wiki_url FROM region WHERE is_active AND wiki_url IS NOT NULL AND region_layer <> 'klima' AND (name IS NULL OR btrim(name) = '')
    `) {
        const titel = titelAusWikiAdresse(zeile.wiki_url);
        if (titel !== null) titelMitFlaeche.add(titelNorm(titel));
    }

    const orte = (
        await db<{ id: string; name: string; art: string; x: number; y: number }[]>`
            SELECT p.public_id::text AS id, p.name, p.subtype AS art,
                   round(ST_X(p.geom)::numeric, 2)::float8 AS x, round(ST_Y(p.geom)::numeric, 2)::float8 AS y
              FROM place p WHERE p.is_active AND p.subtype = ANY(${[...WIKISYNC_LAGE_ORTSARTEN]}::text[]) AND p.name IS NOT NULL AND btrim(p.name) <> ''
             ORDER BY p.id
        `
    ).map((o): WeltOrt => ({ id: o.id, name: o.name.trim(), art: o.art, x: o.x, y: o.y }));

    const eintragZeilen = await db<
        {
            id: string;
            name: string;
            kind: string;
            wiki_key: string | null;
            wiki_title: string | null;
            wiki_url: string | null;
        }[]
    >`
        SELECT e.public_id::text AS id, e.name, e.kind, e.wiki_key, e.wiki_title, e.wiki_url
          FROM lore_entry e
         WHERE e.is_active ${nurEintrag === undefined ? db`` : db`OR e.public_id = ${nurEintrag}::uuid`}
         ORDER BY e.id
    `;
    const eintraege: WeltEintrag[] = eintragZeilen.map((e) => ({
        id: e.id,
        name: e.name.trim(),
        kind: e.kind as InhalteVorkommenArt,
        titel: (e.wiki_title ?? "").trim() !== "" ? e.wiki_title!.trim() : (titelAusWikiAdresse(e.wiki_url) ?? ""),
        wikiKey: e.wiki_key,
    }));

    const quellen: WeltQuelle[] =
        nurEintrag !== undefined
            ? []
            : (
                  await db<{ id: string; titel: string; typ: string | null }[]>`
                      SELECT public_id::text AS id, title AS titel, source_type AS typ
                        FROM feature_source WHERE is_active AND title IS NOT NULL AND btrim(title) <> '' ORDER BY lower(title), public_id
                  `
              ).map((q) => ({ id: q.id, titel: q.titel.trim(), typ: q.typ ?? "" }));

    // Die aktiven Regeln der aktiven Einträge (bzw. des einen Eintrags), mit der Kette im Lesemodell.
    const regelZeilen = await db<{ id: string; eintrag: string; relation: string; rule_key: string }[]>`
        SELECT r.id::text AS id, e.public_id::text AS eintrag, r.relation, r.rule_key
          FROM lore_rule r JOIN lore_entry e ON e.id = r.lore_entry_id
         WHERE r.state = 'active' AND r.is_active
           ${nurEintrag === undefined ? db`AND e.is_active` : db`AND e.public_id = ${nurEintrag}::uuid`}
         ORDER BY e.id, r.sort_order, r.id
    `;
    const ketten = await ladeKetten(
        db,
        regelZeilen.map((r) => r.id),
    );
    const regeln = new Map<string, WeltRegel[]>();
    for (const zeile of regelZeilen) {
        if (!BEZIEHUNGEN.has(zeile.relation)) continue;
        const liste = regeln.get(zeile.eintrag) ?? [];
        liste.push({ relation: zeile.relation, ruleKey: zeile.rule_key, bedingungen: ketten.get(zeile.id) ?? [] });
        regeln.set(zeile.eintrag, liste);
    }

    // Flächen, die vorhandene Regeln nennen und der Katalog nicht führt: nur mit Name und Stand, zum Lesen von `[[#Kennung|Name]]`.
    const imKatalog = new Set(flaechen.map((f) => f.id));
    const genannt = [
        ...new Set(
            [...regeln.values()].flatMap((liste) =>
                liste.flatMap((r) =>
                    r.bedingungen.flatMap((b) => (b.flaeche === undefined ? [] : [b.flaeche.kennung.toLowerCase()])),
                ),
            ),
        ),
    ].filter((kennung) => !imKatalog.has(kennung) && UUID.test(kennung));
    if (genannt.length > 0) {
        for (const zeile of await db<{ id: string; name: string | null; is_active: boolean }[]>`
            SELECT public_id::text AS id, name, is_active FROM region WHERE public_id = ANY(${genannt}::uuid[])
        `) {
            const name = (zeile.name ?? "").trim();
            if (name !== "")
                flaechen.push({
                    id: zeile.id,
                    name,
                    ebene: "",
                    art: "",
                    aktiv: zeile.is_active,
                    wikiTitel: "",
                    nurKennung: true,
                });
        }
    }

    const eintragsQuellen = new Map<string, Set<string>>();
    const wartendeTitel = new Map<string, Map<string, string>>();
    if (nurEintrag === undefined) {
        for (const zeile of await db<{ eintrag: string; quelle: string }[]>`
            SELECT e.public_id::text AS eintrag, s.public_id::text AS quelle
              FROM lore_entry_source l
              JOIN lore_entry e ON e.id = l.lore_entry_id
              JOIN feature_source s ON s.id = l.source_id
             WHERE l.state = 'active' AND l.is_active AND e.is_active
        `) {
            const menge = eintragsQuellen.get(zeile.eintrag) ?? new Set<string>();
            menge.add(zeile.quelle);
            eintragsQuellen.set(zeile.eintrag, menge);
        }
        const merke = (eintrag: string, titel: string): void => {
            const norm = titelNorm(titel);
            if (norm === "") return;
            const karte = wartendeTitel.get(eintrag) ?? new Map<string, string>();
            // Wer zuerst kommt, gilt: die Regeln des Eintrags gehen dem Vorschlag vor (wie `ladeBekannteTitel` im Schreiber).
            if (!karte.has(norm)) karte.set(norm, titel);
            wartendeTitel.set(eintrag, karte);
        };
        for (const zeile of await db<{ eintrag: string; titel: string }[]>`
            SELECT DISTINCT e.public_id::text AS eintrag, t.wiki_area_title AS titel
              FROM lore_rule_term t
              JOIN lore_rule r ON r.id = t.lore_rule_id
              JOIN lore_entry e ON e.id = r.lore_entry_id
             WHERE t.wiki_area_title IS NOT NULL AND e.is_active
        `) {
            merke(zeile.eintrag, zeile.titel);
        }
        // Die offenen Flächen im Vorschlag des WikiSync (jüngster fertiger Lauf mit Regelvorschlägen); fehlen die Tafeln (vor 0248), gibt es keinen.
        const [da] = await db<{ ja: boolean }[]>`
            SELECT to_regclass('public.wikisync_regel_vorschlag') IS NOT NULL AND to_regclass('public.wikisync_regel_lauf') IS NOT NULL
                   AND to_regclass('public.wikisync_lauf') IS NOT NULL AS ja
        `;
        if (da?.ja === true) {
            for (const zeile of await db<{ eintrag: string; titel: string | null }[]>`
                WITH lauf AS (
                    SELECT l.id FROM wikisync_lauf l JOIN wikisync_regel_lauf r ON r.lauf_id = l.id WHERE l.status = 'fertig' ORDER BY l.id DESC LIMIT 1
                )
                SELECT e.public_id::text AS eintrag, coalesce(f.f ->> 'titel', f.f ->> 'name') AS titel
                  FROM wikisync_regel_vorschlag v
                  JOIN lauf ON lauf.id = v.lauf_id
                  JOIN lore_entry e ON e.id = v.lore_entry_id AND e.is_active
                  CROSS JOIN LATERAL jsonb_path_query(v.payload, '$.regeln[*].bedingungen[*].flaeche ? (@.offen == true)') AS f(f)
            `) {
                if (zeile.titel !== null) merke(zeile.eintrag, zeile.titel);
            }
        }
    }

    const daten: WeltDaten = {
        flaechen,
        orte,
        eintraege,
        quellen,
        regeln,
        eintragsQuellen,
        wartendeTitel,
        titelMitFlaeche,
    };
    return baueWelt(daten);
}
