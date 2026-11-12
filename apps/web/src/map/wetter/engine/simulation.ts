import { tri, use, type Ziel } from "./gl";
import { DM, MN, PN, VN, type Gpu, type Kern } from "./kern";
import { clamp, sstep } from "./mathe";
import { zAb } from "./zeitmessung";

/**
 * Die Rechnung auf der GPU: Strömung (Wirbel, Antrieb, Druckschritt, Projektion), die drei Wetterstufen, Schnee am Boden, Meeresströmung
 * und die Partikel. Die Folge der Durchgänge ist die des Prototyps; die Simulation ist deterministisch.
 */

/** Felder leeren, Uhr und Takt zurück, Partikel mit zufälliger Lebensdauer neu. */
export function initSim(k: Kern, g: Gpu): void {
    const { gl, F } = g;
    for (const f of [
        F.u,
        F.u2,
        F.p,
        F.p2,
        F.snow,
        F.snow2,
        F.m,
        F.m2,
        F.mp,
        F.mp2,
        ...g.stufen.flatMap((s) => [s.a, s.b]),
    ]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    k.time = 0;
    k.ofs = [0, 0];
    k.WL[1]!.stale = k.WL[2]!.stale = true;
    k.wxStart = true;
    k.taktWarte = 0;
    k.taktRest = 0;
    k.phase = 0;
    const n = PN * PN;
    const d = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
        const o = i * 4,
            w = 5 + Math.random() * 11;
        d[o + 2] = Math.random() * w;
        d[o + 3] = w;
    }
    for (const a of [g.pt.A, g.pm.A]) {
        gl.bindTexture(gl.TEXTURE_2D, a.tex[0]!);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PN, PN, gl.RGBA, gl.FLOAT, d);
    }
    k.pt.d = 0;
}

export function bewegePartikel(k: Kern, g: Gpu, dt: number): void {
    const { gl, P, T, F, vao } = g,
        cfg = k.cfg,
        vp = k.vp,
        invVP = k.invVP;
    // `invVP` entsteht mit `vp` (`aktualisiereKamera`).
    if (!vp || !invVP || (!cfg.partikel && !cfg.meer)) return;
    zAb(gl, k.uhrGpu, "teilchen");
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, PN, PN);
    const PT = g.pt,
        PM = g.pm;
    gl.bindFramebuffer(gl.FRAMEBUFFER, PT.B.fb);
    use(gl, P.part, {
        uPrev: PT.A.tex[0],
        uVel: F.u.tex[0],
        uD0: k.D0,
        uDt: dt,
        uT: k.time,
        uNeu: k.pt.neu,
        uZug: clamp(k.cam.dist / 800, 0.02, 1),
        uVP: vp,
        uInvVP: invVP,
        uEye: k.eye,
        uHM: T.hm,
        uNurMeer: 0,
        uSaat: 0,
    });
    tri(gl, vao);
    const t = PT.A;
    PT.A = PT.B;
    PT.B = t;
    if (cfg.meer) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, PM.B.fb);
        use(gl, P.part, {
            uPrev: PM.A.tex[0],
            uVel: F.m.tex[0],
            uD0: DM,
            uDt: dt,
            uT: k.time,
            uNeu: k.pt.neu,
            uZug: clamp(k.cam.dist / 800, 0.02, 1),
            uVP: vp,
            uInvVP: invVP,
            uEye: k.eye,
            uHM: T.hm,
            uNurMeer: 1,
            uSaat: 37,
        });
        tri(gl, vao);
        const m = PM.A;
        PM.A = PM.B;
        PM.B = m;
    }
    zAb(gl, k.uhrGpu, null);
}

// ---- Meeresströmung: eigene flache Rechnung auf 512² (9 km je Zelle). Das Land ist Wand, die Symbole treiben, Rückströmungen entstehen von selbst.
function stepMeer(k: Kern, g: Gpu, dt: number): void {
    if (!k.cfg.meer) return;
    const { gl, P, T, F, vao } = g;
    const MC = DM[2] / MN,
        PXM = [1 / MN, 1 / MN];
    let s: Ziel;
    gl.viewport(0, 0, MN, MN);
    if (!k.meerMaske) {
        k.meerMaske = true;
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.mt.fb);
        use(gl, P.meertiefe, { uHM: T.hm, uD0: DM });
        tri(gl, vao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.mjw.fb);
        use(gl, P.gewicht, { uTiefe: F.mt.tex[0], uPx: PXM });
        tri(gl, vao);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.m2.fb);
    use(gl, P.meer, {
        uVel: F.m.tex[0],
        uTiefe: F.mt.tex[0],
        uD0: DM,
        uDt: dt,
        uMN: k.mN,
        "uM[0]": k.mP,
        "uMV[0]": k.mV,
    });
    tri(gl, vao);
    s = F.m;
    F.m = F.m2;
    F.m2 = s;
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.md.fb);
    use(gl, P.div, { uVel: F.m.tex[0], uTiefe: F.mt.tex[0], uPx: PXM, uCell: MC });
    tri(gl, vao);
    for (let i = 0; i < 12; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.mp2.fb);
        use(gl, P.jac, { uP: F.mp.tex[0], uDiv: F.md.tex[0], uW: F.mjw.tex[0], uN: MN, uWrap: 0, uCell: MC });
        tri(gl, vao);
        s = F.mp;
        F.mp = F.mp2;
        F.mp2 = s;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.m2.fb);
    use(gl, P.proj, { uVel: F.m.tex[0], uP: F.mp.tex[0], uPx: PXM, uCell: MC });
    tri(gl, vao);
    s = F.m;
    F.m = F.m2;
    F.m2 = s;
}

/** Die erste Hälfte eines Schritts: die Strömung mit Druckschritt (24 Jacobi-Durchgänge). */
export function stroemungsSchritt(k: Kern, g: Gpu, dt: number): void {
    const { gl, P, T, F, vao } = g,
        cfg = k.cfg,
        { D0, PX, CELL } = k;
    k.time += dt;
    k.ofs[0] += 2.5 * cfg.wind * dt;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    zAb(gl, k.uhrGpu, "stroemung");
    if (k.tiefeFuer !== cfg.schicht) {
        k.tiefeFuer = cfg.schicht;
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.tiefe.fb);
        gl.viewport(0, 0, VN, VN);
        use(gl, P.tiefe, {
            uHM: T.hm,
            uD0: D0,
            uLod: Math.max(Math.log2(CELL / 0.5) - 1, 0),
            uSchicht: cfg.schicht / 1000,
        });
        tri(gl, vao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.jw.fb);
        use(gl, P.gewicht, { uTiefe: F.tiefe.tex[0], uPx: PX });
        tri(gl, vao);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.curl.fb);
    gl.viewport(0, 0, VN, VN);
    use(gl, P.curl, { uVel: F.u.tex[0], uPx: PX, uCell: CELL });
    tri(gl, vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.u2.fb);
    use(gl, P.vel, {
        uVel: F.u.tex[0],
        uCurl: F.curl.tex[0],
        uTiefe: F.tiefe.tex[0],
        uWellen: cfg.wellen,
        uD0: D0,
        uPx: PX,
        uDt: dt,
        uT: k.time,
        uWindK: cfg.wind,
        uConf: cfg.conf * 0.9,
        uCell: CELL,
        uGN: k.gN,
        "uG[0]": k.gP,
        "uGV[0]": k.gV,
    });
    tri(gl, vao);
    let s = F.u;
    F.u = F.u2;
    F.u2 = s;
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.div.fb);
    use(gl, P.div, { uVel: F.u.tex[0], uTiefe: F.tiefe.tex[0], uPx: PX, uCell: CELL });
    tri(gl, vao);
    zAb(gl, k.uhrGpu, "jacobi");
    for (let i = 0; i < 24; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, F.p2.fb);
        use(gl, P.jac, { uP: F.p.tex[0], uDiv: F.div.tex[0], uW: F.jw.tex[0], uN: VN, uWrap: 1, uCell: CELL });
        tri(gl, vao);
        s = F.p;
        F.p = F.p2;
        F.p2 = s;
    }
    zAb(gl, k.uhrGpu, "stroemung");
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.u2.fb);
    use(gl, P.proj, { uVel: F.u.tex[0], uP: F.p.tex[0], uPx: PX, uCell: CELL });
    tri(gl, vao);
    s = F.u;
    F.u = F.u2;
    F.u2 = s;
    zAb(gl, k.uhrGpu, null);
}

/** Die zweite Hälfte eines Schritts: die Wetterstufen (jede liest ihr Elternfeld nach dessen Schritt), Schnee am Boden, Meer. */
export function wetterSchritt(k: Kern, g: Gpu, dt: number): void {
    const { gl, P, T, F, vao } = g,
        cfg = k.cfg,
        D0 = k.D0;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    k.WL.forEach((l, i) => {
        if (!l.on) return;
        const st = g.stufen[i]!,
            p = i ? k.WL[i - 1]! : l,
            ps = i ? g.stufen[i - 1]! : st;
        zAb(gl, k.uhrGpu, "wetter" + i);
        gl.bindFramebuffer(gl.FRAMEBUFFER, st.b.fb);
        gl.viewport(0, 0, l.res, l.res);
        use(gl, P.wx, {
            uPrevA: st.a.tex[0],
            uPrevZ: st.a.tex[1],
            uParA: ps.a.tex[0],
            uParZ: ps.a.tex[1],
            uVel: F.u.tex[0],
            uCurl: F.curl.tex[0],
            uHM: T.hm,
            uVeg: T.veg,
            uNBase: T.nBase,
            uD0: D0,
            uPar: [p.c[0], p.c[1], p.e],
            uC: l.c,
            uOfs: k.ofs,
            uE: l.e,
            uDt: dt,
            uT: k.time,
            uTN: cfg.tn,
            uTS: cfg.ts,
            uKern: cfg.kern,
            uAuge: cfg.auge,
            uEvap: cfg.evap,
            uEvapMeer: cfg.evapMeer ?? cfg.evap,
            uOro: cfg.oro,
            uRegen: cfg.regen,
            uFront: cfg.front,
            uTief: cfg.tief,
            uFeucht: cfg.feucht,
            uMacht: cfg.thick / 4000,
            uStart: k.wxStart && i === 0 ? 1 : 0,
            uLodH: Math.max(Math.log2(l.e / l.res / 0.5), 0),
            uCellW: l.e / l.res,
            uMF: l.mf,
            uMR: l.mr,
            uLevel: i,
            uGN: k.gN,
            "uG[0]": k.gP,
            "uGV[0]": k.gV,
        });
        tri(gl, vao);
        const t = st.a;
        st.a = st.b;
        st.b = t;
    });
    k.wxStart = false;
    zAb(gl, k.uhrGpu, "schnee");
    gl.bindFramebuffer(gl.FRAMEBUFFER, F.snow2.fb);
    gl.viewport(0, 0, k.W0, k.W0);
    use(gl, P.snow, {
        uPrev: F.snow.tex[0],
        uW: g.stufen[0]!.a.tex[0],
        uHM: T.hm,
        uD0: D0,
        uDt: dt,
        uTN: cfg.tn,
        uTS: cfg.ts,
        uKW0: T.kw0,
        uKW1: T.kw1,
        uKW2: T.kw2,
        "uSG[0]": k.sg,
    });
    tri(gl, vao);
    const s = F.snow;
    F.snow = F.snow2;
    F.snow2 = s;
    zAb(gl, k.uhrGpu, "meer");
    stepMeer(k, g, dt);
    zAb(gl, k.uhrGpu, null);
}

export function stepSim(k: Kern, g: Gpu, dt: number): void {
    stroemungsSchritt(k, g, dt);
    wetterSchritt(k, g, dt);
}

/** Ein feineres Fenster an die neue Mitte schieben; was neu ins Fenster kommt, liest es vom Elternfeld. */
function moveLevel(k: Kern, g: Gpu, i: number, cx: number, cz: number): void {
    const { gl, P, vao } = g;
    const l = k.WL[i]!,
        p = k.WL[i - 1]!,
        st = g.stufen[i]!,
        ps = g.stufen[i - 1]!;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.b.fb);
    gl.viewport(0, 0, l.res, l.res);
    use(gl, P.scroll, {
        uPrevA: st.a.tex[0],
        uPrevZ: st.a.tex[1],
        uParA: ps.a.tex[0],
        uParZ: ps.a.tex[1],
        uFrom: l.stale ? [1e7, 1e7, 1] : [l.c[0], l.c[1], l.e],
        uTo: [cx, cz, l.e],
        uPar: [p.c[0], p.c[1], p.e],
    });
    tri(gl, vao);
    const t = st.a;
    st.a = st.b;
    st.b = t;
    l.c = [cx, cz];
    l.stale = false;
}

// Welche Stufen laufen, hängt am Kameraabstand; die Übergänge blenden, damit sich beim Zoomen nichts sprunghaft ändert
export function updateWorld(k: Kern, g: Gpu): void {
    const cfg = k.cfg,
        cam = k.cam,
        WL = k.WL,
        PT = k.pt;
    const d = cam.dist;
    WL[1]!.w = 1 - sstep(cfg.mittelVoll, cfg.mittelAb, d);
    WL[2]!.w = WL[1]!.w * (1 - sstep(cfg.feinVoll, cfg.feinAb, d));
    for (let i = 1; i < 3; i++) {
        const l = WL[i]!,
            on = l.w > 0,
            q = l.e / l.res;
        if (on && (l.stale || Math.hypot(cam.tx - l.c[0], cam.tz - l.c[1]) > l.e * 0.08))
            moveLevel(k, g, i, Math.round(cam.tx / q) * q, Math.round(cam.tz / q) * q);
        if (!on) l.stale = true;
        l.on = on;
    }
    // Partikel entstehen gleichmäßig über den Schirm; beim Herauszoomen und Schieben füllt ein Teil von ihnen den neuen Ausschnitt sofort.
    PT.neu = PT.d
        ? clamp((Math.max(d - PT.d, 0) / PT.d) * 3 + (Math.hypot(cam.tx - PT.x, cam.tz - PT.z) / d) * 1.5)
        : 1;
    PT.d = d;
    PT.x = cam.tx;
    PT.z = cam.tz;
}
