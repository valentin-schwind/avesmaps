import { KANON_OBJEKTARTEN, type KanonObjektart, type WikiNamespaceTafel } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { erbeGruppenNamensraum } from "./ableitung.ts";
import { KANON_TRAEGER } from "./laden.ts";
import { raumDerAdresse } from "./namensraum.ts";

/**
 * Die Zahlen neben den zwei Tafeln des Kanon-Etiketts (WI-0253 UI-1, Spalte „Objekte“ und „Wirkung prüfen“ im Mockup), nur gelesen:
 *
 * - **je Namensraum** die Träger, deren Wiki-Adresse (nach der Erbschaft der Wegegruppe, wie die Regel rechnet: `laden.ts`) in diesem Raum liegt.
 *   Ändert sich Kanon oder Bezeichner eines Raums, wechseln genau sie ihr Etikett, sobald die Etiketten neu berechnet sind (Rang 1, `ableitung.ts`).
 * - **je Objektart** die Träger OHNE Kanon-Zeile: Für sie entscheidet die Tafel „Ohne Wiki-Artikel und ohne Quelle“ (Rang 4, beim Lesen aufgelöst,
 *   `subjects/carrier-tables.ts`). Bei Wegen sind es Abschnitte; ein Weg trägt das Etikett seines ersten Abschnitts mit Zeile, die Zahl ist also
 *   eine Obergrenze.
 */

export interface KanonTafelZahlen {
    jeRaum: ReadonlyMap<number, number>;
    ohne: Readonly<Record<KanonObjektart, number>>;
}

export async function zaehleKanonTraeger(db: Queryable, tafel: WikiNamespaceTafel): Promise<KanonTafelZahlen> {
    const jeRaum = new Map<number, number>();
    const ohne = Object.fromEntries(KANON_OBJEKTARTEN.map((art) => [art, 0])) as Record<KanonObjektart, number>;
    for (const art of KANON_OBJEKTARTEN) {
        const tabellen = KANON_TRAEGER[art];
        const zeilen = await db.unsafe<{ gruppe: string | null; wiki_url: string | null }[]>(tabellen.auswahl);
        const eigene = zeilen.map((zeile) => raumDerAdresse(zeile.wiki_url, tafel).ns);
        const raeume =
            art === "path"
                ? erbeGruppenNamensraum(zeilen.map((zeile, i) => ({ gruppe: zeile.gruppe, ns: eigene[i] ?? null })))
                : eigene;
        for (const raum of raeume) if (raum !== null) jeRaum.set(raum, (jeRaum.get(raum) ?? 0) + 1);
        const [zahl] = await db.unsafe<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ${tabellen.traeger} c
              WHERE c.is_active AND NOT EXISTS (SELECT 1 FROM ${tabellen.kanon} k WHERE k.${tabellen.fremdschluessel} = c.id)`,
        );
        ohne[art] = zahl?.n ?? 0;
    }
    return { jeRaum, ohne };
}
