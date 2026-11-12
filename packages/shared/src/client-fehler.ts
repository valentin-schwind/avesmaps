import { Type, type Static } from "@sinclair/typebox";

/**
 * Fehler im Browser der Besucher (WI-0202; Betreiber 2026-10-16 auf Review-Frage 5: „gute idee, fehler protokollieren ist
 * hilfreich, es muss datenschutzrechtlich gesichert sein, dass wir bei abstürzen diagnosen erheben“).
 *
 * Die Erfassung dockt an die Besuchsmeldung an (`POST /api/besuch`, `besucher.ts`): Die Zählung je Art ist die Metrik
 * `client_fehler`, die Diagnose reist im Feld `fehler` derselben Meldung. Hier steht, **was** eine Diagnose sein darf, und die
 * eine Bereinigung, die der Browser vor dem Senden und der Server vor dem Speichern rufen.
 *
 * 🔴 **Bereinigt wird zweimal, mit derselben Funktion.** Der Browser schickt nur, was sie übrig lässt; der Server traut dem nicht
 * und wendet sie noch einmal an. Was danach die Form verletzt, fällt weg.
 *
 * 🔴 **Nie in einer Diagnose:** IP, Cookie, Kennung, die aufgerufene Adresse, Eingaben, Kartenausschnitt, Uhrzeit, Name der
 * Grafikkarte. Die Felder unten sind abschließend.
 */

/**
 * Woher ein Fehler kam. Jede Art hat genau einen Fänger (`apps/web/src/besuch/fehler-faenger.ts`, `fehler-karte.ts`).
 *
 * - `start`: bevor die Oberfläche eingehängt ist, oder der Start selbst scheitert
 * - `vue`: `app.config.errorHandler`
 * - `karte`: MapLibre-Ereignis `error`, ohne Kachelausfälle (die sieht der Server selbst)
 * - `worker`: die Karte bekommt 45 s lang weder eine Kachel noch einen Kachelfehler (die Worker-Falle, `app.vue`)
 * - `kontext_verloren`: `webglcontextlost` an der Leinwand der Karte
 * - `unbehandelt`: `error` und `unhandledrejection` am Fenster nach dem Start
 */
export const CLIENT_FEHLER_ARTEN = ["start", "vue", "karte", "worker", "kontext_verloren", "unbehandelt"] as const;
export type ClientFehlerArt = (typeof CLIENT_FEHLER_ARTEN)[number];

/** Die Grafik des Geräts, grob: was die Karte bekommt. Nie der Name der Karte oder des Treibers. */
export const GRAFIK_KLASSEN = ["webgl2", "webgl1", "ohne"] as const;
export type GrafikKlasse = (typeof GRAFIK_KLASSEN)[number];

export const CLIENT_FEHLER_GRENZEN = {
    /** Länge des Fehlernamens. */
    name: 40,
    /** Länge der bereinigten Meldung. */
    meldung: 160,
    /** So viele Stellen im eigenen Bündel. */
    stellen: 5,
    /** So viele Diagnosen trägt eine Meldung an den Server. */
    jeMeldung: 3,
    /** So viele Diagnosen schickt eine Seite höchstens, jede Signatur einmal. */
    jeSeite: 5,
    /** So viele verschiedene Signaturen nimmt der Server je Tag an; danach zählt nur noch die Art. */
    jeTag: 200,
    /** So viele Tage bleibt eine Diagnose; die Zählung je Art bleibt als Summe. */
    fristTage: 14,
} as const;

export interface ClientFehlerDiagnose {
    art: ClientFehlerArt;
    name: string;
    meldung: string;
    stellen: string[];
    grafik?: GrafikKlasse;
}

/**
 * Die Form auf dem Draht. Bewusst großzügiger als die bereinigte Form: Eine Diagnose, die knapp über eine Grenze ragt, soll
 * nicht die ganze Meldung samt Seitenaufruf ungültig machen (die Route verwirft einen unpassenden Körper still). Der Server
 * bereinigt danach jede Diagnose für sich und lässt fallen, was nicht passt.
 */
export const ClientFehlerDraht = Type.Object(
    {
        art: Type.String({ maxLength: 40 }),
        name: Type.String({ maxLength: 100 }),
        meldung: Type.String({ maxLength: 500 }),
        stellen: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 10 }),
        grafik: Type.Optional(Type.String({ maxLength: 20 })),
    },
    { additionalProperties: false },
);
export type ClientFehlerDraht = Static<typeof ClientFehlerDraht>;

const BEZEICHNER = /^[A-Za-z_$][A-Za-z0-9_$.-]{0,39}$/;

/** Text in Anführungszeichen jeder Art. Ein `'` direkt hinter einem Buchstaben ist ein Apostroph, kein Anfang. */
const ZITATE: readonly RegExp[] = [
    /"([^"\n]*)"/g,
    /(?<![A-Za-z])'([^'\n]*)'/g,
    /`([^`\n]*)`/g,
    /„([^“”\n]*)[“”]/g,
    /“([^”\n]*)”/g,
    /‚([^‘’\n]*)[‘’]/g,
    /«([^»\n]*)»/g,
    /»([^«\n]*)«/g,
];

/**
 * Die Meldung eines Fehlers, bereinigt (WI-0202 §3.2). Reihenfolge trägt: erst Adressen (sie enthalten Zahlen und
 * Anführungszeichen), dann Zitate, dann Kennungen und Zahlen.
 */
export function bereinigeMeldung(roh: unknown): string {
    if (typeof roh !== "string") return "";
    let text = roh;
    // 1. Adressen jeder Art; damit fallen auch Abfrage und Parameter.
    text = text.replace(/\b(?:blob|data|javascript|file|mailto|about):[^\s"'`<>()]+/gi, "<adresse>");
    text = text.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s"'`<>()]*/gi, "<adresse>");
    text = text.replace(/[^\s@"'`<>()]+@[^\s@"'`<>()]+\.[a-z]{2,}/gi, "<adresse>");
    text = text.replace(/\b[A-Za-z]:\\[^\s"'`<>()]*/g, "<adresse>");
    text = text.replace(/(^|[\s(=:,;"'`[])\.{0,2}\/[^\s"'`<>()]+/g, "$1<adresse>");
    text = text.replace(/\?[^\s"'`<>()]*=[^\s"'`<>()]*/g, "");
    // 2. Zitate: ein Bezeichner bleibt lesbar (`reading 'x'`), alles andere könnte eine Eingabe sein.
    for (const muster of ZITATE) {
        text = text.replace(muster, (ganz: string, innen: string) =>
            innen === "" || BEZEICHNER.test(innen) ? ganz : `${ganz[0]!}<text>${ganz.at(-1)!}`,
        );
    }
    // 3. Kennungen: UUID, Hexfolgen mit Ziffer ab acht Zeichen, lange Base64-artige Folgen mit Ziffer.
    text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<kennung>");
    text = text.replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "<kennung>");
    text = text.replace(/(?<![A-Za-z0-9])(?=[A-Za-z0-9+_-]*\d)[A-Za-z0-9+_-]{20,}={0,2}/g, "<kennung>");
    // 4. Zahlen: alleinstehend zu `#`, außer einem HTTP-Status 100..599; an Buchstaben nur ab drei Ziffern.
    text = text.replace(/(?<![A-Za-z0-9#])\d+(?:[.,:]\d+)*(?![A-Za-z0-9])/g, (zahl: string) =>
        /^[1-5]\d\d$/.test(zahl) ? zahl : "#",
    );
    text = text.replace(/(?<=[A-Za-z])\d{3,}|\d{3,}(?=[A-Za-z])/g, "#");
    // 5. Leerraum zusammenziehen, kürzen (auf Zeichen, nicht auf UTF-16-Hälften).
    text = text.replace(/\s+/g, " ").trim();
    const zeichen = Array.from(text);
    return zeichen.length > CLIENT_FEHLER_GRENZEN.meldung
        ? `${zeichen.slice(0, CLIENT_FEHLER_GRENZEN.meldung - 1).join("")}…`
        : text;
}

/** Der Name eines Fehlers: ein Bezeichner wie `TypeError`, sonst `Error`; ohne Fehlerobjekt `NonError`. */
export function bereinigeName(roh: unknown, istFehlerobjekt = true): string {
    if (typeof roh === "string" && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(roh)) return roh;
    return istFehlerobjekt ? "Error" : "NonError";
}

/** Eine Stelle im eigenen Bündel: `assets/index-AbCd1234.js:1:23456` (Release) oder `src/app.vue:12:3` (Entwicklung). */
const STELLE = /^(?:assets|src)\/(?!.*\.\.)[A-Za-z0-9._/-]{1,100}\.(?:js|mjs|ts|vue):\d{1,7}:\d{1,7}$/;

export function stelleGueltig(stelle: string): boolean {
    return STELLE.test(stelle);
}

/** Datei, Zeile und Spalte am Ende einer Zeile des Stapels (Chrome: `at f (url:1:2)`, Firefox und Safari: `f@url:1:2`). */
const STAPELZEILE = /([a-z][a-z0-9+.-]*:\/\/[^\s()@]+|\/[^\s()@]+):(\d+):(\d+)\)?\s*$/i;

/**
 * Die Stellen eines Stapels, die zur eigenen Seite gehören: Ursprung gleich, Pfad unter `/assets/` oder `/src/`, ohne Abfrage.
 * Alles andere (Erweiterungen, fremde Skripte, `blob:`-Arbeiter, Vites Abhängigkeiten) fällt weg. Keine Funktionsnamen.
 */
export function eigeneStellen(stapel: unknown, ursprung: string): string[] {
    if (typeof stapel !== "string") return [];
    const stellen: string[] = [];
    for (const zeile of stapel.split("\n")) {
        const treffer = STAPELZEILE.exec(zeile.trim());
        if (!treffer) continue;
        let pfad: string;
        try {
            const adresse = new URL(treffer[1]!, ursprung);
            if (adresse.origin !== ursprung) continue;
            pfad = adresse.pathname.replace(/^\//, "");
        } catch {
            continue;
        }
        const stelle = `${pfad}:${treffer[2]!}:${treffer[3]!}`;
        if (!stelleGueltig(stelle) || stellen.includes(stelle)) continue;
        stellen.push(stelle);
        if (stellen.length >= CLIENT_FEHLER_GRENZEN.stellen) break;
    }
    return stellen;
}

/** Ist das ein Fehlerobjekt (auch eines aus einem anderen Fenster, wo `instanceof Error` scheitert)? */
function fehlerartig(wert: unknown): wert is { name?: unknown; message?: unknown; stack?: unknown } {
    return typeof wert === "object" && wert !== null && ("message" in wert || "stack" in wert);
}

/**
 * Die Diagnose zu einem gefangenen Wert, wie der Browser sie schickt. Ein geworfener Nicht-Fehler (`throw "x"`,
 * `reject(undefined)`) heißt `NonError`; seine Meldung ist bei Text der bereinigte Text, sonst nur sein Typ.
 */
export function diagnoseAus(
    art: ClientFehlerArt,
    wert: unknown,
    umgebung: { ursprung: string; grafik?: GrafikKlasse | undefined },
): ClientFehlerDiagnose {
    const objekt = fehlerartig(wert);
    const diagnose: ClientFehlerDiagnose = {
        art,
        name: bereinigeName(objekt ? wert.name : undefined, objekt),
        meldung: objekt
            ? bereinigeMeldung(wert.message)
            : bereinigeMeldung(typeof wert === "string" ? wert : typeof wert),
        stellen: objekt ? eigeneStellen(wert.stack, umgebung.ursprung) : [],
    };
    if (umgebung.grafik !== undefined) diagnose.grafik = umgebung.grafik;
    return diagnose;
}

/**
 * Die Diagnose vom Draht, bereinigt für die Ablage, oder `undefined`, wenn sie nicht passt. Der Server ruft das für jede
 * Diagnose einzeln; eine unpassende verdirbt die übrigen nicht.
 */
export function bereinigeDiagnose(roh: ClientFehlerDraht): ClientFehlerDiagnose | undefined {
    if (!(CLIENT_FEHLER_ARTEN as readonly string[]).includes(roh.art)) return undefined;
    const diagnose: ClientFehlerDiagnose = {
        art: roh.art as ClientFehlerArt,
        name: bereinigeName(roh.name),
        meldung: bereinigeMeldung(roh.meldung),
        stellen: roh.stellen.filter(stelleGueltig).slice(0, CLIENT_FEHLER_GRENZEN.stellen),
    };
    if (roh.grafik !== undefined && (GRAFIK_KLASSEN as readonly string[]).includes(roh.grafik))
        diagnose.grafik = roh.grafik as GrafikKlasse;
    return diagnose;
}

/** Woran der Browser dieselbe Diagnose auf einer Seite wiedererkennt: Art, Name, Meldung, oberste Stelle. */
export function seitenSignatur(diagnose: ClientFehlerDiagnose): string {
    return [diagnose.art, diagnose.name, diagnose.meldung, diagnose.stellen[0] ?? ""].join("|");
}
