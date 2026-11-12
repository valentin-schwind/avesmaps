import { ref, watch, type Ref } from "vue";

/**
 * Hängt ein nachgeladenes Fenster erst beim ersten Öffnen ein (WI-0235) und lässt es danach eingehängt: Das Laden beginnt so erst, wenn jemand das Fenster wirklich will, und von
 * da an öffnet und schließt es wie ein statisches Bauteil. Im Entwicklungsserver ist das Bauteil statisch (`nachladen.entwicklung.ts`), die Regel gilt dort genauso.
 */
export function einmalOffen(offen: () => unknown): Readonly<Ref<boolean>> {
    const eingehaengt = ref(Boolean(offen()));
    watch(offen, (jetzt) => {
        if (jetzt) eingehaengt.value = true;
    });
    return eingehaengt;
}
