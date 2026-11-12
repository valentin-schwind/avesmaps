import { INHALTE_TITEL_MAX, type InhalteVorkommenArt } from "@avesmaps3d/shared";
import { kurz, naechste, norm } from "./hilfen.ts";
import type { EintragInnen, Option, Problem } from "./typen.ts";
import type { Welt, WeltEintrag } from "./welt.ts";

/**
 * Der Kopf eines Eintrags (WI-0254 §13; Port von `txEintragKopf` im Entwurf): `Name (Kategorie)`, `Name (Kategorie, [[Wiki-Titel]])` bei gleichnamigen Einträgen derselben Kategorie, `Name (Kategorie, neu)`, um
 * einen Eintrag anzulegen (nur nach ausdrücklicher Wahl: Eine Rückfrage bietet es an, nie ein stilles Anlegen), und `Name` ohne Klammer, wenn der Name über alle Kategorien eindeutig ist.
 */

/** Ein Kopf ohne Regeln, Blöcke und Quelle (die setzt `lies`). */
export type Kopf = Omit<EintragInnen, "quelle" | "regeln" | "bloecke">;

export function liesKopf(roh: string, zeile: number, welt: Welt): Kopf {
    const t = roh.trim();
    const probleme: Problem[] = [];
    const kopf: Kopf = {
        zeile,
        text: t,
        name: t,
        kategorie: null,
        kind: null,
        wikiTitel: "",
        neuAnlegen: false,
        id: null,
        titel: "",
        status: "ok",
        probleme,
    };
    const ersatz = (text: string): Option["ersatz"] => ({ zeile, von: 0, bis: roh.length, text });
    const melde = (art: Problem["art"], text: string, optionen: Option[] = []): void => {
        probleme.push({ art, zeile, text, von: 0, bis: roh.length, optionen });
        kopf.status = art === "fehler" || kopf.status === "fehler" ? "fehler" : "rueckfrage";
    };
    let name = t;
    let kat: string | null = null;
    let rest = "";
    if (t.endsWith(")")) {
        for (let p = t.indexOf("("); p !== -1; p = t.indexOf("(", p + 1)) {
            const vor = t.slice(0, p).trim();
            if (vor === "") continue;
            const innen = t.slice(p + 1, t.length - 1);
            const k = innen.indexOf(",");
            const wort = (k === -1 ? innen : innen.slice(0, k)).trim();
            if (welt.kategorien.has(kurz(wort))) {
                name = vor;
                kat = wort;
                rest = k === -1 ? "" : innen.slice(k + 1).trim();
                break;
            }
        }
    }
    // Der Wiki-Titel steht in [[…]] (ohne die Klammern wird er auch gelesen)
    const lm = /^\[\[(.*?)(?:\|.*?)?\]\]$/su.exec(rest);
    if (lm) rest = lm[1]!.trim();
    kopf.name = name;
    const katName = (kind: string): string => welt.kategorieName(kind);
    const alleKategorien = (nameText: string, hinten: string): Option[] =>
        welt.kategorienListe.map((k) => ({
            label: `${nameText} (${k.name}${hinten})`,
            meta: k.name,
            ersatz: ersatz(`${nameText} (${k.name}${hinten})`),
        }));
    // „Name (neu)“ ohne Kategorie
    if (kat === null && /\(\s*neu\s*\)$/iu.test(t)) {
        const n = t.replace(/\s*\(\s*neu\s*\)$/iu, "");
        kopf.name = n;
        melde("fehler", "Zum Anlegen fehlt die Kategorie: „Name (Flora, neu)“.", alleKategorien(n, ", neu"));
        return kopf;
    }
    // Klammer mit unbekanntem Wort hinter einem bekannten Namen: die Kategorie ist falsch geschrieben
    if (kat === null && t.endsWith(")") && !welt.eintraegeNachName.has(norm(t))) {
        const p = t.lastIndexOf("(");
        const vor = t.slice(0, p).trim();
        if (vor !== "" && welt.eintraegeNachName.has(norm(vor))) {
            const innen = t.slice(p + 1, t.length - 1);
            const k = innen.indexOf(",");
            const wort = (k === -1 ? innen : innen.slice(0, k)).trim();
            const hinten = k === -1 ? "" : `, ${innen.slice(k + 1).trim()}`;
            const vorgeschlagen = naechste(norm(wort), welt.kategorienListe, 4);
            kopf.name = vor;
            melde(
                "fehler",
                `„${wort}“ ist keine Kategorie; es gibt Flora, Fauna, Waren und Spezies.`,
                (vorgeschlagen.length > 0 ? vorgeschlagen : welt.kategorienListe).map((v) => ({
                    label: `${wort} → ${v.name} ersetzen`,
                    meta: "",
                    ersatz: ersatz(`${vor} (${v.name}${hinten})`),
                })),
            );
            return kopf;
        }
    }
    const nach: readonly WeltEintrag[] = welt.eintraegeNachName.get(norm(name)) ?? [];
    const kind: InhalteVorkommenArt | null = kat === null ? null : (welt.kategorien.get(kurz(kat)) ?? null);
    kopf.kategorie = kat;
    const neu = norm(rest) === "neu";
    const schreibe = (e: WeltEintrag): string => {
        const gleich = nach.filter((x) => x.kind === e.kind).length;
        return gleich > 1 && e.titel !== ""
            ? `${e.name} (${katName(e.kind)}, [[${e.titel}]])`
            : `${e.name} (${katName(e.kind)})`;
    };
    const eintragOption = (e: WeltEintrag): Option => ({
        label: schreibe(e),
        meta: [katName(e.kind), e.titel !== "" ? `Wiki-Titel ${e.titel}` : ""].filter(Boolean).join(" · "),
        ersatz: ersatz(schreibe(e)),
    });
    const neuOptionen = (): Option[] =>
        kind !== null
            ? [
                  {
                      label: `${name} (${katName(kind)}, neu)`,
                      meta: "Neu anlegen",
                      ersatz: ersatz(`${name} (${katName(kind)}, neu)`),
                  },
              ]
            : welt.kategorienListe.map((k) => ({
                  label: `${name} (${k.name}, neu)`,
                  meta: `Neu anlegen als ${k.name}`,
                  ersatz: ersatz(`${name} (${k.name}, neu)`),
              }));
    let kand: readonly WeltEintrag[] = kind === null ? nach : nach.filter((e) => e.kind === kind);
    const vorWiki = kand;
    if (!neu && rest !== "") kand = kand.filter((e) => norm(e.titel) === norm(rest));
    if (neu) {
        kopf.wikiTitel = "";
        if (vorWiki.length > 0 && kind !== null) {
            melde(
                "rueckfrage",
                `„${name}“ gibt es als ${katName(kind)} schon; ein Eintrag wird nicht doppelt angelegt. Welcher ist gemeint?`,
                vorWiki.map(eintragOption),
            );
        } else if (kind === null) {
            // „Name (neu)“ ohne gültige Kategorie wurde oben abgefangen; hier fehlt sie, weil die Klammer sie nicht nennt
            melde("fehler", "Zum Anlegen fehlt die Kategorie: „Name (Flora, neu)“.", alleKategorien(name, ", neu"));
        } else if (name.length > INHALTE_TITEL_MAX) {
            melde(
                "fehler",
                `Der Name ist zu lang für einen neuen Eintrag (höchstens ${String(INHALTE_TITEL_MAX)} Zeichen).`,
            );
        } else {
            kopf.neuAnlegen = true;
            kopf.kind = kind;
        }
    } else if (kand.length === 1) {
        const e = kand[0]!;
        Object.assign(kopf, { id: e.id, kind: e.kind, name: e.name, titel: e.titel, wikiTitel: e.titel });
    } else if (kand.length > 1) {
        const mehrKategorien = new Set(kand.map((e) => e.kind)).size > 1;
        melde(
            "rueckfrage",
            mehrKategorien
                ? `„${name}“ gibt es in mehreren Kategorien; welche ist gemeint?`
                : `Mehrere Einträge heißen „${name}“; welcher ist gemeint?`,
            kand.map(eintragOption),
        );
    } else if (rest !== "" && vorWiki.length > 0) {
        melde(
            "rueckfrage",
            `Der Wiki-Titel „${rest}“ passt zu keinem Eintrag „${name}“; welcher ist gemeint?`,
            vorWiki.map(eintragOption),
        );
    } else if (nach.length > 0 && kind !== null) {
        melde(
            "rueckfrage",
            `„${name}“ gibt es nicht als ${katName(kind)}, aber in einer anderen Kategorie. Welcher Eintrag ist gemeint, oder neu anlegen?`,
            [...nach.map(eintragOption), ...neuOptionen()],
        );
    } else {
        const vorgeschlagen = naechste(norm(name), welt.eintragNamen, 3);
        const vorOption: Option[] = vorgeschlagen.map((v) => {
            const einzig = v.eintraege.length === 1 ? v.eintraege[0]! : null;
            const text = einzig
                ? `${einzig.name} (${katName(einzig.kind)})`
                : `${v.name}${kind !== null && v.eintraege.some((e) => e.kind === kind) ? ` (${katName(kind)})` : ""}`;
            return {
                label: text,
                meta: `Ähnlicher Eintrag${einzig ? ` · ${katName(einzig.kind)}` : ""}`,
                ersatz: ersatz(text),
            };
        });
        melde(
            "rueckfrage",
            `Einen Eintrag „${name}“${kind !== null ? ` in der Kategorie ${katName(kind)}` : ""} gibt es nicht. Neu anlegen oder einen ähnlichen wählen?`,
            [...neuOptionen(), ...vorOption],
        );
    }
    return kopf;
}
