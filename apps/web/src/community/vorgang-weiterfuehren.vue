<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId, useTemplateRef, watch } from "vue";
import {
    COMMUNITY_GRENZEN,
    FEHLT_ARTEN,
    MELDUNG_KATEGORIEN,
    SEARCH_MIN_LENGTH,
    type AlsMeldungBody,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { createTextSuche } from "../fenster/text-suche";
import type { MessageKey } from "../i18n/de";
import { formatNumber, t } from "../i18n/i18n";
import { fetchSearch } from "../search/search-client";
import { besucher } from "./community-besucher";
import {
    neuerWeiterfuehrenEntwurf,
    ortAusTreffer,
    weiterfuehrenBody,
    weiterfuehrenHatEntwurf,
    weiterfuehrenSperrSatz,
    type OrtWahl,
} from "./mails-modell";

/**
 * Das kleine Blatt „Als Meldung weiterführen“ im Fenster einer Anfrage (WI-0268 C4; Fachkonzept §3.1, Bedienkonzept §3.3): Aus einer Mail, die sich als Kartenmeldung herausstellt, entsteht eine Meldung mit Bezug.
 * Sie steht IM Fenster, am Anfang des Rumpfs, und das Fenster wächst mit (wie `vorgang-blatt.vue`). Was es rechnet, steht in `mails-modell.ts`; die Handlung führt das Fenster aus (`weiter`).
 *
 * - **Felder:** die Kategorie (die sechs der Meldungen, bei „Etwas fehlt“ die Objektart), der **Bezug** (ein Ort über die Suche der Karte, oder eine Stelle auf der Karte), die Beschreibung (vorbelegt mit dem
 *   Text der Anfrage, 10 bis 2000 Zeichen), die Quelle (freiwillig) und eine **Antwort** an den Absender (freiwillig, auf die Statusseite; braucht `answer_community`). Ohne Antwort ist die Anfrage danach
 *   „erledigt“, mit ihr „beantwortet“.
 * - 🔴 **Nichts vom Absender geht mit:** Die Meldung bekommt weder Name noch Adresse; der Text ist, was die Redaktion hier stehen lässt (und sie kann ihn kürzen, bevor sie die Meldung anlegt).
 * - **Stelle auf der Karte** nutzt den vorhandenen Modus „Neue Lage zeigen“ (`community-besucher.ts`, `lage-vorschlag.ts`): Der nächste Klick auf die Karte setzt die Stelle, Esc bricht ab. Das Blatt räumt den
 *   Modus und den Geist weg, sobald es zugeht.
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §7, §13.19): „Meldung anlegen“ nennt, was noch fehlt; Esc bricht das Blatt ab, nicht das ganze Fenster.
 */
const props = defineProps<{
    nummer: string;
    /** Der Text der Anfrage, mit dem die Beschreibung beginnt. */
    vorlage: string;
    /** Die Rechte der Sitzung. */
    rechte: readonly string[];
    /** Eine Handlung läuft: alles gesperrt. */
    sendet: boolean;
    /** Ein Fehler des letzten Versuchs (der allgemeine Satz der Oberfläche; Rückfall). */
    fehler?: MessageKey | undefined;
    /** Der genaue Grund des Servers, wenn er einen nannte (`redaktionGrund`); er geht dem allgemeinen Satz vor. */
    fehlerGrund?: string | undefined;
}>();
const emit = defineEmits<{
    weiter: [body: Omit<AlsMeldungBody, "operationId" | "baseRevision">];
    abbrechen: [];
    /** Hat jemand schon etwas geschrieben oder gewählt, das verloren ginge? */
    entwurf: [ja: boolean];
}>();

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const grundId = useId();
const entwurf = reactive(neuerWeiterfuehrenEntwurf(props.vorlage));
const mitAntwort = ref(false);
const bezugArt = ref<string>("ort");
const darfAntworten = computed(() => props.rechte.includes("answer_community"));

// --- Kategorie und Objektart ------------------------------------------------------------------------------------------------

const kategorien = computed(() => MELDUNG_KATEGORIEN.map((wert) => ({ wert, text: t(`community.kategorie.${wert}`) })));
const kategorieWahl = computed({
    get: () => entwurf.kategorie,
    set: (wert: string) => {
        entwurf.kategorie = MELDUNG_KATEGORIEN.find((k) => k === wert) ?? "";
    },
});
const fehltArten = computed(() => [
    { wert: "", text: t("community.fehlt.waehlen") },
    ...FEHLT_ARTEN.map((wert) => ({ wert, text: t(`community.fehltArt.${wert}`) })),
]);
const fehltWahl = computed({
    get: () => entwurf.fehltArt,
    set: (wert: string) => {
        entwurf.fehltArt = FEHLT_ARTEN.find((art) => art === wert) ?? "";
    },
});

// --- Bezug: ein Ort über die Suche der Karte --------------------------------------------------------------------------------

const MAX_TREFFER = 6;
const suche = createTextSuche<OrtWahl>(
    async (text, signal) => {
        const antwort = await fetchSearch(text, signal);
        return antwort.hits
            .map(ortAusTreffer)
            .filter((ort): ort is OrtWahl => ort !== undefined)
            .slice(0, MAX_TREFFER);
    },
    250,
    SEARCH_MIN_LENGTH,
);
const gewaehlterOrt = computed(() => (entwurf.bezug?.art === "ort" ? entwurf.bezug.ort : undefined));
function waehleOrt(ort: OrtWahl): void {
    entwurf.bezug = { art: "ort", ort };
    suche.leere();
}

// --- Bezug: eine Stelle auf der Karte (der vorhandene Modus „Neue Lage zeigen“) --------------------------------------------

/** Nur eine Lage, die DIESES Blatt über den Modus bestellt hat, wird übernommen. */
const wartetAufKlick = ref(false);
const imModus = computed(() => besucher.lageModus.value !== undefined && wartetAufKlick.value);
const stelle = computed(() => (entwurf.bezug?.art === "stelle" ? entwurf.bezug.lage : undefined));
function stelleZeigen(): void {
    wartetAufKlick.value = true;
    besucher.starteLageModus({ name: t("community.mails.weiter.stelleName") });
}
watch(
    () => besucher.vorschlag.value,
    (vorschlag) => {
        if (!wartetAufKlick.value || vorschlag === undefined) return;
        wartetAufKlick.value = false;
        entwurf.bezug = { art: "stelle", lage: vorschlag.neu };
    },
);
// Der Modus ist ohne Klick zu Ende (Esc, ein anderes Fenster): Er wartet nicht mehr.
watch(
    () => besucher.lageModus.value,
    (modus) => {
        if (modus === undefined && besucher.vorschlag.value === undefined) wartetAufKlick.value = false;
    },
);
// Ein anderer Weg des Bezugs nimmt den anderen weg: Ein Bezug ist ein Ort ODER eine Stelle.
watch(bezugArt, (art) => {
    besucher.beendeLageModus();
    wartetAufKlick.value = false;
    if (entwurf.bezug?.art !== art) entwurf.bezug = undefined;
    besucher.nimmVorschlagZurueck();
});
const bezugWahl = computed(() => [
    { value: "ort", label: t("community.mails.weiter.bezug.ort") },
    { value: "stelle", label: t("community.mails.weiter.bezug.stelle") },
]);

// --- Antwort ----------------------------------------------------------------------------------------------------------------

watch(mitAntwort, (an) => {
    if (!an) entwurf.antwort = "";
});

// --- Absenden und Aufräumen -------------------------------------------------------------------------------------------------

/** Warum „Meldung anlegen“ nicht geht, als fertiger Satz, mit den Zahlen des Servers und den Längen in Codepunkten (WI-0291). */
const sperre = computed((): string | undefined => weiterfuehrenSperrSatz(entwurf, props.rechte));
const sperrText = computed(() => {
    if (props.sendet) return "";
    return sperre.value;
});
const titel = computed(() => t("community.mails.weiter.titel", { nummer: props.nummer }));

function weiter(): void {
    if (sperre.value !== undefined || props.sendet) return;
    emit("weiter", weiterfuehrenBody(entwurf, props.rechte));
}

watch(
    () => weiterfuehrenHatEntwurf(entwurf),
    (ja) => emit("entwurf", ja),
    { immediate: true },
);

/** Beim Erscheinen ins Bild holen und auf die Beschreibung: Das Blatt steht oben im Rumpf, der Rumpf kann gerollt sein. */
onMounted(() => {
    wurzel.value?.scrollIntoView({ block: "nearest" });
    wurzel.value?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
    // Der Modus und der Geist gehören diesem Blatt, solange es offen ist.
    if (wartetAufKlick.value || entwurf.bezug?.art === "stelle") {
        besucher.beendeLageModus();
        besucher.nimmVorschlagZurueck();
    }
    emit("entwurf", false);
});

function esc(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Läuft der Modus auf der Karte, beendet Esc den Modus (die Escape-Kaskade der Karte); sonst bricht es das Blatt ab, nicht das ganze Fenster.
    if (imModus.value) return;
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <section ref="wurzel" class="blatt" :aria-label="titel" data-testid="community-blatt-weiterfuehren" @keydown="esc">
        <h3 class="blatt__titel avm-versalmitte">{{ titel }}</h3>
        <p class="blatt__leise">{{ t("community.mails.weiter.erklaerung") }}</p>

        <label class="blatt__feld">
            <span class="blatt__label">{{ t("community.melden.kategorie") }}</span>
            <AvmAuswahl
                v-model="kategorieWahl"
                :optionen="kategorien"
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-weiter-kategorie"
            />
        </label>
        <label v-if="entwurf.kategorie === 'fehlt'" class="blatt__feld">
            <span class="blatt__label">{{ t("community.fehlt.art") }}</span>
            <AvmAuswahl
                v-model="fehltWahl"
                :optionen="fehltArten"
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-weiter-fehlt"
            />
        </label>

        <div class="blatt__feld" data-testid="community-blatt-weiter-bezug">
            <span class="blatt__label">{{ t("community.mails.weiter.bezug") }}</span>
            <AvmSegmente
                v-model="bezugArt"
                :options="bezugWahl"
                :label="t('community.mails.weiter.bezug')"
                testid="community-blatt-weiter-bezugart"
            />
            <template v-if="bezugArt === 'ort'">
                <p v-if="gewaehlterOrt !== undefined" class="blatt__gewaehlt" data-testid="community-blatt-weiter-ort">
                    <span>{{ gewaehlterOrt.name }}</span>
                    <span v-if="gewaehlterOrt.typ !== undefined" class="blatt__leise">{{ gewaehlterOrt.typ }}</span>
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="props.sendet ? '' : undefined"
                        :title="t('community.mails.weiter.ortAendern')"
                        :aria-label="t('community.mails.weiter.ortAendern')"
                        testid="community-blatt-weiter-ort-aendern"
                        @click="entwurf.bezug = undefined"
                        >✕</AvmKnopf
                    >
                </p>
                <template v-else>
                    <AvmEingabe
                        v-model="suche.text.value"
                        art="suche"
                        :placeholder="t('community.mails.weiter.ortPlatzhalter')"
                        :aria-label="t('community.mails.weiter.ortSuche')"
                        :gesperrt="props.sendet ? '' : undefined"
                        testid="community-blatt-weiter-ortsuche"
                    />
                    <ul
                        v-if="suche.treffer.value.length > 0"
                        class="treffer"
                        :aria-label="t('community.mails.weiter.ortTreffer')"
                        data-testid="community-blatt-weiter-treffer"
                    >
                        <li v-for="ort in suche.treffer.value" :key="ort.id">
                            <button
                                type="button"
                                class="treffer__zeile"
                                :data-testid="`community-blatt-weiter-treffer-${ort.id}`"
                                @click="waehleOrt(ort)"
                            >
                                <span>{{ ort.name }}</span>
                                <span v-if="ort.typ !== undefined" class="blatt__leise">{{ ort.typ }}</span>
                            </button>
                        </li>
                    </ul>
                    <p
                        v-else-if="suche.text.value.trim().length >= SEARCH_MIN_LENGTH && !suche.laedt.value"
                        class="blatt__leise"
                        data-testid="community-blatt-weiter-kein-treffer"
                    >
                        {{ t("community.mails.weiter.keinOrt") }}
                    </p>
                </template>
            </template>
            <template v-else>
                <p v-if="imModus" class="blatt__modus" role="status" data-testid="community-blatt-weiter-modus">
                    {{ t("community.mails.weiter.modusText") }}
                </p>
                <p v-else-if="stelle !== undefined" class="blatt__gewaehlt" data-testid="community-blatt-weiter-stelle">
                    <span>{{
                        t("community.mails.weiter.stelleGesetzt", {
                            x: formatNumber(stelle.x, 0),
                            y: formatNumber(stelle.y, 0),
                        })
                    }}</span>
                </p>
                <div class="blatt__knoepfe blatt__knoepfe--links">
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="props.sendet ? '' : undefined"
                        testid="community-blatt-weiter-stelle-zeigen"
                        @click="stelleZeigen"
                        >{{
                            stelle === undefined
                                ? t("community.mails.weiter.stelleZeigen")
                                : t("community.mails.weiter.stelleErneut")
                        }}</AvmKnopf
                    >
                </div>
            </template>
        </div>

        <label class="blatt__feld">
            <span class="blatt__label">{{ t("community.text.label") }}</span>
            <AvmTextbereich
                v-model="entwurf.text"
                :zeilen="4"
                :maxlength="COMMUNITY_GRENZEN.textMax"
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-weiter-text"
            />
        </label>
        <label class="blatt__feld">
            <span class="blatt__label"
                >{{ t("community.quelle.label") }}
                <span class="blatt__leise">{{ t("community.freiwillig") }}</span></span
            >
            <AvmEingabe
                v-model="entwurf.quelle"
                :maxlength="COMMUNITY_GRENZEN.quelleMax"
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-weiter-quelle"
            />
        </label>

        <AvmKaestchen
            art="checkbox"
            :checked="mitAntwort && darfAntworten"
            :gesperrt="darfAntworten ? (props.sendet ? '' : undefined) : t('community.mails.grund.antwortRecht')"
            testid="community-blatt-weiter-mit-antwort"
            @change="(an: boolean) => (mitAntwort = an)"
            >{{ t("community.mails.weiter.mitAntwort") }}</AvmKaestchen
        >
        <AvmTextbereich
            v-if="mitAntwort && darfAntworten"
            v-model="entwurf.antwort"
            :zeilen="3"
            :maxlength="COMMUNITY_GRENZEN.nachrichtMax"
            :gesperrt="props.sendet ? '' : undefined"
            :aria-label="t('community.mails.weiter.antwortText')"
            testid="community-blatt-weiter-antwort"
        />

        <AvmHinweis
            v-if="props.fehlerGrund !== undefined || props.fehler !== undefined"
            ton="gefahr"
            rolle="alert"
            testid="community-blatt-fehler"
            >{{ props.fehlerGrund ?? t(props.fehler as MessageKey) }}</AvmHinweis
        >

        <div class="blatt__knoepfe">
            <AvmKnopf
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-abbrechen"
                @click="emit('abbrechen')"
                >{{ t("ui.confirm.cancel") }}</AvmKnopf
            >
            <AvmKnopf
                art="gefuellt"
                :gesperrt="sperrText"
                :grund-bei="grundId"
                testid="community-blatt-los"
                @click="weiter"
                >{{ t("community.mails.weiter.anlegen") }}</AvmKnopf
            >
        </div>
        <!-- Der Grund, warum „Meldung anlegen“ noch nicht geht, steht sichtbar neben den Knöpfen (Guide §7, §13.19). -->
        <p v-if="sperrText !== undefined && sperrText !== ''" :id="grundId" class="blatt__sperre" role="note">
            {{ sperrText }}
        </p>
    </section>
</template>

<style scoped>
/* Dieselbe Bauart wie das Blatt „Abschließen“ (`vorgang-blatt.vue`): ein Kasten mit goldbrauner Kante am Anfang des Rumpfs. */
.blatt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-accent-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
}

.blatt__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.blatt__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
}

.blatt__label {
    padding: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.blatt__leise,
.blatt__sperre {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.blatt__gewaehlt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    margin: 0;
    color: var(--color-text-strong);
}

.blatt__modus {
    margin: 0;
    color: var(--color-text-strong);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

.blatt__knoepfe--links {
    justify-content: flex-start;
}

.treffer {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.treffer__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-4) var(--space-8);
    border: 0;
    border-bottom: 1px solid var(--color-divider);
    background: none;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.treffer li:last-child .treffer__zeile {
    border-bottom: 0;
}

.treffer__zeile:hover {
    background: var(--color-hover-wash);
}

.treffer__zeile:active {
    background: var(--color-active-wash);
}

.treffer__zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .treffer__zeile {
        transition: none;
    }
}
</style>
