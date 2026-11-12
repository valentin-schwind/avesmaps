<script setup lang="ts">
import { useId, useTemplateRef, watch } from "vue";
import { t } from "../i18n/i18n";
import { copyToClipboard } from "../route-planner/use-share-link";
import AvmEingabe from "./avm-eingabe.vue";
import AvmKnopf from "./avm-knopf.vue";
import { useKopieren } from "./avm-kopierfeld";

/**
 * Das Kopierfeld (WI-0120 A8; AUTH-0001 §12.3 „Kopierfeld mit ‚Link kopieren‘“): ein Einladungs- oder Rücksetzlink, den der
 * Admin selbst per Discord verschickt.
 *
 * - **Schreibgeschützt und markiert beim Fokus:** Ein Klick oder Tab markiert den ganzen Link, Strg+C nimmt ihn mit - auch
 *   dort, wo die Zwischenablage gesperrt ist (Legacys Mockup: „Text goldlasiert markiert“, hier die Auswahl in
 *   `--color-active-wash`).
 * - **„Link kopieren“** über den vorhandenen Weg des Kurzlinks (`copyToClipboard`), der auch ohne sichere Verbindung kopiert.
 * - 🔴 **Die Rückmeldung steht im Feld, nicht im Toast:** Im modalen Fenster läge der Toast unter dem Schleier (Risiko R5).
 *   Die Zeile darunter ist eine Statusregion; ein Vorleser hört „Der Link liegt in der Zwischenablage.“ Ging es nicht, ist
 *   der Link markiert, und die Zeile sagt, wie er trotzdem mitkommt. Ein neuer Link setzt die Zeile zurück.
 */
const props = defineProps<{
    /** Der Link (oder ein anderer Text), der kopiert wird. */
    wert: string;
    /** Was das Feld enthält, für Vorleser („Einladungslink für Alrike“). */
    beschriftung: string;
    testid?: string | undefined;
    /** Aufschrift des Knopfs und die Sätze danach, wenn es kein Link ist (etwa ein Schlüssel); ohne Angabe die des Links. */
    knopf?: string | undefined;
    fertig?: string | undefined;
    fehler?: string | undefined;
}>();

const feld = useTemplateRef<InstanceType<typeof AvmEingabe>>("feld");
const meldungId = useId();
const { zustand, kopiere, zuruecksetzen } = useKopieren(copyToClipboard);

watch(() => props.wert, zuruecksetzen);

function markieren(): void {
    feld.value?.select();
}

async function kopieren(): Promise<void> {
    if (!(await kopiere(props.wert))) {
        feld.value?.focus();
        feld.value?.select();
    }
}
</script>

<template>
    <div class="kopierfeld" :data-testid="props.testid">
        <div class="kopierfeld__zeile">
            <AvmEingabe
                ref="feld"
                class="kopierfeld__feld"
                :model-value="props.wert"
                readonly
                :aria-label="props.beschriftung"
                :aria-describedby="zustand === 'ruhe' ? undefined : meldungId"
                @focus="markieren"
                @click="markieren"
            />
            <AvmKnopf @click="kopieren">{{ props.knopf ?? t("ui.copy.button") }}</AvmKnopf>
        </div>
        <p
            :id="meldungId"
            class="kopierfeld__meldung"
            :class="{ 'is-da': zustand !== 'ruhe', 'kopierfeld__meldung--fehler': zustand === 'fehler' }"
            role="status"
        >
            {{
                zustand === "kopiert"
                    ? (props.fertig ?? t("ui.copy.done"))
                    : zustand === "fehler"
                      ? (props.fehler ?? t("ui.copy.failed"))
                      : ""
            }}
        </p>
    </div>
</template>

<style scoped>
.kopierfeld {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.kopierfeld__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.kopierfeld__feld {
    flex: 1 1 auto;
}

/* Die Markierung in der Lasur der Auswahl (Guide §2 „Zustände“), nicht im Blau des Systems. */
.kopierfeld__feld :deep(input::selection) {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

/* Leer nimmt die Zeile keinen Platz; sie bleibt trotzdem stehen, damit ein Vorleser die Meldung hört, wenn sie kommt. */
.kopierfeld__meldung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.kopierfeld__meldung.is-da {
    margin-top: var(--space-2);
}

.kopierfeld__meldung--fehler {
    color: var(--color-text);
}
</style>
