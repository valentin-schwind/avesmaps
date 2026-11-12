import { tex3, tri, use, type Programm } from "./gl";

/**
 * Rauschvolumen werden auf der GPU scheibenweise erzeugt, damit die Seite beim Laden nicht einfriert: je Bild höchstens 22 ms, erst das
 * feine Zellrauschen (64³), dann das Grundrauschen (128³; dauert die erste Scheibe über 180 ms, nur 64³).
 */
export interface Rauschen {
    size: number;
    readonly dSize: number;
    z: number;
    dz: number;
    fb: WebGLFramebuffer | null;
    done: boolean;
    checked: boolean;
    readonly px: Uint8Array;
}

export const neuesRauschen = (): Rauschen => ({
    size: 128,
    dSize: 64,
    z: 0,
    dz: 0,
    fb: null,
    done: false,
    checked: false,
    px: new Uint8Array(4),
});

/** Die beiden Rauschwürfel, wie die Wolken sie lesen (`uNBase`, `uNDetail`). */
export interface RauschTexturen {
    nBase?: WebGLTexture;
    nDetail?: WebGLTexture;
}

function noiseSlice(
    gl: WebGL2RenderingContext,
    prog: Programm,
    vao: WebGLVertexArrayObject,
    px: Uint8Array,
    tex: WebGLTexture,
    size: number,
    z: number,
    mode: number,
): void {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
    gl.viewport(0, 0, size, size);
    use(gl, prog, { uZ: (z + 0.5) / size, uMode: mode });
    tri(gl, vao);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}

/** Ein Bild lang Scheiben erzeugen; gibt den Anteil des Fertigen zurück (1: fertig, Mipmaps erzeugt). */
export function stepNoise(
    gl: WebGL2RenderingContext,
    prog: Programm,
    vao: WebGLVertexArrayObject,
    g: Rauschen,
    T: RauschTexturen,
): number {
    if (!g.fb) {
        g.fb = gl.createFramebuffer();
        T.nBase = tex3(gl, g.size);
        T.nDetail = tex3(gl, g.dSize);
    }
    const nDetail = T.nDetail!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fb);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    const t0 = performance.now();
    while (performance.now() - t0 < 22) {
        if (g.dz < g.dSize) {
            noiseSlice(gl, prog, vao, g.px, nDetail, g.dSize, g.dz, 1);
            g.dz++;
        } else if (g.z < g.size) {
            const t1 = performance.now();
            noiseSlice(gl, prog, vao, g.px, T.nBase!, g.size, g.z, 0);
            g.z++;
            if (!g.checked) {
                g.checked = true;
                if (performance.now() - t1 > 180 && g.size > 64) {
                    gl.deleteTexture(T.nBase!);
                    g.size = 64;
                    g.z = 0;
                    T.nBase = tex3(gl, g.size);
                }
            }
        } else {
            gl.bindTexture(gl.TEXTURE_3D, T.nBase!);
            gl.generateMipmap(gl.TEXTURE_3D);
            gl.bindTexture(gl.TEXTURE_3D, nDetail);
            gl.generateMipmap(gl.TEXTURE_3D);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(g.fb);
            g.done = true;
            return 1;
        }
    }
    return (g.dz + g.z) / (g.dSize + g.size);
}
