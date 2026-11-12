import { foldName, type InhalteVorkommenArt } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Der Suchindex der Vorkommen (WI-0257, S3a): Name, weitere Namen und Gruppe aller aktiven Einträge, einmal im Prozess und gefaltet (klein, ohne Akzente, ß als ss), damit die Tastendruck-Suche
 * nichts als einen Durchlauf über rund 5.100 Zeilen im Speicher kostet. Er wird neu gelesen, sobald sich Einträge, Regeln oder Ortszeilen ändern (`stempel`); Legacy durchsuchte die
 * Einträge je Tastendruck in PHP und die weiteren Namen gar nicht.
 *
 * 🔴 **Wiki-Auszeichnung** steht in den Rohtexten (`gruppe`: `[[Gras]]`; `synonyme`: `''kursiv''`, `[[Ziel|Anzeige]]`, `<small>…</small>`, einzelne `]]`) und gehört weder in den Vergleich noch in die
 * Anzeige. Die weiteren Namen sind durch Komma oder Semikolon getrennt, aber nie innerhalb einer Klammer („Kra'Drakh (Maraskan), Praiobobote (Uthuria)“ sind zwei).
 * 🪤 Die Gruppe der Waren ist eine Kategorie („profan“, 2.281 Einträge), keine Zusammenfassung: Wer „profan“ sucht, findet sie alle, und die Sektion zeigt fünf und nennt die Zahl.
 */

export interface IndexEintrag {
    /** `lore_entry.id` */
    readonly id: string;
    /** `lore_entry.public_id` */
    readonly publicId: string;
    readonly kind: InhalteVorkommenArt;
    readonly name: string;
    readonly gefaltet: string;
    /** Die Gruppe ohne Auszeichnung; `undefined`, wo es keine gibt. */
    readonly gruppe: string | undefined;
    readonly gruppeGefaltet: string;
    /** Die weiteren Namen ohne Auszeichnung, mit ihrer gefalteten Form. */
    readonly aliase: readonly { readonly text: string; readonly gefaltet: string }[];
    /** Es gibt Regeln oder aufgelöste Ortszeilen: Ohne sie leuchtet nichts. */
    readonly kartenbezug: boolean;
}

export interface VorkommenIndex {
    readonly stempel: string;
    readonly eintraege: readonly IndexEintrag[];
}

/** Nimmt die Wiki-Auszeichnung aus einem Text: `[[Ziel|Anzeige]]` zu „Anzeige“, `[[Ziel]]` zu „Ziel“, Hochkommata, HTML und einzelne Klammern weg. */
export function bereinigeWiki(text: string): string {
    return text
        .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/gu, "$2")
        .replace(/\[\[([^\]]*)\]\]/gu, "$1")
        .replace(/'{2,}/gu, "")
        .replace(/<[^>]*>/gu, "")
        .replace(/[[\]]/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
}

/** Teilt die weiteren Namen: an Komma und Semikolon außerhalb von Klammern; leere Teile fallen weg. */
export function zerlegeSynonyme(roh: string): string[] {
    const sauber = bereinigeWiki(roh);
    const teile: string[] = [];
    let tiefe = 0;
    let aktuell = "";
    for (const zeichen of sauber) {
        if (zeichen === "(") tiefe += 1;
        else if (zeichen === ")") tiefe = Math.max(0, tiefe - 1);
        if ((zeichen === "," || zeichen === ";") && tiefe === 0) {
            teile.push(aktuell);
            aktuell = "";
        } else {
            aktuell += zeichen;
        }
    }
    teile.push(aktuell);
    return teile.map((teil) => teil.trim()).filter((teil) => teil !== "");
}

interface Zeile {
    id: string;
    public_id: string;
    kind: string;
    name: string;
    gruppe: string | null;
    synonyme: string | null;
    kartenbezug: boolean;
}

const ARTEN: readonly string[] = ["fauna", "flora", "ware", "spezies"];

/** Ein billiger Stempel für alles, wovon der Index abhängt (eine Abfrage, rund 2 ms). */
async function ladeStempel(database: Queryable): Promise<string> {
    const [zeile] = await database<{ stempel: string }[]>`
        SELECT concat_ws('|',
            (SELECT concat_ws(':', count(*), max(e.updated_at)) FROM lore_entry e),
            (SELECT concat_ws(':', count(*), max(r.id), max(r.updated_at)) FROM lore_rule r),
            (SELECT concat_ws(':', count(*), max(p.id), max(p.updated_at)) FROM lore_place p),
            (SELECT concat_ws(':', count(*), max(t.id)) FROM lore_place_target t)
        ) AS stempel
    `;
    return zeile?.stempel ?? "";
}

async function baueIndex(database: Queryable, stempel: string): Promise<VorkommenIndex> {
    const zeilen = await database<Zeile[]>`
        SELECT e.id::text AS id, e.public_id::text AS public_id, e.kind, e.name, e.gruppe, e.synonyme,
               (EXISTS (SELECT 1 FROM lore_rule r WHERE r.lore_entry_id = e.id AND r.is_active AND r.state = 'active')
                OR EXISTS (SELECT 1 FROM lore_place p JOIN lore_place_target t ON t.lore_place_id = p.id
                            WHERE p.lore_entry_id = e.id AND p.is_active AND p.state = 'active' AND (p.role IS NULL OR p.role = 'ort'))) AS kartenbezug
          FROM lore_entry e
         WHERE e.is_active AND e.state = 'active'
         ORDER BY e.id
    `;
    const eintraege: IndexEintrag[] = [];
    for (const zeile of zeilen) {
        if (!ARTEN.includes(zeile.kind)) continue;
        const gruppe = zeile.gruppe === null ? "" : bereinigeWiki(zeile.gruppe);
        eintraege.push({
            id: zeile.id,
            publicId: zeile.public_id,
            kind: zeile.kind as InhalteVorkommenArt,
            name: zeile.name.trim(),
            gefaltet: foldName(zeile.name),
            gruppe: gruppe === "" ? undefined : gruppe,
            gruppeGefaltet: foldName(gruppe),
            aliase: (zeile.synonyme === null ? [] : zerlegeSynonyme(zeile.synonyme)).map((text) => ({
                text,
                gefaltet: foldName(text),
            })),
            kartenbezug: zeile.kartenbezug,
        });
    }
    return { stempel, eintraege };
}

let aktuell: VorkommenIndex | undefined;
let ladend: { stempel: string; versprechen: Promise<VorkommenIndex> } | undefined;
let geprueftAm = 0;
/** So lange gilt ein geprüfter Stempel: ein Tastendruck nach dem anderen fragt die Datenbank nicht jedes Mal. */
const PRUEFABSTAND_MS = 1_500;

/** Verwirft den Index im Prozess (Tests, Eingriffe an der Datenbank). */
export function leereVorkommenIndex(): void {
    aktuell = undefined;
    ladend = undefined;
    geprueftAm = 0;
}

/** Der Index der aktiven Einträge, neu gelesen, wenn sich etwas geändert hat; mehrere gleichzeitige Fragen lesen einmal. */
export async function vorkommenIndex(database: Queryable): Promise<VorkommenIndex> {
    const jetzt = Date.now();
    if (aktuell !== undefined && jetzt - geprueftAm < PRUEFABSTAND_MS) return aktuell;
    const stempel = await ladeStempel(database);
    geprueftAm = Date.now();
    if (aktuell?.stempel === stempel) return aktuell;
    if (ladend?.stempel === stempel) return ladend.versprechen;
    const versprechen = baueIndex(database, stempel).then((index) => {
        aktuell = index;
        return index;
    });
    ladend = { stempel, versprechen };
    void versprechen.then(
        () => {
            if (ladend?.versprechen === versprechen) ladend = undefined;
        },
        () => {
            if (ladend?.versprechen === versprechen) ladend = undefined;
        },
    );
    return versprechen;
}

// ---------------------------------------------------------------------------------------------------------------------
// Suchen
// ---------------------------------------------------------------------------------------------------------------------

export type Fund = "name" | "synonym" | "gruppe";

export interface IndexTreffer {
    readonly eintrag: IndexEintrag;
    readonly gefundenIn: Fund;
    /** Der weitere Name, über den der Eintrag gefunden wurde. */
    readonly synonym?: string;
    /** Die Güte: kleiner ist besser (0 genauer Name … 6 Gruppe). */
    readonly klasse: number;
}

const WORTGRENZE = /[\s\-/(]/u;

/** Wie gut passt `gefaltet` zur Anfrage `q`: 0 genau, 1 Anfang, 2 Wortanfang, 3 enthalten, sonst `undefined`. Auch die Sprachen in der Suche ordnen so (`sprachen-index.ts`). */
export function namensGuete(gefaltet: string, q: string): number | undefined {
    if (gefaltet === q) return 0;
    if (gefaltet.startsWith(q)) return 1;
    let stelle = gefaltet.indexOf(q);
    if (stelle < 0) return undefined;
    // Ein Wortanfang steht vor einem Treffer mitten im Wort.
    while (stelle >= 0) {
        if (WORTGRENZE.test(gefaltet.charAt(stelle - 1))) return 2;
        stelle = gefaltet.indexOf(q, stelle + 1);
    }
    return 3;
}

/**
 * Die Einträge, die zur Anfrage passen: Name (genau vor Anfang vor Wortanfang vor enthalten), dann weitere Namen, dann Gruppe; ohne Rücksicht auf Groß- und Kleinschreibung und Akzente.
 * Bei gleicher Güte steht ein Eintrag mit Kartenbezug vor einem ohne, dann der kürzere Name. `ausgeblendet` lässt Arten weg, deren Inhaltsschalter aus ist.
 */
export function sucheEintraege(
    index: VorkommenIndex,
    text: string,
    ausgeblendet?: (art: InhalteVorkommenArt) => boolean,
): IndexTreffer[] {
    const q = foldName(text);
    if (q === "") return [];
    const treffer: IndexTreffer[] = [];
    for (const eintrag of index.eintraege) {
        if (ausgeblendet?.(eintrag.kind) === true) continue;
        const name = namensGuete(eintrag.gefaltet, q);
        if (name !== undefined) {
            treffer.push({ eintrag, gefundenIn: "name", klasse: name });
            continue;
        }
        let alias: { text: string; klasse: number } | undefined;
        for (const kandidat of eintrag.aliase) {
            const klasse = kandidat.gefaltet === q ? 4 : kandidat.gefaltet.includes(q) ? 5 : undefined;
            if (klasse !== undefined && (alias === undefined || klasse < alias.klasse))
                alias = { text: kandidat.text, klasse };
        }
        if (alias !== undefined) {
            treffer.push({ eintrag, gefundenIn: "synonym", synonym: alias.text, klasse: alias.klasse });
            continue;
        }
        if (eintrag.gruppeGefaltet.includes(q)) treffer.push({ eintrag, gefundenIn: "gruppe", klasse: 6 });
    }
    return treffer.sort(vergleiche);
}

function vergleiche(a: IndexTreffer, b: IndexTreffer): number {
    return (
        a.klasse - b.klasse ||
        Number(b.eintrag.kartenbezug) - Number(a.eintrag.kartenbezug) ||
        a.eintrag.name.length - b.eintrag.name.length ||
        a.eintrag.name.localeCompare(b.eintrag.name, "de") ||
        a.eintrag.kind.localeCompare(b.eintrag.kind) ||
        a.eintrag.id.localeCompare(b.eintrag.id, "en", { numeric: true })
    );
}

/**
 * Die Einträge, die GENAU so heißen (Name oder weiterer Name, gefaltet gleich), die besten zuerst: erst die mit Kartenbezug, dann nach Art. Das ist der Begriff einer kurzen
 * Anfrage – nichts wird geraten, ein Anfang genügt nicht.
 */
export function findeBegriff(
    index: VorkommenIndex,
    text: string,
    ausgeblendet?: (art: InhalteVorkommenArt) => boolean,
): IndexEintrag[] {
    const q = foldName(text);
    if (q === "") return [];
    const ARTEN_REIHE: readonly string[] = ["flora", "fauna", "ware", "spezies"];
    return index.eintraege
        .filter(
            (eintrag) =>
                ausgeblendet?.(eintrag.kind) !== true &&
                (eintrag.gefaltet === q || eintrag.aliase.some((alias) => alias.gefaltet === q)),
        )
        .sort(
            (a, b) =>
                Number(b.kartenbezug) - Number(a.kartenbezug) ||
                ARTEN_REIHE.indexOf(a.kind) - ARTEN_REIHE.indexOf(b.kind) ||
                a.id.localeCompare(b.id, "en", { numeric: true }),
        );
}
