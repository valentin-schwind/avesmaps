<script setup lang="ts">
/**
 * Das Zeichen des Knopfs „Reise als PDF speichern“ in der Reiseübersicht (WI-0306, Entwurf Fassung 6): ein Blatt mit Eselsohr und davor die
 * Fahne „PDF“. Die Buchstaben sind Striche, keine Schrift (kein Text im Bauteil), ausgespart in der Fläche des Knopfs (`--pdf-zeichen-grund`).
 * 🔴 Fest gezeichnet und ohne die Zeichentafel des Fensters (`reise-pdf-zeichen.ts`): Es steht im Start-JS, das Fenster lädt nach.
 */
</script>

<template>
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        <path d="M6 2.8h8.2L19 7.6v13.6H6z" />
        <path d="M14 2.8v5h5" />
        <rect class="pdf-zeichen__fahne" x="1.6" y="10.4" width="16.4" height="8.2" rx="1.6" />
        <path
            class="pdf-zeichen__buchstaben"
            d="M4.5 16.8V12.4h1.3a1.15 1.15 0 0 1 0 2.3H4.5M8.4 16.8V12.4h0.8a2.2 2.2 0 0 1 0 4.4zM12.9 16.8V12.4h2.5M12.9 14.5h2"
        />
    </svg>
</template>

<style scoped>
.pdf-zeichen__fahne {
    fill: currentColor;
    stroke: none;
}

.pdf-zeichen__buchstaben {
    stroke: var(--pdf-zeichen-grund, var(--color-button-soft));
    stroke-width: 1.1;
}
</style>
