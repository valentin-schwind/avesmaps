<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { COMMUNITY_GRENZEN, COMMUNITY_KONTAKT_TAGE, type StatusSicht } from "@avesmaps3d/shared";
import { ApiFailure, newOperationId } from "../auth/api";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import type { MessageKey } from "../i18n/de";
import { isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { FEHLER_SATZ, fehlerArt, kuerzeZeichen, leseStatus, sendeAntwort, ziehZurueck } from "./api";
import { genauerGrund } from "../system/ablehnung";
import { besucherSatz, statusAblehnung } from "./besucher-ablehnung";
import DiscordVerbinden from "./discord-verbinden.vue";

/**
 * Die Statusseite der Melder (WI-0268 C2; Bedienkonzept §5, Fachkonzept §10): das Ziel von `/meldung#‹schlüssel›` und der Knopf „Statusseite öffnen“ nach dem Absenden.
 * Ein Werkzeugfenster der Hülle wie das Formular (angedockt, ⧉ lösen, ohne Ablage, nur so hoch wie der Inhalt).
 *
 * - **Meldung und Nachricht** (WI-0268 C4): Dieselbe Seite gehört auch einer Anfrage aus dem Kontaktformular; die Wörter folgen `sicht.art` („Nachricht“ statt „Meldung“), der Ablauf ist derselbe.
 * - **Kopf:** Nummer und Zustand in Alltagssprache: Eingegangen · In Bearbeitung · Rückfrage · Abgeschlossen: ‹Ergebnis›. Darunter die eigene Meldung und alle Nachrichten nach
 *   außen (nie Notizen, nie Namen der Redaktion; der Server liefert sie gar nicht erst).
 * - **Antworten:** bei einer Rückfrage ein Antwortfeld, sonst „Ergänzung senden“ (öffnet eine abgeschlossene Meldung wieder). Die Kennung der Operation bleibt, bis es gelungen ist
 *   (ADR-0019): Ein erneutes Senden nach einem Netzfehler legt nie zwei Nachrichten an.
 * - **Zurückziehen** fragt im Fenster nach (`AvmBestaetigung`), nie in einem Browserdialog.
 * - **Mit Discord verbinden** bzw. **Verbindung lösen** (WI-0268 C8, Bedienkonzept §5): derselbe Block mit derselben Erklärung wie in der Bestätigung des Formulars (`discord-verbinden.vue`); nach dem
 *   Lösen lädt die Seite neu. Der Name der Verbindung kommt vom Server (`discordName`), nie die Kennung.
 * - **Ein falscher oder abgelaufener Schlüssel** zeigt „Diese Meldung gibt es nicht (mehr).“, ohne zu verraten, ob es sie gab (derselbe Satz für beides; der Server antwortet
 *   ebenso).
 * - 🔴 Der Schlüssel bleibt im Speicher dieser Seite: Er geht im Rumpf an den Server (nie in der Adresse) und wird nirgends gespeichert.
 */
const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    /** Der Schlüssel aus dem Link; `null`, wenn er fehlte oder verstümmelt war: Dann gibt es nichts zu fragen. */
    schluessel: string | null;
    lage: FensterHuellenLage;
    box?: FensterBox | undefined;
}>();
const emit = defineEmits<{
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "fehlt" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    | { readonly art: "da"; readonly sicht: StatusSicht };

const stand = ref<Stand>(props.schluessel === null ? { art: "fehlt" } : { art: "laedt" });
let lauf = 0;

async function lade(): Promise<void> {
    const schluessel = props.schluessel;
    if (schluessel === null) {
        stand.value = { art: "fehlt" };
        return;
    }
    const mein = ++lauf;
    try {
        const sicht = await leseStatus(schluessel);
        if (mein === lauf) stand.value = { art: "da", sicht };
    } catch (fehler) {
        if (mein !== lauf) return;
        const art = fehlerArt(fehler);
        stand.value =
            art === "nicht_gefunden"
                ? { art: "fehlt" }
                : { art: "fehler", key: art === "netz" ? "community.status.ladefehler" : FEHLER_SATZ[art] };
    }
}

onMounted(() => void lade());
watch(
    () => props.schluessel,
    () => {
        stand.value = props.schluessel === null ? { art: "fehlt" } : { art: "laedt" };
        void lade();
    },
);

const sicht = computed(() => (stand.value.art === "da" ? stand.value.sicht : undefined));
/** Eine Anfrage aus dem Kontaktformular heißt „Nachricht“, eine Meldung zur Karte „Meldung“ (WI-0268 C4): Die Wörter der Seite folgen der Art. */
const anfrage = computed(() => sicht.value?.art === "anfrage");
const titel = computed(() =>
    sicht.value === undefined
        ? t("community.status.titelOffen")
        : t(anfrage.value ? "community.status.titelAnfrage" : "community.status.titel", { nummer: sicht.value.nummer }),
);

const nachschlagen = (key: string): string | undefined => (isMessageKey(key) ? t(key) : undefined);
const ergebnisText = (ergebnis: string | null): string =>
    (ergebnis === null ? undefined : nachschlagen(`community.ergebnis.${ergebnis}`)) ?? "";
const zustandText = computed(() => {
    const s = sicht.value;
    if (s === undefined) return "";
    if (s.zustand !== "abgeschlossen") return t(`community.status.${s.zustand}` as MessageKey);
    return s.ergebnis === null
        ? t("community.status.abgeschlossenOhne")
        : t("community.status.abgeschlossen", { ergebnis: ergebnisText(s.ergebnis) });
});
const zustandTon = computed((): "neutral" | "erfolg" | "warnung" => {
    const s = sicht.value;
    if (s?.zustand === "rueckfrage") return "warnung";
    if (s?.zustand !== "abgeschlossen") return "neutral";
    return ["umgesetzt", "bereits_richtig", "beantwortet", "erledigt"].includes(s.ergebnis ?? "")
        ? "erfolg"
        : "neutral";
});
const kategorieText = computed(() =>
    sicht.value === undefined ? undefined : nachschlagen(`community.kategorie.${sicht.value.kategorie}`),
);
const zurueckgezogen = computed(() => sicht.value?.ergebnis === "zurueckgezogen");
const zeit = (iso: string): string => relativeTime(new Date(iso), new Date(), locale.value, "zeitpunkt");
const vonText = (richtung: "ein" | "aus", erste: boolean): string =>
    richtung === "aus"
        ? t("community.status.von.aus")
        : erste && !anfrage.value
          ? t("community.status.von.meldung")
          : t("community.status.von.ein");

// --- Antworten und Ergänzen -------------------------------------------------------------------------------------------------

const antwort = ref("");
/** Eine Kennung je Nachricht, bis sie angekommen ist: Ein erneutes Senden trägt dieselbe. */
let antwortKennung: string | undefined;
const sendet = ref(false);
/** Der Satz zum Fehler, schon in der Sprache (WI-0291). */
const problem = ref<string | undefined>(undefined);
/** Ein Schritt, den der Stand nicht (mehr) zulässt (409): Der Stand ist neu geladen, dieser Satz sagt, warum der Schritt nicht ging. Er steht auch dann da, wenn „Antworten“ und „Zurückziehen“ wegfallen. */
const konflikt = ref<string | undefined>(undefined);

const fehlerSatz = (fehler: unknown): string =>
    besucherSatz(fehler, statusAblehnung(anfrage.value), {
        zuViele: "community.ablehnung.statusZuViele",
        rueckfall: (art) => t(FEHLER_SATZ[art]),
    });

/**
 * Ein Fehler beim Antworten oder Zurückziehen. Ein 409 heißt: Der Stand, den die Seite zeigte, war alt (zurückgezogen, schon abgeschlossen). Dann lädt sie ihn neu und sagt den Grund, statt „Später
 * erneut versuchen“ zu sagen, was nie hilft (WI-0291); die Kennung der Operation ist verbraucht, ein neuer Versuch bekommt eine neue.
 */
async function bearbeiteFehler(fehler: unknown): Promise<void> {
    const art = fehlerArt(fehler);
    if (art === "nicht_gefunden") {
        stand.value = { art: "fehlt" };
        return;
    }
    if (fehler instanceof ApiFailure && fehler.status === 409) {
        antwortKennung = undefined;
        zurueckKennung = undefined;
        const satz = genauerGrund(fehler, statusAblehnung(anfrage.value)) ?? t("community.ablehnung.standGeaendert");
        await lade();
        konflikt.value = satz;
        return;
    }
    problem.value = fehlerSatz(fehler);
}
const antwortGrund = computed(() => {
    if (sendet.value) return t("community.sendet");
    return antwort.value.trim() === "" ? t("community.status.sperre") : undefined;
});

/** Esc in einer begonnenen Antwort schließt das Fenster nicht (✕ bleibt der ausdrückliche Weg); ohne Text geht Esc an die Hülle. */
function escInAntwort(event: KeyboardEvent): void {
    if (antwort.value.trim() !== "") event.stopPropagation();
}

async function antworten(): Promise<void> {
    const schluessel = props.schluessel;
    const text = antwort.value.trim();
    if (schluessel === null || text === "" || sendet.value) return;
    sendet.value = true;
    problem.value = undefined;
    konflikt.value = undefined;
    antwortKennung ??= newOperationId();
    try {
        await sendeAntwort({
            operationId: antwortKennung,
            schluessel,
            text: kuerzeZeichen(text, COMMUNITY_GRENZEN.nachrichtMax),
        });
        antwortKennung = undefined;
        antwort.value = "";
        await lade();
    } catch (fehler) {
        await bearbeiteFehler(fehler);
    } finally {
        sendet.value = false;
    }
}

// --- Zurückziehen -----------------------------------------------------------------------------------------------------------------

const frageZurueck = ref(false);
let zurueckKennung: string | undefined;

async function zurueckziehen(): Promise<void> {
    const schluessel = props.schluessel;
    if (schluessel === null || sendet.value) return;
    sendet.value = true;
    problem.value = undefined;
    konflikt.value = undefined;
    zurueckKennung ??= newOperationId();
    try {
        await ziehZurueck({ operationId: zurueckKennung, schluessel });
        zurueckKennung = undefined;
        frageZurueck.value = false;
        await lade();
    } catch (fehler) {
        frageZurueck.value = false;
        await bearbeiteFehler(fehler);
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="entscheiden"
        :lage="props.lage"
        :box="props.box"
        vorgabe-ecke="mitte"
        hoehe="inhalt"
        ohne-ablage
        :titel="titel"
        testid="community-status-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(neu) => emit('update:box', neu)"
        @vorn="emit('vorn')"
    >
        <p v-if="stand.art === 'laedt'" class="status__leise" role="status" data-testid="community-status-laedt">
            {{ t("community.status.laedt") }}
        </p>
        <AvmHinweis v-else-if="stand.art === 'fehlt'" ton="neutral" rolle="status" testid="community-status-fehlt">
            {{ t("community.status.fehlt") }}
        </AvmHinweis>
        <template v-else-if="stand.art === 'fehler'">
            <AvmHinweis ton="gefahr" rolle="alert" testid="community-status-fehler">{{ t(stand.key) }}</AvmHinweis>
            <AvmKnopf groesse="zeile" testid="community-status-erneut" @click="lade()">{{
                t("community.status.aktualisieren")
            }}</AvmKnopf>
        </template>

        <template v-else-if="sicht !== undefined">
            <div class="status__kopf" data-testid="community-status-kopf">
                <AvmPille :ton="zustandTon" testid="community-status-zustand">{{ zustandText }}</AvmPille>
                <span v-if="kategorieText !== undefined" class="status__leise">{{ kategorieText }}</span>
                <span v-if="sicht.bezugName !== null" class="status__leise">{{
                    t("community.status.bezug", { name: sicht.bezugName })
                }}</span>
                <span class="status__leise">{{
                    t("community.status.eingegangen", { zeit: zeit(sicht.eingegangenAt) })
                }}</span>
                <AvmKnopf groesse="zeile" testid="community-status-aktualisieren" @click="lade()">{{
                    t("community.status.aktualisieren")
                }}</AvmKnopf>
            </div>

            <ol
                class="status__verlauf"
                :aria-label="t('community.status.verlauf')"
                data-testid="community-status-verlauf"
            >
                <li
                    v-for="(nachricht, i) in sicht.nachrichten"
                    :key="i"
                    class="nachricht"
                    :class="`nachricht--${nachricht.richtung}`"
                >
                    <span class="nachricht__kopf"
                        >{{ vonText(nachricht.richtung, i === 0) }} · {{ zeit(nachricht.at) }}</span
                    >
                    <p v-if="nachricht.text !== null" class="nachricht__text">{{ nachricht.text }}</p>
                    <p v-else class="nachricht__text status__leise">{{ t("community.status.entfernt") }}</p>
                </li>
            </ol>

            <AvmHinweis v-if="konflikt !== undefined" ton="warnung" rolle="alert" testid="community-status-konflikt">
                {{ konflikt }}
            </AvmHinweis>

            <AvmHinweis v-if="zurueckgezogen" ton="neutral" rolle="status" testid="community-status-zurueckgezogen">
                {{ t(anfrage ? "community.status.zurueckgezogenAnfrage" : "community.status.zurueckgezogen") }}
            </AvmHinweis>
            <template v-else>
                <label class="status__feld" @keydown.esc="escInAntwort">
                    <span class="status__label">{{
                        sicht.zustand === "rueckfrage"
                            ? t("community.status.antwort.rueckfrage")
                            : t("community.status.antwort.ergaenzung")
                    }}</span>
                    <AvmTextbereich
                        v-model="antwort"
                        :zeilen="3"
                        :maxlength="COMMUNITY_GRENZEN.nachrichtMax"
                        testid="community-status-antwort"
                    />
                    <span v-if="sicht.zustand === 'abgeschlossen'" class="status__leise">{{
                        t(
                            anfrage
                                ? "community.status.ergaenzung.oeffnetAnfrage"
                                : "community.status.ergaenzung.oeffnet",
                        )
                    }}</span>
                </label>
                <AvmHinweis v-if="problem !== undefined" ton="gefahr" rolle="alert" testid="community-status-problem">
                    {{ problem }}
                </AvmHinweis>
                <AvmKnopf
                    art="gefuellt"
                    breit
                    :gesperrt="antwortGrund"
                    testid="community-status-senden"
                    @click="antworten()"
                    >{{
                        sicht.zustand === "rueckfrage"
                            ? t("community.status.antwort.senden")
                            : t("community.status.ergaenzung.senden")
                    }}</AvmKnopf
                >
                <AvmBestaetigung
                    v-if="frageZurueck"
                    :frage="t('community.status.zurueckziehen.frage', { nummer: sicht.nummer })"
                    :folge="t('community.status.zurueckziehen.folge')"
                    :bestaetigen="
                        t(anfrage ? 'community.status.zurueckziehenAnfrage' : 'community.status.zurueckziehen')
                    "
                    :gesperrt="sendet ? t('community.sendet') : undefined"
                    testid="community-status-zurueckziehen-frage"
                    @bestaetigen="zurueckziehen()"
                    @abbrechen="frageZurueck = false"
                />
                <AvmKnopf
                    v-else-if="sicht.zustand !== 'abgeschlossen'"
                    art="gefahr"
                    groesse="zeile"
                    testid="community-status-zurueckziehen"
                    @click="frageZurueck = true"
                    >{{
                        t(anfrage ? "community.status.zurueckziehenAnfrage" : "community.status.zurueckziehen")
                    }}</AvmKnopf
                >
            </template>

            <DiscordVerbinden
                v-if="props.schluessel !== null"
                :schluessel="props.schluessel"
                :verbunden="sicht.discordName ?? null"
                @geloest="lade()"
            />

            <p class="status__leise" data-testid="community-status-fristen">
                {{ t("community.status.fristen", { tage: COMMUNITY_KONTAKT_TAGE }) }}
            </p>
        </template>
    </AvmFenster>
</template>

<style scoped>
.status__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
}

.status__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.status__verlauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.nachricht {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

/* Was die Redaktion schreibt, liegt auf der leisen Fläche; die eigenen Nachrichten auf der des Fensters. */
.nachricht--aus {
    background: var(--color-panel-soft);
}

.nachricht__kopf {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.nachricht__text {
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.status__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.status__label {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}
</style>
