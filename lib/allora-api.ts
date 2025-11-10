import axios from 'axios';
import { decodeBase64, isBase64 } from './utils';

const API_BASE = 'https://api.mainnet.allora.network';
const RPC_BASE = 'https://allora-rpc.mainnet.allora.network';

export interface Transaction {
  height: string;
  txhash: string;
  codespace: string;
  code: number;
  data: string;
  raw_log: string;
  logs: any[];
  info: string;
  gas_wanted: string;
  gas_used: string;
  tx: {
    '@type': string;
    body: {
      messages: any[];
      memo: string;
      timeout_height: string;
      extension_options: any[];
      non_critical_extension_options: any[];
    };
    auth_info: {
      signer_infos: any[];
      fee: any;
      tip: any;
    };
    signatures: string[];
  };
  timestamp: string;
  events: Event[];
}

export interface Event {
  type: string;
  attributes: Array<{
    key: string;
    value: string;
  }>;
}

export interface TransferEvent {
  from: string;
  to: string;
  amount: string;
  denom: string;
}

export interface WalletInfo {
  address: string;
  balance: string;
  transactions: Transaction[];
  transfers: TransferEvent[];
}

export class AlloraAPI {
  private apiBase: string;
  private rpcBase: string;
  private txDetailCache: Map<string, { data: any; timestamp: number }> = new Map();
  private balanceCache: Map<string, { data: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.apiBase = API_BASE;
    this.rpcBase = RPC_BASE;
  }

  private getCachedTxDetail(txHash: string): any | null {
    const cached = this.txDetailCache.get(txHash);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedTxDetail(txHash: string, data: any) {
    this.txDetailCache.set(txHash, { data, timestamp: Date.now() });
  }

  private getCachedBalance(address: string): string | null {
    const cached = this.balanceCache.get(address);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedBalance(address: string, balance: string) {
    this.balanceCache.set(address, { data: balance, timestamp: Date.now() });
  }

  /**
   * Get transaction by hash using REST API
   */
  async getTransaction(txHash: string): Promise<Transaction> {
    try {
      // Remove 0x prefix if present
      const cleanHash = txHash.startsWith('0x') ? txHash.slice(2) : txHash;
      
      // Use REST API first
      const response = await axios.get(
        `${this.apiBase}/cosmos/tx/v1beta1/txs/${cleanHash}`
      );
      const tx = response.data.tx_response || response.data;
      
      return {
        height: tx.height || '0',
        txhash: tx.txhash || cleanHash,
        codespace: tx.codespace || '',
        code: tx.code || 0,
        data: tx.data || '',
        raw_log: tx.raw_log || '',
        logs: tx.logs || [],
        info: tx.info || '',
        gas_wanted: tx.gas_wanted || '0',
        gas_used: tx.gas_used || '0',
        tx: tx.tx || {
          '@type': '/cosmos.tx.v1beta1.Tx',
          body: { messages: [], memo: '', timeout_height: '0', extension_options: [], non_critical_extension_options: [] },
          auth_info: { signer_infos: [], fee: {}, tip: null },
          signatures: [],
        },
        timestamp: tx.timestamp || new Date().toISOString(),
        events: tx.events || [],
      };
    } catch (error: any) {
      // Try RPC as fallback
      try {
        const cleanHash = txHash.startsWith('0x') ? txHash.slice(2) : txHash;
        const response = await axios.get(`${this.rpcBase}/tx`, {
          params: {
            hash: cleanHash,
            prove: false,
          },
        });
        return response.data.result || response.data;
      } catch (fallbackError: any) {
        throw new Error(`Failed to fetch transaction: ${error.message || fallbackError.message}`);
      }
    }
  }

  /**
   * Search transactions for an address using RPC endpoint
   * REST API doesn't support events query properly, so we use RPC /tx_search
   */
  async getTransactionsByAddress(
    address: string,
    page: number = 1,
    perPage: number = 100
  ): Promise<{ txs: Transaction[]; total_count: number }> {
    try {
      // Use RPC endpoint /tx_search with proper query format
      // Format: query="message.sender='address'"
      let allTxs: any[] = [];
      const seenHashes = new Set<string>();

      // Query 1: message.sender
      try {
        const query1 = `"message.sender='${address}'"`;
        const response1 = await axios.get(`${this.rpcBase}/tx_search`, {
          params: {
            query: query1,
            prove: true,
            page: page.toString(),
            per_page: perPage.toString(),
            order_by: '"desc"',
          },
        });
        const txs1 = response1.data.result?.txs || [];
        // Get detailed transaction info for each hash in parallel with timeout and retry
        const detailPromises = txs1
          .filter((txItem: any) => {
            const txHash = txItem.hash || txItem.txhash;
            return txHash && !seenHashes.has(txHash);
          })
          .map(async (txItem: any) => {
            const txHash = txItem.hash || txItem.txhash;
            seenHashes.add(txHash);
            
            // Check cache first
            const cached = this.getCachedTxDetail(txHash);
            if (cached) {
              return cached;
            }

            // Retry logic with timeout
            const getTxDetail = async (retries = 3): Promise<any> => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
                
                try {
                  const detailResponse = await axios.get(
                    `${this.apiBase}/cosmos/tx/v1beta1/txs/${txHash}`,
                    { signal: controller.signal, timeout: 10000 }
                  );
                  clearTimeout(timeoutId);
                  const txResponse = detailResponse.data.tx_response;
                  // Cache the result
                  if (txResponse) {
                    this.setCachedTxDetail(txHash, txResponse);
                  }
                  return txResponse;
                } catch (err: any) {
                  clearTimeout(timeoutId);
                  if (err.code === 'ECONNABORTED' || err.name === 'AbortError') {
                    throw new Error('Timeout');
                  }
                  throw err;
                }
              } catch (err: any) {
                if (retries > 0 && (err.message === 'Timeout' || err.response?.status >= 500)) {
                  // Wait before retry (exponential backoff)
                  await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
                  return getTxDetail(retries - 1);
                }
                throw err;
              }
            };
            
            try {
              const detailedTx = await getTxDetail();
              if (detailedTx) {
                return detailedTx;
              } else {
                return this.convertRpcTxToTransaction(txItem);
              }
            } catch (err) {
              // Fallback to RPC format
              return this.convertRpcTxToTransaction(txItem);
            }
          });
        
        const detailedTxs1 = await Promise.all(detailPromises);
        allTxs.push(...detailedTxs1);
      } catch (err: any) {
        console.warn('Error fetching message.sender transactions:', err.response?.data || err.message);
      }

      // Query 2: transfer.recipient
      try {
        const query2 = `"transfer.recipient='${address}'"`;
        const response2 = await axios.get(`${this.rpcBase}/tx_search`, {
          params: {
            query: query2,
            prove: true,
            page: '1',
            per_page: perPage.toString(),
            order_by: '"desc"',
          },
        });
        const txs2 = response2.data.result?.txs || [];
        const detailPromises2 = txs2
          .filter((txItem: any) => {
            const txHash = txItem.hash || txItem.txhash;
            return txHash && !seenHashes.has(txHash);
          })
          .map(async (txItem: any) => {
            const txHash = txItem.hash || txItem.txhash;
            seenHashes.add(txHash);
            
            // Check cache first
            const cached = this.getCachedTxDetail(txHash);
            if (cached) {
              return cached;
            }

            const getTxDetail = async (retries = 3): Promise<any> => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                
                try {
                  const detailResponse = await axios.get(
                    `${this.apiBase}/cosmos/tx/v1beta1/txs/${txHash}`,
                    { signal: controller.signal, timeout: 10000 }
                  );
                  clearTimeout(timeoutId);
                  const txResponse = detailResponse.data.tx_response;
                  if (txResponse) {
                    this.setCachedTxDetail(txHash, txResponse);
                  }
                  return txResponse;
                } catch (err: any) {
                  clearTimeout(timeoutId);
                  if (err.code === 'ECONNABORTED' || err.name === 'AbortError') {
                    throw new Error('Timeout');
                  }
                  throw err;
                }
              } catch (err: any) {
                if (retries > 0 && (err.message === 'Timeout' || err.response?.status >= 500)) {
                  await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
                  return getTxDetail(retries - 1);
                }
                throw err;
              }
            };
            
            try {
              const detailedTx = await getTxDetail();
              return detailedTx || this.convertRpcTxToTransaction(txItem);
            } catch (err) {
              return this.convertRpcTxToTransaction(txItem);
            }
          });
        
        const detailedTxs2 = await Promise.all(detailPromises2);
        allTxs.push(...detailedTxs2);
      } catch (err: any) {
        console.warn('Error fetching transfer.recipient transactions:', err.response?.data || err.message);
      }

      // Query 3: transfer.sender
      try {
        const query3 = `"transfer.sender='${address}'"`;
        const response3 = await axios.get(`${this.rpcBase}/tx_search`, {
          params: {
            query: query3,
            prove: true,
            page: '1',
            per_page: perPage.toString(),
            order_by: '"desc"',
          },
        });
        const txs3 = response3.data.result?.txs || [];
        const detailPromises3 = txs3
          .filter((txItem: any) => {
            const txHash = txItem.hash || txItem.txhash;
            return txHash && !seenHashes.has(txHash);
          })
          .map(async (txItem: any) => {
            const txHash = txItem.hash || txItem.txhash;
            seenHashes.add(txHash);
            
            // Check cache first
            const cached = this.getCachedTxDetail(txHash);
            if (cached) {
              return cached;
            }

            const getTxDetail = async (retries = 3): Promise<any> => {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                
                try {
                  const detailResponse = await axios.get(
                    `${this.apiBase}/cosmos/tx/v1beta1/txs/${txHash}`,
                    { signal: controller.signal, timeout: 10000 }
                  );
                  clearTimeout(timeoutId);
                  const txResponse = detailResponse.data.tx_response;
                  if (txResponse) {
                    this.setCachedTxDetail(txHash, txResponse);
                  }
                  return txResponse;
                } catch (err: any) {
                  clearTimeout(timeoutId);
                  if (err.code === 'ECONNABORTED' || err.name === 'AbortError') {
                    throw new Error('Timeout');
                  }
                  throw err;
                }
              } catch (err: any) {
                if (retries > 0 && (err.message === 'Timeout' || err.response?.status >= 500)) {
                  await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
                  return getTxDetail(retries - 1);
                }
                throw err;
              }
            };
            
            try {
              const detailedTx = await getTxDetail();
              return detailedTx || this.convertRpcTxToTransaction(txItem);
            } catch (err) {
              return this.convertRpcTxToTransaction(txItem);
            }
          });
        
        const detailedTxs3 = await Promise.all(detailPromises3);
        allTxs.push(...detailedTxs3);
      } catch (err: any) {
        console.warn('Error fetching transfer.sender transactions:', err.response?.data || err.message);
      }

      // Sort by height (descending)
      allTxs.sort((a, b) => {
        const heightA = parseInt(a.height || '0');
        const heightB = parseInt(b.height || '0');
        return heightB - heightA;
      });

      // Apply pagination
      const startIndex = (page - 1) * perPage;
      const paginatedTxs = allTxs.slice(startIndex, startIndex + perPage);

      return {
        txs: paginatedTxs.map((tx: any) => this.normalizeTransaction(tx)),
        total_count: allTxs.length,
      };
    } catch (error: any) {
      console.error('Error fetching transactions:', error.response?.data || error.message);
      throw new Error(`Failed to fetch transactions: ${error.response?.data?.message || error.message || 'Unknown error'}`);
    }
  }

  /**
   * Convert RPC transaction format to Transaction format
   */
  private convertRpcTxToTransaction(rpcTx: any): any {
    const txResult = rpcTx.tx_result || {};
    return {
      height: rpcTx.height || '0',
      txhash: rpcTx.hash || '',
      codespace: txResult.codespace || '',
      code: txResult.code || 0,
      data: txResult.data || '',
      raw_log: txResult.log || '',
      logs: txResult.logs || [],
      info: txResult.info || '',
      gas_wanted: txResult.gas_wanted || '0',
      gas_used: txResult.gas_used || '0',
      tx: rpcTx.tx ? { '@type': '/cosmos.tx.v1beta1.Tx', ...rpcTx.tx } : {
        '@type': '/cosmos.tx.v1beta1.Tx',
        body: { messages: [], memo: '', timeout_height: '0', extension_options: [], non_critical_extension_options: [] },
        auth_info: { signer_infos: [], fee: {}, tip: null },
        signatures: [],
      },
      timestamp: rpcTx.timestamp || new Date().toISOString(),
      events: txResult.events || [],
    };
  }

  /**
   * Normalize transaction to standard format
   */
  private normalizeTransaction(tx: any): Transaction {
    return {
      height: tx.height || '0',
      txhash: tx.txhash || tx.hash || '',
      codespace: tx.codespace || '',
      code: tx.code || 0,
      data: tx.data || '',
      raw_log: tx.raw_log || tx.log || '',
      logs: tx.logs || [],
      info: tx.info || '',
      gas_wanted: tx.gas_wanted || '0',
      gas_used: tx.gas_used || '0',
      tx: tx.tx || {
        '@type': '/cosmos.tx.v1beta1.Tx',
        body: { messages: [], memo: '', timeout_height: '0', extension_options: [], non_critical_extension_options: [] },
        auth_info: { signer_infos: [], fee: {}, tip: null },
        signatures: [],
      },
      timestamp: tx.timestamp || new Date().toISOString(),
      events: tx.events || [],
    };
  }

  /**
   * Get account balance from API
   * API: https://api.mainnet.allora.network/cosmos/bank/v1beta1/balances/{address}
   */
  async getBalance(address: string): Promise<string> {
    // Check cache first
    const cached = this.getCachedBalance(address);
    if (cached !== null) {
      return cached;
    }

    try {
      const response = await axios.get(`${this.apiBase}/cosmos/bank/v1beta1/balances/${address}`);
      const balances = response.data.balances || [];
      // Find uallo balance
      const alloraBalance = balances.find((b: any) => b.denom === 'uallo' || b.denom === 'uallora');
      
      let balance = '0';
      if (alloraBalance && alloraBalance.amount) {
        // Convert uallo to ALLO (divide by 1e18)
        // 100000000000000000000000 uallo = 100,000 ALLO
        // So 1 ALLO = 1e18 uallo
        const amountStr = alloraBalance.amount.toString();
        // For very large numbers, use BigInt for precision
        if (amountStr.length > 18) {
          const bigAmount = BigInt(amountStr);
          const divisor = BigInt(1e18);
          const result = bigAmount / divisor;
          const remainder = bigAmount % divisor;
          // Add decimal part
          const decimalPart = Number(remainder) / 1e18;
          balance = (Number(result) + decimalPart).toString();
        } else {
          const amount = parseFloat(amountStr);
          const alloAmount = amount / 1e18;
          balance = alloAmount.toString();
        }
      }
      
      // Cache the result
      this.setCachedBalance(address, balance);
      return balance;
    } catch (error: any) {
      console.error('Error fetching balance:', error.response?.data || error.message);
      return '0';
    }
  }

  /**
   * Parse transfer events from transaction
   */
  parseTransferEvents(tx: Transaction): TransferEvent[] {
    const transfers: TransferEvent[] = [];
    
    // Group transfer events by combining coin_spent and coin_received
    tx.events?.forEach((event) => {
      if (event.type === 'transfer') {
        const attributes: Record<string, string> = {};
        event.attributes?.forEach((attr) => {
          try {
            // Try base64 decode first if it looks like base64
            const key = typeof attr.key === 'string' && isBase64(attr.key)
              ? decodeBase64(attr.key)
              : (typeof attr.key === 'string' ? attr.key : String(attr.key));
            const value = attr.value && typeof attr.value === 'string' && attr.value.length > 0
              ? (isBase64(attr.value) ? decodeBase64(attr.value) : attr.value)
              : String(attr.value || '');
            attributes[key] = value;
          } catch {
            // If decode fails, use raw value
            attributes[String(attr.key)] = String(attr.value || '');
          }
        });

        const sender = attributes.sender || attributes['transfer.sender'] || '';
        const recipient = attributes.recipient || attributes['transfer.recipient'] || attributes.receiver || '';
        const amount = attributes.amount || attributes['transfer.amount'] || '0';
        
        if (sender && recipient) {
          // Parse amount (format: "123456uallo" or "123456")
          const amountMatch = amount.match(/(\d+)(\w*)/);
          const amountValue = amountMatch ? amountMatch[1] : amount;
          const denom = amountMatch && amountMatch[2] ? amountMatch[2] : 'uallo';
          
          transfers.push({
            from: sender,
            to: recipient,
            amount: amountValue,
            denom: denom === 'uallo' || denom === 'uallora' ? 'allo' : denom,
          });
        }
      }
    });

    // Also check coin_spent and coin_received events
    const spentEvents: Array<{ address: string; amount: string; denom: string }> = [];
    const receivedEvents: Array<{ address: string; amount: string; denom: string }> = [];

    tx.events?.forEach((event) => {
      if (event.type === 'coin_spent' || event.type === 'coin_received') {
        const attributes: Record<string, string> = {};
        event.attributes?.forEach((attr) => {
          try {
            const key = typeof attr.key === 'string' 
              ? (isBase64(attr.key) ? decodeBase64(attr.key) : attr.key)
              : String(attr.key);
            const value = typeof attr.value === 'string' && attr.value.length > 0
              ? (isBase64(attr.value) ? decodeBase64(attr.value) : attr.value)
              : String(attr.value || '');
            attributes[key] = value;
          } catch {
            attributes[String(attr.key)] = String(attr.value || '');
          }
        });

        const address = attributes.spender || attributes.receiver || '';
        const amountStr = attributes.amount || '0';
        const amountMatch = amountStr.match(/(\d+)(\w*)/);
        const amountValue = amountMatch ? amountMatch[1] : amountStr;
        const denom = amountMatch && amountMatch[2] ? amountMatch[2] : 'uallo';

        if (address && amountValue !== '0') {
          if (event.type === 'coin_spent') {
            spentEvents.push({ address, amount: amountValue, denom });
          } else {
            receivedEvents.push({ address, amount: amountValue, denom });
          }
        }
      }
    });

    // Match spent and received events
    spentEvents.forEach((spent) => {
      const matchingReceived = receivedEvents.find(
        (rec) => rec.amount === spent.amount && rec.denom === spent.denom
      );
        if (matchingReceived && spent.address !== matchingReceived.address) {
          transfers.push({
            from: spent.address,
            to: matchingReceived.address,
            amount: spent.amount,
            denom: spent.denom === 'uallo' || spent.denom === 'uallora' ? 'allo' : spent.denom,
          });
        }
    });

    // Remove duplicates
    const uniqueTransfers = Array.from(
      new Map(transfers.map((t) => [`${t.from}-${t.to}-${t.amount}`, t])).values()
    );

    return uniqueTransfers;
  }

  /**
   * Get wallet info with all transactions and transfers
   * Limit transactions to avoid too many detail requests
   */
  async getWalletInfo(address: string, limitTxs: number = 50): Promise<WalletInfo> {
    const [balance, txData] = await Promise.all([
      this.getBalance(address),
      this.getTransactionsByAddress(address, 1, limitTxs), // Limit transactions
    ]);

    const transfers: TransferEvent[] = [];
    // Only process limited transactions to reduce API calls
    txData.txs.slice(0, limitTxs).forEach((tx) => {
      // First, try to get addresses from tx.body.messages (more reliable)
      const messages = tx.tx?.body?.messages || [];
      messages.forEach((msg: any) => {
        if (msg['@type'] === '/cosmos.bank.v1beta1.MsgSend') {
          const fromAddress = msg.from_address;
          const toAddress = msg.to_address;
          const amountObj = msg.amount?.[0] || {};
          const amount = amountObj.amount || '0';
          const denom = amountObj.denom || 'uallo';
          
          if (fromAddress && toAddress) {
            transfers.push({
              from: fromAddress,
              to: toAddress,
              amount: amount,
              denom: denom === 'uallo' || denom === 'uallora' ? 'allo' : denom,
            });
          }
        }
      });
      
      // Also parse from events as fallback (only if no messages found)
      if (messages.length === 0) {
        const txTransfers = this.parseTransferEvents(tx);
        txTransfers.forEach((transfer) => {
          // Only add if not already added from messages
          const exists = transfers.some(
            t => t.from === transfer.from && t.to === transfer.to && t.amount === transfer.amount
          );
          if (!exists) {
            transfers.push(transfer);
          }
        });
      }
    });

    return {
      address,
      balance,
      transactions: txData.txs.slice(0, limitTxs),
      transfers,
    };
  }

  /**
   * Build sybil network - find all wallets connected to the target wallet
   * Uses Promise.all for parallel loading
   */
  async buildSybilNetwork(
    targetAddress: string,
    maxDepth: number = 2,
    onProgress?: (network: Map<string, Set<string>>, address: string) => void
  ): Promise<Map<string, Set<string>>> {
    const network = new Map<string, Set<string>>();
    const visited = new Set<string>();
    const processing = new Set<string>();

    const processAddress = async (address: string, depth: number): Promise<void> => {
      if (visited.has(address) || depth > maxDepth || processing.has(address)) {
        return;
      }
      
      processing.add(address);
      visited.add(address);

      try {
        // Limit transactions to reduce API calls
        const walletInfo = await this.getWalletInfo(address, 30); // Only get 30 transactions per address
        
        if (!network.has(address)) {
          network.set(address, new Set());
        }

        // Limit connections to avoid too many requests
        const maxConnections = 20;
        let connectionCount = 0;
        
        walletInfo.transfers.forEach((transfer) => {
          if (connectionCount >= maxConnections) return;
          
          // Only use valid Allora addresses
          const isValidAddress = (addr: string) => {
            return addr && typeof addr === 'string' && /^allo1[a-z0-9]+$/i.test(addr);
          };
          
          if (transfer.from === address && isValidAddress(transfer.to)) {
            if (!network.get(address)!.has(transfer.to)) {
              network.get(address)!.add(transfer.to);
              connectionCount++;
            }
          } else if (transfer.to === address && isValidAddress(transfer.from)) {
            if (!network.get(address)!.has(transfer.from)) {
              network.get(address)!.add(transfer.from);
              connectionCount++;
            }
          }
        });

        // Notify progress
        if (onProgress) {
          onProgress(new Map(network), address);
        }

        // Process connected addresses in parallel
        if (depth < maxDepth) {
          const connectedAddresses = Array.from(network.get(address) || [])
            .filter(addr => !visited.has(addr) && !processing.has(addr));
          
          // Load all connected addresses in parallel
          await Promise.all(
            connectedAddresses.map(addr => processAddress(addr, depth + 1))
          );
        }
      } catch (error) {
        console.error(`Error processing address ${address}:`, error);
      } finally {
        processing.delete(address);
      }
    };

    // Start processing from target address
    await processAddress(targetAddress, 0);

    return network;
  }
}

export const alloraAPI = new AlloraAPI();

