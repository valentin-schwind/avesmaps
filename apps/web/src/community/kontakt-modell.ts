import {
    COMMUNITY_GRENZEN,
    KONTAKT_MAIL_MUSTER,
    KONTAKT_THEMEN,
    type AnfrageKategorie,
    type KontaktBody,
    type KontaktThema,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import type { LinienZeichen } from "../photobox/reisebild-zeichen";
import { kuerzeZeichen, zeichenZahl, type FormularKennung } from "./api";

/**
 * Was das Kontaktformular rechnet (WI-0268 C4; Bedienkonzept §3.1, Fachkonzept §3.1, §10.5), ohne Browser: die Pflichtfelder samt Grund der Sperre und der Rumpf der Anfrage. Wie es aussieht, steht in
 * `kontakt-fenster.vue`; die Aufrufe in `api.ts`.
 *
 * - **Pflicht sind das Thema und die Nachricht (10 bis 2000 Zeichen).** Name und Adresse sind freiwillig; steht eine Adresse da, muss sie schlicht aussehen (dasselbe Muster wie auf dem Server und in der
 *   Datenbank). Ohne Adresse gibt es die Antwort nur auf der Statusseite.
 * - **Honigtopf und Zeitfalle** wie beim Meldeformular (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht, und die Zeit seit dem Öffnen.
 */

export interface KontaktEntwurf {
    kategorie: AnfrageKategorie | "";
    text: string;
    name: string;
    mail: string;
    /** Das Honigtopf-Feld: Ein Mensch sieht es nie, ein einfacher Bot füllt es. */
    honig: string;
}

/** „Frage“ ist vorgewählt: die häufigste Kategorie, und das Formular ist sofort absendbar, sobald die Nachricht steht. */
export const leererKontaktEntwurf = (): KontaktEntwurf => ({
    kategorie: "frage",
    text: "",
    name: "",
    mail: "",
    honig: "",
});

const MAIL_MUSTER = new RegExp(KONTAKT_MAIL_MUSTER, "u");

/** Sieht die Adresse schlicht richtig aus (oder fehlt sie, was erlaubt ist)? */
export function mailGueltig(mail: string): boolean {
    const gekappt = mail.trim();
    if (gekappt === "") return true;
    return zeichenZahl(gekappt) <= COMMUNITY_GRENZEN.mailMax && MAIL_MUSTER.test(gekappt);
}

/**
 * Warum „Nachricht senden“ gerade gesperrt ist, als Sprachschlüssel; `undefined`, wenn alles da ist. Der erste fehlende Punkt in der Reihenfolge des Formulars (Guide §13.19: gesperrter Knopf mit Grund).
 */
export function sperrGrund(entwurf: KontaktEntwurf): MessageKey | undefined {
    if (entwurf.kategorie === "") return "community.kontakt.sperre.kategorie";
    // Der Server zählt in Codepunkten (WI-0291): ein Emoji ist ein Zeichen, sonst bliebe der Knopf gesperrt, wo der Server annähme.
    const laenge = zeichenZahl(entwurf.text.trim());
    if (laenge < COMMUNITY_GRENZEN.textMin) return "community.kontakt.sperre.text";
    if (laenge > COMMUNITY_GRENZEN.textMax) return "community.kontakt.sperre.textLang";
    if (!mailGueltig(entwurf.mail)) return "community.kontakt.sperre.mail";
    return undefined;
}

/**
 * Der Rumpf der Anfrage. Wirft, wo `sperrGrund` etwas meldet: Der Aufrufer prüft zuerst. Leere Felder fehlen im Rumpf (der Server kennt „kein Name, keine Adresse“ als Abwesenheit).
 * `dauerMs` ist die Zeit seit dem Öffnen des Formulars, `entwurf.honig` das Honigtopf-Feld: beides geht mit.
 */
export function kontaktBody(kennung: FormularKennung, entwurf: KontaktEntwurf, dauerMs: number): KontaktBody {
    if (entwurf.kategorie === "" || sperrGrund(entwurf) !== undefined) throw new Error("Formular unvollständig");
    const name = entwurf.name.trim();
    const mail = entwurf.mail.trim();
    return {
        operationId: kennung.operationId,
        schluessel: kennung.schluessel,
        kategorie: entwurf.kategorie,
        text: entwurf.text.trim(),
        ...(name === "" ? {} : { name: kuerzeZeichen(name, COMMUNITY_GRENZEN.nameMax) }),
        ...(mail === "" ? {} : { mail }),
        falle: { feld: entwurf.honig, dauerMs: Math.max(0, Math.round(dauerMs)) },
    };
}

/** Das Feld, das der Grund der Sperre meint: Dorthin geht der Fokus, wenn jemand auf den gesperrten Knopf drückt. */
export function sperrFeld(entwurf: KontaktEntwurf): "kategorie" | "text" | "mail" | undefined {
    switch (sperrGrund(entwurf)) {
        case undefined:
            return undefined;
        case "community.kontakt.sperre.kategorie":
            return "kategorie";
        case "community.kontakt.sperre.mail":
            return "mail";
        default:
            return "text";
    }
}

const THEMA_ZEICHEN: Readonly<Record<KontaktThema, LinienZeichen>> = {
    frage: "frage",
    hinweis: "gluehbirne",
    mitmachen: "leute",
    lob: "daumen",
    allgemein: "sprechblase",
    problem: "warndreieck",
};

/** Die Themen des Formulars (`KONTAKT_THEMEN`): Name, Einladung auf der Schreibfläche und Zeichen. */
export const KONTAKT_KATEGORIEN: readonly {
    readonly wert: KontaktThema;
    readonly key: MessageKey;
    readonly einladung: MessageKey;
    readonly zeichen: LinienZeichen;
}[] = KONTAKT_THEMEN.map((wert) => ({
    wert,
    key: `community.kategorie.${wert}` as MessageKey,
    einladung: `community.kontakt.einladung.${wert}` as MessageKey,
    zeichen: THEMA_ZEICHEN[wert],
}));
