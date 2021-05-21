import { Logger } from "pino";

import { IClient } from "./client";
import { Reason } from "./misc";
import { RelayerTypes } from "./relayer";
import { SequenceTypes } from "./sequence";

export interface SubscriptionOptions extends RelayerTypes.SubscribeOptions {
  expiry?: number;
}

export type DefaultSequence = SequenceTypes.Pending | SequenceTypes.Settled;

export interface SubscriptionParams<Sequence = DefaultSequence> extends SubscriptionOptions {
  topic: string;
  sequence: Sequence;
  expiry: number;
}

export declare namespace SubscriptionEvent {
  export interface Created<Sequence = DefaultSequence> {
    tag: string;
    topic: string;
    sequence: Sequence;
    opts: SubscriptionOptions;
  }

  export interface Updated<Sequence = DefaultSequence> {
    tag: string;
    topic: string;
    sequence: Sequence;
    update: Partial<Sequence>;
  }

  export interface Deleted<Sequence = DefaultSequence> {
    tag: string;
    topic: string;
    sequence: Sequence;
    reason: Reason;
  }
}

export type SubscriptionEntries<T> = Record<string, SubscriptionParams<T>>;

export abstract class ISubscription<Sequence = DefaultSequence> {
  public abstract subscriptions = new Map<string, SubscriptionParams<Sequence>>();

  public abstract readonly length: number;

  public abstract readonly topics: string[];

  public abstract readonly values: SubscriptionParams<Sequence>[];

  constructor(public client: IClient, public logger: Logger, public context: string) {}

  public abstract init(): Promise<void>;

  public abstract set(topic: string, data: Sequence, opts: SubscriptionOptions): Promise<void>;

  public abstract get(topic: string): Promise<Sequence>;

  public abstract update(topic: string, update: Partial<Sequence>): Promise<void>;

  public abstract delete(topic: string, reason: Reason): Promise<void>;
}
