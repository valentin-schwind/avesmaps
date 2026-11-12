import {
    foldName,
    SEARCH_MIN_LENGTH,
    SEARCH_PRAEPOSITIONEN,
    SEARCH_VORKOMMEN_SICHTBAR,
    type InhalteVorkommenArt,
    type SearchAnfrage,
    type SearchGebietSektion,
    type SearchLage,
    type SearchLeuchtAnfrage,
    type SearchLeuchten,
    type SearchLeuchtenBegriff,
    type SearchVorkommenSektion,
    type SearchZielGruppe,
    type SearchZielHit,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    genannteZiele,
    LANDSCHAFTSARTEN,
    leuchte,
    SCHALTER_ARTEN,
    type Landschaftsart,
} from "../vorkommen/leuchten.ts";
import { Zwischenspeicher } from "../vorkommen/speicher.ts";
import { REPARIERT } from "../vorkommen/regel-sql.ts";
import { gefaltet, likeGenau, likePattern, passtGefaltet } from "./like.ts";
import {
    findeBegriff,
    sucheEintraege,
    vorkommenIndex,
    type IndexEintrag,
    type VorkommenIndex,
} from "./vorkommen-index.ts";
import { schneiden, zielGuete, zielKatalog, type ZielKatalog } from "./ziele-katalog.ts";

/**
 * Die Vorkommen in der Spotlight-Suche (WI-0257, S3a): die Sektion „Vorkommen“, die Herrschaftsgebiete als Treffer und die kurzen Anfragen „Begriff Präposition Ziel“ mit ihrer
 * Autovervollständigung. Die Tastendruck-Suche selbst rechnet nichts auf der Karte: Name, weitere Namen und Gruppe stehen im Index im Prozess (`vorkommen-index.ts`), die Gebiete im Katalog
 * der Ziele; die Zahlen der leuchtenden Gegenden holt die Oberfläche hinterher (`/api/search/zahlen`).
 *
 * **Die Grammatik** (nichts wird geraten): Eine kurze Anfrage besteht aus einem BEGRIFF, einer PRÄPOSITION und einem ZIEL.
 *
 * - Der Begriff ist ein Eintrag, der genau so heißt (Name oder weiterer Name), oder eine Landschaftsart (deutscher Name oder Schlüssel: „Wald“). Hat die ganze Anfrage diese Form und endet sie,
 *   werden die Präpositionen vorgeschlagen. Eine Anfrage, deren Anfang kein Begriff ist, bleibt eine gewöhnliche Volltextsuche ohne `anfrage`.
 * - Die Präpositionen stehen in `SEARCH_PRAEPOSITIONEN`: `in`, `im`, `auf` (Ziel: eine benannte Landschaft oder ein Herrschaftsgebiet), `nördlich`/`südlich`/`östlich`/`westlich von` (Ziel: ein Ort) und
 *   `zwischen <Ort> und <Ort>`. Ein angefangenes Wort („nördl“) schlägt die passenden vor.
 * - Das Ziel ist, was nach der Präposition steht. Ohne Getipptes sind es die Ziele, an denen der Begriff gelistet ist: zuerst die im Wiki genannten, dann die größten Gegenden und Gebiete mit Treffern.
 *   Mit Getipptem alle Ziele, deren Name es enthält, die etwas zum Leuchten bringen.
 *
 * 🔴 **Die Zahl an einem Ziel ist die Rechnung der Leuchten-Route** (`leuchte`, dasselbe Ergebnis aus demselben Zwischenspeicher): Was die Liste verspricht, leuchtet beim Wählen. Ziele ohne
 * Treffer stehen nicht da. Gerechnet wird nur eine feste Zahl von Zielen je Gruppe (`PRUEFUNG`); `ungeprueft` nennt, wie viele darüber hinaus passten.
 */

/** Wie viele Ziele je Gruppe gerechnet werden, und wie viele gleichzeitig (der Pool hat zehn Verbindungen). */
const PRUEFUNG = { landschaft: 10, gebiet: 6, ort: 8, vorfilter: 40, parallel: 3 } as const;

/**
 * Eine Schranke für die Rechnung der Ziele: höchstens `grenze` laufen zugleich (jede nimmt bis zu `PRUEFUNG.parallel` Verbindungen des Pools), `warteplaetze` warten, jede weitere bekommt
 * `undefined` zurück – die Antwort der Suche trägt dann den Begriff und die Präposition, aber kein `ziele` („nicht gerechnet“), und die Tastendruck-Suche selbst bleibt heil.
 * 🪤 Kein Parameter-Property: Die Server laufen strip-only.
 */
class Schranke {
    private laufend = 0;
    private readonly wartend: (() => void)[] = [];
    private readonly grenze: number;
    private readonly warteplaetze: number;

    constructor(grenze: number, warteplaetze: number) {
        this.grenze = grenze;
        this.warteplaetze = warteplaetze;
    }

    async laufe<T>(arbeit: () => Promise<T>): Promise<T | undefined> {
        if (this.laufend >= this.grenze) {
            if (this.wartend.length >= this.warteplaetze) return undefined;
            // Der Platz wird weitergereicht: `laufend` bleibt, bis keiner mehr wartet.
            await new Promise<void>((weiter) => this.wartend.push(weiter));
        } else {
            this.laufend += 1;
        }
        try {
            return await arbeit();
        } finally {
            const naechster = this.wartend.shift();
            if (naechster === undefined) this.laufend -= 1;
            else naechster();
        }
    }
}

/** Zwei Rechnungen der Ziele zugleich, sechzehn warten. */
const zielSchranke = new Schranke(2, 16);

/** Die Ziele der Anfragen, je Kartenstand; bis zu 200 Antworten oder 16 MB. */
const zielSpeicher = new Zwischenspeicher<SearchZielGruppe[]>(200, 16 * 1024 * 1024);

/** Leert den Speicher der Ziele (Tests). */
export function leereZielSpeicher(): void {
    zielSpeicher.leere();
}

export interface VorkommenSucheOptionen {
    /** Ist die Art durch den Inhaltsschalter ausgeblendet? */
    ausgeblendet?: (art: InhalteVorkommenArt) => boolean;
    /** Die Dauer der Teile in Millisekunden (`index`, `katalog`, `anfrage`), für `Server-Timing` der Suche. */
    zeiten?: Map<string, number>;
}

/** Misst die Dauer eines Teils in `zeiten`, ohne das Ergebnis anzufassen. */
export async function gemessen<T>(zeiten: Map<string, number> | undefined, name: string, teil: Promise<T>): Promise<T> {
    if (zeiten === undefined) return teil;
    const beginn = performance.now();
    try {
        return await teil;
    } finally {
        zeiten.set(name, performance.now() - beginn);
    }
}

export interface VorkommenSucheErgebnis {
    vorkommen?: SearchVorkommenSektion;
    gebiete?: SearchGebietSektion;
    anfrage?: SearchAnfrage;
}

/** Läuft `f` über die Einträge, höchstens `grenze` zugleich; die Antworten stehen in der Reihenfolge der Eingabe. */
async function parallel<T, R>(eintraege: readonly T[], grenze: number, f: (eintrag: T) => Promise<R>): Promise<R[]> {
    const ergebnis = new Array<R>(eintraege.length);
    let naechster = 0;
    const arbeiter = Array.from({ length: Math.min(grenze, eintraege.length) }, async () => {
        while (naechster < eintraege.length) {
            const i = naechster;
            naechster += 1;
            ergebnis[i] = await f(eintraege[i] as T);
        }
    });
    await Promise.all(arbeiter);
    return ergebnis;
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Sektionen
// ---------------------------------------------------------------------------------------------------------------------

function vorkommenSektion(
    index: VorkommenIndex,
    text: string,
    ausgeblendet: VorkommenSucheOptionen["ausgeblendet"],
): SearchVorkommenSektion | undefined {
    const treffer = sucheEintraege(index, text, ausgeblendet);
    if (treffer.length === 0) return undefined;
    return {
        hits: treffer.slice(0, SEARCH_VORKOMMEN_SICHTBAR).map(({ eintrag, gefundenIn, synonym }) => ({
            id: eintrag.publicId,
            name: eintrag.name,
            kind: eintrag.kind,
            gefundenIn,
            ...(synonym === undefined ? {} : { synonym }),
            ...(eintrag.gruppe === undefined ? {} : { gruppe: eintrag.gruppe }),
            kartenbezug: eintrag.kartenbezug,
            leuchten: { eintrag: eintrag.publicId },
        })),
        total: treffer.length,
    };
}

function gebieteSektion(katalog: ZielKatalog, text: string): SearchGebietSektion | undefined {
    const q = foldName(text);
    const passende = katalog.gebiete
        .flatMap((gebiet) => {
            const guete = zielGuete(gebiet.gefaltet, q);
            return guete === undefined ? [] : [{ gebiet, guete }];
        })
        .sort(
            (a, b) =>
                a.guete - b.guete ||
                b.gebiet.flaeche - a.gebiet.flaeche ||
                a.gebiet.name.localeCompare(b.gebiet.name, "de") ||
                a.gebiet.publicId.localeCompare(b.gebiet.publicId),
        );
    if (passende.length === 0) return undefined;
    return {
        hits: passende.slice(0, SEARCH_VORKOMMEN_SICHTBAR).map(({ gebiet }) => ({
            id: gebiet.publicId,
            name: gebiet.name,
            ...(gebiet.typ === null ? {} : { typ: gebiet.typ }),
            x: gebiet.x,
            y: gebiet.y,
            bounds: [gebiet.rahmen.x0, gebiet.rahmen.y0, gebiet.rahmen.x1, gebiet.rahmen.y1] as [
                number,
                number,
                number,
                number,
            ],
        })),
        total: passende.length,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Grammatik
// ---------------------------------------------------------------------------------------------------------------------

interface Praeposition {
    text: string;
    gefaltet: string;
    woerter: string[];
    ziel: "gegend" | "ort" | "zwei-orte";
    lage?: SearchLage;
}

const PRAEPOSITIONEN: readonly Praeposition[] = SEARCH_PRAEPOSITIONEN.map((definition) => ({
    text: definition.text,
    gefaltet: foldName(definition.text),
    woerter: foldName(definition.text).split(" "),
    ziel: definition.ziel,
    ...(definition.lage === undefined ? {} : { lage: definition.lage }),
}));

/** Ein Begriff: ein Eintrag oder eine Landschaftsart. */
type Begriff = { typ: "eintrag"; eintrag: IndexEintrag } | { typ: "art"; art: Landschaftsart };

const begriffName = (begriff: Begriff): string => (begriff.typ === "eintrag" ? begriff.eintrag.name : begriff.art.name);

const begriffAlsAnzeige = (begriff: Begriff): SearchLeuchtenBegriff =>
    begriff.typ === "eintrag"
        ? { name: begriff.eintrag.name, kind: begriff.eintrag.kind, eintrag: begriff.eintrag.publicId }
        : { name: begriff.art.name, art: begriff.art.art };

const begriffBasis = (begriff: Begriff): SearchLeuchtAnfrage =>
    begriff.typ === "eintrag" ? { eintrag: begriff.eintrag.publicId } : { art: begriff.art.art };

/** Löst einen Text als Begriff auf: erst ein Eintrag mit genau diesem Namen, dann eine Landschaftsart. */
function loeseBegriff(
    index: VorkommenIndex,
    text: string,
    ausgeblendet: VorkommenSucheOptionen["ausgeblendet"],
): Begriff | undefined {
    const eintrag = findeBegriff(index, text, ausgeblendet)[0];
    if (eintrag !== undefined) return { typ: "eintrag", eintrag };
    const q = foldName(text);
    const art = LANDSCHAFTSARTEN.find((kandidat) => foldName(kandidat.name) === q || kandidat.art === q);
    return art === undefined ? undefined : { typ: "art", art };
}

interface Zerlegung {
    begriff: Begriff;
    /** Die ganze Präposition steht da. */
    voll?: { praeposition: Praeposition; rest: string };
    /** Ein Anfang einer Präposition steht da (oder nichts): die passenden. */
    vorschlaege?: readonly Praeposition[];
}

/**
 * Zerlegt die Anfrage in Begriff und Rest. Zuerst gilt die ganze Anfrage als Begriff (ein Eintrag „Tal in Flammen“ gewinnt gegen „Tal“ + „in“); dann wird an jeder Stelle geteilt,
 * an der eine Präposition (ganz oder angefangen) beginnt, und der erste Anfang, der ein Begriff ist, gewinnt.
 */
function zerlege(
    index: VorkommenIndex,
    text: string,
    ausgeblendet: VorkommenSucheOptionen["ausgeblendet"],
): Zerlegung | undefined {
    const ganz = loeseBegriff(index, text, ausgeblendet);
    if (ganz !== undefined) return { begriff: ganz, vorschlaege: PRAEPOSITIONEN };
    const woerter = text.split(/\s+/u).filter((wort) => wort !== "");
    const gefaltet = woerter.map(foldName);
    for (let i = 1; i < woerter.length; i += 1) {
        const nachher = gefaltet.slice(i);
        const voll = PRAEPOSITIONEN.find(
            (kandidat) =>
                nachher.length >= kandidat.woerter.length && kandidat.woerter.every((wort, k) => nachher[k] === wort),
        );
        const getippt = nachher.join(" ");
        const teil = PRAEPOSITIONEN.filter(
            (kandidat) => kandidat.gefaltet.startsWith(getippt) && kandidat.gefaltet !== getippt,
        );
        if (voll === undefined && teil.length === 0) continue;
        const begriff = loeseBegriff(index, woerter.slice(0, i).join(" "), ausgeblendet);
        if (begriff === undefined) continue;
        if (voll !== undefined) {
            return {
                begriff,
                voll: { praeposition: voll, rest: woerter.slice(i + voll.woerter.length).join(" ") },
            };
        }
        return { begriff, vorschlaege: teil };
    }
    return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Ziele
// ---------------------------------------------------------------------------------------------------------------------

interface OrtZeile {
    public_id: string;
    name: string;
    subtype: string;
    gesamt: number;
}

/**
 * Die Orte zu einem Getippten, wie die gewöhnliche Ortssuche sie ordnet (genauer Name zuerst, dann die Klassenordnung, kürzere Namen zuerst). Ohne Getipptes die größten Orte. `gesamt` ist die Zahl aller
 * Treffer (ein Fenster über die Abfrage), damit nichts still gekappt wird.
 */
export async function sucheOrte(
    database: Queryable,
    getippt: string,
    grenze: number,
    ohne?: string,
): Promise<OrtZeile[]> {
    const muster = getippt === "" ? "%" : likePattern(foldName(getippt));
    const zeilen = await database<(OrtZeile & { gesamt: string })[]>`
        SELECT p.public_id::text AS public_id, p.name, p.subtype, count(*) OVER ()::text AS gesamt
          FROM place p
          LEFT JOIN label_class_rank r ON r.scope = 'place' AND r.class_key = p.subtype
         WHERE p.is_active AND NOT COALESCE(p.is_hidden, FALSE) AND p.map_domain_id = 'aventuria'
           AND ${passtGefaltet(database, database`p.name`, muster)}
           AND (${ohne ?? null}::uuid IS NULL OR p.public_id <> ${ohne ?? null}::uuid)
         ORDER BY (lower(${gefaltet(database, database`btrim(p.name)`)}) = ${foldName(getippt)}) DESC, COALESCE(r.rank, 50), length(p.name), p.name, p.public_id
         LIMIT ${grenze}
    `;
    return zeilen.map((zeile) => ({ ...zeile, gesamt: Number(zeile.gesamt) }));
}

/** Der Ort, der genau so heißt (der bedeutendste, wenn mehrere); `undefined`, wo es keinen gibt. */
async function findeOrt(database: Queryable, name: string): Promise<{ public_id: string; name: string } | undefined> {
    const [zeile] = await database<{ public_id: string; name: string }[]>`
        SELECT p.public_id::text AS public_id, p.name
          FROM place p
          LEFT JOIN label_class_rank r ON r.scope = 'place' AND r.class_key = p.subtype
         WHERE p.is_active AND NOT COALESCE(p.is_hidden, FALSE) AND p.map_domain_id = 'aventuria' AND ${passtGefaltet(database, database`p.name`, likeGenau(foldName(name)))}
         ORDER BY COALESCE(r.rank, 50), p.public_id
         LIMIT 1
    `;
    return zeile;
}

const hitSortierung = (a: SearchZielHit, b: SearchZielHit): number =>
    Number(b.genau) - Number(a.genau) ||
    Number(b.genannt) - Number(a.genannt) ||
    (b.gegenden ?? 0) - (a.gegenden ?? 0) ||
    a.name.localeCompare(b.name, "de");

/** Welche Fläche gemeint ist: die Landschaften (`region.id`) oder das Gebiet (`territory.id`) eines Ziels. */
interface Gelistet {
    tafel: "region" | "territory";
    ids: readonly string[];
}

/**
 * Welche der Gegenden sind für den Eintrag GELISTET? Das ist die Antwort des Panels (Zusage: was leuchtet, listet das Panel, und umgekehrt) ohne dass jede Gegend die Regeln einzeln
 * rechnet: Der Punkt der Gegend (`ST_PointOnSurface` der Vereinigung ihrer Flächen, wie im Panel) liegt in dem, was für den Eintrag leuchtet – in den ganzen Gegenden, den Zuschnitten,
 * den Gebieten oder im Rest, wie die Leuchten-Route sie liefert. Eine Abfrage für alle; die Antwort steht in der Reihenfolge der Eingabe.
 */
async function sindGelistet(
    database: Queryable,
    lit: SearchLeuchten,
    tafel: Gelistet["tafel"],
    gruppen: readonly (readonly string[])[],
): Promise<boolean[]> {
    if (gruppen.length === 0) return [];
    const nummern: number[] = [];
    const ids: string[] = [];
    gruppen.forEach((gruppeIds, i) => {
        for (const id of gruppeIds) {
            nummern.push(i);
            ids.push(id);
        }
    });
    const punkte =
        tafel === "region"
            ? `SELECT p.gi, ST_PointOnSurface(ST_UnaryUnion(ST_Collect(${REPARIERT("a.geom")}))) AS pt
                 FROM paare p JOIN region_area a ON a.region_id = p.rid AND a.is_active GROUP BY p.gi`
            : `SELECT p.gi, ST_PointOnSurface(ST_UnaryUnion(ST_Collect(ST_MakeValid(s.geom)))) AS pt
                 FROM paare p JOIN territory_shape s ON s.territory_id = p.rid AND s.band = (SELECT max(b.band) FROM territory_shape b WHERE b.territory_id = p.rid) GROUP BY p.gi`;
    const formen = [
        ...lit.angeschnitten.map((teil) => JSON.stringify(teil.form)),
        ...lit.gebiete.angeschnitten.map((teil) => JSON.stringify(teil.form)),
        ...(lit.rest === undefined ? [] : [JSON.stringify(lit.rest.form)]),
    ];
    const zeilen = await database.unsafe<{ gi: number; gelistet: boolean | null }[]>(
        `WITH paare AS (SELECT u.gi, u.rid FROM unnest($1::int[], $2::bigint[]) AS u(gi, rid)),
              k AS (${punkte})
         SELECT k.gi, (
             EXISTS (SELECT 1 FROM region_area l JOIN region lr ON lr.id = l.region_id
                      WHERE lr.public_id = ANY($3::uuid[]) AND l.is_active AND l.geom && k.pt AND ST_Intersects(l.geom, k.pt))
          OR EXISTS (SELECT 1 FROM territory_shape ls JOIN territory lt ON lt.id = ls.territory_id
                      WHERE lt.public_id = ANY($4::uuid[]) AND ls.band = (SELECT max(b.band) FROM territory_shape b WHERE b.territory_id = ls.territory_id)
                        AND ls.geom && k.pt AND ST_Intersects(ls.geom, k.pt))
          OR EXISTS (SELECT 1 FROM unnest($5::text[]) AS f WHERE ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(f), 0), k.pt))
         ) AS gelistet
           FROM k`,
        [nummern, ids, [...lit.ganz], [...lit.gebiete.ganz], formen] as never[],
    );
    const ergebnis = gruppen.map(() => false);
    for (const zeile of zeilen) ergebnis[Number(zeile.gi)] = zeile.gelistet === true;
    return ergebnis;
}

/** Baut eine Gruppe: die Ziele mit Treffern, höchstens fünf sichtbar; `ungeprueft` zählt die passenden, die nicht gerechnet wurden. */
function gruppe(art: SearchZielGruppe["art"], hits: SearchZielHit[], ungeprueft: number): SearchZielGruppe {
    return { art, hits: hits.slice(0, SEARCH_VORKOMMEN_SICHTBAR), total: hits.length, ungeprueft };
}

interface ZielKontext {
    database: Queryable;
    katalog: ZielKatalog;
    begriff: Begriff;
    praeposition: Praeposition;
    ausgeblendet: VorkommenSucheOptionen["ausgeblendet"];
}

/**
 * Die Optionen für `leuchte`: der Kartenstand des Katalogs (er ist höchstens 1,5 s alt und spart je Ziel die Abfrage) und die Schalter. Wer einen Eintrag unter einem etwas älteren Stand
 * rechnet, speichert ihn unter diesem Stand; der nächste Aufruf mit dem neuen rechnet neu.
 */
const leuchtOptionen = (
    kontext: ZielKontext,
): { ausgeblendet?: (art: InhalteVorkommenArt) => boolean; stand: string } => ({
    stand: kontext.katalog.stand,
    ...(kontext.ausgeblendet === undefined ? {} : { ausgeblendet: kontext.ausgeblendet }),
});

/** Ziel „in …“: benannte Landschaften und Herrschaftsgebiete. */
async function gegendZiele(kontext: ZielKontext, rest: string): Promise<SearchZielGruppe[]> {
    const { database, katalog, begriff, praeposition } = kontext;
    const q = foldName(rest);
    const basis = begriffBasis(begriff);
    // Wo der Begriff überhaupt leuchtet: ein Ziel außerhalb dieses Ausschnitts kann nichts bringen (ein Vorfilter, nie ein Urteil). Ein Eintrag, der nirgends leuchtet, hat kein Ziel.
    let quelle: { x0: number; y0: number; x1: number; y1: number } | null = null;
    let genannt = { regionen: new Set<string>(), gebiete: new Set<string>() };
    let lit: SearchLeuchten | undefined;
    if (begriff.typ === "eintrag") {
        const antwort = await leuchte(database, basis, leuchtOptionen(kontext));
        if (antwort === undefined || antwort.pausiert) return [];
        if (antwort.rahmen === null && !antwort.nurKontinent) return [];
        quelle = antwort.nurKontinent ? null : antwort.rahmen;
        genannt = await genannteZiele(database, begriff.eintrag.publicId);
        lit = antwort;
    }
    const sortiere = <T extends { guete: number; genannt: boolean; flaeche: number; name: string }>(
        a: T,
        b: T,
    ): number =>
        (q === "" ? 0 : a.guete - b.guete) ||
        Number(b.genannt) - Number(a.genannt) ||
        b.flaeche - a.flaeche ||
        a.name.localeCompare(b.name, "de");

    const landschaften = katalog.landschaften
        .flatMap((ziel) => {
            const guete = zielGuete(ziel.gefaltet, q);
            if (guete === undefined || (quelle !== null && !schneiden(quelle, ziel.rahmen))) return [];
            return [
                {
                    ziel,
                    guete,
                    genannt: ziel.ids.some((id) => genannt.regionen.has(id)),
                    flaeche: ziel.flaeche,
                    name: ziel.name,
                },
            ];
        })
        .sort(sortiere);
    const gebiete = katalog.gebiete
        .flatMap((ziel) => {
            const guete = zielGuete(ziel.gefaltet, q);
            if (guete === undefined || (quelle !== null && !schneiden(quelle, ziel.rahmen))) return [];
            return [{ ziel, guete, genannt: genannt.gebiete.has(ziel.id), flaeche: ziel.flaeche, name: ziel.name }];
        })
        .sort(sortiere);

    // Ohne Getipptes schlägt die Liste nur vor, WO der Eintrag gelistet ist (der Punkt der Gegend liegt in dem, was leuchtet, wie im Panel): zuerst die genannten, dann die ersten
    // Gegenden nach Größe, soweit gelistet. Wer einen Namen tippt, bekommt jede Gegend mit Treffern. Gerechnet werden `PRUEFUNG.vorfilter` Kandidaten je Gruppe, danach höchstens so viele wie gezeigt.
    const waehle = async <T extends { genannt: boolean }>(
        kandidaten: readonly T[],
        anzahl: number,
        tafel: Gelistet["tafel"],
        idsVon: (kandidat: T) => readonly string[],
    ): Promise<{ gewaehlt: T[]; ungeprueft: number }> => {
        if (q !== "" || lit === undefined) {
            return { gewaehlt: kandidaten.slice(0, anzahl), ungeprueft: Math.max(0, kandidaten.length - anzahl) };
        }
        const menge = kandidaten.slice(0, PRUEFUNG.vorfilter);
        const offen = menge.filter((kandidat) => !kandidat.genannt);
        const urteile = await sindGelistet(database, lit, tafel, offen.map(idsVon));
        const gelistet = new Set(offen.filter((_, i) => urteile[i] === true));
        const gewaehlt = menge.filter((kandidat) => kandidat.genannt || gelistet.has(kandidat)).slice(0, anzahl);
        return { gewaehlt, ungeprueft: Math.max(0, kandidaten.length - menge.length) };
    };
    const [landschaftsAuswahl, gebietsAuswahl] = await Promise.all([
        waehle(landschaften, PRUEFUNG.landschaft, "region", (kandidat) => kandidat.ziel.ids),
        waehle(gebiete, PRUEFUNG.gebiet, "territory", (kandidat) => [kandidat.ziel.id]),
    ]);

    const text = (name: string): string => `${begriffName(begriff)} ${praeposition.text} ${name}`;
    const rechne = async (
        hat: { name: string; typ: string | null; genannt: boolean; gefaltet: string },
        anfrage: SearchLeuchtAnfrage,
    ): Promise<SearchZielHit | undefined> => {
        const antwort = await leuchte(database, anfrage, leuchtOptionen(kontext));
        if (antwort === undefined || antwort.pausiert || antwort.gegenden + antwort.orte.length === 0) return undefined;
        return {
            name: hat.name,
            ...(hat.typ === null ? {} : { typ: hat.typ }),
            genannt: hat.genannt,
            genau: q !== "" && hat.gefaltet === q,
            gegenden: antwort.gegenden,
            orte: antwort.orte.length,
            text: text(hat.name),
            leuchten: anfrage,
        };
    };
    const [landschaftsHits, gebietsHits] = await Promise.all([
        parallel(landschaftsAuswahl.gewaehlt, PRUEFUNG.parallel, (kandidat) =>
            rechne(
                {
                    name: kandidat.ziel.name,
                    typ: kandidat.ziel.typ,
                    genannt: kandidat.genannt,
                    gefaltet: kandidat.ziel.gefaltet,
                },
                { ...basis, landschaften: [...kandidat.ziel.publicIds] },
            ),
        ),
        parallel(gebietsAuswahl.gewaehlt, PRUEFUNG.parallel, (kandidat) =>
            rechne(
                {
                    name: kandidat.ziel.name,
                    typ: kandidat.ziel.typ,
                    genannt: kandidat.genannt,
                    gefaltet: kandidat.ziel.gefaltet,
                },
                { ...basis, gebiet: kandidat.ziel.publicId },
            ),
        ),
    ]);
    const mit = <T>(liste: (T | undefined)[]): T[] => liste.filter((eintrag): eintrag is T => eintrag !== undefined);
    return [
        gruppe("landschaft", mit(landschaftsHits).sort(hitSortierung), landschaftsAuswahl.ungeprueft),
        gruppe("gebiet", mit(gebietsHits).sort(hitSortierung), gebietsAuswahl.ungeprueft),
    ];
}

/** Ziel „südlich von …“: ein Ort. */
async function ortZiele(kontext: ZielKontext, rest: string): Promise<SearchZielGruppe[]> {
    const { database, begriff, praeposition } = kontext;
    const lage = praeposition.lage as SearchLage;
    const basis = begriffBasis(begriff);
    const orte = await sucheOrte(database, rest, PRUEFUNG.ort);
    const q = foldName(rest);
    const hits = await parallel(orte, PRUEFUNG.parallel, async (ort): Promise<SearchZielHit | undefined> => {
        const anfrage: SearchLeuchtAnfrage = { ...basis, lage, orte: [ort.public_id] };
        const antwort = await leuchte(database, anfrage, leuchtOptionen(kontext));
        if (antwort === undefined || antwort.pausiert || antwort.gegenden + antwort.orte.length === 0) return undefined;
        return {
            name: ort.name,
            typ: ort.subtype,
            genannt: false,
            genau: q !== "" && foldName(ort.name) === q,
            gegenden: antwort.gegenden,
            orte: antwort.orte.length,
            text: `${begriffName(begriff)} ${praeposition.text} ${ort.name}`,
            leuchten: anfrage,
        };
    });
    const mit = hits.filter((hit): hit is SearchZielHit => hit !== undefined).sort(hitSortierung);
    return [gruppe("ort", mit, Math.max(0, (orte[0]?.gesamt ?? 0) - orte.length))];
}

/** Ziel „zwischen A und B“: erst A (nur ein Textvorschlag), dann B (fertig, mit Zahlen). */
async function zweiOrteZiele(kontext: ZielKontext, rest: string): Promise<SearchZielGruppe[]> {
    const { database, begriff, praeposition } = kontext;
    const basis = begriffBasis(begriff);
    const woerter = rest.split(/\s+/u).filter((wort) => wort !== "");
    const undStelle = woerter.findIndex((wort) => foldName(wort) === "und");
    const kopf = `${begriffName(begriff)} ${praeposition.text}`;
    if (undStelle < 0) {
        // A wird noch getippt: Die Orte ergänzen nur den Text.
        const orte = await sucheOrte(database, rest, PRUEFUNG.ort);
        const q = foldName(rest);
        const hits: SearchZielHit[] = orte.map((ort) => ({
            name: ort.name,
            typ: ort.subtype,
            genannt: false,
            genau: q !== "" && foldName(ort.name) === q,
            text: `${kopf} ${ort.name} und `,
        }));
        return [gruppe("ort", hits, Math.max(0, (orte[0]?.gesamt ?? 0) - orte.length))];
    }
    const a = await findeOrt(database, woerter.slice(0, undStelle).join(" "));
    if (a === undefined) return [gruppe("ort", [], 0)];
    const getipptB = woerter.slice(undStelle + 1).join(" ");
    const orte = await sucheOrte(database, getipptB, PRUEFUNG.ort, a.public_id);
    const q = foldName(getipptB);
    const hits = await parallel(orte, PRUEFUNG.parallel, async (ort): Promise<SearchZielHit | undefined> => {
        const anfrage: SearchLeuchtAnfrage = { ...basis, lage: "zwischen", orte: [a.public_id, ort.public_id] };
        const antwort = await leuchte(database, anfrage, leuchtOptionen(kontext));
        if (antwort === undefined || antwort.pausiert || antwort.gegenden + antwort.orte.length === 0) return undefined;
        return {
            name: ort.name,
            typ: ort.subtype,
            genannt: false,
            genau: q !== "" && foldName(ort.name) === q,
            gegenden: antwort.gegenden,
            orte: antwort.orte.length,
            text: `${kopf} ${a.name} und ${ort.name}`,
            leuchten: anfrage,
        };
    });
    const mit = hits.filter((hit): hit is SearchZielHit => hit !== undefined).sort(hitSortierung);
    return [gruppe("ort", mit, Math.max(0, (orte[0]?.gesamt ?? 0) - orte.length))];
}

// ---------------------------------------------------------------------------------------------------------------------
// Die Suche
// ---------------------------------------------------------------------------------------------------------------------

/** Die Anfrage, wie sie verstanden wurde: Begriff und entweder die Präpositionen oder die Ziele. */
export async function loeseAnfrage(
    database: Queryable,
    text: string,
    index: VorkommenIndex,
    katalog: ZielKatalog,
    optionen: VorkommenSucheOptionen = {},
): Promise<SearchAnfrage | undefined> {
    const zerlegung = zerlege(index, text, optionen.ausgeblendet);
    if (zerlegung === undefined) return undefined;
    const begriff = begriffAlsAnzeige(zerlegung.begriff);
    if (zerlegung.voll === undefined) {
        return {
            begriff,
            praepositionen: (zerlegung.vorschlaege ?? PRAEPOSITIONEN).map((praeposition) => praeposition.text),
        };
    }
    const { praeposition, rest } = zerlegung.voll;
    const ziele = await rechneZiele(
        { database, katalog, begriff: zerlegung.begriff, praeposition, ausgeblendet: optionen.ausgeblendet },
        rest,
    );
    // Die Schranke ist voll: Begriff und Präposition stehen, die Ziele fehlen (nicht gerechnet, nicht „keine“).
    if (ziele === undefined) return { begriff, praeposition: praeposition.text };
    return { begriff, praeposition: praeposition.text, ziele };
}

/**
 * Die Ziele einer Anfrage, aus dem Speicher oder gerechnet; `undefined`, wo die Schranke voll ist. Sie sind eine reine Funktion von Kartenstand, Begriff, Präposition, Getipptem und ausgeblendeten
 * Arten: Wer zurückschreibt oder neu tippt, bekommt sie aus dem Speicher.
 */
async function rechneZiele(kontext: ZielKontext, rest: string): Promise<SearchZielGruppe[] | undefined> {
    const { katalog, begriff, praeposition } = kontext;
    const aus = SCHALTER_ARTEN.filter((art) => kontext.ausgeblendet?.(art) === true);
    const schluessel = JSON.stringify([begriffBasis(begriff), praeposition.text, foldName(rest), aus]);
    const da = zielSpeicher.get(schluessel, katalog.stand);
    if (da !== undefined) return da;
    return zielSchranke.laufe(async () => {
        const gerechnet =
            praeposition.ziel === "gegend"
                ? await gegendZiele(kontext, rest)
                : praeposition.ziel === "ort"
                  ? await ortZiele(kontext, rest)
                  : await zweiOrteZiele(kontext, rest);
        zielSpeicher.set(schluessel, katalog.stand, gerechnet, JSON.stringify(gerechnet).length);
        return gerechnet;
    });
}

/**
 * Die Ziele „in …“ eines Eintrags ohne Getipptes: dieselbe Rechnung (und derselbe Speicher) wie die Autovervollständigung nach „Name in“. Das Panel des Eintrags nimmt daraus die im Wiki
 * genannten für seine Chips „Wo genau?“; `undefined`, wo die Rechnung überlastet war.
 */
export async function zieleDesEintrags(
    database: Queryable,
    eintrag: IndexEintrag,
    optionen: VorkommenSucheOptionen = {},
): Promise<SearchZielGruppe[] | undefined> {
    const katalog = await zielKatalog(database);
    const praeposition = PRAEPOSITIONEN.find((kandidat) => kandidat.text === "in") as Praeposition;
    return rechneZiele(
        { database, katalog, begriff: { typ: "eintrag", eintrag }, praeposition, ausgeblendet: optionen.ausgeblendet },
        "",
    );
}

/**
 * Die Vorkommen-Anteile einer Suchanfrage: die Sektion „Vorkommen“, die Gebiete und die kurze Anfrage. Alles, was fehlt, fehlt (kein leeres Feld), damit die Antwort für Aufrufer,
 * die es nicht kennen, unverändert bleibt.
 */
export async function sucheVorkommen(
    database: Queryable,
    query: string,
    optionen: VorkommenSucheOptionen = {},
): Promise<VorkommenSucheErgebnis> {
    const text = query.trim();
    if (text.length < SEARCH_MIN_LENGTH) return {};
    const { zeiten } = optionen;
    const [index, katalog] = await Promise.all([
        gemessen(zeiten, "index", vorkommenIndex(database)),
        gemessen(zeiten, "katalog", zielKatalog(database)),
    ]);
    const vorkommen = vorkommenSektion(index, text, optionen.ausgeblendet);
    const gebiete = gebieteSektion(katalog, text);
    const anfrage = await gemessen(zeiten, "anfrage", loeseAnfrage(database, text, index, katalog, optionen));
    return {
        ...(vorkommen === undefined ? {} : { vorkommen }),
        ...(gebiete === undefined ? {} : { gebiete }),
        ...(anfrage === undefined ? {} : { anfrage }),
    };
}
