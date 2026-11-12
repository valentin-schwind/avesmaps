import {
    ersatzFuer,
    loeseFlaeche,
    loeseOrt,
    loeseWartend,
    type Aufloeser,
    type GliedKontext,
    type Stelle,
} from "./aufloesen.ts";
import { kurz, norm, vorschlaege } from "./hilfen.ts";
import { quelltext, zeichenEnde } from "./lexer.ts";
import type {
    BedingungInnen,
    FlaecheInnen,
    GliedRoh,
    KlammerZeichen,
    LinkZeichen,
    Option,
    Problem,
    WortZeichen,
    Zeichen,
} from "./typen.ts";

/**
 * Ein Glied = EINE Bedingung des Regeleditors (WI-0254 §13; Port von `txGlied` im Entwurf). Die Teile stehen in beliebiger Reihenfolge, jeder höchstens einmal, mindestens einer:
 *
 *   Arten    `[[A]] oder [[B]]`            (ein Link, der so heißt wie eine Landschaftsart, ohne „in“)
 *   Fläche   `in [[F]]` · `[[F]]` (ohne Art-Namen) · `[[Titel]] (wartet)` · `[[#Kennung|Name]]`
 *   Klima    `Klima Zone [bis Zone]`
 *   Lage     `nördlich von [[Ort]]` · `südlich der Linie [[Ort]]–[[Ort]]`
 *
 * Nichts wird geraten: Ist ein Name mehrdeutig, entsteht eine Rückfrage, deren Antworten den Text umschreiben (`Option.ersatz`); ist er unbekannt, ein Fehler mit den nächstliegenden Namen.
 */

export { titelNorm, type GliedKontext } from "./aufloesen.ts";

const TEIL_NAMEN = { arten: "Landschaftsarten", flaeche: "Fläche", klima: "Klima", lage: "Lage" } as const;
type Teil = keyof typeof TEIL_NAMEN;

/** Ein Glied aus seinen Zeichen. Rückgabe `b` (`b.ok` ist wahr, wenn nichts offen ist) und die Probleme in der Folge des Texts. */
export function liesGlied(g: GliedRoh, ctx: GliedKontext): { b: BedingungInnen; probleme: Problem[] } {
    const { welt, zeilen } = ctx;
    const toks = g.tokens;
    const probleme: Problem[] = [];
    const erst: Zeichen | null = toks[0] ?? g.op;
    const b: BedingungInnen = {
        v: g.v,
        arten: [],
        flaeche: null,
        klima: null,
        lage: null,
        ok: true,
        text: toks.length > 0 ? quelltext(zeilen, toks[0]!, toks[toks.length - 1]!) : "",
        zeile: erst?.zeile ?? ctx.zeile,
        stillgelegt: null,
    };
    const melde = (art: Problem["art"], text: string, stelle: Stelle, optionen: Option[] = []): void => {
        probleme.push({ art, zeile: stelle.zeile, text, von: stelle.von, bis: stelle.bis, optionen });
    };
    const ers = ersatzFuer;
    const aufloeser: Aufloeser = { ctx, melde };
    const wortIst = (t: Zeichen | undefined, re: RegExp): t is WortZeichen => t?.art === "wort" && re.test(t.text);
    const richtungsWort = (w: string): boolean => welt.richtungen.has(kurz(w)) || /lich$/iu.test(w);
    const teilStart = (t: Zeichen): boolean =>
        t.art === "wort" && (/^(in|klima)$/iu.test(t.text) || richtungsWort(t.text));
    const istArt = (l: LinkZeichen): boolean => l.kennung === null && welt.arten.has(kurz(l.ziel));
    const gesehen = new Set<Teil>();
    const belegt = (sorte: Teil, stelle: Stelle): boolean => {
        if (gesehen.has(sorte)) {
            melde(
                "fehler",
                `Der Teil „${TEIL_NAMEN[sorte]}“ steht in diesem Glied zweimal; jeder Teil darf nur einmal vorkommen.`,
                stelle,
            );
            return false;
        }
        gesehen.add(sorte);
        return true;
    };
    /** Der Text zwischen dem Ende des vorigen Zeichens und dem Anfang dieses (für „Zusatz entfernen“ samt dem Leerraum davor). */
    const entferne = (k: Stelle, vorher: Zeichen | undefined): Option["ersatz"] => {
        const von = vorher !== undefined && vorher.zeile === k.zeile ? zeichenEnde(vorher) : k.von;
        return { zeile: k.zeile, von, bis: k.bis, text: "" };
    };
    /** Ein Klammerzusatz: nur „(wartet)“ ist bekannt (hinter einer Fläche), jeder andere ist ein Fehler mit der Wahl „Zusatz entfernen“. */
    const zusatzFehler = (k: KlammerZeichen, vorher: Zeichen | undefined): void =>
        melde(
            "fehler",
            `„(${k.text})“ gibt es in Regeln nicht; bekannt ist nur „(wartet)“, und das steht hinter einer Fläche.`,
            k,
            [{ label: "Zusatz entfernen", meta: `(${k.text})`, ersatz: entferne(k, vorher) }],
        );
    const zusatzNach = (start: number, vorher: Zeichen | undefined): number => {
        let j = start;
        let v = vorher;
        for (;;) {
            const t = toks[j];
            if (t?.art !== "klammer") break;
            zusatzFehler(t, v);
            v = t;
            j++;
        }
        return j;
    };

    const leseArten = (i: number): number => {
        const links: { l: LinkZeichen; od: WortZeichen | null; vor: Zeichen | null }[] = [
            { l: toks[i] as LinkZeichen, od: null, vor: null },
        ];
        let j = zusatzNach(i + 1, toks[i]);
        while (wortIst(toks[j], /^oder$/iu)) {
            const od = toks[j] as WortZeichen;
            const nl = toks[j + 1];
            if (nl?.art === "link") {
                links.push({ l: nl, od, vor: toks[j - 1] ?? null });
                j = zusatzNach(j + 2, nl);
            } else {
                melde("fehler", "Hinter „oder“ fehlt eine Landschaftsart in [[…]].", od);
                j++;
                break;
            }
        }
        const gewaehlt: { ebene: string; art: string }[] = [];
        const dabei = new Set<string>();
        for (const { l, od, vor } of links) {
            const k = l.kennung === null ? welt.arten.get(kurz(l.ziel)) : undefined;
            if (k === undefined) {
                const optionen: Option[] = vorschlaege(norm(l.ziel), welt.artenListe, (x) => x.name).map((v) => ({
                    label: `${l.ziel} → ${v.name} ersetzen`,
                    meta: "",
                    ersatz: ers(l, `[[${v.name}]]`),
                }));
                if (od !== null && l.kennung === null && welt.flaechenZu(l.ziel).length > 0) {
                    optionen.push({
                        label: "„oder“ → „,“ ersetzen",
                        meta: "Zwischen Gliedern steht ein Komma",
                        ersatz: {
                            zeile: od.zeile,
                            von: vor !== null && vor.zeile === od.zeile ? zeichenEnde(vor) : od.von,
                            bis: od.bis,
                            text: ",",
                        },
                    });
                }
                melde("fehler", `„${l.ziel}“ ist keine Landschaftsart.`, l, optionen);
                continue;
            }
            const key = `${k.ebene}|${k.art}`;
            if (dabei.has(key)) {
                melde("fehler", `„${l.ziel}“ steht in der Liste zweimal.`, l);
                continue;
            }
            dabei.add(key);
            gewaehlt.push({ ebene: k.ebene, art: k.art });
        }
        if (belegt("arten", toks[i]!)) b.arten = gewaehlt;
        return j;
    };

    const leseFlaeche = (i: number, inTok: WortZeichen | null): number => {
        let j: number;
        let l: Zeichen | undefined;
        if (inTok !== null) {
            l = toks[i + 1];
            if (l?.art !== "link") {
                melde("fehler", "Hinter „in“ fehlt der Name der Fläche in [[…]].", inTok);
                return i + 1;
            }
            j = i + 2;
        } else {
            l = toks[i];
            j = i + 1;
        }
        // `l` ist hier ein Link (der Aufrufer hat es geprüft)
        const link = l as LinkZeichen;
        let wartet: KlammerZeichen | null = null;
        const klammer = toks[j];
        if (klammer?.art === "klammer" && /^wartet$/iu.test(klammer.text)) {
            wartet = klammer;
            j++;
        }
        j = zusatzNach(j, link);
        let res: { flaeche: FlaecheInnen; stillgelegt?: { name: string } } | null = null;
        if (wartet !== null) {
            if (link.kennung !== null)
                melde("fehler", "Eine Fläche mit Kennung wartet nicht: „(wartet)“ gehört hinter den Wiki-Titel.", link);
            else if (link.ziel === "")
                melde("fehler", "Der Link ist leer: Zwischen „[[“ und „]]“ fehlt der Wiki-Titel.", link);
            else {
                const flaeche = loeseWartend(aufloeser, link, wartet);
                if (flaeche !== null) res = { flaeche };
            }
        } else res = loeseFlaeche(aufloeser, link, inTok);
        if (belegt("flaeche", inTok ?? link) && res !== null) {
            b.flaeche = res.flaeche;
            if (res.stillgelegt !== undefined) b.stillgelegt = res.stillgelegt;
        }
        return j;
    };

    const leseKlima = (i: number): number => {
        const kt = toks[i] as WortZeichen;
        let j = i + 1;
        const lauf: WortZeichen[] = [];
        for (;;) {
            const t = toks[j];
            if (t?.art !== "wort" || teilStart(t)) break;
            lauf.push(t);
            j++;
        }
        const enden: WortZeichen[][] = [[]];
        for (const w of lauf) {
            if (/^bis$/iu.test(w.text)) enden.push([]);
            else enden[enden.length - 1]!.push(w);
        }
        let klima: { von: string; bis: string } | null = null;
        if (lauf.length === 0) melde("fehler", "Hinter „Klima“ fehlt die Zone.", kt);
        else if (enden.length > 2) melde("fehler", "Eine Klimaspanne hat zwei Enden: „Klima A bis B“.", kt);
        else if (enden.some((e) => e.length === 0))
            melde("fehler", "Eine Klimaspanne braucht auf beiden Seiten von „bis“ eine Zone.", kt);
        else {
            const zonen: string[] = [];
            let offen = false;
            for (const ws of enden) {
                const erstes = ws[0]!;
                const letztes = ws[ws.length - 1]!;
                const stelle: Stelle = {
                    zeile: erstes.zeile,
                    von: erstes.von,
                    bis: letztes.zeile === erstes.zeile ? letztes.bis : erstes.bis,
                };
                const text = ws.map((w) => w.text).join(" ");
                const z = welt.zonen.get(kurz(text));
                if (z === undefined) {
                    const v = vorschlaege(norm(text), welt.zonenListe, (x) => x.name);
                    melde(
                        "fehler",
                        `„${text}“ ist keine Klimazone.`,
                        stelle,
                        v.map((x) => ({
                            label: `${text} → ${x.name} ersetzen`,
                            meta: "",
                            ersatz: ers(stelle, x.name),
                        })),
                    );
                    offen = true;
                } else zonen.push(z);
            }
            if (!offen) {
                const [von, bis] =
                    zonen.length === 1
                        ? [zonen[0]!, zonen[0]!]
                        : [...zonen].sort((x, y) => (welt.zonenIndex.get(x) ?? 99) - (welt.zonenIndex.get(y) ?? 99));
                klima = { von: von!, bis: bis! };
            }
        }
        if (belegt("klima", kt) && klima !== null) b.klima = klima;
        return j;
    };

    const leseLage = (i: number): number => {
        const rt = toks[i] as WortZeichen;
        const richtung = welt.richtungen.get(kurz(rt.text));
        let fehlerRichtung = false;
        if (richtung === undefined) {
            const v = vorschlaege(norm(rt.text), welt.richtungenListe, (x) => x.name, 3);
            melde(
                "fehler",
                `„${rt.text}“ ist keine Richtung; es gibt nördlich, südlich, östlich und westlich.`,
                rt,
                (v.length > 0 ? v : welt.richtungenListe).map((x) => ({
                    label: `${rt.text} → ${x.name} ersetzen`,
                    meta: "",
                    ersatz: ers(rt, x.name),
                })),
            );
            fehlerRichtung = true;
        }
        let j = i + 1;
        let linie = false;
        if (wortIst(toks[j], /^von$/iu)) j++;
        else if (wortIst(toks[j], /^der$/iu) && wortIst(toks[j + 1], /^linie$/iu)) {
            linie = true;
            j += 2;
        } else {
            melde("fehler", "Die Lage heißt „nördlich von [[Ort]]“ oder „südlich der Linie [[Ort]]–[[Ort]]“.", rt);
            return i + 1;
        }
        const orte: LinkZeichen[] = [];
        let aufbauOk = true;
        const erster = toks[j];
        if (erster?.art !== "link") {
            melde("fehler", "Hinter der Richtung fehlt der Ort in [[…]].", rt);
            return j;
        }
        orte.push(erster);
        j = zusatzNach(j + 1, erster);
        const strich = (t: Zeichen | undefined): boolean => wortIst(t, /^(bis|[–—-])$/iu);
        const zweiter = toks[j + 1];
        if (strich(toks[j]) && zweiter?.art === "link") {
            if (!linie) {
                melde(
                    "fehler",
                    "Eine Linie durch zwei Orte heißt „südlich der Linie [[A]]–[[B]]“; „von“ nimmt einen Ort.",
                    rt,
                );
                aufbauOk = false;
            }
            orte.push(zweiter);
            j = zusatzNach(j + 2, zweiter);
        } else if (linie) {
            melde(
                "fehler",
                "Eine Linie braucht zwei Orte: „der Linie [[A]]–[[B]]“ (zwischen den Links „–“, „-“ oder „bis“).",
                rt,
            );
            aufbauOk = false;
        }
        const gewaehlt: { id: string; name: string }[] = [];
        let offen = false;
        for (const l of orte) {
            const o = loeseOrt(aufloeser, l);
            if (o !== null) gewaehlt.push(o);
            else offen = true;
        }
        if (!offen && gewaehlt.length === 2 && gewaehlt[0]!.id === gewaehlt[1]!.id) {
            melde("fehler", "Die Linie braucht zwei verschiedene Orte.", rt);
            offen = true;
        }
        if (belegt("lage", rt) && !fehlerRichtung && aufbauOk && !offen && richtung !== undefined)
            b.lage = { richtung, orte: gewaehlt };
        return j;
    };

    // „ohne“ steht vor dem Glied und wird zuerst gemeldet (die Probleme folgen der Reihenfolge im Text)
    if (g.op?.zeichen === "ohne") {
        melde("fehler", "„ohne“ heißt in der Kurzschrift „außer“ (wie im Wiki).", g.op, [
            { label: "„ohne“ → „außer“ ersetzen", meta: "", ersatz: ers(g.op, "außer") },
        ]);
    }
    let i = 0;
    while (i < toks.length) {
        const t = toks[i]!;
        if (t.art === "wort") {
            if (/^in$/iu.test(t.text)) {
                i = leseFlaeche(i, t);
                continue;
            }
            if (/^klima$/iu.test(t.text)) {
                i = leseKlima(i);
                continue;
            }
            if (richtungsWort(t.text)) {
                i = leseLage(i);
                continue;
            }
            const vor = toks[i - 1];
            if (/^oder$/iu.test(t.text)) {
                melde("fehler", "„oder“ verbindet nur Landschaftsarten; zwischen Gliedern steht ein Komma.", t, [
                    {
                        label: "„oder“ → „,“ ersetzen",
                        meta: "Zwischen Gliedern steht ein Komma",
                        ersatz: {
                            zeile: t.zeile,
                            von: vor !== undefined && vor.zeile === t.zeile ? zeichenEnde(vor) : t.von,
                            bis: t.bis,
                            text: ",",
                        },
                    },
                ]);
            } else if (/^und$/iu.test(t.text)) {
                melde(
                    "fehler",
                    "„und“ verbindet keine Glieder; „:“ heißt und, „,“ heißt oder, „außer“ heißt ohne.",
                    t,
                    [
                        {
                            label: "„und“ → „:“ ersetzen",
                            meta: "Gilt streng von links nach rechts",
                            ersatz: {
                                zeile: t.zeile,
                                von: vor !== undefined && vor.zeile === t.zeile ? zeichenEnde(vor) : t.von,
                                bis: t.bis,
                                text: ":",
                            },
                        },
                    ],
                );
            } else {
                const v = vorschlaege(norm(t.text), [{ norm: "klima", name: "Klima" }], (x) => x.name, 1);
                melde(
                    "fehler",
                    `„${t.text}“ gehört nicht in ein Glied: Namen stehen in [[…]], feste Wörter sind in, oder, Klima, bis, von, der Linie und die Richtungen.`,
                    t,
                    v.map((x) => ({ label: `${t.text} → ${x.name} ersetzen`, meta: "", ersatz: ers(t, x.name) })),
                );
            }
            i++;
            continue;
        }
        if (t.art === "link") {
            const naechstes = toks[i + 2];
            const artKontext =
                istArt(t) ||
                (t.kennung === null &&
                    wortIst(toks[i + 1], /^oder$/iu) &&
                    naechstes?.art === "link" &&
                    welt.flaechenZu(t.ziel).length === 0);
            i = artKontext ? leseArten(i) : leseFlaeche(i, null);
            continue;
        }
        if (t.art === "klammer") {
            zusatzFehler(t, toks[i - 1]);
            i++;
            continue;
        }
        melde(
            "fehler",
            t.art === "kaputt" && t.was === "link"
                ? "Der Link „[[…“ wird nicht mit „]]“ geschlossen."
                : "Die Klammer „(…“ wird nicht mit „)“ geschlossen.",
            t,
        );
        i++;
    }
    b.ok = probleme.length === 0;
    return { b, probleme };
}
