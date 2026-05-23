import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { connectMetaMask, formatAddress, getCurrentAccount } from '../wallet/metamask';

type NavView = 'dashboard' | 'activity' | 'admin';

interface Props {
  activeNav?: NavView;
}

export default function NavBar({ activeNav = 'dashboard' }: Props) {
  const navigate = useNavigate();
  const { theme, toggleTheme, walletAddress, setWalletAddress, walletChainId, setWalletChainId, walletConnected, setWalletConnected } = useApp();

  const handleWalletClick = async () => {
    try {
      if (walletAddress) {
        setWalletAddress(null);
        setWalletChainId(null);
        setWalletConnected(false);
        return;
      }
      const res = await connectMetaMask();
      setWalletAddress(res.address);
      setWalletChainId(res.chainId);
      setWalletConnected(true);
    } catch (e) {
      // swallow; onboarding has full UX
      console.error(e);
    }
  };

  React.useEffect(() => {
    (async () => {
      if (walletAddress) return;
      const current = await getCurrentAccount();
      if (current) {
        setWalletAddress(current.address);
        setWalletChainId(current.chainId);
        setWalletConnected(true);
      }
    })();
  }, []);

  return (
    <nav
      className="glass"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        padding: '0 32px',
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        borderBottom: '1px solid var(--border)',
        backdropFilter: 'blur(48px) saturate(220%)',
        WebkitBackdropFilter: 'blur(48px) saturate(220%)',
        background: 'rgba(3,7,18,0.85)',
        gap: 32,
      }}
    >
      {/* Left side: Logo, Arc Status, Gas Ticker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 0,
          }}
        >
          <span className="pulse-dot" style={{ background: '#3b82f6', boxShadow: '0 0 10px #3b82f6' }} />
          <span style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 20,
            fontWeight: 400,
            letterSpacing: '-0.5px',
            color: 'var(--text-primary)',
          }}>
            AgentFi
          </span>
        </button>

        <div style={{ width: 1, height: 24, background: 'var(--border)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b5cf6', boxShadow: '0 0 8px #8b5cf6' }} />
          <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)' }}>Arc Network</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 100, border: '1px solid rgba(255,255,255,0.05)' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)' }}>Gas saved by VCs:</span>
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: '#06b6d4' }}>$124,847 ↑</span>
        </div>
      </div>

      {/* Center nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 28, flex: 1, justifyContent: 'center' }}>
        {([
          { label: 'Dashboard', view: 'dashboard' as NavView, path: '/dashboard' },
          { label: 'Settlements', view: 'activity' as NavView, path: '/settlements' },
          { label: 'Agent Feed', view: 'admin' as NavView, path: '/feed' },
        ]).map(({ label, view, path }) => (
          <button
            key={view}
            className={`nav-link ${activeNav === view ? 'active' : ''}`}
            onClick={() => navigate(path)}
            id={`nav-${view}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Theme toggle */}
        <button
          className="mode-toggle"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          id="theme-toggle-btn"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Wallet chip */}
        <button
          className="wallet-chip"
          onClick={handleWalletClick}
          style={{ cursor: 'pointer' }}
          title={walletAddress ? `Connected (${walletChainId || 'unknown'}) — click to disconnect` : 'Connect MetaMask'}
          id="navbar-wallet-btn"
        >
          <span className="pulse-dot" style={{ width: 7, height: 7, background: walletConnected ? 'var(--success)' : undefined }} />
          {walletAddress ? formatAddress(walletAddress) : 'Connect wallet'}
        </button>
      </div>
    </nav>
  );
}
