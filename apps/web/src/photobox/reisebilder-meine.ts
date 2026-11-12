import { computed, onBeforeUnmount, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import { fehlerArt, ladeVorschau, leseStatus } from "./api";
import { merkliste } from "./meine-reisebilder";
import {
    ladeMeine,
    meinCache,
    meineLeiste,
    type MeinErgebnis,
    type MeinLauf,
    type MeinOffenes,
} from "./meine-reisebilder-modell";
import { ohneKiZeigbar } from "./ohne-ki";
import { reisebilder } from "./reisebilder-zustand";

/**
 * Der Knopf „Meine Reisebilder“ in der Leiste (WI-0272, Probierseite Fassung 2, Idee B): Er filtert immer und öffnet nie von selbst ein Fenster. Veröffentlichte eigene Bilder stehen in Leiste und Karte, wo auch
 * immer sie liegen; was noch offen ist, steht als Kachel mit Marke vorn und führt ins Fenster.
 *
 * - 🔴 **Gefragt wird erst beim Drücken**, einmal, nacheinander und über den Zwischenspeicher des Fensters (`ladeMeine`): Beim Start der Seite gehen keine Schlüssel an den Server. Darum kennt die Zahl am Knopf
 *   erst der erste Druck.
 * - **Keine zweite Vorschau:** Ein veröffentlichtes Bild bringt seine Kachel mit (`PhotoboxStatus.karte`), das schont die Lesegrenze.
 * - Die Adressen der Vorschauen gelten nur für diese Seite und werden beim Ausschalten freigegeben.
 */

export interface MeinOffenesMitVorschau extends MeinOffenes {
    readonly vorschau?: string;
}

export interface MeineLeisteSteuerung {
    /** Die offenen eigenen Bilder, die der Filter „Ohne KI“ stehen lässt. */
    readonly offene: ComputedRef<readonly MeinOffenesMitVorschau[]>;
    /** Wie viele offen sind; bleibt nach dem Ausschalten stehen. */
    readonly offenZahl: ShallowRef<number>;
    readonly laedt: ShallowRef<boolean>;
    schalte(): void;
}

const leseUmfeld = {
    leseStatus: (schluessel: string) => leseStatus(schluessel),
    ladeVorschau: (schluessel: string) => ladeVorschau(schluessel),
    fehlerArt,
    noch: (schluessel: string) => merkliste.hat(schluessel),
    aktuelle: () => merkliste.eintraege.value.map((eintrag) => eintrag.schluessel),
};

export function useMeineLeiste(): MeineLeisteSteuerung {
    const ergebnisse = shallowRef<Readonly<Record<string, MeinErgebnis>>>({});
    const vorschauen = shallowRef<Readonly<Record<string, string>>>({});
    const offenZahl = shallowRef(0);
    const laedt = shallowRef(false);
    let lauf: MeinLauf | undefined;

    const stand = computed(() => meineLeiste(leseUmfeld.aktuelle(), ergebnisse.value));
    const offene = computed<readonly MeinOffenesMitVorschau[]>(() =>
        stand.value.offene
            .filter((offen) => !reisebilder.ohneKi.value || ohneKiZeigbar(offen.entstehung))
            .map((offen) => {
                const vorschau = vorschauen.value[offen.schluessel];
                return vorschau === undefined ? offen : { ...offen, vorschau };
            }),
    );

    function raeumeAuf(): void {
        lauf?.stoppe();
        lauf = undefined;
        for (const adresse of Object.values(vorschauen.value)) URL.revokeObjectURL(adresse);
        vorschauen.value = {};
        ergebnisse.value = {};
        laedt.value = false;
    }

    function starte(): void {
        lauf?.stoppe();
        laedt.value = true;
        const dieser = ladeMeine(
            leseUmfeld,
            leseUmfeld.aktuelle(),
            {
                stand(schluessel, ergebnis) {
                    ergebnisse.value = { ...ergebnisse.value, [schluessel]: ergebnis };
                    reisebilder.setzeMeineKarten(stand.value.karten);
                    offenZahl.value = stand.value.offene.length;
                },
                vorschau(schluessel, bild) {
                    const alt = vorschauen.value[schluessel];
                    if (alt !== undefined) URL.revokeObjectURL(alt);
                    vorschauen.value = { ...vorschauen.value, [schluessel]: URL.createObjectURL(bild) };
                },
            },
            { cache: meinCache, mitVorschau: (status) => status.karte === undefined },
        );
        lauf = dieser;
        void dieser.fertig.then(() => {
            if (lauf !== dieser) return;
            laedt.value = false;
            if (stand.value.unklar) showToast(t("photobox.meine.marke.unklar"));
        });
    }

    function schalte(): void {
        if (reisebilder.nurMeine.value) {
            reisebilder.setzeMeine(false);
            return;
        }
        merkliste.liesNeu();
        reisebilder.setzeMeine(true);
        starte();
    }

    // Auch das Verlassen der Standardansicht (`leere`) schaltet aus.
    const stopAus = watch(reisebilder.nurMeine, (an) => {
        if (!an) raeumeAuf();
    });
    // Ein Bild wurde vergessen oder in einem anderen Tab gemerkt: Die Leiste zieht nach.
    const stopListe = watch(merkliste.eintraege, (jetzt) => {
        if (!reisebilder.nurMeine.value) return;
        if (jetzt.length === 0) reisebilder.setzeMeine(false);
        else starte();
    });
    onBeforeUnmount(() => {
        stopAus();
        stopListe();
        raeumeAuf();
    });

    return { offene, offenZahl, laedt, schalte };
}
