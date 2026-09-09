export const TARGET_FPS = 30;

const FRAME_MS = 1000 / TARGET_FPS;

const VERTEX_SHADER = [
  '#version 300 es',
  'in vec2 position;',
  'out vec2 uv;',
  'void main() {',
  '  uv = vec2((position.x + 1.0) * 0.5, 1.0 - ((position.y + 1.0) * 0.5));',
  '  gl_Position = vec4(position, 0.0, 1.0);',
  '}',
].join('\n');

const FRAGMENT_SHADER = [
  '#version 300 es',
  'precision mediump float;',
  'uniform sampler2D previousFrame;',
  'uniform sampler2D currentFrame;',
  'uniform float phase;',
  'in vec2 uv;',
  'out vec4 colour;',
  'void main() {',
  '  vec4 a = texture(previousFrame, uv);',
  '  vec4 b = texture(currentFrame, uv);',
  '  float change = length(a.rgb - b.rgb);',
  '  float edgeGate = smoothstep(0.10, 0.34, change);',
  '  float nearestReal = step(0.5, phase);',
  '  float safePhase = mix(phase, nearestReal, edgeGate * 0.72);',
  '  colour = mix(a, b, safePhase);',
  '}',
].join('\n');

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown WebGL shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function makeProgram(gl) {
  const program = gl.createProgram();
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Unable to link Smooth 30 shader');
  }
  return program;
}

function makeTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export class FullResolutionCadence30 {
  constructor(video, container, onStats = () => {}) {
    this.video = video;
    this.container = container;
    this.onStats = onStats;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'smooth30-canvas';
    this.canvas.setAttribute('aria-label', 'Full-resolution 30 fps generated live view');
    this.running = false;
    this.hasFrame = false;
    this.hasPair = false;
    this.lastMediaTime = null;
    this.sourceIntervalMs = 50;
    this.frameArrivedAt = 0;
    this.nextOutputAt = 0;
    this.sourceFrames = 0;
    this.outputFrames = 0;
    this.missedDeadlines = 0;
    this.statsStartedAt = 0;
    this.boundRender = now => this.render(now);
  }

  async start() {
    if (this.running) return;
    await this.waitForVideo();
    this.setupWebGL();
    this.running = true;
    this.statsStartedAt = performance.now();
    this.nextOutputAt = this.statsStartedAt;
    this.container.appendChild(this.canvas);
    this.container.classList.add('smooth30-active');
    this.captureFrames();
    requestAnimationFrame(this.boundRender);
  }

  waitForVideo() {
    if (this.video.readyState >= 2 && this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for the full-resolution source'));
      }, 12000);
      const ready = () => {
        if (this.video.videoWidth < 1) return;
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.video.removeEventListener('loadeddata', ready);
        this.video.removeEventListener('resize', ready);
      };
      this.video.addEventListener('loadeddata', ready);
      this.video.addEventListener('resize', ready);
    });
  }

  setupWebGL() {
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL 2 is required for full-resolution Smooth 30');
    this.gl = gl;
    this.program = makeProgram(gl);
    gl.useProgram(this.program);

    const positions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

    this.previousTexture = makeTexture(gl);
    this.currentTexture = makeTexture(gl);
    gl.uniform1i(gl.getUniformLocation(this.program, 'previousFrame'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'currentFrame'), 1);
    this.phaseUniform = gl.getUniformLocation(this.program, 'phase');
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  captureFrames() {
    if (!this.running) return;
    if ('requestVideoFrameCallback' in this.video) {
      this.video.requestVideoFrameCallback((now, metadata) => {
        this.acceptSourceFrame(now, metadata.mediaTime);
        this.captureFrames();
      });
      return;
    }
    const mediaTime = this.video.currentTime;
    if (mediaTime !== this.lastMediaTime) this.acceptSourceFrame(performance.now(), mediaTime);
    requestAnimationFrame(() => this.captureFrames());
  }

  acceptSourceFrame(now, mediaTime) {
    if (!this.running || this.video.videoWidth < 1) return;
    const gl = this.gl;

    if (this.lastMediaTime !== null && mediaTime > this.lastMediaTime) {
      const observed = (mediaTime - this.lastMediaTime) * 1000;
      if (observed >= 20 && observed <= 250) {
        this.sourceIntervalMs = (this.sourceIntervalMs * 0.8) + (observed * 0.2);
      }
    }
    this.lastMediaTime = mediaTime;

    if (this.hasFrame) {
      [this.previousTexture, this.currentTexture] = [this.currentTexture, this.previousTexture];
      this.hasPair = true;
    }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);

    if (!this.hasFrame) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.previousTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      this.hasFrame = true;
    }

    this.frameArrivedAt = now;
    this.sourceFrames += 1;
  }

  render(now) {
    if (!this.running) return;
    requestAnimationFrame(this.boundRender);
    if (!this.hasFrame || now + 1 < this.nextOutputAt) return;

    if (now - this.nextOutputAt > FRAME_MS * 1.5) this.missedDeadlines += 1;
    while (this.nextOutputAt <= now) this.nextOutputAt += FRAME_MS;

    const phase = this.hasPair
      ? Math.max(0, Math.min(1, (now - this.frameArrivedAt) / this.sourceIntervalMs))
      : 1;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.previousTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
    gl.uniform1f(this.phaseUniform, phase);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.outputFrames += 1;

    const elapsed = now - this.statsStartedAt;
    if (elapsed >= 1000) {
      this.onStats({
        sourceFps: (this.sourceFrames * 1000) / elapsed,
        outputFps: (this.outputFrames * 1000) / elapsed,
        missedDeadlines: this.missedDeadlines,
        width: this.canvas.width,
        height: this.canvas.height,
        synthetic: true,
      });
      this.sourceFrames = 0;
      this.outputFrames = 0;
      this.missedDeadlines = 0;
      this.statsStartedAt = now;
    }
  }

  stop() {
    this.running = false;
    this.container.classList.remove('smooth30-active');
    this.canvas.remove();
    if (this.gl) {
      this.gl.deleteTexture(this.previousTexture);
      this.gl.deleteTexture(this.currentTexture);
      this.gl.deleteProgram(this.program);
      this.gl = null;
    }
  }
}
