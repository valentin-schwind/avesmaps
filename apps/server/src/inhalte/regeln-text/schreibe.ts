import type { InhalteVorkommenBedingung } from "@avesmaps3d/shared";
import { gutAlsAnzeige, gutesZiel, kennungAnfang, kurz, norm } from "./hilfen.ts";
import type { Welt, WeltEintrag, WeltFlaeche, WeltOrt } from "./welt.ts";

/**
 * Der Rückweg „Als Text“ (WI-0254 §13; Port von `txRegelBlock` im Entwurf): die aktiven Regeln eines Eintrags in der Wiki-Kurzschrift, Kopf und eine Zeile `| Beziehung = …` je Regel. Rein, ohne Datenbank.
 *
 * - 🔴 **Der Rückweg muss jede Regel so schreiben, dass `lies` genau dieselbe Regel (gleicher Fingerabdruck) liest.** Ein Glied schreibt: Arten (mit ` oder `), dann `in` + Fläche, dann Lage, dann Klima.
 *   Eine Fläche steht als `[[Wiki-Titel|Name]]` (oder `[[Name]]`, wenn beide gleich sind), wenn der Wiki-Titel auf genau sie zeigt; sonst als `[[Name]]`, wenn der Name auf genau sie zeigt; sonst als `[[#xxxxxxxx|Name]]`.
 *   `in` steht davor, wo das Glied Arten hat oder die Fläche wie eine Landschaftsart heißt („Meer“ und „See“).
 * - Der Kopf trägt den Wiki-Titel, wo der Name in der Kategorie mehrfach vorkommt.
 */

/** Die Fläche als Link: `ziel` zum Prüfen, ob sie wie eine Art heißt (`#…` für die Kennung), `name` ihr Name, `text` der Link. */
function flaecheLink(f: WeltFlaeche, welt: Welt): { ziel: string; name: string; text: string } {
    if (f.aktiv && f.nurKennung !== true) {
        const anzeige = gutesZiel(f.name) ? f.name : "";
        if (f.wikiTitel !== "" && gutesZiel(f.wikiTitel)) {
            const t = welt.flaechenZu(f.wikiTitel);
            if (t.length === 1 && t[0] === f) {
                return {
                    ziel: f.wikiTitel,
                    name: f.name,
                    text:
                        f.wikiTitel === anzeige || anzeige === ""
                            ? `[[${f.wikiTitel}]]`
                            : `[[${f.wikiTitel}|${anzeige}]]`,
                };
            }
        }
        if (gutesZiel(f.name)) {
            const t = welt.flaechenZu(f.name);
            if (t.length === 1 && t[0] === f) return { ziel: f.name, name: f.name, text: `[[${f.name}]]` };
        }
    }
    const anzeige = f.name !== "" && gutAlsAnzeige(f.name) ? `|${f.name}` : "";
    return { ziel: `#${kennungAnfang(f.id)}`, name: f.name, text: `[[#${kennungAnfang(f.id)}${anzeige}]]` };
}

/** Der Ort als Link: `[[Name]]`, wenn der Name auf genau ihn zeigt, sonst `[[#Kennung|Name]]`. */
function ortLink(o: WeltOrt, welt: Welt): string {
    const gruppe = welt.orteNachName.get(norm(o.name)) ?? [];
    if (gruppe.length === 1 && gutesZiel(o.name)) return `[[${o.name}]]`;
    return `[[#${kennungAnfang(o.id)}${gutAlsAnzeige(o.name) ? `|${o.name}` : ""}]]`;
}

/** Der Kopf eines Eintrags: `Name (Kategorie)`, mit Wiki-Titel, wo der Name in der Kategorie mehrfach vorkommt. */
export function kopfText(e: WeltEintrag, welt: Welt): string {
    const nach = welt.eintraegeNachName.get(norm(e.name)) ?? [];
    const gleich = nach.filter((x) => x.kind === e.kind).length;
    return gleich > 1 && e.titel !== ""
        ? `${e.name} (${welt.kategorieName(e.kind)}, [[${e.titel}]])`
        : `${e.name} (${welt.kategorieName(e.kind)})`;
}

/**
 * Ein Glied: Arten, „in“ Fläche, Lage, Klima. Eine Fläche ohne „in“ nur, wenn das Glied keine Arten hat und die Fläche nicht wie eine Art heißt (weder ihr Ziel noch ihr Name: „Meer“ und „See“ stehen immer mit „in“).
 */
export function bedingungText(b: InhalteVorkommenBedingung, welt: Welt): string {
    const teile: string[] = [];
    const hatArten = b.arten.length > 0;
    const heisstWieArt = (s: string | null | undefined): boolean =>
        s !== undefined && s !== null && welt.arten.has(kurz(s));
    if (hatArten) teile.push(b.arten.map((a) => `[[${welt.artName(a.art)}]]`).join(" oder "));
    if (b.flaeche !== undefined || b.wartetAuf !== undefined) {
        let link: { ziel: string; name: string | null; text: string };
        let wartet = false;
        if (b.wartetAuf !== undefined) {
            link = { ziel: b.wartetAuf, name: b.wartetAuf, text: `[[${b.wartetAuf}]]` };
            wartet = true;
        } else {
            const kennung = b.flaeche!.kennung.toLowerCase();
            const f = welt.flaecheNachId.get(kennung);
            link = f
                ? flaecheLink(f, welt)
                : { ziel: "#", name: b.flaeche!.name ?? null, text: `[[#${kennungAnfang(kennung)}]]` };
        }
        const mitIn = hatArten || (!link.ziel.startsWith("#") && heisstWieArt(link.ziel)) || heisstWieArt(link.name);
        teile.push(`${mitIn ? "in " : ""}${link.text}${wartet ? " (wartet)" : ""}`);
    }
    if (b.lage !== undefined && b.lage.orte.length > 0) {
        const orte = b.lage.orte.map((o) => {
            const x = welt.orte.get(o.kennung.toLowerCase());
            return x ? ortLink(x, welt) : `[[#${kennungAnfang(o.kennung)}]]`;
        });
        teile.push(
            orte.length === 1
                ? `${welt.richtungName(b.lage.richtung)} von ${orte[0]!}`
                : `${welt.richtungName(b.lage.richtung)} der Linie ${orte[0]!}–${orte[1]!}`,
        );
    }
    if (b.klima !== undefined) {
        const [a, z] = [b.klima.von, b.klima.bis].sort(
            (x, y) => (welt.zonenIndex.get(x) ?? 99) - (welt.zonenIndex.get(y) ?? 99),
        );
        teile.push(a === z ? `Klima ${welt.zoneName(a!)}` : `Klima ${welt.zoneName(a!)} bis ${welt.zoneName(z!)}`);
    }
    return teile.join(" ");
}

/** Der Ausdruck einer Regel: Glieder durch „, “ (oder), „: “ (und) und „ außer “ (ohne). */
export function ausdruckText(bedingungen: readonly InhalteVorkommenBedingung[], welt: Welt): string {
    return bedingungen
        .map(
            (b, i) =>
                (i === 0 ? "" : b.joinOp === "oder" ? ", " : b.joinOp === "ohne" ? " außer " : ": ") +
                bedingungText(b, welt),
        )
        .join("");
}

/** Der Block eines Eintrags: Kopf und eine Zeile „| Beziehung = …“ je Regel. */
export function schreibeRegelBlock(
    e: WeltEintrag,
    regeln: readonly { relation: string; bedingungen: readonly InhalteVorkommenBedingung[] }[],
    welt: Welt,
): string {
    const zeilen = [kopfText(e, welt)];
    for (const r of regeln) zeilen.push(`| ${welt.beziehungName(r.relation)} = ${ausdruckText(r.bedingungen, welt)}`);
    return zeilen.join("\n");
}
