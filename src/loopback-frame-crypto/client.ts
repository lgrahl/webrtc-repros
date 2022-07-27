import {type EventListener, EventController} from '../utils/event';
import {type Logger, Logging} from '../utils/logging';
import {ResolvablePromise} from '../utils/resolvable-promise';
import {
    type MediaCryptoWorkerDecryptStreamInstruction,
    type MediaCryptoWorkerEncryptStreamInstruction,
} from '.';

interface Settings {
    readonly cryptoWorker: boolean;
    readonly stripSsrcs: boolean;
}

const logging = new Logging();

const elements = {
    controls: {
        cryptoWorker: document.querySelector<HTMLInputElement>('#crypto-worker')!,
        stripSsrcs: document.querySelector<HTMLInputElement>('#strip-ssrcs')!,
        start: document.querySelector<HTMLButtonElement>('#start')!,
    },
    sender: {
        video: document.querySelector<HTMLVideoElement>('#video-sender')!,
    },
    receiver: {
        audio: document.querySelector<HTMLAudioElement>('#audio-receiver')!,
        video: document.querySelector<HTMLVideoElement>('#video-receiver')!,
    },
} as const;

function createPeerConnection(
    settings: Settings,
    log: Logger,
    local: {
        readonly candidate: EventController<RTCIceCandidate>;
    },
    remote: {
        readonly candidate: EventListener<RTCIceCandidate>;
    },
): RTCPeerConnection {
    // Create peer connection
    log.debug('Creating peer connection');
    const pc = new RTCPeerConnection({
        iceServers: [],
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        // @ts-expect-error: Types incorrect
        sdpSemantics: 'unified-plan',
        encodedInsertableStreams: settings.cryptoWorker,
    });
    pc.addEventListener('negotiationneeded', () => log.info('Negotiation needed'));
    pc.addEventListener('icecandidateerror', (event) => {
        log.warn('Candidate error', event);
    });
    pc.addEventListener('signalingstatechange', () => {
        log.debug(`Signaling state: ${pc.signalingState}`);
    });
    pc.addEventListener('iceconnectionstatechange', () => {
        log.debug(`ICE connection state: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
            log.info(`Closed (by ICE connection state '${pc.iceConnectionState}')`);
            pc.close();
        }
    });
    pc.addEventListener('icegatheringstatechange', () => {
        log.debug(`ICE gathering state: ${pc.iceGatheringState}`);
    });
    pc.addEventListener('connectionstatechange', () => {
        log.debug(`Connection state: ${pc.connectionState}`);
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            log.info(`Closed (by connection state '${pc.connectionState}')`);
            pc.close();
        }
    });
    pc.addEventListener('track', ({transceiver}) => {
        log.debug('New transceiver', transceiver);
    });

    // Dispatch local and subscribe to remote ICE candidates
    pc.addEventListener('icecandidate', (event) => {
        if (event.candidate !== null) {
            local.candidate.raise(event.candidate);
        }
    });
    remote.candidate.subscribe((candidate) => {
        void pc.addIceCandidate(candidate);
    });
    return pc;
}

function createMediaCryptoWorker(log: Logger): Worker {
    // Create media crypto worker
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
        name: 'Media Crypto Worker',
        type: 'module',
    });
    worker.addEventListener('error', (event) => {
        log.error("Closed (by worker 'error')", event.error);
    });
    worker.addEventListener('messageerror', (event) => {
        log.error("Closed (by worker 'messageerror')", event.data);
    });
    return worker;
}

function setCodecPreferences(transceivers: {
    readonly audio: RTCRtpTransceiver;
    readonly video: RTCRtpTransceiver;
}): void {
    transceivers.audio.setCodecPreferences(
        RTCRtpSender.getCapabilities('audio')!.codecs.filter(
            ({mimeType}) => mimeType === 'audio/opus',
        ),
    );
    transceivers.video.setCodecPreferences(
        RTCRtpSender.getCapabilities('video')!.codecs.filter(
            ({mimeType}) => mimeType === 'video/VP8' || mimeType === 'video/rtx',
        ),
    );
}

function stripSsrcsFromOffer(offer: RTCSessionDescriptionInit): RTCSessionDescriptionInit {
    // Remove all 'ssrc' lines. This is reasonable because the stack should be
    // able to map the streams to the respective transceivers by their MIDs.
    return {
        type: offer.type,
        sdp: offer.sdp
            ?.split('\r\n')
            .filter((line) => !line.startsWith('a=ssrc'))
            .join('\r\n'),
    };
}

async function sender(
    settings: Settings,
    tracks: {readonly audio: MediaStreamTrack; readonly video?: MediaStreamTrack},
    local: {
        readonly offer: ResolvablePromise<RTCSessionDescriptionInit>;
        readonly candidate: EventController<RTCIceCandidate>;
    },
    remote: {
        readonly answer: Promise<RTCSessionDescriptionInit>;
        readonly candidate: EventListener<RTCIceCandidate>;
    },
): Promise<void> {
    const log = logging.logger('sender');

    // Create peer connection
    const pc = createPeerConnection(settings, log, local, remote);

    // Create media cryptor worker
    const worker = settings.cryptoWorker ? createMediaCryptoWorker(log) : undefined;

    // Create transceivers, attach tracks and attach them to the media crypto
    // worker.
    const transceivers = {
        audio: pc.addTransceiver('audio', {direction: 'sendonly'}),
        video: pc.addTransceiver('video', {direction: 'sendonly'}),
    } as const;
    setCodecPreferences(transceivers);
    await transceivers.audio.sender.replaceTrack(tracks.audio);
    if (tracks.video !== undefined) {
        await transceivers.video.sender.replaceTrack(tracks.video);
    }
    if (worker !== undefined) {
        {
            const instruction: MediaCryptoWorkerEncryptStreamInstruction = {
                type: 'encrypt-stream',
                tag: 'sender',
                codec: 'opus',
                pair: transceivers.audio.sender.createEncodedStreams(),
            };
            worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
        }
        {
            const instruction: MediaCryptoWorkerEncryptStreamInstruction = {
                type: 'encrypt-stream',
                tag: 'sender',
                codec: 'vp8',
                pair: transceivers.video.sender.createEncodedStreams(),
            };
            worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
        }
    }

    // O/A dance
    const offer = await pc.createOffer();
    log.info('Offer', offer);
    await pc.setLocalDescription(offer);
    if (transceivers.audio.mid !== '0' || transceivers.video.mid !== '1') {
        throw new Error('Unexpected MIDs on sender');
    }
    local.offer.resolve(offer);
    const answer = await remote.answer;
    log.info('Answer', answer);
    await pc.setRemoteDescription(answer);
}

async function receiver(
    settings: Settings,
    local: {
        readonly answer: ResolvablePromise<RTCSessionDescriptionInit>;
        readonly candidate: EventController<RTCIceCandidate>;
    },
    remote: {
        readonly offer: Promise<RTCSessionDescriptionInit>;
        readonly candidate: EventListener<RTCIceCandidate>;
    },
): Promise<void> {
    const log = logging.logger('receiver');

    // Create peer connection
    const pc = createPeerConnection(settings, log, local, remote);

    // Create media cryptor worker
    const worker = settings.cryptoWorker ? createMediaCryptoWorker(log) : undefined;

    // O/A dance part 1/2
    let offer;
    if (settings.stripSsrcs) {
        const original = await remote.offer;
        log.info('Original offer', original);
        const patched = stripSsrcsFromOffer(original);
        log.info('Patched offer', patched);
        offer = patched;
    } else {
        offer = await remote.offer;
    }
    await pc.setRemoteDescription(offer);

    // Map transceivers, attach them to the audio/video elements and the media
    // crypto worker.
    const unmapped = new Map(
        pc.getTransceivers().map((transceiver) => {
            if (transceiver.direction !== 'recvonly') {
                throw new Error('Unexpected transceiver direction on receiver');
            }
            if (transceiver.mid !== '0' && transceiver.mid !== '1') {
                throw new Error('Unexpected MIDs on receiver');
            }
            return [transceiver.mid, transceiver];
        }),
    );
    const transceivers = {
        audio: unmapped.get('0')!,
        video: unmapped.get('1')!,
    } as const;
    elements.receiver.audio.srcObject = new MediaStream([transceivers.audio.receiver.track]);
    elements.receiver.video.srcObject = new MediaStream([transceivers.video.receiver.track]);
    if (worker !== undefined) {
        {
            const instruction: MediaCryptoWorkerDecryptStreamInstruction = {
                type: 'decrypt-stream',
                tag: 'receiver',
                codec: 'opus',
                pair: transceivers.audio.receiver.createEncodedStreams(),
            };
            worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
        }
        {
            const instruction: MediaCryptoWorkerDecryptStreamInstruction = {
                type: 'decrypt-stream',
                tag: 'receiver',
                codec: 'vp8',
                pair: transceivers.video.receiver.createEncodedStreams(),
            };
            worker.postMessage(instruction, [instruction.pair.readable, instruction.pair.writable]);
        }
    }

    // O/A dance part 2/2
    const answer = await pc.createAnswer();
    log.info('Answer', answer);
    await pc.setLocalDescription(answer);
    local.answer.resolve(answer);
}

async function main(settings: Settings): Promise<void> {
    // Get local streams and show preview
    const senderStreams = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
            width: {ideal: 1280, max: 1280},
            height: {ideal: 960, max: 960},
            frameRate: {ideal: 30, max: 30},
            aspectRatio: {ideal: 4 / 3, max: 16 / 9},
        },
    });
    const senderStream = (elements.sender.video.srcObject = new MediaStream());
    const [senderAudioTrack] = senderStreams.getAudioTracks();
    const [senderVideoTrack] = senderStreams.getVideoTracks();
    if ((senderVideoTrack as MediaStreamTrack | undefined) !== undefined) {
        senderStream.addTrack(senderVideoTrack);
    }

    // Create flows
    const flows = {
        start: new ResolvablePromise<void>(),
        sender: {
            offer: new ResolvablePromise<RTCSessionDescriptionInit>(),
            candidate: new EventController<RTCIceCandidate>(),
        },
        receiver: {
            answer: new ResolvablePromise<RTCSessionDescriptionInit>(),
            candidate: new EventController<RTCIceCandidate>(),
        },
    } as const;

    // Create peer connections and start the O/A flow
    await Promise.all([
        sender(settings, {audio: senderAudioTrack, video: senderVideoTrack}, flows.sender, {
            answer: flows.receiver.answer,
            candidate: flows.receiver.candidate,
        }),
        receiver(settings, flows.receiver, {
            offer: flows.sender.offer,
            candidate: flows.sender.candidate,
        }),
    ]);
}

elements.controls.start.addEventListener('click', () => {
    for (const element of Object.values(elements.controls)) {
        element.disabled = true;
    }
    elements.controls.start.disabled = true;
    void main({
        cryptoWorker: elements.controls.cryptoWorker.checked,
        stripSsrcs: elements.controls.stripSsrcs.checked,
    });
});
