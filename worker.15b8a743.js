(function() {
  "use strict";
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
  const logging = new Logging("worker");
  const log = logging.logger("media-crypto");
  log.info("Started");
  self.addEventListener("error", (error) => {
    log.error("Uncaught error", error);
  });
  class MediaEncryptor {
    constructor(key2, tag, _codec) {
      this._codec = _codec;
      this.#_iv = Uint8Array.from([
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12
      ]);
      this._frames = 0;
      this._log = logging.logger(`decryptor.${tag}`);
      this.#_key = key2;
    }
    #_iv;
    #_key;
    async transform(frame, controller) {
      const encrypted = await self.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: this.#_iv
        },
        this.#_key,
        frame.data
      );
      if (this._frames++ < 10) {
        this._log.debug(
          `Encrypted frame (length=${frame.data.byteLength} -> ${encrypted.byteLength}, codec=${this._codec})`
        );
      }
      frame.data = encrypted;
      controller.enqueue(frame);
    }
  }
  class MediaDecryptor {
    constructor(key2, tag, _codec) {
      this._codec = _codec;
      this.#_iv = Uint8Array.from([
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12
      ]);
      this._frames = 0;
      this._log = logging.logger(`decryptor.${tag}`);
      this.#_key = key2;
    }
    #_iv;
    #_key;
    async transform(frame, controller) {
      let decrypted;
      try {
        decrypted = await self.crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: this.#_iv
          },
          this.#_key,
          frame.data
        );
      } catch {
        this._log.warn("Discarding invalid frame, decryption failed");
        return;
      }
      if (this._frames++ < 10) {
        this._log.debug(
          `Decrypted frame (length=${frame.data.byteLength} -> ${decrypted.byteLength}, codec=${this._codec})`
        );
      }
      frame.data = decrypted;
      controller.enqueue(frame);
    }
  }
  const key = self.crypto.subtle.importKey("raw", new Uint8Array(32), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt"
  ]);
  async function handleInstruction(instruction) {
    switch (instruction.type) {
      case "encrypt-stream": {
        const encryptor = new TransformStream(
          new MediaEncryptor(await key, instruction.tag, instruction.codec)
        );
        void instruction.pair.readable.pipeThrough(encryptor).pipeTo(instruction.pair.writable);
        break;
      }
      case "decrypt-stream": {
        const decryptor = new TransformStream(
          new MediaDecryptor(await key, instruction.tag, instruction.codec)
        );
        void instruction.pair.readable.pipeThrough(decryptor).pipeTo(instruction.pair.writable);
        break;
      }
      default:
        throw new Error(`Invalid instruction: ${instruction}`);
    }
  }
  self.addEventListener("message", ({ data }) => {
    const instruction = data;
    void handleInstruction(instruction);
  });
})();
