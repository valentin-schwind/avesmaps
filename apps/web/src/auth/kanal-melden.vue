<script setup lang="ts">
import { computed, ref } from "vue";
import { KANAL_KATEGORIEN, KANAL_PRIORITAETEN, type KanalKategorie, type KanalPrioritaet } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t } from "../i18n/i18n";
import KanalBildWahl from "./kanal-bild-wahl.vue";
import KanalWer from "./kanal-wer.vue";
import {
    KANAL_BILDER_JE_MELDUNG,
    KATEGORIE_ZUERST,
    geraetAngabe,
    kategorieName,
    prioritaetName,
    type Kanal,
} from "./kanal";

/**
 * „Vorgang melden“ (Blatt WI-0124 B1): Kategorie als Karten mit „zuerst sieht …“, Priorität als Segmente, Titel und Nachricht sind Pflicht.
 * Rechts „Weitere Angaben“ (freiwillig): die Ansicht übernehmen (die Adresse der Seite), das Gerät (vorbelegt), Schritte. Darunter, was
 * der Server ohnehin mitsendet. Bilder anhängen kommt mit K4 (über die Medienverwaltung, im Browser verkleinert). Der Fuß sagt, dass
 * Kategorie und Priorität keine Rechte geben.
 */
const props = defineProps<{ kanal: Kanal; telefon: boolean }>();
const emit = defineEmits<{ abbrechen: []; gemeldet: [ops: string] }>();

const kategorie = ref<KanalKategorie>("bug");
const prioritaet = ref<KanalPrioritaet>("normal");
const titel = ref("");
const nachricht = ref("");
const schritte = ref("");
const ansicht = ref("");
const geraet = ref(geraetAngabe());
const versucht = ref(false);
/** Vom Klick bis zum letzten Bild gesperrt: zwischen Anlegen und Bildern ist der Kanal kurz frei, der Knopf nicht (Befund 5c37bc88). */
const sendet = ref(false);
/** Die gewählten Bilder; hochgeladen wird erst, wenn der Vorgang angelegt ist (je Bild ein Eintrag im Verlauf). */
const bilder = ref<File[]>([]);

function bilderGewaehlt(dateien: File[]): void {
    bilder.value = [...bilder.value, ...dateien].slice(0, KANAL_BILDER_JE_MELDUNG);
}

const prioritaeten = KANAL_PRIORITAETEN.map((p) => ({ value: p, label: prioritaetName(p) }));
const fehlt = computed(() => titel.value.trim() === "" || nachricht.value.trim() === "");

function ansichtUebernehmen(): void {
    ansicht.value = globalThis.location?.href ?? "";
}

async function absenden(): Promise<void> {
    versucht.value = true;
    if (fehlt.value || sendet.value) return;
    sendet.value = true;
    try {
        const ops = await props.kanal.melden(
            {
                kategorie: kategorie.value,
                prioritaet: prioritaet.value,
                titel: titel.value,
                nachricht: nachricht.value,
                schritte: schritte.value,
                ansicht: ansicht.value,
                geraet: geraet.value,
            },
            bilder.value,
        );
        if (ops !== null) emit("gemeldet", ops);
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <form
        class="melden"
        :class="{ 'melden--telefon': props.telefon }"
        data-testid="kanal-melden-formular"
        @submit.prevent="absenden"
    >
        <button type="button" class="melden__zurueck" data-testid="kanal-zurueck" @click="emit('abbrechen')">
            ‹ {{ t("kanal.back") }}
        </button>
        <h3 class="melden__titel">{{ t("kanal.report.title") }}</h3>
        <div class="melden__spalten">
            <div class="melden__haupt">
                <fieldset class="melden__gruppe">
                    <legend>
                        {{ t("kanal.report.category") }}
                        <span class="melden__leise">{{ t("kanal.report.categoryHint") }}</span>
                    </legend>
                    <div class="kategorien" role="radiogroup" :aria-label="t('kanal.report.category')">
                        <label
                            v-for="k in KANAL_KATEGORIEN"
                            :key="k"
                            class="kategorie"
                            :class="{ 'kategorie--aktiv': kategorie === k }"
                            :data-testid="`kanal-kategorie-${k}`"
                        >
                            <input
                                v-model="kategorie"
                                class="kategorie__wahl"
                                type="radio"
                                name="kategorie"
                                :value="k"
                            />
                            <span class="kategorie__name">{{ kategorieName(k) }}</span>
                            <span class="kategorie__beispiel">{{ t(`kanal.kategorieBeispiel.${k}`) }}</span>
                            <span class="kategorie__zuerst"
                                >{{ t("kanal.report.first") }} <KanalWer :wer="{ art: KATEGORIE_ZUERST[k] }"
                            /></span>
                        </label>
                    </div>
                </fieldset>
                <div class="melden__feld">
                    <span class="melden__label">{{ t("kanal.report.priority") }}</span>
                    <AvmSegmente
                        v-model="prioritaet"
                        :options="prioritaeten"
                        :label="t('kanal.report.priority')"
                        testid="kanal-prioritaet"
                    />
                </div>
                <label class="melden__feld">
                    <span class="melden__label">{{ t("kanal.report.titleField") }}</span>
                    <AvmEingabe
                        v-model="titel"
                        maxlength="120"
                        :ungueltig="versucht && titel.trim() === ''"
                        testid="kanal-titel"
                    />
                </label>
                <label class="melden__feld">
                    <span class="melden__label">{{ t("kanal.report.message") }}</span>
                    <AvmTextbereich
                        v-model="nachricht"
                        :zeilen="5"
                        maxlength="8000"
                        :ungueltig="versucht && nachricht.trim() === ''"
                        testid="kanal-nachricht"
                    />
                </label>
                <p v-if="versucht && fehlt" class="melden__problem" role="alert">{{ t("kanal.report.missing") }}</p>
                <p v-for="(problem, i) in props.kanal.fehler.value" :key="i" class="melden__problem" role="alert">
                    {{ t(problem.key, problem.params) }}
                </p>
            </div>
            <aside class="melden__neben">
                <section class="kasten">
                    <h4 class="kasten__titel">
                        {{ t("kanal.report.more") }} <span class="melden__leise">{{ t("kanal.report.optional") }}</span>
                    </h4>
                    <div class="melden__feld">
                        <span class="melden__label">{{ t("kanal.report.view") }}</span>
                        <AvmKnopf groesse="zeile" testid="kanal-ansicht-uebernehmen" @click="ansichtUebernehmen">{{
                            t("kanal.report.takeView")
                        }}</AvmKnopf>
                        <span v-if="ansicht !== ''" class="melden__leise melden__umbruch" data-testid="kanal-ansicht">{{
                            ansicht
                        }}</span>
                    </div>
                    <label class="melden__feld">
                        <span class="melden__label">{{ t("kanal.report.device") }}</span>
                        <AvmEingabe v-model="geraet" maxlength="200" testid="kanal-geraet" />
                    </label>
                    <label class="melden__feld">
                        <span class="melden__label">{{ t("kanal.report.steps") }}</span>
                        <AvmTextbereich v-model="schritte" :zeilen="3" maxlength="4000" testid="kanal-schritte" />
                    </label>
                </section>
                <section class="kasten kasten--leise">
                    <h4 class="kasten__titel">{{ t("kanal.report.auto") }}</h4>
                    <p class="melden__leise">{{ t("kanal.report.autoText") }}</p>
                </section>
                <section class="kasten kasten--gestrichelt">
                    <KanalBildWahl
                        mehrfach
                        :gesperrt="
                            bilder.length >= KANAL_BILDER_JE_MELDUNG
                                ? t('kanal.image.max', { n: KANAL_BILDER_JE_MELDUNG })
                                : undefined
                        "
                        :platz="KANAL_BILDER_JE_MELDUNG - bilder.length"
                        testid="kanal-bild-anhaengen"
                        @gewaehlt="bilderGewaehlt"
                    />
                    <ul v-if="bilder.length > 0" class="melden__bilder" data-testid="kanal-bilder-gewaehlt">
                        <li v-for="(datei, i) in bilder" :key="`${i}-${datei.name}`" class="melden__bild">
                            <span class="melden__umbruch">{{ datei.name }}</span>
                            <button
                                type="button"
                                class="melden__weg"
                                :aria-label="t('kanal.image.removeChosen', { name: datei.name })"
                                @click="bilder.splice(i, 1)"
                            >
                                ✕
                            </button>
                        </li>
                    </ul>
                    <p class="melden__leise">{{ t("kanal.image.hint") }}</p>
                </section>
            </aside>
        </div>
        <div class="melden__fuss">
            <span class="melden__leise">{{ t("kanal.report.footer") }}</span>
            <span class="melden__knoepfe">
                <AvmKnopf testid="kanal-abbrechen" @click="emit('abbrechen')">{{ t("kanal.cancel") }}</AvmKnopf>
                <AvmKnopf
                    art="gefuellt"
                    typ="submit"
                    :gesperrt="sendet ? t('kanal.busy') : undefined"
                    testid="kanal-absenden"
                    >{{ t("kanal.report.send") }}</AvmKnopf
                >
            </span>
        </div>
    </form>
</template>

<style scoped>
.melden {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.melden__zurueck {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    font-size: var(--font-size-small);
    cursor: pointer;
}

.melden__zurueck:hover {
    color: var(--color-link-hover);
}

.melden__titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    font-weight: 400;
}

.melden__spalten {
    display: grid;
    grid-template-columns: minmax(0, 1fr) calc(var(--avm-field-label-w) * 2.2);
    gap: var(--space-12);
    align-items: start;
}

.melden--telefon .melden__spalten {
    grid-template-columns: minmax(0, 1fr);
}

.melden__haupt,
.melden__neben {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.melden__gruppe {
    margin: 0;
    padding: 0;
    border: 0;
}

.melden__gruppe legend {
    margin-bottom: var(--space-4);
    padding: 0;
    color: var(--color-text-strong);
}

.melden__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.melden__label {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.melden__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.melden__umbruch {
    overflow-wrap: anywhere;
}

.melden__problem {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.kategorien {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-6);
}

.melden--telefon .kategorien {
    grid-template-columns: minmax(0, 1fr);
}

.kategorie {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.kategorie:hover {
    border-color: var(--color-border-strong);
    background: var(--color-hover-wash);
}

.kategorie:focus-within {
    box-shadow: var(--focus-ring);
}

.kategorie--aktiv {
    border-color: var(--color-accent);
    background: var(--color-button-soft-active);
}

.kategorie__wahl {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.kategorie__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.kategorie__beispiel,
.kategorie__zuerst {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.kategorie__zuerst {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
}

.kasten--leise {
    background: var(--color-panel-soft);
}

.kasten--gestrichelt {
    border-style: dashed;
}

.melden__bilder {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
}

.melden__bild {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
}

.melden__weg {
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    font: inherit;
    cursor: pointer;
}

.melden__weg:hover {
    color: var(--color-danger-soft-text);
}

.melden__weg:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.kasten__titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    font-weight: 400;
}

.melden__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
}

.melden__knoepfe {
    display: flex;
    gap: var(--space-4);
    margin-left: auto;
}
</style>
