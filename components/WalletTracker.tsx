'use client';

import { useState } from 'react';
import { alloraAPI, WalletInfo } from '@/lib/allora-api';

interface WalletTrackerProps {
  onWalletLoad: (info: WalletInfo) => void;
  onError: (error: string) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

export default function WalletTracker({
  onWalletLoad,
  onError,
  loading,
  setLoading,
}: WalletTrackerProps) {
  const [address, setAddress] = useState('');

  const handleSearch = async () => {
    if (!address.trim()) {
      onError('Please enter a wallet address');
      return;
    }

    setLoading(true);
    try {
      const walletInfo = await alloraAPI.getWalletInfo(address.trim());
      onWalletLoad(walletInfo);
    } catch (error: any) {
      onError(error.message || 'Failed to fetch wallet information');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Add an entity, address, or token"
          className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          disabled={loading}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="info px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-sm whitespace-nowrap"
        >
          {loading ? 'Loading...' : 'Track'}
        </button>
      </div>
    </div>
  );
}

