import sanitizeHtml from "sanitize-html";

/**
 * Die Bereinigung des HTML einer Mail (WI-0268 C6b; Fachkonzept §3.4: „Positivliste (Absätze, Listen, Hervorhebungen, Links, Tabellen, Bilder); Skripte, Formulare, eingebettete Rahmen, Stile mit
 * Positionierung und Ereignis-Attribute fallen weg“). Gespeichert wird NUR das Ergebnis, nie die Rohfassung.
 *
 * - **Positivliste statt Sperrliste:** erlaubt sind allein `p br div span b strong i em u s ul ol li blockquote pre code h1-h6 table thead tbody tr td th a img hr`. Alles andere fällt weg (sein Text bleibt,
 *   außer bei `script`, `style` und Verwandten: dort fällt auch der Inhalt weg).
 * - **Attribute:** nur `a[href title target rel]`, `img[src alt width height data-extern]`, `td/th[colspan rowspan]`. KEIN `style`, keine Klassen, keine Ereignis-Attribute (`onload`, `onerror`, …).
 * - **Links:** nur `http`, `https`, `mailto`; jedes andere Schema (`javascript:`, `data:`, `vbscript:` und alles, was nach Entfernen von Leer- und Steuerzeichen so beginnt) und jeder Verweis ohne Schema
 *   verliert sein Ziel. Jeder Link bekommt `target="_blank" rel="noopener noreferrer"` und `title` mit seinem Ziel (der Leser sieht, wohin er führt).
 * - **Bilder:** `cid:`-Bilder, die zu einem übernommenen Anhang gehören, zeigen auf `cid:<Token>` (die Datenbank schreibt es beim Aufnehmen auf die App um, `community_mail_eingang`);
 *   `data:`-Bilder und `cid:`-Bilder ohne Anhang fallen weg. **Externe Bilder (`http`, `https`) verlieren ihre Adresse** und werden zu `<img data-extern="<Adresse>" alt="…">` OHNE `src`, gezählt
 *   (`externBilder`): Sie würden dem Absender verraten, wann gelesen wird; „Einmal laden“ der Oberfläche setzt `src` nur im Fenster der Lesenden.
 * - Die Oberfläche zeigt das Ergebnis zusätzlich in einem abgeschotteten `iframe` ohne Skriptrecht und mit eigener Inhaltsrichtlinie: Die Bereinigung ist eine von drei Schichten.
 */

/** Die Tags der Positivliste. */
export const ERLAUBTE_TAGS = [
    "p",
    "br",
    "div",
    "span",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "code",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
    "a",
    "img",
    "hr",
] as const;

/** Tags, deren Inhalt ganz wegfällt (nicht nur das Tag): Skripte, Stile, Rahmen, eingebettete Objekte. */
const OHNE_INHALT = [
    "script",
    "style",
    "textarea",
    "option",
    "noscript",
    "title",
    "head",
    "template",
    "xmp",
    "noembed",
    "noframes",
    "iframe",
    "frameset",
    "object",
    "embed",
    "applet",
    "svg",
    "math",
    "select",
    "button",
    "audio",
    "video",
    "canvas",
] as const;

/** So viel HTML bereinigt der Abruf höchstens (Zeichen); mehr bleibt als Text. */
export const HTML_MAX_ZEICHEN = 2_000_000;
/** So lang darf das Ergebnis höchstens sein, sonst gilt die Mail als „nur Text“ (die Datenbank begrenzt es ebenfalls). */
export const HTML_ERGEBNIS_MAX_ZEICHEN = 1_900_000;
const ZIEL_MAX = 2000;
const CID = /^[A-Za-z0-9._~@+=%-]{1,200}$/u;

export interface BereinigtesHtml {
    /** Das bereinigte HTML; `null`, wenn nichts übrig bleibt oder die Mail zu groß ist. */
    html: string | null;
    /** Wie viele Bilder aus dem Netz die Bereinigung blockiert hat. */
    externBilder: number;
}

/** Entfernt, was Browser in einer Adresse ignorieren (Leerzeichen, Tabulator, Zeilenumbruch, Steuerzeichen), und prüft das Schema. */
// eslint-disable-next-line no-control-regex
const OHNE_STEUER = /[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u2060\ufeff]+/gu;

/** Ein erlaubtes Linkziel (`http`, `https`, `mailto`) in bereinigter Form; `undefined`, wenn das Ziel nicht erlaubt ist. */
export function erlaubtesZiel(roh: string): string | undefined {
    const ziel = roh.replace(OHNE_STEUER, "");
    if (ziel === "" || ziel.length > ZIEL_MAX) return undefined;
    // Anführungszeichen, spitze Klammern und der Gravis gehören in einer Adresse nicht hin (sie wären prozentkodiert); wer sie schreibt, will ein Attribut aufbrechen.
    if (/["<>`]/u.test(ziel)) return undefined;
    if (!/^(?:https?:\/\/|mailto:)/iu.test(ziel)) return undefined;
    if (/^https?:\/\/$/iu.test(ziel)) return undefined;
    return ziel;
}

function ganzeZahl(wert: string | undefined, stellen: number): string | undefined {
    if (wert === undefined) return undefined;
    const text = wert.trim();
    return new RegExp(`^\\d{1,${String(stellen)}}$`, "u").test(text) ? text : undefined;
}

function entkodiert(token: string): string {
    try {
        return decodeURIComponent(token);
    } catch {
        return token;
    }
}

/**
 * Bereinigt das HTML. `cids` sind die Content-IDs der übernommenen eingebetteten Bilder (ohne `<>`; nur solche, die `CID` erfüllen); ein `cid:`-Bild ohne Treffer fällt weg.
 * Wirft nie wegen des Inhalts: Was nicht zu retten ist, ergibt `html: null`.
 */
export function bereinigeHtml(roh: string, optionen: { cids?: ReadonlySet<string> } = {}): BereinigtesHtml {
    if (roh.trim() === "" || roh.length > HTML_MAX_ZEICHEN) return { html: null, externBilder: 0 };
    const cids = optionen.cids ?? new Set<string>();
    let externBilder = 0;
    const ergebnis = sanitizeHtml(roh, {
        allowedTags: [...ERLAUBTE_TAGS],
        allowedAttributes: {
            a: ["href", "title", "target", "rel"],
            img: ["src", "alt", "width", "height", "data-extern"],
            td: ["colspan", "rowspan"],
            th: ["colspan", "rowspan"],
        },
        // Die Schemata prüft `transformTags` selbst (strenger: nach Entfernen von Leer- und Steuerzeichen); diese Liste ist die zweite Schicht.
        allowedSchemes: ["http", "https", "mailto"],
        allowedSchemesByTag: { img: ["cid"] },
        allowedSchemesAppliedToAttributes: ["href", "src"],
        allowProtocolRelative: false,
        disallowedTagsMode: "discard",
        nonTextTags: [...OHNE_INHALT],
        parseStyleAttributes: false,
        transformTags: {
            a: (tagName, attribs) => {
                const ziel = erlaubtesZiel(attribs["href"] ?? "");
                // Ohne erlaubtes Ziel bleibt nur der Text (ein Anker ohne Ziel ist kein Link).
                if (ziel === undefined) return { tagName: "span", attribs: {} };
                return {
                    tagName,
                    attribs: { href: ziel, title: ziel, target: "_blank", rel: "noopener noreferrer" },
                };
            },
            img: (tagName, attribs) => {
                const alt = attribs["alt"]?.slice(0, 200);
                const masse = {
                    ...(ganzeZahl(attribs["width"], 4) === undefined ? {} : { width: ganzeZahl(attribs["width"], 4) }),
                    ...(ganzeZahl(attribs["height"], 4) === undefined
                        ? {}
                        : { height: ganzeZahl(attribs["height"], 4) }),
                } as Record<string, string>;
                const quelle = (attribs["src"] ?? "").replace(OHNE_STEUER, "");
                if (/^cid:/iu.test(quelle)) {
                    const gefunden = [entkodiert(quelle.slice(4)), quelle.slice(4)].find(
                        (token) => cids.has(token) && CID.test(token),
                    );
                    // Ohne passenden Anhang gibt es nichts zu zeigen: Das Tag fällt unten weg (`exclusiveFilter`).
                    if (gefunden === undefined) return { tagName, attribs: {} };
                    return {
                        tagName,
                        attribs: { src: `cid:${gefunden}`, ...(alt === undefined ? {} : { alt }), ...masse },
                    };
                }
                const extern = erlaubtesZiel(quelle);
                if (extern !== undefined && /^https?:/iu.test(extern)) {
                    externBilder += 1;
                    return { tagName, attribs: { "data-extern": extern, alt: alt ?? "", ...masse } };
                }
                // `data:`, Dateien, alles andere: das Bild fällt weg.
                return { tagName, attribs: {} };
            },
            td: (tagName, attribs) => ({ tagName, attribs: zellen(attribs) }),
            th: (tagName, attribs) => ({ tagName, attribs: zellen(attribs) }),
        },
        exclusiveFilter: (frame) =>
            frame.tag === "img" && frame.attribs["src"] === undefined && frame.attribs["data-extern"] === undefined,
    });
    const html = ergebnis.trim();
    if (html === "" || html.length > HTML_ERGEBNIS_MAX_ZEICHEN) return { html: null, externBilder: 0 };
    return { html, externBilder };
}

function zellen(attribs: Record<string, string>): Record<string, string> {
    const aus: Record<string, string> = {};
    const spalten = ganzeZahl(attribs["colspan"], 3);
    const zeilen = ganzeZahl(attribs["rowspan"], 3);
    if (spalten !== undefined) aus["colspan"] = spalten;
    if (zeilen !== undefined) aus["rowspan"] = zeilen;
    return aus;
}

/** Ist das ein brauchbarer Token einer Content-ID (für `cid:` im HTML und die Spalte `cid`)? */
export const istCidToken = (token: string): boolean => CID.test(token);
