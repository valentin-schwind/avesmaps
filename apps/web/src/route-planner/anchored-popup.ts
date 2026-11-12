import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * Eine Liste, die an einem Feld hängt, aber NICHT im Panel lebt (Betreiber 2026-09-24: „die Liste
 * soll über den Routenplaner hinausgehen“). Im rollenden Planer zog eine lange Liste sonst einen
 * Scrollbalken auf und wurde am Rand abgeschnitten; Legacys Vorschlagsliste hängt ebenso am `body`.
 *
 * Die Komponente hängt die Liste per `<Teleport to="body">` um; hier steht nur, WO sie steht: fest
 * unter dem Feld, mindestens so breit wie das Feld, höchstens bis zum Fensterrand. Rollt das Panel
 * oder ändert sich das Fenster, wandert sie mit.
 */
export function useAnchoredPopup(
    anchor: Readonly<Ref<HTMLElement | null>>,
    open: Readonly<Ref<boolean>>,
    maxHeight = 360,
): Readonly<Ref<Record<string, string>>> {
    const style = ref<Record<string, string>>({});
    /** Abstand zum Feld und zum Fensterrand, in Pixeln. */
    const GAP = 2;
    const EDGE = 8;

    const place = (): void => {
        const box = anchor.value?.getBoundingClientRect();
        if (!box) return;
        const below = globalThis.innerHeight - box.bottom - GAP - EDGE;
        style.value = {
            top: `${String(box.bottom + GAP)}px`,
            left: `${String(box.left)}px`,
            minWidth: `${String(box.width)}px`,
            maxWidth: `${String(Math.max(box.width, globalThis.innerWidth - box.left - EDGE))}px`,
            maxHeight: `${String(Math.max(120, Math.min(maxHeight, below)))}px`,
        };
    };

    let listening = false;
    const listen = (on: boolean): void => {
        if (on === listening) return;
        listening = on;
        // `capture`: Auch das Rollen des Panels zählt, nicht nur das der Seite.
        if (on) {
            globalThis.addEventListener("scroll", place, true);
            globalThis.addEventListener("resize", place);
        } else {
            globalThis.removeEventListener("scroll", place, true);
            globalThis.removeEventListener("resize", place);
        }
    };

    watch(open, (isOpen) => {
        if (isOpen) place();
        listen(isOpen);
    });
    onBeforeUnmount(() => listen(false));
    return style;
}
