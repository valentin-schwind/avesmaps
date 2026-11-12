import type { InhalteVorkommenArt } from "@avesmaps3d/shared";
import { liesGlied, type GliedKontext } from "./glied.ts";
import { kurz, naechste, norm } from "./hilfen.ts";
import { liesKopf } from "./kopf.ts";
import { gliedere, lexe, quelltext } from "./lexer.ts";
import { liesQuelle } from "./quelle.ts";
import { bedingungVertrag, eintragsSchluessel, schluesselAusVertrag } from "./schluessel.ts";
import type {
    BedingungInnen,
    BlockInnen,
    EintragInnen,
    Gelesen,
    Problem,
    QuelleInnen,
    RegelInnen,
    Verknuepfung,
} from "./typen.ts";
import type { Welt } from "./welt.ts";

/**
 * Der Leser von „Regeln als Text“ (WI-0254 §13 und §14; Port von `lies` im Entwurf `teile/i-text.js`, bewiesen an allen 448 Regeln der Entwicklungsdatenbank hin und zurück). Die Wiki-Kurzschrift:
 *
 *     # Kommentar                              überlesen; Leerzeilen auch
 *     Quelle: [[<Titel>]][, S. <Seiten>]       gilt für alle folgenden Einträge bis zur nächsten Quelle-Zeile; „Quelle: –“ beendet sie
 *     <Name> (<Kategorie>)                     Kopf eines Eintrags, am Zeilenanfang; `(<Kategorie>, [[<Wiki-Titel>]])` bei gleichnamigen, `(<Kategorie>, neu)` legt an
 *     | <Beziehung> = <Ausdruck>               Regeln einer Beziehung (Verbreitung, Herkunft, Regionen, Vorkommen); darf mehrfach stehen
 *         <Fortsetzung>                        eine eingerückte Zeile ohne „|“ setzt den Ausdruck der Zeile davor fort
 *
 *   Im Ausdruck heißt `;` neue Regel, `,` oder, `:` und, ` außer ` ohne, STRENG von links nach rechts ohne Vorrang; jedes Glied ist genau eine Bedingung des Regeleditors (`liesGlied`). Namen stehen immer in `[[…]]`.
 *
 * - 🔴 **Nichts wird geraten.** Mehrdeutiges ist eine Rückfrage, deren Antworten (`Option.ersatz`: Zeile, von, bis, neuer Text) den Text umschreiben; Unbekanntes ist ein Fehler, oft mit Vorschlägen. Der Text bleibt
 *   die einzige Quelle: Der Leser hat keinen Zustand außer dem Text und der Welt.
 * - **Der Fingerabdruck** einer Regel ist der des Schreibers (`schluessel.ts`); „gibt es schon“ ist derselbe Fingerabdruck wie eine aktive Regel desselben Eintrags (`bestehend`) oder eine Zeile weiter oben im Text
 *   (`stapel`). Eine Regel, deren Eintrag noch offen ist, wartet (Rückfrage ohne eigenen Befund). Eine neue Regel mit einer stillgelegten Fläche ist ein Fehler; lesbar bleibt sie nur als „gibt es schon“.
 * - Höchstens 25 Bedingungen je Regel und 50 Regeln je Eintrag im Text.
 */

const MAX_BEDINGUNGEN = 25;
const MAX_REGELN = 50;
interface Stapel {
    regeln: number;
    abdruecke: Map<string, number>;
}

/** Eine geöffnete Zeile „| Beziehung = …“, deren Fortsetzungen noch kommen können. */
interface BlockOffen {
    verworfen: false;
    zeile: number;
    zeileBis: number;
    eintrag: EintragInnen;
    bar: number;
    gleich: number;
    fortsetzung: { zeile: number; von: number }[];
}

const KEIN_KONTEXT: GliedKontext["wartend"] = new Map<string, string>();
const KEINE_KENNUNGEN: ReadonlySet<string> = new Set<string>();

export function lies(text: string, welt: Welt): Gelesen {
    const zeilen = String(text).split(/\r?\n/u);
    const eintraege: EintragInnen[] = [];
    const quellen: QuelleInnen[] = [];
    const lose: Problem[] = [];
    const fehler: Problem[] = [];
    const stapel = new Map<string, Stapel>();
    let quelle: QuelleInnen | null = null;
    let eintrag: EintragInnen | null = null;
    let block: BlockOffen | { verworfen: true } | null = null;
    const loseMelden = (zeile: number, textMeld: string, von = 0, bis = 0): void => {
        const p: Problem = { art: "fehler", zeile, text: textMeld, von, bis, optionen: [] };
        lose.push(p);
        fehler.push(p);
    };

    const schluessel = (e: EintragInnen): string => e.id ?? `neu:${norm(e.name)}|${e.kind ?? ""}`;
    const kontextVon = (e: EintragInnen, zeile: number): GliedKontext => ({
        welt,
        kennungen: e.id === null ? KEINE_KENNUNGEN : welt.kennungenDerRegeln(e.id),
        wartend: e.id === null ? KEIN_KONTEXT : welt.wartendeTitel(e.id),
        vorhanden: e.id !== null,
        zeilen,
        zeile,
    });
    /** Der Fingerabdruck der Regel: für einen vorhandenen Eintrag wie der Schreiber ihn rechnet, für einen erst anzulegenden mit einem festen Stellvertreter (es zählt nur die Gleichheit im Text). */
    const abdruck = (r: RegelInnen, e: EintragInnen): string => {
        const vorhanden = e.id === null ? undefined : welt.eintragNachId.get(e.id);
        const key = vorhanden === undefined ? `neu:${schluessel(e)}` : eintragsSchluessel(vorhanden);
        return schluesselAusVertrag(
            key,
            r.relation!,
            r.bedingungen.map((b) => bedingungVertrag(b, welt)),
        );
    };
    const abschliessen = (r: RegelInnen, e: EintragInnen): void => {
        const probleme = r.probleme;
        if (probleme.some((p) => p.art === "fehler")) r.status = "fehler";
        else if (probleme.some((p) => p.art === "rueckfrage")) r.status = "rueckfrage";
        else if (r.relation === null) r.status = "fehler";
        else if (e.status !== "ok") {
            r.status = "rueckfrage";
            r.wartet = true;
        } else {
            r.fingerabdruck = abdruck(r, e);
            const st = stapel.get(schluessel(e))!;
            const vorhanden = e.id === null ? undefined : welt.eintragNachId.get(e.id);
            const bestehend = vorhanden !== undefined && welt.bestehendeSchluessel(vorhanden).has(r.fingerabdruck);
            const stille = r.bedingungen.filter((b) => b.stillgelegt !== null);
            const frueher = st.abdruecke.get(r.fingerabdruck);
            if (bestehend) {
                r.status = "schon";
                r.schon = { grund: "bestehend" };
            } else if (stille.length > 0) {
                // Eine neue Regel braucht aktive Flächen; die Fläche aus einer vorhandenen Regel zu lesen genügt nur für „gibt es schon“.
                r.status = "fehler";
                for (const b of stille) {
                    const pr: Problem = {
                        art: "fehler",
                        zeile: b.zeile,
                        text: `Fläche „${b.stillgelegt!.name}“ ist stillgelegt.`,
                        von: 0,
                        bis: 0,
                        optionen: [],
                    };
                    r.probleme.push(pr);
                    fehler.push(pr);
                }
            } else if (frueher !== undefined) {
                r.status = "schon";
                r.schon = { grund: "stapel", zeile: frueher };
            } else {
                r.status = "neu";
                st.abdruecke.set(r.fingerabdruck, r.zeile);
            }
        }
    };

    /** Eine Zeile „| Beziehung = Ausdruck“ samt ihren Fortsetzungszeilen zu Regeln machen. */
    const schliesseBlock = (): void => {
        const bl = block;
        block = null;
        if (bl === null || bl.verworfen) return;
        const e = bl.eintrag;
        const roh = zeilen[bl.zeile] ?? "";
        const st = stapel.get(schluessel(e)) ?? { regeln: 0, abdruecke: new Map<string, number>() };
        stapel.set(schluessel(e), st);
        const blockProbleme: Problem[] = [];
        let relation: RegelInnen["relation"] = null;
        let ausdruckVon = roh.length;
        if (bl.gleich === -1) {
            blockProbleme.push({
                art: "fehler",
                zeile: bl.zeile,
                text: "Hinter der Beziehung fehlt „=“: „| Beziehung = Ausdruck“.",
                von: bl.bar,
                bis: roh.length,
                optionen: [],
            });
        } else {
            const rohWort = roh.slice(bl.bar + 1, bl.gleich);
            const wort = rohWort.trim();
            relation = welt.beziehungen.get(kurz(wort)) ?? null;
            ausdruckVon = bl.gleich + 1;
            if (relation === null) {
                const von = bl.bar + 1 + (rohWort.length - rohWort.trimStart().length);
                const bis = von + wort.length;
                const vorgeschlagen = naechste(norm(wort), welt.beziehungenListe, 4);
                blockProbleme.push({
                    art: "fehler",
                    zeile: bl.zeile,
                    text: `„${wort}“ ist keine Beziehung; es gibt Verbreitung, Herkunft, Regionen und Vorkommen.`,
                    von,
                    bis,
                    optionen: (vorgeschlagen.length > 0 ? vorgeschlagen : welt.beziehungenListe).map((v) => ({
                        label: `${wort} → ${v.name} ersetzen`,
                        meta: "",
                        ersatz: { zeile: bl.zeile, von, bis, text: v.name },
                    })),
                });
            }
        }
        let zeichen = lexe(bl.zeile, roh, ausdruckVon);
        for (const f of bl.fortsetzung) zeichen = zeichen.concat(lexe(f.zeile, zeilen[f.zeile] ?? "", f.von));
        const regeln = gliedere(zeichen);
        const ctx = kontextVon(e, bl.zeile);
        const info: BlockInnen = {
            zeile: bl.zeile,
            zeileBis: bl.zeileBis,
            praefix: `${roh.slice(0, bl.gleich === -1 ? roh.length : bl.gleich + 1).trimEnd()} `,
            regeln: [],
        };
        regeln.forEach((rg, idx) => {
            const alle = rg.glieder.flatMap((g) => (g.op === null ? g.tokens : [g.op, ...g.tokens]));
            const a = alle[0];
            const z = alle[alle.length - 1];
            const r: RegelInnen = {
                zeile: a?.zeile ?? bl.zeile,
                zeileBis: z?.zeile ?? bl.zeile,
                relation,
                status: "fehler",
                schon: null,
                wartet: false,
                fingerabdruck: null,
                bedingungen: [],
                probleme: [],
                text: a !== undefined && z !== undefined ? quelltext(zeilen, a, z) : "",
            };
            const meldeRegel = (p: Problem): void => {
                r.probleme.push(p);
                fehler.push(p);
            };
            const regelFehler = (textMeld: string, stelle: { zeile: number; von: number; bis: number }): void =>
                meldeRegel({
                    art: "fehler",
                    zeile: stelle.zeile,
                    text: textMeld,
                    von: stelle.von,
                    bis: stelle.bis,
                    optionen: [],
                });
            if (idx === 0) for (const p of blockProbleme) meldeRegel(p);
            else if (relation === null) {
                regelFehler("Die Beziehung dieser Zeile ist nicht lesbar (siehe die erste Regel der Zeile).", {
                    zeile: bl.zeile,
                    von: bl.bar,
                    bis: roh.length,
                });
            }
            st.regeln += 1;
            if (st.regeln > MAX_REGELN) {
                regelFehler(`Mehr als ${String(MAX_REGELN)} Regeln für diesen Eintrag im Stapel.`, {
                    zeile: r.zeile,
                    von: 0,
                    bis: roh.length,
                });
            }
            const leerGlied = (g: { tokens: readonly unknown[] }): boolean => g.tokens.length === 0;
            const leereBedingung = (v: Verknuepfung, zeile: number): BedingungInnen => ({
                v,
                arten: [],
                flaeche: null,
                klima: null,
                lage: null,
                ok: false,
                text: "",
                zeile,
                stillgelegt: null,
            });
            if (rg.glieder.length === 1 && leerGlied(rg.glieder[0]!)) {
                // eine leere Regel: nichts zwischen den Zeichen
                const stelle = rg.davor ??
                    regeln[idx + 1]?.davor ?? { zeile: bl.zeile, von: ausdruckVon, bis: roh.length };
                regelFehler(
                    regeln.length === 1
                        ? "Die Regel ist leer: Hinter „=“ fehlt der Ausdruck."
                        : "Hinter oder vor „;“ fehlt eine Regel.",
                    stelle,
                );
                r.bedingungen.push(leereBedingung("und", stelle.zeile));
            } else {
                let grenzeGemeldet = false;
                rg.glieder.forEach((g, gi) => {
                    if (r.bedingungen.length >= MAX_BEDINGUNGEN) {
                        if (!grenzeGemeldet) {
                            grenzeGemeldet = true;
                            regelFehler(
                                `Mehr als ${String(MAX_BEDINGUNGEN)} Bedingungen in einer Regel.`,
                                (g.op ?? g.tokens[0])!,
                            );
                        }
                        return;
                    }
                    if (leerGlied(g)) {
                        const stelle = (gi === 0 ? rg.glieder[1]?.op : g.op) ?? {
                            zeichen: ";",
                            zeile: bl.zeile,
                            von: ausdruckVon,
                            bis: roh.length,
                        };
                        regelFehler(
                            gi === 0
                                ? `Eine Regel beginnt nicht mit „${stelle.zeichen}“: Davor fehlt ein Glied.`
                                : `Hinter „${stelle.zeichen}“ fehlt ein Glied.`,
                            stelle,
                        );
                        r.bedingungen.push(leereBedingung(g.v, stelle.zeile));
                        return;
                    }
                    const res = liesGlied(g, ctx);
                    r.bedingungen.push(res.b);
                    for (const p of res.probleme) meldeRegel(p);
                });
            }
            abschliessen(r, e);
            e.regeln.push(r);
            info.regeln.push(r);
        });
        e.bloecke.push(info);
    };

    for (let i = 0; i < zeilen.length; i++) {
        const roh = zeilen[i]!;
        const kahl = roh.trim();
        if (kahl === "" || kahl.startsWith("#")) continue;
        const einzug = roh.length - roh.trimStart().length;
        // ── Quelle
        if (einzug === 0 && /^quelle\s*:/iu.test(roh)) {
            schliesseBlock();
            eintrag = null;
            const q = liesQuelle(roh, i, welt);
            quellen.push(q);
            for (const p of q.probleme) fehler.push(p);
            quelle = q.beendet ? null : q;
            continue;
        }
        // ── „| Beziehung = Ausdruck“
        if (kahl.startsWith("|")) {
            schliesseBlock();
            if (eintrag === null) {
                loseMelden(
                    i,
                    "Eine Regel braucht davor einen Eintrag (Name und Kategorie am Zeilenanfang).",
                    0,
                    roh.length,
                );
                block = { verworfen: true };
                continue;
            }
            const bar = roh.indexOf("|");
            block = {
                verworfen: false,
                zeile: i,
                zeileBis: i,
                eintrag,
                bar,
                gleich: roh.indexOf("=", bar + 1),
                fortsetzung: [],
            };
            continue;
        }
        // ── eingerückt: setzt den Ausdruck der Zeile davor fort
        if (einzug > 0) {
            if (block === null) {
                loseMelden(
                    i,
                    "Diese Zeile setzt keinen Ausdruck fort: Davor steht keine Zeile „| Beziehung = …“.",
                    0,
                    roh.length,
                );
                continue;
            }
            if (!block.verworfen) {
                block.fortsetzung.push({ zeile: i, von: einzug });
                block.zeileBis = i;
            }
            continue;
        }
        // ── am Zeilenanfang: Kopf eines Eintrags
        schliesseBlock();
        const kopf = liesKopf(roh, i, welt);
        const neuerEintrag: EintragInnen = { ...kopf, quelle, regeln: [], bloecke: [] };
        eintraege.push(neuerEintrag);
        for (const p of kopf.probleme) fehler.push(p);
        eintrag = neuerEintrag;
        if (!stapel.has(schluessel(neuerEintrag))) {
            stapel.set(schluessel(neuerEintrag), { regeln: 0, abdruecke: new Map<string, number>() });
        }
    }
    schliesseBlock();
    const alleRegeln = eintraege.flatMap((e) => e.regeln);
    const zahlen = {
        eintraege: eintraege.length,
        neu: alleRegeln.filter((r) => r.status === "neu").length,
        schon: alleRegeln.filter((r) => r.status === "schon").length,
        rueckfragen: fehler.filter((p) => p.art === "rueckfrage").length,
        fehler: fehler.filter((p) => p.art === "fehler").length,
    };
    return { eintraege, quellen, lose, zahlen, fehler };
}

/** Die Kategorie eines Kopfs, wie sie im Text steht, als Art des Vertrags (auch wo der Eintrag noch offen ist). */
export function kategorieVon(e: EintragInnen, welt: Welt): InhalteVorkommenArt | undefined {
    if (e.kind !== null) return e.kind;
    return e.kategorie === null ? undefined : welt.kategorien.get(kurz(e.kategorie));
}
