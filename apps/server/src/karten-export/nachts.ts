import { AVENTURIA_SERIES, KARTEN_SVG_ROH } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { exportWurzel, leseSvgZeiger } from "./quellen.ts";
import { auftragEinreihen, leseKartenfassung } from "./svg-auftrag.ts";

/**
 * Der tägliche SVG-Abzug (WI-0280; Legacy: 03:17 UTC): Die Pflege des Workers fragt höchstens einmal am Tag, ob sich die Karte seit dem letzten Abzug geändert hat, und reiht
 * dann den Bau ein. Ein Werkzeug, das die API liest, bekommt so einen Abzug, der höchstens einen Tag hinter der Karte liegt, und unveränderte Karten kosten nichts.
 */

export async function reiheSvgEinWennNoetig(db: Queryable, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    const wurzel = exportWurzel(env, env["TILE_ROOT"]?.trim());
    if (wurzel === undefined) return false;
    const zeiger = await leseSvgZeiger(wurzel);
    const fassung = await leseKartenfassung(db, AVENTURIA_SERIES.mapDomain);
    if (zeiger.abzuege[KARTEN_SVG_ROH]?.fassung === fassung) return false;
    await auftragEinreihen(db, { art: "standard" }, "karten-export", "routine");
    return true;
}
