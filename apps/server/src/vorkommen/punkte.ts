import type {
    VorkommenAmPunkt,
    VorkommenEintragTreffer,
    VorkommenPunkt,
    VorkommenRegelBezug,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { liegtInHalbebene } from "./halbebene.ts";
import { REPARIERT } from "./regel-sql.ts";
import { ermittleKartenstand, ladeRegeln, type Glied, type Regel } from "./regeln.ts";

/**
 * Richtung B der Auswertung (WI-0257, S1): Gegenstand → Einträge. Welche Einträge trägt ein Punkt der Karte über Regeln? Für das Infopanel (Ort, Kartenpunkt, Fläche), die Etappen der Route und „Was ist hier?“.
 *
 * - **Exakt für einen Punkt, als Kette von Wahrheitswerten je Bedingung:** Der Punkt liegt in einer Landschaft der Art, in der Rahmenfläche, in einem Klimaband der Spanne und auf der richtigen Seite
 *   der Linie. Die Kette läuft streng von links nach rechts (`und`, `oder`, `ohne`). Das ist dieselbe Aussage wie `c ∩ R` in Richtung A, nur für einen Punkt statt für eine Landschaft (Zusage und Test:
 *   `vorkommen-auswertung.test.ts`).
 * - **Mehrere Punkte in einer Abfrage:** eine Abfrage für die Landschaften an allen Punkten, eine für die Klimabänder; die Regeln werden im Prozess ausgewertet. Die Regeln selbst liegen im Prozess
 *   (`katalog`), je Kartenstand einmal geladen: Für einen Punkt bleiben zwei kleine Abfragen.
 * - **Eine Fläche als Gegenstand** wird über ihren Punkt entschieden (`ST_PointOnSurface` der reparierten Vereinigung ihrer Flächen, wie `areaProbe` in `subjects/sections/lore.ts`). 🪤 Wie dort erbt eine
 *   Fläche nur von GRÖSSEREN Landschaften: Von den Landschaften an ihrem Punkt zählen sie selbst und jene, die größer sind als sie. Ohne diese Schranke trüge die Landschaft „Aventurien“ das, was in dem
 *   Wald lebt, der zufällig ihren Repräsentanten überdeckt.
 * - Eine Regel, deren Bedingung auf eine nicht (mehr) vorhandene Fläche zeigt, trifft diese Bedingung nie.
 */

const DOMAENE = "aventuria";

interface Katalog {
    stand: string;
    regeln: readonly Regel[];
    /** Landschaftsfläche je Region (Summe ihrer aktiven Flächen), nur für die Schranke „größer“; wird bei der ersten Fläche als Gegenstand geladen. */
    flaechen?: Map<string, number>;
    /** Die Rahmen, hinter denen eine Ortszeile zurücktritt; einmal je Kartenstand aus den Regeln gebildet. */
    ersatz?: OrtszeilenErsatz;
}

let katalog: Katalog | undefined;
let katalogLaedt: { stand: string; versprechen: Promise<Katalog> } | undefined;

/** Leert die Regeln im Prozess (Tests, Eingriffe an der Datenbank). */
export function leereVorkommenKatalog(): void {
    katalog = undefined;
    katalogLaedt = undefined;
}

async function ladeKatalog(database: Queryable): Promise<Katalog> {
    const stand = await ermittleKartenstand(database, DOMAENE);
    if (katalog?.stand === stand) return katalog;
    if (katalogLaedt?.stand === stand) return katalogLaedt.versprechen;
    const versprechen = ladeRegeln(database).then((regeln): Katalog => {
        const neu: Katalog = { stand, regeln };
        katalog = neu;
        return neu;
    });
    katalogLaedt = { stand, versprechen };
    void versprechen.then(
        () => {
            if (katalogLaedt?.versprechen === versprechen) katalogLaedt = undefined;
        },
        () => {
            if (katalogLaedt?.versprechen === versprechen) katalogLaedt = undefined;
        },
    );
    return versprechen;
}

/** Was die Karte an einem Punkt hat. */
export interface Umgebung {
    /** Die Regionen (aktiv, nicht verborgen, alle Ebenen), deren Fläche den Punkt enthält, mit ihrer Art (`ebene|art`; `null` für die Ebene `klima` oder ohne Art). */
    regionen: ReadonlyMap<string, string | null>;
    /** Die Arten dieser Regionen. */
    arten: ReadonlySet<string>;
    /** Die Klimazonen, deren Band den Punkt enthält. */
    zonen: ReadonlySet<string>;
}

const umgebungVon = (regionen: ReadonlyMap<string, string | null>, zonen: ReadonlySet<string>): Umgebung => ({
    regionen,
    arten: new Set([...regionen.values()].filter((art): art is string => art !== null)),
    zonen,
});

/**
 * Die Umgebung aller Punkte in zwei Abfragen: `&&` (Index), danach `ST_Intersects` auf der Form, wie sie in der Tafel steht.
 *
 * 🪤 **Hier steht die Form unrepariert, in Richtung A die reparierte.** Das Infopanel fragt ebenso (`regionsAt` in `subjects/sections/lore.ts`), und die Reparatur kostet an einem Punkt das 15fache
 * (gemessen: 49 statt 3 ms), weil zwei der ungültigen Flächen das Meer mit je rund 18.000 Stützpunkten sind. Ein Punkt kann sich nur dort unterscheiden, wo eine der 92 ungültigen Flächen (von
 * 6.125) sich selbst schneidet; dort, in der Schleife der Schleife, gälte er in A anders als in B.
 *
 * `gruppe` (je Punkt eine Nummer) sagt, dass die Punkte in Gruppen weit über die Karte verstreut liegen - die Etappen einer ganzen Route. Dann sucht jede Gruppe ihre Flächen über ihr eigenes
 * Rechteck statt über eines um alle Punkte, und jede Fläche prüft nur die Punkte der Gruppen, deren Rechteck sie schneidet: Gemessen an 660 Punkten einer Route mit 67 Etappen 55 statt 135 ms,
 * mit demselben Ergebnis. 🪤 Die Zeilen kommen dort ausdrücklich nach Punkt und Landschaft (`region.id` als Text) geordnet - so, wie die Abfrage für eine Gruppe sie über ihren Plan liefert
 * (`DISTINCT` über eine Sortierung). In dieser Reihenfolge nennt {@link treffendeFlaechen} die Landschaften, und die erste benannte ist die Gegend in „Unterwegs“.
 */
async function ladeUmgebungen(
    database: Queryable,
    punkte: readonly VorkommenPunkt[],
    gruppe?: readonly number[],
): Promise<Umgebung[]> {
    const xs = punkte.map((p) => p.x);
    const ys = punkte.map((p) => p.y);
    // 🔴 Die Flächen stehen außen, die Punkte innen (`OFFSET 0` hält den Planer davon ab, es umzudrehen): PostGIS merkt sich zum Punkt-in-Fläche-Test den Index der
    // zuletzt gefragten Fläche, und der trägt nur, wenn dieselbe Fläche hintereinander gefragt wird. Gemessen an 609 Punkten entlang eines Weges (12.800 Tests gegen Flächen
    // mit bis zu 18.000 Stützpunkten): 1.140 ms mit den Punkten außen, 88 ms so, mit demselben Ergebnis.
    const flaechenAbfrage =
        gruppe === undefined
            ? database.unsafe<{ i: number; rid: string; layer: string; typ: string | null }[]>(
                  `WITH pts AS MATERIALIZED (
                       SELECT u.i::int AS i, ST_SetSRID(ST_MakePoint(u.x, u.y), 0) AS g
                         FROM unnest($1::float8[], $2::float8[]) WITH ORDINALITY AS u(x, y, i)),
                     box AS (SELECT ST_Extent(g)::geometry AS e FROM pts),
                     cand AS MATERIALIZED (
                       SELECT a.region_id, a.geom FROM region_area a, box
                        WHERE a.is_active AND a.map_domain_id = $3::text AND a.geom && box.e)
                   SELECT DISTINCT p.i, r.id::text AS rid, r.region_layer AS layer, r.region_type AS typ
                     FROM cand a
                     JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
                     CROSS JOIN LATERAL (SELECT pts.i FROM pts WHERE a.geom && pts.g AND ST_Intersects(a.geom, pts.g) OFFSET 0) p`,
                  [xs, ys, DOMAENE] as never[],
              )
            : database.unsafe<{ i: number; rid: string; layer: string; typ: string | null }[]>(
                  `WITH box AS MATERIALIZED (
                       SELECT u.k, ST_Extent(u.g)::geometry AS e, array_agg(u.i) AS ii, array_agg(u.g) AS gg
                         FROM (SELECT u.i::int AS i, u.k, ST_SetSRID(ST_MakePoint(u.x, u.y), 0) AS g
                                 FROM unnest($1::float8[], $2::float8[], $4::int[]) WITH ORDINALITY AS u(x, y, k, i)) u
                        GROUP BY u.k),
                     paar AS (
                       SELECT a.id, array_agg(b.k) AS kk
                         FROM box b JOIN region_area a ON a.is_active AND a.map_domain_id = $3::text AND a.geom && b.e
                        GROUP BY a.id)
                   SELECT DISTINCT x.i, r.id::text AS rid, r.region_layer AS layer, r.region_type AS typ
                     FROM paar p
                     JOIN region_area a ON a.id = p.id
                     JOIN region r ON r.id = a.region_id AND r.is_active AND NOT r.is_hidden
                     CROSS JOIN LATERAL (
                         SELECT u.i FROM box b CROSS JOIN LATERAL unnest(b.ii, b.gg) AS u(i, g)
                          WHERE b.k = ANY(p.kk) AND a.geom && u.g AND ST_Intersects(a.geom, u.g) OFFSET 0) x
                    ORDER BY 1, 2`,
                  [xs, ys, DOMAENE, [...gruppe]] as never[],
              );
    const [regionen, baender] = await Promise.all([
        flaechenAbfrage,
        database<{ i: number; zone: string }[]>`
            SELECT DISTINCT u.i::int AS i, b.type_key AS zone
              FROM unnest(${xs}::float8[], ${ys}::float8[]) WITH ORDINALITY AS u(x, y, i)
              CROSS JOIN LATERAL (SELECT ST_SetSRID(ST_MakePoint(u.x, u.y), 0) AS g) pt
              JOIN climate_band b ON ST_Intersects(b.geom, pt.g)
        `,
    ]);
    const nachPunkt = punkte.map(() => ({ regionen: new Map<string, string | null>(), zonen: new Set<string>() }));
    for (const zeile of regionen) {
        nachPunkt[zeile.i - 1]?.regionen.set(
            zeile.rid,
            zeile.layer !== "klima" && zeile.typ !== null ? `${zeile.layer}|${zeile.typ}` : null,
        );
    }
    for (const zeile of baender) nachPunkt[zeile.i - 1]?.zonen.add(zeile.zone);
    return nachPunkt.map((n) => umgebungVon(n.regionen, n.zonen));
}

/** Trifft die Bedingung den Punkt? Alle vier Teile müssen zutreffen; ein leeres Feld schränkt nicht ein. */
function gliedTrifft(glied: Glied, punkt: VorkommenPunkt, umgebung: Umgebung): boolean {
    if (glied.nenntArten && !glied.arten.some((art) => umgebung.arten.has(art))) return false;
    if (glied.flaeche !== null && (glied.flaeche.regionId === null || !umgebung.regionen.has(glied.flaeche.regionId)))
        return false;
    if (glied.klima !== null && !glied.klima.zonen.some((zone) => umgebung.zonen.has(zone))) return false;
    if (
        glied.lage !== null &&
        (glied.lage.halbebene === null || !liegtInHalbebene(glied.lage.halbebene, punkt.x, punkt.y))
    )
        return false;
    return true;
}

/** Trifft die Regel den Punkt? Die Kette streng von links nach rechts. */
export function regelTrifft(regel: Regel, punkt: VorkommenPunkt, umgebung: Umgebung): boolean {
    let bisher = false;
    regel.glieder.forEach((glied, position) => {
        const trifft = gliedTrifft(glied, punkt, umgebung);
        if (position === 0) bisher = trifft;
        else if (glied.op === "oder") bisher = bisher || trifft;
        else if (glied.op === "ohne") bisher = bisher && !trifft;
        else bisher = bisher && trifft;
    });
    return bisher;
}

/** Die Ebenen in der Reihenfolge, in der eine benannte Landschaft die Gegend eines Treffers nennt: die Landschaft der Erdkunde zuerst, die Pflanzendecke zuletzt. */
const EBENEN_RANG: ReadonlyMap<string, number> = new Map([
    ["derographisch", 0],
    ["topographie", 1],
    ["vegetation", 2],
]);

/**
 * Die Landschaften, an denen eine Regel einen Punkt trifft, in der Reihenfolge, in der die erste benannte die „Gegend“ des Eintrags ist (WI-0257 S4, „Unterwegs“): zuerst die Rahmenfläche der
 * Glieder, dann die Landschaften der genannten Arten am Punkt, zuletzt alle übrigen Landschaften am Punkt (Erdkunde vor Pflanzendecke). Abgezogene Glieder (`ohne`) nennen nichts.
 * Ob ein Name ein Griff ist („Wald-925“) oder ein Kontinent, entscheidet der Aufrufer; hier stehen nur die Kennungen (`region.id`).
 */
function treffendeFlaechen(regel: Regel, umgebung: Umgebung): string[] {
    const gefunden = new Set<string>();
    for (const glied of regel.glieder) {
        if (glied.op === "ohne") continue;
        const rahmen = glied.flaeche?.regionId ?? null;
        if (rahmen !== null && umgebung.regionen.has(rahmen)) gefunden.add(rahmen);
    }
    for (const glied of regel.glieder) {
        if (glied.op === "ohne" || glied.arten.length === 0) continue;
        for (const [id, art] of umgebung.regionen) if (art !== null && glied.arten.includes(art)) gefunden.add(id);
    }
    const rest = [...umgebung.regionen]
        .filter(([id, art]) => art !== null && !gefunden.has(id))
        .sort(
            ([linksId, links], [rechtsId, rechts]) =>
                (EBENEN_RANG.get((links as string).split("|")[0] as string) ?? 9) -
                    (EBENEN_RANG.get((rechts as string).split("|")[0] as string) ?? 9) ||
                Number(linksId) - Number(rechtsId),
        );
    for (const [id] of rest) gefunden.add(id);
    return [...gefunden];
}

/**
 * Die Einträge mit ihren treffenden Regeln, Beziehung für Beziehung, in der Reihenfolge der Einträge. Mit `flaechen` merkt sich die Funktion je Eintrag, der hier zum ersten Mal trifft, die
 * Landschaften des Treffers (`treffendeFlaechen`); ein Eintrag, den die Karte schon trägt, behält die des ersten Punktes.
 */
function sammle(
    regeln: readonly Regel[],
    punkt: VorkommenPunkt,
    umgebung: Umgebung,
    flaechen?: Map<string, string[]>,
): VorkommenEintragTreffer[] {
    const nachEintrag = new Map<string, VorkommenEintragTreffer>();
    for (const regel of regeln) {
        if (!regelTrifft(regel, punkt, umgebung)) continue;
        if (flaechen !== undefined && !flaechen.has(regel.eintragId))
            flaechen.set(regel.eintragId, treffendeFlaechen(regel, umgebung));
        let eintrag = nachEintrag.get(regel.eintragId);
        if (eintrag === undefined) {
            eintrag = { id: regel.eintragId, eintragId: regel.eintragPublicId, art: regel.art, beziehungen: [] };
            nachEintrag.set(regel.eintragId, eintrag);
        }
        let beziehung = eintrag.beziehungen.find((b) => b.beziehung === regel.beziehung);
        if (beziehung === undefined) {
            beziehung = { beziehung: regel.beziehung, regeln: [] };
            eintrag.beziehungen.push(beziehung);
        }
        const bezug: VorkommenRegelBezug = { ruleId: regel.ruleId, ruleKey: regel.ruleKey };
        beziehung.regeln.push(bezug);
    }
    return [...nachEintrag.values()];
}

/**
 * Die Einträge an mehreren Punkten auf einmal (Etappen: Punkte einer Linie), eine Antwort je Punkt in der Reihenfolge der Eingabe. Wer die Vereinigung über alle Punkte braucht, fasst die
 * Antworten selbst zusammen (`vereinigeEintraege`).
 */
export async function eintraegeAnPunkten(
    database: Queryable,
    punkte: readonly VorkommenPunkt[],
): Promise<VorkommenAmPunkt[]> {
    if (punkte.length === 0) return [];
    const [kat, umgebungen] = await Promise.all([ladeKatalog(database), ladeUmgebungen(database, punkte)]);
    return punkte.map((punkt, i) => ({
        punkt: { x: punkt.x, y: punkt.y },
        eintraege: sammle(kat.regeln, punkt, umgebungen[i] as Umgebung),
    }));
}

/** Was {@link eintraegeAnPunktgruppen} je Gruppe nennt. */
export interface GruppenTreffer {
    /** Die Vereinigung über die Punkte der Gruppe (`vereinigeEintraege`), in der Reihenfolge des ersten Treffers. */
    eintraege: VorkommenEintragTreffer[];
    /** Je Eintrag die Landschaften (`region.id`) des ersten Punktes DER GRUPPE, an dem eine seiner Regeln trifft, in der Reihenfolge von {@link treffendeFlaechen}. */
    flaechen: Map<string, string[]>;
}

/**
 * Die Einträge vieler Punktgruppen auf einmal - die Etappen einer ganzen Route für „Unterwegs“ (WI-0257 S4): je Gruppe die Vereinigung über ihre Punkte und zu jedem Eintrag die Landschaften des
 * ersten Punktes der Gruppe, an dem eine seiner Regeln trifft (die Gegend, in der er zuerst vorkommt). Die Auswertung ist dieselbe Stelle wie {@link eintraegeAnPunkten}, nur gebündelt: EIN Katalog,
 * EINE Umgebung je verschiedenem Punkt (zwei Abfragen für alle Gruppen), danach je Gruppe {@link sammle} in der Reihenfolge ihrer Punkte.
 *
 * Dazu die Rahmen des Kartenstands ({@link ortszeilenErsatz}): Der Aufrufer braucht sie für dieselbe Rechnung und ermittelt den Kartenstand so kein zweites Mal.
 */
export async function eintraegeAnPunktgruppen(
    database: Queryable,
    gruppen: readonly (readonly VorkommenPunkt[])[],
): Promise<{ gruppen: GruppenTreffer[]; ersatz: OrtszeilenErsatz }> {
    // Gleiche Punkte verschiedener Gruppen (Hin- und Rückweg, gemeinsame Wege) fragen die Karte einmal.
    const nummer = new Map<string, number>();
    const punkte: VorkommenPunkt[] = [];
    /** Je Punkt die Gruppe, in der er zuerst steht: Über ihre Gruppen sucht `ladeUmgebungen` die Flächen. */
    const gruppeDes: number[] = [];
    const lage = gruppen.map((gruppe, g) =>
        gruppe.map((punkt) => {
            const schluessel = `${String(punkt.x)}|${String(punkt.y)}`;
            let at = nummer.get(schluessel);
            if (at === undefined) {
                at = punkte.push({ x: punkt.x, y: punkt.y }) - 1;
                gruppeDes.push(g);
                nummer.set(schluessel, at);
            }
            return at;
        }),
    );
    const [kat, umgebungen] = await Promise.all([
        ladeKatalog(database),
        punkte.length === 0 ? Promise.resolve<Umgebung[]>([]) : ladeUmgebungen(database, punkte, gruppeDes),
    ]);
    kat.ersatz ??= bildeErsatz(kat.regeln);
    return {
        gruppen: gruppen.map((gruppe, g) => {
            const flaechen = new Map<string, string[]>();
            const antworten = gruppe.map((punkt, i) => ({
                punkt: { x: punkt.x, y: punkt.y },
                eintraege: sammle(kat.regeln, punkt, umgebungen[lage[g]?.[i] ?? -1] as Umgebung, flaechen),
            }));
            return { eintraege: vereinigeEintraege(antworten), flaechen };
        }),
        ersatz: kat.ersatz,
    };
}

/** Die Einträge an einem Punkt. */
export async function eintraegeAmPunkt(database: Queryable, punkt: VorkommenPunkt): Promise<VorkommenAmPunkt> {
    const [antwort] = await eintraegeAnPunkten(database, [punkt]);
    return antwort as VorkommenAmPunkt;
}

/** Die Vereinigung der Einträge mehrerer Punkte: je Eintrag und Beziehung jede Regel einmal. */
export function vereinigeEintraege(antworten: readonly VorkommenAmPunkt[]): VorkommenEintragTreffer[] {
    const nachEintrag = new Map<string, VorkommenEintragTreffer>();
    for (const antwort of antworten) {
        for (const eintrag of antwort.eintraege) {
            let ziel = nachEintrag.get(eintrag.id);
            if (ziel === undefined) {
                ziel = { id: eintrag.id, eintragId: eintrag.eintragId, art: eintrag.art, beziehungen: [] };
                nachEintrag.set(eintrag.id, ziel);
            }
            for (const beziehung of eintrag.beziehungen) {
                let b = ziel.beziehungen.find((x) => x.beziehung === beziehung.beziehung);
                if (b === undefined) {
                    b = { beziehung: beziehung.beziehung, regeln: [] };
                    ziel.beziehungen.push(b);
                }
                for (const regel of beziehung.regeln) {
                    if (!b.regeln.some((r) => r.ruleId === regel.ruleId)) b.regeln.push(regel);
                }
            }
        }
    }
    return [...nachEintrag.values()];
}

/**
 * Der Punkt, über den eine Fläche entschieden wird, und ihre Größe: `ST_PointOnSurface` der reparierten Vereinigung der aktiven Flächen der Regionen (wie `areaProbe`). `undefined`, wo es keine brauchbare
 * Form gibt.
 */
async function flaechenPunkt(
    database: Queryable,
    regionIds: readonly string[],
): Promise<{ x: number; y: number; flaeche: number; ids: string[] } | undefined> {
    const rows = await database.unsafe<{ x: number; y: number; area: number; ids: string[] }[]>(
        `SELECT ST_X(ST_PointOnSurface(g)) AS x, ST_Y(ST_PointOnSurface(g)) AS y, ST_Area(g) AS area, ids
           FROM (SELECT ST_UnaryUnion(ST_Collect(${REPARIERT("a.geom")})) AS g, array_agg(DISTINCT r.id::text) AS ids
                   FROM region_area a JOIN region r ON r.id = a.region_id
                  WHERE a.is_active AND r.is_active AND (r.public_id::text = ANY($1::text[]) OR r.id::text = ANY($1::text[]))) u
          WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)`,
        [[...regionIds]] as never[],
    );
    const zeile = rows[0];
    if (zeile === undefined) return undefined;
    return { x: Number(zeile.x), y: Number(zeile.y), flaeche: Number(zeile.area), ids: zeile.ids };
}

/** Die Fläche jeder Region (Summe ihrer aktiven Flächen); einmal je Kartenstand. */
async function ladeFlaechen(database: Queryable, kat: Katalog): Promise<Map<string, number>> {
    if (kat.flaechen !== undefined) return kat.flaechen;
    const zeilen = await database<{ rid: string; a: number }[]>`
        SELECT a.region_id::text AS rid, sum(ST_Area(a.geom))::float8 AS a FROM region_area a WHERE a.is_active GROUP BY a.region_id
    `;
    const flaechen = new Map(zeilen.map((z) => [z.rid, Number(z.a)]));
    kat.flaechen = flaechen;
    return flaechen;
}

/**
 * Die Einträge einer Fläche (einer Landschaft; `regionIds` sind ihre Regionen, als `region.public_id` oder `region.id`, mehrere für eine Gruppe gleichnamiger). Entschieden wird über den Punkt der Fläche;
 * von den Landschaften an diesem Punkt zählen die eigenen und die größeren. `undefined`, wo die Fläche keine brauchbare Form hat.
 */
export async function eintraegeAnFlaechen(
    database: Queryable,
    regionIds: readonly string[],
): Promise<VorkommenAmPunkt | undefined> {
    if (regionIds.length === 0) return undefined;
    const probe = await flaechenPunkt(database, regionIds);
    if (probe === undefined) return undefined;
    return eintraegeAmFlaechenpunkt(database, { x: probe.x, y: probe.y, flaeche: probe.flaeche }, probe.ids);
}

/**
 * Dasselbe für einen Aufrufer, der den Punkt der Fläche und ihre Größe schon hat (das Infopanel rechnet beides für das Enthaltensein der Ortszeilen und rechnet die Vereinigung der Formen kein zweites Mal).
 * `eigene` sind die `region.id` der Fläche; sie zählen neben den größeren Landschaften am Punkt.
 */
export async function eintraegeAmFlaechenpunkt(
    database: Queryable,
    probe: { x: number; y: number; flaeche: number },
    eigene: readonly string[],
): Promise<VorkommenAmPunkt> {
    const punkt = { x: probe.x, y: probe.y };
    const kat = await ladeKatalog(database);
    const [umgebungen, flaechen] = await Promise.all([ladeUmgebungen(database, [punkt]), ladeFlaechen(database, kat)]);
    const roh = umgebungen[0] as Umgebung;
    const meine = new Set(eigene);
    // Nur die Landschaften an diesem Punkt, die die Fläche selbst sind oder größer als sie.
    const zulaessig = new Map(
        [...roh.regionen].filter(([rid]) => meine.has(rid) || (flaechen.get(rid) ?? 0) > probe.flaeche),
    );
    const umgebung = umgebungVon(zulaessig, roh.zonen);
    return { punkt, eintraege: sammle(kat.regeln, punkt, umgebung) };
}

/**
 * Die Rahmen, hinter denen eine Ortszeile zurücktritt (WI-0257 S2, F2): Je Tripel aus Eintrag (`lore_entry.id`), Beziehung und Landschaft (`region.id`) gibt es eine aktive Regel dieser Beziehung,
 * die in einem nicht abgezogenen Glied die Landschaft als Rahmenfläche nennt. Eine Ortszeile desselben Eintrags und derselben Beziehung, die diese Landschaft als Ziel hat, nennt denselben Ort
 * ungenauer als die Regel („Bornland“ gegen „Steppe in Bornland“) und gilt nicht mehr; der Eintrag steht dort nur, wo die Regel trifft.
 *
 * 🪤 Die Menge liegt im Prozess und wird in Node gegen die Zeilen gehalten (`ortszeileErsetzt`), nicht in SQL: Als `NOT EXISTS` über `unnest` der 857 Tripel rechnete die Abfrage für jede Ortszeile
 * des ganzen Bestands (6.139) die Liste durch und brauchte 350 ms statt 3.
 */
export interface OrtszeilenErsatz {
    /** `eintrag|beziehung|region` */
    readonly schluessel: ReadonlySet<string>;
}

/** Ein Rahmen ohne Tripel: nichts tritt zurück. */
export const KEIN_ERSATZ: OrtszeilenErsatz = { schluessel: new Set() };

/** Die Rahmen aus den Regeln. Ein abgezogenes Glied (`ohne`) fasst den Ort nicht genauer, es nimmt ihm etwas; es ersetzt nichts. */
function bildeErsatz(regeln: readonly Regel[]): OrtszeilenErsatz {
    const schluessel = new Set<string>();
    for (const regel of regeln) {
        for (const glied of regel.glieder) {
            const regionId = glied.flaeche?.regionId ?? null;
            if (glied.op === "ohne" || regionId === null) continue;
            schluessel.add(`${regel.eintragId}|${regel.beziehung}|${regionId}`);
        }
    }
    return { schluessel };
}

/** Tritt die Ortszeile (Eintrag, Beziehung, ihre Ziele als Landschaften) hinter eine genauere Regel zurück? */
export function ortszeileErsetzt(
    ersatz: OrtszeilenErsatz,
    eintragId: string,
    beziehung: string,
    regionen: readonly string[],
): boolean {
    if (ersatz.schluessel.size === 0) return false;
    return regionen.some((region) => ersatz.schluessel.has(`${eintragId}|${beziehung}|${region}`));
}

/** Die Rahmen des aktuellen Kartenstands (Regeln im Prozess, einmal gebildet). */
export async function ortszeilenErsatz(database: Queryable): Promise<OrtszeilenErsatz> {
    const kat = await ladeKatalog(database);
    kat.ersatz ??= bildeErsatz(kat.regeln);
    return kat.ersatz;
}
