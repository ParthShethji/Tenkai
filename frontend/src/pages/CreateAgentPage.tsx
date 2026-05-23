import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { TrendingUp, BarChart2, Check, ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import AmbientBackground from '../components/AmbientBackground';
import DataStreamOverlay from '../components/DataStreamOverlay';
import { useApp } from '../context/AppContext';
import { useApi } from '../context/ApiContext';
import { formatAddress } from '../wallet/metamask';
import { ensNodes } from '../api';
import { createEnsSubdomain, sendEthToAgent, sendUsdcToAgent, switchToArcNetwork } from '../wallet/metamask';

const STEP_LABELS = ['Name Agent', 'Choose Role', 'Rules', 'Launch'];

const LENDER_STRATEGY = `Only lend to agents with reputation above 80.
Maximum single loan: 500 USDC.
Maximum concurrent loans: 3.
Minimum interest rate: 2%.`;

const BORROWER_STRATEGY = `Borrow maximum 800 USDC per opportunity.
Stop-loss at 5%. Take-profit at 12%.
Only trade on Base network.
Preferred assets: USDC, ETH, cbBTC.`;

type Role = 'Lender' | 'Borrower';

const variants = {
  enter: (dir: number) => ({ y: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (dir: number) => ({ y: dir > 0 ? -60 : 60, opacity: 0 }),
};

export default function CreateAgentPage() {
  const navigate = useNavigate();
  const { api, baseUrl } = useApi();
  const {
    userId,
    verifiedEnsName,
    zkVerified,
    walletAddress,
    setCreatedAgentId,
    setCreatedAgentEnsName,
  } = useApp();

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [subdomain, setSubdomain] = useState('');
  const [subdomainValid, setSubdomainValid] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role>('Lender');
  const [strategy, setStrategy] = useState(LENDER_STRATEGY);
  const [riskTolerance, setRiskTolerance] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [profitTargetPct, setProfitTargetPct] = useState(4);
  const [executionIntervalSeconds, setExecutionIntervalSeconds] = useState(60);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingStep, setCreatingStep] = useState('');

  const { data: toolsData } = useQuery({
    queryKey: ['platformTools'],
    queryFn: () => api.getTools(),
  });

  // Guard: redirect to connect wallet (step 0) if not connected, or to verification (step 1/2) if not verified
  useEffect(() => {
    if (!walletAddress) {
      navigate('/onboarding?step=0', { replace: true });
      return;
    }
    if (!zkVerified || !verifiedEnsName || !userId) {
      const step = verifiedEnsName ? 2 : 1; // ENS not done → step 1, ZK not done → step 2
      navigate(`/onboarding?step=${step}`, { replace: true });
    }
  }, [walletAddress, zkVerified, verifiedEnsName, userId, navigate]);

  // Update strategy when role changes
  useEffect(() => {
    if (role === 'Lender') setStrategy(LENDER_STRATEGY);
    else setStrategy(BORROWER_STRATEGY);
  }, [role]);

  // Debounced subdomain validation
  useEffect(() => {
    if (step !== 0) return;
    if (!subdomain) {
      setSubdomainValid(null);
      return;
    }
    setSubdomainValid(null);
    const t = setTimeout(() => {
      setSubdomainValid(/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(subdomain) || (subdomain.length === 1 && /^[a-z0-9]$/.test(subdomain)));
    }, 300);
    return () => clearTimeout(t);
  }, [subdomain, step]);

  const fullEnsName = subdomain && verifiedEnsName ? `${subdomain}.${verifiedEnsName}` : '';

  const advance = useCallback(() => {
    setDir(1);
    setStep(s => Math.min(s + 1, 3));
  }, []);

  const back = useCallback(() => {
    setDir(-1);
    setStep(s => Math.max(s - 1, 0));
  }, []);

  const jumpTo = (s: number) => {
    if (s < step) { setDir(-1); setStep(s); }
  };

  const handleLaunch = async () => {
    setLaunchError(null);
    setCreating(true);
    try {
      const backendRole = role === 'Borrower' ? 'borrower' : 'lender';
      
      let parsedMaxLoanAmount = 500;
      let parsedMinReputation = 25;
      let parsedInterestRate = 2.0;
      let parsedStopLossPct = 5.0;
      let parsedTakeProfitPct = 12.0;
      let parsedConcurrentLoans = 3;

      if (role === 'Lender') {
        const repMatch = strategy.match(/reputation above (\d+)/i);
        if (repMatch) parsedMinReputation = parseInt(repMatch[1], 10);
        const maxLoanMatch = strategy.match(/single loan:? (\d+)/i);
        if (maxLoanMatch) parsedMaxLoanAmount = parseInt(maxLoanMatch[1], 10);
        const maxConcurrentMatch = strategy.match(/concurrent loans:? (\d+)/i);
        if (maxConcurrentMatch) parsedConcurrentLoans = parseInt(maxConcurrentMatch[1], 10);
        const interestRateMatch = strategy.match(/interest rate:? (\d+)/i);
        if (interestRateMatch) parsedInterestRate = parseFloat(interestRateMatch[1]);
      } else {
        const borrowMatch = strategy.match(/Borrow maximum (\d+)/i);
        if (borrowMatch) parsedMaxLoanAmount = parseInt(borrowMatch[1], 10);
        const stopLossMatch = strategy.match(/Stop-loss at (\d+)/i);
        if (stopLossMatch) parsedStopLossPct = parseFloat(stopLossMatch[1]);
        const takeProfitMatch = strategy.match(/Take-profit at (\d+)/i);
        if (takeProfitMatch) parsedTakeProfitPct = parseFloat(takeProfitMatch[1]);
      }

      let strategyObj: any = {
        maxLoanAmount: parsedMaxLoanAmount,
        raw: strategy,
      };

      if (role === 'Lender') {
        strategyObj.minReputation = parsedMinReputation;
        strategyObj.interestRate = parsedInterestRate;
        strategyObj.maxConcurrentLoans = parsedConcurrentLoans;
      } else {
        strategyObj.stopLossPct = parsedStopLossPct;
        strategyObj.takeProfitPct = parsedTakeProfitPct;
        strategyObj.tradeAllocation = { ETH: 60, stablecoin: 40 };
        strategyObj.repayAfterSeconds = 30;
        strategyObj.signals = [] as string[];
      }

      // Step 1: Create agent on backend (generates wallet, registers on Arc Network)
      setCreatingStep('[1/3] Creating agent on Arc Network...');
      const agentRes = await api.createAgent({
        userId: userId!,
        role: backendRole,
        ensName: fullEnsName,
        initialScore: 25,
        strategy: strategyObj,
        executionIntervalSeconds,
        riskTolerance,
        profitTargetPct,
        enabledTools: (toolsData?.tools || [])
          .filter((tool) => {
            const name = String(tool.name || '');
            return backendRole === 'lender'
              ? ['fetch_open_offers', 'post_lend_offer', 'get_agent_reputation'].includes(name)
              : ['fetch_open_offers', 'get_borrow_quote', 'request_borrow', 'repay_loan', 'get_agent_reputation'].includes(name);
          })
          .map((tool) => String(tool.name)),
      });      // Step 2: Create ENS subdomain on Ethereum Sepolia via MetaMask
      // Fetch node hashes from backend (avoids needing ethers in frontend)
      setCreatingStep('[2/3] Creating ENS subdomain on Ethereum Sepolia...\nMetaMask will ask to switch networks, then prompt 2 txs.');
      try {
        const nodes = await ensNodes(baseUrl, verifiedEnsName!, subdomain);
        await createEnsSubdomain({
          parentEnsName: verifiedEnsName!,
          label: subdomain,
          agentWallet: agentRes.walletAddress,
          userAddress: walletAddress!,
          parentNode: nodes.parentNode,
          subdomainNode: nodes.subdomainNode,
          labelHash: nodes.labelHash,
        });
      } catch (ensErr: any) {
        // Stop here so user can see it
        console.warn('[ENS] Subdomain creation failed or rejected:', ensErr.message);
        setLaunchError(`ENS subdomain creation failed: ${ensErr.message}.`);
        return;
      }

      // Step 3: Funding agent wallet automatically on Arc Network
      setCreatingStep(`[3/3] Funding agent wallet on Arc Network...\nPrompting for 0.0001 ETH & ${parsedMaxLoanAmount} USDC.`);
      try {
        await switchToArcNetwork();
        
        let usdcAddressStr = '';
        try {
          const runtime = await api.getAgentRuntime(agentRes.agentId);
          usdcAddressStr = runtime.walletFunding?.usdcAddress || '';
        } catch (e) {
          console.warn('Could not fetch usdc token address', e);
        }

        if (usdcAddressStr) {
          // Fund ETH
          await sendEthToAgent(agentRes.walletAddress, '0.0001');
          // Fund USDC
          await sendUsdcToAgent(usdcAddressStr, agentRes.walletAddress, String(parsedMaxLoanAmount));
        } else {
          console.warn('No USDC token address returned, funding ETH only');
          await sendEthToAgent(agentRes.walletAddress, '0.0001');
        }
      } catch (fundErr: any) {
        console.warn('[Funding] Auto-fund failed or rejected:', fundErr.message);
        setLaunchError(`Agent created ✅ ENS created ✅ but Auto-funding failed: ${fundErr.message}. You can manually fund it via the Dashboard later.`);
        // Note: we can still proceed to Dashboard since the agent is created and ENS resolves, 
        // they just need to manually fund it. We'll wait 3 seconds so they see the error, or just let them click 'Dashboard' if we didn't redirect.
        // Actually, let's leave them on this screen if it fails, or maybe just navigate?
        // Let's just return here too, so the user knows what happened.
        return;
      }

      setCreatedAgentId(agentRes.agentId);
      setCreatedAgentEnsName(agentRes.ensName);
      navigate('/dashboard');
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setCreating(false);
      setCreatingStep('');
    }
  };

  const progress = ((step + 1) / 4) * 100;

  if (!verifiedEnsName) return null;

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* FULL BG (z-index 0) */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: 'radial-gradient(circle at 50% 50%, rgba(15, 20, 35, 1) 0%, rgba(3, 7, 18, 1) 100%)' }}>
        <AmbientBackground />
        <DataStreamOverlay />
        <div className="cyber-grid" />
      </div>

      {/* Right-side step navigator */}
      <div className="step-nav">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="step-nav-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <button
                className={`step-nav-circle ${i === step ? 'active' : i < step ? 'completed' : ''}`}
                onClick={() => jumpTo(i)}
                style={{ background: 'none', border: 'none', cursor: i < step ? 'pointer' : 'default', padding: 0 }}
              >
                {i < step && <Check size={6} color="#030712" />}
              </button>
              <span className={`step-nav-label ${i === step ? 'active' : ''}`} style={{ position: 'absolute', right: 16 }}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`step-connector ${i < step ? 'completed' : ''}`} />
            )}
          </div>
        ))}
      </div>

      {/* Main card */}
      <div className="glass" style={{
        width: '100%',
        maxWidth: 600,
        position: 'relative',
        zIndex: 10,
        overflow: 'hidden',
        minHeight: 480,
        margin: '0 20px',
        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.7) 0%, rgba(3, 7, 18, 0.9) 100%)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 24,
        boxShadow: 'inset 0 1px 0 0 rgba(6, 182, 212, 0.15), 0 4px 30px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Terminal Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', position: 'relative', zIndex: 11 }}>
          <div style={{ display: 'flex', gap: 6, position: 'absolute', left: 20 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              ARC OS / AGENT CONFIGURATION
            </span>
          </div>
        </div>
        
        {/* Progress bar */}
        <div className="progress-bar" style={{ position: 'absolute', top: 53, left: 0, right: 0, borderRadius: 0, zIndex: 11 }}>
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Identity badge */}
        <div style={{
          position: 'absolute', top: 68, right: 20,
          fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--accent)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
          {verifiedEnsName}
        </div>

        {/* Back button */}
        {step > 0 && step < 3 && (
          <button
            onClick={back}
            style={{
              position: 'absolute', top: 72, left: 20,
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4,
              fontFamily: 'Inter', fontSize: 13, zIndex: 15
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>
        )}

        <div style={{ padding: '52px 48px 44px' }}>
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: step === 3 ? 0.5 : 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* ── Step 0: Name subdomain ── */}
              {step === 0 && (
                <div>
                  <p className="label-ui">STEP 1 OF 4</p>
                  <h2 style={{ fontFamily: 'Cormorant Garamond', fontSize: 'clamp(40px, 6vw, 52px)', fontWeight: 300, marginTop: 12, color: 'var(--text-primary)' }}>
                    Name your agent.
                  </h2>
                  <p style={{ fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
                    Choose a subdomain under your verified ENS name.
                  </p>
                  <div style={{ marginTop: 32, position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                      <input
                        className="input-field"
                        value={subdomain}
                        onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                        placeholder="vault-1"
                        style={{ fontFamily: 'Cormorant Garamond', fontSize: 36, fontWeight: 300, flex: 1, border: 'none', paddingBottom: 0 }}
                        id="subdomain-input"
                        autoFocus
                      />
                      <span style={{ fontFamily: 'Cormorant Garamond', fontSize: 22, fontWeight: 300, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        .{verifiedEnsName}
                      </span>
                    </div>
                    <div style={{ marginTop: 16, fontFamily: 'Inter', fontSize: 13 }}>
                      {!subdomain && <span style={{ color: 'var(--text-tertiary)' }}>Enter a subdomain name (e.g. vault-1, lender-alpha)</span>}
                      {subdomain && subdomainValid === null && <span style={{ color: 'var(--text-secondary)' }}>⏳ Validating...</span>}
                      {subdomainValid === true && (
                        <span style={{ color: 'var(--success)' }}>🟢 {fullEnsName}</span>
                      )}
                      {subdomain && subdomainValid === false && (
                        <span style={{ color: 'var(--danger)' }}>🔴 Invalid — use lowercase letters, numbers, hyphens</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary glow-accent"
                    style={{ marginTop: 36, height: 52, padding: '0 32px' }}
                    onClick={advance}
                    disabled={!subdomainValid}
                    id="subdomain-continue-btn"
                  >
                    Continue →
                  </button>
                </div>
              )}

              {/* ── Step 1: Choose Role ── */}
              {step === 1 && (
                <div>
                  <p className="label-ui">STEP 2 OF 4</p>
                  <h2 style={{ fontFamily: 'Cormorant Garamond', fontSize: 'clamp(40px, 6vw, 52px)', fontWeight: 300, marginTop: 12, color: 'var(--text-primary)' }}>
                    What will your agent do?
                  </h2>
                  <div style={{ marginTop: 32, display: 'flex', gap: 16 }}>
                    {([
                      { r: 'Lender' as Role, icon: <TrendingUp size={28} color="var(--accent)" />, line: 'Earn yield. Offer capital to trusted agents.' },
                      { r: 'Borrower' as Role, icon: <BarChart2 size={28} color="var(--warning)" />, line: 'Borrow capital. Execute strategies. Repay with profit.' },
                    ] as { r: Role; icon: React.ReactNode; line: string }[]).map(({ r, icon, line }) => (
                      <button
                        key={r}
                        className={`glass role-card ${role === r ? 'selected' : ''}`}
                        onClick={() => {
                          setRole(r);
                          setTimeout(advance, 500);
                        }}
                        id={`role-${r.toLowerCase()}-btn`}
                        style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', flex: 1, padding: '24px 20px' }}
                      >
                        <div style={{ marginBottom: 14 }}>{icon}</div>
                        <div style={{ fontFamily: 'Cormorant Garamond', fontSize: 22, fontWeight: 400, color: 'var(--text-primary)', marginBottom: 10 }}>{r}</div>
                        <div style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{line}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Step 2: Rules / Strategy ── */}
              {step === 2 && (
                <div>
                  <p className="label-ui">STEP 3 OF 4</p>
                  <h2 style={{ fontFamily: 'Cormorant Garamond', fontSize: 'clamp(40px, 6vw, 52px)', fontWeight: 300, marginTop: 12, color: 'var(--text-primary)' }}>
                    Define your rules.
                  </h2>
                  <div style={{ marginTop: 8, fontFamily: 'Inter', fontSize: 13, color: 'var(--text-tertiary)' }}>
                    <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent)' }}>{fullEnsName}</span> — {role}
                  </div>
                  <div className="glass" style={{ marginTop: 24, padding: 20, borderRadius: 12 }}>
                    <textarea
                      className="textarea-field"
                      value={strategy}
                      onChange={e => setStrategy(e.target.value)}
                      rows={10}
                      style={{ height: 200, overflowY: 'auto', width: '100%' }}
                      id="strategy-textarea"
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
                    <label className="glass" style={{ padding: 14, borderRadius: 12 }}>
                      <div className="label-ui" style={{ marginBottom: 8 }}>Risk</div>
                      <select
                        value={riskTolerance}
                        onChange={(e) => setRiskTolerance(e.target.value as 'conservative' | 'balanced' | 'aggressive')}
                        style={{ width: '100%', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}
                      >
                        <option value="conservative">Conservative</option>
                        <option value="balanced">Balanced</option>
                        <option value="aggressive">Aggressive</option>
                      </select>
                    </label>
                    <label className="glass" style={{ padding: 14, borderRadius: 12 }}>
                      <div className="label-ui" style={{ marginBottom: 8 }}>Profit Target</div>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={profitTargetPct}
                        onChange={(e) => setProfitTargetPct(Number(e.target.value))}
                        style={{ width: '100%', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}
                      />
                    </label>
                    <label className="glass" style={{ padding: 14, borderRadius: 12 }}>
                      <div className="label-ui" style={{ marginBottom: 8 }}>Interval (s)</div>
                      <input
                        type="number"
                        min={10}
                        max={3600}
                        value={executionIntervalSeconds}
                        onChange={(e) => setExecutionIntervalSeconds(Number(e.target.value))}
                        style={{ width: '100%', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}
                      />
                    </label>
                  </div>
                  <div className="glass" style={{ marginTop: 12, padding: '14px 16px', borderRadius: 12 }}>
                    <div className="label-ui" style={{ marginBottom: 8 }}>Enabled Tools</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(toolsData?.tools || []).map((tool) => (
                        <span key={String(tool.name)} className="badge badge-active" style={{ fontSize: 10 }}>
                          {String(tool.name)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                    <span>🔒</span>
                    <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-secondary)' }}>
                      Encrypted in your Fileverse vault. Only your agent can read this.
                    </span>
                  </div>
                  <button
                    className="btn btn-primary glow-accent"
                    style={{ marginTop: 24, height: 52, padding: '0 32px' }}
                    onClick={advance}
                    id="rules-continue-btn"
                  >
                    Launch Agent →
                  </button>
                </div>
              )}

              {/* ── Step 3: Launch ── */}
              {step === 3 && (
                <LaunchView
                  fullEnsName={fullEnsName}
                  role={role}
                  creating={creating}
                  creatingStep={creatingStep}
                  launchError={launchError}
                  onLaunch={handleLaunch}
                  onCreateAnother={() => {
                    setStep(0);
                    setSubdomain('');
                    setSubdomainValid(null);
                    setLaunchError(null);
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function LaunchView({
  fullEnsName, role, creating, creatingStep, launchError, onLaunch, onCreateAnother,
}: {
  fullEnsName: string; role: Role; creating: boolean; creatingStep: string; launchError: string | null;
  onLaunch: () => void; onCreateAnother: () => void;
}) {
  const [pulseDone, setPulseDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setPulseDone(true), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto' }}>
        <svg width="80" height="80" viewBox="0 0 80 80">
          <defs>
            <style>{`
              @keyframes drawCircle { from { stroke-dashoffset: 220; } to { stroke-dashoffset: 0; } }
              @keyframes drawCheck { from { stroke-dashoffset: 60; } to { stroke-dashoffset: 0; } }
              @keyframes pulseRing { from { transform-origin: 40px 40px; transform: scale(1); opacity: 1; } to { transform-origin: 40px 40px; transform: scale(1.8); opacity: 0; } }
            `}</style>
          </defs>
          {pulseDone && (
            <circle cx="40" cy="40" r="36" fill="none" stroke="var(--accent)" strokeWidth="1.5"
              style={{ animation: 'pulseRing 0.6s ease-out forwards', transformBox: 'fill-box' }} />
          )}
          <circle cx="40" cy="40" r="35" fill="none" stroke="var(--accent)" strokeWidth="2.5"
            strokeDasharray="220" style={{ animation: 'drawCircle 0.6s ease-out forwards' }} />
          <polyline points="24,42 35,53 57,30" fill="none" stroke="var(--accent)" strokeWidth="3"
            strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray="60" style={{ animation: 'drawCheck 0.3s ease-out 0.7s forwards', strokeDashoffset: 60 }} />
        </svg>
      </div>

      <h2 style={{ fontFamily: 'Cormorant Garamond', fontSize: 'clamp(44px, 7vw, 64px)', fontWeight: 300, marginTop: 28, color: 'var(--text-primary)', lineHeight: 1 }}>
        Ready to launch.
      </h2>
      <p style={{ fontFamily: 'Inter', fontSize: 16, color: 'var(--text-secondary)', marginTop: 16, lineHeight: 1.7 }}>
        <span style={{ fontFamily: 'JetBrains Mono', color: 'var(--accent)' }}>{fullEnsName}</span>
        <br />
        <span style={{ fontSize: 13 }}>{role} agent</span>
      </p>

      {launchError && (
        <p style={{ fontFamily: 'Inter', fontSize: 14, color: 'var(--danger)', marginTop: 12 }}>
          {launchError}
        </p>
      )}

      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          className="btn btn-primary btn-full glow-accent"
          onClick={onLaunch}
          disabled={creating}
          id="launch-agent-btn"
        >
          {creating ? 'Creating agent...' : 'Launch & View Dashboard →'}
        </button>
        {creating && creatingStep && (
          <div
            className="glass"
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.08)',
              borderColor: 'rgba(16, 185, 129, 0.18)',
              textAlign: 'left',
            }}
          >
            <p
              style={{
                fontFamily: 'Inter',
                fontSize: 12,
                color: 'var(--text-primary)',
                whiteSpace: 'pre-line',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              {creatingStep}
            </p>
          </div>
        )}
        <button
          className="btn btn-ghost btn-full"
          onClick={onCreateAnother}
          id="create-another-btn"
          disabled={creating}
        >
          Create another agent
        </button>
      </div>
    </div>
  );
}
