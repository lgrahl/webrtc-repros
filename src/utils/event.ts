import {type Logger} from './logging';

/**
 * An event subscriber.
 */
export type EventSubscriber<TEvent> = (event: TEvent) => void;

/**
 * An event unsubscriber.
 */
export type EventUnsubscriber = () => void;

/**
 * An event listener allows to subscribe to events.
 */
export interface EventListener<TEvent> {
    readonly subscribe: (subscriber: EventSubscriber<TEvent>) => EventUnsubscriber;
}

/**
 * Event controller allowing to raise events.
 *
 * All events are dispatched synchronously to the attached subscribers.
 */
export class EventController<TEvent> {
    private readonly _subscribers = new Set<EventSubscriber<TEvent>>();

    public constructor(private readonly _log?: Logger) {}

    public get listener(): EventListener<TEvent> {
        return this;
    }

    /**
     * Subscribe to events.
     *
     * @param subscriber An event subscriber.
     * @returns An unsubscriber for this specific subscriber.
     */
    public subscribe(subscriber: EventSubscriber<TEvent>): EventUnsubscriber {
        // Subscribe
        if (this._log !== undefined) {
            const subscribers = this._subscribers.size;
            this._log.debug(`Subscribed (${subscribers} -> ${subscribers + 1})`);
        }
        this._subscribers.add(subscriber);

        // Return unsubscribe function
        return (): void => {
            if (this._subscribers.delete(subscriber)) {
                if (this._log !== undefined) {
                    const subscribers = this._subscribers.size;
                    this._log.debug(`Unsubscribed (${subscribers + 1} -> ${subscribers})`);
                }
            } else {
                this._log?.warn('Unsubscriber called twice!', subscriber);
            }
        };
    }

    /**
     * Raise an event and dispatch it synchronously to all subscribers.
     *
     * @param event The event to be dispatched.
     */
    public raise(event: TEvent): void {
        if (this._log !== undefined) {
            this._log.debug(`Dispatching event to ${this._subscribers.size} subscribers`);
        }
        for (const subscriber of this._subscribers) {
            try {
                subscriber(event);
            } catch (error) {
                this._log?.error('Uncaught error in event subscriber', error);
            }
        }
    }
}
