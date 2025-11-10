'use client';

import { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { alloraAPI } from '@/lib/allora-api';

import { Transaction, TransferEvent, WalletInfo } from '@/lib/allora-api';

interface WalletNetworkProps {
  targetAddress: string;
  transactions: Transaction[];
  transfers: TransferEvent[];
  walletInfo?: WalletInfo;
  onLoadingChange?: (loading: boolean) => void;
}

interface AddressInfo {
  address: string;
  balance: number;
  isTarget: boolean;
}

export default function WalletNetwork({ targetAddress, transactions, transfers, walletInfo, onLoadingChange }: WalletNetworkProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [network, setNetwork] = useState<Map<string, Set<string>>>(new Map());
  const [addressBalances, setAddressBalances] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDepth, setMaxDepth] = useState(1);
  const [loadedAddresses, setLoadedAddresses] = useState<Set<string>>(new Set([targetAddress]));

  const buildNetwork = async () => {
    setLoading(true);
    if (onLoadingChange) onLoadingChange(true);
    setError(null);
    setLoadedAddresses(new Set([targetAddress]));
    
    try {
      // Use buildSybilNetwork with progress callback for lazy loading
      const networkMap = await alloraAPI.buildSybilNetwork(
        targetAddress,
        maxDepth,
        async (currentNetwork, loadedAddress) => {
          // Update network immediately as addresses are loaded (lazy load)
          setNetwork(new Map(currentNetwork));
          setLoadedAddresses(prev => new Set([...prev, loadedAddress]));
          
          // Load balance for this address
          try {
            const balance = await alloraAPI.getBalance(loadedAddress);
            setAddressBalances(prev => {
              const newMap = new Map(prev);
              newMap.set(loadedAddress, parseFloat(balance));
              return newMap;
            });
          } catch (err) {
            console.warn(`Error loading balance for ${loadedAddress}:`, err);
          }
        }
      );
      
      setNetwork(networkMap);
      
      // Load balances for unique addresses only (avoid duplicates)
      const allAddresses = new Set<string>([targetAddress]);
      networkMap.forEach((connections, address) => {
        allAddresses.add(address);
        connections.forEach(conn => allAddresses.add(conn));
      });
      
      // Also get addresses from transfers (limit to avoid too many requests)
      const transferAddresses = new Set<string>();
      transfers.slice(0, 100).forEach(transfer => { // Limit to first 100 transfers
        transferAddresses.add(transfer.from);
        transferAddresses.add(transfer.to);
      });
      transferAddresses.forEach(addr => allAddresses.add(addr));
      
      // Limit total addresses to avoid too many requests
      const addressesToLoad = Array.from(allAddresses).slice(0, 50); // Max 50 addresses
      
      // Load all balances in parallel with batching
      const batchSize = 10;
      const balanceMap = new Map<string, number>();
      
      for (let i = 0; i < addressesToLoad.length; i += batchSize) {
        const batch = addressesToLoad.slice(i, i + batchSize);
        const balancePromises = batch.map(async (address) => {
          try {
            const balance = await alloraAPI.getBalance(address);
            return { address, balance: parseFloat(balance) };
          } catch (err) {
            console.warn(`Error loading balance for ${address}:`, err);
            return { address, balance: 0 };
          }
        });
        
        const balances = await Promise.all(balancePromises);
        balances.forEach(({ address, balance }) => {
          balanceMap.set(address, balance);
        });
        
        // Update state progressively
        setAddressBalances(new Map(balanceMap));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to build network');
    } finally {
      setLoading(false);
      if (onLoadingChange) onLoadingChange(false);
    }
  };

  useEffect(() => {
    if (targetAddress) {
      buildNetwork();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAddress, maxDepth]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (svgRef.current) {
        const width = window.innerWidth * 0.7;
        const height = window.innerHeight;
        d3.select(svgRef.current)
          .attr('width', width)
          .attr('height', height)
          .attr('viewBox', `0 0 ${width} ${height}`);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    // Build network from transfers if available
    const transferNetwork = new Map<string, Set<string>>();
    const transferAmounts = new Map<string, number>(); // key: "from-to", value: total amount

    // Validate and filter addresses
    const isValidAddress = (addr: string) => {
      return addr && typeof addr === 'string' && /^allo1[a-z0-9]+$/i.test(addr);
    };

    transfers.forEach((transfer) => {
      // Only process valid Allora addresses
      if (!isValidAddress(transfer.from) || !isValidAddress(transfer.to)) {
        return;
      }
      
      if (!transferNetwork.has(transfer.from)) {
        transferNetwork.set(transfer.from, new Set());
      }
      if (!transferNetwork.has(transfer.to)) {
        transferNetwork.set(transfer.to, new Set());
      }
      transferNetwork.get(transfer.from)!.add(transfer.to);
      
      // Calculate total amount between addresses
      // Amount is in base units (uallo), convert to ALLO (divide by 1e18)
      // 100000000000000000000000 uallo = 100,000 ALLO
      // So 1 ALLO = 1e18 uallo
      const amount = parseFloat(transfer.amount) / 1e18;
      const key = `${transfer.from}-${transfer.to}`;
      transferAmounts.set(key, (transferAmounts.get(key) || 0) + amount);
    });

    // Merge with network from API
    const finalNetwork = new Map(network);
    transferNetwork.forEach((connections, address) => {
      if (!finalNetwork.has(address)) {
        finalNetwork.set(address, new Set());
      }
      connections.forEach((conn) => {
        finalNetwork.get(address)!.add(conn);
      });
    });

    if (finalNetwork.size === 0 && transferNetwork.size === 0) return;

    // Clear previous visualization
    d3.select(svgRef.current).selectAll('*').remove();

    // Prepare data for D3
    const nodes: Array<{ id: string; isTarget: boolean; balance: number }> = [];
    const links: Array<{ source: string; target: string; amount: number }> = [];
    const nodeMap = new Map<string, number>();

    // Collect all addresses
    const allAddresses = new Set<string>();
    finalNetwork.forEach((connections, address) => {
      allAddresses.add(address);
      connections.forEach(conn => allAddresses.add(conn));
    });
    transferNetwork.forEach((connections, address) => {
      allAddresses.add(address);
      connections.forEach(conn => allAddresses.add(conn));
    });

    // Add nodes with balance (hide connected wallets with balance = 0)
    allAddresses.forEach((address) => {
      if (!nodeMap.has(address)) {
        const balance = addressBalances.get(address) || 0;
        // Always show target address, but hide connected wallets with balance = 0
        if (address === targetAddress || balance > 0) {
          nodeMap.set(address, nodes.length);
          nodes.push({
            id: address,
            isTarget: address === targetAddress,
            balance: balance,
          });
        }
      }
    });

    // Add links from network
      finalNetwork.forEach((connections, address) => {
        connections.forEach((conn) => {
          // Only create links if both nodes exist (not filtered out)
          const sourceIndex = nodeMap.get(address);
          const targetIndex = nodeMap.get(conn);
          if (sourceIndex !== undefined && targetIndex !== undefined) {
            const linkKey = `${address}-${conn}`;
            const amount = transferAmounts.get(linkKey) || 0;
            links.push({
              source: address,
              target: conn,
              amount: amount,
            });
          }
        });
      });

    if (nodes.length === 0) return;

    // Set up SVG dimensions - 70% of window width
    const width = window.innerWidth * 0.7;
    const height = window.innerHeight;
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'none');

    // Create simulation with boundary constraints
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30));

    // Create links with width based on amount
    const maxAmount = Math.max(...links.map(l => l.amount), 1);
    const link = svg.append('g')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#4a5568')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => Math.max(1, (d.amount / maxAmount) * 5));

    // Create nodes with size based on balance
    const maxBalance = Math.max(...nodes.map(n => n.balance), 1);
    const node = svg.append('g')
      .selectAll('circle')
      .data(nodes)
      .enter()
      .append('circle')
      .attr('r', (d) => {
        const baseRadius = d.isTarget ? 15 : 10;
        const balanceRadius = d.balance > 0 ? Math.sqrt(d.balance / maxBalance) * 10 : 0;
        return baseRadius + balanceRadius;
      })
      .attr('fill', (d) => d.isTarget ? '#0ea5e9' : '#10b981')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .call(drag(simulation));

    // Add labels with proper address formatting
    const formatAddress = (address: string) => {
      // Ensure address is valid string and not corrupted
      if (!address || typeof address !== 'string') return 'Invalid';
      
      // Extract valid Allora address pattern (allo1 followed by alphanumeric)
      const addressMatch = address.match(/allo1[a-z0-9]+/i);
      if (addressMatch) {
        const cleanAddress = addressMatch[0];
        if (cleanAddress.length < 10) return cleanAddress;
        return `${cleanAddress.slice(0, 8)}...${cleanAddress.slice(-6)}`;
      }
      
      // Fallback: remove invalid characters
      const cleanAddress = address.replace(/[^a-z0-9]/gi, '');
      if (cleanAddress.length < 10) return cleanAddress;
      return `${cleanAddress.slice(0, 8)}...${cleanAddress.slice(-6)}`;
    };

    // Add labels
    const labelGroup = svg.append('g')
      .selectAll('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('transform', (d: any) => `translate(${d.x || 0}, ${d.y || 0})`);

    // Add text label
    labelGroup.append('text')
      .text((d) => formatAddress(d.id))
      .attr('font-size', '10px')
      .attr('fill', '#fff')
      .attr('dx', 15)
      .attr('dy', 4);

    // Add tooltip
    const tooltip = d3.select('body')
      .append('div')
      .style('position', 'absolute')
      .style('padding', '8px')
      .style('background', 'rgba(0, 0, 0, 0.8)')
      .style('color', '#fff')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'auto') // Allow clicking buttons
      .style('opacity', 0)
      .style('z-index', '1000');

    node
      .on('mouseover', (event, d) => {
        const incomingLinks = links.filter(l => l.target === d.id);
        const outgoingLinks = links.filter(l => l.source === d.id);
        const totalIn = incomingLinks.reduce((sum, l) => sum + l.amount, 0);
        const totalOut = outgoingLinks.reduce((sum, l) => sum + l.amount, 0);
        const balance = addressBalances.get(d.id) || d.balance || 0;
        
        tooltip
          .style('opacity', 1)
          .html(`
            <strong>${d.isTarget ? 'Target Wallet' : 'Connected Wallet'}</strong><br/>
            Address: ${d.id}<br/>
            Balance: ${balance.toFixed(2)} ALLO<br/>
            Total Received: ${totalIn.toFixed(2)} ALLO<br/>
            Total Sent: ${totalOut.toFixed(2)} ALLO
          `);
      })
      .on('mousemove', (event) => {
        tooltip
          .style('left', `${event.pageX + 10}px`)
          .style('top', `${event.pageY - 10}px`);
      })
      .on('mouseout', () => {
        tooltip.style('opacity', 0);
      });

    // Add link labels for amounts
    const linkLabels = svg.append('g')
      .selectAll('text')
      .data(links.filter(l => l.amount > 0))
      .enter()
      .append('text')
      .attr('font-size', '10px')
      .attr('fill', '#9ca3af')
      .text((d: any) => d.amount > 0.01 ? `${d.amount.toFixed(2)} ALLO` : '');

    // Update positions on simulation tick
    simulation.on('tick', () => {
      // Constrain nodes to bounds
      nodes.forEach((node: any) => {
        const padding = 50;
        node.x = Math.max(padding, Math.min(width - padding, node.x));
        node.y = Math.max(padding, Math.min(height - padding, node.y));
      });

      link
        .attr('x1', (d: any) => (d.source as any).x)
        .attr('y1', (d: any) => (d.source as any).y)
        .attr('x2', (d: any) => (d.target as any).x)
        .attr('y2', (d: any) => (d.target as any).y);

      linkLabels
        .attr('x', (d: any) => ((d.source as any).x + (d.target as any).x) / 2)
        .attr('y', (d: any) => ((d.source as any).y + (d.target as any).y) / 2);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      labelGroup
        .attr('transform', (d: any) => `translate(${d.x || 0}, ${d.y || 0})`);
    });

    // Cleanup function
    return () => {
      simulation.stop();
      tooltip.remove();
    };
  }, [network, targetAddress, transfers, addressBalances]);

  const getNetworkStats = () => {
    const allAddresses = new Set<string>();
    network.forEach((connections, address) => {
      allAddresses.add(address);
      connections.forEach((conn) => allAddresses.add(conn));
    });

    let totalConnections = 0;
    network.forEach((connections) => {
      totalConnections += connections.size;
    });

    return {
      totalWallets: allAddresses.size,
      totalConnections,
      avgConnections: network.size > 0 ? totalConnections / network.size : 0,
    };
  };

  // Helper function to format number with M/K
  // K = hàng nghìn (1,000), M = hàng triệu (1,000,000)
  const formatAmount = (amount: number): string => {
    if (amount >= 1000000) {
      // Hàng triệu: >= 1,000,000
      const millions = amount / 1000000;
      // Nếu >= 10M thì không cần số thập phân
      if (millions >= 10) {
        return `${Math.round(millions)}M`;
      }
      return `${millions.toFixed(2)}M`;
    } else if (amount >= 1000) {
      // Hàng nghìn: >= 1,000
      const thousands = amount / 1000;
      // Nếu >= 10K thì không cần số thập phân
      if (thousands >= 10) {
        return `${Math.round(thousands)}K`;
      }
      return `${thousands.toFixed(2)}K`;
    } else {
      // < 1,000: hiển thị số thường
      return amount.toFixed(2);
    }
  };

  // Get export data list with memo
  const getExportDataList = (): Array<{ address: string; amount: number; memo: string }> => {
    // Helper function to validate Allora address
    const isValidAddress = (addr: string): boolean => {
      if (!addr || typeof addr !== 'string') return false;
      // Must match Allora address pattern: allo1 followed by alphanumeric characters
      return /^allo1[a-z0-9]+$/i.test(addr.trim());
    };

    // Map to store memo for each address (from transactions)
    const addressMemos = new Map<string, string>();
    transactions.forEach(tx => {
      const memo = tx.tx?.body?.memo || '';
      if (memo && memo.trim()) {
        // Get addresses from messages
        const messages = tx.tx?.body?.messages || [];
        messages.forEach((msg: any) => {
          if (msg['@type'] === '/cosmos.bank.v1beta1.MsgSend') {
            const fromAddress = msg.from_address;
            const toAddress = msg.to_address;
            if (isValidAddress(fromAddress)) {
              // Prefer non-empty memo
              if (!addressMemos.has(fromAddress) || !addressMemos.get(fromAddress)?.trim()) {
                addressMemos.set(fromAddress, memo);
              }
            }
            if (isValidAddress(toAddress)) {
              // Prefer non-empty memo
              if (!addressMemos.has(toAddress) || !addressMemos.get(toAddress)?.trim()) {
                addressMemos.set(toAddress, memo);
              }
            }
          }
        });
        // Also check transfers - map by transaction hash
        transfers.forEach(transfer => {
          // Try to match transfer with transaction by checking if addresses match
          const messages = tx.tx?.body?.messages || [];
          const hasMatchingAddress = messages.some((msg: any) => {
            if (msg['@type'] === '/cosmos.bank.v1beta1.MsgSend') {
              return (msg.from_address === transfer.from && msg.to_address === transfer.to) ||
                     (msg.from_address === transfer.from) ||
                     (msg.to_address === transfer.to);
            }
            return false;
          });
          
          if (hasMatchingAddress) {
            if (isValidAddress(transfer.from)) {
              if (!addressMemos.has(transfer.from) || !addressMemos.get(transfer.from)?.trim()) {
                addressMemos.set(transfer.from, memo);
              }
            }
            if (isValidAddress(transfer.to)) {
              if (!addressMemos.has(transfer.to) || !addressMemos.get(transfer.to)?.trim()) {
                addressMemos.set(transfer.to, memo);
              }
            }
          }
        });
      }
    });

    // Collect all addresses with their balances
    const allAddresses = new Set<string>();
    network.forEach((connections, address) => {
      if (isValidAddress(address)) {
        allAddresses.add(address);
      }
      connections.forEach((conn) => {
        if (isValidAddress(conn)) {
          allAddresses.add(conn);
        }
      });
    });
    
    // Also add addresses from transfers (only valid ones)
    transfers.forEach(transfer => {
      if (isValidAddress(transfer.from)) {
        allAddresses.add(transfer.from);
      }
      if (isValidAddress(transfer.to)) {
        allAddresses.add(transfer.to);
      }
    });

    // Create data array: address, amount, memo (only valid addresses)
    const data: Array<{ address: string; amount: number; memo: string }> = [];
    allAddresses.forEach(address => {
      if (isValidAddress(address)) {
        const balance = addressBalances.get(address) || 0;
        const memo = addressMemos.get(address) || '';
        data.push({
          address: address.trim(),
          amount: balance,
          memo: memo,
        });
      }
    });

    // Sort by amount descending
    data.sort((a, b) => b.amount - a.amount);
    return data;
  };

  const exportDataToTxt = () => {
    const data = getExportDataList();

    // Create text content with memo column
    const lines = ['Address,Amount (ALLO),Memo'];
    data.forEach(({ address, amount, memo }) => {
      // Escape commas in memo if present
      const escapedMemo = memo.replace(/,/g, ';');
      lines.push(`${address},${amount.toFixed(2)},${escapedMemo}`);
    });

    const content = lines.join('\n');
    
    // Create and download file
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `allora-wallets-${targetAddress.slice(0, 10)}-${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportDataList = getExportDataList();

  const stats = getNetworkStats();

  // Drag handler
  function drag(simulation: d3.Simulation<d3.SimulationNodeDatum, undefined>) {
    function dragstarted(event: d3.D3DragEvent<SVGCircleElement, { id: string; isTarget: boolean; balance: number }, d3.SimulationNodeDatum>) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      const subject = event.subject as any;
      subject.fx = subject.x;
      subject.fy = subject.y;
    }

    function dragged(event: d3.D3DragEvent<SVGCircleElement, { id: string; isTarget: boolean; balance: number }, d3.SimulationNodeDatum>) {
      const subject = event.subject as any;
      subject.fx = event.x;
      subject.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGCircleElement, { id: string; isTarget: boolean; balance: number }, d3.SimulationNodeDatum>) {
      if (!event.active) simulation.alphaTarget(0);
      const subject = event.subject as any;
      subject.fx = null;
      subject.fy = null;
    }

    return d3.drag<SVGCircleElement, { id: string; isTarget: boolean; balance: number }>()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }

  return (
    <div className="absolute inset-0 w-full h-full bg-black overflow-hidden flex">
      {/* SVG Graph - 70% width */}
      <div className="absolute left-0 top-0 bottom-0 w-[70%] overflow-hidden">
        <svg ref={svgRef} className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}></svg>
        {loading && network.size === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-white">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
              <p className="text-gray-400">Building network graph...</p>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute top-4 left-[35%] transform -translate-x-1/2 bg-red-500/10 border border-red-500 text-red-400 px-4 py-3 rounded-lg z-10">
            {error}
          </div>
        )}
      </div>

      {/* Right Sidebar - Export Data List - 30% width */}
      <div className="absolute right-0 top-0 bottom-0 w-[30%] bg-black/90 backdrop-blur-sm border-l border-white/10 shadow-2xl z-50 flex flex-col overflow-y-auto">
        {/* Header with Controls */}
        <div className="p-4 border-b border-white/10 flex-shrink-0">
          <div className="mb-4 space-y-3">
            <div>
              <label className="text-sm text-gray-400 mb-2 block">
                Depth:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={maxDepth}
                  onChange={(e) => setMaxDepth(parseInt(e.target.value) || 1)}
                  className="flex-1 px-3 py-2 bg-white/10 border border-white/20 rounded text-white text-sm"
                />
                <button
                  onClick={buildNetwork}
                  disabled={loading}
                  className="info px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm transition-colors"
                >
                  {loading ? '...' : 'Refresh'}
                </button>
              </div>
            </div>
            <button
              onClick={exportDataToTxt}
              disabled={exportDataList.length === 0}
              className="info w-full px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm transition-colors flex items-center justify-center gap-2"
            >
              Export Data ({exportDataList.length})
            </button>
          </div>
        </div>

        {/* Export Data List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4">
            <h3 className="text-lg font-semibold text-white mb-4">Export List</h3>
            {exportDataList.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">
                No data to export
              </p>
            ) : (
              <div className="space-y-2">
                {exportDataList.map((item, index) => (
                  <div
                    key={`${item.address}-${index}`}
                    className="bg-white/5 rounded p-3 border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-mono text-xs break-all">
                          {item.address}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <p className="text-white font-semibold text-sm">
                          {formatAmount(item.amount)} ALLO
                        </p>
                      </div>
                    </div>
                    {item.memo && (
                      <div className="mt-1">
                        <p className="text-gray-400 text-xs mb-0.5">Memo:</p>
                        <p className="text-white text-xs break-words">{item.memo}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

