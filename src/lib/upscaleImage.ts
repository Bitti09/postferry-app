/**
 * WebGL2 Lanczos-3 upscaler. Returns a `<canvas>` element with the upscaled
 * result — no blob URLs to leak or race.
 *
 * Lanczos-3 kernel: window radius = 3, samples a 6×6 neighborhood per pixel.
 * Significantly sharper than canvas bicubic for 2×+ upscales.
 * Falls back to canvas bicubic when WebGL2 is unavailable.
 *
 * Aspect ratio is preserved; source dimensions are returned (as a canvas)
 * when already >= target.
 */

import { browser } from '$app/env';

export interface UpscaleOptions {
	radius?: number; // 2, 3, or 4
	unsharpAmount?: number; // 0.0 to 2.0+
	unsharpRadius?: number; // 1.0 to 10.0+
}

export interface UpscaleResult {
	canvas: HTMLCanvasElement;
	sourceW: number;
	sourceH: number;
}

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vTex;
void main() {
	vTex = aPos;
	gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uDir;
uniform float uRadius;
out vec4 fragColor;
void main() {
	vec2 myTex = gl_FragCoord.xy / uTexSize;
	if (uRadius < 0.1) {
		fragColor = texture(uTex, myTex);
		return;
	}
	float sigma = max(0.5, uRadius);
	int r = int(ceil(sigma * 2.0));
	vec4 acc = vec4(0.0);
	float total = 0.0;
	for (int i = -30; i <= 30; i++) {
		if (i < -r || i > r) continue;
		float fi = float(i);
		float w = exp(-0.5 * (fi * fi) / (sigma * sigma));
		vec2 uv = myTex + (fi * uDir) / uTexSize;
		acc += texture(uTex, uv) * w;
		total += w;
	}
	fragColor = total == 0.0 ? vec4(0.0) : acc / total;
}`;

const COMBINE_FRAG = `#version 300 es
precision highp float;
uniform vec2 uTexSize;
uniform sampler2D uTexOrig;
uniform sampler2D uTexBlur;
uniform float uAmount;
out vec4 fragColor;
void main() {
	vec2 myTex = gl_FragCoord.xy / uTexSize;
	vec4 orig = texture(uTexOrig, myTex);
	vec4 blur = texture(uTexBlur, myTex);
	vec4 sharpened = orig + (orig - blur) * uAmount;
	sharpened.a = orig.a;
	fragColor = clamp(sharpened, 0.0, 1.0);
}`;

function fragLanczosSrc(r: number): string {
	const fr = r.toFixed(1);
	return `#version 300 es
precision highp float;
in vec2 vTex;
uniform sampler2D uTex;
uniform vec2 uTexSize;
uniform vec2 uDir;
out vec4 fragColor;

float lanc(float x) {
	if (abs(x) < 0.0001) return 1.0;
	float ax = abs(x);
	if (ax >= ${fr}) return 0.0;
	float t = 3.14159265 * x;
	return (sin(t) / t) * (sin(t / ${fr}) / (t / ${fr}));
}

void main() {
	vec2 src = vTex * uTexSize;
	float total = 0.0;
	vec4 acc = vec4(0.0);
	for (int d = -${r}; d <= ${r}; d++) {
		vec2 off = vec2(float(d)) * uDir;
		vec2 pos = floor(src) + off + 0.5;
		float dist = dot(pos - src, uDir);
		vec2 uv = pos / uTexSize;
		float k = lanc(dist);
		acc += texture(uTex, uv) * k;
		total += k;
	}
	fragColor = total == 0.0 ? vec4(0.0) : acc / total;
}`;
}

let glCtx: WebGL2RenderingContext | null = null;
let glPrograms = new Map<number, WebGLProgram>();
let glVao: WebGLVertexArrayObject | null = null;

let glCanvas: HTMLCanvasElement | null = null;

let glBlurProgram: WebGLProgram | null = null;
let glCombineProgram: WebGLProgram | null = null;

function ensureGL(
	radius: number
): { gl: WebGL2RenderingContext; program: WebGLProgram; blurProgram: WebGLProgram; combineProgram: WebGLProgram; vao: WebGLVertexArrayObject } | null {
	if (glCtx && glPrograms.has(radius) && glBlurProgram && glCombineProgram && glVao) {
		return { gl: glCtx, program: glPrograms.get(radius)!, blurProgram: glBlurProgram, combineProgram: glCombineProgram, vao: glVao };
	}
	
	if (!glCanvas) {
		glCanvas = document.createElement('canvas');
		glCanvas.width = 1;
		glCanvas.height = 1;
	}

	let ctx = glCtx || glCanvas.getContext('webgl2', { premultipliedAlpha: false });
	if (!ctx) return null;
	glCtx = ctx as WebGL2RenderingContext;

	const vs = ctx.createShader(ctx.VERTEX_SHADER)!;
	ctx.shaderSource(vs, VERT_SRC);
	ctx.compileShader(vs);
	if (!ctx.getShaderParameter(vs, ctx.COMPILE_STATUS)) { glCtx = null; return null; }

	// Ensure blur program
	if (!glBlurProgram) {
		const fsBlur = ctx.createShader(ctx.FRAGMENT_SHADER)!;
		ctx.shaderSource(fsBlur, BLUR_FRAG);
		ctx.compileShader(fsBlur);
		if (!ctx.getShaderParameter(fsBlur, ctx.COMPILE_STATUS)) { glCtx = null; return null; }
		glBlurProgram = ctx.createProgram()!;
		ctx.attachShader(glBlurProgram, vs);
		ctx.attachShader(glBlurProgram, fsBlur);
		ctx.linkProgram(glBlurProgram);
	}

	// Ensure combine program
	if (!glCombineProgram) {
		const fsCombine = ctx.createShader(ctx.FRAGMENT_SHADER)!;
		ctx.shaderSource(fsCombine, COMBINE_FRAG);
		ctx.compileShader(fsCombine);
		if (!ctx.getShaderParameter(fsCombine, ctx.COMPILE_STATUS)) { glCtx = null; return null; }
		glCombineProgram = ctx.createProgram()!;
		ctx.attachShader(glCombineProgram, vs);
		ctx.attachShader(glCombineProgram, fsCombine);
		ctx.linkProgram(glCombineProgram);
	}

	let glProgram = glPrograms.get(radius);
	if (!glProgram) {
		const fs = ctx.createShader(ctx.FRAGMENT_SHADER)!;
		ctx.shaderSource(fs, fragLanczosSrc(radius));
		ctx.compileShader(fs);
		if (!ctx.getShaderParameter(fs, ctx.COMPILE_STATUS)) { glCtx = null; return null; }

		glProgram = ctx.createProgram()!;
		ctx.attachShader(glProgram, vs);
		ctx.attachShader(glProgram, fs);
		ctx.linkProgram(glProgram);
		if (!ctx.getProgramParameter(glProgram, ctx.LINK_STATUS)) { glCtx = null; return null; }
		glPrograms.set(radius, glProgram);
	}

	if (!glVao) {
		const buf = ctx.createBuffer();
		ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
		ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), ctx.STATIC_DRAW);

		glVao = ctx.createVertexArray();
		ctx.bindVertexArray(glVao);
		ctx.enableVertexAttribArray(0);
		ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0);
	}

	return { gl: ctx, program: glProgram, blurProgram: glBlurProgram, combineProgram: glCombineProgram, vao: glVao };
}

export async function upscaleImage(
	srcUrl: string,
	maxW: number,
	maxH: number,
	options: UpscaleOptions = {}
): Promise<UpscaleResult | null> {
	const img = await new Promise<HTMLImageElement>((resolve, reject) => {
		const i = new Image();
		i.crossOrigin = 'anonymous';
		i.onload = () => resolve(i);
		i.onerror = () => reject(new Error(`upscaleImage: failed to load ${srcUrl}`));
		i.src = srcUrl;
	});

	const sw = img.naturalWidth;
	const sh = img.naturalHeight;

	if (sw >= maxW && sh >= maxH) {
		return null;
	}

	const scale = Math.min(maxW / sw, maxH / sh);
	const dw = Math.round(sw * scale);
	const dh = Math.round(sh * scale);

	const webgl = ensureGL(options.radius || 3);
	if (!webgl) {
		const canvas = document.createElement('canvas');
		canvas.width = dw;
		canvas.height = dh;
		const ctx = canvas.getContext('2d')!;
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(img, 0, 0, dw, dh);
		return { canvas, sourceW: dw, sourceH: dh };
	}

	const { gl: g, program: pgm, blurProgram: bPgm, combineProgram: cPgm, vao } = webgl;

	g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
	const tex = g.createTexture()!;
	g.bindTexture(g.TEXTURE_2D, tex);
	g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
	g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
	g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
	g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
	g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);

	function createFBO(width: number, height: number) {
		const f = g.createFramebuffer()!;
		g.bindFramebuffer(g.FRAMEBUFFER, f);
		const t = g.createTexture()!;
		g.bindTexture(g.TEXTURE_2D, t);
		g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
		g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
		g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
		g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
		g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
		g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
		return { fbo: f, tex: t };
	}

	const unsharpAmt = options.unsharpAmount !== undefined ? Number(options.unsharpAmount) : 0;
	// Scale the blur radius by the upscale factor so the slider feels consistent at any resolution
	const unsharpRad = (options.unsharpRadius !== undefined ? Number(options.unsharpRadius) : 2.0) * scale;

	const passX = createFBO(dw, sh);
	const passY = createFBO(dw, dh);
	
	g.bindVertexArray(vao);

	// Pass 1: Upscale X (src -> passX)
	g.bindFramebuffer(g.FRAMEBUFFER, passX.fbo);
	g.viewport(0, 0, dw, sh);
	g.useProgram(pgm);
	g.activeTexture(g.TEXTURE0);
	g.bindTexture(g.TEXTURE_2D, tex);
	g.uniform1i(g.getUniformLocation(pgm, 'uTex'), 0);
	g.uniform2f(g.getUniformLocation(pgm, 'uTexSize'), sw, sh);
	g.uniform2f(g.getUniformLocation(pgm, 'uDir'), 1.0, 0.0);
	g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

	// Pass 2: Upscale Y (passX -> passY)
	g.bindFramebuffer(g.FRAMEBUFFER, passY.fbo);
	g.viewport(0, 0, dw, dh);
	g.activeTexture(g.TEXTURE0);
	g.bindTexture(g.TEXTURE_2D, passX.tex);
	// We are now sampling from an image that is already dw wide, but still sh high
	g.uniform2f(g.getUniformLocation(pgm, 'uTexSize'), dw, sh);
	g.uniform2f(g.getUniformLocation(pgm, 'uDir'), 0.0, 1.0);
	g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

	let finalTex = passY.tex;
	let finalFbo = passY.fbo;
	let pass2: {fbo: WebGLFramebuffer, tex: WebGLTexture} | null = null;
	let pass3: {fbo: WebGLFramebuffer, tex: WebGLTexture} | null = null;

	if (unsharpAmt > 0) {
		pass2 = createFBO(dw, dh); // Blur X
		pass3 = createFBO(dw, dh); // Blur Y

		// Pass 3: Blur X (passY -> pass2)
		g.bindFramebuffer(g.FRAMEBUFFER, pass2.fbo);
		g.useProgram(bPgm);
		g.activeTexture(g.TEXTURE0);
		g.bindTexture(g.TEXTURE_2D, passY.tex);
		g.uniform1i(g.getUniformLocation(bPgm, 'uTex'), 0);
		g.uniform2f(g.getUniformLocation(bPgm, 'uTexSize'), dw, dh);
		g.uniform2f(g.getUniformLocation(bPgm, 'uDir'), 1.0, 0.0);
		g.uniform1f(g.getUniformLocation(bPgm, 'uRadius'), unsharpRad);
		g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

		// Pass 4: Blur Y (pass2 -> pass3)
		g.bindFramebuffer(g.FRAMEBUFFER, pass3.fbo);
		g.activeTexture(g.TEXTURE0);
		g.bindTexture(g.TEXTURE_2D, pass2.tex);
		g.uniform2f(g.getUniformLocation(bPgm, 'uDir'), 0.0, 1.0);
		g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

		// Pass 5: Combine (passY + pass3 -> pass2 reused as final output)
		g.bindFramebuffer(g.FRAMEBUFFER, pass2.fbo);
		g.useProgram(cPgm);
		g.uniform2f(g.getUniformLocation(cPgm, 'uTexSize'), dw, dh);
		
		g.activeTexture(g.TEXTURE0);
		g.bindTexture(g.TEXTURE_2D, passY.tex);
		g.uniform1i(g.getUniformLocation(cPgm, 'uTexOrig'), 0);

		g.activeTexture(g.TEXTURE1);
		g.bindTexture(g.TEXTURE_2D, pass3.tex);
		g.uniform1i(g.getUniformLocation(cPgm, 'uTexBlur'), 1);

		g.uniform1f(g.getUniformLocation(cPgm, 'uAmount'), unsharpAmt);

		g.drawArrays(g.TRIANGLE_STRIP, 0, 4);

		finalTex = pass2.tex;
		finalFbo = pass2.fbo;
	}

	g.finish();

	// Read back from finalFbo
	g.bindFramebuffer(g.FRAMEBUFFER, finalFbo);
	const pixels = new Uint8Array(dw * dh * 4);
	g.readPixels(0, 0, dw, dh, g.RGBA, g.UNSIGNED_BYTE, pixels);

	g.deleteTexture(tex);
	g.deleteTexture(passX.tex);
	g.deleteFramebuffer(passX.fbo);
	g.deleteTexture(passY.tex);
	g.deleteFramebuffer(passY.fbo);
	if (pass2) {
		g.deleteTexture(pass2.tex);
		g.deleteFramebuffer(pass2.fbo);
	}
	if (pass3) {
		g.deleteTexture(pass3.tex);
		g.deleteFramebuffer(pass3.fbo);
	}

	const result = document.createElement('canvas');
	result.width = dw;
	result.height = dh;
	const rCtx = result.getContext('2d')!;
	const imageData = rCtx.createImageData(dw, dh);
	imageData.data.set(pixels);
	rCtx.putImageData(imageData, 0, 0);

	return { canvas: result, sourceW: dw, sourceH: dh };
}
