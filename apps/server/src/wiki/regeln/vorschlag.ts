import type { WikisyncRegelGrund, WikisyncRegelStatus, WikisyncRegelTyp } from "@avesmaps3d/shared";
import { relationenDerArt } from "../abgleich/vorkommen.ts";
import type { VorkommenBeziehung } from "../infobox/vorkommen.ts";
import { Begriffstafel } from "./begriffe.ts";
import {
    leiteAb,
    regelSchluessel,
    type Ableitung,
    type Bed,
    type EintragEingabe,
    type OriginalFeld,
    type Teil,
} from "./ableiten.ts";
import { ortsSchluessel, type SiedlungsKatalog } from "./lage.ts";
import type { Flaeche, RegelWissen } from "./lesen.ts";

/**
 * Der Vorschlag zu einem Vorkommen (WI-0253 Scheibe Regelvorschläge, §24): die Ableitung (`ableiten.ts`) gegen die Regeln, die der Eintrag heute hat. REIN.
 *
 * Je Beziehung (Ortsfeld) eine Aussage: `neu` (es gibt noch keine vom Wiki abgeleitete Regel), `geaendert` (es gibt eine, die Kette ist eine andere), `entfaellt` (es gibt eine, das Wiki sagt dazu nichts
 * Abbildbares mehr), `manuell` (die Redaktion hat eine Regel gesetzt oder ihre Herkunft ist unbekannt: sie bleibt, wie sie ist). Eine Regel, die gleich bleibt, ist keine Zeile. Eine Regel, die nur Flächen
 * nennt, deren Wiki-Schlüssel die Ortszeilen schon sagen, sagt nichts Neues und wird nicht vorgeschlagen (Legacy: „neu“ heißt, sie trägt eine Art, eine Klimaspanne, ein `ohne` oder eine Fläche, die
 * die Ortszeile nicht erreicht).
 */

export interface BestehendeRegel {
    /** `lore_rule.id`. */
    id: string;
    beziehung: string;
    ruleKey: string;
    herkunft: "manual" | "wiki_verbreitung" | "unknown";
    bedingungen: readonly Bed[];
}

/** Was ein Eintrag an Regeln hat (aktive; stillgelegte kennt die Ableitung nicht). */
export interface RegelBestand {
    /** `lore_entry.wiki_key`: Teil des Fingerabdrucks einer Regel. */
    wikiKey: string;
    regeln: readonly BestehendeRegel[];
}

export interface VorschlagBeziehung {
    beziehung: VorkommenBeziehung;
    status: WikisyncRegelStatus;
    bedingungen: Bed[];
    bisher: Bed[] | null;
    teile: Teil[];
    /** `lore_rule.id` der bisherigen, vom Wiki abgeleiteten Regel(n); leer, wo es keine gibt. */
    bisherIds: string[];
    /** Die Fingerabdrücke der bisherigen Regeln: Daran erkennt die Übernahme, dass sich der Stand seit der Vorschau nicht bewegt hat. */
    bisherSchluessel: string[];
    /** Der Fingerabdruck der vorgeschlagenen Regel; `null`, wo nichts vorgeschlagen wird (`entfaellt`, `manuell` ohne Ableitung). */
    schluessel: string | null;
}

export interface VorschlagDaten {
    eintragId: string;
    name: string;
    art: string;
    artikel: string | null;
    typ: WikisyncRegelTyp;
    status: WikisyncRegelStatus;
    wartet: boolean;
    vorgewaehlt: boolean;
    waehlbar: boolean;
    sperre: string | null;
    original: OriginalFeld[];
    regeln: VorschlagBeziehung[];
    suchtext: string;
}

/** Die Zahlen des Laufs (Einträge je Status der Bewertung und Vorschläge). */
export interface RegelZahlen {
    mitAussage: number;
    vollstaendig: number;
    teilweise: number;
    garNicht: number;
    nurLebensraum: number;
    ohneAussage: number;
    vorgeschlagen: number;
    gleich: number;
    wartend: number;
}

const leereZahlen = (): RegelZahlen => ({
    mitAussage: 0,
    vollstaendig: 0,
    teilweise: 0,
    garNicht: 0,
    nurLebensraum: 0,
    ohneAussage: 0,
    vorgeschlagen: 0,
    gleich: 0,
    wartend: 0,
});

/** Der Katalog der Flächen der Karte, aus dem die Regelwelt ihr Wissen baut. */
export interface FlaechenKatalog {
    /** Flächen nach dem (kleingeschriebenen) Titel ihres Wiki-Artikels. */
    nachTitel: ReadonlyMap<string, readonly Flaeche[]>;
    /** Flächen nach ihrem (kleingeschriebenen) Namen: nur um einen Namen im Text zu erkennen und eine Fläche als Kandidaten zu nennen. */
    nachName: ReadonlyMap<string, readonly Flaeche[]>;
}

/** Was die Vorschau für die Regelvorschläge braucht. */
export interface RegelKontext {
    flaechen: FlaechenKatalog;
    tafel: Begriffstafel;
    /** Die Revision der Begriffstafel, nach der gerechnet wird; `null`: nach den Startwerten. */
    begriffeRevision: number | null;
    /** Die aktiven Siedlungen der Karte nach ihrem Namen (`ortsSchluessel`) für die Lage zu einer Linie; fehlt sie, liest die Ableitung keine Lage (WI-0254). */
    siedlungen?: SiedlungsKatalog;
}

/** Die Sicht der Regeln auf die Welt: Linkziele aus dem Dump, Flächen aus der Karte, Begriffe aus der Tafel. */
export function baueRegelWissen(
    basis: { info: RegelWissen["info"] },
    aufgeloest: (titel: string) => string,
    kontext: RegelKontext,
): RegelWissen {
    return {
        info: basis.info,
        istFlaeche: (titel) => (kontext.flaechen.nachTitel.get(titel.toLowerCase())?.length ?? 0) > 0,
        flaechen: (titel) => kontext.flaechen.nachTitel.get(aufgeloest(titel).toLowerCase()) ?? [],
        flaechenNamen: () => kontext.flaechen.nachName,
        tafel: kontext.tafel,
        ...(kontext.siedlungen === undefined
            ? {}
            : { siedlungen: (name: string) => kontext.siedlungen?.get(ortsSchluessel(name)) ?? [] }),
    };
}

/** Sagt die Kette etwas, das die Ortszeilen nicht schon sagen? Eine Lage zu einer Linie sagt es immer (die Ortszeilen kennen keine Richtung). */
export const sagtNeues = (kette: readonly Bed[]): boolean =>
    kette.some(
        (b) =>
            b.arten.length > 0 ||
            b.klima !== null ||
            b.verknuepfung === "ohne" ||
            b.flaeche?.offen === true ||
            b.lage !== undefined,
    );

const NEGATION: ReadonlySet<WikisyncRegelGrund> = new Set(["verneinung", "nach_verneinung"]);

function satzText(kette: readonly Bed[]): string {
    return kette
        .map((b) =>
            [
                b.flaeche?.name ?? "",
                b.flaeche?.titel ?? "",
                ...b.arten.map((a) => a.art),
                ...b.woerter,
                ...(b.lage?.orte.map((ort) => ort.name) ?? []),
            ].join(" "),
        )
        .join(" ");
}

/**
 * Der Vorschlag zu einem Eintrag, oder `null`, wo es nichts zu sagen gibt.
 *
 * @param artikel der Titel des Wiki-Artikels (für die Anzeige)
 */
export function baueVorschlag(
    ableitung: Ableitung,
    eintrag: { id: string; name: string; art: string; redaktion: boolean; bestand: RegelBestand },
    artikel: string | null,
): VorschlagDaten | null {
    const beziehungen: VorschlagBeziehung[] = [];
    const bestand = eintrag.bestand;
    const relationen = new Set<VorkommenBeziehung>([
        ...relationenDerArt(eintrag.art),
        ...bestand.regeln
            .map((regel) => regel.beziehung)
            .filter((b): b is VorkommenBeziehung => ["verbreitung", "herkunft", "regionen", "vorkommen"].includes(b)),
    ]);
    for (const beziehung of relationen) {
        const abgeleitet = ableitung.beziehungen.find((x) => x.beziehung === beziehung);
        const teile = abgeleitet?.teile ?? [];
        const kette = abgeleitet !== undefined && sagtNeues(abgeleitet.bedingungen) ? abgeleitet.bedingungen : [];
        const vorhanden = bestand.regeln.filter((regel) => regel.beziehung === beziehung);
        const fremd = vorhanden.filter((regel) => regel.herkunft !== "wiki_verbreitung");
        const wiki = vorhanden.filter((regel) => regel.herkunft === "wiki_verbreitung");
        const schluessel = kette.length > 0 ? regelSchluessel(bestand.wikiKey, beziehung, kette) : null;
        if (fremd.length > 0) {
            // Eine Regel der Redaktion (oder mit unbekannter Herkunft) überschreibt, löscht und ersetzt WikiSync nie.
            if (kette.length === 0 || fremd.some((regel) => regel.ruleKey === schluessel)) continue;
            beziehungen.push({
                beziehung,
                status: "manuell",
                bedingungen: kette,
                bisher: [...(fremd[0] as BestehendeRegel).bedingungen],
                teile,
                bisherIds: fremd.map((regel) => regel.id),
                bisherSchluessel: fremd.map((regel) => regel.ruleKey),
                schluessel,
            });
            continue;
        }
        if (wiki.length === 0) {
            if (kette.length === 0) {
                if (teile.length > 0) {
                    beziehungen.push({
                        beziehung,
                        status: "neu",
                        bedingungen: [],
                        bisher: null,
                        teile,
                        bisherIds: [],
                        bisherSchluessel: [],
                        schluessel: null,
                    });
                }
                continue;
            }
            beziehungen.push({
                beziehung,
                status: "neu",
                bedingungen: kette,
                bisher: null,
                teile,
                bisherIds: [],
                bisherSchluessel: [],
                schluessel,
            });
            continue;
        }
        const ids = wiki.map((regel) => regel.id);
        const schluessel0 = wiki.map((regel) => regel.ruleKey);
        if (kette.length === 0) {
            beziehungen.push({
                beziehung,
                status: "entfaellt",
                bedingungen: [],
                bisher: [...(wiki[0] as BestehendeRegel).bedingungen],
                teile,
                bisherIds: ids,
                bisherSchluessel: schluessel0,
                schluessel: null,
            });
            continue;
        }
        if (wiki.length === 1 && (wiki[0] as BestehendeRegel).ruleKey === schluessel) continue;
        beziehungen.push({
            beziehung,
            status: "geaendert",
            bedingungen: kette,
            bisher: [...(wiki[0] as BestehendeRegel).bedingungen],
            teile,
            bisherIds: ids,
            bisherSchluessel: schluessel0,
            schluessel,
        });
    }
    if (beziehungen.length === 0) return null;

    const aenderungen = beziehungen.filter((b) => b.status !== "manuell");
    const alleBedingungen = beziehungen.flatMap((b) => (b.status === "manuell" ? [] : b.bedingungen));
    const alleTeile = beziehungen.flatMap((b) => b.teile);
    const wartet = alleBedingungen.some((b) => b.flaeche?.offen === true);
    const negiert =
        alleBedingungen.some((b) => b.verknuepfung === "ohne") || alleTeile.some((t) => NEGATION.has(t.grund));
    const mehrdeutig = alleTeile.some((t) => t.grund === "wort_offen");
    const unvollstaendig = alleTeile.some((t) => t.art === "nicht_abbildbar");
    const rueckfragen = alleBedingungen.some((b) => b.rueckfragen.length > 0);
    const typ: WikisyncRegelTyp =
        aenderungen.length === 0
            ? "manuell"
            : wartet
              ? "wartet"
              : negiert
                ? "negiert"
                : mehrdeutig
                  ? "mehrdeutig"
                  : unvollstaendig
                    ? "unvollstaendig"
                    : rueckfragen
                      ? "rueckfrage"
                      : "vollstaendig";
    const status: WikisyncRegelStatus = aenderungen.some((b) => b.status === "geaendert")
        ? "geaendert"
        : aenderungen.some((b) => b.status === "neu")
          ? "neu"
          : aenderungen.some((b) => b.status === "entfaellt")
            ? "entfaellt"
            : "manuell";
    // Wählbar ist, was etwas schreiben würde: ein Eintrag der Redaktion gehört ihr samt seinen Regeln; ohne Bedingung und ohne bisherige Regel gibt es nichts zu übernehmen.
    const schreibt = aenderungen.some(
        (b) => b.status === "entfaellt" || (b.status !== "manuell" && b.bedingungen.length > 0),
    );
    let sperre: string | null = null;
    if (eintrag.redaktion) sperre = "redaktion";
    else if (aenderungen.length === 0) sperre = "manuell";
    else if (!schreibt) sperre = "nichts";
    const waehlbar = sperre === null;
    const vorgewaehlt = waehlbar && typ === "vollstaendig" && aenderungen.every((b) => b.status !== "entfaellt");
    return {
        eintragId: eintrag.id,
        name: eintrag.name,
        art: eintrag.art,
        artikel,
        typ,
        status,
        wartet,
        vorgewaehlt,
        waehlbar,
        sperre,
        original: ableitung.original,
        regeln: beziehungen,
        suchtext: [
            eintrag.name,
            artikel ?? "",
            ...beziehungen.map((b) => satzText(b.bedingungen)),
            ...alleTeile.map((t) => t.text),
        ]
            .join(" ")
            .toLowerCase(),
    };
}

/** Sammelt die Vorschläge eines Laufs und zählt dabei (die Vorschau reicht jeden Eintrag hinein). */
export class RegelSammler {
    readonly vorschlaege: VorschlagDaten[] = [];
    readonly woerter = new Map<string, { n: number; tafel: boolean }>();
    readonly zahlen: RegelZahlen = leereZahlen();

    /** Leitet einen Eintrag ab und merkt sich Vorschlag, Wörter und Zahlen. */
    fuegeHinzu(
        eingabe: EintragEingabe,
        wissen: RegelWissen,
        eintrag: { id: string; name: string; art: string; redaktion: boolean; bestand: RegelBestand },
        artikel: string | null,
    ): void {
        const ableitung = leiteAb(eingabe, wissen);
        const status = ableitung.bewertung.status;
        const z = this.zahlen;
        if (status === "voll") z.vollstaendig += 1;
        else if (status === "teilweise") z.teilweise += 1;
        else if (status === "keine") z.garNicht += 1;
        else if (status === "nur_lebensraum") z.nurLebensraum += 1;
        else z.ohneAussage += 1;
        if (status === "voll" || status === "teilweise" || status === "keine" || status === "nur_lebensraum")
            z.mitAussage += 1;
        for (const [wort, eintragWort] of ableitung.woerter) {
            const bisher = this.woerter.get(wort);
            this.woerter.set(wort, {
                n: (bisher?.n ?? 0) + eintragWort.n,
                tafel: eintragWort.tafel || bisher?.tafel === true,
            });
        }
        const vorschlag = baueVorschlag(ableitung, eintrag, artikel);
        if (vorschlag === null) {
            if (status === "voll" || status === "teilweise") z.gleich += 1;
            return;
        }
        z.vorgeschlagen += 1;
        if (vorschlag.wartet) z.wartend += 1;
        this.vorschlaege.push(vorschlag);
    }
}
