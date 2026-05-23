export interface Agent {
  id: string;
  name: string;
  role: 'Lender' | 'Trader' | 'Both';
  score: number;
  status: 'Active' | 'Idle' | 'Defaulted';
  capital: number;
  pnlToday: number;
  lent: number;
  borrowed: number;
}

export interface Trade {
  id: string;
  agentId: string;
  time: string;
  type: 'Lend' | 'Borrow' | 'Swap';
  counterparty: string;
  amount: number;
  status: 'Completed' | 'Active' | 'Defaulted';
  pnl: number;
}

export interface PnLPoint {
  date: string;
  value: number;
}

export const AGENTS: Agent[] = [
  {
    id: 'vault-alpha',
    name: 'vault-alpha.eth',
    role: 'Lender',
    score: 85,
    status: 'Active',
    capital: 4200,
    pnlToday: 84,
    lent: 2800,
    borrowed: 0,
  },
  {
    id: 'trader-beta',
    name: 'trader-beta.eth',
    role: 'Trader',
    score: 62,
    status: 'Active',
    capital: 3100,
    pnlToday: -22,
    lent: 0,
    borrowed: 1200,
  },
  {
    id: 'yield-gamma',
    name: 'yield-gamma.eth',
    role: 'Both',
    score: 78,
    status: 'Active',
    capital: 3800,
    pnlToday: 41,
    lent: 400,
    borrowed: 600,
  },
  {
    id: 'arb-delta',
    name: 'arb-delta.eth',
    role: 'Trader',
    score: 40,
    status: 'Idle',
    capital: 1350,
    pnlToday: 0,
    lent: 0,
    borrowed: 0,
  },
];

// Realistic 30-day P&L data — drawdowns, run-up, slight positive end
export const PNL_VAULT_ALPHA: PnLPoint[] = [
  { date: '2026-02-12', value: 0 },
  { date: '2026-02-13', value: 18 },
  { date: '2026-02-14', value: 35 },
  { date: '2026-02-15', value: 52 },
  { date: '2026-02-16', value: 44 }, // drawdown 1 start
  { date: '2026-02-17', value: 28 },
  { date: '2026-02-18', value: 15 },
  { date: '2026-02-19', value: 22 },
  { date: '2026-02-20', value: 40 },
  { date: '2026-02-21', value: 58 },
  { date: '2026-02-22', value: 73 },
  { date: '2026-02-23', value: 91 },
  { date: '2026-02-24', value: 110 }, // peak run-up
  { date: '2026-02-25', value: 98 },  // drawdown 2
  { date: '2026-02-26', value: 82 },
  { date: '2026-02-27', value: 75 },
  { date: '2026-02-28', value: 68 },
  { date: '2026-03-01', value: 80 },
  { date: '2026-03-02', value: 95 },
  { date: '2026-03-03', value: 107 },
  { date: '2026-03-04', value: 118 },
  { date: '2026-03-05', value: 130 },
  { date: '2026-03-06', value: 142 },
  { date: '2026-03-07', value: 138 },
  { date: '2026-03-08', value: 145 },
  { date: '2026-03-09', value: 152 },
  { date: '2026-03-10', value: 148 },
  { date: '2026-03-11', value: 156 },
  { date: '2026-03-12', value: 162 },
  { date: '2026-03-13', value: 168 },
  { date: '2026-03-14', value: 174 },
];

export const PNL_TRADER_BETA: PnLPoint[] = [
  { date: '2026-02-12', value: 0 },
  { date: '2026-02-13', value: -8 },
  { date: '2026-02-14', value: 12 },
  { date: '2026-02-15', value: 28 },
  { date: '2026-02-16', value: 42 },
  { date: '2026-02-17', value: 38 },
  { date: '2026-02-18', value: 22 }, // drawdown 1
  { date: '2026-02-19', value: 5 },
  { date: '2026-02-20', value: -12 },
  { date: '2026-02-21', value: -4 },
  { date: '2026-02-22', value: 15 },
  { date: '2026-02-23', value: 32 }, // run-up
  { date: '2026-02-24', value: 55 },
  { date: '2026-02-25', value: 48 },
  { date: '2026-02-26', value: 38 }, // drawdown 2
  { date: '2026-02-27', value: 25 },
  { date: '2026-02-28', value: 12 },
  { date: '2026-03-01', value: -5 },
  { date: '2026-03-02', value: -18 },
  { date: '2026-03-03', value: -8 },
  { date: '2026-03-04', value: 10 },
  { date: '2026-03-05', value: 22 },
  { date: '2026-03-06', value: 15 },
  { date: '2026-03-07', value: 5 },
  { date: '2026-03-08', value: -8 },
  { date: '2026-03-09', value: -20 },
  { date: '2026-03-10', value: -15 },
  { date: '2026-03-11', value: -25 },
  { date: '2026-03-12', value: -30 },
  { date: '2026-03-13', value: -26 },
  { date: '2026-03-14', value: -22 },
];

export const TRADE_HISTORY: Trade[] = [
  // vault-alpha trades
  { id: 't1', agentId: 'vault-alpha', time: '2026-03-14T07:15:00Z', type: 'Lend', counterparty: 'trader-beta.eth', amount: 500, status: 'Active', pnl: 12 },
  { id: 't2', agentId: 'vault-alpha', time: '2026-03-14T05:02:00Z', type: 'Lend', counterparty: 'yield-gamma.eth', amount: 400, status: 'Active', pnl: 8 },
  { id: 't3', agentId: 'vault-alpha', time: '2026-03-13T22:30:00Z', type: 'Lend', counterparty: 'arb-delta.eth', amount: 300, status: 'Completed', pnl: 18 },
  { id: 't4', agentId: 'vault-alpha', time: '2026-03-13T18:15:00Z', type: 'Lend', counterparty: 'yield-gamma.eth', amount: 500, status: 'Completed', pnl: 24 },
  { id: 't5', agentId: 'vault-alpha', time: '2026-03-12T09:00:00Z', type: 'Lend', counterparty: 'trader-beta.eth', amount: 500, status: 'Completed', pnl: 22 },
  // trader-beta trades
  { id: 't6', agentId: 'trader-beta', time: '2026-03-14T08:00:00Z', type: 'Borrow', counterparty: 'vault-alpha.eth', amount: 500, status: 'Active', pnl: -15 },
  { id: 't7', agentId: 'trader-beta', time: '2026-03-14T06:30:00Z', type: 'Swap', counterparty: 'uniswap-v4.eth', amount: 350, status: 'Completed', pnl: -7 },
  { id: 't8', agentId: 'trader-beta', time: '2026-03-13T21:00:00Z', type: 'Swap', counterparty: 'uniswap-v4.eth', amount: 280, status: 'Completed', pnl: 12 },
  { id: 't9', agentId: 'trader-beta', time: '2026-03-13T14:45:00Z', type: 'Borrow', counterparty: 'yield-gamma.eth', amount: 600, status: 'Completed', pnl: -18 },
  { id: 't10', agentId: 'trader-beta', time: '2026-03-12T11:15:00Z', type: 'Swap', counterparty: 'curve-fi.eth', amount: 450, status: 'Completed', pnl: 34 },
  // yield-gamma trades
  { id: 't11', agentId: 'yield-gamma', time: '2026-03-14T07:45:00Z', type: 'Lend', counterparty: 'arb-delta.eth', amount: 400, status: 'Active', pnl: 6 },
  { id: 't12', agentId: 'yield-gamma', time: '2026-03-14T04:15:00Z', type: 'Borrow', counterparty: 'vault-alpha.eth', amount: 600, status: 'Active', pnl: -4 },
  { id: 't13', agentId: 'yield-gamma', time: '2026-03-13T19:30:00Z', type: 'Swap', counterparty: 'uniswap-v4.eth', amount: 600, status: 'Completed', pnl: 39 },
  // arb-delta trades (one defaulted)
  { id: 't14', agentId: 'arb-delta', time: '2026-03-10T11:00:00Z', type: 'Borrow', counterparty: 'vault-alpha.eth', amount: 300, status: 'Defaulted', pnl: -300 },
  { id: 't15', agentId: 'arb-delta', time: '2026-03-08T09:30:00Z', type: 'Swap', counterparty: 'uniswap-v4.eth', amount: 200, status: 'Completed', pnl: 12 },
];

export const DASHBOARD_STATS = {
  agentsActive: 4,
  totalCapital: 12450,
  lentOut: 3200,
  borrowed: 1800,
  outstandingDebt: 1836,
  activeBreakdown: '3 lending · 1 trading',
  lendPositions: 5,
  openLoans: 2,
  debtInterest: 36,
};

export const PORTFOLIO = {
  debt: { label: 'Debt', value: 1836, color: '#EF4444' },
  trading: { label: 'Trading', value: 3100, color: '#F59E0B' },
  lent: { label: 'Lent', value: 7514, color: '#22C55E' },
  total: 12450,
};
