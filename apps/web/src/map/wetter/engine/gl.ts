/**
 * Die GL-Hilfen der Wetter-Engine (WI-0288): Programme mit ihrer Uniform-Liste, Texturen, Bildpuffer und das Vollbild-Dreieck. Alles läuft
 * im GL-Kontext der Karte; MapLibre stellt seinen Zustand nach der Ebene selbst wieder her.
 */

/** Eine aktive Uniform eines Programms, wie der Treiber sie meldet. */
export interface Uniform {
    readonly name: string;
    readonly type: number;
    readonly loc: WebGLUniformLocation | null;
}

/** Ein Programm mit seinen beiden Shadern; `u` liest erst `progFertig`, wenn der Treiber fertig übersetzt hat. */
export interface Programm {
    readonly p: WebGLProgram;
    readonly a: WebGLShader;
    readonly b: WebGLShader;
    u: readonly Uniform[] | null;
}

/** Ein Wert für eine Uniform: Zahl, Vektor oder Matrix, oder die Textur eines Samplers. Welcher, sagt erst der Typ der Uniform. */
export type UniformWert = number | readonly number[] | Float32Array | WebGLTexture;
export type UniformWerte = Readonly<Record<string, UniformWert | undefined>>;

/** Ein Bildpuffer mit seinen Farbtexturen (und Tiefe, wenn verlangt). */
export interface Ziel {
    readonly fb: WebGLFramebuffer;
    readonly tex: readonly WebGLTexture[];
    readonly d: WebGLTexture | null;
    readonly w: number;
    readonly h: number;
}

/** Ein Farbanhang: Format und, mit `n`, Lesen ohne Filter. */
export interface Farbe {
    readonly f: number;
    readonly n?: boolean;
}

/** Übersetzen anstoßen (mit KHR_parallel_shader_compile im Hintergrund); `progFertig` prüft und liest die Uniforms. */
export function progStart(gl: WebGL2RenderingContext, vs: string, fs: string): Programm {
    const p = gl.createProgram(),
        a = gl.createShader(gl.VERTEX_SHADER),
        b = gl.createShader(gl.FRAGMENT_SHADER);
    if (!a || !b) throw Error("Shader: kein Shader-Objekt");
    gl.shaderSource(a, vs);
    gl.compileShader(a);
    gl.shaderSource(b, fs);
    gl.compileShader(b);
    gl.attachShader(p, a);
    gl.attachShader(p, b);
    gl.linkProgram(p);
    return { p, a, b, u: null };
}

export function progFertig(gl: WebGL2RenderingContext, q: Programm): Programm {
    const p = q.p;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        for (const s of [q.a, q.b])
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                const log = gl.getShaderInfoLog(s);
                console.error(log);
                throw Error("Shader: " + log);
            }
        throw Error("Programm: " + gl.getProgramInfoLog(p));
    }
    const u: Uniform[] = [],
        n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
        const a = gl.getActiveUniform(p, i);
        if (!a) throw Error("Programm: Uniform " + i + " fehlt");
        u.push({ name: a.name, type: a.type, loc: gl.getUniformLocation(p, a.name) });
    }
    q.u = u;
    return q;
}

/** Programm wählen und die genannten Uniforms setzen; Sampler bekommen die Textureinheiten in der Folge der Uniform-Liste. */
export function use(gl: WebGL2RenderingContext, pr: Programm, vals: UniformWerte): void {
    if (!pr.u) throw Error("Programm noch nicht fertig übersetzt");
    gl.useProgram(pr.p);
    let unit = 0;
    for (const e of pr.u) {
        const v = vals[e.name];
        if (v === undefined) continue;
        switch (e.type) {
            case gl.FLOAT:
                gl.uniform1f(e.loc, v as number);
                break;
            case gl.INT:
                gl.uniform1i(e.loc, v as number);
                break;
            case gl.FLOAT_VEC2:
                gl.uniform2fv(e.loc, v as Float32List);
                break;
            case gl.FLOAT_VEC3:
                gl.uniform3fv(e.loc, v as Float32List);
                break;
            case gl.FLOAT_VEC4:
                gl.uniform4fv(e.loc, v as Float32List);
                break;
            case gl.FLOAT_MAT4:
                gl.uniformMatrix4fv(e.loc, false, v as Float32List);
                break;
            case gl.SAMPLER_2D:
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, v as WebGLTexture);
                gl.uniform1i(e.loc, unit++);
                break;
            case gl.SAMPLER_3D:
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_3D, v as WebGLTexture);
                gl.uniform1i(e.loc, unit++);
                break;
        }
    }
}

export function tex2(
    gl: WebGL2RenderingContext,
    w: number,
    h: number,
    internal: number,
    o: { readonly min?: number; readonly mag?: number; readonly levels?: number } = {},
): WebGLTexture {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.min || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.mag || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, o.levels || 1, internal, w, h);
    return t;
}

export function target(
    gl: WebGL2RenderingContext,
    w: number,
    h: number,
    colors: readonly Farbe[],
    depth = false,
): Ziel {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex: WebGLTexture[] = [];
    colors.forEach((c, i) => {
        const t = tex2(gl, w, h, c.f, { min: c.n ? gl.NEAREST : gl.LINEAR, mag: c.n ? gl.NEAREST : gl.LINEAR });
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
        tex.push(t);
    });
    gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    let d: WebGLTexture | null = null;
    if (depth) {
        d = tex2(gl, w, h, gl.DEPTH_COMPONENT32F, { min: gl.NEAREST, mag: gl.NEAREST });
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, d, 0);
    }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw Error("Bildpuffer unvollständig: " + st);
    return { fb, tex, d, w, h };
}

export function dropTarget(gl: WebGL2RenderingContext, t: Ziel | null): void {
    if (!t) return;
    t.tex.forEach((x) => gl.deleteTexture(x));
    if (t.d) gl.deleteTexture(t.d);
    gl.deleteFramebuffer(t.fb);
}

/** Die Texturen eines Ziels wiederholen sich am Rand (periodisches Grundfeld). */
export function wrapRepeat<Z extends { readonly tex: readonly WebGLTexture[] }>(gl: WebGL2RenderingContext, t: Z): Z {
    for (const x of t.tex) {
        gl.bindTexture(gl.TEXTURE_2D, x);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
    return t;
}

/** Ein Rauschwürfel: RGBA8 mit allen Mipmap-Stufen, wiederholt in alle Richtungen. */
export function tex3(gl: WebGL2RenderingContext, size: number): WebGLTexture {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
        gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
    gl.texStorage3D(gl.TEXTURE_3D, Math.log2(size) + 1, gl.RGBA8, size, size, size);
    return t;
}

/** Das Vollbild-Dreieck (ohne Puffer, aus `gl_VertexID`). */
export function tri(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject): void {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}
