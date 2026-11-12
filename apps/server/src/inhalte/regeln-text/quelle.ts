import { INHALTE_SEITEN_MAX } from "@avesmaps3d/shared";
import { kennungAnfang, norm, vorschlaege } from "./hilfen.ts";
import type { Option, Problem, QuelleInnen } from "./typen.ts";
import type { Welt } from "./welt.ts";

/**
 * Die `Quelle:`-Zeile (WI-0254 §13; Port von `txQuelle` im Entwurf): `Quelle: [[<Titel>]][, S. <Seiten>]`. Sie gilt für alle folgenden Einträge bis zur nächsten `Quelle:`-Zeile; `Quelle: –` beendet sie.
 * Der Titel wird im Katalog der Quellen gesucht (aktive `feature_source` mit Titel); mehrere gleich lautende → Rückfrage mit `[[#Kennung|Titel]]`, keine → Fehler mit den nächstliegenden Titeln. Eine Quelle wird hier nie angelegt.
 */

const HEX = /^#([0-9a-f]{4,8})$/iu;

export function liesQuelle(roh: string, zeile: number, welt: Welt): QuelleInnen {
    const probleme: Problem[] = [];
    const q: QuelleInnen = {
        zeile,
        text: roh.trim(),
        titel: "",
        seiten: "",
        id: null,
        typ: "",
        status: "ok",
        probleme,
        beendet: false,
    };
    const meld = (art: Problem["art"], text: string, von: number, bis: number, optionen: Option[] = []): void => {
        probleme.push({ art, zeile, text, von, bis, optionen });
        q.status = art === "fehler" || q.status === "fehler" ? "fehler" : "rueckfrage";
    };
    const doppel = roh.indexOf(":");
    const restRoh = roh.slice(doppel + 1);
    const vorn = restRoh.length - restRoh.trimStart().length;
    const rest = restRoh.trim();
    const basis = doppel + 1 + vorn;
    if (rest === "") {
        meld("fehler", "Hinter „Quelle:“ fehlt der Titel; „Quelle: –“ beendet die Quelle.", doppel + 1, roh.length);
        return q;
    }
    if (/^[–—-]+$/u.test(rest)) {
        q.beendet = true;
        return q;
    }
    let titel: string;
    let kennung: string | null = null;
    let von: number;
    let bis: number;
    if (rest.startsWith("[[")) {
        const e = roh.indexOf("]]", basis + 2);
        if (e === -1) {
            meld("fehler", "Der Link „[[…“ wird nicht mit „]]“ geschlossen.", basis, roh.length);
            return q;
        }
        const inhalt = roh.slice(basis + 2, e);
        const bar = inhalt.indexOf("|");
        titel = (bar === -1 ? inhalt : inhalt.slice(0, bar)).trim();
        const anzeige = bar === -1 ? null : inhalt.slice(bar + 1).trim();
        von = basis;
        bis = e + 2;
        let ende = e + 2;
        while (ende < roh.length && /\p{L}/u.test(roh[ende]!)) ende++;
        const nachLink = roh.slice(ende);
        const hm = HEX.exec(titel);
        if (hm) {
            kennung = hm[1]!.toLowerCase();
            titel = anzeige ?? "";
        }
        const sm = /^\s*,\s*S\.\s*(.*)$/iu.exec(nachLink);
        if (sm) q.seiten = sm[1]!.trim();
        else if (nachLink.trim() !== "") {
            meld("fehler", "Hinter dem Titel steht nur „, S. Seiten“.", ende, roh.length);
            return q;
        }
        if (titel === "" && kennung === null) {
            meld("fehler", "Der Link ist leer: Zwischen „[[“ und „]]“ fehlt der Titel.", von, bis);
            return q;
        }
    } else {
        // ohne [[…]] wird der Titel auch gelesen
        const sm = /\s*,\s*S\.\s*/iu.exec(rest);
        let titelText = rest;
        if (sm) {
            titelText = rest.slice(0, sm.index);
            q.seiten = rest.slice(sm.index + sm[0].length).trim();
        }
        titel = titelText.trim();
        von = basis;
        bis = basis + titelText.trimEnd().length;
    }
    if (q.seiten.length > INHALTE_SEITEN_MAX) {
        meld("fehler", `Die Seitenangabe ist zu lang (höchstens ${String(INHALTE_SEITEN_MAX)} Zeichen).`, von, bis);
        return q;
    }
    const kand =
        kennung !== null
            ? welt.quellen.filter((x) => x.id.startsWith(kennung))
            : (welt.quellenNachTitel.get(norm(titel)) ?? []);
    if (kand.length === 1) {
        const eine = kand[0]!;
        q.titel = eine.titel;
        q.id = eine.id;
        q.typ = eine.typ;
        return q;
    }
    if (kand.length > 1) {
        q.titel = titel;
        meld(
            "rueckfrage",
            kennung !== null
                ? `Der Kennungsanfang #${kennung} ist nicht eindeutig; mehr Zeichen schreiben.`
                : `„${titel}“ gibt es im Katalog mehrfach; welche Quelle ist gemeint?`,
            von,
            bis,
            kand.map((x) => ({
                label: `${x.titel} [${kennungAnfang(x.id)}]`,
                meta: x.typ !== "" ? x.typ : "ohne Typ",
                ersatz: { zeile, von, bis, text: `[[#${kennungAnfang(x.id)}|${x.titel}]]` },
            })),
        );
        return q;
    }
    q.titel = titel;
    if (kennung !== null) {
        meld("fehler", `Eine Quelle mit der Kennung #${kennung} gibt es im Katalog nicht.`, von, bis);
        return q;
    }
    const v = vorschlaege(norm(titel), welt.quellenNamen, (x) => x.titel);
    meld(
        "fehler",
        `Eine Quelle „${titel}“ gibt es im Katalog nicht.`,
        von,
        bis,
        v.map((x) => ({
            label: `${titel} → ${x.titel} ersetzen`,
            meta: "",
            ersatz: { zeile, von, bis, text: `[[${x.titel}]]` },
        })),
    );
    return q;
}
