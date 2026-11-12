import { subjectKey } from "@avesmaps3d/shared";
import type {
    InhalteVorkommenArt,
    SearchEintrag,
    SearchEintragGegend,
    SearchEintragOrt,
    SearchEintragWo,
    SourceEntry,
} from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";
import { KATEGORIE_NAME } from "../search/vorkommen-ansicht";

/**
 * „Wo es vorkommt“ im Panel eines Vorkommens (WI-0260) als reine Daten, ohne Vue: Was der Server an Gegenden, Orten und „auch genannt“ liefert (`SearchEintrag.wo`), wird zu Gruppen mit Zeilen, und die Kürzung
 * (acht Zeilen, mit „Weitere anzeigen“ bis vierzig) und die Sätze darunter folgen dem abgenommenen Entwurf (Fassung 2). Die Komponente zeichnet, diese Datei entscheidet.
 *
 * 🔴 **Keine Zahlen an den Zeilen, keine Pillen:** Jede Gegend steht EINMAL mit ihrem Namen und ihrer Art da (Betreiber 2026-10-30: „is unklar was die zahl bedeutet orkland 2 macht keinen sinn“). Was gerade leuchtet,
 * zeigt die Auswahl in der Farbe der Auswahlliste. Eine Zahl steht nur im Satz unter der Liste, und dort sagt sie, wie viele Gegenden die Liste nicht nennt.
 *
 * 🔴 **Die Reihenfolge kommt vom Server** (Herkunft, Verbreitung, Regel, je nach Name; die Orte nach Name): Hier wird nur in Gruppen geteilt, nie neu geordnet.
 */

/** Wie die Zeile zum Eintrag steht: im Wiki als Verbreitung oder Herkunft genannt, oder nur aus dem Lebensraum gefolgert (Regel). */
export type WoRelation = SearchEintragGegend["relation"];

/** Die Antwort des Servers, so wie die Infobox sie liest. */
export type Eintrag = SearchEintrag;

/** So viele Zeilen zeigt eine Gruppe zuerst. */
export const WO_SICHT = 8;
/** So viele zeigt sie höchstens, nach „Weitere anzeigen“; was darüber liegt, zeigt „Alle zeigen“ auf der Karte. */
export const WO_MAX = 40;

export type WoGruppeId = "herkunft" | "verbreitung" | "gegenden" | "regel" | "orte";

/** Eine Zeile der Liste: eine Gegend (leuchtet über `ziel`) oder ein Ort (öffnet über `ref`). */
export type WoZeile =
    | {
          readonly art: "gegend";
          readonly key: string;
          readonly name: string;
          readonly typ: string;
          readonly relation: WoRelation;
          readonly gegend: SearchEintragGegend;
      }
    | {
          readonly art: "ort";
          readonly key: string;
          readonly name: string;
          readonly typ: string;
          readonly relation: WoRelation;
          readonly ort: SearchEintragOrt;
      };

export interface WoGruppe {
    readonly id: WoGruppeId;
    readonly titel: MessageKey;
    readonly zeilen: readonly WoZeile[];
    /** Wie viele Gegenden der Server zu dieser Gruppe nicht geliefert hat (`wo.weitere`); sie leuchten trotzdem. Nur EINE Gruppe trägt sie, sonst 0. */
    readonly weitere: number;
}

const GRUPPEN_TITEL: Readonly<Record<WoGruppeId, MessageKey>> = {
    herkunft: "eintrag.gruppe.herkunft",
    verbreitung: "eintrag.gruppe.verbreitung",
    gegenden: "eintrag.gruppe.gegenden",
    regel: "eintrag.gruppe.regel",
    orte: "eintrag.gruppe.orte",
};

/**
 * Die Art einer Gegend in Worten: der Schlüssel der Landschaftsart („wald“, „suempfe_moore“) aus der Sprachtafel, wo es ihn gibt; die Art eines Herrschaftsgebiets steht so in den Daten („Grafschaft“).
 */
export function gegendTyp(gegend: SearchEintragGegend): string {
    const typ = gegend.typ.trim();
    if (gegend.kind === "gebiet") return typ;
    const key = `landscape.type.${typ}`;
    return isMessageKey(key) ? t(key) : typ;
}

/**
 * Die Klasse eines Orts in Worten: „Stadt“, „Dorf“; eine Landmarke nach ihrer Art („Höhle“, „Quelle“, WI-0271 L6, wie der Untertitel ihres Panels), und „Gipfel“, wo die Tafel keine kennt;
 * eine unbekannte Klasse bleibt, wie sie ist.
 */
function ortTyp(ort: SearchEintragOrt): string {
    const klasse = ort.klasse.trim();
    const keys = ort.ref.kind === "peak" ? [`peak.${klasse}`, `landscape.type.${klasse}`] : [`place.${klasse}`];
    const key = keys.find(isMessageKey);
    if (key !== undefined) return t(key);
    return ort.ref.kind === "peak" ? t("inhalte.kind.peak") : klasse;
}

const gegendZeile = (gegend: SearchEintragGegend): WoZeile => ({
    art: "gegend",
    key: `g:${gegend.key}`,
    name: gegend.name,
    typ: gegendTyp(gegend),
    relation: gegend.relation,
    gegend,
});

const ortZeile = (ort: SearchEintragOrt): WoZeile => ({
    art: "ort",
    key: `o:${subjectKey(ort.ref)}`,
    name: ort.name,
    typ: ortTyp(ort),
    relation: ort.relation,
    ort,
});

const gruppe = (id: WoGruppeId, zeilen: readonly WoZeile[]): WoGruppe[] =>
    zeilen.length === 0 ? [] : [{ id, titel: GRUPPEN_TITEL[id], zeilen, weitere: 0 }];

/**
 * Die Gruppen der Liste in der Reihenfolge des Entwurfs. Bei einer Ware mit Herkunft: „Herkunft“ (Gegenden und Orte), „Verbreitung“ (die übrigen Gegenden), „Orte“. Sonst „Gegenden“ und, wo es neben
 * den genannten auch Regeltreffer gibt, „Weitere nach Lebensraum“ - sonst läse sich die Liste wie dreihundert gleichwertige Namen -, dann „Orte“. Eine Gruppe ohne Zeile entsteht nicht.
 *
 * `wo.weitere` (die Gegenden, die der Server nicht mitschickt: höchstens sechzig je Beziehung, bei den Regeln die größten) gehört der Gruppe, in der sie fehlen: der der Regeln, sonst der letzten mit Gegenden.
 */
export function woGruppen(art: InhalteVorkommenArt, wo: SearchEintragWo): WoGruppe[] {
    const gegenden = wo.gegenden.map(gegendZeile);
    const orte = wo.orte.map(ortZeile);
    const herkunft = (zeile: WoZeile): boolean => zeile.relation === "herkunft";
    let gruppen: WoGruppe[];
    if (art === "ware" && [...gegenden, ...orte].some(herkunft)) {
        gruppen = [
            ...gruppe("herkunft", [...gegenden, ...orte].filter(herkunft)),
            ...gruppe(
                "verbreitung",
                gegenden.filter((zeile) => !herkunft(zeile)),
            ),
            ...gruppe(
                "orte",
                orte.filter((zeile) => !herkunft(zeile)),
            ),
        ];
    } else {
        const benannt = gegenden.filter((zeile) => zeile.relation !== "regel");
        const regel = gegenden.filter((zeile) => zeile.relation === "regel");
        gruppen = [
            ...(benannt.length > 0 && regel.length > 0
                ? [...gruppe("gegenden", benannt), ...gruppe("regel", regel)]
                : gruppe("gegenden", gegenden)),
            ...gruppe("orte", orte),
        ];
    }
    const weitere = wo.weitere ?? 0;
    if (weitere <= 0) return gruppen;
    const traeger =
        gruppen.findLast((g) => g.id === "regel") ??
        gruppen.findLast((g) => g.id === "gegenden" || g.id === "verbreitung");
    return gruppen.map((g) => (g === traeger ? { ...g, weitere } : g));
}

/** Die Zeilen, die eine Gruppe jetzt zeigt: zuerst acht, nach „Weitere anzeigen“ bis vierzig. */
export const sichtbareZeilen = (zeilen: readonly WoZeile[], offen: boolean): readonly WoZeile[] =>
    zeilen.slice(0, offen ? WO_MAX : WO_SICHT);

/** Gibt es hinter den ersten acht Zeilen mehr, das „Weitere anzeigen“ rechtfertigt? */
export const hatWeitere = (zeilen: readonly WoZeile[]): boolean => zeilen.length > WO_SICHT;

/** Der Satz unter einer Gruppe: der Schlüssel seiner Zählform und die Zahl der Gegenden (Orte), die die Liste nicht nennt. */
export interface WoRest {
    readonly key: "eintrag.rest.regel" | "eintrag.rest.gegenden" | "eintrag.rest.orte";
    readonly n: number;
}

/**
 * Der Satz unter einer Gruppe, deren Liste nicht alles nennt: Er sagt, wie viele Gegenden leuchten, ohne in der Liste zu stehen, und dass „Alle zeigen“ sie auf der Karte zeigt. Das sind die Zeilen über vierzig
 * und die, die der Server nicht geliefert hat (`weitere`). Sind es nur Gegenden aus dem Lebensraum, sagt er das. Er steht, wo die Gruppe vollständig zu sehen ist (aufgeklappt oder ohne „Weitere anzeigen“);
 * `undefined`, wo nichts fehlt oder die Gruppe noch zu ist.
 */
export function restSatz(zeilen: readonly WoZeile[], offen: boolean, weitere = 0): WoRest | undefined {
    if (!offen && hatWeitere(zeilen)) return undefined;
    const darueber = zeilen.slice(WO_MAX);
    const n = darueber.length + weitere;
    if (n <= 0) return undefined;
    const bezug = darueber.length > 0 ? darueber : zeilen;
    if (bezug.every((zeile) => zeile.relation === "regel")) return { key: "eintrag.rest.regel", n };
    return { key: bezug.every((zeile) => zeile.art === "ort") ? "eintrag.rest.orte" : "eintrag.rest.gegenden", n };
}

/** Hat die Liste eine Zeile? Ohne Zeile steht „Noch kein Ort auf der Karte.“ bzw. „Überall in Aventurien“. */
export const zeilenZahl = (wo: SearchEintragWo): number => wo.gegenden.length + wo.orte.length;

/** Der Untertitel: „Ware · Hartwurst · profan“ (mit Gegenstandstyp), sonst „Fauna · Niederer Drache“; was fehlt, fehlt. */
export function untertitelTeile(e: Eintrag): string[] {
    const art = e.kind === "ware" ? t("eintrag.art.ware") : t(KATEGORIE_NAME[e.kind]);
    const teile = e.kind === "ware" ? [art, e.typ, e.gruppe] : [art, e.gruppe];
    return teile.filter((teil): teil is string => teil !== undefined && teil !== null && teil.trim() !== "");
}

/** Der Kontinent als Feld: nur, wo er nicht Aventurien ist („Myranor“, „Aventurien / Myranor“); ein Schrägstrich bekommt Luft. */
export function kontinentFeld(kontinent: string | null): string | undefined {
    const text = (kontinent ?? "").trim();
    if (text === "" || /^aventurien$/iu.test(text)) return undefined;
    return text.replace(/\s*\/\s*/gu, " / ");
}

/** Die Publikationen für den Quellenkasten; ohne Eintrag `undefined` (dann zeigt der Kasten nur die Wikizeile). */
export const publikationenVon = (e: Eintrag): readonly SourceEntry[] | undefined =>
    e.publikationen.length === 0 ? undefined : e.publikationen;

/**
 * Die Seite der Autoren eines Wiki-Artikels (`…/wiki/<Titel>?action=credits`): CC BY-SA verlangt die Namensnennung der Autoren, und das Wiki führt sie dort. Aus der Adresse des Artikels
 * (`https://de.wiki-aventurica.de/wiki/<Titel>`); eine Adresse in anderer Form hat keine, dann steht kein Link da.
 *
 * 💣 OPS-000104 (Editor, 2026-11-09): Die Adresse hieß `…/index.php?title=<Titel>&action=credits`. Das Skript der Wiki Aventurica liegt aber unter `/de/index.php`;
 * `/index.php` leitet auf die Startseite um. Der Pfad des Artikels selbst nimmt `action=credits` an, ohne dass man den Skriptpfad des Wikis kennen muss.
 */
export function autorenUrl(artikel: string): string | undefined {
    try {
        const url = new URL(artikel);
        const titel = /^\/wiki\/(.+)$/u.exec(url.pathname)?.[1];
        if (url.protocol !== "https:" || titel === undefined) return undefined;
        return `${url.origin}/wiki/${titel}?action=credits`;
    } catch {
        return undefined;
    }
}

/** Die Lizenz der Wiki-Texte: Das Wiki steht unter CC BY-SA 3.0; ihr Link ist die deutsche Zusammenfassung (Betreiber 2026-10-30). */
export const CC_BY_SA_3_LINK = "https://creativecommons.org/licenses/by-sa/3.0/deed.de";

/** Wohin der Name der Lizenz führt: CC BY-SA 3.0 auf die deutsche Zusammenfassung, jede andere dahin, wo der Server sie nennt; ohne Adresse nirgendwohin. */
export function lizenzLink(lizenz: { readonly name: string; readonly uri?: string | undefined }): string | undefined {
    return /^CC BY-SA 3\.0$/iu.test(lizenz.name.trim()) ? CC_BY_SA_3_LINK : lizenz.uri;
}
