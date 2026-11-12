<script setup lang="ts">
/**
 * Der Statuspunkt mit Hof (Guide §15 „kleiner gefüllter Kreis mit Halo-Ring“; WI-0120 A8; AUTH-0001 §12.4: das Mockup
 * zeigte ihn ohne Hof, Text und Punkt in voller Farbe).
 *
 * - **Punkt und Hof wie Legacy:** 9 px, rund, darum ein Ring von 3 px in der Hoffarbe (`--avm-status-dot`,
 *   `--avm-status-halo`; Legacy `.presence-user__dot`, `.va-live__dot`). Der Hof hebt den Punkt vom Panel ab, ohne ihm eine
 *   Kante zu geben.
 * - **Vier Töne:** `erfolg` (aktiv, online), `ruhe` (aus, offline: der gedämpfte Text), `warnung` (läuft, wartet),
 *   `gefahr` (gesperrt, fehlgeschlagen). Die Farbe trägt nur der Punkt; der Text daneben bleibt in der Schriftfarbe, denn
 *   er sagt den Zustand in Worten - ein Punkt allein, nur über die Farbe, verstünde nicht jeder (deshalb ist `text` Pflicht
 *   und der Punkt für Vorleser stumm).
 * - Die Zeile sitzt mit ihrer Versalhöhe mittig zum Punkt (`.avm-versalmitte`, §3.2). Keine Zustände: eine Angabe.
 */
defineProps<{
    ton?: "erfolg" | "ruhe" | "warnung" | "gefahr" | undefined;
    text: string;
    testid?: string | undefined;
}>();
</script>

<template>
    <span class="status" :class="`status--${ton ?? 'ruhe'}`" :data-testid="testid">
        <span class="status__punkt" aria-hidden="true"></span>
        <span class="status__text avm-versalmitte">{{ text }}</span>
    </span>
</template>

<style scoped>
.status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    color: var(--color-text);
    font-size: var(--font-size-body);
    white-space: nowrap;
}

/* Der Hof ist ein Schatten und nimmt keinen Platz: Der Rand vorn hält ihn im eigenen Kasten. */
.status__punkt {
    flex: none;
    width: var(--avm-status-dot);
    height: var(--avm-status-dot);
    margin-inline-start: var(--avm-status-halo);
    border-radius: 50%;
    background: var(--color-text-muted);
    box-shadow: 0 0 0 var(--avm-status-halo) var(--color-muted-halo);
}

.status--erfolg .status__punkt {
    background: var(--color-success);
    box-shadow: 0 0 0 var(--avm-status-halo) var(--color-success-halo);
}

.status--warnung .status__punkt {
    background: var(--color-warning);
    box-shadow: 0 0 0 var(--avm-status-halo) var(--color-warning-halo);
}

.status--gefahr .status__punkt {
    background: var(--color-danger);
    box-shadow: 0 0 0 var(--avm-status-halo) var(--color-danger-halo);
}
</style>
