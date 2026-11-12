import type { StaetteView, StaettenGroup, SubjectDetailKind } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { staettenSichtSql } from "./staetten-sicht.ts";

/**
 * Die Stätten eines Ortes (WI-0109; WI-0128 E18): die EINE Zahl der Zeile und ihr aufgeklappter Inhalt, nach ART gegliedert.
 *
 * 🔴 **Seit dem Betreiberentscheid vom 2026-10-13 („ja zu allen drei“) ist die Bindung LESART B** und steht in
 * `staetten-sicht.ts`: die gespeicherte Beziehung, sonst der erste genannte Ort der Kette - über Kennungen, nie über Namen.
 *
 * 🪤 Bis dahin hing die Zeile am GEFALTETEN SIEDLUNGSNAMEN (`settlement_place.settlement_key`, 0078), weil Legacys Export
 * `in_settlement_places` nur den Namen der Siedlung führt. Das trug, solange es Legacys Zahlen nachbaute, hatte aber zwei
 * Löcher, die das Kennungsmodell schließt: Zwei gleichnamige Orte zeigten BEIDE dieselben Stätten, und ein Umbenennen trennte
 * die Bindung. Die Tafel bleibt stehen (sie trägt Legacys Urteil „in“ gegen „bei“), aber kein Leser fragt sie noch.
 *
 * 🔴 **Nur Orte.** Legacy zeigt die Zeile nur in der Infobox eines Ortes, und eine Stätte IST per Definition etwas, das
 * innerhalb einer Siedlung liegt (Finding MCS-012: „außerorts ist die Abwesenheit der Beziehung“). Jede andere Art bekommt
 * eine leere Sektion statt eines Sonderfalls im Panel.
 *
 * 🔴 **Die ART kommt wörtlich, auch leer.** Legacys Rückfall „Bauwerk“ ist Anzeige und steht in der Sprachtafel; die Antwort
 * trägt `type: ""`. Sortiert wird darum erst in der Oberfläche - mit dem Wort, das dort steht (`staettenGroupsOf`).
 */

/** Eine Zeile, wie die Abfrage sie liefert. */
interface StaetteRow {
    art: string | null;
    name: string;
    wiki_url: string | null;
    jump: string | null;
}

/** Nur Adressen der Wiki Aventurica werden verlinkt (`staetten.yaml` -> `panelbezug.zeilen.inhalt`); alles andere bleibt Text. */
const WIKI_HOST = /^https:\/\/de\.wiki-aventurica\.de\//i;

export interface StaettenResult {
    count: number;
    groups: StaettenGroup[];
}

const EMPTY: StaettenResult = { count: 0, groups: [] };

/** Die Orte, deren Stätten gefragt sind, als Ausdruck über `place.id`. */
const CARRIERS = `SELECT id FROM place WHERE public_id = ANY($1::uuid[]) AND is_active`;

/**
 * Die Stätten der genannten Orte, nach Art gruppiert.
 *
 * 💣 **Der Sprung ⊕ entsteht nur, wo die Stätte einen eigenen, noch AKTIVEN Kartenpunkt hat.** Legacys dritte Quelle liefert
 * auch Punkte, die von der Karte genommen wurden; sie reisen mit, bekommen aber keinen Sprung. Ein Sprung auf einen Punkt, den
 * es nicht mehr gibt, wäre ein toter Link - dieselbe Regel wie bei jedem Objektlink.
 */
export async function listStaetten(
    database: Queryable,
    kind: SubjectDetailKind,
    publicIds: readonly string[],
): Promise<StaettenResult> {
    if (kind !== "place" || publicIds.length === 0) return EMPTY;
    const rows = await database.unsafe<StaetteRow[]>(
        `WITH sicht AS (${staettenSichtSql(CARRIERS)})
         SELECT art, name, wiki_url, jump FROM sicht ORDER BY coalesce(art, ''), lower(name), name`,
        [[...publicIds]],
    );
    const buckets = new Map<string, StaetteView[]>();
    for (const row of rows) {
        const type = row.art ?? "";
        const url = row.wiki_url;
        const entry: StaetteView = {
            name: row.name,
            ...(url !== null && WIKI_HOST.test(url) ? { url } : {}),
            ...(row.jump === null ? {} : { jump: { kind: "place" as const, id: row.jump } }),
        };
        const list = buckets.get(type);
        if (list === undefined) buckets.set(type, [entry]);
        else list.push(entry);
    }
    return {
        count: rows.length,
        groups: [...buckets.entries()].map(([type, entries]) => ({ type, entries })),
    };
}

/**
 * Nur die Zahl, für die Detailantwort. 🪤 Sie steht NICHT in {@link listStaetten}: Die Zahl reist mit dem Detail, die Namen
 * holt die Sektion erst beim Aufklappen (Gareth trägt über 450 Stätten). Gerechnet wird sie dort, wo alle anderen Zähler
 * entstehen (`carrier-tables.ts`), damit das Panel dafür keine zweite Frage stellt.
 */
export const staettenCountSql = (carrierTable: string): string =>
    `(SELECT count(*) FROM (${staettenSichtSql(
        `SELECT id FROM ${carrierTable} WHERE public_id = ANY($1::uuid[]) AND is_active`,
    )}) z)`;
