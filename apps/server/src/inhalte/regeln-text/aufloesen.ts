import { kennungAnfang, kurz, norm, vorschlaege } from "./hilfen.ts";
import type { FlaecheInnen, KlammerZeichen, LinkZeichen, Option, Problem, WortZeichen } from "./typen.ts";
import type { Welt, WeltFlaeche, WeltOrt } from "./welt.ts";

/**
 * Namen auflösen (WI-0254 §13; Port aus `txGlied` im Entwurf): Der Link eines Glieds wird zu einem Ort oder einer Fläche der Welt. Nichts wird geraten: Ein mehrdeutiger Name ist eine Rückfrage mit den Kennungen als Antwort,
 * ein unbekannter ein Fehler mit den nächstliegenden Namen. Jedes Problem hat die Stelle des Links im Text und Antworten, die den Text umschreiben (`Option.ersatz`).
 */

/** Wie der Schreiber einen Wiki-Titel vergleicht (`titelNorm` in `vorkommen-regeln-lesen.ts`; `test/regeln-text-lies.test.ts` hält beide gleich). */
export const titelNorm = (titel: string): string => titel.replaceAll("_", " ").trim().toLowerCase();

/** Was ein Glied vom Eintrag wissen muss, unter dem es steht. */
export interface GliedKontext {
    welt: Welt;
    /** Die Flächenkennungen (klein), die vorhandene Regeln des Eintrags nennen. */
    kennungen: ReadonlySet<string>;
    /** Die Titel, auf die der Eintrag schon wartet (`titelNorm` → Titel, wie gespeichert). */
    wartend: ReadonlyMap<string, string>;
    /** Der Eintrag ist ein vorhandener (aufgelöster); ein erst anzulegender kennt keine wartende Fläche. */
    vorhanden: boolean;
    zeilen: readonly string[];
    /** Die Zeile der Regel, für den Fall, dass das Glied leer ist. */
    zeile: number;
}

/** Eine Stelle im Text: Zeile und Spalten von, bis (ausschließlich). */
export type Stelle = { zeile: number; von: number; bis: number };

/** Das Gemeinsame der Auflöser: der Kontext des Eintrags und die Meldung eines Problems an eine Stelle. */
export interface Aufloeser {
    ctx: GliedKontext;
    melde(art: Problem["art"], text: string, stelle: Stelle, optionen?: Option[]): void;
}

/** Der Ersatz einer Stelle durch einen Text. */
export const ersatzFuer = (t: Stelle, text: string): Option["ersatz"] => ({
    zeile: t.zeile,
    von: t.von,
    bis: t.bis,
    text,
});

/** Ein Ort aus einem Link: über das Ziel, sonst über den Anzeigetext; mehrdeutig → Rückfrage mit [[#Kennung|Name]]. */
export function loeseOrt(a: Aufloeser, l: LinkZeichen): { id: string; name: string } | null {
    const { welt } = a.ctx;
    let kand: readonly WeltOrt[];
    if (l.kennung !== null) {
        const anfang = l.kennung;
        kand = [...welt.orte.values()].filter((x) => x.id.startsWith(anfang));
    } else {
        kand = welt.orteNachName.get(norm(l.ziel)) ?? [];
        if (kand.length === 0 && l.anzeige !== null && l.anzeige !== "")
            kand = welt.orteNachName.get(norm(l.anzeige)) ?? [];
    }
    if (kand.length === 1) return { id: kand[0]!.id, name: kand[0]!.name };
    if (kand.length > 1) {
        a.melde(
            "rueckfrage",
            l.kennung !== null
                ? `Der Kennungsanfang #${l.kennung} ist nicht eindeutig; mehr Zeichen schreiben.`
                : `„${l.ziel}“ gibt es mehrfach; welcher Ort ist gemeint?`,
            l,
            kand.map((x) => ({
                label: `${x.name} [${kennungAnfang(x.id)}]`,
                meta: `${welt.ortsartName(x.art)} bei ${String(x.x)} / ${String(x.y)}`,
                ersatz: ersatzFuer(l, `[[#${kennungAnfang(x.id)}|${x.name}]]`),
            })),
        );
        return null;
    }
    if (l.kennung !== null) {
        a.melde("fehler", `Einen Ort mit der Kennung #${l.kennung} gibt es nicht (nur Siedlungen).`, l);
        return null;
    }
    const v = vorschlaege(norm(l.ziel), welt.orteNamen, (x) => x.name);
    a.melde(
        "fehler",
        `Einen Ort „${l.ziel}“ gibt es nicht (nur Siedlungen).`,
        l,
        v.map((x) => ({ label: `${l.ziel} → ${x.name} ersetzen`, meta: "", ersatz: ersatzFuer(l, `[[${x.name}]]`) })),
    );
    return null;
}

/** Die Fläche eines Links, der in einem Glied mit `(wartet)` steht: nur ein Titel, auf den der Eintrag schon wartet (wie der Schreiber ihn prüft). */
export function loeseWartend(a: Aufloeser, l: LinkZeichen, wartet: KlammerZeichen): FlaecheInnen | null {
    const { ctx } = a;
    const { welt } = ctx;
    const gespeichert = ctx.wartend.get(titelNorm(l.ziel));
    if (gespeichert === undefined) {
        a.melde(
            "fehler",
            ctx.vorhanden
                ? `Der Eintrag wartet nicht auf einen Artikel „${l.ziel}“. Eine wartende Fläche gibt es nur für einen Artikel, auf den der Eintrag schon wartet (aus einer seiner Regeln oder dem Vorschlag des Wikis).`
                : "Ein Eintrag, der erst angelegt wird, wartet auf keinen Artikel; „(wartet)“ gibt es nur an einem vorhandenen Eintrag.",
            l,
        );
        return null;
    }
    if (welt.titelMitFlaeche.has(titelNorm(l.ziel))) {
        const gleich = welt.flaechenZu(l.ziel);
        const optionen: Option[] =
            gleich.length === 1 && l.zeile === wartet.zeile
                ? [
                      {
                          label: `Die Fläche „${gleich[0]!.name}“ nehmen`,
                          meta: "",
                          ersatz: {
                              zeile: l.zeile,
                              von: l.von,
                              bis: wartet.bis,
                              text: `[[#${kennungAnfang(gleich[0]!.id)}|${gleich[0]!.name}]]`,
                          },
                      },
                  ]
                : [];
        a.melde(
            "fehler",
            "Diesen Artikel trägt inzwischen eine Fläche der Karte; bitte die Fläche wählen.",
            l,
            optionen,
        );
        return null;
    }
    return { offen: true, titel: l.ziel, name: l.ziel, gespeichert };
}

/** Eine Fläche aus einem Link. `inTok`: das Wort „in“ davor, wenn es da ist. Gibt { flaeche, stillgelegt? } oder null (das Problem ist gemeldet). */
export function loeseFlaeche(
    a: Aufloeser,
    l: LinkZeichen,
    inTok: WortZeichen | null,
): { flaeche: FlaecheInnen; stillgelegt?: { name: string } } | null {
    const { ctx } = a;
    const { welt } = ctx;
    if (l.ziel === "") {
        a.melde("fehler", "Der Link ist leer: Zwischen „[[“ und „]]“ fehlt der Name.", l);
        return null;
    }
    if (l.kennung !== null) {
        // Der Kennungsanfang löst auch eine stillgelegte oder im Katalog fehlende Fläche auf, wenn eine vorhandene Regel des Eintrags sie nennt (so lässt sich diese Regel wieder lesen);
        // eine NEUE Regel mit so einer Fläche ist ein Fehler (`abschliessen` in `lies`).
        const anfang = l.kennung;
        const ids = new Set(welt.flaechen.filter((f) => f.id.startsWith(anfang)).map((f) => f.id));
        for (const k of ctx.kennungen) if (k.startsWith(anfang)) ids.add(k);
        if (ids.size === 0) {
            a.melde("fehler", `Eine Fläche mit der Kennung #${l.kennung} gibt es nicht.`, l);
            return null;
        }
        if (ids.size > 1) {
            a.melde("fehler", `Der Kennungsanfang #${l.kennung} ist nicht eindeutig; mehr Zeichen schreiben.`, l);
            return null;
        }
        const id = [...ids][0]!;
        const f = welt.flaecheNachId.get(id);
        if (f?.aktiv === true && f.nurKennung !== true) return { flaeche: { offen: false, kennung: id, name: f.name } };
        const bekannt = f?.name ?? "";
        if (!ctx.kennungen.has(id)) {
            a.melde("fehler", `Fläche „${bekannt !== "" ? bekannt : `#${kennungAnfang(id)}`}“ ist stillgelegt.`, l);
            return null;
        }
        return {
            flaeche: { offen: false, kennung: id, name: bekannt !== "" ? bekannt : null },
            stillgelegt: { name: bekannt !== "" ? bekannt : `#${kennungAnfang(id)}` },
        };
    }
    const kand = welt.flaechenZu(l.ziel);
    if (kand.length === 1) return { flaeche: { offen: false, kennung: kand[0]!.id, name: kand[0]!.name } };
    if (kand.length > 1) {
        a.melde(
            "rueckfrage",
            `„${l.ziel}“ ist mehrdeutig; welche Fläche ist gemeint?`,
            l,
            kand.map((f) => ({
                label: flaechenLabel(f, kand, welt),
                meta: [
                    welt.ebeneName(f.ebene),
                    f.art !== "" ? welt.artName(f.art) : "",
                    f.wikiTitel !== "" ? `Wiki ${f.wikiTitel}` : "",
                    kennungAnfang(f.id),
                ]
                    .filter(Boolean)
                    .join(" · "),
                ersatz: ersatzFuer(l, `[[#${kennungAnfang(f.id)}|${f.name}]]`),
            })),
        );
        return null;
    }
    // nicht gefunden: nächstliegende Namen (ohne „in“ auch Landschaftsarten), „in“ weglassen, wenn es eine Art ist, und, wo der Eintrag auf den Artikel wartet, die Wahl „warten“
    const liste = [...welt.flaechenNamen, ...welt.flaechenTitel, ...(inTok === null ? welt.artenListe : [])];
    const optionen: Option[] = vorschlaege(norm(l.ziel), liste, (x) => x.name).map((v) => ({
        label: `${l.ziel} → ${v.name} ersetzen`,
        meta: "",
        ersatz: ersatzFuer(l, `[[${v.name}]]`),
    }));
    if (inTok !== null && welt.arten.has(kurz(l.ziel))) {
        optionen.push({
            label: "„in“ weglassen",
            meta: `${l.ziel} ist eine Landschaftsart`,
            ersatz: { zeile: inTok.zeile, von: inTok.von, bis: l.von, text: "" },
        });
    }
    const wartetSchon = ctx.wartend.has(titelNorm(l.ziel)) && !welt.titelMitFlaeche.has(titelNorm(l.ziel));
    if (wartetSchon) {
        optionen.push({
            label: "Als wartend schreiben",
            meta: `Schreibt: [[${l.ziel}]] (wartet)`,
            ersatz: { zeile: l.zeile, von: l.ende, bis: l.ende, text: " (wartet)" },
        });
    }
    a.melde(
        "fehler",
        `Eine Fläche „${l.ziel}“ gibt es nicht (Herrschaftsgebiete sind keine Flächen einer Regel).${
            wartetSchon ? " Der Eintrag wartet auf den Artikel: „[[Wiki-Titel]] (wartet)“." : ""
        }`,
        l,
        optionen,
    );
    return null;
}

/** Bei gleichnamigen Flächen die Bezeichnung, die sie trennt: Art, dann Ebene, dann Kennungsanfang. */
function flaechenLabel(f: WeltFlaeche, gruppe: readonly WeltFlaeche[], welt: Welt): string {
    const gleich = gruppe.filter((g) => g.name === f.name);
    if (gleich.length < 2) return f.name;
    if (f.art !== "" && gleich.filter((g) => g.art === f.art).length === 1) return `${f.name} (${welt.artName(f.art)})`;
    if (gleich.filter((g) => g.ebene === f.ebene).length === 1) return `${f.name} (${welt.ebeneName(f.ebene)})`;
    return `${f.name} [${kennungAnfang(f.id)}]`;
}
