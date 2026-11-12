import { INHALTE_TITEL_MAX } from "@avesmaps3d/shared";
import sanitizeHtml from "sanitize-html";

/**
 * Der Titel einer abgerufenen Seite (WI-0277), rein, ohne Netz; Legacys Regel aus `api/_internal/linkcheck/page-title.php`.
 *
 * - **Die `<h1>` ist die bessere Quelle als der `<title>`** (Legacy, gemessen): Der `<title>` trägt bei jedem Wiki den Namen der Seite („Baronie Taubental – Almada Wiki“), die `<h1>` ist sauber. Ohne `<h1>` gilt
 *   der `<title>` (das ist neu: Legacy ließ den Titel dann leer).
 * - **Ist die `<h1>` nur der Name der Seite** (`<title>` „Amorîn – Herzogtum Weiden“, `<h1>` „Herzogtum Weiden“), gilt der Kopf des `<title>`.
 * - **Der Name des Korpus** fällt am `<title>` vorn oder hinten weg, wo es ihn gibt (herzogtum-weiden.net hat auf den Übersichten keine `<h1>`, gemessen: „Herzogtum Weiden | Geographie | Gewässer“).
 * - 🔴 **Fremder Text:** Heraus kommt ein einzeiliger Klartext ohne Markup, ohne Steuer- und Formatzeichen, höchstens `INHALTE_TITEL_MAX` Zeichen. Die Oberfläche zeigt ihn als Text; gespeichert wird er erst, wenn ein Mensch anhängt.
 * - 🔴 **Kein regulärer Ausdruck, der hin und zurück läuft:** Der Rumpf gehört einem Fremden; alles läuft in einem Durchgang über höchstens 128 KiB. Ein abgeschnittener Rumpf endet mitten im Markup und ergibt `""`, nie einen halben Tag.
 */

const TRENNER = [" – ", " — ", " - ", " | ", " · ", " :: "];

/** Der Text ohne Kommentare, Skripte und Styles: Eine `<h1>` im Kommentar ist keine. */
function ohneUnsichtbares(html: string): string {
    const anfang = /<!--|<(?:script|style|noscript|template)\b/giu;
    let aus = "";
    let stelle = 0;
    for (;;) {
        anfang.lastIndex = stelle;
        const treffer = anfang.exec(html);
        if (treffer === null) return aus + html.slice(stelle);
        aus += html.slice(stelle, treffer.index);
        const ende = new RegExp(treffer[0] === "<!--" ? "-->" : `</${treffer[0].slice(1)}[^>]{0,100}>`, "giu");
        ende.lastIndex = treffer.index + treffer[0].length;
        const schluss = ende.exec(html);
        if (schluss === null) return aus;
        stelle = schluss.index + schluss[0].length;
    }
}

function element(html: string, name: "h1" | "title"): string {
    const anfang = new RegExp(`<${name}(?:\\s[^>]{0,2000})?>`, "iu").exec(html);
    if (anfang === null) return "";
    const ende = new RegExp(`</${name}\\s*>`, "giu");
    ende.lastIndex = anfang.index + anfang[0].length;
    const schluss = ende.exec(html);
    return schluss === null ? "" : html.slice(anfang.index + anfang[0].length, schluss.index);
}

/** Markup zu einer Zeile Klartext. `sanitize-html` entschlüsselt die Entities beim Lesen und schreibt nur `&`, `<` und `>` wieder als Entity. */
export function klartext(markup: string): string {
    const text = sanitizeHtml(markup.replaceAll("<", " <"), { allowedTags: [], allowedAttributes: {} })
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&")
        .replace(/\p{Cf}/gu, "")
        .replace(/[\s\p{Cc}]+/gu, " ")
        .trim();
    return Array.from(text).slice(0, INHALTE_TITEL_MAX).join("");
}

/** Der `<title>` ohne den Namen des Korpus vorn oder hinten; steht nichts anderes darin, bleibt er. */
function ohneKorpusname(titel: string, korpusName: string | undefined): string {
    if (korpusName === undefined || korpusName === "") return titel;
    for (const trenner of TRENNER) {
        if (titel.startsWith(`${korpusName}${trenner}`)) return titel.slice(korpusName.length + trenner.length).trim();
        if (titel.endsWith(`${trenner}${korpusName}`))
            return titel.slice(0, -(korpusName.length + trenner.length)).trim();
    }
    return titel;
}

/** Der Titel der Seite; `""`, wo nichts zu lesen ist. */
export function leseSeitentitel(html: string, korpusName?: string): string {
    const sichtbar = ohneUnsichtbares(html);
    const ueberschrift = klartext(element(sichtbar, "h1"));
    const titel = klartext(element(sichtbar, "title"));
    if (ueberschrift === "") return ohneKorpusname(titel, korpusName);
    for (const trenner of TRENNER) {
        const zusatz = `${trenner}${ueberschrift}`;
        if (titel.length > zusatz.length && titel.endsWith(zusatz)) return titel.slice(0, -zusatz.length).trim();
    }
    return ueberschrift;
}
