/* eslint-disable no-restricted-syntax */

// See: https://w3c.github.io/webrtc-encoded-transform

// Note: This is non-standard and already deprecated but RTCRtpScriptTransform
//       is not available in Chromium, yet.
interface RTCRtpSender {
    createEncodedStreams: () => TransformStream;
}

// Note: This is non-standard and already deprecated but RTCRtpScriptTransform
//       is not available in Chromium, yet.
interface RTCRtpReceiver {
    createEncodedStreams: () => TransformStream;
}

// Note: This is non-standard!
interface RTCConfiguration {
    encodedInsertableStreams?: boolean;
}

// TODO: Fix DOM types in TS.
interface Worker {
    // eslint-disable-next-line @typescript-eslint/method-signature-style
    postMessage(
        message: unknown,
        transfer: (Transferable | ReadableStream | WritableStream)[],
    ): void;
}
