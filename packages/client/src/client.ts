import { EventEmitter } from "events";
import pino, { Logger } from "pino";
import KeyValueStorage, { IKeyValueStorage } from "keyvaluestorage";
import {
  IClient,
  ClientOptions,
  ClientTypes,
  PairingTypes,
  SessionTypes,
  AppMetadata,
} from "@walletconnect/types";
import {
  isPairingFailed,
  isSessionFailed,
  parseUri,
  isPairingResponded,
  isSessionResponded,
  getAppMetadata,
  ERROR,
} from "@walletconnect/utils";
import { generateChildLogger, getDefaultLoggerOptions } from "@pedrouid/pino-utils";

import { Pairing, Session, Relayer } from "./controllers";
import {
  CLIENT_CONTEXT,
  CLIENT_BEAT_INTERVAL,
  CLIENT_EVENTS,
  CLIENT_STORAGE_OPTIONS,
  PAIRING_DEFAULT_TTL,
  PAIRING_EVENTS,
  PAIRING_SIGNAL_METHOD_URI,
  RELAYER_DEFAULT_PROTOCOL,
  SESSION_EMPTY_PERMISSIONS,
  SESSION_EMPTY_RESPONSE,
  SESSION_EMPTY_STATE,
  SESSION_JSONRPC,
  SESSION_SIGNAL_METHOD_PAIRING,
} from "./constants";
import { Crypto, KeyChain } from "./controllers/crypto";

export class Client extends IClient {
  public readonly protocol = "wc";
  public readonly version = 2;

  public events = new EventEmitter();

  public logger: Logger;
  public crypto: Crypto;

  public relayer: Relayer;
  public storage: IKeyValueStorage;

  public pairing: Pairing;
  public session: Session;

  public context: string = CLIENT_CONTEXT;

  public readonly controller: boolean;
  public metadata: AppMetadata | undefined;

  static async init(opts?: ClientOptions): Promise<Client> {
    const client = new Client(opts);
    await client.initialize();
    return client;
  }

  constructor(opts?: ClientOptions) {
    super(opts);
    const logger =
      typeof opts?.logger !== "undefined" && typeof opts?.logger !== "string"
        ? opts.logger
        : pino(getDefaultLoggerOptions({ level: opts?.logger || "error" }));

    this.context = opts?.name || this.context;
    this.controller = opts?.controller || false;
    this.metadata = opts?.metadata || getAppMetadata();

    const storage =
      opts?.storage || new KeyValueStorage({ ...CLIENT_STORAGE_OPTIONS, ...opts?.storageOptions });

    this.logger = generateChildLogger(logger, this.context);
    this.crypto = new Crypto(this, opts?.keychain || new KeyChain(this, storage));

    this.relayer = new Relayer(this, this.logger, opts?.relayProvider);
    this.storage = storage;

    this.pairing = new Pairing(this, this.logger);
    this.session = new Session(this, this.logger);
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

  public async connect(params: ClientTypes.ConnectParams): Promise<SessionTypes.Settled> {
    this.logger.debug(`Connecting Application`);
    this.logger.trace({ type: "method", method: "connect", params });
    try {
      if (typeof params.pairing === undefined) {
        this.logger.info("Connecing with existing pairing");
      }
      const pairing =
        typeof params.pairing === "undefined"
          ? await this.pairing.create()
          : await this.pairing.get(params.pairing.topic);
      this.logger.trace({ type: "method", method: "connect", pairing });
      const metadata = params.metadata || this.metadata;
      if (typeof metadata === "undefined") {
        const error = ERROR.MISSING_OR_INVALID.format({ name: "app metadata" });
        this.logger.error(error.message);
        throw new Error(error.message);
      }
      const session = await this.session.create({
        signal: { method: SESSION_SIGNAL_METHOD_PAIRING, params: { topic: pairing.topic } },
        relay: params.relay || { protocol: RELAYER_DEFAULT_PROTOCOL },
        metadata,
        permissions: {
          ...params.permissions,
          notifications: SESSION_EMPTY_PERMISSIONS.notifications,
        },
      });
      this.logger.debug(`Application Connection Successful`);
      this.logger.trace({ type: "method", method: "connect", session });
      return session;
    } catch (e) {
      this.logger.debug(`Application Connection Failure`);
      this.logger.error(e);
      throw e;
    }
  }

  public async pair(params: ClientTypes.PairParams): Promise<string> {
    this.logger.debug(`Pairing`);
    this.logger.trace({ type: "method", method: "pair", params });
    const proposal = formatPairingProposal(params.uri);
    const approved = proposal.proposer.controller !== this.controller;
    const reason = approved
      ? undefined
      : ERROR.UNAUTHORIZED_MATCHING_CONTROLLER.format({ controller: this.controller });
    const pending = await this.pairing.respond({ approved, proposal, reason });
    if (!isPairingResponded(pending)) {
      const error = ERROR.NO_MATCHING_RESPONSE.format({ context: "pairing" });
      this.logger.error(error.message);
      throw new Error(error.message);
    }
    if (isPairingFailed(pending.outcome)) {
      this.logger.debug(`Pairing Failure`);
      this.logger.trace({ type: "method", method: "pair", outcome: pending.outcome });
      throw new Error(pending.outcome.reason.message);
    }
    this.logger.debug(`Pairing Success`);
    this.logger.trace({ type: "method", method: "pair", pending });
    return pending.outcome.topic;
  }

  public async approve(params: ClientTypes.ApproveParams): Promise<SessionTypes.Settled> {
    this.logger.debug(`Approving Session Proposal`);
    this.logger.trace({ type: "method", method: "approve", params });
    if (typeof params.response === "undefined") {
      const error = ERROR.MISSING_RESPONSE.format({ context: "session" });
      this.logger.error(error.message);
      throw new Error(error.message);
    }
    const state = params.response.state || SESSION_EMPTY_STATE;
    const metadata = params.response.metadata || this.metadata;
    if (typeof metadata === "undefined") {
      const error = ERROR.MISSING_OR_INVALID.format({ name: "app metadata" });
      this.logger.error(error.message);
      throw new Error(error.message);
    }
    const approved = params.proposal.proposer.controller !== this.controller;
    const reason = approved
      ? undefined
      : ERROR.UNAUTHORIZED_MATCHING_CONTROLLER.format({ controller: this.controller });
    const pending = await this.session.respond({
      approved,
      proposal: params.proposal,
      response: { state, metadata },
      reason,
    });
    if (!isSessionResponded(pending)) {
      const error = ERROR.NO_MATCHING_RESPONSE.format({ context: "session" });
      this.logger.error(error.message);
      throw new Error(error.message);
    }
    if (isSessionFailed(pending.outcome)) {
      this.logger.debug(`Session Proposal Approval Failure`);
      this.logger.trace({ type: "method", method: "approve", outcome: pending.outcome });
      throw new Error(pending.outcome.reason.message);
    }
    this.logger.debug(`Session Proposal Approval Success`);
    this.logger.trace({ type: "method", method: "approve", pending });
    return this.session.get(pending.outcome.topic);
  }

  public async reject(params: ClientTypes.RejectParams): Promise<void> {
    this.logger.debug(`Rejecting Session Proposal`);
    this.logger.trace({ type: "method", method: "reject", params });
    const pending = await this.session.respond({
      approved: false,
      proposal: params.proposal,
      response: SESSION_EMPTY_RESPONSE,
      reason: params.reason,
    });
    this.logger.debug(`Session Proposal Response Success`);
    this.logger.trace({ type: "method", method: "reject", pending });
  }

  public async upgrade(params: ClientTypes.UpgradeParams): Promise<void> {
    await this.session.upgrade(params);
  }

  public async update(params: ClientTypes.UpdateParams): Promise<void> {
    await this.session.update(params);
  }

  public async request(params: ClientTypes.RequestParams): Promise<any> {
    return this.session.request(params);
  }

  public async respond(params: ClientTypes.RespondParams): Promise<void> {
    await this.session.send(params.topic, params.response);
  }

  public async notify(params: ClientTypes.NotifyParams): Promise<void> {
    await this.session.notify(params);
  }

  public async disconnect(params: ClientTypes.DisconnectParams): Promise<void> {
    this.logger.debug(`Disconnecting Application`);
    this.logger.trace({ type: "method", method: "disconnect", params });
    await this.session.delete(params);
  }

  // ---------- Private ----------------------------------------------- //

  private async initialize(): Promise<any> {
    this.logger.trace(`Initialized`);
    try {
      await this.pairing.init();
      await this.session.init();
      await this.crypto.init();
      await this.relayer.init();
      this.setBeatInterval();
      this.registerEventListeners();
      this.logger.info(`Client Initilization Success`);
    } catch (e) {
      this.logger.info(`Client Initilization Failure`);
      this.logger.error(e);
      throw e;
    }
  }

  private setBeatInterval() {
    setInterval(() => this.events.emit(CLIENT_EVENTS.beat), CLIENT_BEAT_INTERVAL);
  }

  private registerEventListeners(): void {
    // share controller metadata to settled pairing
    this.events.on(PAIRING_EVENTS.settled, async (pairing: PairingTypes.Settled) => {
      if (pairing.permissions.controller.publicKey === pairing.self.publicKey) {
        await this.pairing.update({ topic: pairing.topic, state: { metadata: this.metadata } });
      }
    });
    // emit session proposal received from pairing request
    this.events.on(PAIRING_EVENTS.request, async (requestEvent: PairingTypes.RequestEvent) => {
      const { request } = requestEvent;
      if (request.method === SESSION_JSONRPC.propose) {
        const proposal = request.params as SessionTypes.Proposal;
        if (proposal.proposer.controller === this.controller) {
          const reason = ERROR.UNAUTHORIZED_MATCHING_CONTROLLER.format({
            controller: this.controller,
          });
          await this.session.respond({
            approved: false,
            proposal,
            response: SESSION_EMPTY_RESPONSE,
            reason,
          });
          return;
        }
        const eventName = CLIENT_EVENTS.session.proposal;
        this.logger.info(`Emitting ${eventName}`);
        this.logger.debug({ type: "event", event: eventName, data: proposal });
        this.events.emit(eventName, proposal);
      }
    });
  }
}

function formatPairingProposal(uri: string): PairingTypes.Proposal {
  const uriParams = parseUri(uri);
  return {
    topic: uriParams.topic,
    relay: uriParams.relay,
    proposer: { publicKey: uriParams.publicKey, controller: uriParams.controller },
    signal: { method: PAIRING_SIGNAL_METHOD_URI, params: { uri } },
    permissions: {
      jsonrpc: { methods: [SESSION_JSONRPC.propose] },
      notifications: { types: [] },
    },
    ttl: PAIRING_DEFAULT_TTL,
  };
}
