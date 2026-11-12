import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
import {
    entscheideFeld,
    type FeldEntscheidung,
    type LokalerWert,
    type Plan,
    type PlanObjekt,
    type PlanZeile,
} from "../abgleich/plan.ts";
import { titelSchluessel } from "./auswerten.ts";
import {
    FELD_JE_FORM,
    WIKI_TEIL_BEREICHE,
    type Ergebnisse,
    type WikiTeilBereich,
    type WikiTeilForm,
} from "./konstanten.ts";

/**
 * Die Planzeilen aus den Kategorien (WI-0253 C-2): Ortsgröße, Bauwerkart und Kontinent als Felder des Abgleichs, mit Eigentümer und Wirkung nach DERSELBEN Herkunftstabelle wie die Felder aus
 * dem Dump (`herkunft.ts`, über `entscheideFeld`). REIN: keine Datenbank, keine Anfrage.
 *
 * - **Wer verglichen wird:** nur Objekte mit gespeicherter Wiki-Adresse, deren Zuordnung nicht getrennt oder unterdrückt ist, und deren Artikel die Vorschau (Teil 1) ohne Befund gefunden hat
 *   (`ausgenommen`: Umleitung, nicht im Dump, mehrdeutig, kaputte Infobox …). Eine Eigenkennung ohne Wiki-Adresse wird nie abgeglichen, auch hier nicht.
 * - **Was eine Zeile ist:** wie im Plan nur, wo etwas zu sagen ist. Kennt die Kategorie einen Wert, und er ist vom Istwert verschieden, entsteht eine Zeile; ein Titel, den die Abfragen NICHT
 *   nennen, bekommt keine („nicht in der Kategorie“ heißt nicht „keine Klasse“: Die Klasse eines Ortes kann aus dem Text stammen).
 * - **Landschaften teilen einen Artikel** (die Teile einer Landschaft): Eine Zeile fasst sie zusammen, wie im Plan; Orte und Gebiete je Objekt.
 */

/** Was der Wiki-Teil zu den Zahlen des Berichts dazutut (dieselben Wörter wie `WikisyncBereichZahlen`). */
export interface KategorienZahlen {
    felderGelesen: number;
    unveraendert: number;
    uebernommen: number;
    eigen: number;
    befunde: number;
}

export interface KategorienPlanEingabe {
    bereich: WikiTeilBereich;
    objekte: readonly PlanObjekt[];
    /** Die gelesenen Werte je Form nach dem Schlüssel des Titels (`titelSchluessel`). */
    ergebnisse: Readonly<Partial<Record<WikiTeilForm, ReadonlyMap<string, string>>>>;
    /** Die Objekte, deren Artikel die Vorschau nicht sauber gefunden hat (Befund zum Artikel). */
    ausgenommen: ReadonlySet<string>;
    /** Gehört der Bereich noch dem Legacy-Zug? Dann sind seine wiki-eigenen Felder „nur Vorschau“ (Eigentümer legacy). */
    bereichBeiLegacy: boolean;
}

/** Die Bereiche, in denen die Teile eines Objekts einen Artikel teilen: eine Zeile fasst sie zusammen (wie `GRUPPIERT` im Plan). */
const GRUPPIERT: ReadonlySet<WikiTeilBereich> = new Set<WikiTeilBereich>(["region"]);

const vergleiche = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function berechneKategorienZeilen(eingabe: KategorienPlanEingabe): {
    zeilen: PlanZeile[];
    zahlen: KategorienZahlen;
} {
    const { bereich } = eingabe;
    const felder = Object.entries(FELD_JE_FORM[bereich]) as [WikiTeilForm, string][];
    const zahlen: KategorienZahlen = { felderGelesen: 0, unveraendert: 0, uebernommen: 0, eigen: 0, befunde: 0 };
    const zeilen: PlanZeile[] = [];

    // 1. Wer wird verglichen?
    const vergleichbar: { objekt: PlanObjekt; titel: string }[] = [];
    for (const objekt of [...eingabe.objekte].sort((a, b) => vergleiche(a.id, b.id))) {
        if (objekt.bereich !== bereich || eingabe.ausgenommen.has(objekt.id)) continue;
        if (objekt.zustand === "getrennt" || objekt.zustand === "unterdrueckt") continue;
        const titel = titelAusWikiAdresse(objekt.adresse);
        if (titel !== null) vergleichbar.push({ objekt, titel });
    }

    // 2. Die Einheiten: ein Objekt, bei den Landschaften alle Objekte eines Artikels.
    const jeArtikel = new Map<string, PlanObjekt[]>();
    const einheiten = new Map<string, { titel: string; objekte: PlanObjekt[] }>();
    for (const { objekt, titel } of vergleichbar) {
        const schluessel = titelSchluessel(titel);
        const alle = jeArtikel.get(schluessel) ?? [];
        alle.push(objekt);
        jeArtikel.set(schluessel, alle);
        const einheitSchluessel = GRUPPIERT.has(bereich) ? `a:${schluessel}` : `o:${objekt.id}`;
        const einheit = einheiten.get(einheitSchluessel) ?? { titel, objekte: [] };
        einheit.objekte.push(objekt);
        einheiten.set(einheitSchluessel, einheit);
    }

    // 3. Die Felder.
    const artikelBereit = new Set<string>();
    const zeile = (
        objekt: PlanObjekt,
        ids: readonly string[],
        titel: string,
        feld: string,
        entscheidung: FeldEntscheidung,
    ): PlanZeile => ({
        bereich,
        objektArt: objekt.objektArt,
        objektId: objekt.id,
        objektName: objekt.name,
        objekte: ids.length,
        objektIds: [...ids],
        artikel: titel,
        namensraum: null,
        feld,
        ...entscheidung,
    });
    for (const einheit of einheiten.values()) {
        const schluessel = titelSchluessel(einheit.titel);
        const alle = jeArtikel.get(schluessel) ?? einheit.objekte;
        for (const [form, feld] of felder) {
            const wikiWert = eingabe.ergebnisse[form]?.get(schluessel);
            if (wikiWert === undefined) continue;
            // Führt das Objekt das Feld selbst (mit Wert und Vermerk), wird es je Objekt entschieden; sonst steht es nur im Schnappschuss und gilt einmal je Artikel.
            const fuehrer = einheit.objekte.filter((objekt) => objekt.lokal.has(feld));
            const nurSchnappschuss = einheit.objekte.filter((objekt) => !objekt.lokal.has(feld));
            const gruppen = new Map<string, { vertreter: PlanObjekt; ids: string[]; entscheidung: FeldEntscheidung }>();
            for (const objekt of fuehrer) {
                zahlen.felderGelesen += 1;
                const entscheidung = entscheideFeld(
                    objekt,
                    feld,
                    wikiWert,
                    objekt.lokal.get(feld) as LokalerWert,
                    eingabe.bereichBeiLegacy,
                );
                if (entscheidung === null) {
                    zahlen.unveraendert += 1;
                    continue;
                }
                // Gleiche Entscheidungen fasst eine Zeile zusammen.
                const gruppenSchluessel = JSON.stringify(entscheidung);
                const gruppe = gruppen.get(gruppenSchluessel);
                if (gruppe === undefined)
                    gruppen.set(gruppenSchluessel, { vertreter: objekt, ids: [objekt.id], entscheidung });
                else gruppe.ids.push(objekt.id);
            }
            for (const gruppe of gruppen.values()) {
                zeilen.push(zeile(gruppe.vertreter, gruppe.ids, einheit.titel, feld, gruppe.entscheidung));
            }
            if (nurSchnappschuss.length > 0 && !artikelBereit.has(`${schluessel}|${feld}`)) {
                artikelBereit.add(`${schluessel}|${feld}`);
                zahlen.felderGelesen += 1;
                const vertreter = alle.find((objekt) => objekt.schnappschuss !== null) ?? (alle[0] as PlanObjekt);
                const entscheidung = entscheideFeld(vertreter, feld, wikiWert, null, eingabe.bereichBeiLegacy);
                if (entscheidung === null) {
                    zahlen.unveraendert += 1;
                } else {
                    zeilen.push(
                        zeile(
                            vertreter,
                            alle.map((objekt) => objekt.id),
                            einheit.titel,
                            feld,
                            entscheidung,
                        ),
                    );
                }
            }
        }
    }

    // 4. Die Reihenfolge des Plans: Name, Kennung, Feld; und die Zahlen nach der Wirkung.
    const feldIndex = (feld: string | null): number => felder.findIndex(([, name]) => name === feld);
    zeilen.sort(
        (x, y) =>
            vergleiche(x.objektName ?? "", y.objektName ?? "") ||
            vergleiche(x.objektId ?? "", y.objektId ?? "") ||
            feldIndex(x.feld) - feldIndex(y.feld),
    );
    for (const eintrag of zeilen) {
        if (eintrag.wirkung === "uebernommen") zahlen.uebernommen += 1;
        else if (eintrag.wirkung === "eigen") zahlen.eigen += 1;
        else zahlen.befunde += 1;
    }
    return { zeilen, zahlen };
}

/** Die Befunde zum Artikel (Planzeilen ohne Feld), bei denen der Plan das Objekt aus dem Vergleich der Kategorien nimmt: Für diese Artikel gibt es nichts, was sich vergleichen ließe. */
const AUSNAHME_BEFUNDE: ReadonlySet<string> = new Set([
    "umleitung",
    "artikel_nicht_im_dump",
    "mehrdeutig",
    "namensraum_unbekannt",
    "infobox_kaputt",
    "zuordnung_gesperrt",
]);

/** Die Objekte eines Bereichs, deren Artikel die Vorschau nicht sauber gefunden hat (Befund zum Artikel). */
export function ausgenommeneObjekte(zeilen: readonly PlanZeile[], bereich: WikiTeilBereich): Set<string> {
    const ids = new Set<string>();
    for (const zeile of zeilen) {
        if (
            zeile.bereich !== bereich ||
            zeile.feld !== null ||
            zeile.befund === null ||
            !AUSNAHME_BEFUNDE.has(zeile.befund)
        ) {
            continue;
        }
        for (const id of zeile.objektIds.length > 0 ? zeile.objektIds : zeile.objektId === null ? [] : [zeile.objektId])
            ids.add(id);
    }
    return ids;
}

/**
 * Hängt die Planzeilen aus den Kategorien an den Plan der Vorschau (WI-0294; vorher der Wiki-Teil, `anhaengen.ts`): je Bereich mit Kategorien `berechneKategorienZeilen` über die Ergebnisse aus der Datei,
 * die Zeilen ans Ende des Plans, die Zahlen des Bereichs um die der neuen Zeilen weiter. Wer einen Befund zum Artikel hat, wird nicht verglichen (`ausgenommeneObjekte`). Verändert `plan`.
 */
export function haengeKategorienAn(
    plan: Plan,
    eingabe: {
        bereiche: readonly string[];
        objekte: readonly PlanObjekt[];
        ergebnisse: Readonly<Record<WikiTeilBereich, Ergebnisse>>;
        /** Die Bereiche, die der Legacy-Zug noch hat: Ihre wiki-eigenen Felder sind „nur Vorschau“. */
        legacyBereiche: ReadonlySet<string>;
    },
): void {
    for (const bereich of WIKI_TEIL_BEREICHE) {
        if (!eingabe.bereiche.includes(bereich)) continue;
        const ergebnis = berechneKategorienZeilen({
            bereich,
            objekte: eingabe.objekte,
            ergebnisse: eingabe.ergebnisse[bereich],
            ausgenommen: ausgenommeneObjekte(plan.zeilen, bereich),
            bereichBeiLegacy: eingabe.legacyBereiche.has(bereich),
        });
        plan.zeilen.push(...ergebnis.zeilen);
        const zahlen = plan.zahlen[bereich];
        if (zahlen !== undefined) {
            zahlen.felderGelesen += ergebnis.zahlen.felderGelesen;
            zahlen.unveraendert += ergebnis.zahlen.unveraendert;
            zahlen.uebernommen += ergebnis.zahlen.uebernommen;
            zahlen.eigen += ergebnis.zahlen.eigen;
            zahlen.befunde += ergebnis.zahlen.befunde;
        }
    }
}
