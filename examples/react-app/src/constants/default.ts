export const DEFAULT_MAIN_CHAINS = [
  // mainnets
  "eip155:1",
  "eip155:10",
  "eip155:100",
  "eip155:137",
];

export const DEFAULT_TEST_CHAINS = [
  // testnets
  "eip155:42",
  "eip155:69",
  "eip155:80001",
  "eip155:144545313136048",
];

export const DEFAULT_CHAINS = [...DEFAULT_MAIN_CHAINS, ...DEFAULT_TEST_CHAINS];

export const DEFAULT_RELAY_PROVIDER = "wss://relay.walletconnect.org";

export const DEFAULT_METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData"];

export const DEFAULT_LOGGER = "debug";

export const DEFAULT_APP_METADATA = {
  name: "React App",
  description: "React App for WalletConnect",
  url: "https://walletconnect.org/",
  icons: ["https://walletconnect.org/walletconnect-logo.png"],
};
