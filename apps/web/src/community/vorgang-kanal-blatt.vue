<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, useId, useTemplateRef, watch } from "vue";
import type { VorgangZeile } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import {
    KANAL_NACHRICHT_MAX,
    KANAL_TITEL_MAX,
    kanalBody,
    kanalFehlerSatz,
    kanalHatEntwurf,
    kanalKategorien,
    kanalPrioritaeten,
    kanalSperre,
    neuerKanalEntwurf,
    type KanalEntwurf,
} from "./verknuepfen-modell";

/**
 * Das kleine Blatt „An den Betreiber-Kanal weiterreichen“ im Vorgangsfenster (WI-0268 C7; Fachkonzept WI-0263 §7): Es legt im Betreiber-Kanal der eigenen Umgebung einen Vorgang an und verknüpft ihn
 * mit diesem (der Verweis ist die OPS-Nummer). Das Menü zeigt den Eintrag nur mit `use_operator_channel`.
 *
 * - **Vorbelegt** (`neuerKanalEntwurf`): der Titel „COM-… · ‹Kategorie› · ‹Bezug›“, die Kategorie des Kanals (Meldung: Karteninhalt, Anfrage: Nutzerfrage), die Priorität des Vorgangs und die Nachricht
 *   „Aus Community-Vorgang COM-… / Bezug: …“. Alles lässt sich ändern.
 * - 🔴 **Keine Melderdaten:** Name, Adresse, Text, Quelle und Betreff des Melders kommen in keinem Feld vor, und der Server fügt nichts dazu. Das Blatt sagt es in einem Satz.
 * - **Danach** steht hier der Satz „Weitergereicht als OPS-…“ mit dem Weg in den Kanal und „Fertig“. Der Vorgang bleibt offen: Abschließen ist ein eigener Schritt.
 * - 🔴 **Gesperrt heißt: ein Satz** (Guide §7, §13.19). Esc bricht das Blatt ab, nicht das ganze Fenster.
 */
const props = defineProps<{
    zeile: Pick<VorgangZeile, "nummer" | "kategorie" | "bezugArt" | "bezugName" | "art" | "prioritaet">;
    /** Eine Handlung läuft: alles gesperrt. */
    sendet: boolean;
    /** Ein Fehler des letzten Versuchs (der allgemeine Satz der Oberfläche; Rückfall). */
    fehler?: MessageKey | undefined;
    /** Der genaue Grund des Servers, wenn er einen nannte (`redaktionGrund`); er geht dem allgemeinen Satz vor. */
    fehlerGrund?: string | undefined;
    /** Die OPS-Nummer, unter der der Vorgang weitergereicht wurde; gesetzt heißt: Es ist gelungen. */
    gesendet?: string | undefined;
}>();
const emit = defineEmits<{
    senden: [body: ReturnType<typeof kanalBody>];
    /** Den neuen Vorgang im Kanal öffnen. */
    oeffneKanal: [ops: string];
    /** „Fertig“ und „Abbrechen“. */
    abbrechen: [];
    /** Hat jemand schon etwas geändert, das beim Schließen verloren ginge? */
    entwurf: [ja: boolean];
}>();

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const grundId = useId();
const anfang = neuerKanalEntwurf(props.zeile);
const entwurf = reactive<KanalEntwurf>({ ...anfang });
const kategorien = computed(() => kanalKategorien());
const prioritaeten = computed(() => kanalPrioritaeten());
const kategorieWahl = computed({
    get: (): string => entwurf.kategorie,
    set: (wert: string) => {
        entwurf.kategorie = kanalKategorien().find((k) => k.wert === wert)?.wert ?? entwurf.kategorie;
    },
});
const prioritaetWahl = computed({
    get: (): string => entwurf.prioritaet,
    set: (wert: string) => {
        entwurf.prioritaet = kanalPrioritaeten().find((p) => p.wert === wert)?.wert ?? entwurf.prioritaet;
    },
});

const sperre = computed((): MessageKey | undefined => kanalSperre(entwurf));
const sperrText = computed(() => {
    if (props.sendet) return "";
    return sperre.value === undefined ? undefined : t(sperre.value);
});
const titel = computed(() => t("community.kanal.blatt.titel", { nummer: props.zeile.nummer }));
const fehlerSatz = computed(
    () => props.fehlerGrund ?? (props.fehler === undefined ? undefined : t(kanalFehlerSatz(props.fehler))),
);

function senden(): void {
    if (sperre.value !== undefined || props.sendet) return;
    emit("senden", kanalBody(entwurf));
}

watch(
    () => kanalHatEntwurf(entwurf, anfang) && props.gesendet === undefined,
    (ja) => emit("entwurf", ja),
    { immediate: true },
);

/** Beim Erscheinen ins Bild holen und auf die Nachricht: Das Blatt steht oben im Rumpf, der Rumpf kann gerollt sein. */
onMounted(() => {
    wurzel.value?.scrollIntoView({ block: "nearest" });
    wurzel.value?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true });
});

onBeforeUnmount(() => emit("entwurf", false));

function esc(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc bricht das Blatt ab, nicht das ganze Fenster.
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <section ref="wurzel" class="blatt" :aria-label="titel" data-testid="community-blatt-kanal" @keydown="esc">
        <h3 class="blatt__titel avm-versalmitte">{{ titel }}</h3>

        <template v-if="props.gesendet !== undefined">
            <p class="blatt__gesendet" role="status" data-testid="community-blatt-kanal-gesendet">
                {{ t("community.kanal.gesendet", { ops: props.gesendet }) }}
            </p>
            <p class="blatt__leise">{{ t("community.kanal.gesendet.hinweis") }}</p>
            <div class="blatt__knoepfe">
                <AvmKnopf testid="community-blatt-kanal-oeffnen" @click="emit('oeffneKanal', props.gesendet)">{{
                    t("community.kanal.gesendet.oeffnen")
                }}</AvmKnopf>
                <AvmKnopf art="gefuellt" testid="community-blatt-kanal-fertig" @click="emit('abbrechen')">{{
                    t("community.kanal.gesendet.fertig")
                }}</AvmKnopf>
            </div>
        </template>
        <template v-else>
            <p class="blatt__leise">{{ t("community.kanal.blatt.erklaerung", { nummer: props.zeile.nummer }) }}</p>

            <label class="blatt__feld">
                <span class="blatt__label">{{ t("community.kanal.blatt.titelFeld") }}</span>
                <AvmEingabe
                    v-model="entwurf.titel"
                    :maxlength="KANAL_TITEL_MAX"
                    :gesperrt="props.sendet ? '' : undefined"
                    testid="community-blatt-kanal-titel"
                />
            </label>
            <div class="blatt__zeile">
                <label class="blatt__feld">
                    <span class="blatt__label">{{ t("community.kanal.blatt.kategorie") }}</span>
                    <AvmAuswahl
                        v-model="kategorieWahl"
                        :optionen="kategorien"
                        :gesperrt="props.sendet ? '' : undefined"
                        testid="community-blatt-kanal-kategorie"
                    />
                </label>
                <label class="blatt__feld">
                    <span class="blatt__label">{{ t("community.kanal.blatt.prioritaet") }}</span>
                    <AvmAuswahl
                        v-model="prioritaetWahl"
                        :optionen="prioritaeten"
                        :gesperrt="props.sendet ? '' : undefined"
                        testid="community-blatt-kanal-prioritaet"
                    />
                </label>
            </div>
            <label class="blatt__feld">
                <span class="blatt__label">{{ t("community.kanal.blatt.nachricht") }}</span>
                <AvmTextbereich
                    v-model="entwurf.nachricht"
                    :zeilen="4"
                    :maxlength="KANAL_NACHRICHT_MAX"
                    :gesperrt="props.sendet ? '' : undefined"
                    testid="community-blatt-kanal-nachricht"
                />
            </label>

            <AvmHinweis v-if="fehlerSatz !== undefined" ton="gefahr" rolle="alert" testid="community-blatt-fehler">{{
                fehlerSatz
            }}</AvmHinweis>

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
                    @click="senden"
                    >{{ t("community.kanal.blatt.senden") }}</AvmKnopf
                >
            </div>
            <!-- Der Grund, warum „Weiterreichen“ noch nicht geht, steht sichtbar neben den Knöpfen (Guide §7, §13.19). -->
            <p v-if="sperrText !== undefined && sperrText !== ''" :id="grundId" class="blatt__sperre" role="note">
                {{ sperrText }}
            </p>
        </template>
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

.blatt__zeile {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
}

/* Nur in der Zeile teilen sich die Felder die Breite; in der Spalte des Blatts wäre die Basis eine Höhe und risse eine Lücke auf. */
.blatt__zeile > .blatt__feld {
    flex: 1 1 10em;
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

.blatt__gesendet {
    margin: 0;
    color: var(--color-text-strong);
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}
</style>
