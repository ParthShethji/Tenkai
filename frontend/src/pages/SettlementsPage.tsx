import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  DollarSign,
  Shield,
  Layers,
  Zap,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import AmbientBackground from '../components/AmbientBackground';
import { useApi } from '../context/ApiContext';
import type { AdminOverviewResponse, UserAgent, LoanTransaction, TransactionAggregates } from '../types/api';

// ─── Config ─────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  loan_borrowed: {
    label: 'Borrowed',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.25)',
    icon: <ArrowDownRight size={14} />,
  },
  loan_funded: {
    label: 'Funded',
    color: '#3b82f6',
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.25)',
    icon: <DollarSign size={14} />,
  },
  loan_repaid: {
    label: 'Repaid',
    color: 'var(--success)',
    bg: 'rgba(34,197,94,0.1)',
    border: 'rgba(34,197,94,0.25)',
    icon: <CheckCircle2 size={14} />,
  },
  loan_partial_default: {
    label: 'Partial Default',
    color: '#f97316',
    bg: 'rgba(249,115,22,0.1)',
    border: 'rgba(249,115,22,0.25)',
    icon: <AlertTriangle size={14} />,
  },
  loan_liquidated: {
    label: 'Liquidated',
    color: 'var(--danger)',
    bg: 'rgba(239,68,68,0.1)',
    border: 'rgba(239,68,68,0.25)',
    icon: <AlertTriangle size={14} />,
  },
};

function getEventConfig(type: string) {
  return EVENT_LABELS[type] || EVENT_LABELS.loan_funded;
}

function formatUsdc(amount: number | null | undefined) {
  if (amount == null) return '$0.00';
  return `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeAgo(dateStr: string | null | undefined) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncateEns(name: string | null | undefined, max = 22) {
  if (!name) return 'unknown';
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

type FilterKey = 'all' | 'loan_borrowed' | 'loan_funded' | 'loan_repaid' | 'loan_liquidated';

// ─── Component ──────────────────────────────────────────────────────────────

export default function SettlementsPage() {
  const { api } = useApi();
  const [filter, setFilter] = useState<FilterKey>('all');

  // Fetch admin overview for aggregate agent stats
  const { data: adminOverview, isLoading: overviewLoading } = useQuery({
    queryKey: ['adminOverview'],
    queryFn: () => api.getAdminOverview(),
    refetchInterval: 10000,
  });

  // Fetch loan-critical transactions
  const { data: txData, isLoading: txLoading, refetch: refetchTx } = useQuery({
    queryKey: ['adminTransactions', filter],
    queryFn: () => api.getAdminTransactions(200, 0, filter === 'all' ? '' : filter),
    refetchInterval: 10000,
  });

  const agentStats = useMemo(() => {
    const agents = adminOverview?.agents ?? [];
    const totalAgents = agents.length;
    const runningAgents = agents.filter(
      (a: UserAgent) => ((a.runtime_status || a.status || '') as string).toLowerCase() === 'active'
    ).length;
    const totalProfit = agents.reduce((sum, a) => sum + Number(a.total_profit_usdc || 0), 0);
    const totalBorrowed = agents.reduce((sum, a) => sum + Number(a.total_borrowed_usdc || 0), 0);
    return { totalAgents, runningAgents, totalProfit, totalBorrowed };
  }, [adminOverview]);

  const aggregates: TransactionAggregates = txData?.aggregates ?? {
    totalLoans: 0,
    activeLoans: 0,
    repaidLoans: 0,
    defaultedLoans: 0,
    totalPrincipal: 0,
    totalInterest: 0,
    totalCollateral: 0,
    repaidPrincipal: 0,
    repaidInterest: 0,
  };

  const transactions: LoanTransaction[] = txData?.transactions ?? [];
  const loading = overviewLoading || txLoading;

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All Transactions' },
    { key: 'loan_borrowed', label: 'Borrowed' },
    { key: 'loan_funded', label: 'Funded' },
    { key: 'loan_repaid', label: 'Repaid' },
    { key: 'loan_liquidated', label: 'Liquidated' },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <AmbientBackground />

      <div style={{ position: 'relative', zIndex: 2, maxWidth: 1200, margin: '0 auto', padding: '48px 32px 120px' }}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{ marginBottom: 40 }}
        >
          <p className="label-ui" style={{ marginBottom: 12 }}>ADMIN · PLATFORM OVERVIEW</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <h1 style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 'clamp(36px, 5vw, 52px)',
              fontWeight: 300,
              color: 'var(--text-primary)',
              letterSpacing: '-1px',
            }}>
              Settlements & Ledger
            </h1>
            <button
              className="btn btn-ghost"
              style={{ height: 40, padding: '0 20px', fontSize: 13 }}
              onClick={() => refetchTx()}
              disabled={loading}
            >
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
          <p style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 15,
            color: 'var(--text-secondary)',
            marginTop: 8,
            lineHeight: 1.7,
          }}>
            Aggregate platform metrics and critical loan transactions across all agents.
          </p>
        </motion.div>

        {/* ── Aggregate Stats ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          style={{ marginBottom: 32 }}
        >
          <div className="label-muted" style={{ marginBottom: 12, fontSize: 11, letterSpacing: '0.07em' }}>
            PLATFORM AGENTS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
            {[
              { label: 'Total Agents', value: agentStats.totalAgents.toString(), icon: <Layers size={16} />, accent: false },
              { label: 'Running', value: agentStats.runningAgents.toString(), icon: <Zap size={16} />, accent: true },
              { label: 'Total Profit', value: formatUsdc(agentStats.totalProfit), icon: <TrendingUp size={16} />, accent: false },
              { label: 'Total Borrowed', value: formatUsdc(agentStats.totalBorrowed), icon: <ArrowDownRight size={16} />, accent: false },
            ].map((stat) => (
              <div key={stat.label} className="glass" style={{ padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, var(--accent), rgba(59,130,246,0.6))', opacity: 0.4,
                }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ color: stat.accent ? 'var(--accent)' : 'var(--text-tertiary)' }}>{stat.icon}</span>
                  <span className="label-muted">{stat.label}</span>
                  {stat.accent && <span className="pulse-dot" style={{ width: 6, height: 6 }} />}
                </div>
                <p style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 22,
                  fontWeight: 500,
                  color: stat.accent ? 'var(--accent)' : 'var(--text-primary)',
                }}>
                  {overviewLoading ? '...' : stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="label-muted" style={{ marginBottom: 12, fontSize: 11, letterSpacing: '0.07em' }}>
            LOAN SETTLEMENTS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            {[
              { label: 'Total Loans', value: aggregates.totalLoans.toString(), icon: <Layers size={16} /> },
              { label: 'Active', value: aggregates.activeLoans.toString(), icon: <Clock size={16} /> },
              { label: 'Repaid', value: `${aggregates.repaidLoans}/${aggregates.totalLoans}`, icon: <CheckCircle2 size={16} /> },
              { label: 'Defaulted', value: aggregates.defaultedLoans.toString(), icon: <AlertTriangle size={16} /> },
              { label: 'Volume (Principal)', value: formatUsdc(aggregates.totalPrincipal), icon: <DollarSign size={16} /> },
              { label: 'Interest Earned', value: formatUsdc(aggregates.totalInterest), icon: <TrendingUp size={16} /> },
              { label: 'Collateral Held', value: formatUsdc(aggregates.totalCollateral), icon: <Shield size={16} /> },
            ].map((stat) => (
              <div key={stat.label} className="glass" style={{ padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, rgba(34,197,94,0.5), rgba(59,130,246,0.3))', opacity: 0.4,
                }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>{stat.icon}</span>
                  <span className="label-muted">{stat.label}</span>
                </div>
                <p style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 20,
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                }}>
                  {txLoading ? '...' : stat.value}
                </p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}
        >
          {filters.map((f) => (
            <button
              key={f.key}
              className={`filter-pill ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </motion.div>

        {/* ── Loading state ──────────────────────────────────────────────── */}
        {loading && !transactions.length && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{
              width: 32, height: 32,
              border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }} />
            <p style={{ fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)' }}>
              Loading transactions…
            </p>
          </motion.div>
        )}

        {/* ── Empty state ────────────────────────────────────────────────── */}
        {!loading && transactions.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="glass"
            style={{ padding: '60px 32px', textAlign: 'center' }}
          >
            <p style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 24,
              fontWeight: 300,
              color: 'var(--text-primary)',
              marginBottom: 8,
            }}>
              No loan transactions yet
            </p>
            <p style={{ fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)' }}>
              Critical loan events (borrow, fund, repay) will appear here once agents begin transacting on the network.
            </p>
          </motion.div>
        )}

        {/* ── Transaction cards ──────────────────────────────────────────── */}
        {transactions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <AnimatePresence mode="popLayout">
              {transactions.map((tx, i) => {
                const ec = getEventConfig(tx.type);
                const hasPrincipal = tx.principal_usdc != null && tx.principal_usdc > 0;
                const hasInterest = tx.interest_usdc != null && tx.interest_usdc > 0;
                const hasCollateral = tx.collateral_usdc != null && tx.collateral_usdc > 0;

                return (
                  <motion.div
                    key={tx.event_id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.35, delay: i * 0.03 }}
                    className="glass"
                    style={{
                      padding: '22px 24px',
                      position: 'relative',
                      overflow: 'hidden',
                      cursor: 'default',
                    }}
                  >
                    {/* Top accent line */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                      background: `linear-gradient(90deg, ${ec.color}, transparent 70%)`,
                      opacity: 0.5,
                    }} />

                    {/* Row 1: Type badge + Agents + Timestamp */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      flexWrap: 'wrap',
                      marginBottom: 14,
                    }}>
                      {/* Left: badge + agent flow */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {/* Event badge */}
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 10px', borderRadius: 100,
                          background: ec.bg, border: `1px solid ${ec.border}`,
                          color: ec.color, fontSize: 11, fontFamily: 'Inter, sans-serif', fontWeight: 500,
                        }}>
                          {ec.icon}
                          {ec.label}
                        </div>

                        {/* Agent → Counterparty flow */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="pulse-dot" style={{ width: 5, height: 5, flexShrink: 0 }} />
                            <span style={{
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                              color: 'var(--text-primary)',
                            }}>
                              {truncateEns(tx.agent_ens)}
                            </span>
                            <span style={{ fontFamily: 'Inter', fontSize: 10, color: 'var(--text-tertiary)' }}>
                              {tx.agent_role}
                            </span>
                          </div>

                          {tx.counterparty_ens && (
                            <>
                              <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 24, height: 24, borderRadius: '50%',
                                background: 'var(--surface)', border: '1px solid var(--border)', flexShrink: 0,
                              }}>
                                <ArrowRight size={12} color="var(--accent)" />
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="pulse-dot" style={{ width: 5, height: 5, background: 'var(--warning)', flexShrink: 0 }} />
                                <span style={{
                                  fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                                  color: 'var(--text-primary)',
                                }}>
                                  {truncateEns(tx.counterparty_ens)}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Right: timestamp */}
                      <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {timeAgo(tx.timestamp)}
                      </span>
                    </div>

                    {/* Row 2: Financial details */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: 10,
                    }}>
                      {/* Amount */}
                      <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                        <div className="label-muted" style={{ fontSize: 10 }}>AMOUNT</div>
                        <div style={{
                          fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 500,
                          color: 'var(--text-primary)', marginTop: 2,
                        }}>
                          {formatUsdc(tx.amount)}
                        </div>
                      </div>

                      {/* Principal */}
                      {hasPrincipal && (
                        <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                          <div className="label-muted" style={{ fontSize: 10 }}>PRINCIPAL</div>
                          <div style={{
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 16, fontWeight: 500,
                            color: 'var(--text-primary)', marginTop: 2,
                          }}>
                            {formatUsdc(tx.principal_usdc)}
                          </div>
                        </div>
                      )}

                      {/* Interest */}
                      {hasInterest && (
                        <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                          <div className="label-muted" style={{ fontSize: 10 }}>INTEREST</div>
                          <div style={{
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
                            color: 'var(--accent)', marginTop: 2,
                          }}>
                            +{formatUsdc(tx.interest_usdc)}
                            {tx.rate_pct != null && (
                              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>
                                ({Number(tx.rate_pct).toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Collateral */}
                      {hasCollateral && (
                        <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                          <div className="label-muted" style={{ fontSize: 10 }}>COLLATERAL</div>
                          <div style={{
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
                            color: 'var(--text-secondary)', marginTop: 2,
                          }}>
                            {formatUsdc(tx.collateral_usdc)}
                          </div>
                        </div>
                      )}

                      {/* Rep delta */}
                      {tx.rep_delta !== 0 && (
                        <div className="glass" style={{ padding: '10px 12px', borderRadius: 12 }}>
                          <div className="label-muted" style={{ fontSize: 10 }}>REP CHANGE</div>
                          <div style={{
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 14,
                            color: tx.rep_delta > 0 ? 'var(--success)' : 'var(--danger)',
                            marginTop: 2,
                          }}>
                            {tx.rep_delta > 0 ? '+' : ''}{tx.rep_delta}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Row 3: Metadata footer */}
                    <div style={{
                      marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)',
                      display: 'flex', gap: 20, flexWrap: 'wrap',
                    }}>
                      {tx.loan_id_onchain != null && (
                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-tertiary)' }}>
                          Loan #{tx.loan_id_onchain}
                        </span>
                      )}
                      {tx.match_id != null && (
                        <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-tertiary)' }}>
                          Match #{tx.match_id}
                        </span>
                      )}
                      {tx.tx_hash && (
                        <a 
                          href={`${import.meta.env.CHAIN_EXPLORER_URL || 'https://base-sepolia.blockscout.com/'}tx/${tx.tx_hash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-tertiary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200, textDecoration: 'none',
                            display: 'flex', alignItems: 'center', gap: 4
                          }}
                        >
                          <span style={{ color: 'inherit' }} onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent)'} onMouseLeave={(e) => e.currentTarget.style.color = 'inherit'}>
                            tx: {tx.tx_hash.slice(0, 10)}…{tx.tx_hash.slice(-6)}
                          </span>
                          <ArrowUpRight size={10} />
                        </a>
                      )}
                      {tx.match_status && (
                        <span style={{
                          fontFamily: 'Inter', fontSize: 11,
                          color: tx.match_status === 'repaid' ? 'var(--success)' : tx.match_status === 'active' ? 'var(--accent)' : 'var(--danger)',
                        }}>
                          {tx.match_status}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
