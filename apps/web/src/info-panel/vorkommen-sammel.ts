import { ersterSatz, type SearchEintrag } from "@avesmaps3d/shared";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { autorenUrl, kontinentFeld, lizenzLink } from "./eintrag-wo";
import { wikiOfLine } from "./panel-header";
import type { RowModel } from "./panel-types";
import { safeHref } from "./source-model";

/**
 * Was die Infobox eines Vorkommens (`info-eintrag.vue`) und der Sammelscreen „Ausgewählte Vorkommen“ (`info-vorkommen-sammel.vue`, WI-0257 S5) gemeinsam zeigen, als reine
 * Daten: die Feldtafel unter dem Kopf, die Gegenden in Kurzform und die Lizenzzeile der Wiki-Texte; dazu Ordnung und Kurzzeile des Sammelscreens. Vali 2026-10-30: „der erste satz reicht“ - die Beschreibung
 * ist nur der erste Satz der Kurzbeschreibung (`ersterSatz`, dieselbe Regel wie der Server).
 */

const feld = (key: string, label: string, text: string | undefined | null): RowModel[] =>
    text === undefined || text === null || text.trim() === "" ? [] : [{ key, label, value: { kind: "text", text } }];

/** Die Beschreibung: der erste Satz der Kurzbeschreibung; ohne Kurzbeschreibung keiner. */
export function beschreibungVon(e: Pick<SearchEintrag, "kurzbeschreibung">): string | undefined {
    const satz = ersterSatz(e.kurzbeschreibung ?? "");
    return satz === "" ? undefined : satz;
}

/** Die Feldtafel unter dem Kopf der Infobox: Beschreibung (erster Satz), Lebensraum, weitere Namen und der Kontinent, wo er nicht Aventurien ist. */
export function tafelZeilen(e: SearchEintrag): RowModel[] {
    return [
        ...feld("beschreibung", t("eintrag.row.beschreibung"), beschreibungVon(e)),
        ...feld("lebensraum", t("eintrag.row.lebensraum"), e.lebensraum),
        ...feld("weitere", t("eintrag.row.weitere"), e.weitereNamen?.join(", ")),
        ...feld("kontinent", t("eintrag.row.kontinent"), kontinentFeld(e.kontinent)),
    ];
}

/** So viele Gegenden nennt eine Karte des Sammelscreens, bevor „und N weitere“ kommt. */
export const GEGENDEN_KURZ = 3;

/**
 * Die Gegenden eines Eintrags in einer Zeile: die ersten drei Namen, wie die Infobox sie ordnet (Herkunft, Verbreitung, nach Lebensraum), dann „und N weitere“ - samt der
 * Gegenden, die leuchten, ohne in der Liste zu stehen (`wo.weitere`). Ohne Gegend die genannten Orte; ohne beides „Überall in Aventurien“ oder „Noch kein Ort auf der Karte.“
 */
export function gegendenKurz(e: Pick<SearchEintrag, "wo" | "nurKontinent">): string {
    const namen = [...new Set(e.wo.gegenden.map((gegend) => gegend.name))];
    const alle = namen.length > 0 ? namen : [...new Set(e.wo.orte.map((ort) => ort.name))];
    if (alle.length === 0) return e.nurKontinent ? t("eintrag.ueberall") : t("eintrag.keinOrt");
    const vorn = alle.slice(0, GEGENDEN_KURZ).join(", ");
    const rest = alle.length - GEGENDEN_KURZ + (namen.length > 0 ? (e.wo.weitere ?? 0) : 0);
    return rest > 0 ? tPlural("vorkommen.sammel.gegenden", rest, { namen: vorn, n: formatNumber(rest, 0) }) : vorn;
}

/** Was eine Zeile des Sammelscreens über ihre Etappen braucht (`UnterwegsZeile`): die erste ab 1 und alle ab 0. */
interface EtappenZeile {
    readonly name: string;
    readonly ab: number;
    readonly etappen: readonly number[];
}

const NAMEN = new Intl.Collator("de");

/** Die Zeilen entlang der Route (Vali 2026-10-30, Fassung 2: „entlang der route“): nach der ersten Etappe, bei Gleichstand nach dem Namen. */
export function entlangDerRoute<Z extends EtappenZeile>(zeilen: readonly Z[]): Z[] {
    return [...zeilen].sort((a, b) => a.ab - b.ab || NAMEN.compare(a.name, b.name));
}

/**
 * Die Kurzzeile unter dem Namen: „ab Etappe 17 · 11 von 80 Etappen“, bei einer einzigen „nur Etappe 75“. Sie beginnt mit der ersten Etappe, dem Schlüssel der
 * Ordnung; ohne bekannte Reise fehlt der Anteil.
 */
export function kurzzeile(zeile: EtappenZeile, gesamt: number | undefined): string {
    const n = new Set(zeile.etappen).size;
    const ab = formatNumber(zeile.ab, 0);
    if (n === 1) return t("vorkommen.sammel.nur", { ab });
    const anfang = t("vorkommen.sammel.ab", { ab });
    if (gesamt === undefined) return anfang;
    return `${anfang} · ${t("vorkommen.sammel.anteil", { n: formatNumber(n, 0), gesamt: formatNumber(gesamt, 0) })}`;
}

/** Ein Stück der Lizenzzeile: Text, mit Adresse ein Link (öffnet in einem neuen Tab). */
export interface LizenzTeil {
    readonly text: string;
    readonly href?: string | undefined;
}

/**
 * „Text: Wiki Aventurica (Autoren) · CC BY-SA 3.0“ (Betreiber 2026-10-30, WI-0260): CC BY-SA verlangt die Namensnennung, also führt der Name des Wikis auf den Artikel,
 * „Autoren“ auf die Liste seiner Autoren im Wiki und die Lizenz auf ihre Zusammenfassung. Ein Stück ohne Adresse bleibt Text; ohne Lizenzangabe des Servers steht keine da.
 *
 * Unter dem Sammelscreen steht sie EINMAL für alle Texte (\`mehrere\`): „Texte: Wiki Aventurica (Autoren) · CC BY-SA 3.0“. Der Name führt dann auf das Wiki selbst, denn
 * die Artikel sind mehrere; „Autoren“ bleibt Text - die Autoren jedes Artikels nennt seine Infobox, ein Klick auf den Namen der Karte.
 */
export function lizenzTeile(e: Pick<SearchEintrag, "wiki">, mehrere = false): LizenzTeil[] {
    const quelle = e.wiki;
    const label = wikiOfLine(quelle, undefined)?.label ?? t("infoPanel.source.wiki");
    let ziel: string | undefined;
    if (quelle !== undefined) {
        try {
            ziel = mehrere ? safeHref(`${new URL(quelle.url).origin}/`) : safeHref(quelle.url);
        } catch {
            ziel = undefined;
        }
    }
    const teile: LizenzTeil[] = [
        { text: `${t(mehrere ? "vorkommen.sammel.lizenz" : "eintrag.lizenz.text")} ` },
        { text: label, href: ziel },
    ];
    const autoren = quelle === undefined || mehrere ? undefined : autorenUrl(quelle.url);
    if (mehrere) teile.push({ text: ` (${t("eintrag.lizenz.autoren")})` });
    else if (autoren !== undefined)
        teile.push({ text: " (" }, { text: t("eintrag.lizenz.autoren"), href: autoren }, { text: ")" });
    if (quelle?.license !== undefined)
        teile.push({ text: " · " }, { text: quelle.license.name, href: lizenzLink(quelle.license) });
    return teile;
}
