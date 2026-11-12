<script setup lang="ts">
import { computed, onMounted, useId, useTemplateRef } from "vue";
import { ABSCHLUSS_ERGEBNISSE, COMMUNITY_GRENZEN, type CommunityArt, type CommunityErgebnis } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import {
    abschlussSperrSatz,
    ergebnisName,
    mitDublette,
    mitErgebnis,
    wiedereroeffnenSperrSatz,
    type AbschlussEntwurf,
} from "./meldungen-modell";

/**
 * Das kleine Blatt im Vorgangsfenster (WI-0268 C3; Bedienkonzept §2.5, §2.6): Abschließen, Wiedereröffnen und Personenbezug löschen. Es steht IM Fenster, am Anfang des Rumpfs, und das Fenster wächst mit
 * (so hoch wie sein Inhalt, `hoehe="inhalt"`): nichts wird abgeschnitten, und kein zweites Fenster legt sich darüber (`fenster-huelle.test.ts`; wie `AvmBestaetigung`).
 *
 * - **Abschließen:** das Ergebnis aus `ABSCHLUSS_ERGEBNISSE[art]` (vorgewählt „umgesetzt“); die Begründung ist Pflicht und intern, sonst ist „Abschließen“ gesperrt, mit Grund; der Haken „Nachricht an den
 *   Melder“ ist gesetzt, wenn es einen Rückweg gibt, mit vorbelegtem, änderbarem Text je Ergebnis (Fachkonzept §4.3); bei „Doppelt“ ist die Nummer des anderen Vorgangs Pflicht.
 * - **Wiedereröffnen:** der Grund ist Pflicht; das Ergebnis bleibt im Verlauf stehen.
 * - **Personenbezug löschen:** sagt, was weggeht und dass es sich nicht zurücknehmen lässt; bestätigt wird mit einem frischen Passkey (`withConfirmation`, die Stufe S des Servers).
 */
const props = defineProps<{
    art: "abschliessen" | "wiedereroeffnen" | "loeschen";
    nummer: string;
    vorgangArt: CommunityArt;
    /** Das bisherige Ergebnis (Wiedereröffnen sagt, dass es stehen bleibt). */
    bisher: CommunityErgebnis | null;
    /** Der Weg nach außen, wie die Eingabe ihn nennt („Statusseite und Mail“); leer: es gibt keinen. */
    weg: string;
    /** Eine Handlung läuft: alles gesperrt. */
    sendet: boolean;
    /** Ein Fehler des letzten Versuchs (der allgemeine Satz der Oberfläche; Rückfall). */
    fehler?: MessageKey | undefined;
    /** Der genaue Grund des Servers, wenn er einen nannte (`redaktionGrund`); er geht dem allgemeinen Satz vor. */
    fehlerGrund?: string | undefined;
}>();
const abschluss = defineModel<AbschlussEntwurf>("abschluss", { required: true });
const grund = defineModel<string>("grund", { required: true });
const emit = defineEmits<{ abschliessen: []; wiedereroeffnen: []; loeschen: []; abbrechen: [] }>();

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const gruppe = useId();
const grundId = useId();
const ergebnisse = computed(() => ABSCHLUSS_ERGEBNISSE[props.vorgangArt]);

/** Warum der Knopf gesperrt ist, als fertiger Satz: Pflichtfelder und die Grenzen des Servers (Codepunkte, nicht UTF-16; WI-0291). */
const sperre = computed((): string | undefined => {
    if (props.art === "abschliessen") return abschlussSperrSatz(abschluss.value, props.nummer);
    if (props.art === "wiedereroeffnen") return wiedereroeffnenSperrSatz(grund.value);
    return undefined;
});
const sperrText = computed(() => {
    if (props.sendet) return "";
    return sperre.value;
});

const titel = computed(() => t(`community.redaktion.blatt.${props.art}`, { nummer: props.nummer }));

function waehleErgebnis(ergebnis: CommunityErgebnis): void {
    abschluss.value = mitErgebnis(abschluss.value, ergebnis);
}

/** Beim Erscheinen ins Bild holen und auf das erste Feld: Das Blatt steht oben im Rumpf, der Rumpf kann gerollt sein. */
onMounted(() => {
    wurzel.value?.scrollIntoView({ block: "nearest" });
    wurzel.value?.querySelector<HTMLElement>("textarea, input:checked, button")?.focus({ preventScroll: true });
});

function esc(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc bricht das Blatt ab, nicht das ganze Fenster.
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <section
        ref="wurzel"
        class="blatt"
        :aria-label="titel"
        :data-testid="`community-blatt-${props.art}`"
        @keydown="esc"
    >
        <h3 class="blatt__titel avm-versalmitte">{{ titel }}</h3>

        <template v-if="props.art === 'abschliessen'">
            <fieldset class="blatt__feld">
                <legend class="blatt__label">{{ t("community.redaktion.blatt.ergebnis") }}</legend>
                <AvmKaestchen
                    v-for="ergebnis in ergebnisse"
                    :key="ergebnis"
                    art="radio"
                    :name="gruppe"
                    :checked="abschluss.ergebnis === ergebnis"
                    :gesperrt="props.sendet ? '' : undefined"
                    :testid="`community-blatt-ergebnis-${ergebnis}`"
                    @change="waehleErgebnis(ergebnis)"
                    >{{ ergebnisName(ergebnis) }}</AvmKaestchen
                >
            </fieldset>

            <label v-if="abschluss.ergebnis === 'dublette'" class="blatt__feld">
                <span class="blatt__label">{{ t("community.redaktion.blatt.dubletteVon") }}</span>
                <AvmEingabe
                    :model-value="abschluss.dubletteVon"
                    :placeholder="t('community.redaktion.blatt.dublettePlatzhalter')"
                    :gesperrt="props.sendet ? '' : undefined"
                    testid="community-blatt-dublette"
                    @update:model-value="(nummer: string) => (abschluss = mitDublette(abschluss, nummer))"
                />
            </label>

            <label class="blatt__feld">
                <span class="blatt__label">{{ t("community.redaktion.blatt.begruendung") }}</span>
                <AvmTextbereich
                    :model-value="abschluss.begruendung"
                    :zeilen="2"
                    :maxlength="COMMUNITY_GRENZEN.begruendungMax"
                    :gesperrt="props.sendet ? '' : undefined"
                    testid="community-blatt-begruendung"
                    @update:model-value="(text: string) => (abschluss = { ...abschluss, begruendung: text })"
                />
            </label>

            <AvmKaestchen
                art="checkbox"
                :checked="abschluss.nachrichtSenden && props.weg !== ''"
                :gesperrt="
                    props.weg === '' ? t('community.redaktion.grund.keinRueckweg') : props.sendet ? '' : undefined
                "
                testid="community-blatt-nachricht-senden"
                @change="(an: boolean) => (abschluss = { ...abschluss, nachrichtSenden: an })"
                >{{
                    t("community.redaktion.blatt.nachrichtAn", { weg: props.weg === "" ? "-" : props.weg })
                }}</AvmKaestchen
            >
            <AvmTextbereich
                v-if="abschluss.nachrichtSenden && props.weg !== ''"
                :model-value="abschluss.nachricht"
                :zeilen="3"
                :maxlength="COMMUNITY_GRENZEN.nachrichtMax"
                :gesperrt="props.sendet ? '' : undefined"
                :aria-label="t('community.redaktion.blatt.nachrichtText')"
                testid="community-blatt-nachricht"
                @update:model-value="(text: string) => (abschluss = { ...abschluss, nachricht: text })"
            />
        </template>

        <template v-else-if="props.art === 'wiedereroeffnen'">
            <p v-if="props.bisher !== null" class="blatt__leise">
                {{ t("community.redaktion.blatt.ergebnisBleibt", { ergebnis: ergebnisName(props.bisher) }) }}
            </p>
            <label class="blatt__feld">
                <span class="blatt__label">{{ t("community.redaktion.blatt.grund") }}</span>
                <AvmTextbereich
                    v-model="grund"
                    :zeilen="2"
                    :maxlength="COMMUNITY_GRENZEN.begruendungMax"
                    :gesperrt="props.sendet ? '' : undefined"
                    testid="community-blatt-grund"
                />
            </label>
        </template>

        <template v-else>
            <p class="blatt__text">{{ t("community.redaktion.blatt.loeschenFolge") }}</p>
            <p class="blatt__leise">{{ t("community.redaktion.blatt.loeschenPasskey") }}</p>
        </template>

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
                v-if="props.art === 'abschliessen'"
                art="gefuellt"
                :gesperrt="sperrText"
                :grund-bei="grundId"
                testid="community-blatt-los"
                @click="emit('abschliessen')"
                >{{ t("community.redaktion.blatt.abschliessenKnopf") }}</AvmKnopf
            >
            <AvmKnopf
                v-else-if="props.art === 'wiedereroeffnen'"
                art="gefuellt"
                :gesperrt="sperrText"
                :grund-bei="grundId"
                testid="community-blatt-los"
                @click="emit('wiedereroeffnen')"
                >{{ t("community.redaktion.blatt.wiedereroeffnenKnopf") }}</AvmKnopf
            >
            <AvmKnopf
                v-else
                art="gefahr"
                :gesperrt="props.sendet ? '' : undefined"
                testid="community-blatt-los"
                @click="emit('loeschen')"
                >{{ t("community.redaktion.blatt.loeschenKnopf") }}</AvmKnopf
            >
        </div>
        <!-- Der Grund, warum „Abschließen“ oder „Wieder öffnen“ noch nicht geht, steht sichtbar neben den Knöpfen (Guide §7, §13.19). -->
        <p v-if="sperrText !== undefined && sperrText !== ''" :id="grundId" class="blatt__sperre" role="note">
            {{ sperrText }}
        </p>
    </section>
</template>

<style scoped>
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

.blatt__text {
    margin: 0;
    color: var(--color-text);
}

.blatt__leise,
.blatt__sperre {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}
</style>
