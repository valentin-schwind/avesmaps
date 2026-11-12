<script setup lang="ts">
/**
 * Das Eselsohr einer Fächerzelle (WI-0036, Betreiber 2026-09-25): der Griff zur Unterreihe.
 *
 * Gezeichnet wie ein echtes: die Bildecke FEHLT (oben rechts, in der Farbe der Fläche dahinter), davor
 * liegt die umgeklappte LASCHE mit Ebenen-Zeichen, 1 px Kontur, gerundeter Spitze und einem Schatten
 * nur nach links unten aufs Bild.
 *
 * 🔴 Es KLAPPT: die Klappe dreht sich 180° um die Diagonale (oben links nach unten rechts). Eine solche
 * Drehung spiegelt jeden Punkt an der Diagonale - die Ecke oben rechts landet als Lasche unten links.
 * Vorn trägt die Klappe eine Kopie der Bildecke, ungeklappt sieht man also keinen Unterschied.
 * 💣 Die Rückseite ist selbst schon um 180° gedreht und unten links beschnitten: nach der Drehung der
 * Klappe steht sie richtig herum, und ihr Zeichen ist nicht gespiegelt.
 *
 * Wann das Ohr da ist, entscheidet der Fächer über `--ohr-da` (0/1) und `visibility` an diesem
 * Element; Größe und Lage liest es aus `--fan-bild`.
 */
import FanThumb from "./fan-thumb.vue";

defineProps<{
    base?: string | undefined;
    overlay?: string | undefined;
    desaturate?: boolean;
}>();
</script>

<template>
    <span class="fan-ohr" aria-hidden="true">
        <span class="fan-ohr__loch" />
        <span class="fan-ohr__schatten" />
        <span class="fan-ohr__klappe">
            <span class="fan-ohr__vorn">
                <span class="fan-ohr__bild">
                    <FanThumb :base="base" :overlay="overlay" :desaturate="desaturate" />
                </span>
            </span>
            <span class="fan-ohr__hinten">
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linejoin="round"
                    focusable="false"
                >
                    <path d="M12 3 2 8l10 5 10-5-10-5Z" />
                    <path d="m2 13 10 5 10-5" />
                </svg>
            </span>
        </span>
    </span>
</template>

<style scoped>
.fan-ohr {
    --ohr: 30px;
    --ohr-zeichen: 12px;
    --ohr-lasche: color-mix(in srgb, var(--color-border-strong) 60%, var(--color-panel));
    --ohr-farbe: var(--color-text);
    /* Dieselbe Farbe wie der Rand des überfahrenen Bildes (Betreiber 2026-09-25). */
    --ohr-kontur: var(--color-text);

    position: absolute;
    top: 0;
    left: calc(50% + var(--fan-bild, 52px) / 2 - var(--ohr));
    z-index: 3;
    width: var(--ohr);
    height: var(--ohr);
    perspective: calc(var(--ohr) * 4);
    color: var(--ohr-farbe);
    cursor: pointer;
    visibility: hidden;
    transition: visibility 0s linear 200ms;
}

/*
 * 💣 Nur das flache Quadrat nimmt Zeiger an. Die gedrehten Innenteile hatten eine Trefferfläche, die
 * bis unter das Ohr reichte - am Finger öffnete ein Tipp auf die Kachelmitte die Unterreihe.
 */
.fan-ohr * {
    pointer-events: none;
}

/*
 * Überfahren färbt die Lasche dunkel - neutral, nie golden: golden heißt „gewählt“ (Legacy).
 * 💣 Nur am echten Zeiger: ein Element, dessen Aussehen auf `:hover` reagiert, lässt Chrome einen
 * Tipp am Finger auf sich einrasten - das Ohr fing so Tipps auf die Kachelmitte ab.
 */
@media (hover: hover) {
    .fan-ohr:hover {
        --ohr-lasche: var(--color-text);
        --ohr-farbe: var(--color-panel);
    }
}

/* Das Loch zeigt, was hinter dem Bild liegt; eckig, sonst schiene ein Bogen der Kontur durch. */
.fan-ohr__loch {
    position: absolute;
    inset: 0;
    background:
        linear-gradient(to bottom left, var(--ohr-loch-schimmer, transparent) 50%, transparent 50%),
        linear-gradient(to bottom left, var(--color-panel) 50%, transparent 50%);
}

/* Ein unsichtbares Dreieck an der Stelle der Lasche, das nur seinen Schatten wirft - erst wenn sie fast liegt. */
.fan-ohr__schatten {
    position: absolute;
    inset: 0;
    filter: drop-shadow(-1px 1px 1.5px color-mix(in srgb, var(--color-text) 45%, transparent));
    opacity: var(--ohr-da, 0);
    transition: opacity 120ms ease;
    transition-delay: calc(var(--ohr-da, 0) * 170ms);
}

.fan-ohr__schatten::before {
    content: "";
    position: absolute;
    inset: 0;
    border-bottom-left-radius: var(--radius-sm);
    clip-path: polygon(0 0, 0 100%, 100% 100%);
    background: var(--ohr-lasche);
}

.fan-ohr__klappe {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    transform-origin: 50% 50%;
    transform: rotate3d(1, 1, 0, calc(var(--ohr-da, 0) * 180deg));
    transition: transform var(--ohr-dauer, 200ms) var(--ohr-kurve, cubic-bezier(0.4, 0, 1, 1));
}

.fan-ohr__vorn,
.fan-ohr__hinten {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
}

/* Die Klappe IST die runde Bildecke: vorn oben rechts gerundet wie das Bild, hinten an der Spitze. */
.fan-ohr__vorn {
    overflow: hidden;
    border-top-right-radius: var(--radius-sm);
    clip-path: polygon(0 0, 100% 0, 100% 100%);
}

.fan-ohr__bild {
    position: absolute;
    top: 0;
    left: calc(var(--ohr) - var(--fan-bild, 52px));
}

/* Die Lasche mit 1 px Kontur an allen drei Kanten: die Schenkel als Rand, die Knickkante als Verlauf. */
.fan-ohr__hinten {
    box-sizing: border-box;
    border-bottom: 1px solid var(--ohr-kontur);
    border-left: 1px solid var(--ohr-kontur);
    border-bottom-left-radius: var(--radius-sm);
    clip-path: polygon(0 0, 0 100%, 100% 100%);
    transform: rotate3d(1, 1, 0, 180deg);
    background: linear-gradient(
        to top right,
        var(--ohr-lasche) calc(50% - 1px),
        var(--ohr-kontur) calc(50% - 1px),
        var(--ohr-kontur) 50%,
        transparent 50%
    );
}

/* Mitte des Inkreises der Lasche: 29 % der Kante von links und unten. */
.fan-ohr__hinten svg {
    position: absolute;
    bottom: 29%;
    left: 29%;
    display: block;
    width: var(--ohr-zeichen);
    height: auto;
    transform: translate(-50%, 50%);
}

@media (prefers-reduced-motion: reduce) {
    .fan-ohr,
    .fan-ohr__klappe,
    .fan-ohr__schatten {
        transition: none;
    }
}
</style>
