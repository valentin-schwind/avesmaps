/**
 * Wiki-Text als Text (WI-0254): Links, Vorlagen und kleines HTML.
 *
 * Die Felder `gruppe` und `lebensraum` eines Vorkommens und die Notizen an Quellen-Verknüpfungen kommen roh aus dem Wiki und tragen MediaWiki-Syntax.
 * Die Oberfläche zeigt, was eine Leserin des Wikis sieht; der gespeicherte Rohwert bleibt unberührt, bis jemand das Feld ändert (siehe `wikiAnzeige`).
 *
 * - **Links:** `[[Pilz]]` ist ein Link auf den Artikel „Pilz“, `[[Graslandschaft|Grasland]]` ein Link mit Anzeigetext, `[[Höhle]]n` ein Link mit
 *   angehängter Endung (angezeigt „Höhlen“). Links auf Kategorie, Datei, Bild und Vorlage fallen weg.
 * - **Vorlagen:** `{{R5}}` (Regelstand), `{{Datum|1030|||}}` (aventurisches Datum) und weitere. In der lokalen Datenbank trägt gut jede neunte Notiz
 *   (5.406 von 48.820) eine Vorlage; ohne Auflösung stünde dort Quelltext. Die Regeln legte Claudia am 27.10. nach den Vorlagenseiten im Wiki-Dump fest
 *   (Vali überließ ihr das); die Tafeln darunter nennen ihre Herkunft. Vorlagen werden von innen nach außen aufgelöst, danach die Links.
 * - **HTML:** `<small>…</small>` zeigt den Inhalt, `<br>` und `&nbsp;` werden Leerzeichen.
 *
 * Das Gegenstück des Servers ist `klartext()` in `apps/server/src/wiki/regeln/ableiten.ts` (Python `plain`); es liest nur Links und wird hier nachgebaut,
 * weil das Web keinen Server-Code ziehen darf. Vorlagen und HTML liest nur das Web: Der Server rechnet mit den Infobox-Feldern, die Oberfläche zeigt
 * Freitext, und ein Freitext mit `{{…}}` ist für die Regelableitung ohne Belang.
 */

const LINK = /\[\[\s*([^\]|#<>[]*?)\s*(#[^\]|]*)?(?:\|([^\]]*))?\]\]([a-zäöüß]*)/gu;

/** Eine Vorlage ohne weitere Klammern darin: die innerste. Äußere entstehen erst, wenn die inneren aufgelöst sind. */
const INNERE_VORLAGE = /\{\{([^{}]*)\}\}/gu;

/** Wie viele Schichten verschachtelter Vorlagen aufgelöst werden; ein Wiki-Text hat zwei oder drei, mehr ist Müll und bleibt stehen. */
const MAX_TIEFE = 16;

/** Ein benannter Parameter (`x=…`): Er gehört nicht zu den Positionsparametern. */
const BENANNT = /^\s*[\p{L}\p{N}_][\p{L}\p{N}_ -]*=/u;

/**
 * Vorlagen, die immer denselben Text ergeben, ob mit Parametern oder ohne. Der Schlüssel ist der Name mit großem Anfangsbuchstaben
 * (MediaWiki unterscheidet nur dort nicht zwischen groß und klein; `{{r5}}` ist `{{R5}}`).
 *
 * - **Regelstand:** Wiki-Kategorie „Vorlage Quellenkommentar“. Im Wiki ein Symbol mit dem Regelwerk als Hinweistext; der Text ist der Hinweis.
 * - **Seitenindikatoren:** im Wiki nur ein Symbol (`DSA1` … `DSA5`, `Dunkle Zeiten`); der Text ist der Name des Regelwerks.
 */
const FESTE_VORLAGEN: Readonly<Record<string, string>> = {
    R1: "DSA1-Regeln",
    R2: "DSA2-Regeln",
    R3: "DSA3-Regeln",
    R4: "DSA4-Regeln",
    R5: "DSA5-Regeln",
    My4: "Myranor-DSA4-Regeln",
    My4beta: "Myranor-DSA4beta-Regeln",
    DZ: "DSA4-Dunkle Zeiten-Regeln",
    U4: "Uthuria-DSA4-Regeln",
    T4: "Tharun-DSA4-Regeln",
    RP: "Tharun-DSA-Professional-Regeln",
    DSA1: "DSA1",
    DSA2: "DSA2",
    DSA3: "DSA3",
    DSA4: "DSA4",
    DSA5: "DSA5",
    "Dunkle Zeiten": "Dunkle Zeiten",
};

/** Die Monde des aventurischen Kalenders (Vorlage:Datum): 1 bis 13, der 13. sind die Namenlosen Tage. */
const MONDE = [
    "Praios",
    "Rondra",
    "Efferd",
    "Travia",
    "Boron",
    "Hesinde",
    "Firun",
    "Tsa",
    "Phex",
    "Peraine",
    "Ingerimm",
    "Rahja",
    "Namenlose Tage",
] as const;

/** Statt eines Tages oder Mondes kann `A`, `M` oder `E` stehen: Anfang, Mitte oder Ende. */
const ZEITPUNKT: Readonly<Record<string, string>> = { A: "Anfang", M: "Mitte", E: "Ende" };

/** Die Präfix-Schalter von `Datum` (4. Parameter): Buchstabe und das Wort, das vor dem Datum steht. */
const DATUM_VORSATZ: Readonly<Record<string, string>> = {
    c: "etwa",
    v: "vor",
    n: "nach",
    b: "bis",
    a: "ab",
    s: "spätestens",
    f: "frühestens",
};

/** Ein Minus am Jahr kann als Bindestrich, Minuszeichen oder Gedankenstrich getippt sein. */
const MINUS = /^[-−–]\s*/u;

/** Eine Zahl ohne führende Nullen (`08` → `8`); alles andere bleibt, wie es steht. */
const alsZahl = (text: string): string => (/^\d+$/u.test(text) ? String(Number(text)) : text);

/** Der Zeitpunkt (Anfang, Mitte, Ende), wenn der Text einer ist. */
const zeitpunkt = (text: string): string | undefined => ZEITPUNKT[text.toUpperCase()];

/**
 * `Datum|Jahr|Mond|Tag|Schalter` (Vorlage:Datum): „Tag. Mond Jahr BF“, ohne Tag „Mond Jahr BF“, ohne Mond „Jahr BF“. Jahr mit führendem Minus heißt „N v. BF“.
 *
 * Der Schalter ist eine Folge von Buchstaben: `u` zeigt nur „unbekannt“; `c v n b a s f` setzen ein Wort davor („etwa“, „vor“, „nach“, „bis“, „ab“,
 * „spätestens“, „frühestens“); `m` lässt Mond und Tag weg, `t` den Tag, `J` das Jahr und `M` Mond und Jahr. `p w i -` und was sonst darin steht, ändern die
 * Anzeige hier nicht (sie steuern im Wiki Verlinkung und Hinweise).
 *
 * Eine Zahl, die kein Mond ist (0, 14, ein Wort), bleibt stehen, wie sie ist: Besser ein auffälliger Rest als ein erfundener Mond.
 */
function datum(parameter: readonly string[]): string {
    const [jahr = "", mond = "", tag = "", schalter = ""] = parameter;
    if (schalter.includes("u")) return "unbekannt";

    const teile: string[] = [];
    for (const zeichen of schalter) {
        const wort = DATUM_VORSATZ[zeichen];
        if (wort !== undefined) teile.push(wort);
    }

    const ohneTag = schalter.includes("t") || schalter.includes("m");
    const ohneMond = schalter.includes("m") || schalter.includes("M");
    const ohneJahr = schalter.includes("J") || schalter.includes("M");

    if (!ohneTag && tag !== "") {
        const punkt = zeitpunkt(tag);
        teile.push(punkt ?? (/^\d+$/u.test(tag) ? `${alsZahl(tag)}.` : tag));
    }
    if (!ohneMond && mond !== "") {
        const punkt = zeitpunkt(mond);
        const nummer = /^\d+$/u.test(mond) ? Number(mond) : 0;
        teile.push(punkt ?? MONDE[nummer - 1] ?? mond);
    }
    if (!ohneJahr && jahr !== "") {
        if (/\bBF\b/u.test(jahr)) teile.push(jahr);
        else if (MINUS.test(jahr)) teile.push(`${alsZahl(jahr.replace(MINUS, ""))} v. BF`);
        else teile.push(`${alsZahl(jahr)} BF`);
    }
    return teile.join(" ");
}

/** Der Name einer Vorlage, wie MediaWiki ihn nimmt: ohne Leerraum drumherum, Unterstrich wie Leerzeichen, der erste Buchstabe groß. */
function vorlagenName(roh: string): string {
    const name = roh.trim().replace(/[_\s]+/gu, " ");
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Die Parameter einer Vorlage, getrennt an `|` außerhalb von Links. `[[Graslandschaft|Grasland]]` in einem Parameter bleibt ganz: Der Strich darin
 * gehört dem Link, die Auflösung der Links kommt erst danach.
 */
function teileParameter(inhalt: string): string[] {
    const teile: string[] = [];
    let tiefe = 0;
    let anfang = 0;
    for (let i = 0; i < inhalt.length; i += 1) {
        const zwei = inhalt.slice(i, i + 2);
        if (zwei === "[[") {
            tiefe += 1;
            i += 1;
        } else if (zwei === "]]" && tiefe > 0) {
            tiefe -= 1;
            i += 1;
        } else if (inhalt[i] === "|" && tiefe === 0) {
            teile.push(inhalt.slice(anfang, i));
            anfang = i + 1;
        }
    }
    teile.push(inhalt.slice(anfang));
    return teile;
}

/**
 * Der Text einer Vorlage (`inhalt` ist alles zwischen `{{` und `}}`).
 *
 * 1. Feste Vorlagen (Regelstand, Seitenindikatoren) ergeben ihren Text.
 * 2. `Datum` rechnet das aventurische Datum (`datum`).
 * 3. `-|Jahr|Anzeige` (Verlinkung in die Chronik) und `Zauber|Ziel|Anzeige` zeigen die Anzeige, sonst Jahr und Ziel; `Tra|Wert` den Wert; `sic|Text`
 *    „Text [sic]“; `DaP|Titel` (im Wiki eine Abfrage nach der Datierung einer Publikation) „Datierung: Titel“.
 * 4. Jede andere Vorlage zeigt den ersten Positionsparameter (benannte `x=…` zählen nicht), ohne einen ihren Namen.
 */
function loeseVorlage(inhalt: string): string {
    const [nameRoh = "", ...rest] = teileParameter(inhalt);
    const name = vorlagenName(nameRoh);
    const fest = FESTE_VORLAGEN[name];
    if (fest !== undefined) return fest;

    const p = rest.filter((eins) => !BENANNT.test(eins)).map((eins) => eins.trim());
    const erster = p[0] ?? "";
    switch (name) {
        case "Datum":
            return datum(p);
        case "-":
        case "Zauber": {
            const anzeige = (p[1] ?? "") !== "" ? (p[1] ?? "") : erster;
            if (anzeige !== "") return anzeige;
            break;
        }
        case "Tra":
            if (erster !== "") return erster;
            break;
        case "Sic":
            if (erster !== "") return `${erster} [sic]`;
            break;
        case "DaP":
            if (erster !== "") return `Datierung: ${erster}`;
            break;
        default:
            break;
    }
    return p.length > 0 ? erster : nameRoh.trim();
}

/** Der Text mit jeder Vorlage durch ihre Anzeige ersetzt, von innen nach außen. Eine nicht geschlossene Vorlage bleibt, wie sie getippt wurde. */
function loeseVorlagen(text: string): string {
    let aktuell = text;
    for (let runde = 0; runde < MAX_TIEFE; runde += 1) {
        const neu = aktuell.replace(INNERE_VORLAGE, (_treffer, inhalt: string) => loeseVorlage(inhalt));
        if (neu === aktuell) break;
        aktuell = neu;
    }
    return aktuell;
}

/** Kleines HTML aus dem Wiki: `<small>` fällt weg (der Inhalt bleibt), `<br>` und `&nbsp;` werden Leerzeichen. */
function ohneHtml(text: string): string {
    return text
        .replace(/<\/?small\b[^>]*>/giu, "")
        .replace(/<br\b[^>]*>/giu, " ")
        .replace(/&nbsp;/giu, " ");
}

/**
 * Der Text so, wie ihn eine Leserin des Wikis sieht: Vorlagen aufgelöst, Links durch ihre Anzeigeform ersetzt, kleines HTML bereinigt, der Leerraum zu
 * einzelnen Leerzeichen zusammengezogen.
 */
export function wikiKlartext(text: string): string {
    return loeseVorlagen(ohneHtml(text))
        .replace(
            LINK,
            (_treffer, ziel: string, _anker: string | undefined, anzeige: string | undefined, endung: string) => {
                const z = ziel.trim();
                if (/^(?:kategorie|datei|bild|vorlage):/iu.test(z)) return "";
                return ((anzeige ?? "") !== "" ? (anzeige ?? "") : z).trim() + endung;
            },
        )
        .replace(/\s+/gu, " ")
        .trim();
}

/**
 * Der Text, den ein Feld zeigt, wenn sein Wert aus dem Wiki stammen kann (WI-0254): Solange der Entwurf den gespeicherten Rohwert hält, steht dort der
 * Klartext. Sobald jemand das Feld ändert, zeigt es genau diesen Wert und rechnet ihn nicht mehr um, damit sich nichts unter den Fingern verschiebt
 * (Leerzeichen, ein getippter Link), und gespeichert wird, was getippt wurde. `gespeichert` ist `undefined`, wo es keinen Stand des Servers gibt
 * (eine im Entwurf neu angelegte Zeile): Dort steht, was im Entwurf steht.
 */
export function wikiAnzeige(aktuell: string, gespeichert: string | undefined): string {
    return aktuell === gespeichert ? wikiKlartext(aktuell) : aktuell;
}
