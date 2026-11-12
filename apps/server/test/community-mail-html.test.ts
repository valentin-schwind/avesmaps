import { describe, expect, it } from "vitest";
import {
    ERLAUBTE_TAGS,
    HTML_MAX_ZEICHEN,
    bereinigeHtml,
    erlaubtesZiel,
    istCidToken,
} from "../src/community/mail/html.ts";

/**
 * Die Bereinigung des HTML eingehender Mails (WI-0268 C6b; Fachkonzept §3.4) gegen eine Sammlung bösartiger Mails. Rein, ohne Datenbank.
 *
 * Statt einzelner Suchwörter prüft jeder Fall die GANZE Ausgabe gegen die Positivliste: nur erlaubte Tags, nur erlaubte Attribute, Links nur mit `http`, `https`, `mailto`, Bilder nur als `cid:` oder
 * `data-extern`. Was ein Angreifer sich ausdenkt, muss daran scheitern - auch das, was diese Sammlung nicht kennt.
 */

const ERLAUBT = new Set<string>(ERLAUBTE_TAGS);
const ATTRIBUTE: Record<string, readonly string[]> = {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "width", "height", "data-extern"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
};

/** Prüft eine Ausgabe der Bereinigung gegen die Positivliste; gibt die Verstöße zurück (leer: sauber). */
function verstoesse(html: string | null): string[] {
    if (html === null) return [];
    const fehler: string[] = [];
    // Jedes `<` beginnt ein Tag der Liste; sonst ist es als `&lt;` geschrieben.
    for (const treffer of html.matchAll(/<(\/?)([^\s>/]*)([^>]*)>/gu)) {
        const [, schluss, name = "", rohRest = ""] = treffer;
        // Leere Tags schreibt die Bereinigung selbstschließend (`<br />`).
        const rest = rohRest.replace(/\s*\/$/u, "");
        if (!ERLAUBT.has(name.toLowerCase())) fehler.push(`Tag <${name}>`);
        if (schluss === "/" && rest.trim() !== "") fehler.push(`Schluss-Tag mit Inhalt: ${treffer[0]}`);
        const erlaubteAttribute = ATTRIBUTE[name.toLowerCase()] ?? [];
        const attribute = [...rest.matchAll(/\s([^\s=]+)(?:="([^"]*)")?/gu)];
        const ohneAttribute = rest.replace(/\s([^\s=]+)(?:="([^"]*)")?/gu, "").replace(/\s*\/?\s*$/u, "");
        if (ohneAttribute !== "") fehler.push(`unerwarteter Rest im Tag: ${treffer[0]}`);
        for (const [, attribut = "", wert = ""] of attribute) {
            if (!erlaubteAttribute.includes(attribut.toLowerCase())) fehler.push(`Attribut ${attribut} an <${name}>`);
            if (wert.includes("<") || wert.includes(">")) fehler.push(`Klammer im Wert von ${attribut}`);
            if (attribut === "href" && !/^(?:https?:\/\/|mailto:)/iu.test(wert)) fehler.push(`href ${wert}`);
            if (attribut === "src" && !/^cid:[A-Za-z0-9._~@+=%-]+$/u.test(wert)) fehler.push(`src ${wert}`);
            if (attribut === "data-extern" && !/^https?:\/\//iu.test(wert)) fehler.push(`data-extern ${wert}`);
            if (/javascript|vbscript|data:|expression/iu.test(wert) && attribut !== "title" && attribut !== "alt")
                fehler.push(`gefährlicher Wert in ${attribut}: ${wert}`);
        }
        if (name.toLowerCase() === "a" && schluss === "" && !/ rel="noopener noreferrer"/u.test(rest))
            fehler.push("Link ohne rel");
        if (name.toLowerCase() === "a" && schluss === "" && !/ target="_blank"/u.test(rest))
            fehler.push("Link ohne target");
    }
    // Außerhalb von Tags steht nie ein rohes `<`.
    if (/<(?![/a-z])/iu.test(html)) fehler.push("rohes <");
    return fehler;
}

const BOESE: readonly [string, string][] = [
    ["Skript", `<script>alert(1)</script><p>ok</p>`],
    ["Skript mit Quelle", `<script src="http://evil.example/x.js"></script>`],
    ["onerror", `<img src=x onerror=alert(1)>`],
    ["onerror mit cid", `<img src="cid:logo@x" onerror="alert(1)" onload="alert(2)">`],
    ["onload am body", `<body onload=alert(1)><p>x</p></body>`],
    ["onclick, class, id, data", `<p onclick="alert(1)" class="x" id="y" data-foo="bar" style="color:red">x</p>`],
    ["javascript-Link", `<a href="javascript:alert(1)">klick</a>`],
    ["javascript mit Großschreibung und Umbruch", `<a href="  JaVa\nScRiPt:alert(1)">klick</a>`],
    ["javascript mit Tabulator", `<a href="java\tscript:alert(1)">klick</a>`],
    ["javascript mit Entität (hex)", `<a href="jav&#x61;script:alert(1)">klick</a>`],
    ["javascript mit Entität (dezimal)", `<a href="&#106;&#97;vascript:alert(1)">klick</a>`],
    ["javascript mit benannter Entität", `<a href="javascript&colon;alert(1)">klick</a>`],
    ["javascript mit Steuerzeichen", `<a href="\u0001javascript:alert(1)">klick</a>`],
    ["data-Link", `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">klick</a>`],
    ["vbscript-Link", `<a href="vbscript:msgbox(1)">klick</a>`],
    ["file-Link", `<a href="file:///etc/passwd">klick</a>`],
    ["Link ohne Schema", `<a href="//evil.example/x">klick</a><a href="/x">y</a><a href="#z">z</a>`],
    ["Formular", `<form action="http://evil.example"><input name=x><button>go</button></form>`],
    ["iframe", `<iframe src="http://evil.example"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>`],
    ["object und embed", `<object data="x"></object><embed src="x"><applet code="x"></applet>`],
    ["svg mit onload", `<svg onload=alert(1)><circle r="5"/></svg>`],
    ["svg mit Skript", `<svg><script>alert(1)</script></svg>`],
    ["math", `<math><mi xlink:href="javascript:alert(1)">x</mi></math>`],
    ["Stil mit Positionierung", `<style>p{position:fixed;top:0;left:0;width:100%;height:100%}</style><p>x</p>`],
    ["Stilattribut mit url", `<p style="background:url(javascript:alert(1));position:fixed">x</p>`],
    ["CSS expression", `<p style="width:expression(alert(1))">x</p>`],
    ["base", `<base href="http://evil.example/"><a href="x">y</a>`],
    ["meta refresh", `<meta http-equiv="refresh" content="0;url=http://evil.example">`],
    ["link", `<link rel="stylesheet" href="http://evil.example/x.css">`],
    ["verschachtelt (scr<script>ipt)", `<scr<script>ipt>alert(1)</scr</script>ipt>`],
    ["verschachtelt (ohne Schluss)", `<<script>script>alert(1)<</script>/script>`],
    ["bedingter Kommentar", `<!--[if gte mso 9]><script>alert(1)</script><![endif]-->`],
    ["CDATA", `<![CDATA[<script>alert(1)</script>]]>`],
    ["Kommentar mit Skript", `<!-- --><script>alert(1)</script>`],
    ["data-Bild", `<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">`],
    ["Bild mit javascript", `<img src="javascript:alert(1)">`],
    ["Bild mit x:alert", `<img src=x:alert(alt) onerror=eval(src) alt=x>`],
    ["Bild mit Protokoll-relativer Adresse", `<img src="//evil.example/pixel.gif">`],
    [
        "Bild mit srcset und Hintergrund",
        `<img srcset="http://evil.example/a.gif 1x" src="cid:nirgends"><table background="javascript:alert(1)"><tr><td>x</td></tr></table>`,
    ],
    ["noscript-Trick (mXSS)", `<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>`],
    ["textarea-Trick", `<textarea><script>alert(1)</script></textarea>`],
    ["title-Trick", `<title><script>alert(1)</script></title>`],
    ["Zellen mit Angriff", `<table><tr><td colspan="2;alert(1)" rowspan="3" onclick="alert(1)">x</td></tr></table>`],
    ["Entität im Tag-Namen", `<scr&#x69;pt>alert(1)</scr&#x69;pt>`],
    ["Tag mit Schrägstrich", `<img/src=x/onerror=alert(1)>`],
    [
        "select und button",
        `<select><option onclick="alert(1)">x</option></select><button onclick="alert(1)">y</button>`,
    ],
    [
        "audio und video",
        `<video src="http://evil.example/v.mp4" onerror="alert(1)" autoplay></video><audio src="x" onerror="alert(1)"></audio>`,
    ],
    ["Anführungszeichen im Wert", `<a href='http://ok.example/" onmouseover="alert(1)'>x</a>`],
    ["Titel mit Skript", `<a href="http://ok.example/" title="x&quot; onmouseover=&quot;alert(1)">x</a>`],
    ["Tag mit Großschreibung", `<ScRiPt>alert(1)</sCrIpT><IMG SRC=x ONERROR=alert(1)>`],
    ["Tag mit Leerzeichen", `< script >alert(1)</ script >`],
    ["listing und plaintext", `<xmp><script>alert(1)</script></xmp><plaintext><script>alert(1)</script>`],
];

describe("Mail-HTML: Bereinigung gegen bösartige Mails", () => {
    for (const [name, roh] of BOESE) {
        it(`🔴 ${name}: übrig bleibt nur, was die Positivliste erlaubt`, () => {
            const ergebnis = bereinigeHtml(roh, { cids: new Set(["logo@x"]) });
            expect(verstoesse(ergebnis.html), String(ergebnis.html)).toEqual([]);
            const klein = (ergebnis.html ?? "").toLowerCase();
            for (const wort of [
                "<script",
                "onerror",
                "onload",
                "onclick",
                "onmouseover",
                "javascript:",
                "vbscript:",
                "<iframe",
                "<form",
                "<object",
                "<embed",
                "<svg",
                "<style",
                "<base",
                "<meta",
                "<link",
                "expression(",
            ])
                expect(klein, wort).not.toContain(wort);
        });
    }

    it("🔴 die Sammlung zusammen: ein einziges HTML aus allen Fällen bleibt sauber", () => {
        const alles = BOESE.map(([, roh]) => roh).join("\n");
        const ergebnis = bereinigeHtml(alles, { cids: new Set(["logo@x"]) });
        expect(verstoesse(ergebnis.html)).toEqual([]);
    });
});

describe("Mail-HTML: was bleibt", () => {
    it("Absätze, Listen, Hervorhebungen, Tabellen und Zitate bleiben, jeder Tag der Positivliste", () => {
        const roh =
            "<h1>Titel</h1><p>Hallo <b>fett</b>, <strong>stark</strong>, <i>schräg</i>, <em>betont</em>, <u>unterstrichen</u>, <s>durchgestrichen</s> und<br>Umbruch.</p>" +
            "<div><span>Spanne</span></div><ul><li>eins</li></ul><ol><li>zwei</li></ol><blockquote>Zitat</blockquote><pre><code>code</code></pre><hr>" +
            '<table><thead><tr><th colspan="2">Kopf</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr></tbody></table>';
        const ergebnis = bereinigeHtml(roh);
        expect(ergebnis.html).not.toBeNull();
        for (const tag of [
            "h1",
            "p",
            "b",
            "strong",
            "i",
            "em",
            "u",
            "s",
            "div",
            "span",
            "ul",
            "ol",
            "li",
            "blockquote",
            "pre",
            "code",
            "table",
            "thead",
            "tbody",
            "tr",
            "th",
            "td",
        ])
            expect(ergebnis.html, tag).toContain(`<${tag}`);
        expect(ergebnis.html).toContain("<br />");
        expect(ergebnis.html).toContain("<hr />");
        expect(ergebnis.html).toContain('colspan="2"');
        expect(ergebnis.html).toContain('rowspan="2"');
        expect(verstoesse(ergebnis.html)).toEqual([]);
    });

    it("die Tags, die nicht auf der Liste stehen, fallen weg, ihr Text bleibt; Skript und Stil fallen mit Inhalt weg", () => {
        const ergebnis = bereinigeHtml(
            "<center><font color=red>sichtbar</font></center><script>geheim()</script><style>.x{}</style><h7>auch</h7>",
        );
        expect(ergebnis.html).toContain("sichtbar");
        expect(ergebnis.html).toContain("auch");
        expect(ergebnis.html).not.toContain("geheim");
        expect(ergebnis.html).not.toContain(".x");
        expect(ergebnis.html).not.toContain("<center");
        expect(ergebnis.html).not.toContain("<font");
    });

    it("Links: nur http, https und mailto; jeder Link bekommt target, rel und title mit seinem Ziel", () => {
        const ergebnis = bereinigeHtml(
            '<a href="https://example.org/ziel?a=1&b=2" onclick="x()">https</a> <a href="http://example.org/">http</a> <a href="mailto:a@b.de?subject=Hallo">mail</a> <a href="javascript:alert(1)">js</a> <a name="anker">anker</a>',
        );
        const html = ergebnis.html ?? "";
        expect(html).toContain('href="https://example.org/ziel?a=1&amp;b=2"');
        expect(html).toContain('title="https://example.org/ziel?a=1&amp;b=2"');
        expect(html).toContain('href="http://example.org/"');
        expect(html).toContain('href="mailto:a@b.de?subject=Hallo"');
        expect(html.match(/target="_blank"/gu)).toHaveLength(3);
        expect(html.match(/rel="noopener noreferrer"/gu)).toHaveLength(3);
        expect(html).not.toContain("javascript");
        expect(html).toContain("js");
        expect(html).toContain("anker");
        expect(verstoesse(html)).toEqual([]);
    });

    it("erlaubtesZiel: Schema nach dem Entfernen von Leer- und Steuerzeichen, Länge begrenzt", () => {
        expect(erlaubtesZiel("https://example.org/")).toBe("https://example.org/");
        expect(erlaubtesZiel("  HTTP://example.org/a b ")).toBe("HTTP://example.org/ab");
        expect(erlaubtesZiel("mailto:a@b.de")).toBe("mailto:a@b.de");
        for (const schlecht of [
            "",
            "javascript:alert(1)",
            "java\nscript:alert(1)",
            "data:text/html,x",
            "//evil/x",
            "/pfad",
            "#anker",
            "ftp://example.org/",
            "https://",
            'https://example.org/"x',
            "https://example.org/<x>",
            "https://example.org/`x",
            `https://example.org/${"a".repeat(2100)}`,
        ])
            expect(erlaubtesZiel(schlecht), schlecht).toBeUndefined();
    });
});

describe("Mail-HTML: Bilder", () => {
    it("🔴 externe Bilder verlieren ihre Adresse als src, behalten sie als data-extern und werden gezählt", () => {
        const ergebnis = bereinigeHtml(
            '<p>Hallo</p><img src="https://tracker.example/pixel.gif?id=42" alt="Pixel" width="1" height="1"><img src="http://tracker.example/b.png" width="100%"><img src="//evil.example/c.png">',
        );
        const html = ergebnis.html ?? "";
        expect(ergebnis.externBilder).toBe(2);
        expect(html).toContain('data-extern="https://tracker.example/pixel.gif?id=42"');
        expect(html).toContain('data-extern="http://tracker.example/b.png"');
        expect(html).not.toMatch(/\ssrc=/u);
        expect(html).toContain('width="1"');
        // Eine Breite in Prozent (kein ganzes Zahlenwort) fällt weg.
        expect(html).not.toContain("100%");
        expect(html).not.toContain("evil.example");
        expect(verstoesse(html)).toEqual([]);
    });

    it("cid-Bilder mit passendem Anhang zeigen auf cid:<Token> (die Datenbank schreibt es auf die App um); ohne Anhang fällt das Bild weg", () => {
        const ergebnis = bereinigeHtml(
            '<img src="cid:logo@avesmaps.de" alt="Logo"><img src="cid:fehlt@x"><img src="CID:logo%40avesmaps.de">',
            {
                cids: new Set(["logo@avesmaps.de"]),
            },
        );
        const html = ergebnis.html ?? "";
        expect(html.match(/src="cid:logo@avesmaps\.de"/gu)).toHaveLength(2);
        expect(html).not.toContain("fehlt");
        expect(ergebnis.externBilder).toBe(0);
        expect(verstoesse(html)).toEqual([]);
    });

    it("data-Bilder fallen weg, auch mit gültigem Bildinhalt", () => {
        const ergebnis = bereinigeHtml('<p>x</p><img src="data:image/png;base64,iVBORw0KGgo=">');
        expect(ergebnis.html).not.toContain("data:");
        expect(ergebnis.html).not.toContain("<img");
        expect(ergebnis.externBilder).toBe(0);
    });

    it("ein selbst gesetztes data-extern oder src am Bild wird nie übernommen", () => {
        const ergebnis = bereinigeHtml(
            '<img data-extern="http://evil.example/x.gif" src="cid:logo@x"><img data-extern="javascript:alert(1)" src="x">',
            {
                cids: new Set(["logo@x"]),
            },
        );
        expect(ergebnis.html).not.toContain("evil.example");
        expect(ergebnis.html).not.toContain("javascript");
        expect(ergebnis.externBilder).toBe(0);
    });

    it("istCidToken lässt nur die einfachen Zeichen zu", () => {
        expect(istCidToken("logo@avesmaps.de")).toBe(true);
        expect(istCidToken("a.b-c_d~e+f=g%20")).toBe(true);
        for (const schlecht of ["", 'a"b', "a b", "a<b", "a'b", "a>b", "a/b", "a\\b", "a".repeat(201)])
            expect(istCidToken(schlecht), schlecht).toBe(false);
    });
});

describe("Mail-HTML: Grenzen", () => {
    it("leeres oder zu großes HTML ergibt null; ein Rest ohne sichtbaren Inhalt ebenfalls", () => {
        expect(bereinigeHtml("").html).toBeNull();
        expect(bereinigeHtml("   \n  ").html).toBeNull();
        expect(bereinigeHtml("<script>alert(1)</script>").html).toBeNull();
        expect(bereinigeHtml(`<p>${"a".repeat(HTML_MAX_ZEICHEN)}</p>`).html).toBeNull();
    });

    it("tief verschachteltes HTML läuft durch, ohne zu kippen", () => {
        const tief = `${"<div>".repeat(2000)}x${"</div>".repeat(2000)}`;
        expect(() => bereinigeHtml(tief)).not.toThrow();
    });
});
