interface RunningHeight {
    animation: Animation;
    overflow: string;
}
const running = new WeakMap<HTMLElement, RunningHeight>();

export function elementHeight(element: HTMLElement): number {
    return Number.parseFloat(getComputedStyle(element).height);
}

export function stopHeightAnimation(element: HTMLElement): void {
    const current = running.get(element);
    if (!current) return;
    running.delete(element);
    current.animation.cancel();
    element.style.overflow = current.overflow;
}

/** Eine neue Fahrt beginnt bei der gerade sichtbaren Höhe; fremde Animationen bleiben unberührt. */
export async function animateHeight(element: HTMLElement, from: number, to: number): Promise<boolean> {
    stopHeightAnimation(element);
    if (from === to || !Number.isFinite(from + to) || matchMedia("(prefers-reduced-motion: reduce)").matches)
        return true;
    const overflow = element.style.overflow;
    element.style.overflow = "clip";
    const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: to > from ? 150 : 110,
        easing: "ease",
    });
    const current = { animation, overflow };
    running.set(element, current);
    try {
        await animation.finished;
        return true;
    } catch {
        return false;
    } finally {
        if (running.get(element) === current) {
            running.delete(element);
            element.style.overflow = overflow;
        }
    }
}
