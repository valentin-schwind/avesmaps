import { onBeforeUnmount, onMounted, type Ref } from "vue";

/**
 * Das Verschieben eines Fensters am Kopf (Design Guide §12.2 `__griff`; Legacy `js/ui/dialog-drag.js`,
 * Owner 2026-07-28 und 04.09.2026: „alle Fenster sind verschiebbar und tragen den Griff“).
 *
 * - **Ein Erzeuger für alle Fenster.** Verschieben ist in Legacy nie auseinandergelaufen, weil es genau
 *   einen gab - deshalb hängt es an der Hülle (`avm-fenster.vue`) und nirgends sonst.
 * - **Nur Maus und Stift.** Am Finger füllt das Fenster den Schirm, ein Wischen auf dem Kopf wäre ein
 *   Fehlgriff. Dieselbe Bedingung blendet den Griff aus (`@media (hover: none) and (pointer: coarse)`).
 * - **Über `translate`, nicht `transform` und nicht `left/top`:** Die Hülle sitzt mittig in der obersten
 *   Ebene; `translate` ist eine eigene Eigenschaft und lässt Lage und Breite in Ruhe.
 * - **Doppelklick auf den Kopf** holt das Fenster in die Mitte zurück.
 */

/** So viel Fenster bleibt beim Ziehen mindestens im Bild - genug, um es wieder zu fassen (Legacy). */
export const MIN_SICHTBAR_X = 120;
export const MIN_SICHTBAR_Y = 24;

/** Bedienelemente im Kopf bleiben Bedienelemente: Schließen und das Kopffeld ziehen nicht. */
const NICHT_ZIEHEN = "button, a, input, select, textarea, summary, [role='button'], [contenteditable='true']";

export interface Lage {
    left: number;
    top: number;
    width: number;
    height: number;
    /** Die Höhe des Kopfes: nach oben ist Schluss, bevor er verschwindet - sonst gäbe es keinen Griff mehr. */
    kopfHoehe: number;
}

export interface Versatz {
    x: number;
    y: number;
}

function klemme(wert: number, min: number, max: number): number {
    return Math.min(Math.max(wert, min), max);
}

/**
 * Hält das Fenster am Bildschirm (Legacy `avesmapsClampDialogOffset`). `lage` ist seine Lage OHNE
 * Versatz, `wunsch` der gewünschte Gesamtversatz; zurück kommt der erlaubte.
 *
 * 🔴 Die unverschobene Lage ist IMMER erlaubt. Sonst machte ein Fenster, das von Haus aus über den Rand
 * ragt, beim ersten Anfassen einen Sprung - die Begrenzung soll bremsen, nicht schubsen.
 */
export function begrenzeVersatz(lage: Lage, wunsch: Versatz, bild: { width: number; height: number }): Versatz {
    const sichtX = Math.min(MIN_SICHTBAR_X, lage.width);
    const links = klemme(
        lage.left + wunsch.x,
        Math.min(sichtX - lage.width, lage.left),
        Math.max(bild.width - sichtX, lage.left),
    );
    const sichtY = Math.min(Math.max(lage.kopfHoehe, MIN_SICHTBAR_Y), lage.height);
    const oben = klemme(lage.top + wunsch.y, Math.min(0, lage.top), Math.max(bild.height - sichtY, lage.top));
    return { x: links - lage.left, y: oben - lage.top };
}

/** Der Kopf zieht das Fenster; zurück kommen die Zuhörer, die die Hülle an den Kopf hängt. */
export function useFensterZiehen(
    fenster: Readonly<Ref<HTMLElement | null>>,
    kopf: Readonly<Ref<HTMLElement | null>>,
): {
    onPointerDown: (event: PointerEvent) => void;
    onDoubleClick: (event: MouseEvent) => void;
} {
    let versatz: Versatz = { x: 0, y: 0 };
    let zug: { zeiger: number; startX: number; startY: number; anfang: Versatz } | null = null;

    function setze(neu: Versatz): void {
        versatz = neu;
        const element = fenster.value;
        if (!element) return;
        if (neu.x === 0 && neu.y === 0) element.style.removeProperty("translate");
        else element.style.translate = `${String(Math.round(neu.x))}px ${String(Math.round(neu.y))}px`;
    }

    /** Die Lage, als wäre das Fenster nie verschoben worden - frisch gemessen, weil Fenster wachsen. */
    function grundlage(): Lage | null {
        const element = fenster.value;
        if (!element) return null;
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return null;
        return {
            left: box.left - versatz.x,
            top: box.top - versatz.y,
            width: box.width,
            height: box.height,
            kopfHoehe: kopf.value?.getBoundingClientRect().height ?? 0,
        };
    }

    function ziele(wunsch: Versatz): void {
        const lage = grundlage();
        if (lage) setze(begrenzeVersatz(lage, wunsch, { width: innerWidth, height: innerHeight }));
    }

    function onPointerMove(event: PointerEvent): void {
        if (!zug || event.pointerId !== zug.zeiger) return;
        ziele({ x: zug.anfang.x + event.clientX - zug.startX, y: zug.anfang.y + event.clientY - zug.startY });
    }

    function onPointerUp(event: PointerEvent): void {
        if (!zug || event.pointerId !== zug.zeiger) return;
        zug = null;
        removeEventListener("pointermove", onPointerMove);
        removeEventListener("pointerup", onPointerUp);
        removeEventListener("pointercancel", onPointerUp);
    }

    function onPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || event.pointerType === "touch") return;
        if ((event.target as Element | null)?.closest(NICHT_ZIEHEN)) return;
        zug = { zeiger: event.pointerId, startX: event.clientX, startY: event.clientY, anfang: { ...versatz } };
        addEventListener("pointermove", onPointerMove);
        addEventListener("pointerup", onPointerUp);
        addEventListener("pointercancel", onPointerUp);
        // Ohne das markiert das Ziehen den Titel.
        event.preventDefault();
    }

    function onDoubleClick(event: MouseEvent): void {
        if ((event.target as Element | null)?.closest(NICHT_ZIEHEN)) return;
        setze({ x: 0, y: 0 });
    }

    /** Wird das Browserfenster kleiner, holt es ein verschobenes Fenster zurück ins Bild. */
    function nachziehen(): void {
        if (versatz.x !== 0 || versatz.y !== 0) ziele(versatz);
    }

    onMounted(() => addEventListener("resize", nachziehen));
    onBeforeUnmount(() => {
        removeEventListener("resize", nachziehen);
        onPointerUp({ pointerId: zug?.zeiger ?? -1 } as PointerEvent);
    });

    return { onPointerDown, onDoubleClick };
}
