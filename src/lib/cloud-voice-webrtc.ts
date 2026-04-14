/**
 * Thin WebRTC helper for the OpenAI Realtime API.
 *
 * Opens an RTCPeerConnection directly to OpenAI's /v1/realtime/calls endpoint
 * using the ephemeral client secret minted by the worker. Audio flows peer-to-
 * peer in both directions; event traffic (function_call, transcripts, usage)
 * goes over a single RTCDataChannel named "oai-events".
 *
 * This module deliberately knows nothing about OpenHelm — see cloud-voice-session.ts
 * for the higher-level orchestration, tool calls, and persistence.
 */

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export interface OpenRealtimeConnectionOptions {
  /** Ephemeral client secret from worker /voice/session.start */
  ephemeralToken: string;
  /** Realtime model to connect to — baked into the URL query. */
  model: "gpt-realtime-mini" | "gpt-realtime";
  /** Caller-supplied audio element used to play incoming assistant audio. */
  audioElement: HTMLAudioElement;
  /** Called with each event from the Realtime data channel. */
  onEvent: (event: unknown) => void;
  /** Called whenever pc.iceConnectionState changes. */
  onIceState?: (state: RTCIceConnectionState) => void;
  /** Called when the data channel or peer connection closes unexpectedly. */
  onDisconnected?: (reason: string) => void;
}

export interface OpenRealtimeConnection {
  /** Send an event to the Realtime session via the data channel. */
  send: (event: unknown) => void;
  /** Close the peer connection and release the mic tracks. */
  close: () => void;
  /** True once the data channel is open and the session can accept events. */
  readonly ready: boolean;
}

/**
 * Open a WebRTC peer connection to OpenAI Realtime.
 *
 * 1. Capture mic via getUserMedia (mono, default sample rate — WebRTC handles resampling).
 * 2. Create RTCPeerConnection + audio transceiver.
 * 3. Create "oai-events" data channel BEFORE createOffer (required — data channels
 *    created after offer won't be negotiated in the initial SDP).
 * 4. Create SDP offer, setLocalDescription.
 * 5. POST the offer to /v1/realtime/calls?model=... with the ephemeral token.
 * 6. setRemoteDescription with the answer.
 * 7. Wire ontrack to attach the incoming assistant audio to the <audio> element.
 */
export async function openOpenRealtimeConnection(
  opts: OpenRealtimeConnectionOptions,
): Promise<OpenRealtimeConnection> {
  // 1. Mic access — let the browser pick its preferred sample rate; WebRTC
  //    and OpenAI's Opus encoder handle conversion internally.
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const pc = new RTCPeerConnection({
    // Public STUN; Realtime API's infra handles TURN when needed.
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // 2. Add mic track.
  for (const track of micStream.getAudioTracks()) {
    pc.addTrack(track, micStream);
  }

  // 3. Data channel for session events. Must be created BEFORE the offer.
  const dataChannel = pc.createDataChannel("oai-events", { ordered: true });

  let dataChannelReady = false;
  dataChannel.addEventListener("open", () => {
    dataChannelReady = true;
  });
  dataChannel.addEventListener("close", () => {
    dataChannelReady = false;
    opts.onDisconnected?.("data_channel_closed");
  });
  dataChannel.addEventListener("message", (evt: MessageEvent) => {
    try {
      const parsed = JSON.parse(typeof evt.data === "string" ? evt.data : "{}");
      opts.onEvent(parsed);
    } catch (err) {
      console.error("[cloud-voice-webrtc] failed to parse event:", err);
    }
  });

  // 4. Wire incoming audio track to the <audio> element.
  pc.addEventListener("track", (evt: RTCTrackEvent) => {
    const [stream] = evt.streams;
    if (stream) {
      opts.audioElement.srcObject = stream;
      // Safari/WKWebView requires explicit play() after stream assignment.
      void opts.audioElement.play().catch((err: Error) => {
        console.error("[cloud-voice-webrtc] audio.play() failed:", err.message);
      });
    }
  });

  pc.addEventListener("iceconnectionstatechange", () => {
    opts.onIceState?.(pc.iceConnectionState);
    if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
      opts.onDisconnected?.(`ice_state_${pc.iceConnectionState}`);
    }
  });

  // 5. Offer → POST SDP → answer.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const sdpResponse = await fetch(
    `${REALTIME_CALLS_URL}?model=${encodeURIComponent(opts.model)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.ephemeralToken}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp ?? "",
    },
  );

  if (!sdpResponse.ok) {
    const errText = await sdpResponse.text().catch(() => "");
    micStream.getTracks().forEach((t) => t.stop());
    pc.close();
    throw new Error(
      `cloud_voice_sdp_failed: HTTP ${sdpResponse.status} ${errText.slice(0, 200)}`,
    );
  }

  const answerSdp = await sdpResponse.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    send: (event: unknown) => {
      if (!dataChannelReady) {
        console.warn("[cloud-voice-webrtc] dropping event — data channel not ready", event);
        return;
      }
      try {
        dataChannel.send(JSON.stringify(event));
      } catch (err) {
        console.error("[cloud-voice-webrtc] send failed:", err);
      }
    },
    close: () => {
      try {
        dataChannel.close();
      } catch { /* ignore */ }
      try {
        for (const sender of pc.getSenders()) {
          sender.track?.stop();
        }
        pc.close();
      } catch { /* ignore */ }
      micStream.getTracks().forEach((t) => t.stop());
      opts.audioElement.srcObject = null;
    },
    get ready() {
      return dataChannelReady;
    },
  };
}
