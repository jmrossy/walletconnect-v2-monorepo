import { IJsonRpcProvider } from "@json-rpc-tools/types";
import { KeyValueStorage } from "keyvaluestorage";

export interface ChainData {
  name: string;
  id: string;
  rpc: string[];
  slip44: number;
  testnet: boolean;
}

export interface ChainsMap {
  [reference: string]: ChainData;
}

export interface ChainJsonRpc {
  methods: {
    chain: string[];
    accounts: string[];
    request: string[];
    sign: string[];
    [scope: string]: string[];
  };
}

export interface WalletOptions {
  chains: string[];
  mnemonic?: string;
  storage?: KeyValueStorage;
}

export interface ProvidersMap {
  [namespace: string]: IJsonRpcProvider;
}

export interface NamespaceConfig {
  chains: ChainsMap;
  jsonrpc: ChainJsonRpc;
}

export type NamespaceMap = {
  [namespace: string]: NamespaceConfig;
};

export interface WalletConfig {
  mnemonic: string;
  providers: ProvidersMap;
  namespaces: NamespaceMap;
}
