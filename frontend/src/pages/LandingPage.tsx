import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import AmbientBackground from '../components/AmbientBackground';
import DataStreamOverlay from '../components/DataStreamOverlay';
import MoltbookFeed from '../components/MoltbookFeed';
import TrustRegistryPills from '../components/TrustRegistryPills';
import { useApp } from '../context/AppContext';
import { connectMetaMask, formatAddress } from '../wallet/metamask';

export default function LandingPage() {
  const navigate = useNavigate();
  const { zkVerified, verifiedEnsName, userId } = useApp();
  const isVerified = zkVerified && !!verifiedEnsName && !!userId;
  const ctaRoute = isVerified ? '/dashboard' : '/onboarding';
  const [loaded, setLoaded] = useState(false);
  const { walletAddress, setWalletAddress, walletChainId, setWalletChainId, walletConnected, setWalletConnected } = useApp();

  useEffect(() => {
    setLoaded(true);
  }, []);

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
      // Automatically proceed to onboarding after connect
      navigate('/onboarding');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* FULL BG (z-index 0) */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: 'radial-gradient(circle at 50% 50%, rgba(15, 20, 35, 1) 0%, rgba(3, 7, 18, 1) 100%)' }}>
        <AmbientBackground />
        <DataStreamOverlay />
        <div className="cyber-grid" />
      </div>

      {/* HEADER STRIP */}
      <div style={{ position: 'relative', zIndex: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 40px 0 40px' }}>
        {/* LOGO */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(6, 182, 212, 0.4)' }}>
            <span style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>A</span>
          </div>
          <span style={{ fontFamily: 'Inter', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>AgentFi</span>
        </div>

        {/* CONNECT WALLET */}
        <button
          onClick={handleWalletClick}
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '10px 20px',
            borderRadius: 100,
            color: '#fff',
            fontFamily: 'Inter',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(10px)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(6, 182, 212, 0.15)';
            e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.4)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: walletConnected ? 'var(--success)' : '#06b6d4', boxShadow: walletConnected ? 'none' : '0 0 10px #06b6d4' }} />
          {walletAddress ? formatAddress(walletAddress) : 'Connect Wallet'}
        </button>
      </div>

      <div style={{ position: 'relative', zIndex: 10, flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 12, paddingBottom: 16, paddingLeft: 40, paddingRight: 40, minHeight: 0 }}>
        
        {/* HERO: Heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={loaded ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ width: '100%', maxWidth: 1200, margin: '0 auto', textAlign: 'center', marginBottom: 16 }}
        >
          <h1 style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 'clamp(32px, 5vw, 56px)',
            fontWeight: 800,
            letterSpacing: '-0.04em',
            background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1.1,
            marginBottom: 8,
            filter: 'drop-shadow(0 0 20px rgba(139, 92, 246, 0.3))'
          }}>
            Institutional-Grade<br/>Agentic Commerce.
          </h1>
          <p style={{
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 16,
            color: 'var(--text-secondary)',
            maxWidth: 600,
            margin: '0 auto'
          }}>
            Deploy autonomous liquidity agents on the Arc Network.<br/>
            Monitor the global Moltbook feed in real-time.
          </p>
        </motion.div>

        {/* HERO: Moltbook Feed (Flexible Height) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={loaded ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
          style={{ width: '100%', maxWidth: 1200, margin: '0 auto', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
        >
          <MoltbookFeed mode="global" height="100%" />
        </motion.div>

        {/* STRIP: Decentralization & Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={loaded ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
          style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            maxWidth: 1200, 
            margin: '16px auto 0 auto', 
            width: '100%',
            gap: 24,
            flexWrap: 'wrap',
            background: 'rgba(3,7,18,0.7)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 100,
            padding: '12px 32px',
            boxShadow: '0 4px 30px rgba(0,0,0,0.5)'
          }}
        >
          <TrustRegistryPills />
          
          <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
               <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Active Agents</span>
               <span style={{ fontFamily: 'JetBrains Mono', fontSize: 24, color: 'var(--text-primary)', fontWeight: 500 }}>247</span>
             </div>
             <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.1)' }} />
             <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
               <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Verifiable Credentials</span>
               <span style={{ fontFamily: 'JetBrains Mono', fontSize: 24, color: 'var(--text-primary)', fontWeight: 500 }}>1,842</span>
             </div>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={loaded ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          <button
            onClick={() => navigate(ctaRoute)}
            id="enter-matrix-btn"
            style={{ 
              height: 56, 
              padding: '0 48px', 
              fontSize: 16, 
              borderRadius: 100,
              background: 'linear-gradient(180deg, rgba(6, 182, 212, 0.15) 0%, rgba(0,0,0,0.8) 100%)',
              border: '1px solid #06b6d4',
              color: 'var(--text-primary)',
              fontFamily: 'Inter',
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
            onMouseOver={(e) => e.currentTarget.style.boxShadow = '0 0 30px rgba(6, 182, 212, 0.6)'}
            onMouseOut={(e) => e.currentTarget.style.boxShadow = '0 0 20px rgba(6, 182, 212, 0.3)'}
          >
            Enter the Matrix <span style={{ color: '#06b6d4' }}>→</span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
