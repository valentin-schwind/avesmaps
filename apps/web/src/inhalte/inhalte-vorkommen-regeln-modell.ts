import type {
    InhalteVorkommenBedingung,
    InhalteVorkommenBeziehung,
    InhalteVorkommenRegel,
    InhalteVorkommenRegelAenderung,
    InhalteVorkommenRegelBedingung,
    InhalteVorkommenUrsprung,
    InhalteVorkommenWikiVorschlag,
    InhalteVorkommenZustand,
    WikisyncRegelBedingung,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { lageSchluessel, regelKurz } from "../wikisync/wikisync-regeln-text";
import { bedingungLageHalb, type EditorBedingung } from "./inhalte-regel-lage";

/**
 * Die Regeln eines Eintrags im Reiter „Vorkommen“ als reine Rechnung (WI-0254 `--weiter`, Regeleditor; Bezug WI-0253 §26): der Entwurf der Regeln, die Änderungen daran und der
 * Teil des Körpers von `lore.update`, den „Speichern“ daraus macht. Der Entwurf der Ortszeilen und Quellen steht in `inhalte-vorkommen-modell.ts`; dieses Modell kennt den Stand nicht, es
 * rechnet auf Listen von Regeln, damit die beiden sich nicht gegenseitig einbinden.
 *
 * - **Ändern heißt neu anlegen:** Die App darf an `lore_rule` nur anlegen und still legen. Eine geänderte Regel ist darum im Entwurf eine NEUE Regel (`neu`), die die alte nennt (`ersetzt`); der Körper
 *   schickt `add` mit `ersetzt`, und der Server legt die alte still. Eine Regel, die der Entwurf nicht mehr trägt und die keine neue ersetzt, geht als `remove`.
 * - **Herkunft folgt dem Inhalt:** Wer eine Regel aus dem Wiki ändert, macht sie zu einer Regel von Hand (`manual`); sie behält die Wiki-Fassung, auf der sie beruht (`wikiBasis`), und weiß, was das Wiki
 *   seitdem sagt (`wikiJetzt`). Ist die geänderte Kette wieder eine Fassung des Wikis, bleibt sie eine Wiki-Regel. Die Wahrheit rechnet der Server mit dem Fingerabdruck; dieser Entwurf sagt nur voraus,
 *   was die Karte vor dem Speichern zeigt.
 * - **Der Fingerabdruck der Kette** (`ketteSchluessel`) liest wie `ruleKeyOf` des Servers: Verknüpfung (bei der ersten leer), Fläche, Klima und die sortierten Arten je Bedingung. Zwei Ketten mit demselben Schlüssel
 *   in derselben Beziehung sind dieselbe Regel.
 * - **Die Lage zu einer Linie** (WI-0254) ist eine Bedingung wie Fläche und Klima: Eine Bedingung nur mit Lage ist gültig („alles südlich von …“). Sie geht als sechstes Feld NUR dann in den Fingerabdruck, wo eine
 *   Bedingung eine hat (`richtung:kennungen`, klein und sortiert); eine Kette ohne Lage behält ihren Schlüssel Zeichen für Zeichen. Die Lage im Modell ist immer fertig (Richtung und ein oder zwei Orte); der
 *   halb gefüllte Stand lebt im Editor (`EditorBedingung.lageEntwurf`, `inhalte-regel-lage.ts`) und sperrt dort „Regel übernehmen“ (`regelSperre`, Art `lage`).
 */

/** Eine Wiki-Fassung einer Regel: ihr Fingerabdruck und, wo sie noch bekannt ist, ihre Bedingungen. */
export interface RegelWikiFassung {
    readonly schluessel: string | undefined;
    readonly bedingungen: readonly WikisyncRegelBedingung[] | undefined;
}

/** Was das Wiki zur Beziehung seit der Änderung von Hand sagt; `geaendert`: etwas anderes als die Wiki-Fassung, auf der die Regel beruht. */
export interface RegelWikiJetzt {
    readonly bedingungen: readonly WikisyncRegelBedingung[];
    readonly geaendert: boolean;
}

/** Eine Regel im Entwurf: die des Servers oder eine neu angelegte (`neu`, auch die geänderte, die eine alte ersetzt). */
export interface EntwurfRegel {
    /** Eine Regel des Servers trägt ihre `ruleId`; eine neue `neu:<n>`. */
    readonly schluessel: string;
    readonly ruleId: string | undefined;
    readonly relation: InhalteVorkommenBeziehung;
    readonly ursprung: InhalteVorkommenUrsprung;
    readonly state: InhalteVorkommenZustand;
    readonly bedingungen: readonly WikisyncRegelBedingung[];
    /** Der Fingerabdruck der Regel; bei einer neuen nur dort bekannt, wo sie ein Vorschlag des Wikis ist. */
    readonly ruleKey: string | undefined;
    readonly wikiBasis: RegelWikiFassung | undefined;
    readonly wikiJetzt: RegelWikiJetzt | undefined;
    /** Im Entwurf angelegt, noch nicht gespeichert. */
    readonly neu: boolean;
    /** Die Regel des Servers, die diese ablöst (sie wird beim Speichern still gelegt). */
    readonly ersetzt: EntwurfRegel | undefined;
}

export const istRegelAktiv = (regel: Pick<EntwurfRegel, "state">): boolean => regel.state === "active";
export const aktiveRegeln = (regeln: readonly EntwurfRegel[]): readonly EntwurfRegel[] => regeln.filter(istRegelAktiv);

// ---------------------------------------------------------------------------------------------------------------------
// Bedingungen
// ---------------------------------------------------------------------------------------------------------------------

type Verknuepfung = WikisyncRegelBedingung["verknuepfung"];

export const neueBedingung = (verknuepfung: Verknuepfung = "und"): WikisyncRegelBedingung => ({
    verknuepfung,
    flaeche: null,
    arten: [],
    klima: null,
    woerter: [],
    rueckfragen: [],
});

/** Die Lage einer Bedingung als Feld zum Einstreuen: Ohne Lage fehlt das Feld (`exactOptionalPropertyTypes`, und der Vertrag kennt kein `null`). */
function lageKopie(b: Pick<WikisyncRegelBedingung, "lage">): Pick<WikisyncRegelBedingung, "lage"> {
    return b.lage === undefined
        ? {}
        : {
              lage: {
                  richtung: b.lage.richtung,
                  orte: b.lage.orte.map((o) => ({ kennung: o.kennung, name: o.name, x: o.x, y: o.y })),
              },
          };
}

/** Eine Bedingung ohne Wörter und Rückfragen des Wikis, die erste mit UND: so steht sie in einer Regel. Ein halb gefüllter Stand der Lage (`lageEntwurf`) fällt dabei weg. */
function bedingungNormal(b: WikisyncRegelBedingung, index: number): WikisyncRegelBedingung {
    return {
        verknuepfung: index === 0 ? "und" : b.verknuepfung,
        flaeche:
            b.flaeche === null
                ? null
                : {
                      name: b.flaeche.name,
                      kennung: b.flaeche.kennung,
                      offen: b.flaeche.offen,
                      titel: b.flaeche.titel,
                      kandidat: b.flaeche.kandidat,
                  },
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        klima: b.klima === null ? null : { von: b.klima.von, bis: b.klima.bis },
        ...lageKopie(b),
        woerter: [],
        rueckfragen: [],
    };
}
const kettenNormal = (bedingungen: readonly WikisyncRegelBedingung[]): WikisyncRegelBedingung[] =>
    bedingungen.map(bedingungNormal);

/** Eine Bedingung des Servers (Lesemodell) in der Form, die die Sätze und der Editor lesen. Eine Fläche ohne Namen nennt ihre Kennung (die aus Legacy bleibt). */
export function bedingungAusServer(b: InhalteVorkommenBedingung): WikisyncRegelBedingung {
    let flaeche: WikisyncRegelBedingung["flaeche"] = null;
    if (b.wartetAuf !== undefined) {
        // Die Fläche, die es noch nicht gibt (F4): Die Bedingung wartet auf den Artikel und zählt nirgends.
        flaeche = { name: b.wartetAuf, kennung: null, offen: true, titel: b.wartetAuf, kandidat: null };
    } else if (b.flaeche !== undefined) {
        flaeche = {
            name:
                b.flaeche.name ??
                t("inhalte.vorkommen.regel.flaecheOhneName", { kennung: b.flaeche.kennung.slice(0, 8) }),
            kennung: b.flaeche.kennung,
            offen: false,
            titel: null,
            kandidat: null,
        };
    }
    return {
        verknuepfung: b.joinOp,
        flaeche,
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        klima: b.klima === undefined ? null : { von: b.klima.von, bis: b.klima.bis },
        ...lageKopie(b),
        woerter: [],
        rueckfragen: [],
    };
}

/** Eine Bedingung im Körper von `lore.update`: leere Felder fehlen, sie sind nie `null` (Fastifys ajv machte daraus 0 oder ""). Die Lage geht mit den Kennungen der Orte hinaus (`place.public_id`). */
export function koerperBedingung(b: WikisyncRegelBedingung): InhalteVorkommenRegelBedingung {
    const flaeche = b.flaeche;
    const wartet = flaeche !== null && (flaeche.offen || flaeche.kennung === null);
    return {
        verknuepfung: b.verknuepfung,
        arten: b.arten.map((a) => ({ ebene: a.ebene, art: a.art })),
        ...(flaeche !== null && !wartet && flaeche.kennung !== null ? { flaeche: flaeche.kennung } : {}),
        ...(flaeche !== null && wartet ? { wartetAuf: flaeche.titel ?? flaeche.name } : {}),
        ...(b.klima === null ? {} : { klima: { von: b.klima.von, bis: b.klima.bis } }),
        ...(b.lage === undefined
            ? {}
            : { lage: { richtung: b.lage.richtung, orte: b.lage.orte.map((o) => o.kennung.toLowerCase()) } }),
    };
}

/** Die Fläche einer Bedingung im Fingerabdruck: die Kennung, sonst „wiki:“ und der Titel des Artikels, auf den sie wartet (wie `regelSchluessel` des Servers). */
const flaechenSchluessel = (f: WikisyncRegelBedingung["flaeche"]): string =>
    f === null ? "" : f.kennung !== null ? f.kennung.toLowerCase() : `wiki:${(f.titel ?? f.name).toLowerCase()}`;

/**
 * Der Fingerabdruck einer Kette; die Verknüpfung der ersten Bedingung zählt nicht, die Reihenfolge der Bedingungen schon. 🔴 Die Lage kommt als sechstes Feld NUR dazu, wo eine Bedingung eine hat (wie
 * `ruleKeyOf` des Servers): Eine Kette ohne Lage behält ihren Schlüssel Zeichen für Zeichen, sonst fände „gleich“ (`regel_besteht`, der Vergleich mit der Wiki-Fassung) keine gespeicherte Regel wieder.
 */
export const ketteSchluessel = (bedingungen: readonly WikisyncRegelBedingung[]): string =>
    JSON.stringify(
        bedingungen.map((b, i) => [
            i === 0 ? "" : b.verknuepfung,
            flaechenSchluessel(b.flaeche),
            b.klima === null ? "" : b.klima.von,
            b.klima === null ? "" : b.klima.bis,
            b.arten.map((a) => `${a.ebene}/${a.art}`).sort(),
            ...(b.lage === undefined ? [] : [lageSchluessel(b.lage)]),
        ]),
    );

/** Eine Bedingung, die nichts einschränkt (keine Art, keine Fläche, kein Klima, keine Lage): Sie träfe alles. */
export const bedingungLeer = (b: WikisyncRegelBedingung): boolean =>
    b.arten.length === 0 && b.flaeche === null && b.klima === null && b.lage === undefined;

/** Die Regel in einer Zeile („Wald · Aranien UND …“), wie sie die Karte und die Hinweise nennen. */
export const regelSatz = (bedingungen: readonly WikisyncRegelBedingung[]): string =>
    regelKurz({
        beziehung: "verbreitung",
        status: "neu",
        bedingungen: [...bedingungen],
        bisher: null,
        teile: [],
        bisherId: null,
    });

// ---------------------------------------------------------------------------------------------------------------------
// Aus dem Lesemodell
// ---------------------------------------------------------------------------------------------------------------------

export function regelAusServer(regel: InhalteVorkommenRegel): EntwurfRegel {
    return {
        schluessel: regel.ruleId,
        ruleId: regel.ruleId,
        relation: regel.relation,
        ursprung: regel.ursprung,
        state: regel.state,
        bedingungen: regel.bedingungen.map(bedingungAusServer),
        ruleKey: regel.ruleKey,
        wikiBasis:
            regel.wikiBasis === undefined
                ? undefined
                : {
                      schluessel: regel.wikiBasis.schluessel,
                      bedingungen: regel.wikiBasis.bedingungen?.map(bedingungNormal),
                  },
        wikiJetzt:
            regel.wikiJetzt === undefined
                ? undefined
                : {
                      bedingungen: regel.wikiJetzt.bedingungen.map(bedingungNormal),
                      geaendert: regel.wikiJetzt.geaendert,
                  },
        neu: false,
        ersetzt: undefined,
    };
}

let zaehler = 0;
const neuerSchluessel = (): string => {
    zaehler += 1;
    return `neu:${String(zaehler)}`;
};

/** Neu, geändert (eine neue Regel löst eine alte ab) oder unverändert: der Zustand einer Regel gegenüber dem gespeicherten Stand. */
export const regelStatus = (regel: Pick<EntwurfRegel, "neu" | "ersetzt">): "" | "neu" | "geaendert" =>
    !regel.neu ? "" : regel.ersetzt === undefined ? "neu" : "geaendert";

/** Wartet die Regel auf eine Fläche, die es noch nicht gibt? Eine solche Bedingung zählt nirgends. */
export const regelWartet = (regel: Pick<EntwurfRegel, "bedingungen">): boolean =>
    regel.bedingungen.some((b) => b.flaeche?.offen === true);

// ---------------------------------------------------------------------------------------------------------------------
// Die Wiki-Fassung einer Regel
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Die Fassung des Wikis, die eine Regel vertritt: eine Wiki-Regel ist sie selbst, eine Regel von Hand die, auf der sie beruht; eine aus Legacy hat keine. So rechnet auch der Server die Basis einer
 * geänderten Regel („Schlüssel der ersetzten Wiki-Regel, sonst deren Basis“).
 */
function wikiFassungVon(regel: EntwurfRegel | undefined): RegelWikiFassung | undefined {
    if (regel === undefined) return undefined;
    if (regel.ursprung === "wiki") return { schluessel: regel.ruleKey, bedingungen: regel.bedingungen };
    if (regel.ursprung === "manual") return regel.wikiBasis;
    return undefined;
}

/**
 * Was das Wiki seit der Änderung von Hand zur Beziehung sagt. Die Regel des Servers bringt es mit; eine neue Regel im Entwurf liest den jüngsten Vorschlag zur Beziehung (ohne ihn, die Fassung, auf der
 * sie beruht). `undefined`, wo die Regel keine Wiki-Fassung hat.
 */
export function wikiJetzt(
    regel: EntwurfRegel,
    vorschlag: InhalteVorkommenWikiVorschlag | undefined,
): RegelWikiJetzt | undefined {
    if (regel.ursprung !== "manual" || regel.wikiBasis === undefined) return undefined;
    if (regel.wikiJetzt !== undefined) return regel.wikiJetzt;
    const basis = regel.wikiBasis.bedingungen;
    const v = vorschlag?.regeln.find((x) => x.beziehung === regel.relation && x.bedingungen.length > 0);
    if (v === undefined) return basis === undefined ? undefined : { bedingungen: basis, geaendert: false };
    const bedingungen = kettenNormal(v.bedingungen);
    return {
        bedingungen,
        geaendert: basis !== undefined && ketteSchluessel(bedingungen) !== ketteSchluessel(basis),
    };
}

/** Die Kette, die „↺ Wiki-Fassung“ holt: was das Wiki jetzt sagt, wenn es sich geändert hat, sonst die Fassung, auf der die Regel beruht; `undefined`, wo keine bekannt ist. */
export function wikiFassungZumHerstellen(
    regel: EntwurfRegel,
    vorschlag: InhalteVorkommenWikiVorschlag | undefined,
): readonly WikisyncRegelBedingung[] | undefined {
    const jetzt = wikiJetzt(regel, vorschlag);
    if (jetzt === undefined) return undefined;
    return jetzt.geaendert ? jetzt.bedingungen : (regel.wikiBasis?.bedingungen ?? jetzt.bedingungen);
}

// ---------------------------------------------------------------------------------------------------------------------
// Vorschläge des Wikis am Eintrag
// ---------------------------------------------------------------------------------------------------------------------

/** Ein Vorschlag des WikiSync zu einer Beziehung, der noch offen ist (keine Regel hat ihn übernommen oder ersetzt). */
export interface OffenerVorschlag {
    /** Die Stelle in `wikiVorschlag.regeln`. */
    readonly index: number;
    readonly beziehung: InhalteVorkommenBeziehung;
    readonly bedingungen: readonly WikisyncRegelBedingung[];
    readonly teile: InhalteVorkommenWikiVorschlag["regeln"][number]["teile"];
    readonly typ: InhalteVorkommenWikiVorschlag["typ"];
    /** Wie viele Bedingungen die Regel hat, die er ersetzt; 0, wo er nichts ersetzt. */
    readonly ersetzt: number;
}

/**
 * Die Vorschläge des WikiSync zu diesem Eintrag, die als gestrichelte Karten unter den Regeln stehen: die nicht vorgewählten (die vorgewählten übernimmt das Fenster der Regelvorschläge), solange der Eintrag
 * nicht ganz von Hand gepflegt ist (`sperre: manuell`), nur die aktuellen und nur mit Bedingungen. Keiner, dessen Beziehung schon eine Regel von Hand trägt, die auf dem Wiki beruht (sie trägt die neue Fassung
 * als Hinweis), und keiner, dessen Kette schon eine Wiki-Regel ist.
 */
export function offeneVorschlaege(
    vorschlag: InhalteVorkommenWikiVorschlag | undefined,
    regeln: readonly EntwurfRegel[],
): OffenerVorschlag[] {
    if (vorschlag === undefined || vorschlag.vorgewaehlt || vorschlag.sperre === "manuell") return [];
    const aktive = aktiveRegeln(regeln);
    return vorschlag.regeln
        .map((r, index) => ({ r, index }))
        .filter(({ r }) => r.bedingungen.length > 0 && r.aktuell && r.status !== "manuell" && r.status !== "entfaellt")
        .filter(
            ({ r }) =>
                !aktive.some(
                    (x) =>
                        x.relation === r.beziehung &&
                        (x.wikiBasis !== undefined ||
                            (x.ursprung === "wiki" &&
                                ketteSchluessel(x.bedingungen) === ketteSchluessel(r.bedingungen))),
                ),
        )
        .map(({ r, index }) => ({
            index,
            beziehung: r.beziehung,
            bedingungen: kettenNormal(r.bedingungen),
            teile: r.teile,
            typ: vorschlag.typ,
            ersetzt:
                r.status === "geaendert"
                    ? (aktive.find((x) => x.ruleId !== undefined && r.bisherIds.includes(x.ruleId))?.bedingungen
                          .length ?? 0)
                    : 0,
        }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------------------------------------------------

/** Was der Editor zurückgibt: die geöffnete Regel (oder keine, oder ein Vorschlag), die Beziehung und die Kette. */
export interface RegelEingabe {
    /** Die Regel, die der Editor geöffnet hat (`schluessel` im Entwurf); `undefined` bei einer neuen Regel und bei einem Vorschlag. */
    readonly schluessel?: string | undefined;
    /** Der Vorschlag, aus dem der Editor ausging (die Stelle in `wikiVorschlag.regeln`). */
    readonly vorschlag?: number | undefined;
    readonly relation: InhalteVorkommenBeziehung;
    readonly bedingungen: readonly WikisyncRegelBedingung[];
}

/**
 * Das Ergebnis des Editors in die Regeln des Entwurfs:
 * - **Neue Regel:** eine Regel von Hand, hinten angehängt.
 * - **Geänderte Regel:** eine neue Regel an der Stelle der alten, die die alte ablöst; ist die Kette wieder die alte, bleibt die alte (nichts ist geändert). Aus einer Wiki-Regel wird so eine Regel von Hand, die
 *   ihre Wiki-Fassung behält; ist die geänderte Kette selbst eine Fassung des Wikis, bleibt sie eine Wiki-Regel.
 * - **Vorschlag:** unverändert eine Wiki-Regel (sie ersetzt die Regeln, die der Vorschlag nennt), verändert eine Regel von Hand, die auf dem Vorschlag beruht.
 */
export function regelAusEditor(
    regeln: readonly EntwurfRegel[],
    eingabe: RegelEingabe,
    vorschlag: InhalteVorkommenWikiVorschlag | undefined,
): readonly EntwurfRegel[] {
    const bedingungen = kettenNormal(eingabe.bedingungen);
    const kette = ketteSchluessel(bedingungen);
    const index = eingabe.schluessel === undefined ? -1 : regeln.findIndex((r) => r.schluessel === eingabe.schluessel);
    const alt = index >= 0 ? regeln[index] : undefined;

    if (alt !== undefined) {
        if (alt.relation === eingabe.relation && ketteSchluessel(alt.bedingungen) === kette) return regeln;
        const ersetzt = alt.neu ? alt.ersetzt : alt;
        // Wieder die alte Regel: Nichts ist geändert, die gespeicherte Regel kommt zurück.
        if (
            ersetzt !== undefined &&
            ersetzt.relation === eingabe.relation &&
            ketteSchluessel(ersetzt.bedingungen) === kette
        ) {
            return regeln.map((r, i) => (i === index ? ersetzt : r));
        }
        // Eine andere Beziehung ist keine Fassung des Wikis mehr: Die Basis gilt nur für die Beziehung, aus der sie kam.
        const gleicheBeziehung = alt.relation === eingabe.relation;
        const fassung = gleicheBeziehung ? wikiFassungVon(alt) : undefined;
        const jetzt = gleicheBeziehung ? wikiJetzt(alt, vorschlag) : undefined;
        const istWiki = [fassung?.bedingungen, jetzt?.bedingungen].some(
            (k) => k !== undefined && ketteSchluessel(k) === kette,
        );
        const neu: EntwurfRegel = {
            schluessel: neuerSchluessel(),
            ruleId: undefined,
            relation: eingabe.relation,
            ursprung: istWiki ? "wiki" : "manual",
            state: "active",
            bedingungen,
            ruleKey: undefined,
            wikiBasis: istWiki ? undefined : fassung,
            wikiJetzt: istWiki || !gleicheBeziehung ? undefined : alt.wikiJetzt,
            neu: true,
            ersetzt,
        };
        return regeln.map((r, i) => (i === index ? neu : r));
    }

    const v = eingabe.vorschlag === undefined ? undefined : vorschlag?.regeln[eingabe.vorschlag];
    if (v !== undefined) {
        const ersetzte = regeln.filter(
            (r) => r.ruleId !== undefined && !r.neu && istRegelAktiv(r) && v.bisherIds.includes(r.ruleId),
        );
        const ersetzt = ersetzte[0];
        const unveraendert = eingabe.relation === v.beziehung && kette === ketteSchluessel(kettenNormal(v.bedingungen));
        const fassung = wikiFassungVon(ersetzt) ?? {
            schluessel: v.schluessel ?? undefined,
            bedingungen: kettenNormal(v.bedingungen),
        };
        const neu: EntwurfRegel = {
            schluessel: neuerSchluessel(),
            ruleId: undefined,
            relation: eingabe.relation,
            ursprung: unveraendert ? "wiki" : "manual",
            state: "active",
            bedingungen,
            ruleKey: unveraendert ? (v.schluessel ?? undefined) : undefined,
            wikiBasis: unveraendert ? undefined : fassung,
            wikiJetzt: undefined,
            neu: true,
            ersetzt,
        };
        const weg = new Set(ersetzte.slice(1).map((r) => r.schluessel));
        const stelle = ersetzt === undefined ? -1 : regeln.findIndex((r) => r.schluessel === ersetzt.schluessel);
        const rest = regeln.filter((r) => !weg.has(r.schluessel));
        if (stelle < 0) return [...rest, neu];
        return rest.map((r) => (r.schluessel === ersetzt?.schluessel ? neu : r));
    }

    const neu: EntwurfRegel = {
        schluessel: neuerSchluessel(),
        ruleId: undefined,
        relation: eingabe.relation,
        ursprung: "manual",
        state: "active",
        bedingungen,
        ruleKey: undefined,
        wikiBasis: undefined,
        wikiJetzt: undefined,
        neu: true,
        ersetzt: undefined,
    };
    return [...regeln, neu];
}

/** „Übernehmen“ an einem Vorschlag: die Wiki-Regel, unverändert. */
export function uebernimmVorschlag(
    regeln: readonly EntwurfRegel[],
    vorschlag: InhalteVorkommenWikiVorschlag | undefined,
    index: number,
): readonly EntwurfRegel[] {
    const v = vorschlag?.regeln[index];
    if (v === undefined) return regeln;
    return regelAusEditor(regeln, { vorschlag: index, relation: v.beziehung, bedingungen: v.bedingungen }, vorschlag);
}

/**
 * Eine Regel löschen. Eine neue verschwindet; eine des Servers geht beim Speichern als `remove` hinaus (eine aus Legacy oder dem Wiki wird unterdrückt, eine eigene gelöst: Das entscheidet der Server).
 * Löscht man eine Regel, die eine alte ablöst, ist auch die alte weg.
 */
export function loescheRegel(regeln: readonly EntwurfRegel[], schluessel: string): readonly EntwurfRegel[] {
    if (!regeln.some((r) => r.schluessel === schluessel)) return regeln;
    return regeln.filter((r) => r.schluessel !== schluessel);
}

/**
 * „↺ Wiki-Fassung“: Die Regel von Hand weicht der Fassung, die das Wiki JETZT zur Beziehung sagt, sonst der, auf der sie beruht; danach führt der Abgleich sie wieder. Ist das die gespeicherte Wiki-Regel selbst,
 * kommt sie zurück.
 */
export function stelleWikiHer(
    regeln: readonly EntwurfRegel[],
    schluessel: string,
    vorschlag: InhalteVorkommenWikiVorschlag | undefined,
): readonly EntwurfRegel[] {
    const index = regeln.findIndex((r) => r.schluessel === schluessel);
    const alt = regeln[index];
    if (alt === undefined) return regeln;
    const fassung = wikiFassungZumHerstellen(alt, vorschlag);
    if (fassung === undefined) return regeln;
    const bedingungen = kettenNormal(fassung);
    const ersetzt = alt.neu ? alt.ersetzt : alt;
    if (
        ersetzt !== undefined &&
        ersetzt.ursprung === "wiki" &&
        ersetzt.relation === alt.relation &&
        ketteSchluessel(ersetzt.bedingungen) === ketteSchluessel(bedingungen)
    ) {
        return regeln.map((r, i) => (i === index ? ersetzt : r));
    }
    const neu: EntwurfRegel = {
        schluessel: neuerSchluessel(),
        ruleId: undefined,
        relation: alt.relation,
        ursprung: "wiki",
        state: "active",
        bedingungen,
        ruleKey: undefined,
        wikiBasis: undefined,
        wikiJetzt: undefined,
        neu: true,
        ersetzt,
    };
    return regeln.map((r, i) => (i === index ? neu : r));
}

// ---------------------------------------------------------------------------------------------------------------------
// Prüfen, bevor die Regel in den Entwurf kommt
// ---------------------------------------------------------------------------------------------------------------------

/** Warum „Regel übernehmen“ gerade nicht geht. */
export type RegelSperre =
    | { readonly art: "lage"; readonly n: number }
    | { readonly art: "leer"; readonly n: number; readonly nurEine: boolean }
    | { readonly art: "doppelt" };

/**
 * Warum die Regel nicht in den Entwurf kann, oder `undefined`: eine Lage, der Richtung oder Ort fehlt (sie ginge nicht in die Regel, die Bedingung sagte etwas anderes, als der Satz zeigt), eine Bedingung, die nichts
 * einschränkt (die Regel träfe alles), oder eine Regel, die es in der Beziehung schon gibt (derselbe Fingerabdruck, der Server lehnte sie mit `regel_besteht` ab). Die geöffnete Regel selbst und die, die sie
 * ersetzt, zählen dabei nicht.
 */
export function regelSperre(
    eingabe: {
        readonly schluessel?: string | undefined;
        readonly relation: InhalteVorkommenBeziehung;
        readonly bedingungen: readonly EditorBedingung[];
    },
    regeln: readonly EntwurfRegel[],
): RegelSperre | undefined {
    const halb = eingabe.bedingungen.findIndex(bedingungLageHalb);
    if (halb >= 0) return { art: "lage", n: halb + 1 };
    const leer = eingabe.bedingungen.findIndex(bedingungLeer);
    if (leer >= 0) return { art: "leer", n: leer + 1, nurEine: eingabe.bedingungen.length === 1 };
    const kette = ketteSchluessel(kettenNormal(eingabe.bedingungen));
    const offen =
        eingabe.schluessel === undefined ? undefined : regeln.find((r) => r.schluessel === eingabe.schluessel);
    const eigene = new Set([offen?.schluessel, offen?.ersetzt?.schluessel].filter((s): s is string => s !== undefined));
    const doppelt = aktiveRegeln(regeln).some(
        (r) => !eigene.has(r.schluessel) && r.relation === eingabe.relation && ketteSchluessel(r.bedingungen) === kette,
    );
    return doppelt ? { art: "doppelt" } : undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Der Körper
// ---------------------------------------------------------------------------------------------------------------------

const FINGERABDRUCK = /^[0-9a-f]{64}$/u;

/**
 * Die Änderungen der Regeln gegen den Stand des Servers, in der Folge „erst weg, dann neu“: Was der Entwurf nicht mehr trägt und keine neue Regel ablöst, geht als `remove`; jede neue Regel als `add`, mit
 * der Regel, die sie ablöst. Eine Wiki-Fassung ohne ersetzte Regel (ein bearbeiteter Vorschlag) nennt ihren Fingerabdruck als Basis; wo eine Regel ersetzt wird, rechnet der Server die Basis aus ihr.
 */
export function regelAenderungen(
    start: readonly EntwurfRegel[],
    jetzt: readonly EntwurfRegel[],
): InhalteVorkommenRegelAenderung[] {
    const neue = jetzt.filter((r) => r.neu && istRegelAktiv(r));
    const abgeloest = new Set(neue.map((r) => r.ersetzt?.ruleId).filter((id): id is string => id !== undefined));
    const aenderungen: InhalteVorkommenRegelAenderung[] = [];
    for (const vor of start) {
        if (!istRegelAktiv(vor) || vor.ruleId === undefined) continue;
        const da = jetzt.some((r) => !r.neu && r.ruleId === vor.ruleId && istRegelAktiv(r));
        if (da || abgeloest.has(vor.ruleId)) continue;
        aenderungen.push({ op: "remove", ruleId: vor.ruleId });
    }
    for (const r of neue) {
        // Die Wiki-Fassung, von der die Regel ausging, geht immer mit (auch beim Ersetzen): Der Server nimmt sie vor der ersetzten Regel.
        const basis = r.wikiBasis?.schluessel;
        aenderungen.push({
            op: "add",
            relation: r.relation,
            bedingungen: r.bedingungen.map(koerperBedingung),
            ...(r.ersetzt?.ruleId === undefined ? {} : { ersetzt: r.ersetzt.ruleId }),
            ...(basis !== undefined && FINGERABDRUCK.test(basis) ? { wikiBasis: basis } : {}),
        });
    }
    return aenderungen;
}

/** Der Schlüssel einer Regeländerung für die Überschneidung bei einem Konflikt: die Regel des Servers, die sie trifft, oder die neue Regel in ihrer Beziehung. */
export function regelAenderungSchluessel(aenderung: InhalteVorkommenRegelAenderung): string {
    if (aenderung.op === "remove") return `regel:${aenderung.ruleId}`;
    if (aenderung.ersetzt !== undefined) return `regel:${aenderung.ersetzt}`;
    return `regel:neu:${aenderung.relation}:${JSON.stringify(aenderung.bedingungen)}`;
}

/**
 * Die eigenen Änderungen der Regeln (`start` → `eigen`) auf den fremden Stand legen (Konflikt 409, „eigene Änderung anwenden“): Was der Entwurf gelöscht hat, wird auch dort gelöscht; eine neue Regel ersetzt dort
 * dieselbe alte, oder hängt an, wo es sie nicht mehr gibt; eine Regel, die es dort in der Beziehung schon gibt, kommt nicht noch einmal.
 */
export function uebertrageRegeln(
    fremd: readonly EntwurfRegel[],
    start: readonly EntwurfRegel[],
    eigen: readonly EntwurfRegel[],
): readonly EntwurfRegel[] {
    const neue = eigen.filter((r) => r.neu && istRegelAktiv(r));
    const abgeloest = new Set(neue.map((r) => r.ersetzt?.ruleId).filter((id): id is string => id !== undefined));
    let liste = [...fremd];
    for (const vor of start) {
        if (!istRegelAktiv(vor) || vor.ruleId === undefined) continue;
        const da = eigen.some((r) => !r.neu && r.ruleId === vor.ruleId && istRegelAktiv(r));
        if (da || abgeloest.has(vor.ruleId)) continue;
        liste = liste.filter((r) => r.neu || r.ruleId !== vor.ruleId);
    }
    for (const r of neue) {
        const stelle =
            r.ersetzt?.ruleId === undefined
                ? -1
                : liste.findIndex((x) => !x.neu && x.ruleId === r.ersetzt?.ruleId && istRegelAktiv(x));
        const ersetzt = stelle >= 0 ? liste[stelle] : undefined;
        if (stelle >= 0) {
            liste[stelle] = { ...r, ersetzt };
            continue;
        }
        const kette = ketteSchluessel(r.bedingungen);
        if (
            liste.some((x) => istRegelAktiv(x) && x.relation === r.relation && ketteSchluessel(x.bedingungen) === kette)
        )
            continue;
        liste.push({ ...r, schluessel: neuerSchluessel(), ersetzt: undefined });
    }
    return liste;
}
