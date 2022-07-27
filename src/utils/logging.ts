/**
 * Log function to log a record for a specific level.
 */
type LogRecordFn = (...data: readonly unknown[]) => void;

/**
 * Log function to log an assertion in case `condition` is `false`.
 */
type AssertLogRecordFn = (condition: boolean, ...data: readonly unknown[]) => asserts condition;

/**
 * A generic logger interface.
 */
export interface Logger {
    // Log functions, compatible with `console`
    trace: LogRecordFn;
    debug: LogRecordFn;
    info: LogRecordFn;
    warn: LogRecordFn;
    error: LogRecordFn;
    assert: AssertLogRecordFn;
}

// The global `console` exists in both Node and DOM, so we'll just assume it's
// available.
declare const console: Logger;

/**
 * Discards all log records.
 *
 * However, it does evaluate asserts and simply throws in case the assertion
 * fails.
 */
class NoopLogger implements Logger {
    public readonly debug = NoopLogger._noop;
    public readonly trace = NoopLogger._noop;
    public readonly info = NoopLogger._noop;
    public readonly warn = NoopLogger._noop;
    public readonly error = NoopLogger._noop;
    public readonly assert = NoopLogger._assert;

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private static _noop(): void {}
    private static _assert(condition: boolean, ...data: readonly unknown[]): void {
        if (!condition) {
            throw new Error(`Assertion failed: ${data.join(' ')}`);
        }
    }
}
export const NOOP_LOGGER = new NoopLogger();

/**
 * Forwards all log records to the default `Console` logger.
 */
class ConsoleLogger implements Logger {
    public readonly debug = console.debug;
    public readonly trace = console.trace;
    public readonly info = console.info;
    public readonly warn = console.warn;
    public readonly error = console.error;

    /**
     * Works like {@link assert} but also logs a failed assertion to the
     * console.
     */
    public assert(condition: boolean, ...data: readonly unknown[]): asserts condition {
        if (!condition) {
            const message = `Assertion failed: ${data.join(' ')}`;
            this.error(message);
            throw new Error(message);
        }
    }
}
export const CONSOLE_LOGGER = new ConsoleLogger();

/**
 * Adds a prefix before forwarding log records to another logger.
 */
class TagLogger implements Logger {
    public readonly parent: Logger;
    public readonly trace: LogRecordFn;
    public readonly debug: LogRecordFn;
    public readonly info: LogRecordFn;
    public readonly warn: LogRecordFn;
    public readonly error: LogRecordFn;
    public readonly assert: AssertLogRecordFn;

    public constructor(parent: Logger, tag: string) {
        this.parent = parent;

        // Apply a tag to each log level type method of the logger
        this.trace = parent.trace.bind(parent, tag);
        this.debug = parent.debug.bind(parent, tag);
        this.info = parent.info.bind(parent, tag);
        this.warn = parent.warn.bind(parent, tag);
        this.error = parent.error.bind(parent, tag);
        this.assert = (condition, ...data): void => parent.assert(condition, tag, ...data);
    }
}

/**
 * Log service that initialies logging and hands out {@link Logger}
 * instances.
 */
export class Logging {
    private readonly _log = CONSOLE_LOGGER;

    public constructor(private readonly _tag?: string) {}

    /**
     * Create a new logger instance with a specific tag that inherits
     * properties from the root logger.
     *
     * @param tag The tag prefix for the logger.
     * @returns a logger instance.
     */
    public logger(tag: string): Logger {
        // Create logger instance
        if (this._tag !== undefined) {
            tag = `${this._tag}.${tag}`;
        }
        return new TagLogger(this._log, tag);
    }
}
