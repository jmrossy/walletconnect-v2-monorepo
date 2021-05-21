import { SIX_HOURS, THIRTY_DAYS } from "./time";

export const RELAYER_DEFAULT_PUBLISH_TTL = SIX_HOURS;

export const RELAYER_DEFAULT_SUBSCRIBE_TTL = THIRTY_DAYS;

export const RELAYER_DEFAULT_PROTOCOL = "waku";

export const RELAYER_DEFAULT_RPC_URL = "wss://relay.walletconnect.org";

export const RELAYER_CONTEXT = "relayer";

export const RELAYER_EVENTS = {
  connect: "relayer_connect",
  payload: "relayer_payload",
  disconnect: "relayer_disconnect",
  error: "relayer_error",
};
