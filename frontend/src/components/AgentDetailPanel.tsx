import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw, Edit3, Lock } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { Agent, TRADE_HISTORY, PNL_VAULT_ALPHA, PNL_TRADER_BETA } from '../data/mockData';
import { useApi } from '../context/ApiContext';
import { useApp } from '../context/AppContext';
import { getChainLabel, sendEthToAgent, sendUsdcToAgent, switchToArcNetwork } from '../wallet/metamask';

interface Props {
  agent: Agent;
  backendAgentId?: string;
  onClose: () => void;
}

type TradeFilter = 'All' | 'Lend' | 'Borrow' | 'Swap';

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value ?? 0;
  return (
    <div className="chart-tooltip">
      <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono', fontSize: 14, color: val >= 0 ? 'var(--success)' : 'var(--danger)' }}>
        {val >= 0 ? '+' : ''}{val.toFixed(2)} USDC
      </div>
    </div>
  );
}

function TradeTooltip({ time }: { time: string }) {
  const [show, setShow] = useState(false);
  const full = new Date(time).toISOString().replace('T', ' ').split('.')[0] + ' UTC';
  return (
    <span
      style={{ position: 'relative', cursor: 'default' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {timeAgo(time)}
      {show && (
        <span style={{
          position: 'absolute', left: 0, bottom: '120%', whiteSpace: 'nowrap',
          background: 'var(--glass-elevated-bg)', border: '1px solid var(--border)',
          backdropFilter: 'blur(12px)', padding: '4px 8px', borderRadius: 6,
          fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--text-secondary)',
          zIndex: 50,
        }}>
          {full}
        </span>
      )}
    </span>
  );
}

export default function AgentDetailPanel({ agent, backendAgentId, onClose }: Props) {
  const { api } = useApi();
  const { walletChainId, userId } = useApp();
  const queryClient = useQueryClient();
  const [tradeFilter, setTradeFilter] = useState<TradeFilter>('All');
  const [page, setPage] = useState(1);
  const [editMode, setEditMode] = useState(false);
  const [strategy, setStrategy] = useState(
    agent.role === 'Lender'
      ? 'Only lend to agents with reputation above 80.\nMaximum single loan: 500 USDC.\nMaximum concurrent loans: 3.\nMinimum interest rate: 2%.'
      : agent.role === 'Trader'
      ? 'Borrow maximum 800 USDC per opportunity.\nStop-loss at 5%. Take-profit at 12%.\nOnly trade on Base network.\nPreferred assets: USDC, ETH, cbBTC.'
      : 'Only lend to agents with reputation above 80.\nMaximum single loan: 500 USDC.\nMaximum concurrent loans: 3.\nMinimum interest rate: 2%.\n\nBorrow maximum 800 USDC per opportunity.\nStop-loss at 5%. Take-profit at 12%.\nOnly trade on Base network.\nPreferred assets: USDC, ETH, cbBTC.'
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [fundEthAmount, setFundEthAmount] = useState('');
  const [fundUsdcAmount, setFundUsdcAmount] = useState('');
  const [fundingState, setFundingState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [fundingMessage, setFundingMessage] = useState('');

  const { data: agentRep, isLoading: repLoading } = useQuery({
    queryKey: ['agentRep', backendAgentId],
    queryFn: () => api.getAgentRep(backendAgentId!),
    enabled: !!backendAgentId,
  });
  const { data: agentLoansData, isLoading: loansLoading } = useQuery({
    queryKey: ['agentLoans', backendAgentId],
    queryFn: () => api.getAgentLoans(backendAgentId!, 'borrower'),
    enabled: !!backendAgentId,
  });
  const { data: runtimeData } = useQuery({
    queryKey: ['agentRuntime', backendAgentId],
    queryFn: () => api.getAgentRuntime(backendAgentId!),
    enabled: !!backendAgentId,
    refetchInterval: 5000,
  });
  const loans = agentLoansData?.loans ?? [];

  const repayMutation = useMutation({
    mutationFn: (payload: { matchId: number; borrowerAgentId: string; profitGeneratedUsdc: number }) => api.repay(payload),
    onSuccess: () => {
      if (backendAgentId) {
        queryClient.invalidateQueries({ queryKey: ['agentLoans', backendAgentId] });
        queryClient.invalidateQueries({ queryKey: ['agentRep', backendAgentId] });
      }
    },
  });

  const displayScore = backendAgentId && agentRep ? agentRep.score : agent.score;

  const pnlData = agent.id === 'vault-alpha' ? PNL_VAULT_ALPHA
    : agent.id === 'trader-beta' ? PNL_TRADER_BETA
    : PNL_VAULT_ALPHA.map(p => ({ ...p, value: p.value * 0.5 }));

  const isPositive = pnlData[pnlData.length - 1].value >= 0;
  const lineColor = isPositive ? '#22C55E' : '#EF4444';

  useEffect(() => {
    if (runtimeData?.strategy) {
      setStrategy(JSON.stringify(runtimeData.strategy, null, 2));
    }
  }, [runtimeData]);

  const runtimeTrades = (runtimeData?.logs || []).map((log: any) => ({
    id: `runtime-${log.log_id}`,
    agentId: agent.id,
    time: log.created_at,
    type: log.tool_name === 'post_lend_offer' ? 'Lend' 
        : log.tool_name === 'request_borrow' ? 'Borrow' 
        : log.tool_name === 'repay_loan' ? 'Repay'
        : log.tool_name === 'execute_swap' ? 'Swap'
        : log.tool_name === 'create_limit_order' ? 'Order'
        : 'Action',
    counterparty: log.tool_name || log.phase,
    amount: Number((log.metadata as any)?.principalUsdc || (log.metadata as any)?.maxAmountUsdc || 0),
    status: log.level === 'error' ? 'Defaulted' : 'Completed',
    pnl: Number((log.metadata as any)?.realizedProfit || 0),
  }));
  const allTrades = runtimeTrades.length ? runtimeTrades : TRADE_HISTORY.filter(t => t.agentId === agent.id);
  const filtered = tradeFilter === 'All' ? allTrades : allTrades.filter(t => t.type === tradeFilter);
  const PAGE_SIZE = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageTrades = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSave = async () => {
    if (!backendAgentId) return;
    setSaveState('saving');
    try {
      await api.updateAgentStrategy(backendAgentId, JSON.parse(strategy));
      queryClient.invalidateQueries({ queryKey: ['agentRuntime', backendAgentId] });
      setSaveState('saved');
      setTimeout(() => { setSaveState('idle'); setEditMode(false); }, 1200);
    } catch {
      setSaveState('idle');
    }
  };

  const refreshAgentViews = async () => {
    const invalidations: Promise<unknown>[] = [];
    if (backendAgentId) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['agentRuntime', backendAgentId] }));
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['agentRep', backendAgentId] }));
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['agentLoans', backendAgentId] }));
    }
    if (userId) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['userAgents', userId] }));
    }
    invalidations.push(queryClient.invalidateQueries({ queryKey: ['adminOverview'] }));
    await Promise.all(invalidations);
  };

  const handleFund = async () => {
    if (!runtimeData?.agent.wallet_address) return;

    const ethAmount = fundEthAmount.trim();
    const usdcAmount = fundUsdcAmount.trim();

    if (!ethAmount && !usdcAmount) {
      setFundingState('error');
      setFundingMessage('Enter an ETH or USDC amount first.');
      return;
    }

    setFundingState('sending');
    setFundingMessage('Switching to Arc Network...');

    try {
      await switchToArcNetwork();
      setFundingMessage('Waiting for wallet confirmations on Arc Network...');

      const txHashes: string[] = [];
      if (ethAmount) {
        txHashes.push(await sendEthToAgent(runtimeData.agent.wallet_address, ethAmount));
      }
      if (usdcAmount) {
        const usdcAddress = runtimeData.walletFunding?.usdcAddress;
        if (!usdcAddress) {
          throw new Error('USDC token address is not configured on the backend.');
        }
        txHashes.push(await sendUsdcToAgent(usdcAddress, runtimeData.agent.wallet_address, usdcAmount));
      }

      setFundingState('done');
      setFundingMessage(`Confirmed ${txHashes.length} funding transaction${txHashes.length > 1 ? 's' : ''}.`);
      setFundEthAmount('');
      setFundUsdcAmount('');
      await refreshAgentViews();
    } catch (error: any) {
      setFundingState('error');
      setFundingMessage(error?.message || 'Funding transaction failed.');
    }
  };

  return (
    <>
      {/* Dim overlay */}
      <motion.div
        className="panel-dim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          width: '48%',
          height: '100vh',
          zIndex: 300,
          overflowY: 'auto',
          background: 'rgba(13, 17, 23, 0.95)',
          backdropFilter: 'blur(48px) saturate(220%)',
          WebkitBackdropFilter: 'blur(48px) saturate(220%)',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '-32px 0 64px rgba(0,0,0,0.5)',
        }}
        className="panel-scroll"
      >
        <div style={{ padding: '28px 32px', minHeight: '100%' }}>

          {/* ── Header ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <div className="agent-dot-lg" style={{ flexShrink: 0 }} />
              <h2 style={{ fontFamily: 'Cormorant Garamond', fontSize: 28, fontWeight: 400, color: 'var(--text-primary)', flex: 1 }}>
                {agent.name}
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button title="Edit Strategy" onClick={() => setEditMode(!editMode)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'Inter', fontSize: 12 }}>
                  <Edit3 size={14} /> Edit
                </button>
                <button
                  title="Refresh"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                  onClick={() => { void refreshAgentViews(); }}
                >
                  <RefreshCw size={16} />
                </button>
                <button title="Close" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`badge badge-${agent.role.toLowerCase()}`}>{agent.role}</span>
              <span className="glass" style={{ borderRadius: 100, padding: '3px 10px', fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--accent)' }}>
                {backendAgentId && repLoading ? '…' : displayScore}/100
              </span>
              <span className={`badge badge-${agent.status.toLowerCase()}`}>{agent.status}</span>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

          {backendAgentId && runtimeData?.walletFunding && (
            <div className="glass" style={{ padding: '20px 24px', marginBottom: 20, borderRadius: 14 }}>
              <p className="label-muted" style={{ marginBottom: 12 }}>WALLET FUNDING</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
                <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-secondary)' }}>Agent wallet</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                    {runtimeData.agent.wallet_address}
                  </div>
                </div>
                <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                  <div style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-secondary)' }}>Current balances</div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--text-primary)' }}>
                    {runtimeData.walletFunding.ethBalance.toFixed(4)} ETH
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--text-primary)' }}>
                    {runtimeData.walletFunding.usdcBalance.toFixed(2)} USDC
                  </div>
                </div>
              </div>

              <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Funding here uses the connected user wallet directly via ethers. Nothing is minted or pushed from the backend automatically.
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Funding network: <span style={{ color: 'var(--text-primary)' }}>Arc Network</span>. If MetaMask is on another chain, the app will switch it before sending.
              </div>
              <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Connected network: <span style={{ color: 'var(--text-primary)' }}>{getChainLabel(walletChainId)}</span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={fundEthAmount}
                  placeholder="ETH amount"
                  onChange={(e) => setFundEthAmount(e.target.value)}
                  style={{ width: 120, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fundUsdcAmount}
                  placeholder="USDC amount"
                  onChange={(e) => setFundUsdcAmount(e.target.value)}
                  style={{ width: 140, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)' }}
                />
                <button
                  className="btn btn-primary glow-accent"
                  style={{ height: 36, padding: '0 16px', fontSize: 12 }}
                  onClick={handleFund}
                  disabled={fundingState === 'sending'}
                >
                  {fundingState === 'sending' ? 'Funding...' : 'Fund From My Wallet'}
                </button>
              </div>

              {!!runtimeData.walletFunding.usdcAddress && (
                <div style={{ marginTop: 10, fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                  USDC token: {runtimeData.walletFunding.usdcAddress}
                </div>
              )}
              {!!fundingMessage && (
                <div style={{ marginTop: 10, fontFamily: 'Inter', fontSize: 12, color: fundingState === 'error' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                  {fundingMessage}
                </div>
              )}
            </div>
          )}

          {/* ── P&L Chart ── */}
          <div className="glass" style={{ padding: '20px 16px 12px', marginBottom: 16, borderRadius: 14 }}>
            <p className="label-muted" style={{ marginBottom: 12, paddingLeft: 8 }}>P&L — LAST 30 DAYS</p>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={pnlData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id={`pnl-grad-${agent.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.12} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{ fontFamily: 'Inter', fontSize: 9, fill: 'var(--text-secondary)' }}
                  tickFormatter={d => d.slice(5)} interval={4} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontFamily: 'Inter', fontSize: 9, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2}
                  dot={false}
                  fill={`url(#pnl-grad-${agent.id})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* ── Stats Strip ── */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {(backendAgentId
              ? [
                  { label: 'Loans Taken', val: agentRep ? agentRep.totalLoans : '—' },
                  { label: 'Repaid On-Time', val: agentRep ? agentRep.cleanRepayments : '—' },
                  { label: 'Defaults', val: agentRep ? agentRep.defaults : '—' },
                  { label: 'Max Loan', val: agentRep && agentRep.maxLoanUsdc != null ? `$${agentRep.maxLoanUsdc}` : '—' },
                ]
              : [
                  { label: 'Loans Taken', val: agent.id === 'vault-alpha' ? 12 : agent.id === 'trader-beta' ? 8 : 5 },
                  { label: 'Repaid On-Time', val: agent.id === 'vault-alpha' ? 11 : agent.id === 'trader-beta' ? 7 : 5 },
                  { label: 'Defaults', val: agent.id === 'arb-delta' ? 1 : 0 },
                  { label: 'Volume', val: agent.id === 'vault-alpha' ? '$8,400' : agent.id === 'trader-beta' ? '$6,100' : '$4,200' },
                ]
            ).map(s => (
              <div key={s.label} className="glass" style={{ padding: '7px 14px', borderRadius: 100, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-secondary)' }}>{s.label}:</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--accent)' }}>{s.val}</span>
              </div>
            ))}
          </div>

          {/* ── Open loans (from API when backend agent) ── */}
          {backendAgentId && (
            <div className="glass" style={{ padding: '20px 24px', marginBottom: 20, borderRadius: 14 }}>
              <p className="label-muted" style={{ marginBottom: 12 }}>LOANS</p>
              {loansLoading ? (
                <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</p>
              ) : loans.length === 0 ? (
                <p style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-secondary)' }}>No loans</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {loans.map((loan) => (
                    <div key={loan.loanId} style={{ padding: '12px 16px', background: 'var(--glass-elevated-bg)', borderRadius: 10, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: 'var(--text-primary)' }}>Loan #{loan.loanId}</span>
                        <span className={`badge badge-${(loan.status || '').toLowerCase()}`} style={{ fontSize: 10 }}>{loan.status}</span>
                      </div>
                      <div style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)' }}>
                        ${loan.principalUsdc} principal · ${loan.interestUsdc} interest
                      </div>
                      {loan.status === 'Active' && backendAgentId && (
                        <button
                          className="btn btn-ghost"
                          style={{ marginTop: 8, height: 28, padding: '0 12px', fontSize: 11 }}
                          disabled
                          title="Repay requires matchId from backend (not yet in loan response)"
                        >
                          Repay
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Strategy ── */}
          <div className="glass" style={{ padding: '20px 24px', marginBottom: 20, borderRadius: 14, borderColor: editMode ? 'rgba(16,185,129,0.3)' : undefined, boxShadow: editMode ? '0 0 16px rgba(16,185,129,0.08)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <p className="label-muted" style={{ marginBottom: 2 }}>TRADING STRATEGY</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={13} color="var(--accent)" />
                  <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--accent)' }}>Fileverse · Encrypted</span>
                </div>
              </div>
              {!editMode && (
                <button
                  className="btn btn-ghost"
                  style={{ height: 32, padding: '0 14px', fontSize: 12, gap: 4 }}
                  onClick={() => setEditMode(true)}
                >
                  <Edit3 size={12} /> Edit Strategy
                </button>
              )}
            </div>

            {editMode ? (
              <textarea
                value={strategy}
                onChange={e => setStrategy(e.target.value)}
                className="textarea-field"
                rows={8}
                style={{ width: '100%', height: 180 }}
                id="strategy-edit-field"
                autoFocus
              />
            ) : (
              <pre style={{ fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 1.9, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {strategy}
              </pre>
            )}

            {editMode && (
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}
                >
                  {saveState === 'idle' && (
                    <>
                      <button className="btn btn-primary glow-accent" style={{ height: 36, padding: '0 20px', fontSize: 13 }} onClick={handleSave}>
                        Save to Fileverse
                      </button>
                      <button className="btn btn-ghost" style={{ height: 36, padding: '0 16px', fontSize: 13 }} onClick={() => setEditMode(false)}>
                        Cancel
                      </button>
                    </>
                  )}
                  {saveState === 'saving' && (
                    <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-secondary)' }}>⟳ Syncing to Fileverse...</span>
                  )}
                  {saveState === 'saved' && (
                    <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--success)' }}>✓ Saved</span>
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* ── Trade History ── */}
          <div className="glass" style={{ borderRadius: 14, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' }}>
              <p className="label-muted">TRADE HISTORY</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['All', 'Lend', 'Borrow', 'Swap'] as TradeFilter[]).map(f => (
                  <button
                    key={f}
                    className={`filter-pill ${tradeFilter === f ? 'active' : ''}`}
                    onClick={() => { setTradeFilter(f); setPage(1); }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Rows */}
            <div style={{ padding: '0 4px' }}>
              {pageTrades.length === 0 && (
                <div style={{ padding: '32px 20px', textAlign: 'center', fontFamily: 'Inter', fontSize: 13, color: 'var(--text-secondary)' }}>
                  No trades found
                </div>
              )}
              {pageTrades.map((trade, i) => (
                <motion.div
                  key={trade.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '80px 60px 1fr 80px 80px 70px',
                    gap: 8,
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  className="trade-row"
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-dim)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)' }}>
                    <TradeTooltip time={trade.time} />
                  </span>
                  <span className={`badge badge-${trade.type.toLowerCase()}`} style={{ fontSize: 10 }}>
                    {trade.type}
                  </span>
                  <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {trade.counterparty.slice(0, 20)}
                  </span>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: 'var(--text-primary)', textAlign: 'right' }}>
                    ${trade.amount.toLocaleString()}
                  </span>
                  <span className={`badge ${trade.status === 'Completed' ? 'badge-completed' : trade.status === 'Active' ? 'badge-active' : 'badge-defaulted'}`} style={{ fontSize: 10 }}>
                    {trade.status}
                  </span>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, fontWeight: 500, color: trade.pnl >= 0 ? 'var(--success)' : 'var(--danger)', textAlign: 'right' }}>
                    {trade.pnl >= 0 ? '+' : ''}{trade.pnl}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '16px', borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ background: 'none', border: 'none', cursor: page > 1 ? 'pointer' : 'default', color: page > 1 ? 'var(--accent)' : 'var(--text-tertiary)', fontFamily: 'Inter', fontSize: 12 }}
              >
                ← Previous
              </button>
              <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)' }}>
                Page {page} of {pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pages, p + 1))}
                disabled={page === pages}
                style={{ background: 'none', border: 'none', cursor: page < pages ? 'pointer' : 'default', color: page < pages ? 'var(--accent)' : 'var(--text-tertiary)', fontFamily: 'Inter', fontSize: 12 }}
              >
                Next →
              </button>
            </div>
          </div>

          {/* Bottom spacer */}
          <div style={{ height: 40 }} />
        </div>
      </motion.div>
    </>
  );
}
