const p = function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(script) {
    const fetchOpts = {};
    if (script.integrity)
      fetchOpts.integrity = script.integrity;
    if (script.referrerpolicy)
      fetchOpts.referrerPolicy = script.referrerpolicy;
    if (script.crossorigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (script.crossorigin === "anonymous")
      fetchOpts.credentials = "omit";
    else
      fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
};
p();
class EventController {
  constructor(_log) {
    this._log = _log;
    this._subscribers = /* @__PURE__ */ new Set();
  }
  get listener() {
    return this;
  }
  subscribe(subscriber) {
    if (this._log !== void 0) {
      const subscribers = this._subscribers.size;
      this._log.debug(`Subscribed (${subscribers} -> ${subscribers + 1})`);
    }
    this._subscribers.add(subscriber);
    return () => {
      if (this._subscribers.delete(subscriber)) {
        if (this._log !== void 0) {
          const subscribers = this._subscribers.size;
          this._log.debug(`Unsubscribed (${subscribers + 1} -> ${subscribers})`);
        }
      } else {
        this._log?.warn("Unsubscriber called twice!", subscriber);
      }
    };
  }
  raise(event) {
    if (this._log !== void 0) {
      this._log.debug(`Dispatching event to ${this._subscribers.size} subscribers`);
    }
    for (const subscriber of this._subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        this._log?.error("Uncaught error in event subscriber", error);
      }
    }
  }
}
class ConsoleLogger {
  constructor() {
    this.debug = console.debug;
    this.trace = console.trace;
    this.info = console.info;
    this.warn = console.warn;
    this.error = console.error;
  }
  assert(condition, ...data) {
    if (!condition) {
      const message = `Assertion failed: ${data.join(" ")}`;
      this.error(message);
      throw new Error(message);
    }
  }
}
const CONSOLE_LOGGER = new ConsoleLogger();
class TagLogger {
  constructor(parent, tag) {
    this.parent = parent;
    this.trace = parent.trace.bind(parent, tag);
    this.debug = parent.debug.bind(parent, tag);
    this.info = parent.info.bind(parent, tag);
    this.warn = parent.warn.bind(parent, tag);
    this.error = parent.error.bind(parent, tag);
    this.assert = (condition, ...data) => parent.assert(condition, tag, ...data);
  }
}
class Logging {
  constructor(_tag) {
    this._tag = _tag;
    this._log = CONSOLE_LOGGER;
  }
  logger(tag) {
    if (this._tag !== void 0) {
      tag = `${this._tag}.${tag}`;
    }
    return new TagLogger(this._log, tag);
  }
}
class ResolvablePromise extends Promise {
  constructor(executor) {
    const inner = {
      resolve: ResolvablePromise._fail,
      reject: ResolvablePromise._fail
    };
    const outer = {
      resolve: (value) => this.resolve(value),
      reject: (reason) => this.reject(reason)
    };
    super(
      (innerResolve, innerReject) => {
        inner.resolve = innerResolve;
        inner.reject = innerReject;
        if (executor) {
          executor(outer.resolve, outer.reject);
          return;
        }
      }
    );
    this._inner = {
      resolve: inner.resolve,
      reject: inner.reject
    };
    this._done = false;
  }
  static resolve(value) {
    const promise = new ResolvablePromise();
    promise.resolve(value);
    return promise;
  }
  static wrap(inner) {
    const promise = new ResolvablePromise();
    inner.then((v) => {
      promise.resolve(v);
    }).catch((e) => {
      promise.reject(e);
    });
    return promise;
  }
  static _fail() {
    throw new Error("Promise resolve/reject not available");
  }
  get done() {
    return this._done;
  }
  resolve(value) {
    this._done = true;
    this._inner.resolve(value);
  }
  reject(reason) {
    this._done = true;
    this._inner.reject(reason);
  }
}
const logging = new Logging();
const elements = {
  controls: {
    cryptoWorker: document.querySelector("#crypto-worker"),
    stripSsrcs: document.querySelector("#strip-ssrcs"),
    start: document.querySelector("#start")
  },
  sender: {
    video: document.querySelector("#video-sender")
  },
  receiver: {
    audio: document.querySelector("#audio-receiver"),
    video: document.querySelector("#video-receiver")
  }
};
function createPeerConnection(settings, log, local, remote) {
  log.debug("Creating peer connection");
  const pc = new RTCPeerConnection({
    iceServers: [],
    iceTransportPolicy: "all",
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
    sdpSemantics: "unified-plan",
    encodedInsertableStreams: settings.cryptoWorker
  });
  pc.addEventListener("negotiationneeded", () => log.info("Negotiation needed"));
  pc.addEventListener("icecandidateerror", (event) => {
    log.warn("Candidate error", event);
  });
  pc.addEventListener("signalingstatechange", () => {
    log.debug(`Signaling state: ${pc.signalingState}`);
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    log.debug(`ICE connection state: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
      log.info(`Closed (by ICE connection state '${pc.iceConnectionState}')`);
      pc.close();
    }
  });
  pc.addEventListener("icegatheringstatechange", () => {
    log.debug(`ICE gathering state: ${pc.iceGatheringState}`);
  });
  pc.addEventListener("connectionstatechange", () => {
    log.debug(`Connection state: ${pc.connectionState}`);
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      log.info(`Closed (by connection state '${pc.connectionState}')`);
      pc.close();
    }
  });
  pc.addEventListener("track", ({ transceiver }) => {
    log.debug("New transceiver", transceiver);
  });
  pc.addEventListener("icecandidate", (event) => {
    if (event.candidate !== null) {
      local.candidate.raise(event.candidate);
    }
  });
  remote.candidate.subscribe((candidate) => {
    void pc.addIceCandidate(candidate);
  });
  return pc;
}
function createMediaCryptoWorker(log) {
  const worker = new Worker("./worker.15b8a743.js", {
    name: "Media Crypto Worker",
    type: "module"
  });
  worker.addEventListener("error", (event) => {
    log.error("Closed (by worker 'error')", event.error);
  });
  worker.addEventListener("messageerror", (event) => {
    log.error("Closed (by worker 'messageerror')", event.data);
  });
  return worker;
}
function setCodecPreferences(transceivers) {
  transceivers.audio.setCodecPreferences(
    RTCRtpSender.getCapabilities("audio").codecs.filter(
      ({ mimeType }) => mimeType === "audio/opus"
    )
  );
  transceivers.video.setCodecPreferences(
    RTCRtpSender.getCapabilities("video").codecs.filter(
      ({ mimeType }) => mimeType === "video/VP8" || mimeType === "video/rtx"
    )
  );
}
function stripSsrcsFromOffer(offer) {
  return {
    type: offer.type,
    sdp: offer.sdp?.split("\r\n").filter((line) => !line.startsWith("a=ssrc")).join("\r\n")
  };
}
async function sender(settings, tracks, local, remote) {
  const log = logging.logger("sender");
  const pc = createPeerConnection(settings, log, local, remote);
  const worker = settings.cryptoWorker ? createMediaCryptoWorker(log) : void 0;
  const transceivers = {
    audio: pc.addTransceiver("audio", { direction: "sendonly" }),
    video: pc.addTransceiver("video", { direction: "sendonly" })
  };
  setCodecPreferences(transceivers);
  await transceivers.audio.sender.replaceTrack(tracks.audio);
  if (tracks.video !== void 0) {
    await transceivers.video.sender.replaceTrack(tracks.video);
  }
  if (worker !== void 0) {
    {
      const instruction = {
        type: "encrypt-stream",
        tag: "sender",
        codec: "opus",
        pair: transceivers.audio.sender.createEncodedStreams()
      };
      worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
    }
    {
      const instruction = {
        type: "encrypt-stream",
        tag: "sender",
        codec: "vp8",
        pair: transceivers.video.sender.createEncodedStreams()
      };
      worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
    }
  }
  const offer = await pc.createOffer();
  log.info("Offer", offer);
  await pc.setLocalDescription(offer);
  if (transceivers.audio.mid !== "0" || transceivers.video.mid !== "1") {
    throw new Error("Unexpected MIDs on sender");
  }
  local.offer.resolve(offer);
  const answer = await remote.answer;
  log.info("Answer", answer);
  await pc.setRemoteDescription(answer);
}
async function receiver(settings, local, remote) {
  const log = logging.logger("receiver");
  const pc = createPeerConnection(settings, log, local, remote);
  const worker = settings.cryptoWorker ? createMediaCryptoWorker(log) : void 0;
  let offer;
  if (settings.stripSsrcs) {
    const original = await remote.offer;
    log.info("Original offer", original);
    const patched = stripSsrcsFromOffer(original);
    log.info("Patched offer", patched);
    offer = patched;
  } else {
    offer = await remote.offer;
  }
  await pc.setRemoteDescription(offer);
  const unmapped = new Map(
    pc.getTransceivers().map((transceiver) => {
      if (transceiver.direction !== "recvonly") {
        throw new Error("Unexpected transceiver direction on receiver");
      }
      if (transceiver.mid !== "0" && transceiver.mid !== "1") {
        throw new Error("Unexpected MIDs on receiver");
      }
      return [transceiver.mid, transceiver];
    })
  );
  const transceivers = {
    audio: unmapped.get("0"),
    video: unmapped.get("1")
  };
  elements.receiver.audio.srcObject = new MediaStream([transceivers.audio.receiver.track]);
  elements.receiver.video.srcObject = new MediaStream([transceivers.video.receiver.track]);
  if (worker !== void 0) {
    {
      const instruction = {
        type: "decrypt-stream",
        tag: "receiver",
        codec: "opus",
        pair: transceivers.audio.receiver.createEncodedStreams()
      };
      worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
    }
    {
      const instruction = {
        type: "decrypt-stream",
        tag: "receiver",
        codec: "vp8",
        pair: transceivers.video.receiver.createEncodedStreams()
      };
      worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
    }
  }
  const answer = await pc.createAnswer();
  log.info("Answer", answer);
  await pc.setLocalDescription(answer);
  local.answer.resolve(answer);
}
async function main(settings) {
  const senderStreams = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 960, max: 960 },
      frameRate: { ideal: 30, max: 30 },
      aspectRatio: { ideal: 4 / 3, max: 16 / 9 }
    }
  });
  const senderStream = elements.sender.video.srcObject = new MediaStream();
  const [senderAudioTrack] = senderStreams.getAudioTracks();
  const [senderVideoTrack] = senderStreams.getVideoTracks();
  if (senderVideoTrack !== void 0) {
    senderStream.addTrack(senderVideoTrack);
  }
  const flows = {
    start: new ResolvablePromise(),
    sender: {
      offer: new ResolvablePromise(),
      candidate: new EventController()
    },
    receiver: {
      answer: new ResolvablePromise(),
      candidate: new EventController()
    }
  };
  await Promise.all([
    sender(settings, { audio: senderAudioTrack, video: senderVideoTrack }, flows.sender, {
      answer: flows.receiver.answer,
      candidate: flows.receiver.candidate
    }),
    receiver(settings, flows.receiver, {
      offer: flows.sender.offer,
      candidate: flows.sender.candidate
    })
  ]);
}
elements.controls.start.addEventListener("click", () => {
  for (const element of Object.values(elements.controls)) {
    element.disabled = true;
  }
  elements.controls.start.disabled = true;
  void main({
    cryptoWorker: elements.controls.cryptoWorker.checked,
    stripSsrcs: elements.controls.stripSsrcs.checked
  });
});
