/**
 * AudioCapture — captures mic input as PCM Float32 at 16kHz mono.
 * Uses AudioWorkletNode for low-latency chunk delivery (< 20ms).
 * Falls back to ScriptProcessorNode if AudioWorklet is unavailable.
 *
 * Works in Tauri WebView on macOS with macOSPrivateApi: true.
 */

export const CAPTURE_SAMPLE_RATE = 16_000;
const WORKLET_NAME = "openhelm-recorder";

const WORKLET_PROCESSOR_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Post a copy so the buffer is transferable
      this.port.postMessage(input[0].slice());
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', RecorderProcessor);
`;

type ChunkCallback = (pcm: Float32Array) => void;

export class AudioCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private onChunkFn: ChunkCallback | null = null;
  private inputLevel = 0;

  /**
   * Pre-warm: initialise the mic stream and AudioWorklet without forwarding any
   * audio. Call this early (e.g. after the user grants mic permission) so that
   * the heavy async work (getUserMedia + addModule) is already done when the
   * user triggers voice. This eliminates the 100–500ms cold-start gap during
   * which the user's first syllables are lost.
   */
  async preWarm(): Promise<void> {
    if (this.stream) return; // Already initialised
    await this._initStream();
  }

  private async _initStream(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: CAPTURE_SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
    this.source = this.context.createMediaStreamSource(this.stream);

    if (typeof AudioWorkletNode !== "undefined") {
      await this.startWithWorklet();
    } else {
      this.startWithScriptProcessor();
    }
  }

  /** Request mic access (if not already pre-warmed) and start forwarding chunks */
  async start(onChunk: ChunkCallback): Promise<void> {
    this.onChunkFn = onChunk;
    if (!this.stream) {
      // Cold start — initialise now (will add latency before first chunk)
      await this._initStream();
    }
    // If pre-warmed: stream is already active; onChunkFn is now set so the
    // existing worklet/scriptProcessor callbacks will immediately forward audio.
  }

  private async startWithWorklet(): Promise<void> {
    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await this.context!.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    this.worklet = new AudioWorkletNode(this.context!, WORKLET_NAME);
    this.worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const samples = e.data;
      this.updateInputLevel(samples);
      this.onChunkFn?.(samples);
    };
    this.source!.connect(this.worklet);
    this.worklet.connect(this.context!.destination);
  }

  private startWithScriptProcessor(): void {
    // Fallback: 4096-sample buffer ≈ 256ms at 16kHz
    this.scriptProcessor = this.context!.createScriptProcessor(4096, 1, 1);
    this.scriptProcessor.onaudioprocess = (e) => {
      const samples = e.inputBuffer.getChannelData(0).slice();
      this.updateInputLevel(samples);
      this.onChunkFn?.(samples);
    };
    this.source!.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.context!.destination);
  }

  stop(): void {
    this.worklet?.disconnect();
    this.scriptProcessor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close();
    this.context = null;
    this.stream = null;
    this.source = null;
    this.worklet = null;
    this.scriptProcessor = null;
    this.onChunkFn = null;
    this.inputLevel = 0;
  }

  /** 0–1 RMS input level for waveform visualization */
  getInputLevel(): number {
    return this.inputLevel;
  }

  private updateInputLevel(samples: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    this.inputLevel = Math.sqrt(sum / samples.length);
  }
}
