import type { Queryable } from "../database.ts";

/**
 * Objekt oder Stelle einer Meldung aus Discord (WI-0297; gewählte Option vom 2026-11-10: bei den Meldungen, mit Objekt und Stelle, wenn bekannt). Discord fragt „Wo?“
 * frei (Adresse oder Ortsname, `discord/interaktion.ts`), und der Text der Meldung endet dann mit `Wo: …`. Mehr kennt ein Kanalvorgang aus Discord nicht.
 *
 * - Eine Adresse mit `x` und `y` (Kartenkoordinaten, wie sie jede Ansicht von Avesmaps im Anker trägt) wird eine **Stelle**.
 * - Ein Name, der genau einen sichtbaren Ort trifft (ohne Groß und Klein), wird dieser **Ort** als Objekt, mit Typ und Lage.
 * - Alles andere: kein Bezug. Die Meldung kommt trotzdem an; das „Wo:“ steht im Text.
 */

/** Der Bezug in der Form, die `community_melden` und `community_aus_discord_meldung` nehmen. */
export type DiscordBezug =
    | { art: "stelle"; lage: { x: number; y: number } }
    | {
          art: "objekt";
          objektArt: "place";
          objektId: string;
          name: string;
          typ?: string;
          lage: { x: number; y: number };
      };

const WO = /\n\s*\n\s*Wo:\s*(.+?)\s*$/u;
const gerundet = (wert: number): number => Math.round(wert * 1000) / 1000;

/** Das „Wo:“ am Ende des Textes, eine Zeile, höchstens 300 Zeichen (so lang ist das Feld in Discord); sonst `null`. */
export function woAus(text: string): string | null {
    const treffer = WO.exec(text);
    const wo = treffer?.[1]?.trim() ?? "";
    return wo === "" || wo.length > 300 || wo.includes("\n") ? null : wo;
}

/** Die Stelle aus einer Adresse mit `x` und `y` im Anker oder in der Abfrage; ohne beide endlichen Zahlen `null`. */
export function stelleAus(wo: string): { x: number; y: number } | null {
    let adresse: URL;
    try {
        adresse = new URL(wo);
    } catch {
        return null;
    }
    if (adresse.protocol !== "https:" && adresse.protocol !== "http:") return null;
    for (const teil of [adresse.hash.replace(/^#/u, ""), adresse.search.replace(/^\?/u, "")]) {
        const werte = new URLSearchParams(teil);
        const x = Number.parseFloat(werte.get("x") ?? "");
        const y = Number.parseFloat(werte.get("y") ?? "");
        if (Number.isFinite(x) && Number.isFinite(y)) return { x: gerundet(x), y: gerundet(y) };
    }
    return null;
}

/** Der Bezug aus dem Text der Meldung, oder `null`. Ein Ortsname zählt nur, wenn er genau einen aktiven, sichtbaren Ort trifft. */
export async function bezugAus(db: Queryable, text: string): Promise<DiscordBezug | null> {
    const wo = woAus(text);
    if (wo === null) return null;
    const stelle = stelleAus(wo);
    if (stelle !== null) return { art: "stelle", lage: stelle };
    if (/^[a-z]+:\/\//iu.test(wo) || /^www\./iu.test(wo)) return null;
    const orte = await db<{ id: string; name: string; typ: string | null; x: number; y: number }[]>`
        SELECT p.public_id::text AS id, p.name, p.place_kind AS typ, ST_X(p.geom) AS x, ST_Y(p.geom) AS y
          FROM place p
         WHERE p.is_active AND NOT p.is_hidden AND lower(p.name) = lower(${wo})
         LIMIT 2
    `;
    const [ort] = orte;
    if (orte.length !== 1 || ort === undefined) return null;
    return {
        art: "objekt",
        objektArt: "place",
        objektId: ort.id,
        name: ort.name.slice(0, 200),
        ...(ort.typ === null || ort.typ === "" ? {} : { typ: ort.typ.slice(0, 80) }),
        lage: { x: gerundet(Number(ort.x)), y: gerundet(Number(ort.y)) },
    };
}
