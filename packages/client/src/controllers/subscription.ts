import { EventEmitter } from "events";
import { Logger } from "pino";
import {
  IClient,
  ISubscription,
  Reason,
  SubscriptionEvent,
  SubscriptionOptions,
  SubscriptionParams,
} from "@walletconnect/types";
import { ERROR } from "@walletconnect/utils";

import {
  CLIENT_BEAT_INTERVAL,
  CLIENT_EVENTS,
  SUBSCRIPTION_DEFAULT_TTL,
  SUBSCRIPTION_EVENTS,
} from "../constants";
import { generateChildLogger, getLoggerContext } from "@pedrouid/pino-utils";

export class Subscription<Sequence = any> extends ISubscription<Sequence> {
  public subscriptions = new Map<string, SubscriptionParams<Sequence>>();

  private timeout = new Map<string, NodeJS.Timeout>();

  private cached: SubscriptionParams<Sequence>[] = [];

  constructor(public client: IClient, public logger: Logger, public context: string) {
    super(client, logger, context);
    this.logger = generateChildLogger(logger, this.context);

    this.registerEventListeners();
  }

  public async init(): Promise<void> {
    this.logger.trace(`Initialized`);
    await this.restore();
  }

  get length(): number {
    return this.subscriptions.size;
  }

  get topics(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  get values(): SubscriptionParams<Sequence>[] {
    return Array.from(this.subscriptions.values());
  }

  public async set(topic: string, sequence: Sequence, opts: SubscriptionOptions): Promise<void> {
    await this.isEnabled();
    if (this.subscriptions.has(topic)) {
      this.update(topic, sequence);
    } else {
      this.logger.debug(`Setting subscription`);
      this.logger.trace({ type: "method", method: "set", topic, sequence, opts });
      await this.subscribeAndSet(topic, sequence, opts);
      this.client.events.emit(SUBSCRIPTION_EVENTS.created, {
        tag: this.getSubscriptionEventTag(),
        topic,
        sequence,
      } as SubscriptionEvent.Created<Sequence>);
    }
  }

  public async get(topic: string): Promise<Sequence> {
    await this.isEnabled();
    this.logger.debug(`Getting subscription`);
    this.logger.trace({ type: "method", method: "get", topic });
    const subscription = await this.getSubscription(topic);
    return subscription.sequence;
  }

  public async update(topic: string, update: Partial<Sequence>): Promise<void> {
    await this.isEnabled();
    this.logger.debug(`Updating subscription`);
    this.logger.trace({ type: "method", method: "update", topic, update });
    const subscription = await this.getSubscription(topic);
    const sequence = { ...subscription.sequence, ...update };
    this.subscriptions.set(topic, {
      ...subscription,
      topic,
      sequence,
    });
    this.client.events.emit(SUBSCRIPTION_EVENTS.updated, {
      tag: this.getSubscriptionEventTag(),
      topic,
      sequence,
      update,
    } as SubscriptionEvent.Updated<Sequence>);
  }

  public async delete(topic: string, reason: Reason): Promise<void> {
    await this.isEnabled();

    this.logger.debug(`Deleting subscription`);
    this.logger.trace({ type: "method", method: "delete", topic, reason });
    const subscription = await this.getSubscription(topic);
    this.subscriptions.delete(topic);
    this.client.events.emit(SUBSCRIPTION_EVENTS.deleted, {
      tag: this.getSubscriptionEventTag(),
      topic,
      sequence: subscription.sequence,
      reason,
    } as SubscriptionEvent.Deleted<Sequence>);
  }

  // ---------- Private ----------------------------------------------- //

  private getNestedContext(length = 2): string[] {
    const nestedContext = getLoggerContext(this.logger).split("/");
    return nestedContext.slice(nestedContext.length - length, nestedContext.length);
  }

  private getSubscriptionContext(): string {
    return this.getNestedContext().join(" ");
  }

  private getSubscriptionStorageKey(): string {
    return this.getNestedContext().join(":");
  }

  private getSubscriptionEventTag(): string {
    return this.getNestedContext().join("/");
  }

  private getStorageKey() {
    const storageKeyPrefix = `${this.client.protocol}@${this.client.version}:${this.client.context}`;
    const subscriptionStorageKey = this.getSubscriptionStorageKey();
    return `${storageKeyPrefix}//${subscriptionStorageKey}`;
  }

  private async getSubscription(topic: string): Promise<SubscriptionParams<Sequence>> {
    await this.isEnabled();
    const subscription = this.subscriptions.get(topic);
    if (!subscription) {
      const error = ERROR.NO_MATCHING_TOPIC.format({
        context: this.getSubscriptionContext(),
        topic,
      });
      this.logger.error(error.message);
      throw new Error(error.message);
    }
    return subscription;
  }

  private async subscribeAndSet(
    topic: string,
    sequence: Sequence,
    opts: SubscriptionOptions,
  ): Promise<void> {
    const expiry = opts.expiry || Date.now() + SUBSCRIPTION_DEFAULT_TTL * 1000;
    this.subscriptions.set(topic, { topic, sequence, ...opts, expiry });
    this.setTimeout(topic, expiry);
  }

  private setTimeout(topic: string, expiry: number) {
    if (this.timeout.has(topic)) return;
    const ttl = expiry - Date.now();
    if (ttl <= 0) {
      this.onTimeout(topic);
      return;
    }
    if (ttl > CLIENT_BEAT_INTERVAL) return;
    const timeout = setTimeout(() => this.onTimeout(topic), ttl);
    this.timeout.set(topic, timeout);
  }

  private deleteTimeout(topic: string): void {
    if (!this.timeout.has(topic)) return;
    const timeout = this.timeout.get(topic);
    if (typeof timeout === "undefined") return;
    clearTimeout(timeout);
  }

  private resetTimeout(): void {
    this.timeout.forEach(timeout => clearTimeout(timeout));
    this.timeout.clear();
  }

  private onTimeout(topic: string): void {
    this.deleteTimeout(topic);
    this.delete(topic, ERROR.EXPIRED.format({ context: this.getSubscriptionContext() }));
  }

  private checkSubscriptions(): void {
    this.subscriptions.forEach(subscription =>
      this.setTimeout(subscription.topic, subscription.expiry),
    );
  }

  private async persist() {
    await this.client.storage.setItem<SubscriptionParams<Sequence>[]>(
      this.getStorageKey(),
      this.values,
    );
    this.client.events.emit(SUBSCRIPTION_EVENTS.sync);
  }

  private async restore() {
    try {
      const persisted = await this.client.storage.getItem<SubscriptionParams<Sequence>[]>(
        this.getStorageKey(),
      );
      if (typeof persisted === "undefined") return;
      if (!persisted.length) return;
      if (this.subscriptions.size) {
        const error = ERROR.RESTORE_WILL_OVERRIDE.format({
          context: this.getSubscriptionContext(),
        });
        this.logger.error(error.message);
        throw new Error(error.message);
      }
      this.cached = persisted;
      await Promise.all(
        this.cached.map(async subscription => {
          const { topic, sequence } = subscription;
          const opts = {
            relay: subscription.relay,
            expiry: subscription.expiry,
          };
          await this.subscribeAndSet(topic, sequence, opts);
        }),
      );
      await this.enable();
      this.logger.debug(`Successfully Restored subscriptions for ${this.getSubscriptionContext()}`);
      this.logger.trace({ type: "method", method: "restore", subscriptions: this.values });
    } catch (e) {
      this.logger.debug(`Failed to Restore subscriptions for ${this.getSubscriptionContext()}`);
      this.logger.error(e);
    }
  }

  private async reset(): Promise<void> {
    await this.disable();
    await Promise.all(
      this.cached.map(async subscription => {
        const { topic, sequence } = subscription;
        const opts = { relay: subscription.relay, expiry: subscription.expiry };
        await this.subscribeAndSet(topic, sequence, opts);
      }),
    );
    await this.enable();
  }

  private async isEnabled(): Promise<void> {
    if (!this.cached.length) return;
    return new Promise(resolve => {
      this.client.events.once(SUBSCRIPTION_EVENTS.enabled, () => resolve());
    });
  }

  private async enable(): Promise<void> {
    this.cached = [];
    this.client.events.emit(SUBSCRIPTION_EVENTS.enabled);
  }

  private async disable(): Promise<void> {
    if (!this.cached.length) {
      this.cached = this.values;
    }
    this.resetTimeout();
    this.client.events.emit(SUBSCRIPTION_EVENTS.disabled);
  }

  private registerEventListeners(): void {
    this.client.on(CLIENT_EVENTS.beat, () => this.checkSubscriptions());
    this.client.events.on(
      SUBSCRIPTION_EVENTS.created,
      (createdEvent: SubscriptionEvent.Created<Sequence>) => {
        const eventName = SUBSCRIPTION_EVENTS.created;
        this.logger.info(`Emitting ${eventName}`);
        this.logger.debug({ type: "event", event: eventName, sequence: createdEvent });
        this.persist();
      },
    );
    this.client.events.on(
      SUBSCRIPTION_EVENTS.updated,
      (updatedEvent: SubscriptionEvent.Updated<Sequence>) => {
        const eventName = SUBSCRIPTION_EVENTS.updated;
        this.logger.info(`Emitting ${eventName}`);
        this.logger.debug({ type: "event", event: eventName, sequence: updatedEvent });
        this.persist();
      },
    );
    this.client.events.on(
      SUBSCRIPTION_EVENTS.deleted,
      (deletedEvent: SubscriptionEvent.Deleted<Sequence>) => {
        const eventName = SUBSCRIPTION_EVENTS.deleted;
        this.logger.info(`Emitting ${eventName}`);
        this.logger.debug({ type: "event", event: eventName, sequence: deletedEvent });
        this.persist();
      },
    );
  }
}
