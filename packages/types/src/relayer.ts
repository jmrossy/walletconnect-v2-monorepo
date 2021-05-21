import { Logger } from "pino";
import { IJsonRpcProvider, JsonRpcPayload, IEvents } from "@json-rpc-tools/types";

import { IClient } from "./client";

export declare namespace RelayerTypes {
  export interface ProtocolOptions {
    protocol: string;
    params?: any;
  }

  export interface PublishOptions {
    relay: ProtocolOptions;
    ttl?: number;
  }

  export interface SubscribeOptions {
    relay: ProtocolOptions;
  }

  export interface UnsubscribeOptions extends SubscribeOptions {
    id?: string;
  }
}

export abstract class IRelayer {
  public abstract provider: IJsonRpcProvider;

  public abstract context: string;

  public abstract readonly connected: boolean;

  constructor(
    public client: IClient,
    public logger: Logger,
    provider?: string | IJsonRpcProvider,
  ) {}

  public abstract init(): Promise<void>;

  public abstract publish(
    topic: string,
    payload: JsonRpcPayload,
    opts?: RelayerTypes.PublishOptions,
  ): Promise<void>;

  public abstract subscribe(topic: string, opts?: RelayerTypes.SubscribeOptions): Promise<string>;

  public abstract unsubscribe(topic: string, opts?: RelayerTypes.UnsubscribeOptions): Promise<void>;
}
