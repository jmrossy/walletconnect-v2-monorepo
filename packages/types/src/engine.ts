import { JsonRpcPayload } from "@json-rpc-tools/types";

import { ISequence, SequenceTypes } from "./sequence";

export abstract class IEngine<
  Pending = SequenceTypes.Pending,
  Settled = SequenceTypes.Settled,
  Upgrade = SequenceTypes.Upgrade,
  Update = SequenceTypes.Update,
  CreateParams = SequenceTypes.CreateParams,
  RespondParams = SequenceTypes.RespondParams,
  RequestParams = SequenceTypes.RequestParams,
  UpgradeParams = SequenceTypes.UpgradeParams,
  UpdateParams = SequenceTypes.UpdateParams,
  DeleteParams = SequenceTypes.DeleteParams,
  ProposeParams = SequenceTypes.ProposeParams,
  SettleParams = SequenceTypes.SettleParams,
  NotifyParams = SequenceTypes.NotifyParams,
  Participant = SequenceTypes.Participant
> {
  constructor(public sequence: ISequence) {}

  public abstract ping(topic: string, timeout?: number): Promise<void>;
  public abstract send(topic: string, payload: JsonRpcPayload, chainId?: string): Promise<void>;
  public abstract create(params?: CreateParams): Promise<Settled>;
  public abstract respond(params: RespondParams): Promise<Pending>;
  public abstract upgrade(params: UpgradeParams): Promise<Settled>;
  public abstract update(params: UpdateParams): Promise<Settled>;
  public abstract request(params: RequestParams): Promise<any>;
  public abstract delete(params: DeleteParams): Promise<void>;
  public abstract notify(params: NotifyParams): Promise<void>;

  protected abstract propose(params?: ProposeParams): Promise<Pending>;
  protected abstract settle(params: SettleParams): Promise<Settled>;
  protected abstract onResponse(payloadEvent: SequenceTypes.PayloadEvent): Promise<void>;
  protected abstract onAcknowledge(payloadEvent: SequenceTypes.PayloadEvent): Promise<void>;
  protected abstract onMessage(payloadEvent: SequenceTypes.PayloadEvent): Promise<void>;
  protected abstract onPayload(payloadEvent: SequenceTypes.PayloadEvent): Promise<void>;
  protected abstract onUpdate(payloadEvent: SequenceTypes.PayloadEvent): Promise<void>;
  protected abstract onUpgrade(payloadEvent: SequenceTypes.PayloadEvent): Promise<void>;
  protected abstract onNotification(event: SequenceTypes.PayloadEvent): Promise<void>;

  protected abstract handleUpdate(
    topic: string,
    params: Update,
    participant: Participant,
  ): Promise<Update>;
  protected abstract handleUpgrade(
    topic: string,
    params: Upgrade,
    participant: Participant,
  ): Promise<Upgrade>;
}
