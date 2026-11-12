import type { WikisyncRegelLageOrt } from "@avesmaps3d/shared";
import {
    aufgeloesterTitel,
    bereinigeFeld,
    normTitel,
    teileOben,
    zerlegeFeld,
    zielKlasse,
    type ZielKlasse,
    type ZielWissen,
} from "../abgleich/ortsrolle.ts";
import { Begriffstafel, tafelWort, type WortForm } from "./begriffe.ts";

/**
 * Das Lesen der Ortsfelder und des Lebensraums eines Vorkommens für die Regelvorschläge (WI-0253 Scheibe Regelvorschläge, §24): Nachbau von `analyse.py` der Regelbuch-Analyse
 * (`C:/avesmaps3d-data/scratch/regelbuch/`), Glied für Glied. REIN: keine Datenbank, kein Dump; was die Ableitung über die Karte und die Linkziele wissen muss, kommt als `RegelWissen` herein.
 *
 * Ein Feld zerfällt in Zweige (`;`, trennen meist Welten), Ebenen (`:`, die äußeren sind Rahmen) und Glieder (`,`). Je Glied entstehen: die Links mit der Klasse ihres Ziels, die Merkmale („Linie“,
 * „Richtung“, „Teilfläche“, „früher“ …), die Wörter der Begriffstafel (Landschaftsarten, Klimazonen) und der Rest. Daraus bildet `bausteine` die Aussagen des Glieds.
 */

/** Eine Fläche der Karte (`region`), so weit die Ableitung sie braucht. */
export interface Flaeche {
    /** `region.id`. */
    id: string;
    /** `region.public_id`. */
    kennung: string;
    name: string;
    /** Der Titel ihres Wiki-Artikels (aus `region.wiki_url`); `null`, solange sie keinen hat. */
    titel: string | null;
}

/** Was die Ableitung über die Karte, die Linkziele und die Begriffe weiß. */
export interface RegelWissen extends ZielWissen {
    /** Die Flächen, die diesen Artikel tragen (der Titel nach Weiterleitungen); leer, wo es keine gibt. */
    flaechen(titel: string): readonly Flaeche[];
    /** Flächen nach ihrem Namen (klein), nur um einen Flächennamen OHNE Link im Text zu erkennen; nie ein Weg zu einem Treffer. */
    flaechenNamen(): ReadonlyMap<string, readonly Flaeche[]>;
    tafel: Begriffstafel;
    /**
     * Die aktiven Siedlungen der Karte (Metropole bis Dorf), die so heißen (`ortsSchluessel`): genau eine, wenn der Name eindeutig ist, mehrere, wenn nicht, keine, wo es sie nicht gibt. Fehlt die Auskunft
     * (Wissen ohne Siedlungen), liest die Ableitung keine Lage zu einer Linie (WI-0254).
     */
    siedlungen?(name: string): readonly WikisyncRegelLageOrt[];
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Muster (Python `re`, Unicode)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const WORTGRENZE = "(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))";
const WORTZEICHEN = "[\\p{L}\\p{N}_]";
export const muster = (quelle: string, flags = "u"): RegExp =>
    new RegExp(quelle.replaceAll("\\b", WORTGRENZE).replaceAll("\\w", WORTZEICHEN), flags);

/** Die Merkmale eines Glieds (Python `Q`), nach ihrem Namen. */
const MERKMAL_QUELLEN: Readonly<Record<string, string>> = {
    negation:
        "\\b(außer|ausser|ausgenommen|nicht|ohne|kein|keine|keinen|keinem|keiner|mit ausnahme|abgesehen|meidet|meiden)\\b",
    teilflaeche:
        "\\b(nord|süd|ost|west)?(nördlich|südlich|östlich|westlich)(e|en|er|es|em)\\b|\\bzentral(e|en|er|es)\\b|\\binnere[nrs]?\\b|\\bobere[nrs]?\\b|\\buntere[nrs]?\\b|\\bmittlere[nrs]?\\b|\\b(im|in den|in der|den|dem|der|des|ganzen|hohen) ?(hohen |tiefen |äußersten |fernen )?(norden|süden|osten|westen|nordosten|nordwesten|südosten|südwesten)\\b|\\bunterlauf\\b|\\boberlauf\\b|\\b(nord|süd|ost|west)\\s*§",
    bezugspunkt:
        "\\b(nord|süd|ost|west)?(nördlich|südlich|östlich|westlich)\\b|\\b(und|weiter) (südlicher|nördlicher|östlicher|westlicher)\\b|\\bnördlich davon\\b",
    linie: "\\blinie\\b|\\bzwischen\\b|\\bbis\\b|\\bgrenze\\w*|\\bjenseits\\b|\\bdiesseits\\b|§\\s*[-–]\\s*§",
    hoehe: "\\bhöhe\\b|\\bhöhen\\b|\\bhöhere[nrs]?\\b|\\boberhalb\\b|\\bunterhalb\\b|\\bbaumgrenze\\b|\\bschneegrenze\\b|\\bhochgebirge\\w*|\\bhöhenlage\\w*|\\bgipfel\\w*|\\bberghänge?n?\\b|\\bgebirgshänge?n?\\b|\\bbergwiese\\w*|\\balm(en)?\\b|\\bhochlagen\\b|\\bhöhenzüge\\w*",
    tiefe: "\\btiefe\\b|\\btiefsee\\b|\\bunterirdisch\\w*|\\bschritt tiefe\\b|\\btiefe[nr]? (seen|gewässer|meer)",
    gewaesser:
        "küste|ufer|strand|gewässer|\\bmeer\\w*|\\bfluss\\w*|\\bflüsse\\w*|\\bsee\\b|\\bseen\\b|\\bbach|\\bbäche|teich|tümpel|delta|mündung|lagune|bucht|brackwasser|süßwasser|süsswasser|salzwasser|tiefsee|offene[ns]? meer|\\briff\\w*|\\bwasser\\b|\\bquell\\w*|mangrove|\\bvor der küste\\b|\\bvor\\s*§",
    haeufigkeit:
        "\\bselten\\w*|\\bhäufig\\w*|\\bvereinzelt\\w*|\\bvor allem\\b|\\bv\\. ?a\\.?|\\bbesonders\\b|\\bhauptsächlich\\b|\\bhauptächlich\\b|\\büberwiegend\\b|\\bvorwiegend\\b|\\bmeist(ens)?\\b|\\bgelegentlich\\b|\\bzahlreich\\w*|\\bkaum\\b|\\bnur noch\\b|\\bbevorzugt\\w*|\\binsbesondere\\b|\\boft\\b|\\bhauptverbreitung\\w*|\\bschwerpunkt\\w*|\\bmassenhaft\\b|\\bgehäuft\\b|\\bin großer zahl\\b|\\bwenige[nrs]?\\b|\\bgroße[nr]? zahl|\\bvor allen\\b|\\bvornehmlich\\b|\\bspeziell\\b|\\beinzelne\\b|\\beinige\\b",
    beispielhaft:
        "\\bu\\. ?a\\.?|\\bz\\. ?b\\.?|\\bbeispielsweise\\b|\\bunter anderem\\b|\\betc\\b|\\busw\\b|\\buvm\\b|\\.\\.\\.|…|\\bund andere\\w*|\\bweitere\\w*|\\bwie\\b",
    unsicher:
        "\\?|\\bangeblich\\w*|\\bvermutlich\\b|\\bwohl\\b|\\bmöglicherweise\\b|\\bvielleicht\\b|\\beventuell\\b|\\bgerücht\\w*|\\bsoll(en)?\\b|\\bunbekannt\\w*|\\bunklar\\w*|\\bunsicher\\w*|\\bumstritten\\w*|\\blegende\\w*|\\bsagenhaft\\w*|\\bwahrscheinlich\\w*|\\bheißt es\\b|\\bvermut\\w*|\\bsichtung\\w*|\\bunbestätigt\\w*",
    historisch:
        "\\bfrüher\\w*|\\behemals\\b|\\behemalig\\w*|\\beinst\\b|\\bausgestorben\\w*|\\bvormals\\b|\\bausgerottet\\w*|\\bkaum noch\\b|\\bnicht mehr\\b|\\bverschwunden\\w*|\\bfrüheren zeiten\\b|\\bzeit(en)? (der|des)\\b|\\bvorzeit\\w*",
    herkunft:
        "\\bursprünglich\\w*|\\bheimat\\b|\\bstammt\\b|\\bstammen\\b|\\bstämmig\\b|\\beingeschleppt\\w*|\\beingeführt\\w*|\\bjetzt\\b|\\bheute\\b|\\bseit\\b|\\binzwischen\\b|\\bmittlerweile\\b|\\bneuerdings\\b|\\bnach dem\\b",
    jahreszeit:
        "\\bsommer\\w*|\\bwinter\\w*|\\bfrühling\\w*|\\bfrühjahr\\w*|\\bherbst\\w*|\\bregenzeit\\b|\\btrockenzeit\\b|\\bjahreszeit\\w*|\\büberwinter\\w*|\\bzugv\\w*|\\bmonat\\w*",
    volk: "\\bländer(n)? der\\b|\\bgebiete(n)? der\\b|\\bbei den\\b|\\bstämme\\w*|\\bsippe\\w*|\\bvolk\\b|\\bvölker\\w*|\\breiche(n)? der\\b|\\bheimat der\\b|\\bunter den\\b|\\bkulturen\\b",
    magisch:
        "sphäre|kraftlinie|nodix|dämon\\w*|namenlos\\w*|\\bmada\\b|\\bfeenw\\w*|globule|limbus|magisch\\w*|verseucht\\w*|verzauber\\w*|\\bzauber\\w*|niederhölle|astral\\w*|chimär\\w*|\\bgötter\\w*|\\bwillen\\b|borongefällig\\w*",
    haustier:
        "\\bhaustier\\w*|\\bnutztier\\w*|\\bgezüchtet\\w*|\\bzucht\\b|\\bgehalten\\b|\\bkulturpflanze\\w*|\\bangebaut\\w*|\\bwildform\\b|\\bkommt wild\\b|\\bnur wild\\b|\\bzwinger\\b|\\bals schutz\\b",
    handel: "gehandelt|\\bhandel\\w*|erhältlich|\\bmarkt|märkte|\\bimport\\w*|\\bexport\\w*|hergestellt|herstellung|produziert|produktion|gefertigt|manufaktur|werkstätten|werkstatt|händler|kaufleute|verkauft|getrunken|gegessen|beliebt|\\bbekannt\\b|genutzt|verwendet|getragen|\\bin gebrauch\\b|\\bgebräuchlich\\w*|\\büblich\\w*|benutzt|\\bgebraut\\w*|\\bgekeltert\\w*|abgebaut|gewonnen|\\bgefangen\\w*|\\bvertrieb\\w*|\\bschänken\\b|\\bhafenstädte\\b",
    geologie:
        "\\bgranit\\w*|\\bgneis\\w*|\\bbasalt\\w*|\\bkalkstein\\w*|\\blagerstätte\\w*|\\bmine\\b|\\bminen\\b|\\bbergwerk\\w*|\\berz\\w*|\\bgestein\\w*|\\bmarmor\\w*|\\bschiefer\\w*|\\bsandstein\\w*|\\badern?\\b|\\bflöz\\w*|\\bvulkan\\w*|\\bsternenregen\\b",
    ganz: "\\bganz(en|er|es|e)?\\s*§|\\büberall\\w*|\\bweit verbreitet\\b|\\bweitverbreitet\\b|§weit\\b|\\baventurienweit\\b|\\bweltweit\\b|\\bfast überall\\b|\\bgesamte[nrs]?\\s*§|\\bganz dere\\b|\\bganz aventurien\\b|\\balle landschaftstypen\\b",
    je_nach_art:
        "\\bje nach\\b|\\bsiehe\\b|\\bnach art\\b|\\bunterarten\\b|\\bverschieden\\w*|\\bunterschiedlich\\w*|\\bwechselnd\\w*",
    rand: "\\brand\\b|\\brändern?\\b|\\brandgebiet\\w*|\\brandbereich\\w*|\\brandzone\\w*|\\bsaum\\b|\\w+rand\\b|\\w+ränder\\b|\\w+randgebiete\\b|\\bgebirgsränder\\b|\\bwestrand\\b",
    naehe: "\\bnahe\\b|\\bnähe\\b|\\bum (die|den|das)\\b|\\bumgebung\\w*|\\bumland\\b|\\bvor den toren\\b|\\bbei\\b|\\bam\\b|\\ban der\\b|\\ban den\\b|\\bentlang\\w*|\\brund um\\b|\\bum\\s*§|\\bumliegend\\w*|\\bumgebend\\w*|\\bangrenzend\\w*|\\bnachbargebiet\\w*|\\bgegend\\b",
};
const MERKMAL_MUSTER: readonly (readonly [string, RegExp])[] = Object.entries(MERKMAL_QUELLEN).map(
    ([name, quelle]) => [name, muster(quelle)] as const,
);

const GRAMMATIK: ReadonlySet<string> = new Set([
    "",
    "s",
    "n",
    "e",
    "en",
    "er",
    "es",
    "ern",
    "ns",
    "em",
    "ischen",
    "isch",
    "ische",
    "isches",
    "ischer",
    "n-",
]);

const WORT_MUSTER = /[a-zäöüßA-ZÄÖÜ]+(?:-[a-zäöüßA-ZÄÖÜ]+)*-?/gu;
const STOP: ReadonlySet<string> = new Set(
    (
        "in im am an auf aus von vom der die das den dem des ein eine einem einen einer und oder sowie mit bei zu zum zur " +
        "als auch nur vor allem ganz ganzen alle allen sehr wie etwa ab um über unter nach durch kommt vorkommen ist sind " +
        "aber jedoch davon dort hier eher weiter weit fast nahezu große großen großer kleinere jeweils deren ihre ihr"
    ).split(" "),
);

/** Wörter, die nur einschränken oder die Aussage rahmen und nie als freier Text zählen (Python `qual_woerter`). */
export const QUAL_WOERTER = muster(
    "^(nördlich\\w*|südlich\\w*|östlich\\w*|westlich\\w*|nordöstlich\\w*|nordwestlich\\w*|südöstlich\\w*|" +
        "südwestlich\\w*|zentral\\w*|inner\\w*|ober\\w*|unter\\w*|mittler\\w*|norden|süden|osten|westen|" +
        "linie|zwischen|bis|selten\\w*|häufig\\w*|vereinzelt\\w*|besonders|insbesondere|hauptsächlich|" +
        "hauptächlich|überwiegend|vorwiegend|meist\\w*|gelegentlich|zahlreich\\w*|bevorzugt\\w*|speziell|" +
        "vornehmlich|einzelne|einige|wenige\\w*|überall\\w*|verbreitet\\w*|weitverbreitet|außer|ausser|" +
        "ausgenommen|nicht|ohne|keine?\\w*|ausnahme|früher\\w*|ehemals|ehemalig\\w*|einst|ursprünglich\\w*|" +
        "heimat|stammt|stammen|stämmig|jetzt|heute|seit|mittlerweile|umgebung|umland|nähe|nahe|entlang\\w*|" +
        "umliegend\\w*|umgebend\\w*|angrenzend\\w*|rand\\w*|ränder\\w*|gebiet\\w*|region\\w*|gegend\\w*|höhe\\w*|" +
        "oberhalb|unterhalb|schritt|tiefe|gesamte\\w*|dere|rund|vorkommen|haustier\\w*|nutztier\\w*|" +
        "angeblich|vermutlich|wohl|vielleicht|unbekannt|sichtungen|unbestätigte|etwa|wild|weiter|davon|" +
        "südlicher|nördlicher|östlicher|westlicher|süd|nord|ost|west|aventurisch\\w*|myranisch\\w*|land|länder|" +
        "provinzen|ganz\\w*|wie|art|arten|verschiedene\\w*|siehe|unterarten|kommt|ist|deren)$",
);

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Das Glied
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LINK = /\[\[\s*([^\]|#<>[]*?)\s*(#[^\]|]*)?(?:\|([^\]]*))?\]\]([a-zäöüß]*)/gu;
const PRAEFIX = /^(?:kategorie|datei|bild|vorlage):/iu;

export type LinkKlasse = ZielKlasse;

export interface GliedLink {
    cls: LinkKlasse;
    /** Der Titel des Ziels nach Weiterleitungen. */
    ziel: string;
    label: string;
    suffix: string;
    /** Bei einer Fläche der Karte: wie viele Flächen den Artikel tragen (Maraskan als Region und als Insel). */
    nFlaechen?: number;
    kompositum?: string;
    adjektiv?: boolean;
}

export interface GliedTyp {
    wort: string;
    /** Das Wort der Begriffstafel, über das es gelesen wurde (bei einem Kompositum der Kopf). */
    tafel: string;
    pillen: readonly string[];
    lage: string;
    gruppe: string;
    hinweis: string;
    form: WortForm | "linkkompositum";
}

export interface GliedKlima {
    wort: string;
    tafel: string;
    pillen: readonly string[];
    lage: string;
}

export interface GliedAnalyse {
    text: string;
    /** Der Text, in dem jeder Ortslink durch `§` ersetzt ist (Landschaftsart-Links bleiben als Wort). */
    aussen: string;
    links: GliedLink[];
    quals: ReadonlySet<string>;
    typen: GliedTyp[];
    klima: GliedKlima[];
    rest: string[];
    freitextFlaechen: { name: string; flaechen: readonly Flaeche[] }[];
}

/** Der Flächenname im Text ohne Link (Python `freitext_flaechen`): der längste Treffer zuerst. */
function freitextFlaechen(aussen: string, wissen: RegelWissen): { name: string; flaechen: readonly Flaeche[] }[] {
    const index = wissen.flaechenNamen();
    let t = aussen.toLowerCase();
    // „Nord- und Mittelaventurien“ → nordaventurien, mittelaventurien
    t = t.replace(
        muster("\\b(nord|süd|mittel|ost|west)-\\s*(und|,|bis)\\s*(nord|süd|mittel|ost|west)?(aventurien\\w*)", "gu"),
        (_treffer, a: string, b: string, c: string | undefined, d: string) => `${a}aventurien ${b} ${c ?? ""}${d}`,
    );
    const treffer: { name: string; flaechen: readonly Flaeche[] }[] = [];
    const tokens = t.match(/[\p{L}\p{N}_äöüß'’&-]+/gu) ?? [];
    const benutzt = tokens.map(() => false);
    for (const laenge of [6, 5, 4, 3, 2, 1]) {
        for (let i = 0; i + laenge <= tokens.length; i += 1) {
            if (benutzt.slice(i, i + laenge).some(Boolean)) continue;
            const kandidat = tokens.slice(i, i + laenge).join(" ");
            const formen = [
                kandidat,
                kandidat.endsWith("s") ? kandidat.slice(0, -1) : null,
                kandidat.endsWith("es") ? kandidat.slice(0, -2) : null,
                kandidat.endsWith("n") ? kandidat.slice(0, -1) : null,
            ];
            for (const form of formen) {
                if (form === null || form === "") continue;
                const flaechen = index.get(form);
                if (
                    flaechen !== undefined &&
                    wissen.tafel.eintrag(form) === undefined &&
                    !["wald", "see", "meer"].includes(form)
                ) {
                    treffer.push({ name: form, flaechen });
                    for (let k = i; k < i + laenge; k += 1) benutzt[k] = true;
                    break;
                }
            }
        }
    }
    return treffer;
}

/** Python `glied_analyse`. */
export function gliedAnalyse(glied: string, wissen: RegelWissen): GliedAnalyse {
    const teile: string[] = [];
    let pos = 0;
    const links: GliedLink[] = [];
    for (const m of glied.matchAll(LINK)) {
        const start = m.index ?? 0;
        teile.push(glied.slice(pos, start));
        pos = start + m[0].length;
        const ziel = (m[1] ?? "").trim();
        if (ziel === "" || PRAEFIX.test(ziel)) continue;
        let label = ((m[3] ?? "") !== "" ? (m[3] ?? "") : ziel).trim() + (m[4] ?? "");
        const aufgeloest = aufgeloesterTitel(normTitel(ziel), wissen);
        let cls: LinkKlasse = zielKlasse(normTitel(ziel), wissen);
        if (cls === "sonstiges" || cls === "fehlt" || cls === "region_ohne_flaeche") {
            const istWort = wissen.tafel.eintrag(aufgeloest.toLowerCase()) !== undefined;
            const labelAbbildung =
                cls !== "region_ohne_flaeche" &&
                (wissen.tafel.abbildung(label) !== undefined ||
                    wissen.tafel.eintrag(label.toLowerCase())?.gruppe === "klima");
            if (istWort || labelAbbildung || aufgeloest === "Dungeon") {
                cls = "landtyp";
                if (aufgeloest === "Dungeon") label = "Höhlen";
            }
        }
        if (cls === "landtyp" || cls === "bauwerksart") {
            teile.push(` ${label} `);
        } else {
            const endung = m[4] ?? "";
            teile.push(endung === "" ? " § " : ` §${endung} `);
            const eintrag: GliedLink = { cls, ziel: aufgeloest, label, suffix: endung };
            if (cls === "flaeche") eintrag.nFlaechen = wissen.flaechen(aufgeloest).length;
            links.push(eintrag);
        }
    }
    teile.push(glied.slice(pos));
    const aussen = teile.join("").replace(/\s+/gu, " ").trim();
    const klein = aussen.toLowerCase();
    const quals = new Set<string>();
    for (const [name, regex] of MERKMAL_MUSTER) if (regex.test(klein)) quals.add(name);

    const typen: GliedTyp[] = [];
    const klima: GliedKlima[] = [];
    const rest: string[] = [];
    const ohneMarken = aussen.replace(/§[\p{L}\p{N}_]*/gu, " ");
    const freitext = freitextFlaechen(ohneMarken, wissen);
    const freitextWoerter = new Set<string>();
    for (const eintrag of freitext) for (const wort of eintrag.name.split(" ")) freitextWoerter.add(wort);
    for (const wort of ohneMarken.match(WORT_MUSTER) ?? []) {
        const wl = wort.toLowerCase();
        if (STOP.has(wl) || freitextWoerter.has(wl) || freitextWoerter.has(wl.replace(/s+$/u, ""))) continue;
        const klimaEintrag = wissen.tafel.eintrag(wl);
        if (klimaEintrag !== undefined && klimaEintrag.gruppe === "klima") {
            klima.push({ wort: wl, tafel: klimaEintrag.wort, pillen: klimaEintrag.pillen, lage: klimaEintrag.lage });
            continue;
        }
        const abbildung = wissen.tafel.abbildung(wort);
        if (abbildung !== undefined) {
            typen.push({
                wort,
                tafel: abbildung.eintrag.wort,
                pillen: abbildung.eintrag.pillen,
                lage: abbildung.eintrag.lage,
                gruppe: abbildung.eintrag.gruppe,
                hinweis: abbildung.eintrag.vorgabe?.hinweis ?? "",
                form: abbildung.form,
            });
        } else {
            rest.push(wl);
        }
    }
    for (const eintrag of links) {
        const suffix = eintrag.suffix.toLowerCase();
        if (suffix !== "" && !GRAMMATIK.has(suffix)) {
            const abbildung = wissen.tafel.abbildung(`xxx${suffix}`) ?? wissen.tafel.abbildung(suffix);
            eintrag.kompositum = suffix;
            if (abbildung !== undefined) {
                typen.push({
                    wort: eintrag.label,
                    tafel: abbildung.eintrag.wort,
                    pillen: abbildung.eintrag.pillen,
                    lage: abbildung.eintrag.lage,
                    gruppe: abbildung.eintrag.gruppe,
                    hinweis: `${abbildung.eintrag.vorgabe?.hinweis ?? ""}${abbildung.eintrag.vorgabe?.hinweis ? "; " : ""}Kompositum am Link`,
                    form: "linkkompositum",
                });
            }
        }
        if (
            /(isch|ische|ischen|ischer|isches)$/u.test(eintrag.label.toLowerCase()) &&
            ["flaeche", "kontinent_av", "region_ohne_flaeche", "gebiet", "fremd"].includes(eintrag.cls)
        ) {
            eintrag.adjektiv = true;
        }
    }
    return { text: glied, aussen, links, quals, typen, klima, rest, freitextFlaechen: freitext };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Bausteine eines Glieds
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Baustein {
    art: string;
    wert: string;
    /** `auto`, `rueckfrage`, `luecke`, `nichts`, `egal`, `vage`. */
    q: string;
    grund: string;
    /** Bei einer Fläche: die Flächen der Karte; leer, wo es (noch) keine gibt (F4). */
    flaechen?: readonly Flaeche[];
    /** Eine Fläche ohne Zuweisung in der Karte (F4). */
    offen?: boolean;
    n?: number;
    bezug?: boolean;
    freitext?: boolean;
    /** Bei einem Wort: die Pillen der Begriffstafel. */
    pillen?: readonly string[];
    gruppe?: string;
    von?: string;
    bis?: string;
    kandidat?: string;
}

const ohneKlammer = (titel: string): string => titel.replace(/\s*\([^)]*\)\s*$/u, "").trim();

/** Die Klassen, bei denen die Analyse eine Fläche über den Namen fand (nach Siedlung, Gebiet und Bauwerk). */
const NAMENSWEG: ReadonlySet<string> = new Set(["region_ohne_flaeche", "gewaesser", "volk", "sonstiges", "fehlt"]);

/** Flächen, die so heißen wie der Artikel (auch ohne Klammerzusatz); nur um sie als Kandidaten zu nennen. */
function flaechenUeberName(titel: string, wissen: RegelWissen): readonly Flaeche[] {
    const index = wissen.flaechenNamen();
    const klein = titel.trim().toLowerCase();
    return index.get(klein) ?? index.get(klein.replace(/\s*\([^)]*\)\s*$/u, "")) ?? [];
}

const FLAECHEN_KLASSEN: ReadonlySet<string> = new Set(["flaeche", "kontinent_av"]);
const ORT_KLASSEN: ReadonlySet<string> = new Set(["siedlung", "bauwerk"]);
const LUECKE_LINK: Readonly<Record<string, string>> = {
    region_ohne_flaeche: "Fläche fehlt im Bestand",
    gebiet: "Herrschaftsgebiet ist keine Fläche",
    gewaesser: "Fluss ist ein Weg, keine Fläche",
    volk: "Volk oder Kultur ist kein Ort",
    fehlt: "kein Wiki-Artikel",
    sonstiges: "kein Ort (Gestein, Begriff, Person …)",
};

/** Die Gründe einer Lücke bei einem Wort, nach der Gruppe der Startwerte. */
function lueckeAusGruppe(gruppe: string): string {
    switch (gruppe) {
        case "fluss":
            return "luecke_fluss";
        case "siedlung":
            return "luecke_siedlung";
        case "unterwelt":
            return "luecke_unterwelt";
        default:
            return `luecke_${gruppe === "" ? "wort" : gruppe}`;
    }
}

/** Python `bausteine`: zerlegt ein innerstes Glied in seine Aussagen. */
export function bausteine(g: GliedAnalyse, fremdKontext: boolean, wissen: RegelWissen): Baustein[] {
    const b: Baustein[] = [];
    const quals = g.quals;
    const txt = g.aussen.trim();
    const links = g.links;
    const flaechen = links.filter((link) => FLAECHEN_KLASSEN.has(link.cls));
    const fremd = links.filter((link) => link.cls === "fremd");
    void fremd;
    // Bezugspunkte: Links in einer Linie oder nach „südlich von“ sind keine Orte.
    const bezug = quals.has("linie") || (quals.has("bezugspunkt") && !quals.has("teilflaeche"));
    for (const link of links) {
        const c = link.cls;
        if (FLAECHEN_KLASSEN.has(c)) {
            const gefunden = wissen.flaechen(link.ziel);
            const offen = gefunden.length === 0;
            b.push({
                art: "flaeche",
                wert: link.ziel,
                q: "auto",
                grund: "",
                flaechen: gefunden,
                offen,
                n: Math.max(1, gefunden.length),
                bezug,
            });
        } else if (ORT_KLASSEN.has(c)) {
            b.push({ art: "ortszeile", wert: link.ziel, q: "auto", grund: "", bezug });
        } else if (c === "fremd") {
            b.push({ art: "fremd", wert: link.ziel, q: "nichts", grund: "andere Welt" });
        } else if (c === "landtyp" || c === "bauwerksart") {
            // steht als Wort im Text
        } else if (
            NAMENSWEG.has(c) &&
            wissen.flaechen(ohneKlammer(link.ziel)).length > 0 &&
            ohneKlammer(link.ziel) !== link.ziel
        ) {
            // Der Artikel „Name (Region)“ fehlt oder ist keine Fläche, die Fläche trägt aber den Artikel „Name“: gemeint ist sie wohl, mit Rückfrage (Python `find_area_info`, Klammerweg).
            const treffer = wissen.flaechen(ohneKlammer(link.ziel));
            b.push({
                art: "flaeche",
                wert: link.ziel,
                q: "rueckfrage",
                grund: "Fläche über den Titel ohne Klammerzusatz",
                flaechen: treffer,
                offen: false,
                n: treffer.length,
                bezug,
                kandidat: "klammerzusatz",
            });
        } else if (NAMENSWEG.has(c) && flaechenUeberName(link.ziel, wissen).length > 0) {
            // Die Analyse fand diese Fläche über ihren Namen (Python `find_area_info`, nach Siedlung, Gebiet und Bauwerk): Die Fläche gibt es, aber ohne Wiki-Schlüssel hat sie den Artikel nie bestätigt.
            // F4: nie über einen Namen – die Bedingung bleibt offen, die Fläche steht als Kandidat daneben.
            const treffer = flaechenUeberName(link.ziel, wissen);
            b.push({
                art: "flaeche",
                wert: link.ziel,
                q: "rueckfrage",
                grund: "Fläche nur über den Namen gefunden",
                flaechen: [],
                offen: true,
                n: treffer.length,
                bezug,
                kandidat: (treffer[0] as Flaeche).name,
            });
        } else {
            // F4: `luecke_region_ohne_flaeche` (eine Region des Wikis ohne Fläche in der Karte) wird in der Bewertung eine offene Bedingung, die Regel wartet.
            b.push({ art: `luecke_${c}`, wert: link.ziel, q: "luecke", grund: LUECKE_LINK[c] ?? c, bezug });
        }
    }
    for (const eintrag of g.freitextFlaechen) {
        const kandidat = eintrag.flaechen[0];
        // Trägt eine Fläche den Artikel gleichen Namens (ihr Wiki-Schlüssel), ist sie gemeint, mit Rückfrage (kein Link bestätigt es); sonst bleibt die Bedingung offen (F4, nie über einen Namen).
        const mitSchluessel = wissen.flaechen(eintrag.name);
        b.push({
            art: "flaeche",
            wert: kandidat?.name ?? eintrag.name,
            q: "rueckfrage",
            grund: "Flächenname ohne Link",
            flaechen: mitSchluessel,
            offen: mitSchluessel.length === 0,
            n: eintrag.flaechen.length,
            bezug,
            freitext: true,
            ...(kandidat === undefined ? {} : { kandidat: kandidat.name }),
        });
    }
    for (const t of g.typen) {
        if (t.gruppe === "mikro" && t.pillen.length === 0) {
            b.push({ art: "mikro", wert: t.wort, q: "egal", grund: t.hinweis });
        } else if (t.pillen.length === 0) {
            if (t.lage === "offen" || t.lage === "neu") {
                b.push({
                    art: "luecke_wort_offen",
                    wert: t.wort,
                    q: "luecke",
                    grund: t.hinweis || "mehrdeutig",
                    gruppe: t.gruppe,
                });
            } else {
                b.push({
                    art: lueckeAusGruppe(t.gruppe),
                    wert: t.wort,
                    q: "luecke",
                    grund: t.hinweis,
                    gruppe: t.gruppe,
                });
            }
        } else {
            // Eine Zuweisung der Begriffstafel gilt als Entscheidung (Vali 2026-10-27, F5): auch eine Näherung ist automatisch. Nur ein Wort am Link („[[Perlenmeer]]küste“) bleibt eine Rückfrage.
            b.push({
                art: "typ",
                wert: t.wort,
                q: t.form === "linkkompositum" ? "rueckfrage" : "auto",
                grund: t.hinweis || t.lage,
                pillen: t.pillen,
                gruppe: t.gruppe,
                ...(t.form === "linkkompositum" ? { kandidat: "wort_am_link" } : {}),
            });
        }
    }
    for (const k of g.klima) {
        if (k.pillen.length === 0 && k.lage === "uebergehen") {
            // Ein allgemeines Wort („Klima“, „Breiten“) sagt nichts über eine Zone: Es engt nur ein und wird übergangen, wie ein Kleinstandort.
            b.push({ art: "mikro", wert: k.wort, q: "egal", grund: "allgemeines Klimawort ohne Aussage" });
        } else if (k.pillen.length === 0) {
            b.push({ art: "luecke_klima", wert: k.wort, q: "luecke", grund: "Klimaangabe ohne feste Zone" });
        } else {
            b.push({ art: "klima", wert: k.wort, q: "rueckfrage", grund: "Klimawort", pillen: k.pillen });
        }
    }
    const rest = g.rest.filter((wort) => wort.length > 2);
    const freitext = rest.filter((wort) => !QUAL_WOERTER.test(wort));
    if (freitext.length > 0 && !b.some((x) => ["flaeche", "ortszeile", "typ"].includes(x.art))) {
        b.push({ art: "freitext", wert: freitext.join(" "), q: "luecke", grund: "Freitext ohne Abbildung" });
    } else if (freitext.length > 0) {
        b.push({ art: "zusatz", wert: freitext.join(" "), q: "egal", grund: "Zusatztext" });
    }
    let aus = b;
    // Platzhalter
    if (/^[\s?§]*$/u.test(txt) && txt.includes("?") && links.length === 0) {
        aus = [{ art: "platzhalter", wert: "?", q: "nichts", grund: "Fragezeichen" }];
    }
    if (quals.has("je_nach_art") && links.length === 0 && g.typen.length === 0) {
        aus = [{ art: "je_nach_art", wert: txt, q: "nichts", grund: "je nach Art" }];
    }
    if (
        fremdKontext &&
        flaechen.length === 0 &&
        aus.every((x) =>
            [
                "fremd",
                "typ",
                "mikro",
                "klima",
                "zusatz",
                "luecke_region_ohne_flaeche",
                "luecke_gebiet",
                "luecke_volk",
                "luecke_fehlt",
                "luecke_sonstiges",
                "luecke_gewaesser",
                "freitext",
                "ortszeile",
            ].includes(x.art),
        )
    ) {
        aus = [{ art: "fremd", wert: txt, q: "nichts", grund: "im Kontext einer anderen Welt" }];
    }
    if (aus.some((x) => x.art === "fremd") && !aus.some((x) => x.art === "flaeche" || x.art === "ortszeile")) {
        aus = [{ art: "fremd", wert: txt, q: "nichts", grund: "andere Welt" }];
    }
    if (/\b(ganz|ganzen) dere\b/u.test(txt.toLowerCase())) {
        const av = wissen.flaechen("Aventurien");
        aus.push({
            art: "flaeche",
            wert: "Aventurien",
            q: "rueckfrage",
            grund: "„ganz Dere“ schließt Aventurien ein",
            flaechen: av,
            offen: av.length === 0,
            n: 1,
        });
    }
    return aus;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Verneinung und die Ebenen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const NEG_TEILEN = muster(
    "\\b(außer|ausser|ausgenommen|mit ausnahme(?: des| der| von)?|nicht|ohne|meidet|keine)\\b",
    "iu",
);

export interface NegierterTeil {
    wort: string;
    vor: string;
    nach: string;
    analyse: GliedAnalyse;
}

/** Python `negierter_teil`: der Teil eines Glieds hinter „außer“/„nicht“ als eigenes Glied (oder `null`). */
export function negierterTeil(g: GliedAnalyse, wissen: RegelWissen): NegierterTeil | null {
    const m = NEG_TEILEN.exec(g.text);
    if (m === null || !g.quals.has("negation")) return null;
    const vor = g.text.slice(0, m.index).trim();
    const nach = g.text.slice(m.index + m[0].length).trim();
    if (nach === "") return null;
    return { wort: (m[1] ?? "").toLowerCase(), vor, nach, analyse: gliedAnalyse(nach, wissen) };
}

/** Ein innerstes Glied mit seinem Rahmen. */
export interface InneresGlied {
    glied: GliedAnalyse;
    /** Die Flächen (Titel nach Weiterleitungen) der äußeren Ebenen, die letzte zuletzt. */
    kontext: string[];
    fremdKontext: boolean;
    tiefe: number;
    rolle: "innen" | "geschwister" | "kontextglied";
    zweig: number;
}

/**
 * Python `innerste`: Je Zweig die Glieder mit ihrem Kontext. Auf einer äußeren Ebene ist nur das LETZTE Glied (direkt vor dem Doppelpunkt) Kontext der nächsten Ebene; die Glieder davor sind eigene
 * Angaben („ganz [[Aventurien]] außer Maraskan, [[Meridiana]]: …“).
 */
export function innerste(feld: readonly (readonly (readonly GliedAnalyse[])[])[]): InneresGlied[] {
    const aus: InneresGlied[] = [];
    feld.forEach((zweig, zi) => {
        const kontext: string[] = [];
        let fremdKontext = false;
        zweig.forEach((ebene, ei) => {
            const letzte = ei === zweig.length - 1;
            ebene.forEach((g, gi) => {
                const istKontext = !letzte && gi === ebene.length - 1;
                if (istKontext) {
                    for (const link of g.links) {
                        if (FLAECHEN_KLASSEN.has(link.cls)) kontext.push(link.ziel);
                        if (link.cls === "fremd") fremdKontext = true;
                    }
                    if (/\b(myranor|uthuria|rakshazar|tharun)/u.test(g.aussen.toLowerCase())) fremdKontext = true;
                    // ein Kontext-Glied mit eigener Einschränkung bleibt zusätzlich als Angabe stehen
                    if (
                        ["negation", "teilflaeche", "bezugspunkt", "linie"].some((m) => g.quals.has(m)) ||
                        g.typen.length > 0
                    ) {
                        aus.push({
                            glied: g,
                            kontext: kontext.length > 0 ? kontext.slice(0, -1) : [],
                            fremdKontext,
                            tiefe: zweig.length,
                            rolle: "kontextglied",
                            zweig: zi,
                        });
                    }
                } else {
                    aus.push({
                        glied: g,
                        kontext: [...kontext],
                        fremdKontext,
                        tiefe: zweig.length,
                        rolle: letzte ? "innen" : "geschwister",
                        zweig: zi,
                    });
                }
            });
        });
    });
    return aus;
}

/** Ein Feld, in Zweige, Ebenen und Glieder zerlegt und gelesen. */
export function leseFeld(roh: string, wissen: RegelWissen): GliedAnalyse[][][] {
    return zerlegeFeld(roh).map((zweig) => zweig.map((ebene) => ebene.map((glied) => gliedAnalyse(glied, wissen))));
}

export { bereinigeFeld, teileOben, tafelWort };
