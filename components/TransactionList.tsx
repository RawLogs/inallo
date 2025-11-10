'use client';

import { Transaction, TransferEvent } from '@/lib/allora-api';
import { format } from 'date-fns';
import { decodeBase64, isBase64 } from '@/lib/utils';

interface TransactionListProps {
  transactions: Transaction[];
  transfers: TransferEvent[];
  walletAddress: string;
}

export default function TransactionList({
  transactions,
  transfers,
  walletAddress,
}: TransactionListProps) {
  const formatAmount = (amount: string, denom: string) => {
    const num = parseFloat(amount);
    if (denom === 'uallora' || denom.includes('uallora')) {
      return (num / 1e6).toFixed(4) + ' ALLORA';
    }
    return `${num} ${denom}`;
  };

  const getTransferType = (transfer: TransferEvent) => {
    if (transfer.from === walletAddress) {
      return { type: 'sent', label: 'Sent', color: 'text-red-400' };
    }
    return { type: 'received', label: 'Received', color: 'text-green-400' };
  };

  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
      <h2 className="text-2xl font-semibold text-white mb-6">
        Giao dịch & Chuyển khoản
      </h2>

      {transactions.length === 0 ? (
        <p className="text-gray-400 text-center py-8">Không tìm thấy giao dịch</p>
      ) : (
        <div className="space-y-4">
          {transactions.map((tx) => {
            // Find transfers that belong to this transaction
            // Match by checking if transfer addresses appear in transaction events
            const txTransfers = transfers.filter((transfer) => {
              return tx.events?.some((event) => {
                if (event.type === 'transfer' || event.type === 'coin_spent' || event.type === 'coin_received') {
                  return event.attributes?.some((attr: any) => {
                    let value = typeof attr.value === 'string' ? attr.value : String(attr.value || '');
                    // Try to decode base64 if it looks like base64
                    if (isBase64(value)) {
                      value = decodeBase64(value);
                    }
                    return value === transfer.from || value === transfer.to;
                  });
                }
                return false;
              });
            });

            return (
              <div
                key={tx.txhash}
                className="bg-white/5 border border-white/10 rounded-lg p-4 hover:bg-white/10 transition-colors"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-400">
                        {format(new Date(tx.timestamp), 'MMM dd, yyyy HH:mm:ss')}
                      </span>
                      <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 rounded">
                        Success
                      </span>
                    </div>
                    <a
                      href={`https://staging.explorer.allora.network/explorer/transactions/${tx.txhash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary-400 hover:text-primary-300 font-mono break-all underline"
                    >
                      {tx.txhash}
                    </a>
                    <div className="mt-2 text-xs text-gray-400">
                      Gas: {tx.gas_used} / {tx.gas_wanted}
                    </div>
                  </div>

                  {txTransfers.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {txTransfers.map((transfer, idx) => {
                        const transferInfo = getTransferType(transfer);
                        return (
                          <div
                            key={idx}
                            className="bg-white/5 rounded p-3 min-w-[200px]"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span
                                className={`text-sm font-semibold ${transferInfo.color}`}
                              >
                                {transferInfo.label}
                              </span>
                              <span className="text-white text-sm font-semibold">
                                {formatAmount(transfer.amount, transfer.denom)}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 space-y-1">
                              <div>
                                <span className="text-gray-500">From: </span>
                                <span className="font-mono">
                                  {transfer.from.slice(0, 10)}...
                                  {transfer.from.slice(-8)}
                                </span>
                              </div>
                              <div>
                                <span className="text-gray-500">To: </span>
                                <span className="font-mono">
                                  {transfer.to.slice(0, 10)}...
                                  {transfer.to.slice(-8)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

