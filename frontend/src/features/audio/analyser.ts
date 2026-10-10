import { audioBus, resetAudioBus } from './audioBus';

/**
 * Reusable Web Audio API analyser driven by REAL microphone input.
 * Never synthesizes levels — all values come from AnalyserNode data.
 */
export class MicrophoneAnalyser {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private running = false;
  private timeData: Float32Array<ArrayBuffer> | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;

  private smoothed = 0;
  private peak = 0;
  private peakHold = 0;

  onError: ((message: string) => void) | null = null;

  get isRunning() {
    return this.running;
  }

  async start(): Promise<MediaStream> {
    if (this.running) return this.stream!;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not supported in this browser.');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = (err as Error)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('Microphone permission was denied. Allow microphone access and try again.');
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new Error('No microphone device was found.');
      }
      throw new Error('Could not access the microphone.');
    }

    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Could not start audio processing (AudioContext failed).');
    }

    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    // Never connect mic to destination (no feedback).
    this.source.connect(this.analyser);

    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.running = true;
    audioBus.active = true;
    this.loop();
    return stream;
  }

  private loop = () => {
    if (!this.running || !this.analyser || !this.timeData || !this.freqData) return;
    this.analyser.getFloatTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);

    // RMS energy from time domain
    let sum = 0;
    let peak = 0;
    const n = this.timeData.length;
    for (let i = 0; i < n; i++) {
      const v = this.timeData[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / n);

    // Frequency bands (analyser sampleRate/2 max). fftSize 2048 -> bin ~23Hz @48k.
    const binHz = (this.ctx?.sampleRate ?? 48000) / 2 / this.freqData.length;
    let low = 0, mid = 0, high = 0, lc = 0, mc = 0, hc = 0;
    for (let i = 0; i < this.freqData.length; i++) {
      const f = i * binHz;
      const v = this.freqData[i] / 255;
      if (f < 300) { low += v; lc++; }
      else if (f < 3000) { mid += v; mc++; }
      else if (f < 8000) { high += v; hc++; }
    }
    low = lc ? low / lc : 0;
    mid = mc ? mid / mc : 0;
    high = hc ? high / hc : 0;

    // Noise gate: ignore very quiet background hum
    const gated = rms < 0.012 ? 0 : rms;
    // Normalize so normal speech (~0.02-0.25 RMS) maps to visible 0..1
    const norm = Math.min(1, Math.max(0, (gated - 0.012) / 0.22));
    const curved = Math.pow(norm, 0.75);

    // Attack/release smoothing
    const attack = 0.45;
    const release = 0.08;
    const k = curved > this.smoothed ? attack : release;
    this.smoothed += (curved - this.smoothed) * k;

    // Peak with decay
    this.peak = Math.max(curved, this.peak * 0.985);
    this.peakHold++;
    if (this.peakHold > 240 && this.peak < 0.02) {
      this.peak = 0;
      this.peakHold = 0;
    }

    audioBus.rms = curved;
    audioBus.smoothed = this.smoothed;
    audioBus.peak = this.peak;
    audioBus.low = Math.min(1, low * 1.6);
    audioBus.mid = Math.min(1, mid * 1.6);
    audioBus.high = Math.min(1, high * 1.8);
    audioBus.active = true;

    this.raf = requestAnimationFrame(this.loop);
  };

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { this.source?.disconnect(); } catch { /* noop */ }
    try { this.analyser?.disconnect(); } catch { /* noop */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      const c = this.ctx;
      this.ctx = null;
      void c.close().catch(() => undefined);
    }
    this.analyser = null;
    this.source = null;
    this.smoothed = 0;
    this.peak = 0;
    resetAudioBus();
  }
}

export const microphoneAnalyser = new MicrophoneAnalyser();
