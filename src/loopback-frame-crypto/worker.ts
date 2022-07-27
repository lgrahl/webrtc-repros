import {type Logger, Logging} from '../utils/logging';
import {
    type AnyEncodedFrame,
    type MediaCryptoWorkerInstruction,
    type MediaStreamPayloadCodec,
} from '.';

const logging = new Logging('worker');
const log = logging.logger('media-crypto');

log.info('Started');

// Handle uncaught errors
self.addEventListener('error', (error) => {
    log.error('Uncaught error', error);
});

class MediaEncryptor implements Transformer<AnyEncodedFrame, AnyEncodedFrame> {
    readonly #_iv = Uint8Array.from([
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
    ]);
    readonly #_key: CryptoKey;
    private readonly _log: Logger;
    private _frames = 0;

    public constructor(
        key: CryptoKey,
        tag: string,
        private readonly _codec: MediaStreamPayloadCodec,
    ) {
        this._log = logging.logger(`decryptor.${tag}`);
        this.#_key = key;
    }

    public async transform(
        frame: AnyEncodedFrame,
        controller: TransformStreamDefaultController<AnyEncodedFrame>,
    ): Promise<void> {
        // IMPORTANT: This is cryptographically broken because nonce reuse!
        const encrypted = (await self.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: this.#_iv,
            },
            this.#_key,
            frame.data,
        )) as ArrayBuffer;

        // Update frame data
        if (this._frames++ < 10) {
            this._log.debug(
                `Encrypted frame (length=${frame.data.byteLength} -> ${encrypted.byteLength}, codec=${this._codec})`,
            );
        }
        frame.data = encrypted;
        controller.enqueue(frame);
    }
}

class MediaDecryptor implements Transformer<AnyEncodedFrame, AnyEncodedFrame> {
    readonly #_iv = Uint8Array.from([
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
    ]);
    readonly #_key: CryptoKey;
    private readonly _log: Logger;
    private _frames = 0;

    public constructor(
        key: CryptoKey,
        tag: string,
        private readonly _codec: MediaStreamPayloadCodec,
    ) {
        this._log = logging.logger(`decryptor.${tag}`);
        this.#_key = key;
    }

    public async transform(
        frame: AnyEncodedFrame,
        controller: TransformStreamDefaultController<AnyEncodedFrame>,
    ): Promise<void> {
        // IMPORTANT: This is cryptographically broken because nonce reuse!
        let decrypted;
        try {
            decrypted = (await self.crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: this.#_iv,
                },
                this.#_key,
                frame.data,
            )) as ArrayBuffer;
        } catch {
            this._log.warn('Discarding invalid frame, decryption failed');
            return;
        }

        // Update frame data
        if (this._frames++ < 10) {
            this._log.debug(
                `Decrypted frame (length=${frame.data.byteLength} -> ${decrypted.byteLength}, codec=${this._codec})`,
            );
        }
        frame.data = decrypted;
        controller.enqueue(frame);
    }
}

// Create encryption key (all zeroes)
const key = self.crypto.subtle.importKey('raw', new Uint8Array(32), {name: 'AES-GCM'}, false, [
    'encrypt',
    'decrypt',
]);

// Handle stream encode/decode requests
async function handleInstruction(instruction: MediaCryptoWorkerInstruction): Promise<void> {
    switch (instruction.type) {
        case 'encrypt-stream': {
            const encryptor = new TransformStream(
                new MediaEncryptor(await key, instruction.tag, instruction.codec),
            );
            void instruction.pair.readable.pipeThrough(encryptor).pipeTo(instruction.pair.writable);
            break;
        }
        case 'decrypt-stream': {
            const decryptor = new TransformStream(
                new MediaDecryptor(await key, instruction.tag, instruction.codec),
            );
            void instruction.pair.readable.pipeThrough(decryptor).pipeTo(instruction.pair.writable);
            break;
        }
        default:
            throw new Error(`Invalid instruction: ${instruction}`);
    }
}
self.addEventListener('message', ({data}) => {
    const instruction = data as MediaCryptoWorkerInstruction;
    void handleInstruction(instruction);
});
