import { EventEmitter } from "events";
import { Logger } from "pino";
import { generateChildLogger } from "@pedrouid/pino-utils";
import { RelayerTypes, IRelayer, IClient, SubscriptionEvent } from "@walletconnect/types";
import { RelayJsonRpc, RELAY_JSONRPC } from "relay-provider";
import { formatRelayRpcUrl } from "@walletconnect/utils";
import { utf8ToHex, hexToUtf8 } from "enc-utils";
import {
  IJsonRpcProvider,
  JsonRpcPayload,
  isJsonRpcRequest,
  JsonRpcRequest,
  formatJsonRpcResult,
  RequestArguments,
} from "@json-rpc-tools/utils";
import { JsonRpcProvider } from "@json-rpc-tools/provider";
import { safeJsonParse, safeJsonStringify } from "safe-json-utils";

import {
  RELAYER_CONTEXT,
  RELAYER_DEFAULT_PROTOCOL,
  RELAYER_DEFAULT_RPC_URL,
  RELAYER_DEFAULT_PUBLISH_TTL,
  RELAYER_EVENTS,
  SUBSCRIPTION_EVENTS,
} from "../constants";

export class Relayer extends IRelayer {
  public events = new EventEmitter();

  public provider: IJsonRpcProvider;

  public subscriptions = new Map<string, string[]>();

  public context: string = RELAYER_CONTEXT;

  constructor(public client: IClient, public logger: Logger, provider?: string | IJsonRpcProvider) {
    super(client, logger);
    this.logger = generateChildLogger(logger, this.context);
    this.provider = this.setProvider(provider);
    this.registerEventListeners();
  }

  get connected(): boolean {
    return this.provider.connection.connected;
  }

  public async init(): Promise<void> {
    this.logger.trace(`Initialized`);
    await this.provider.connect();
  }

  public async publish(
    topic: string,
    payload: JsonRpcPayload,
    opts?: RelayerTypes.PublishOptions,
  ): Promise<void> {
    this.logger.debug(`Publishing Payload`);
    this.logger.trace({ type: "method", method: "publish", params: { topic, payload, opts } });
    try {
      const protocol = opts?.relay.protocol || RELAYER_DEFAULT_PROTOCOL;
      const msg = safeJsonStringify(payload);
      const hasKeys = await this.client.crypto.hasKeys(topic);
      const message = hasKeys ? await this.client.crypto.encrypt(topic, msg) : utf8ToHex(msg);
      const jsonRpc = getRelayProtocolJsonRpc(protocol);
      const request: RequestArguments<RelayJsonRpc.PublishParams> = {
        method: jsonRpc.publish,
        params: {
          topic,
          message,
          ttl: opts?.ttl || RELAYER_DEFAULT_PUBLISH_TTL,
        },
      };
      this.logger.debug(`Outgoing Relay Payload`);
      this.logger.trace({ type: "payload", direction: "outgoing", request });
      await this.provider.request(request);
      this.logger.debug(`Successfully Published Payload`);
      this.logger.trace({ type: "method", method: "publish", request });
    } catch (e) {
      this.logger.debug(`Failed to Publish Payload`);
      this.logger.error(e);
      throw e;
    }
  }

  public async subscribe(topic: string, opts?: RelayerTypes.SubscribeOptions): Promise<string> {
    this.logger.debug(`Subscribing Topic`);
    this.logger.trace({ type: "method", method: "subscribe", params: { topic, opts } });
    try {
      const protocol = opts?.relay.protocol || RELAYER_DEFAULT_PROTOCOL;
      const jsonRpc = getRelayProtocolJsonRpc(protocol);
      const request: RequestArguments<RelayJsonRpc.SubscribeParams> = {
        method: jsonRpc.subscribe,
        params: {
          topic,
        },
      };
      this.logger.debug(`Outgoing Relay Payload`);
      this.logger.trace({ type: "payload", direction: "outgoing", request });
      const id = await this.provider.request(request);
      const subscriptions = this.subscriptions.get(topic) || [];
      this.subscriptions.set(topic, [...subscriptions, id]);
      this.events.on(id, async ({ message }) => {
        const hasKeys = await this.client.crypto.hasKeys(topic);
        const payload = safeJsonParse(
          hasKeys ? await this.client.crypto.decrypt(topic, message) : hexToUtf8(message),
        );
        this.events.emit(RELAYER_EVENTS.payload, { topic, payload });
      });
      this.logger.debug(`Successfully Subscribed Topic`);
      this.logger.trace({ type: "method", method: "subscribe", request });
      return id;
    } catch (e) {
      this.logger.debug(`Failed to Subscribe Topic`);
      this.logger.error(e);
      throw e;
    }
  }

  public async unsubscribe(topic: string, opts?: RelayerTypes.UnsubscribeOptions): Promise<void> {
    this.logger.debug(`Unsubscribing Topic`);
    this.logger.trace({ type: "method", method: "unsubscribeTopic", params: { topic, opts } });
    try {
      if (typeof opts?.id !== "undefined") {
        await this.unsubscribeId(topic, opts?.id, opts);
      } else {
        const subscriptions = this.subscriptions.get(topic);
        if (!subscriptions) return;
        await Promise.all(subscriptions.map(id => this.unsubscribeId(topic, id, opts)));
      }
      this.logger.debug(`Successfully Unsubscribed Topic`);
      this.logger.trace({ type: "method", method: "unsubscribeTopic" });
    } catch (e) {
      this.logger.debug(`Failed to Unsubscribe Topic`);
      this.logger.error(e);
      throw e;
    }
  }

  public on(event: string, listener: any): void {
    this.events.on(event, listener);
  }

  public once(event: string, listener: any): void {
    this.events.once(event, listener);
  }

  public off(event: string, listener: any): void {
    this.events.off(event, listener);
  }

  public removeListener(event: string, listener: any): void {
    this.events.removeListener(event, listener);
  }

  // ---------- Private ----------------------------------------------- //

  private onPayload(payload: JsonRpcPayload) {
    this.logger.debug(`Incoming Relay Payload`);
    this.logger.trace({ type: "payload", direction: "incoming", payload });
    if (isJsonRpcRequest(payload)) {
      if (payload.method.endsWith("_subscription")) {
        const event = (payload as JsonRpcRequest<RelayJsonRpc.SubscriptionParams>).params;
        this.events.emit(event.id, event.data);
        const response = formatJsonRpcResult(payload.id, true);
        this.provider.connection.send(response);
      }
    }
  }

  private setProvider(provider?: string | IJsonRpcProvider): IJsonRpcProvider {
    this.logger.debug(`Setting Relay Provider`);
    this.logger.trace({ type: "method", method: "setProvider", provider: provider?.toString() });
    const rpcUrl = formatRelayRpcUrl(
      this.client.protocol,
      this.client.version,
      typeof provider === "string" ? provider : RELAYER_DEFAULT_RPC_URL,
    );
    return typeof provider !== "string" && typeof provider !== "undefined"
      ? provider
      : new JsonRpcProvider(rpcUrl);
  }

  private async unsubscribeId(
    topic: string,
    id: string,
    opts?: RelayerTypes.UnsubscribeOptions,
  ): Promise<void> {
    this.logger.debug(`Unsubscribing Topic`);
    this.logger.trace({ type: "method", method: "unsubscribe", params: { id, opts } });
    try {
      const protocol = opts?.relay.protocol || RELAYER_DEFAULT_PROTOCOL;
      const jsonRpc = getRelayProtocolJsonRpc(protocol);
      const request: RequestArguments<RelayJsonRpc.UnsubscribeParams> = {
        method: jsonRpc.unsubscribe,
        params: {
          id,
        },
      };
      this.logger.debug(`Outgoing Relay Payload`);
      this.logger.trace({ type: "payload", direction: "outgoing", request });
      await this.provider.request(request);
      this.events.removeAllListeners(id);
      const subscriptions = this.subscriptions.get(topic);
      if (subscriptions) {
        this.subscriptions.set(
          topic,
          subscriptions.filter(x => x === id),
        );
      }
      this.logger.debug(`Successfully Unsubscribed Topic`);
      this.logger.trace({ type: "method", method: "unsubscribe", request });
    } catch (e) {
      this.logger.debug(`Failed to Unsubscribe Topic`);
      this.logger.error(e);
      throw e;
    }
  }

  private registerEventListeners(): void {
    this.provider.on("payload", (payload: JsonRpcPayload) => this.onPayload(payload));
    this.provider.on("connect", () => this.events.emit(RELAYER_EVENTS.connect));
    this.provider.on("disconnect", () => {
      this.events.emit(RELAYER_EVENTS.disconnect);
      this.provider.connect();
    });
    this.provider.on("error", e => this.events.emit(RELAYER_EVENTS.error, e));
    this.client.events.on(SUBSCRIPTION_EVENTS.created, async (event: SubscriptionEvent.Created) => {
      await this.subscribe(event.topic, event.opts);
    });
    this.client.events.on(SUBSCRIPTION_EVENTS.deleted, async (event: SubscriptionEvent.Created) => {
      await this.unsubscribe(event.topic, event.opts);
    });
  }
}

function getRelayProtocolJsonRpc(protocol: string) {
  const jsonrpc = RELAY_JSONRPC[protocol];
  if (typeof jsonrpc === "undefined") {
    throw new Error(`Relay Protocol not supported: ${protocol}`);
  }
  return jsonrpc;
}
