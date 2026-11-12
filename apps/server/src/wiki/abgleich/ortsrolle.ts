import type { WikisyncOrtsrolle } from "@avesmaps3d/shared";

/**
 * Die Rolle einer Ortszeile eines Vorkommens (WI-0253, Scheibe Vorkommen, §23; Vali 2026-10-27, Knopfwahl „Ja, mit Rolle“, Knopftext von Claudia, kein Zitat). REIN: keine Datenbank, kein Dump.
 *
 * Legacy macht aus JEDEM Wikilink eines Ortsfelds eine Ortszeile mit Treffern. Die Regelbuch-Analyse (`review/wi-0253/regelbuch/regelbuch.md`, Abschnitt 5d) fand 453 Links in 329
 * Einträgen, die keine Orte sind: der Endpunkt einer Linie („zwischen Riva und Mengbilla“), der Bezugspunkt einer Richtung („nördlich der Khôm“), ein verneinter Ort („außer Wüste“), nur ein Teil
 * der Fläche („nördliches Bornland“), eine Landschaftsart („Küste“), ein Volk („Elfen“), ein früheres Vorkommen („ehemals“); dazu 724 Links in andere Welten. Hier bekommt jeder Link seine Rolle;
 * nur `ort` trifft. Die Erkennung ist der Nachbau der Analyse (`ortszeilen.py`, `lib.py`, `analyse.py`): das Feld in Zweige (`;`), Ebenen (`:`) und Glieder (`,`) zerlegen – Klammern und Links
 * geschützt –, je Glied die Merkmale („Linie“, „Richtung“, „Teilfläche“, „früher“, „Verneinung“) lesen und je Link die Art seines Ziels (`zielKlasse`) fragen.
 *
 * Die Reihenfolge der Entscheidung ist tragend: verneint vor Linie vor Richtung vor Teil vor Landschaftsart vor Volk vor früher vor andere Welt, sonst Ort.
 *
 * Gewollte Abweichungen von der Analyse, mit Grund:
 * - Die Art des Ziels kommt aus dem Dump (Infobox, wörtliche Kategorien, Weiterleitungen, `Region=` als Elternkette), nicht aus Legacys Flächenkatalog: „ist das Ziel eine Fläche der Karte“ fragt
 *   `ZielWissen.istFlaeche` (die Landschaften mit Wiki-Adresse). Der Namensweg der Analyse (Fläche über den Namen) entfällt: Aufgelöst wird nie über einen Namen.
 * - Das Wörterbuch der Landschaftsarten (Wald, Steppe …) der Regelvorschläge gehört der nächsten Scheibe. Hier zählt als Landschaftsart nur, was das Wiki selbst so auszeichnet (die
 *   Kategorien Vegetationszone, Derographisches Merkmal, Gewässerart, Hydroderographie ohne eigene Infobox): so zählt auch die Analyse ihre 128 Links.
 * - Kommt derselbe Link in einem Feld mehrmals vor, gewinnt `ort`, wenn eine Nennung einen Ort meint; sonst die Rolle der ersten Nennung (ein Link steht je Beziehung nur einmal in der Liste).
 */

/** Was der Dump über eine Seite weiß, so weit die Rolle es braucht (`dump/seiten-sammler.ts`). */
export interface ZielInfo {
    /** Das Ziel einer Weiterleitung (wörtlich, mit Abschnitt); die Seite ist sonst ein Artikel. */
    weiterleitung?: string;
    /** Der Name der ersten Infobox, wenn er für die Art des Ziels zählt oder die Seite eine zählende Kategorie trägt; sonst fehlt er (nicht: „keine Infobox“). */
    infobox?: string;
    /** Die zählenden wörtlichen Kategorien der Seite (aus den ersten 15). */
    kategorien?: readonly string[];
    /** Die Seiten, auf die `Region=` / `Kontinent=` der Infobox zeigen (höchstens vier). */
    eltern?: readonly string[];
    /** Die Seite trägt `{{Register Region}}` (so führt das Wiki seine Regionen, auch die ohne Infobox wie „Südaventurien“): Sie gilt dann als Region. */
    register?: "Region";
}

export interface ZielWissen {
    /** Die Seite zu einem Titel (genau wie der Dump ihn führt: erster Buchstabe groß); `undefined`: nichts Zählendes bekannt. */
    info(titel: string): ZielInfo | undefined;
    /** Ist der Titel die Wiki-Adresse einer Landschaft der Karte (eine Fläche)? */
    istFlaeche(titel: string): boolean;
}

/** Die Kategorien, die eine Seite zur Landschaftsart machen (ohne eigene Infobox), und weitere, die die Art des Ziels bestimmen. */
export const LANDTYP_KATEGORIEN: readonly string[] = [
    "Vegetationszone",
    "Derographisches Merkmal",
    "Gewässerart",
    "Hydroderographie",
];
export const ZAEHLENDE_KATEGORIEN: ReadonlySet<string> = new Set([
    ...LANDTYP_KATEGORIEN,
    "Bauwerksart",
    "Kontinent",
    "Globule",
    "Minderglobule",
]);

/** Infobox-Namen, die die Art eines Ziels bestimmen (siedlung, gebiet, bauwerk, region, gewässer, volk). */
export const ZAEHLENDE_INFOBOXEN: ReadonlySet<string> = new Set([
    "Region",
    "Siedlung",
    "Staat",
    "Fluss",
    "Bauwerk",
    "Lehreinrichtung",
    "Geschäft",
    "Spezies",
    "Kultur",
    "Organisation",
    "Familie",
    "Gott",
    "Wesen",
    "Dämon",
]);

/** Die Infoboxen, deren Elternkette (`Region=`, `Kontinent=`) die Welt eines Ziels bestimmt: Aventurien oder eine andere (`welten`). */
export const INFOBOXEN_MIT_WELT: ReadonlySet<string> = new Set(["Region", "Siedlung", "Staat", "Fluss", "Bauwerk"]);

const KONTINENTE: ReadonlySet<string> = new Set([
    "Aventurien",
    "Myranor",
    "Uthuria",
    "Rakshazar",
    "Lahmaria",
    "Vesayama",
    "Ras Tabor",
]);
const FREMDE_WELTEN: ReadonlySet<string> = new Set([
    "Myranor",
    "Uthuria",
    "Rakshazar",
    "Lahmaria",
    "Vesayama",
    "Ras Tabor",
    "Tharun",
    "Dere",
    "Feenwelt",
    "Limbus",
    "Niederhöllen",
    "Alveran",
    "Inseln im Nebel (Globule)",
]);

/** Wie Python `norm_title`: Unterstriche und Leerraum ein Leerzeichen, ein führender Doppelpunkt fällt weg, der erste Buchstabe groß (MediaWiki). */
export function normTitel(titel: string): string {
    let t = titel.replaceAll("_", " ").replace(/\s+/gu, " ").trim();
    if (t.startsWith(":")) t = t.slice(1).trim();
    return t === "" ? t : t.charAt(0).toUpperCase() + t.slice(1);
}

/** Folgt Weiterleitungen (höchstens vier), wie der Dump sie führt; der Abschnitt des Ziels fällt weg. Liefert den Titel der Seite, auf der sie enden. */
export function aufgeloesterTitel(titel: string, wissen: ZielWissen): string {
    let t = normTitel(titel);
    for (let schritt = 0; schritt < 4; schritt += 1) {
        const ziel = wissen.info(t)?.weiterleitung;
        if (ziel === undefined) break;
        t = normTitel((ziel.split("#")[0] ?? "").trim());
    }
    return t;
}

/** Welche Welten erreicht die Elternkette (`Region=`) einer Seite? `Globule` für eine Globule, sonst die Namen der Kontinente. */
function weltenVon(titel: string, wissen: ZielWissen, tiefe = 0, gesehen = new Set<string>()): Set<string> {
    const t = aufgeloesterTitel(titel, wissen);
    if (gesehen.has(t) || tiefe > 12) return new Set();
    gesehen.add(t);
    if (KONTINENTE.has(t) || t === "Tharun") return new Set([t]);
    const info = wissen.info(t);
    const kategorien = new Set(info?.kategorien ?? []);
    if (kategorien.has("Globule") || kategorien.has("Minderglobule")) return new Set(["Globule"]);
    const aus = new Set<string>();
    for (const eltern of info?.eltern ?? [])
        for (const welt of weltenVon(eltern, wissen, tiefe + 1, gesehen)) aus.add(welt);
    return aus;
}

export type ZielKlasse =
    | "kontinent_av"
    | "fremd"
    | "landtyp"
    | "bauwerksart"
    | "flaeche"
    | "siedlung"
    | "gebiet"
    | "bauwerk"
    | "region_ohne_flaeche"
    | "gewaesser"
    | "volk"
    | "sonstiges"
    | "fehlt";

/** Die Art eines Linkziels (Python `link_class`): erst die Seite nach Weiterleitungen, dann ihre Kategorien und Infobox. */
export function zielKlasse(ziel: string, wissen: ZielWissen): ZielKlasse {
    const r = aufgeloesterTitel(ziel, wissen);
    if (r === "Aventurien") return "kontinent_av";
    if (FREMDE_WELTEN.has(r)) return "fremd";
    const info = wissen.info(r);
    if (info === undefined) return wissen.istFlaeche(r) ? "flaeche" : "fehlt";
    const kategorien = new Set(info.kategorien ?? []);
    const eigeneInfobox = info.infobox ?? "";
    if (eigeneInfobox === "" && LANDTYP_KATEGORIEN.some((kategorie) => kategorien.has(kategorie))) return "landtyp";
    if (eigeneInfobox === "" && kategorien.has("Bauwerksart")) return "bauwerksart";
    if (kategorien.has("Kontinent")) return "fremd";
    if (kategorien.has("Globule") || kategorien.has("Minderglobule")) return "fremd";
    // Eine Region ohne Infobox (nur `{{Register Region}}`) gilt als Region; die Analyse fand sie über den Namen der Fläche, der hier nie zählt.
    const infobox = eigeneInfobox !== "" ? eigeneInfobox : info.register === "Region" ? "Region" : "";
    if (INFOBOXEN_MIT_WELT.has(infobox)) {
        const welten = weltenVon(r, wissen);
        if (welten.size > 0 && !welten.has("Aventurien")) return "fremd";
    }
    // Eine Fläche der Karte gewinnt vor Siedlung, Gebiet und Bauwerk (Python: Schlüssel der Fläche, nicht ihr Name).
    if (wissen.istFlaeche(r)) return "flaeche";
    if (infobox === "Siedlung") return "siedlung";
    if (infobox === "Staat") return "gebiet";
    if (infobox === "Bauwerk" || infobox === "Lehreinrichtung" || infobox === "Geschäft") return "bauwerk";
    if (infobox === "Region") return "region_ohne_flaeche";
    if (infobox === "Fluss") return "gewaesser";
    if (["Spezies", "Kultur", "Organisation", "Familie", "Gott", "Wesen", "Dämon"].includes(infobox)) return "volk";
    return "sonstiges";
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Das Feld zerlegen
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Python `clean`: Verweise, Kommentare und Tags weg, `<br>` ein Strichpunkt, `<small>` bleibt Text, Zeilenumbrüche ein Leerzeichen. */
export function bereinigeFeld(roh: string): string {
    let t = roh.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gu, "");
    t = t.replace(/<ref[^>]*\/>/gu, "");
    t = t.replace(/<!--[\s\S]*?-->/gu, "");
    t = t.replace(/<br\s*\/?>/giu, "; ");
    t = t.replace(/<small>([\s\S]*?)<\/small>/giu, " $1 ");
    t = t.replace(/<[^>]+>/gu, " ");
    t = t.replaceAll("\n", " ");
    return t.replace(/\s+/gu, " ").trim();
}

/** Python `split_top`: trennt an den Zeichen von `trenner`, nicht innerhalb von `[…]` und `(…)`. Leere Teile fallen weg. */
export function teileOben(text: string, trenner: string): string[] {
    const aus: string[] = [];
    let puffer = "";
    let eckig = 0;
    let rund = 0;
    for (const zeichen of text) {
        if (zeichen === "[") eckig += 1;
        else if (zeichen === "]") eckig = Math.max(0, eckig - 1);
        else if (zeichen === "(") rund += 1;
        else if (zeichen === ")") rund = Math.max(0, rund - 1);
        if (trenner.includes(zeichen) && eckig === 0 && rund === 0) {
            if (puffer.trim() !== "") aus.push(puffer.trim());
            puffer = "";
            continue;
        }
        puffer += zeichen;
    }
    if (puffer.trim() !== "") aus.push(puffer.trim());
    return aus;
}

/** Zweige (`;`), darin Ebenen (`:`), darin Glieder (`,`), wie Legacy: Klammern und Links geschützt. */
export function zerlegeFeld(roh: string): string[][][] {
    const aus: string[][][] = [];
    for (const zweig of teileOben(bereinigeFeld(roh), ";")) {
        const ebenen = teileOben(zweig, ":")
            .map((ebene) => teileOben(ebene, ","))
            .filter((glieder) => glieder.length > 0);
        if (ebenen.length > 0) aus.push(ebenen);
    }
    return aus;
}

const LINK = /\[\[\s*([^\]|#<>[]*?)\s*(#[^\]|]*)?(?:\|([^\]]*))?\]\]([a-zäöüß]*)/gu;
const PRAEFIX_ANALYSE = /^(?:kategorie|datei|bild|vorlage):/iu;
const PRAEFIX_LINKS = /^(?:kategorie|datei|bild|vorlage|category|file):/iu;

/** Die Ziele der Links eines Texts in der Reihenfolge, normiert; Kategorie, Datei, Bild und Vorlage zählen nicht. */
export function linkZiele(text: string): string[] {
    const aus: string[] = [];
    for (const treffer of text.matchAll(LINK)) {
        const ziel = (treffer[1] ?? "").trim();
        if (ziel === "" || PRAEFIX_LINKS.test(ziel)) continue;
        aus.push(normTitel(ziel));
    }
    return aus;
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Die Merkmale eines Glieds
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const WORTGRENZE = "(?:(?<=[\\p{L}\\p{N}_])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}_]))";
const WORTZEICHEN = "[\\p{L}\\p{N}_]";
/** Ein Muster der Analyse (Python `re`, Unicode): `\b` ist die Grenze zu Buchstaben, Ziffern und Unterstrich, `\w` ein solches Zeichen. */
function muster(quelle: string, flags = "u"): RegExp {
    return new RegExp(quelle.replaceAll("\\b", WORTGRENZE).replaceAll("\\w", WORTZEICHEN), flags);
}

type Merkmal = "negation" | "teilflaeche" | "bezugspunkt" | "linie" | "historisch";

const MERKMALE: Readonly<Record<Merkmal, RegExp>> = {
    negation: muster(
        "\\b(außer|ausser|ausgenommen|nicht|ohne|kein|keine|keinen|keinem|keiner|mit ausnahme|abgesehen|meidet|meiden)\\b",
    ),
    teilflaeche: muster(
        "\\b(nord|süd|ost|west)?(nördlich|südlich|östlich|westlich)(e|en|er|es|em)\\b|\\bzentral(e|en|er|es)\\b|\\binnere[nrs]?\\b|\\bobere[nrs]?\\b|\\buntere[nrs]?\\b|\\bmittlere[nrs]?\\b|\\b(im|in den|in der|den|dem|der|des|ganzen|hohen) ?(hohen |tiefen |äußersten |fernen )?(norden|süden|osten|westen|nordosten|nordwesten|südosten|südwesten)\\b|\\bunterlauf\\b|\\boberlauf\\b|\\b(nord|süd|ost|west)\\s*§",
    ),
    bezugspunkt: muster(
        "\\b(nord|süd|ost|west)?(nördlich|südlich|östlich|westlich)\\b|\\b(und|weiter) (südlicher|nördlicher|östlicher|westlicher)\\b|\\bnördlich davon\\b",
    ),
    linie: muster("\\blinie\\b|\\bzwischen\\b|\\bbis\\b|\\bgrenze\\w*|\\bjenseits\\b|\\bdiesseits\\b|§\\s*[-–]\\s*§"),
    historisch: muster(
        "\\bfrüher\\w*|\\behemals\\b|\\behemalig\\w*|\\beinst\\b|\\bausgestorben\\w*|\\bvormals\\b|\\bausgerottet\\w*|\\bkaum noch\\b|\\bnicht mehr\\b|\\bverschwunden\\w*|\\bfrüheren zeiten\\b|\\bzeit(en)? (der|des)\\b|\\bvorzeit\\w*",
    ),
};

const NEGATIONSWORT = muster(
    "\\b(außer|ausser|ausgenommen|mit ausnahme(?: des| der| von)?|nicht|ohne|meidet|keine)\\b",
    "iu",
);

/**
 * Die Merkmale eines Glieds (Python `glied_analyse`, nur was die Rolle braucht): Der Text, in dem jeder Link (außer Landschaftsart und Bauwerksart, die als Wort stehen bleiben) durch `§`
 * ersetzt ist, wird klein geschrieben auf die Muster gefragt.
 */
export function merkmaleDesGlieds(glied: string, wissen: ZielWissen): ReadonlySet<Merkmal> {
    let aussen = "";
    let pos = 0;
    for (const treffer of glied.matchAll(LINK)) {
        const start = treffer.index ?? 0;
        aussen += glied.slice(pos, start);
        pos = start + treffer[0].length;
        const ziel = (treffer[1] ?? "").trim();
        if (ziel === "" || PRAEFIX_ANALYSE.test(ziel)) continue;
        const endung = treffer[4] ?? "";
        const klasse = zielKlasse(normTitel(ziel), wissen);
        if (klasse === "landtyp" || klasse === "bauwerksart") {
            aussen += ` ${(((treffer[3] ?? "") || ziel).trim() + endung).trim()} `;
        } else {
            aussen += endung === "" ? " § " : ` §${endung} `;
        }
    }
    aussen += glied.slice(pos);
    const klein = aussen.replace(/\s+/gu, " ").trim().toLowerCase();
    const aus = new Set<Merkmal>();
    for (const [merkmal, regex] of Object.entries(MERKMALE) as [Merkmal, RegExp][]) {
        if (regex.test(klein)) aus.add(merkmal);
    }
    return aus;
}

const LINIE_KLASSEN: ReadonlySet<ZielKlasse> = new Set([
    "siedlung",
    "flaeche",
    "gewaesser",
    "region_ohne_flaeche",
    "bauwerk",
    "gebiet",
]);
const RICHTUNG_KLASSEN: ReadonlySet<ZielKlasse> = new Set([
    "siedlung",
    "flaeche",
    "gewaesser",
    "region_ohne_flaeche",
    "gebiet",
]);
const TEIL_KLASSEN: ReadonlySet<ZielKlasse> = new Set(["flaeche", "region_ohne_flaeche", "gebiet"]);

export interface LinkRolle {
    rolle: WikisyncOrtsrolle;
    /** Warum diese Rolle (kurz, für den Bericht); `null` bei `ort`. */
    grund: string | null;
}

const ORT: LinkRolle = { rolle: "ort", grund: null };

/** Die Rolle eines Links in einem Glied. */
function rolleImGlied(
    ziel: string,
    klasse: ZielKlasse,
    merkmale: ReadonlySet<Merkmal>,
    verneint: ReadonlySet<string>,
): LinkRolle {
    if (verneint.has(ziel)) return { rolle: "ausgenommen", grund: "ausdrücklich ausgenommen („außer …“, „nicht …“)" };
    if (merkmale.has("linie") && LINIE_KLASSEN.has(klasse))
        return { rolle: "bezugspunkt", grund: "Endpunkt einer Linie („zwischen A und B“)" };
    if (merkmale.has("bezugspunkt") && !merkmale.has("teilflaeche") && RICHTUNG_KLASSEN.has(klasse))
        return { rolle: "bezugspunkt", grund: "Bezugspunkt einer Richtung („südlich von A“)" };
    if (merkmale.has("teilflaeche") && TEIL_KLASSEN.has(klasse))
        return { rolle: "teil", grund: "nur ein Teil gemeint („nördliches A“)" };
    if (klasse === "landtyp") return { rolle: "landschaftsart", grund: "Landschaftsart statt Ort" };
    if (klasse === "volk") return { rolle: "volk", grund: "Volk oder Kultur statt Ort" };
    if (merkmale.has("historisch")) return { rolle: "frueher", grund: "früheres Vorkommen („ehemals …“)" };
    if (klasse === "fremd") return { rolle: "andere_welt", grund: "Ort einer anderen Welt" };
    return ORT;
}

/** Die Ziele hinter einem Verneinungswort im Text eines Glieds (Python `negierter_teil`); leer, wo das Glied nichts verneint. */
function verneinteZiele(glied: string, merkmale: ReadonlySet<Merkmal>): ReadonlySet<string> {
    if (!merkmale.has("negation")) return new Set();
    const treffer = NEGATIONSWORT.exec(glied);
    if (treffer === null) return new Set();
    const nach = glied.slice(treffer.index + treffer[0].length).trim();
    return nach === "" ? new Set() : new Set(linkZiele(nach));
}

/** Die Merkmale, die ein Kontextglied (das letzte Glied vor einem Doppelpunkt) braucht, damit seine Links eine Rolle bekommen (Python `innerste`). */
const KONTEXT_MERKMALE: readonly Merkmal[] = ["negation", "teilflaeche", "bezugspunkt", "linie"];

export interface FeldRolle extends LinkRolle {
    /** Das normierte Ziel des Links (wie `normTitel`). */
    ziel: string;
}

/**
 * Die Rollen aller Links eines Ortsfelds. Ein Link, der mehrmals vorkommt, bekommt EINE Rolle: `ort`, wenn eine Nennung einen Ort meint, sonst die der ersten Nennung. Das Ergebnis ist nach dem
 * kleingeschriebenen, normierten Ziel geschlüsselt.
 */
export function rollenImFeld(roh: string, wissen: ZielWissen): Map<string, FeldRolle> {
    const rollen = new Map<string, FeldRolle>();
    // Eine Nennung im Rahmen (ein Kontextglied ohne eigene Einschränkung) sagt nichts über die Rolle: Sie zählt nur, wenn keine andere Nennung des Links etwas sagt.
    const ausgewertet = new Set<string>();
    const merke = (ziel: string, rolle: LinkRolle, auswertbar: boolean): void => {
        const schluessel = ziel.toLowerCase();
        const bisher = rollen.get(schluessel);
        if (bisher === undefined) {
            rollen.set(schluessel, { ...rolle, ziel });
            if (auswertbar) ausgewertet.add(schluessel);
        } else if (auswertbar && !ausgewertet.has(schluessel)) {
            rollen.set(schluessel, { ...rolle, ziel });
            ausgewertet.add(schluessel);
        } else if (auswertbar && bisher.rolle !== "ort" && rolle.rolle === "ort") {
            rollen.set(schluessel, { ...rolle, ziel });
        }
    };
    for (const zweig of zerlegeFeld(roh)) {
        zweig.forEach((ebene, ebenenIndex) => {
            const letzte = ebenenIndex === zweig.length - 1;
            ebene.forEach((glied, gliedIndex) => {
                const merkmale = merkmaleDesGlieds(glied, wissen);
                const istKontext = !letzte && gliedIndex === ebene.length - 1;
                // Ein Kontextglied ohne eigene Einschränkung gibt nur den Rahmen und bekommt keine Rolle (seine Links bleiben Orte).
                const auswertbar = !istKontext || KONTEXT_MERKMALE.some((merkmal) => merkmale.has(merkmal));
                const verneint = verneinteZiele(glied, merkmale);
                for (const ziel of linkZiele(glied)) {
                    merke(
                        ziel,
                        auswertbar ? rolleImGlied(ziel, zielKlasse(ziel, wissen), merkmale, verneint) : ORT,
                        auswertbar,
                    );
                }
            });
        });
    }
    return rollen;
}
