import type { InhalteVorkommenArt, SearchBeispiel, SearchBeispiele } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { genannteZiele, landschaftsartVon, leuchte, type LeuchtOptionen } from "../vorkommen/leuchten.ts";
import { ermittleKartenstand } from "../vorkommen/regeln.ts";
import { sucheOrte } from "./vorkommen-suche.ts";
import { vorkommenIndex } from "./vorkommen-index.ts";
import { zielKatalog } from "./ziele-katalog.ts";

/**
 * Die Beispiele für den wechselnden Platzhalter der Spotlight-Suche (WI-0257 §2: „die leisen Hinweise“): echte Anfragen, die wirklich etwas finden – ein Ort, ein Vorkommen, „Vorkommen in
 * Gegend“ und „Landschaftsart südlich von Ort“. Nichts davon ist von Hand geschrieben: Die Kandidaten kommen aus den Daten und werden mit derselben Rechnung geprüft, die das Leuchten
 * benutzt (`leuchte`); ein Kandidat ohne Treffer fällt weg. Die Auswahl dreht sich mit dem Tag (`tag`), damit der Platzhalter nicht an jedem Tag dasselbe zeigt.
 *
 * Billig und zwischengespeichert: einmal je Kartenstand, Tag und Ausblendung der Arten gerechnet (rund ein Dutzend gezielter Rechnungen, danach liegt es im Prozess).
 */

/** So viele Einträge je Art werden höchstens geprüft, bis zwei etwas finden. */
const PRUEFUNG_VORKOMMEN = 8;

/** Wie viele Beispiele es höchstens gibt. */
export const BEISPIELE_MAX = 6;

/** Landschaftsarten, die sich für „südlich von …“ lohnen, und die vier Richtungen, im Wechsel. */
const ARTEN = ["wald", "gebirge", "see", "steppe", "huegelland", "suempfe_moore", "tiefebene"] as const;
const LAGEN = [
    { lage: "sued", text: "südlich von" },
    { lage: "nord", text: "nördlich von" },
    { lage: "ost", text: "östlich von" },
    { lage: "west", text: "westlich von" },
] as const;

interface Gemerkt {
    schluessel: string;
    antwort: SearchBeispiele;
}
let gemerkt: Gemerkt | undefined;
let laeuft: { schluessel: string; versprechen: Promise<SearchBeispiele> } | undefined;

/** Leert den Zwischenspeicher (Tests). */
export function leereBeispiele(): void {
    gemerkt = undefined;
    laeuft = undefined;
}

/** Der Tag als Zahl (Tage seit 1970, UTC): wechselt um Mitternacht. */
export const tagVon = (jetzt: Date): number => Math.floor(jetzt.getTime() / 86_400_000);

async function rechne(database: Queryable, tag: number, optionen: LeuchtOptionen): Promise<SearchBeispiele> {
    const beispiele: SearchBeispiel[] = [];
    const [index, katalog, orte] = await Promise.all([
        vorkommenIndex(database),
        zielKatalog(database),
        sucheOrte(database, "", 3),
    ]);
    const ort = orte[0];
    if (ort !== undefined) beispiele.push({ text: ort.name, art: "ort" });

    // Einträge mit Kartenbezug, Flora und Fauna im Wechsel und nach dem Tag gedreht; es werden Kandidaten geprüft, bis zwei etwas zum Leuchten bringen.
    const kandidaten = index.eintraege
        .filter((eintrag) => eintrag.kartenbezug && optionen.ausgeblendet?.(eintrag.kind) !== true)
        .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    const gedreht = (art: InhalteVorkommenArt): (typeof kandidaten)[number][] => {
        const liste = kandidaten.filter((eintrag) => eintrag.kind === art);
        if (liste.length === 0) return [];
        const start = (tag * 7 + (art === "flora" ? 0 : 31)) % liste.length;
        return [...liste.slice(start), ...liste.slice(0, start)].slice(0, PRUEFUNG_VORKOMMEN);
    };
    const flora = gedreht("flora");
    const fauna = gedreht("fauna");
    const abwechselnd: (typeof kandidaten)[number][] = [];
    for (let i = 0; i < PRUEFUNG_VORKOMMEN; i += 1) {
        const f = flora[i];
        const t = fauna[i];
        if (f !== undefined) abwechselnd.push(f);
        if (t !== undefined) abwechselnd.push(t);
    }

    let gefunden = 0;
    for (const eintrag of abwechselnd) {
        if (gefunden >= 2) break;
        const antwort = await leuchte(database, { eintrag: eintrag.publicId }, optionen);
        if (antwort === undefined || antwort.pausiert || antwort.gegenden + antwort.orte.length === 0) continue;
        gefunden += 1;
        beispiele.push({ text: eintrag.name, art: "vorkommen", gegenden: antwort.gegenden });
        // „… in Gegend“: eine Gegend, die der Eintrag selbst nennt, mit Treffern.
        const genannt = await genannteZiele(database, eintrag.publicId);
        const ziele = katalog.landschaften
            .filter((ziel) => ziel.ids.some((id) => genannt.regionen.has(id)))
            .sort((a, b) => b.flaeche - a.flaeche || a.name.localeCompare(b.name, "de"));
        for (const ziel of ziele.slice(0, 3)) {
            const darin = await leuchte(
                database,
                { eintrag: eintrag.publicId, landschaften: [...ziel.publicIds] },
                optionen,
            );
            if (darin === undefined || darin.pausiert || darin.gegenden + darin.orte.length === 0) continue;
            beispiele.push({ text: `${eintrag.name} in ${ziel.name}`, art: "vorkommen-in", gegenden: darin.gegenden });
            break;
        }
    }

    // „Landschaftsart südlich von Ort“: der größte Ort, im Wechsel Art und Richtung.
    if (ort !== undefined) {
        for (let k = 0; k < ARTEN.length && beispiele.length < BEISPIELE_MAX; k += 1) {
            const art = landschaftsartVon(ARTEN[(tag + k) % ARTEN.length] as string);
            const richtung = LAGEN[(tag + k) % LAGEN.length];
            if (art === undefined || richtung === undefined) continue;
            const antwort = await leuchte(
                database,
                { art: art.art, lage: richtung.lage, orte: [ort.public_id] },
                optionen,
            );
            if (antwort === undefined || antwort.gegenden === 0) continue;
            beispiele.push({
                text: `${art.name} ${richtung.text} ${ort.name}`,
                art: "landschaftsart-lage",
                gegenden: antwort.gegenden,
            });
            break;
        }
    }
    return { beispiele: beispiele.slice(0, BEISPIELE_MAX) };
}

/**
 * Die Beispiele für den Platzhalter. `ausgeblendet` sind die Arten, deren Inhaltsschalter aus ist (sie kommen nicht vor); `jetzt` der Zeitpunkt (Tests). Mehrere gleichzeitige Fragen
 * rechnen einmal.
 */
export async function beispiele(
    database: Queryable,
    optionen: LeuchtOptionen = {},
    jetzt: Date = new Date(),
): Promise<SearchBeispiele> {
    const tag = tagVon(jetzt);
    const aus = (["flora", "fauna", "ware", "spezies"] as const).filter((art) => optionen.ausgeblendet?.(art) === true);
    const stand = await ermittleKartenstand(database, "aventuria");
    const schluessel = `${stand}|${String(tag)}|${aus.join(",")}`;
    if (gemerkt?.schluessel === schluessel) return gemerkt.antwort;
    if (laeuft?.schluessel === schluessel) return laeuft.versprechen;
    const versprechen = rechne(database, tag, optionen).then((antwort) => {
        gemerkt = { schluessel, antwort };
        return antwort;
    });
    laeuft = { schluessel, versprechen };
    void versprechen.then(
        () => {
            if (laeuft?.versprechen === versprechen) laeuft = undefined;
        },
        () => {
            if (laeuft?.versprechen === versprechen) laeuft = undefined;
        },
    );
    return versprechen;
}
