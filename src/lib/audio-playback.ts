/**
 * AudioPlayback — queued PCM playback with barge-in (interruption) support.
 *
 * TTS chunks arrive as Float32Arrays at a given sample rate.
 * Chunks are enqueued and scheduled for gapless playback via Web Audio API.
 * Calling interrupt() immediately stops playback and clears the queue.
 */

interface QueuedChunk {
  samples: Float32Array;
  sampleRate: number;
  final: boolean;
}

export class AudioPlayback {
  private context: AudioContext | null = null;
  private queue: QueuedChunk[] = [];
  private nextStartTime = 0;
  private activeNodes: AudioBufferSourceNode[] = [];
  // Set to true only when the agent sends the session-level final TTS signal.
  // onFinished fires once finalReceived AND all active nodes have drained.
  private finalReceived = false;

  onFinished?: () => void;

  private ensureContext(sampleRate: number): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext({ sampleRate });
      this.nextStartTime = 0;
    }
    return this.context;
  }

  /** Enqueue a PCM chunk for playback.
   *
   * Pass final=true ONLY for the session-level sentinel (empty Float32Array) that
   * the agent emits after ALL sentences have been synthesised.  Individual
   * per-sentence chunks must always arrive with final=false so that a short
   * sentence completing before the next one has been enqueued cannot trigger
   * onFinished prematurely.
   */
  enqueue(samples: Float32Array, sampleRate: number, final = false): void {
    if (samples.length === 0) {
      if (final) {
        this.finalReceived = true;
        this.checkFinished();
      }
      return;
    }
    const ctx = this.ensureContext(sampleRate);
    // WebKit/WKWebView (Tauri) starts AudioContext suspended — resume on first use.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(new Float32Array(samples), 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(this.nextStartTime, now);
    this.nextStartTime = startAt + buffer.duration;

    source.start(startAt);
    this.activeNodes.push(source);

    // Every node's onended checks whether it's time to fire onFinished.
    // We no longer use the per-chunk `final` flag — that caused premature
    // onFinished when a short sentence finished playing before the next
    // sentence's audio arrived.
    source.onended = () => {
      const idx = this.activeNodes.indexOf(source);
      if (idx !== -1) this.activeNodes.splice(idx, 1);
      this.checkFinished();
    };
  }

  /** Stop all playback immediately and clear the queue (barge-in) */
  interrupt(): void {
    for (const node of this.activeNodes) {
      try { node.stop(); } catch { /* ignore */ }
    }
    this.activeNodes = [];
    this.queue = [];
    this.nextStartTime = 0;
    this.finalReceived = false;
  }

  /** Stop and release all audio resources */
  dispose(): void {
    this.interrupt();
    this.context?.close();
    this.context = null;
  }

  private checkFinished(): void {
    if (this.finalReceived && this.activeNodes.length === 0) {
      this.finalReceived = false;
      this.onFinished?.();
    }
  }

  /** True if audio is currently playing */
  get isPlaying(): boolean {
    return this.activeNodes.length > 0;
  }
}
