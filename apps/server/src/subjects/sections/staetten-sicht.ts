/**
 * Welche Stätte an welchem Ort SICHTBAR ist (Lesart B; Betreiberentscheid 2026-10-13 „ja zu allen drei“,
 * `project-control/state/entscheidungen.md`; Fallblatt `project-control/discovery/wi-0063-restauftrag-2026-10-13/staetten-fallblatt.md`).
 *
 * 🔴 **Zwei Stufen, in dieser Reihenfolge:**
 * 1. **Die gespeicherte Beziehung** (`site_settlement.place_id`): Legacys Kennung oder der Entscheid eines Menschen. Sie
 *    gewinnt immer, auch wenn die Kette etwas anderes nennt.
 * 2. **Sonst der ERSTE genannte Ort** der `standort`-Kette. Das ist keine Namensheuristik: Die Reihenfolge kommt aus Legacys
 *    Quelltext, und Legacy nimmt ebenfalls den ersten (Fallblatt T6, 32 mehrdeutige Ketten).
 *
 * 🔴 **Der Weg vom Key zum Ort ist überall derselbe** (`staetten-genannte-orte.ts`, Gegenprüfung 2026-10-10 §1.2): die
 * Zuordnung X2 (`wiki_key_assignment`, Legacys Art `siedlung`) auf aktive Siedlungen von Dorf bis Metropole. **Kein Name,
 * keine Faltung** - genau das hat der Betreiber am 2026-10-05 verboten.
 *
 * 🪤 **„Erster“ heißt erste POSITION der Kette, nicht erster Ort.** Trüge ein Key zwei aktive Siedlungen, stünde die Stätte an
 * beiden: Die Kette nennt dann beide an erster Stelle, und zwischen ihnen zu wählen wäre erfunden. Gemessen am 2026-10-13 auf
 * `avesmaps3d_dev`: **0 Fälle**. Kommt je einer dazu, ist das ein Befund für den Editor, kein stiller Vorzug.
 *
 * 🪤 **Zwei Rohquellen, nicht eine:** `site` (Punkte, gespeicherte Stätten, Wege, Sitze, Stadtteile; Migration 0099) und die
 * Wiki-Siedlungsregistry (`wiki_settlement_registry`, 0089) mit ihrer eigenen Kette. Die Registry liefert den größeren Teil
 * der sichtbaren Zeilen.
 *
 * 🪤 **`building_type_excluded` schließt hier NICHTS aus.** Das Merkmal ist ein Begriff der Registry: Es markiert lineare
 * Infrastruktur, die Legacys Bauwerks-Crawl fälschlich als Gebäude eintrug, und gehört in die Editoransicht der Registry
 * (`wiki-settlement-rows.ts`). In Legacys SICHTBARER Innerorts-Liste stehen dieselben Zeilen trotzdem - die Liste ist ein
 * anderer Pfad. Hier zu filtern ließ 12 Zeilen verschwinden, die Legacy heute zeigt (Talmauer, Kaiserallee, „Kanalisation
 * in Gareth“ …), und widerspräche der Freigabe „Beziehung, sonst der erste genannte Ort“. Gemessen am 2026-10-13:
 * 22 aktive Zeilen tragen das Merkmal, 12 davon zeigt Legacy heute, 16 haben eine auflösbare Kette. Befund der Sitzung
 * „Restabschluss Infopanels und Detaildaten“, von hier aus nachgerechnet.
 *
 * 🔴 Was hier NICHT mehr vorkommt: `settlement_place` (0078), Legacys gefalteter Siedlungsname. Er war bis zum Entscheid die
 * Quelle der sichtbaren Leser und ist es nicht mehr. Die Tafel bleibt stehen (sie trägt Legacys Urteil „in“ gegen „bei“), aber
 * kein Leser fragt sie noch.
 *
 * 💣 **Die Abfrage geht vom ORT aus, nicht von allen Stätten.** Eine erste Fassung baute den ganzen Schlüsselindex als CTE und
 * kostete 7,6 ms je Ort statt 0,6 ms - 13-mal so viel auf einem Weg, den jedes Ortsdetail geht. Jetzt beginnt sie mit den
 * wenigen Keys DIESES Orts und schlägt nur für die Treffer in der Kette nach (gemessen 2026-10-13, 40 Städte).
 */

/** Die Siedlungsgrößen, die als „Ort“ zählen - ohne Gebäude und Stadtviertel (wie `staetten-genannte-orte.ts`). */
export const SICHT_SUBTYPES = ["dorf", "kleinstadt", "stadt", "grossstadt", "metropole"] as const;

const SUBTYPE_LIST = SICHT_SUBTYPES.map((wert) => `'${wert}'`).join(", ");

/** Trifft dieser Key eine aktive Siedlung? Korreliert, damit kein Index über alle Zuweisungen gebaut wird. */
const TRIFFT_SIEDLUNG = (key: string): string => `
    EXISTS (
        SELECT 1 FROM wiki_key_assignment a2
          JOIN place p2 ON p2.public_id = a2.object_public_id
         WHERE a2.is_active AND a2.legacy_art = 'siedlung' AND a2.wiki_key = ${key}
           AND p2.is_active AND p2.subtype IN (${SUBTYPE_LIST})
    )`;

/**
 * Ein Kettenglied ist der ERSTE genannte Ort, wenn keine FRÜHERE Position derselben Kette eine Siedlung trifft. So formuliert
 * (statt als `DISTINCT ON` über alle Ketten) bleibt die Abfrage an einem einzelnen Ort schmal.
 */
const KEIN_FRUEHERER = (tabelle: string, schluessel: string): string => `
    NOT EXISTS (
        SELECT 1 FROM ${tabelle} frueher
         WHERE frueher.${schluessel} = np.${schluessel} AND frueher.position < np.position
           AND ${TRIFFT_SIEDLUNG("frueher.target_key")}
    )`;

/**
 * Die sichtbaren Stätten der Orte, die `carriers` nennt (ein SQL-Ausdruck, der `place.id` liefert). Spalten: `place_id`,
 * `name`, `art`, `wiki_url`, `jump` (die `public_id` eines noch aktiven eigenen Kartenpunkts) und `herkunft`.
 */
export function staettenSichtSql(carriers: string): string {
    return `
WITH ziel AS (SELECT id, public_id FROM place WHERE id IN (${carriers})),
ziel_key AS (
    SELECT DISTINCT a.wiki_key, z.id AS place_id
      FROM ziel z
      JOIN wiki_key_assignment a ON a.is_active AND a.legacy_art = 'siedlung' AND a.object_public_id = z.public_id
     WHERE EXISTS (SELECT 1 FROM place p WHERE p.id = z.id AND p.subtype IN (${SUBTYPE_LIST}))
),
beziehung AS (
    SELECT ss.place_id, s.name, s.site_type AS art, s.wiki_url,
           CASE WHEN s.source_kind = 'punkt' THEN s.source_key END AS punkt_key,
           'beziehung' AS herkunft
      FROM site_settlement ss
      JOIN site s ON s.id = ss.site_id AND s.is_active
     WHERE ss.is_active AND ss.place_id IN (SELECT id FROM ziel)
),
genannt_site AS (
    SELECT zk.place_id, s.name, s.site_type AS art, s.wiki_url,
           CASE WHEN s.source_kind = 'punkt' THEN s.source_key END AS punkt_key,
           'genannt' AS herkunft
      FROM ziel_key zk
      JOIN site_named_place np ON np.target_key = zk.wiki_key
      JOIN site s ON s.id = np.site_id AND s.is_active
     WHERE NOT EXISTS (SELECT 1 FROM site_settlement ss WHERE ss.site_id = s.id AND ss.is_active)
       AND ${KEIN_FRUEHERER("site_named_place", "site_id")}
),
genannt_registry AS (
    SELECT zk.place_id, r.title AS name, r.building_type AS art, r.wiki_url,
           NULL::text AS punkt_key, 'genannt' AS herkunft
      FROM ziel_key zk
      JOIN wiki_settlement_registry_named_place np ON np.target_key = zk.wiki_key
      JOIN wiki_settlement_registry r ON r.id = np.registry_id AND r.is_active
     WHERE ${KEIN_FRUEHERER("wiki_settlement_registry_named_place", "registry_id")}
),
alle AS (
    SELECT * FROM beziehung UNION ALL SELECT * FROM genannt_site UNION ALL SELECT * FROM genannt_registry
)
SELECT a.place_id, a.name, a.art, a.wiki_url, a.herkunft, j.public_id::text AS jump
  FROM alle a
  LEFT JOIN place j ON j.is_active AND j.public_id = a.punkt_key::uuid`;
}
