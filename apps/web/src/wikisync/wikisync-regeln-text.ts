import {
    WIKISYNC_LANDSCHAFTSARTEN,
    WIKISYNC_KLIMAZONEN,
    wikisyncPilleZerlegt,
    type WikisyncBegriff,
    type WikisyncBegriffLage,
    type WikisyncRegelBedingung,
    type WikisyncRegelBeziehung,
    type WikisyncRegelLage,
    type WikisyncRegelOffeneFlaeche,
    type WikisyncRegelTyp,
    type WikisyncRegelVorschlag,
} from "@avesmaps3d/shared";
import { isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { zahl } from "./wikisync-text";

/**
 * Die Sätze der Fenster „Regelvorschläge“ und „Begriffstafel“ (WI-0253 §24), ohne Vue: wie ein Vorschlag, seine Bedingungen und die Pillen der Begriffstafel in Worten stehen.
 * Die Wörter stammen aus dem Mockup (`review/wi-0253/wikisync-mockup.html`: die vier Ebenen eines Vorkommens) und aus dem Regelbuch; nichts davon rechnet, die Ableitung steht auf dem Server.
 */

// ── Namen ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const regelArtName = (art: string): string => {
    const key = `admin.wikisync.regeln.art.${art}`;
    return isMessageKey(key) ? t(key as MessageKey) : art;
};

export const typName = (typ: WikisyncRegelTyp): string => t(`admin.wikisync.regeln.typ.${typ}`);
export const regelStatusName = (status: string): string => {
    const key = `admin.wikisync.regeln.status.${status}`;
    return isMessageKey(key) ? t(key as MessageKey) : status;
};
export const beziehungName = (beziehung: string): string => {
    const key = `admin.wikisync.beziehung.${beziehung}`;
    return isMessageKey(key) ? t(key as MessageKey) : beziehung;
};

/** Der Ton der Pille zur Art des Vorschlags: vollständig grün; was eine Frage oder eine Lücke hat gelb; eine Verneinung rot; die Regel der Redaktion lokal. */
export const TYP_TON: Readonly<Record<WikisyncRegelTyp, "neutral" | "erfolg" | "warnung" | "gefahr" | "lokal">> = {
    vollstaendig: "erfolg",
    rueckfrage: "warnung",
    unvollstaendig: "warnung",
    mehrdeutig: "warnung",
    negiert: "gefahr",
    wartet: "neutral",
    manuell: "lokal",
};

/** Der Grund eines Teils oder einer Rückfrage in Worten; ein unbekanntes Wort bleibt, wie es ist. */
export function grundName(code: string): string {
    const key = `admin.wikisync.regeln.grund.${code}`;
    return isMessageKey(key) ? t(key as MessageKey) : code;
}

/** Der Name einer Landschaftsart in der Sprache der Seite (`landscape.type.<art>`). */
export function landschaftName(art: string): string {
    const key = `landscape.type.${art}`;
    return isMessageKey(key) ? t(key as MessageKey) : art;
}

export function zoneName(zone: string): string {
    const key = `climate.zone.${zone}`;
    return isMessageKey(key) ? t(key as MessageKey) : zone;
}

export function ebeneName(ebene: string): string {
    const key = `layer.${ebene}`;
    return isMessageKey(key) ? t(key as MessageKey) : ebene;
}

/** Der Name einer Pille: „Wald“ oder „Tropische Zone“. */
export function pilleName(pille: string): string {
    const z = wikisyncPilleZerlegt(pille);
    if (z === null) return pille;
    return z.art === "zone" ? zoneName(z.wert) : landschaftName(z.wert);
}

/** Wozu die Pille gehört: die Ebene („Vegetation“) oder „Klima“. */
export function pilleGruppe(pille: string): string {
    const z = wikisyncPilleZerlegt(pille);
    if (z === null) return "";
    return z.art === "zone" ? t("admin.wikisync.begriffe.klima") : ebeneName(z.ebene);
}

/**
 * Die Gruppen der Auswahl, in der Reihenfolge, in der sie stehen: die drei Ebenen unserer Landschaftsarten (Vegetation, Topographie, Regionen) und die Klimazonen. Die Namen kommen aus den Sprachtafeln
 * (`layer.<ebene>`); `klima` ist keine Ebene der Landschaft, hat aber dieselbe Tafel (`layer.klima`: „Klimazonen“).
 */
export const PILLEN_EBENEN = ["vegetation", "topographie", "derographisch", "klima"] as const;
export type PilleEbene = (typeof PILLEN_EBENEN)[number];

/** Alle Pillen, die es gibt (unsere Landschaftsarten und Klimazonen), mit Namen, Gruppe und Ebene, für die Auswahl mit Vorschlägen. */
export interface PilleOption {
    pille: string;
    name: string;
    /** Wozu die Pille gehört, wie die Hinweise der Pillen es sagen („Vegetation“, „Klima“). */
    gruppe: string;
    /** Unter welcher Überschrift die Auswahl sie zeigt. */
    ebene: PilleEbene;
}

export function alleVonPillen(): PilleOption[] {
    const arten = WIKISYNC_LANDSCHAFTSARTEN.map((eintrag) => {
        const pille = `${eintrag.ebene}|${eintrag.art}`;
        return { pille, name: pilleName(pille), gruppe: pilleGruppe(pille), ebene: eintrag.ebene };
    });
    const zonen = WIKISYNC_KLIMAZONEN.map((zone) => {
        const pille = `zone|${zone}`;
        return { pille, name: pilleName(pille), gruppe: pilleGruppe(pille), ebene: "klima" as const };
    });
    return [...arten, ...zonen];
}

/** Die Gruppe der Auswahl: ihre Überschrift und die Pillen darunter. */
export interface PilleGruppe {
    ebene: PilleEbene;
    name: string;
    optionen: PilleOption[];
}

/**
 * Die Auswahl, nach Gruppen geordnet (Vali 2026-10-27: Ohne Suchtext zeigte sie nur die ersten vierzehn, also nur Vegetation). Ohne Text steht JEDE noch freie Pille da, in der Reihenfolge der Tafel.
 * Mit Text stehen in jeder Gruppe die Namen, die damit anfangen, vor den Namen, die es enthalten; die Gruppe zählt mit („vegetation“ findet alle Arten der Vegetation, „klima“ die Zonen). Schon
 * vergebene Pillen fehlen, eine Gruppe ohne Treffer ebenso. Groß- und Kleinschreibung gelten nicht.
 */
export function pillenGruppen(text: string, vergeben: readonly string[], alle: readonly PilleOption[]): PilleGruppe[] {
    const gesucht = text.trim().toLocaleLowerCase();
    const frei = alle.filter((option) => !vergeben.includes(option.pille));
    const gruppen: PilleGruppe[] = [];
    for (const ebene of PILLEN_EBENEN) {
        const name = ebeneName(ebene);
        const dieser = frei.filter((option) => option.ebene === ebene);
        let optionen = dieser;
        if (gesucht !== "") {
            const anfang: PilleOption[] = [];
            const enthalten: PilleOption[] = [];
            for (const option of dieser) {
                const optionName = option.name.toLocaleLowerCase();
                if (optionName.startsWith(gesucht)) anfang.push(option);
                else if (
                    optionName.includes(gesucht) ||
                    option.gruppe.toLocaleLowerCase().includes(gesucht) ||
                    name.toLocaleLowerCase().includes(gesucht)
                )
                    enthalten.push(option);
            }
            optionen = [...anfang, ...enthalten];
        }
        if (optionen.length > 0) gruppen.push({ ebene, name, optionen });
    }
    return gruppen;
}

/** Die Vorschläge für ein getipptes Stück in der Reihenfolge, in der die Gruppen sie zeigen (für die Tastatur: Pfeile laufen über die Gruppen hinweg). */
export function pillenVorschlaege(
    text: string,
    vergeben: readonly string[],
    alle: readonly PilleOption[],
): PilleOption[] {
    return pillenGruppen(text, vergeben, alle).flatMap((gruppe) => gruppe.optionen);
}

// ── Bedingungen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const verknuepfungName = (verknuepfung: string): string => {
    const key = `admin.wikisync.regeln.verknuepfung.${verknuepfung}`;
    return isMessageKey(key) ? t(key as MessageKey) : verknuepfung;
};

/** Der Name einer Richtung der Lage in der Sprache der Seite („nördlich“); ein unbekanntes Wort bleibt, wie es ist. */
export function richtungName(richtung: string): string {
    const key = `admin.wikisync.regeln.richtung.${richtung}`;
    return isMessageKey(key) ? t(key as MessageKey) : richtung;
}

/** Die Lage mit zwei Platzhaltern für die Orte: Wo sie im Satz stehen, entscheidet die Sprache (`lageVon`, `lageLinie`), nicht der Aufrufer. */
function lageMit(lage: WikisyncRegelLage, a: string, b: string): string {
    const richtung = richtungName(lage.richtung);
    return lage.orte.length === 1
        ? t("admin.wikisync.regeln.lageVon", { richtung, a })
        : t("admin.wikisync.regeln.lageLinie", { richtung, a, b });
}

/** Die Lage in Worten: „südlich von Festum“, „südlich der Linie Havena–Perricum“. */
export const lageText = (lage: WikisyncRegelLage): string =>
    lageMit(lage, lage.orte[0]?.name ?? "", lage.orte[1]?.name ?? "");

/** Ein Stück der Lage im Satz: die Wörter der Sprache oder der Name eines Ortes (den der Satz fett setzt). */
export interface LageTeil {
    text: string;
    ort: boolean;
}

/** Zeichen aus dem privaten Bereich von Unicode, die den Ort im fertigen Satz der Sprache markieren; sie kommen in keinem Text vor. */
const ORT_A = "\uE000";
const ORT_B = "\uE001";

/** Die Lage in Stücken, damit die Vorlage die Namen der Orte fett setzen kann (kein HTML im Text). */
export function lageTeile(lage: WikisyncRegelLage): LageTeil[] {
    return lageMit(lage, ORT_A, ORT_B)
        .split(/([\uE000\uE001])/u)
        .filter((stueck) => stueck !== "")
        .map((stueck) =>
            stueck === ORT_A
                ? { text: lage.orte[0]?.name ?? "", ort: true }
                : stueck === ORT_B
                  ? { text: lage.orte[1]?.name ?? "", ort: true }
                  : { text: stueck, ort: false },
        );
}

/**
 * Die Lage im Fingerabdruck: `richtung:kennungen`, die Kennungen klein und sortiert (A–B ist B–A), wie `lageSchluessel` des Servers (`lore-keys.ts`); leer, wo es keine Lage gibt. Zwei Bedingungen mit
 * verschiedener Lage sind verschieden, auch wenn Arten, Fläche und Klima gleich sind.
 */
export function lageSchluessel(lage: WikisyncRegelLage | undefined): string {
    if (lage === undefined) return "";
    return `${lage.richtung}:${lage.orte
        .map((ort) => ort.kennung.toLowerCase())
        .sort()
        .join(",")}`;
}

/** Eine Bedingung in ihren Teilen, damit die Vorlage die Wörter fett setzen kann (kein HTML im Text). */
export interface BedingungTeile {
    arten: string[];
    flaeche: { name: string; offen: boolean; kandidat: string | null; titel: string | null } | null;
    klima: { von: string; bis: string } | null;
    /** Die Lage in Worten („südlich von Festum“); `null`, wo die Bedingung keine hat. */
    lage: string | null;
    /** Welche Form der Satz hat: Arten in einer Fläche, Arten überall, die Fläche selbst, nur Klima (mit oder ohne Lage), nur Lage, leer. */
    form: "flaeche_arten" | "ueberall_arten" | "flaeche" | "klima" | "lage" | "leer";
}

export function bedingungTeile(b: WikisyncRegelBedingung): BedingungTeile {
    const arten = b.arten.map((eintrag) => landschaftName(eintrag.art));
    const flaeche =
        b.flaeche === null
            ? null
            : { name: b.flaeche.name, offen: b.flaeche.offen, kandidat: b.flaeche.kandidat, titel: b.flaeche.titel };
    const klima = b.klima === null ? null : { von: zoneName(b.klima.von), bis: zoneName(b.klima.bis) };
    const lage = b.lage === undefined ? null : lageText(b.lage);
    let form: BedingungTeile["form"];
    if (arten.length > 0 && flaeche !== null) form = "flaeche_arten";
    else if (arten.length > 0) form = "ueberall_arten";
    else if (flaeche !== null) form = "flaeche";
    else if (klima !== null) form = "klima";
    else if (lage !== null) form = "lage";
    else form = "leer";
    return { arten, flaeche, klima, lage, form };
}

const klein = (wert: string): string => wert.replaceAll("_", " ").trim().toLowerCase();

/**
 * Die offene Fläche (WI-0253 §25), die zu einer Bedingung gehört: Die Bedingung wartet auf einen Artikel (`titel`) und nennt eine Fläche gleichen Namens ohne Wiki-Schlüssel (`kandidat`); die Übersicht des
 * Servers kennt beides samt Kennung der Fläche. Verglichen wird wie in der Ableitung (getrimmt, klein). `undefined`, wo die Bedingung nicht wartet oder keinen Kandidaten hat.
 */
export function offeneFlaecheFuer(
    b: WikisyncRegelBedingung,
    flaechen: readonly WikisyncRegelOffeneFlaeche[],
): WikisyncRegelOffeneFlaeche | undefined {
    const f = b.flaeche;
    if (f === null || !f.offen || f.kandidat === null) return undefined;
    const titel = klein(f.titel ?? f.name);
    const kandidat = klein(f.kandidat);
    return flaechen.find((eintrag) => klein(eintrag.titel) === titel && klein(eintrag.name) === kandidat);
}

/** Eine Bedingung als kurzer Text in einer Zeile („Wald, Urwald in Aranien“); für die Liste und den Titel einer Beziehung. */
export function bedingungKurz(b: WikisyncRegelBedingung): string {
    return kurzMit(bedingungTeile(b), b.flaeche === null ? "" : flaecheKurz(b.flaeche));
}

/** Eine Fläche in einer Zeile: eine, die es noch nicht gibt, trägt „!“. */
const flaecheKurz = (flaeche: { name: string; offen: boolean }): string =>
    `${flaeche.offen ? "! " : ""}${flaeche.name}`;

/** Die Zeile einer Bedingung oder einer Gruppe: Arten einmal, dann der Ort (eine Fläche oder mehrere mit Komma), dann die Lage und das Klima. */
function kurzMit(teile: BedingungTeile, ort: string): string {
    const arten = teile.arten.join(` ${t("admin.wikisync.regeln.oder")} `);
    const klima =
        teile.klima === null
            ? ""
            : t("admin.wikisync.regeln.imKlimaKurz", { von: teile.klima.von, bis: teile.klima.bis });
    const lage = teile.lage ?? "";
    if (teile.form === "flaeche_arten") return [`${arten} · ${ort}`, lage, klima].filter((x) => x !== "").join(" · ");
    if (teile.form === "ueberall_arten") return [arten, lage, klima].filter((x) => x !== "").join(" · ");
    if (teile.form === "flaeche") return [ort, lage, klima].filter((x) => x !== "").join(" · ");
    const rest = [lage, klima].filter((x) => x !== "").join(" · ");
    return rest === "" ? t("admin.wikisync.regeln.ohneAngabe") : rest;
}

/** Die Arten (als Menge), das Klima und die Lage einer Bedingung: Was gleich ist, kann die Anzeige zusammenfassen. */
const artenUndKlima = (b: WikisyncRegelBedingung): string =>
    `${b.arten
        .map((eintrag) => `${eintrag.ebene}|${eintrag.art}`)
        .sort()
        .join(",")}#${b.klima === null ? "" : `${b.klima.von}-${b.klima.bis}`}#${lageSchluessel(b.lage)}`;

/**
 * Die Bedingungen einer Regel, wie die Anzeige sie liest: Aufeinanderfolgende Bedingungen, die mit ODER verknüpft sind, dieselben Arten und dasselbe Klima tragen und eine Fläche nennen, bilden EINE
 * Gruppe (Arten einmal, dann die Flächen). UND und OHNE brechen die Gruppe, ebenso andere Arten oder anderes Klima. 🔴 Eine Gruppe nimmt nur dort ODER-Bedingungen auf, wo das Ergebnis dasselbe
 * bleibt: Die Kette wird von links nach rechts gelesen, also gehört ein ODER zu allem davor. Darum beginnt eine Gruppe mit der ersten Bedingung der Kette oder mit einer, die selbst mit ODER
 * anschließt; hinter UND und OHNE steht ein folgendes ODER für sich („A OHNE B ODER C“ ist nicht „A OHNE B, C“). Nur die Anzeige fasst zusammen, die Daten bleiben, wie sie sind.
 */
export function bedingungGruppen(bedingungen: readonly WikisyncRegelBedingung[]): WikisyncRegelBedingung[][] {
    const gruppen: WikisyncRegelBedingung[][] = [];
    let kopfIndex = 0;
    for (const [i, b] of bedingungen.entries()) {
        const gruppe = gruppen[gruppen.length - 1];
        const kopf = gruppe?.[0];
        if (
            gruppe !== undefined &&
            kopf !== undefined &&
            b.verknuepfung === "oder" &&
            b.flaeche !== null &&
            kopf.flaeche !== null &&
            (kopfIndex === 0 || kopf.verknuepfung === "oder") &&
            artenUndKlima(b) === artenUndKlima(kopf)
        ) {
            gruppe.push(b);
        } else {
            gruppen.push([b]);
            kopfIndex = i;
        }
    }
    return gruppen;
}

/** Eine Gruppe in einer Zeile: Arten einmal, dann die Flächen mit Komma; dieselbe Fläche mehrmals steht einmal mit ihrer Zahl („Khôm (2 Flächen)“), „!“ bleibt an der offenen Fläche. */
export function gruppeKurz(gruppe: readonly WikisyncRegelBedingung[]): string {
    const erste = gruppe[0];
    if (erste === undefined) return t("admin.wikisync.regeln.ohneAngabe");
    if (gruppe.length === 1) return bedingungKurz(erste);
    const zaehler = new Map<string, number>();
    for (const b of gruppe) {
        if (b.flaeche === null) continue;
        const name = flaecheKurz(b.flaeche);
        zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
    }
    const ort = [...zaehler]
        .map(([name, n]) => (n > 1 ? `${name} (${tPlural("admin.wikisync.n.flaechen", n, { n: zahl(n) })})` : name))
        .join(", ");
    return kurzMit(bedingungTeile(erste), ort);
}

/** Die Regel einer Beziehung in einer Zeile: die Bedingungen mit UND, ODER und OHNE, wie sie von links nach rechts gelesen werden; gleiche ODER-Bedingungen sind zusammengefasst. */
export function regelKurz(regel: WikisyncRegelBeziehung): string {
    if (regel.bedingungen.length === 0) return t("admin.wikisync.regeln.keineBedingung");
    return bedingungGruppen(regel.bedingungen)
        .map(
            (gruppe, i) =>
                (i === 0 ? "" : ` ${verknuepfungName(gruppe[0]?.verknuepfung ?? "und")} `) + gruppeKurz(gruppe),
        )
        .join("");
}

/** Die Zusammenfassung über der Kette der Detailansicht: nur dort, wo die Anzeige etwas zusammenfasst; sonst `null` (die Kette ist die Regel). */
export function regelZusammenfassung(regel: WikisyncRegelBeziehung): string | null {
    return bedingungGruppen(regel.bedingungen).length < regel.bedingungen.length ? regelKurz(regel) : null;
}

/** Der Satz zur ganzen Zeile der Liste: die erste Beziehung, die etwas hat; sonst „keine Regel“. */
export function vorschlagKurz(v: WikisyncRegelVorschlag): string {
    const regel = v.regeln.find((r) => r.status !== "entfaellt") ?? v.regeln[0];
    if (regel === undefined) return t("admin.wikisync.regeln.keineRegel");
    const text =
        regel.status === "entfaellt"
            ? t("admin.wikisync.regeln.entfaelltKurz", {
                  regel:
                      regel.bisher !== null && regel.bisher.length > 0
                          ? regelKurz({ ...regel, bedingungen: regel.bisher })
                          : "—",
              })
            : regel.bedingungen.length === 0 && regel.teile.length > 0
              ? t("admin.wikisync.regeln.nurTeile")
              : regelKurz(regel);
    return v.regeln.length > 1 ? `${beziehungName(regel.beziehung)}: ${text} …` : text;
}

/** Die Beziehungen eines Vorschlags als Aufzählung („Verbreitung, Herkunft“). */
export function beziehungenText(v: WikisyncRegelVorschlag): string {
    return [...new Set(v.regeln.map((r) => beziehungName(r.beziehung)))].join(", ");
}

/** Die drei Kreise der Auswahl (kein halb-rechts). */
export type RegelKreis = "leer" | "halb" | "voll";

// ── Kreis und Auswahl ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** ● vorgewählt (vollständig und wählbar), ◐ wählbar, aber erst nach Prüfung, ○ nicht wählbar (Hinweis, Teile ohne Regel, Regel der Redaktion, wartend). */
export function vorschlagKreis(v: Pick<WikisyncRegelVorschlag, "waehlbar" | "vorgewaehlt">): RegelKreis {
    if (!v.waehlbar) return "leer";
    return v.vorgewaehlt ? "voll" : "halb";
}

export const REGELN_KREIS_LEGENDE: readonly RegelKreis[] = ["voll", "halb", "leer"];
export const regelnKreisName = (kreis: RegelKreis): string => t(`admin.wikisync.regeln.kreis.${kreis}`);

/** Warum ein Vorschlag nicht wählbar ist (`sperre` des Servers) in Worten. */
export function sperreName(sperre: string | null): string {
    if (sperre === null) return "";
    const key = `admin.wikisync.regeln.sperre.${sperre}`;
    return isMessageKey(key) ? t(key as MessageKey) : sperre;
}

// ── Begriffstafel ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const lageName = (lage: WikisyncBegriffLage): string => t(`admin.wikisync.begriffe.lage.${lage}`);
export const lageInfo = (lage: WikisyncBegriffLage): string => t(`admin.wikisync.begriffe.lageInfo.${lage}`);

/** Der Ton der Pille zur Lage eines Worts: Was entschieden werden muss, ist gelb; eine Lücke auch; Näherung und Übergehen sind leise. */
export const LAGE_TON: Readonly<Record<WikisyncBegriffLage, "neutral" | "warnung">> = {
    gleichwertig: "neutral",
    naeherung: "neutral",
    offen: "warnung",
    luecke: "warnung",
    uebergehen: "neutral",
    neu: "warnung",
};

/** Muss dieses Wort noch entschieden werden (offen oder ohne Pille ohne Absicht)? */
export const begriffBrauchtEntscheidung = (b: WikisyncBegriff): boolean =>
    b.pillen.length === 0 && (b.lage === "offen" || b.lage === "neu");

/** Welche Lage zeigt die Zeile als Marke? Eine Lage, die schon entschieden ist, zeigt sie nicht mehr als Aufgabe. */
export function begriffMarke(
    b: WikisyncBegriff,
): { lage: WikisyncBegriffLage; text: string; ton: "neutral" | "warnung" } | null {
    if (b.lage === "gleichwertig") return null;
    if (b.lage === "offen" && b.pillen.length > 0) return null;
    if (b.lage === "neu" && b.pillen.length > 0) return null;
    return { lage: b.lage, text: lageName(b.lage), ton: LAGE_TON[b.lage] };
}
