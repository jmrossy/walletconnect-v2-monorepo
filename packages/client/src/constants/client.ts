import { HISTORY_EVENTS } from "./history";
import { PAIRING_EVENTS } from "./pairing";
import { RELAYER_EVENTS } from "./relayer";
import { SESSION_EVENTS } from "./session";
import { SUBSCRIPTION_EVENTS } from "./subscription";
import { FIVE_SECONDS } from "./time";

export const CLIENT_CONTEXT = "client";

export const CLIENT_BEAT_INTERVAL = FIVE_SECONDS * 1000;

export const CLIENT_EVENTS = {
  beat: "client_beat",
  session: SESSION_EVENTS,
  pairing: PAIRING_EVENTS,
  history: HISTORY_EVENTS,
  relayer: RELAYER_EVENTS,
  subscription: SUBSCRIPTION_EVENTS,
};

export const CLIENT_STORAGE_OPTIONS = {
  database: ":memory:",
};
