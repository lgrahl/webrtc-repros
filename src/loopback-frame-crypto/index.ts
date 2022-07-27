export type MediaStreamPayloadCodec = 'opus' | 'vp8';

export type AnyEncodedFrame = RTCEncodedAudioFrame | RTCEncodedVideoFrame;

export interface MediaStreamPair {
    readonly readable: ReadableStream<AnyEncodedFrame>;
    readonly writable: WritableStream<AnyEncodedFrame>;
}

export interface MediaCryptoWorkerEncryptStreamInstruction {
    readonly type: 'encrypt-stream';
    readonly tag: string;
    readonly codec: MediaStreamPayloadCodec;
    readonly pair: MediaStreamPair;
}

export interface MediaCryptoWorkerDecryptStreamInstruction {
    readonly type: 'decrypt-stream';
    readonly tag: string;
    readonly codec: MediaStreamPayloadCodec;
    readonly pair: MediaStreamPair;
}

export type MediaCryptoWorkerInstruction =
    | MediaCryptoWorkerEncryptStreamInstruction
    | MediaCryptoWorkerDecryptStreamInstruction;
