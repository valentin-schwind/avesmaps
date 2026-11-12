import type { MailAnhang, MailAnhangGrund } from "@avesmaps3d/shared";
import { anhangUrl } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Die Darstellung einer eingehenden Mail (WI-0268 C6b; Fachkonzept §3.4, Bedienkonzept §3.2): das BEREINIGTE HTML in einer abgeschotteten Fläche, ohne Skriptrecht, mit eigener Inhaltsrichtlinie. Rein, ohne DOM,
 * damit Node es prüft; die Fläche selbst ist `mail-ansicht.vue`.
 *
 * Drei Schichten, jede für sich genug gegen Skripte:
 * 1. Der Server bereinigt das HTML nach einer Positivliste (`apps/server/src/community/mail/html.ts`); es kommt nie roh hierher.
 * 2. Der `iframe` trägt `sandbox` OHNE `allow-scripts` und OHNE `allow-same-origin` (`MAIL_SANDBOX`): kein Skript, keine Anfrage mit den Cookies dieser Seite, kein Zugriff auf diese Seite. Nur Links dürfen in
 *    einem neuen Tab aufgehen.
 * 3. Im Dokument selbst steht eine Inhaltsrichtlinie (`mailCsp`): `default-src 'none'`, Bilder nur von der eigenen Herkunft oder als `data:` - und erst nach „Einmal laden“ auch von `https:`.
 *
 * 🔴 Externe Bilder (`data-extern`) laden nie von selbst: Sie verrieten dem Absender, wann gelesen wird. „Einmal laden“ gilt für diese eine Ansicht (kein Gedächtnis, keine Einstellung).
 * 🔴 Die eingebetteten Bilder (`cid:`) holt die Seite selbst mit den Cookies der Redaktion und reicht sie als `data:` hinein; das Fenster der Mail braucht dafür kein Recht und keinen Cookie.
 */

/** Die Rechte der abgeschotteten Fläche: Links dürfen in einem neuen Tab aufgehen, sonst nichts. Kein Skript, keine Herkunft. */
export const MAIL_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

/** Die Inhaltsrichtlinie im Dokument der Mail. `herkunft` ist die Herkunft dieser Seite; mit `extern` dürfen auch Bilder von `https:` laden („Einmal laden“). */
export const mailCsp = (herkunft: string, extern: boolean): string =>
    `default-src 'none'; img-src ${herkunft} data:${extern ? " https:" : ""}; style-src 'unsafe-inline'`;

/** Die Höhen der Fläche in Bildpunkten: ohne Skript ist der Inhalt nicht zu messen, also eine Schätzung mit Rollen. */
export const MAIL_HOEHE = { min: 96, max: 560, zeile: 22, block: 10, bild: 160 } as const;

/** Wie viele Bytes ein eingebettetes Bild haben darf, damit die Seite es als `data:` hineinreicht; größere bleiben aus (Ansehen und Herunterladen gibt es weiter). */
export const BILD_INLINE_MAX_BYTES = 4 * 1024 * 1024;

const BILD_PFAD = /src="(\/api\/community\/vorgaenge\/COM-\d{1,12}\/anhaenge\/\d{1,12})"/gu;

/** Die Adressen der eingebetteten Bilder im bereinigten HTML (von der Datenbank auf die App umgeschrieben), ohne Doppelte. */
export function eingebetteteBilder(html: string): string[] {
    const adressen = new Set<string>();
    for (const treffer of html.matchAll(BILD_PFAD)) {
        const adresse = treffer[1];
        if (adresse !== undefined) adressen.add(adresse);
    }
    return [...adressen];
}

const EXTERN = /\sdata-extern="([^"]*)"/gu;

/**
 * Das Dokument für `srcdoc`: Kopf mit Inhaltsrichtlinie und ruhigem Stil, darin das bereinigte HTML. `bilder` sind die eingebetteten Bilder, schon als `data:` (Adresse → `data:`); `extern` setzt das `src` der
 * blockierten Bilder aus `data-extern` („Einmal laden“). Das HTML ist die Ausgabe der Bereinigung (kanonisch, Attribute in doppelten Anführungszeichen), darum genügt hier das Ersetzen von Zeichenfolgen.
 */
export function baueSrcdoc(
    html: string,
    optionen: { herkunft: string; extern: boolean; bilder?: ReadonlyMap<string, string> | undefined },
): string {
    let inhalt = html.replace(BILD_PFAD, (voll, adresse: string) => {
        const daten = optionen.bilder?.get(adresse);
        return daten === undefined ? voll : `src="${daten}"`;
    });
    if (optionen.extern) inhalt = inhalt.replace(EXTERN, (_voll, adresse: string) => ` src="${adresse}"`);
    const csp = mailCsp(optionen.herkunft, optionen.extern).replaceAll('"', "&quot;");
    return (
        `<!doctype html><html><head><meta charset="utf-8">` +
        `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
        `<meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<style>` +
        `:root{color-scheme:light dark}` +
        `body{margin:8px;font:14px/1.45 system-ui,sans-serif;color:CanvasText;background:Canvas;overflow-wrap:anywhere}` +
        `img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{padding:2px 6px}` +
        `blockquote{margin:6px 0 6px 4px;padding-left:10px;border-left:3px solid GrayText}pre{white-space:pre-wrap}` +
        `a{color:LinkText}` +
        `</style></head><body>${inhalt}</body></html>`
    );
}

/** Schätzt die Höhe der Fläche aus dem Inhalt (Zeilen, Blöcke, Bilder); begrenzt auf `MAIL_HOEHE`, darüber rollt die Fläche. */
export function schaetzeHoehe(html: string): number {
    const text = html
        .replace(/<br\s*\/?>/giu, "\n")
        .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|pre)>/giu, "\n")
        .replace(/<[^>]*>/gu, "");
    const zeilen = text
        .split("\n")
        .reduce((summe, zeile) => summe + Math.max(1, Math.ceil(zeile.trim().length / 70)), 0);
    const bloecke = (html.match(/<(?:p|ul|ol|table|blockquote|pre|h[1-6])\b/giu) ?? []).length;
    const bilder = (html.match(/<img\b/giu) ?? []).length;
    const hoehe = 16 + zeilen * MAIL_HOEHE.zeile + bloecke * MAIL_HOEHE.block + bilder * MAIL_HOEHE.bild;
    return Math.min(MAIL_HOEHE.max, Math.max(MAIL_HOEHE.min, Math.round(hoehe)));
}

// --- Anhänge -----------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Die Größe als kurzer Satz („12 KB“, „1,4 MB“) in der Schreibweise der Sprache. */
export function groesseSatz(bytes: number): string {
    if (bytes < 1024) return `${formatNumber(bytes, 0)} B`;
    if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} KB`;
    return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

/** Das Zeichen der Art (Bild, PDF, sonst Blatt), ein abstraktes Zeichen wie in den übrigen Listen. */
export function anhangZeichen(anhang: Pick<MailAnhang, "mime" | "gesperrt">): string {
    if (anhang.gesperrt) return "⊘";
    if (anhang.mime.startsWith("image/")) return "▣";
    if (anhang.mime === "application/pdf") return "▤";
    return "▥";
}

/** Der Satz zu einem Anhang ohne Datei („Dateityp gesperrt, nicht übernommen“); `undefined`, wenn er eine Datei hat. */
export function anhangGrundSatz(grund: MailAnhangGrund | null): string | undefined {
    switch (grund) {
        case null:
            return undefined;
        case "typ":
            return t("community.mails.anhang.grund.typ");
        case "grenze":
            return t("community.mails.anhang.grund.grenze");
        case "entfernt":
            return t("community.mails.anhang.grund.entfernt");
    }
}

/** Die Adressen zu „Ansehen“ und „Herunterladen“; ohne Vorschau gibt es kein „Ansehen“, ohne Datei (gesperrt, entfernt) nichts von beidem. */
export function anhangAdressen(
    nummer: string,
    anhang: Pick<MailAnhang, "id" | "vorschau" | "gesperrt" | "grund">,
): { ansehen: string | undefined; laden: string | undefined } {
    if (anhang.gesperrt || anhang.grund !== null) return { ansehen: undefined, laden: undefined };
    return {
        ansehen: anhang.vorschau ? anhangUrl(nummer, anhang.id, true) : undefined,
        laden: anhangUrl(nummer, anhang.id),
    };
}

/** Der Satz unter dem HTML, wenn Bilder aus dem Netz blockiert sind: „1 externes Bild blockiert“ / „3 externe Bilder blockiert“. */
export const externSatz = (anzahl: number): string =>
    t(anzahl === 1 ? "community.mails.html.extern.eins" : "community.mails.html.extern.viele", {
        anzahl: String(anzahl),
    });
