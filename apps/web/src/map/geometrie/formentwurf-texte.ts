import { locale, t, type MessageKey } from "../../i18n/i18n";
import { relativeTime } from "../../i18n/relative-time";
import type { FormMeldung } from "./formentwurf";

/**
 * Die Sätze des gemeinsamen Formentwurfs (`formentwurf.ts`) als Hinweis am Rand: was geschrieben, verworfen oder abgelehnt wurde, wer
 * gerade bearbeitet, wann jemand dazwischen geändert hat. Der Ton: `warning`, wo etwas nicht geklappt hat, `success` für geschrieben.
 * Was eine Quelle anders sagt (wer sich nicht laden ließ), reicht sie als `eigene` herein. Die Sätze tragen noch die Schlüssel von
 * „Ecken bearbeiten“, wo sie herkommen (WI-0178 C1, C2).
 */
export function formHinweis(
    meldung: FormMeldung,
    eigene: { readonly ladefehler: MessageKey },
    jetzt = new Date(),
): { text: string; ton: "warning" | "success" | undefined } {
    switch (meldung.art) {
        case "ohneFlaeche":
            return { text: t("landschaftseditor.ecken.ohneFlaeche", { name: meldung.name }), ton: "warning" };
        case "ladefehler":
            return { text: t(eigene.ladefehler), ton: "warning" };
        case "verworfen":
            return { text: t("landschaftseditor.ecken.verworfen", { name: meldung.name }), ton: undefined };
        case "gesperrt":
            return {
                text: t("landschaftseditor.ecken.gesperrt", { name: meldung.name, wer: meldung.wer }),
                ton: "warning",
            };
        case "sperrfehler":
            return { text: t("landschaftseditor.ecken.sperrfehler", { name: meldung.name }), ton: "warning" };
        case "verloren":
            return { text: t("landschaftseditor.ecken.verloren", { name: meldung.name }), ton: "warning" };
        case "geloest":
            return {
                text: t("landschaftseditor.ecken.geloest", { name: meldung.name, wer: meldung.wer }),
                ton: undefined,
            };
        case "darunter":
            return { text: t("formentwurf.darunter", { name: meldung.name, von: meldung.von }), ton: undefined };
        case "gespeichert": {
            const teile = [t("landschaftseditor.ecken.gespeichert", { name: meldung.name })];
            if (meldung.mitgezogen.length > 0) {
                const namen = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(meldung.mitgezogen);
                teile.push(t("landschaftseditor.ecken.mitgezogen", { namen }));
            }
            return { text: teile.join(" "), ton: "success" };
        }
        case "konflikt": {
            const wann =
                meldung.wann === undefined
                    ? t("ortseditor.konflikt.gerade")
                    : relativeTime(new Date(meldung.wann), jetzt, locale.value);
            const text =
                meldung.wer === undefined
                    ? t("landschaftseditor.ecken.konflikt.jemand", { wann })
                    : t("landschaftseditor.ecken.konflikt.wer", { wer: meldung.wer, wann });
            return { text, ton: "warning" };
        }
        case "abgelehnt":
            return { text: meldung.satz, ton: "warning" };
        case "verhindert": {
            const werte = { name: meldung.name, eigen: meldung.eigen };
            const satz = {
                zu_wenig_ecken: () => t("formentwurf.verhindert.zuWenigEcken", werte),
                nachbar_umgezeichnet: () => t("formentwurf.verhindert.nachbarUmgezeichnet", werte),
                schneidet_sich: () => t("formentwurf.verhindert.schneidetSich", werte),
                beruehrt_sich: () => t("formentwurf.verhindert.beruehrtSich", werte),
                ausserhalb: () => t("formentwurf.verhindert.ausserhalb", werte),
            }[meldung.grund];
            return { text: satz(), ton: "warning" };
        }
    }
}
