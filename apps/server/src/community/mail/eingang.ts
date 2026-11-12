import { createHash } from "node:crypto";
import { simpleParser, type Attachment } from "mailparser";
import sharp from "sharp";
import type { Ablage } from "./ablage.ts";
import { bereinigeHtml, istCidToken } from "./html.ts";
import type { PostfachMail } from "./postfach.ts";

/**
 * Eine eingehende Mail verarbeiten (WI-0268 C6b; Fachkonzept §3.4): Roh-MIME lesen, Text und bereinigtes HTML gewinnen, Anhänge prüfen, sperren oder neu kodieren und in die Ablage legen. Rein bis auf die
 * Ablage: Die Datenbank kennt dieses Modul nicht; der Abrufjob übergibt das Ergebnis an `community_mail_eingang`.
 *
 * - **Rohmail** in die Ablage (privat, Name = SHA-256), nie direkt gezeigt: Quelle für Nachweis und Neudarstellung.
 * - **Text** (voll, höchstens 1 Mio. Zeichen) und **HTML** (nur bereinigt, `html.ts`); `cid:`-Bilder werden zu Anhängen, die die App ausliefert.
 * - **Anhänge:** höchstens 25 MB je Mail (was darüber liegt: Name und Größe, „über der Grenze, nicht übernommen“). Die **Sperrliste** (Endung und MIME) verwirft ausführbare Dateien, Skripte, Dokumente
 *   mit Makros, Archive und aktive Seiten: Name und Größe bleiben, die Datei nie. Bilder (JPEG, PNG, GIF, WebP) werden mit `sharp` neu kodiert, ohne Metadaten; was `sharp` nicht lesen kann, wird gesperrt.
 *   Alles andere Erlaubte (PDF, Text, …) liegt unverändert, zum Herunterladen.
 * - **Dateinamen** werden gesäubert (kein Pfad, keine Steuerzeichen, höchstens 120 Zeichen).
 * - 🔴 Was nicht zu lesen ist, ist kein Absturz des Abrufs: Eine Mail, die der Parser nicht versteht, wird als „nicht lesbar“ eingetragen (Kopfzeilen und Rohmail bleiben), damit sie nicht verloren geht
 *   und der Abruf nicht an ihr hängt.
 */

/** Höchstens so viele Bytes Anhänge je Mail (die Summe der übernommenen). */
export const ANHANG_GRENZE_BYTES = 25 * 1024 * 1024;
/** Der volle Text einer Mail wird bei so vielen Zeichen abgeschnitten. */
export const TEXT_MAX_ZEICHEN = 1_000_000;
/** Der Dateiname eines Anhangs wird auf so viele Zeichen gekürzt. */
export const DATEINAME_MAX = 120;
const BETREFF_MAX = 998;
const MAX_ANHAENGE = 200;
const MAX_VERWEISE = 50;

export type AnhangGrund = "typ" | "grenze";

export interface MailFuerDatenbank {
    messageId: string;
    inReplyTo: string | null;
    verweise: string[];
    vonAdresse: string | null;
    vonName: string | null;
    betreff: string;
    text: string | null;
    html: string | null;
    externBilder: number;
    hinweis: "zu_gross" | "unlesbar" | null;
    rohDatei: string | null;
    groesse: number;
    uid: number;
    uidvalidity: number;
}

export interface AnhangFuerDatenbank {
    dateiname: string;
    mime: string;
    groesse: number;
    datei: string | null;
    cid: string | null;
    grund: AnhangGrund | null;
}

export interface VerarbeiteteMail {
    mail: MailFuerDatenbank;
    anhaenge: AnhangFuerDatenbank[];
}

// --- Sperrliste ------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Endungen, die nie übernommen werden: ausführbar, Skript, Abbild, Makro-Dokument, Archiv, aktive Seite (Fachkonzept §3.4: „Gefährliche Anhänge“). */
export const GESPERRTE_ENDUNGEN: ReadonlySet<string> = new Set([
    // ausführbar und Installer
    "exe",
    "com",
    "bat",
    "cmd",
    "cpl",
    "scr",
    "pif",
    "msi",
    "msp",
    "dll",
    "sys",
    "jar",
    "apk",
    "app",
    "appx",
    "msix",
    "bin",
    "dmg",
    "pkg",
    "deb",
    "rpm",
    "gadget",
    // Skripte
    "js",
    "jse",
    "vbs",
    "vbe",
    "vb",
    "wsf",
    "wsh",
    "ws",
    "ps1",
    "ps1xml",
    "psc1",
    "psm1",
    "hta",
    "sh",
    "scf",
    "inf",
    "jnlp",
    "msc",
    // Verknüpfungen, Registrierung, Abbilder
    "lnk",
    "url",
    "reg",
    "iso",
    "img",
    "vhd",
    "vhdx",
    // Dokumente mit Makros
    "docm",
    "dotm",
    "xlsm",
    "xltm",
    "xlam",
    "pptm",
    "potm",
    "ppam",
    "ppsm",
    "sldm",
    // Archive (verstecken Ausführbares vor jeder Prüfung)
    "zip",
    "rar",
    "7z",
    "gz",
    "tgz",
    "tar",
    "bz2",
    "xz",
    "cab",
    "z",
    // aktive Seiten
    "html",
    "htm",
    "xhtml",
    "svg",
    "chm",
    "hlp",
    "swf",
]);

/** MIME-Typen, die nie übernommen werden (zusätzlich zur Endung). */
export const GESPERRTE_MIME: ReadonlySet<string> = new Set([
    "application/x-msdownload",
    "application/x-msdos-program",
    "application/x-dosexec",
    "application/x-executable",
    "application/x-elf",
    "application/x-sh",
    "application/x-csh",
    "application/x-bat",
    "application/x-msi",
    "application/x-ms-shortcut",
    "application/x-apple-diskimage",
    "application/x-iso9660-image",
    "application/x-httpd-php",
    "application/vnd.microsoft.portable-executable",
    "application/java-archive",
    "application/x-java-archive",
    "application/javascript",
    "application/x-javascript",
    "application/ecmascript",
    "text/javascript",
    "application/hta",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-zip",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/gzip",
    "application/x-gzip",
    "application/x-tar",
    "application/x-bzip2",
    "application/x-xz",
    "application/vnd.ms-cab-compressed",
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/x-shockwave-flash",
]);

const MAKRO_MIME = /macroenabled/iu;

function endungen(dateiname: string): string[] {
    // Auch eine Doppelendung zählt (`rechnung.pdf.exe`, `setup.exe.txt`): Jede Endung hinter dem ersten Punkt wird geprüft.
    const teile = dateiname.toLowerCase().split(".");
    return teile.slice(1).map((teil) => teil.trim());
}

/** Darf diese Datei nicht übernommen werden? (Name und MIME-Typ, wie der Absender sie angibt.) */
export function istGesperrt(dateiname: string, mime: string): boolean {
    if (endungen(dateiname).some((endung) => GESPERRTE_ENDUNGEN.has(endung))) return true;
    const art = mime.toLowerCase();
    return GESPERRTE_MIME.has(art) || MAKRO_MIME.test(art) || art.startsWith("application/x-ms");
}

/** Säubert einen Dateinamen: kein Pfad, keine Steuer- und Richtungszeichen, nicht leer, höchstens `DATEINAME_MAX` Zeichen (die Endung bleibt). */
export function saubererDateiname(roh: string | undefined): string {
    const ohneSteuer = (roh ?? "").replace(
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/gu,
        " ",
    );
    const letzter = ohneSteuer.split(/[\\/]/u).pop() ?? "";
    const name = letzter
        .replace(/["<>|:*?]/gu, "_")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/^\.+/u, "");
    if (name === "") return "Anhang";
    if (name.length <= DATEINAME_MAX) return name;
    const punkt = name.lastIndexOf(".");
    const endung = punkt > 0 && name.length - punkt <= 12 ? name.slice(punkt) : "";
    return `${name.slice(0, DATEINAME_MAX - endung.length)}${endung}`;
}

// --- Kopfzeilen ------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Aus einem Kopfzeilenwert die Kennungen in spitzen Klammern, klein geschrieben, höchstens `MAX_VERWEISE`. */
export function leseKennungen(wert: string | string[] | undefined): string[] {
    const text = Array.isArray(wert) ? wert.join(" ") : (wert ?? "");
    const treffer = text.match(/<[^<>\s]{1,990}>/gu) ?? [];
    return [...new Set(treffer.map((kennung) => kennung.toLowerCase()))].slice(0, MAX_VERWEISE);
}

/** Die Kennung der Mail; fehlt sie (selten), wird sie aus dem Inhalt abgeleitet: dieselbe Mail ergibt immer dieselbe Kennung, damit die Datenbank sie als bekannt erkennt. */
export function kennungVon(messageId: string | undefined, roh: Buffer): string {
    const aus = leseKennungen(messageId)[0];
    if (aus !== undefined) return aus;
    return `<${createHash("sha256").update(roh).digest("hex")}@eingang.invalid>`;
}

// eslint-disable-next-line no-control-regex
const STEUER = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/gu;
const einzeilig = (text: string | undefined, max: number): string =>
    (text ?? "").replace(STEUER, " ").replace(/\s+/gu, " ").trim().slice(0, max);

// --- Bilder ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const BILD_FORMATE = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" } as const;
type BildFormat = keyof typeof BILD_FORMATE;
const BILD_MIME = new Set<string>(Object.values(BILD_FORMATE));
const BILD_ENDUNGEN = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
/** Ein Bild mit mehr Bildpunkten wird gar nicht erst entpackt (Schutz vor Bildbomben). */
const MAX_BILDPUNKTE = 60_000_000;

/** Kodiert ein Bild neu, ohne Metadaten (Ausrichtung angewandt). `undefined`, wenn `sharp` es nicht lesen oder schreiben kann. */
export async function kodiereBildNeu(inhalt: Buffer): Promise<{ inhalt: Buffer; mime: string } | undefined> {
    try {
        const roh = sharp(inhalt, { limitInputPixels: MAX_BILDPUNKTE, animated: true, failOn: "error" });
        const meta = await roh.metadata();
        const format = meta.format as string | undefined;
        if (format === undefined || !(format in BILD_FORMATE)) return undefined;
        const art = format as BildFormat;
        let pipeline = sharp(inhalt, {
            limitInputPixels: MAX_BILDPUNKTE,
            animated: art === "gif" || art === "webp",
            failOn: "error",
        }).autoOrient();
        pipeline =
            art === "jpeg"
                ? pipeline.jpeg({ quality: 90 })
                : art === "png"
                  ? pipeline.png()
                  : art === "gif"
                    ? pipeline.gif()
                    : pipeline.webp({ quality: 90 });
        // Metadaten (EXIF, ICC, XMP) kodiert `sharp` ohne Aufforderung nicht mit.
        const aus = await pipeline.toBuffer();
        return { inhalt: aus, mime: BILD_FORMATE[art] };
    } catch {
        return undefined;
    }
}

// --- Verarbeitung ----------------------------------------------------------------------------------------------------------------------------------------------------------------------

function mimeVon(anhang: Attachment): string {
    const art = (anhang.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(art) && art.length <= 127
        ? art
        : "application/octet-stream";
}

function istBildKandidat(dateiname: string, mime: string): boolean {
    if (BILD_MIME.has(mime)) return true;
    const endung = dateiname.toLowerCase().split(".").pop() ?? "";
    return BILD_ENDUNGEN.has(endung);
}

async function verarbeiteAnhaenge(
    anhaenge: readonly Attachment[],
    ablage: Ablage,
): Promise<{ eintraege: AnhangFuerDatenbank[]; cids: Set<string> }> {
    const eintraege: AnhangFuerDatenbank[] = [];
    const cids = new Set<string>();
    let summe = 0;
    for (const anhang of anhaenge.slice(0, MAX_ANHAENGE)) {
        const dateiname = saubererDateiname(anhang.filename);
        const inhalt = Buffer.isBuffer(anhang.content) ? anhang.content : Buffer.alloc(0);
        const groesse = inhalt.length;
        let mime = mimeVon(anhang);
        if (istGesperrt(dateiname, mime)) {
            eintraege.push({ dateiname, mime, groesse, datei: null, cid: null, grund: "typ" });
            continue;
        }
        if (summe + groesse > ANHANG_GRENZE_BYTES) {
            eintraege.push({ dateiname, mime, groesse, datei: null, cid: null, grund: "grenze" });
            continue;
        }
        let ablegen = inhalt;
        if (istBildKandidat(dateiname, mime)) {
            const neu = await kodiereBildNeu(inhalt);
            // Ein Bild, das `sharp` nicht lesen kann, ist kein Bild, das wir zeigen: gesperrt.
            if (neu === undefined) {
                eintraege.push({ dateiname, mime, groesse, datei: null, cid: null, grund: "typ" });
                continue;
            }
            ablegen = neu.inhalt;
            mime = neu.mime;
        }
        const datei = await ablage.schreibe(ablegen);
        summe += ablegen.length;
        const cid = anhang.cid ?? anhang.contentId?.replace(/^<|>$/gu, "");
        const eingebettet = cid !== undefined && BILD_MIME.has(mime) && istCidToken(cid) && !cids.has(cid);
        if (eingebettet) cids.add(cid);
        eintraege.push({ dateiname, mime, groesse: ablegen.length, datei, cid: eingebettet ? cid : null, grund: null });
    }
    return { eintraege, cids };
}

export interface VerarbeitungsOptionen {
    ablage: Ablage;
    uid: number;
    uidValidity: number;
}

/** Die Kopfzeilen allein genügen für „zu groß“ und „nicht lesbar“: Kennung, Absender, Betreff. */
async function nurKopf(
    mail: PostfachMail,
    optionen: VerarbeitungsOptionen,
    hinweis: "zu_gross" | "unlesbar",
): Promise<VerarbeiteteMail> {
    let kopf: Awaited<ReturnType<typeof simpleParser>> | undefined;
    try {
        kopf = await simpleParser(mail.roh, {
            keepCidLinks: true,
            skipHtmlToText: true,
            skipTextToHtml: true,
            skipTextLinks: true,
        });
    } catch {
        kopf = undefined;
    }
    const von = kopf?.from?.value[0];
    const rohDatei = mail.roh.length === 0 ? null : await optionen.ablage.schreibe(mail.roh);
    return {
        mail: {
            messageId: kennungVon(kopf?.messageId, mail.roh),
            inReplyTo: leseKennungen(kopf?.inReplyTo)[0] ?? null,
            verweise: leseKennungen(kopf?.references),
            vonAdresse: von?.address === undefined ? null : von.address.trim().slice(0, 254),
            vonName: von === undefined || von.name === "" ? null : einzeilig(von.name, 200) || null,
            betreff: einzeilig(kopf?.subject, BETREFF_MAX),
            text: null,
            html: null,
            externBilder: 0,
            hinweis,
            rohDatei,
            groesse: mail.zuGross ?? mail.roh.length,
            uid: optionen.uid,
            uidvalidity: optionen.uidValidity,
        },
        anhaenge: [],
    };
}

/** Verarbeitet eine Mail aus dem Postfach. Wirft nur bei einem Fehler der Ablage (Platte voll, Rechte), nie wegen des Inhalts der Mail. */
export async function verarbeiteMail(mail: PostfachMail, optionen: VerarbeitungsOptionen): Promise<VerarbeiteteMail> {
    if (mail.zuGross !== undefined) return nurKopf(mail, optionen, "zu_gross");
    let geparst: Awaited<ReturnType<typeof simpleParser>>;
    try {
        geparst = await simpleParser(mail.roh, { keepCidLinks: true, skipTextToHtml: true, skipTextLinks: true });
    } catch {
        return nurKopf(mail, optionen, "unlesbar");
    }
    const rohDatei = await optionen.ablage.schreibe(mail.roh);
    const { eintraege, cids } = await verarbeiteAnhaenge(geparst.attachments, optionen.ablage);
    const bereinigt =
        typeof geparst.html === "string" ? bereinigeHtml(geparst.html, { cids }) : { html: null, externBilder: 0 };
    const text = (geparst.text ?? "").slice(0, TEXT_MAX_ZEICHEN);
    const von = geparst.from?.value[0];
    return {
        mail: {
            messageId: kennungVon(geparst.messageId, mail.roh),
            inReplyTo: leseKennungen(geparst.inReplyTo)[0] ?? null,
            verweise: leseKennungen(geparst.references),
            vonAdresse: von?.address === undefined ? null : von.address.trim().slice(0, 254),
            vonName: von === undefined || von.name === "" ? null : einzeilig(von.name, 200) || null,
            betreff: einzeilig(geparst.subject, BETREFF_MAX),
            text: text.trim() === "" ? null : text,
            html: bereinigt.html,
            externBilder: bereinigt.externBilder,
            hinweis: null,
            rohDatei,
            groesse: mail.roh.length,
            uid: optionen.uid,
            uidvalidity: optionen.uidValidity,
        },
        anhaenge: eintraege,
    };
}
