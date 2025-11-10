'use client';

import { useState } from 'react';
import WalletTracker from '@/components/WalletTracker';
import WalletNetwork from '@/components/WalletNetwork';
import { WalletInfo } from '@/lib/allora-api';

export default function Home() {
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);

  return (
    <main className="min-h-screen bg-black relative overflow-hidden">
      {/* Top bar with search */}
      <div className="absolute top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-b border-white/10">
        <div className="mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <h1 className="text-xl font-bold text-white">Search for</h1>
              <div className="flex-1 max-w-md">
                <WalletTracker
                  onWalletLoad={(info) => {
                    setWalletInfo(info);
                    setError(null);
                  }}
                  onError={(err) => {
                    setError(err);
                    setWalletInfo(null);
                  }}
                  loading={loading}
                  setLoading={setLoading}
                />
              </div>
            </div>
            {walletInfo && networkLoading && (
              <div className="flex items-center gap-2 text-white text-sm">
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Loading more data...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-50 bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Fullscreen graph */}
      <div className="absolute inset-0 pt-20">
        {walletInfo ? (
          <WalletNetwork
            targetAddress={walletInfo.address}
            transactions={walletInfo.transactions}
            transfers={walletInfo.transfers}
            walletInfo={walletInfo}
            onLoadingChange={setNetworkLoading}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-white/50 mb-2">
                Allora Network
              </h2>
              <p className="text-gray-500">
                Enter a wallet address to start tracking
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Copyright */}
      <div className="absolute bottom-4 left-4 z-50">
        <p className="text-gray-500 text-xs">
          Made by Mr Heo
        </p>
      </div>
    </main>
  );
}

