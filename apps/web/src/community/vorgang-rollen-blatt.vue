<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef, watch } from "vue";
import type { VorgangDetail } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { rolleName, rollenBlattFolge, rollenBlattZeilen, rollenGeaendert } from "./meldungen-modell";

/**
 * Das Blatt „Sonderrollen zuweisen“ im Vorgangsfenster (WI-0279; Entwurf „Meldungen an Rollen“ Fassung 3, abgenommen 2026-11-11): alle zwölf Rollen als Haken in zwei
 * Spalten, unter jeder, wer sie für diese Meldung hat (regional: nur die Leute der Regionen der Meldung; „noch niemand“ gedämpft). Vorangekreuzt sind die gesetzten Rollen.
 * Unten der Satz, wer neu in der Glocke hört (sonst der Hinweis auf „Meine“), und „Abbrechen“ / „Zuweisen“. Zuweisen setzt die ganze Menge; das Fenster führt es aus.
 *
 * - 🔴 **Verhindern statt erklären:** Ohne Änderung bleibt „Zuweisen“ gesperrt, mit Satz daneben (Guide §7, §13.19). Esc bricht das Blatt ab, nicht das Fenster.
 * - Die eigene Person steht unter den Inhabern in Gold, nicht als „Du“ (keine Anrede, Guide §24).
 */
const props = defineProps<{
    detail: Pick<VorgangDetail, "rollen" | "rollenInhaber"> & {
        readonly zeile: Pick<VorgangDetail["zeile"], "nummer">;
    };
    ich: string | undefined;
    sendet: boolean;
    fehler?: MessageKey | undefined;
    fehlerGrund?: string | undefined;
}>();
const emit = defineEmits<{ zuweisen: [rollen: string[]]; abbrechen: []; entwurf: [ja: boolean] }>();

const wurzel = useTemplateRef<HTMLElement>("wurzel");
const grundId = useId();
const gewaehlt = ref<string[]>((props.detail.rollen ?? []).map((rolle) => rolle.sonderrolle));

const zeilen = computed(() => rollenBlattZeilen(props.detail));
const geaendert = computed(() => rollenGeaendert(props.detail, gewaehlt.value));
const folge = computed(() => rollenBlattFolge(props.detail, gewaehlt.value, props.ich));
const sperrText = computed((): string | undefined => {
    if (props.sendet) return "";
    return geaendert.value ? undefined : t("community.redaktion.rollen.unveraendert");
});
const fehlerSatz = computed(() => (props.fehler === undefined ? undefined : (props.fehlerGrund ?? t(props.fehler))));
watch(geaendert, (ja) => emit("entwurf", ja), { immediate: true });

function schalte(rolle: string, an: boolean): void {
    gewaehlt.value = an ? [...new Set([...gewaehlt.value, rolle])] : gewaehlt.value.filter((r) => r !== rolle);
}

function zuweisen(): void {
    if (sperrText.value !== undefined) return;
    emit("zuweisen", [...gewaehlt.value]);
}

onMounted(() => wurzel.value?.scrollIntoView({ block: "nearest" }));

function esc(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    emit("abbrechen");
}
</script>

<template>
    <section
        ref="wurzel"
        class="blatt"
        :aria-label="t('community.redaktion.rollen.titel')"
        data-testid="community-blatt-rollen"
        @keydown="esc"
    >
        <div class="blatt__kopf">
            <h3 class="blatt__titel avm-versalmitte">{{ t("community.redaktion.rollen.titel") }}</h3>
            <p class="blatt__leise">{{ t("community.redaktion.rollen.erklaerung") }}</p>
        </div>
        <ul class="rollen">
            <li v-for="zeile in zeilen" :key="zeile.sonderrolle">
                <AvmKaestchen
                    art="checkbox"
                    mehrzeilig
                    :checked="gewaehlt.includes(zeile.sonderrolle)"
                    :gesperrt="props.sendet ? '' : undefined"
                    :testid="`community-blatt-rolle-${zeile.sonderrolle}`"
                    @change="(an: boolean) => schalte(zeile.sonderrolle, an)"
                >
                    <span class="rolle">
                        <span class="rolle__name">{{ rolleName(zeile.sonderrolle) }}</span>
                        <span v-if="zeile.personen.length === 0" class="blatt__leise">{{
                            t("community.redaktion.rollen.niemand")
                        }}</span>
                        <span v-else class="blatt__leise"
                            ><template v-for="(person, i) in zeile.personen" :key="person.id"
                                ><template v-if="i > 0">, </template
                                ><span :class="{ rolle__ich: person.id === props.ich }">{{
                                    person.name
                                }}</span></template
                            ></span
                        >
                    </span>
                </AvmKaestchen>
            </li>
        </ul>

        <AvmHinweis v-if="fehlerSatz !== undefined" ton="gefahr" rolle="alert" testid="community-blatt-fehler">{{
            fehlerSatz
        }}</AvmHinweis>

        <div class="blatt__fuss">
            <p class="blatt__leise blatt__folge" data-testid="community-blatt-rollen-folge">{{ folge }}</p>
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
                    @click="zuweisen"
                    >{{ t("community.redaktion.rollen.zuweisen") }}</AvmKnopf
                >
            </div>
        </div>
        <p v-if="sperrText !== undefined && sperrText !== ''" :id="grundId" class="blatt__sperre" role="note">
            {{ sperrText }}
        </p>
    </section>
</template>

<style scoped>
/* Dieselbe Bauart wie die anderen Blätter des Vorgangsfensters (`vorgang-korrektur-blatt.vue`): ein Kasten mit goldbrauner Kante am Anfang des Rumpfs. */
.blatt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-accent-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
}

.blatt__kopf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.blatt__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.blatt__leise,
.blatt__sperre {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Zwei Spalten, schmal eine (Entwurf: zwölf Haken in zwei Spalten). */
.rollen {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: var(--space-4) var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

.rolle {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    overflow-wrap: anywhere;
}

.rolle__name {
    color: var(--color-text-strong);
}

.rolle__ich {
    color: var(--color-accent-strong);
}

.blatt__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4) var(--space-8);
}

.blatt__folge {
    flex: 1 1 14rem;
}

.blatt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}
</style>
