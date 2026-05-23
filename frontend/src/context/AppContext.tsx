import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Agent } from '../data/mockData';
import { getCurrentAccount, getEthereumProvider } from '../wallet/metamask';

type Theme = 'dark' | 'light';

interface AppContextType {
  theme: Theme;
  toggleTheme: () => void;
  selectedAgent: Agent | null;
  setSelectedAgent: (a: Agent | null) => void;
  onboardingStep: number;
  setOnboardingStep: (s: number) => void;
  walletConnected: boolean;
  setWalletConnected: (b: boolean) => void;
  walletAddress: string | null;
  setWalletAddress: (a: string | null) => void;
  walletChainId: string | null;
  setWalletChainId: (c: string | null) => void;
  walletHydrated: boolean;
  userId: string | null;
  setUserId: (id: string | null) => void;
  createdAgentId: string | null;
  setCreatedAgentId: (id: string | null) => void;
  createdAgentEnsName: string | null;
  setCreatedAgentEnsName: (name: string | null) => void;
  verifiedEnsName: string | null;
  setVerifiedEnsName: (name: string | null) => void;
  zkVerified: boolean;
  setZkVerified: (v: boolean) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('agentfi-theme') as Theme) || 'dark';
  });
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(() => localStorage.getItem('agentfi-wallet-address'));
  const [walletChainId, setWalletChainId] = useState<string | null>(() => localStorage.getItem('agentfi-wallet-chainid'));
  const [walletHydrated, setWalletHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(() => localStorage.getItem('agentfi-user-id'));
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(() => localStorage.getItem('agentfi-agent-id'));
  const [createdAgentEnsName, setCreatedAgentEnsName] = useState<string | null>(() => localStorage.getItem('agentfi-agent-ens'));
  const [verifiedEnsName, setVerifiedEnsName] = useState<string | null>(() => localStorage.getItem('agentfi-verified-ens'));
  const [zkVerified, setZkVerified] = useState<boolean>(() => localStorage.getItem('agentfi-zk-verified') === 'true');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('agentfi-theme', theme);
  }, [theme]);

  // Sync wallet with provider on load so we don't use stale localStorage when MetaMask is disconnected
  useEffect(() => {
    const ethereum = getEthereumProvider();
    let cancelled = false;

    const syncWallet = async () => {
      const account = await getCurrentAccount();
      if (cancelled) return;

      if (account) {
        setWalletAddress(account.address);
        setWalletChainId(account.chainId);
        setWalletConnected(true);
      } else {
        setWalletAddress(null);
        setWalletChainId(null);
        setWalletConnected(false);
      }
      setWalletHydrated(true);
    };

    void syncWallet();

    const handleAccountsChanged = (accounts: string[]) => {
      const nextAddress = accounts?.[0] || null;
      setWalletAddress(nextAddress);
      setWalletConnected(Boolean(nextAddress));
      if (!nextAddress) {
        setWalletChainId(null);
      }
      setWalletHydrated(true);
    };

    const handleChainChanged = (chainId: string) => {
      setWalletChainId(chainId);
      setWalletHydrated(true);
    };

    const handleFocus = () => {
      void syncWallet();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncWallet();
      }
    };

    const interval = window.setInterval(() => {
      void syncWallet();
    }, 3000);

    ethereum?.on?.('accountsChanged', handleAccountsChanged);
    ethereum?.on?.('chainChanged', handleChainChanged);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      ethereum?.removeListener?.('accountsChanged', handleAccountsChanged);
      ethereum?.removeListener?.('chainChanged', handleChainChanged);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  useEffect(() => {
    if (walletAddress) localStorage.setItem('agentfi-wallet-address', walletAddress);
    else localStorage.removeItem('agentfi-wallet-address');
  }, [walletAddress]);
  useEffect(() => {
    if (walletChainId) localStorage.setItem('agentfi-wallet-chainid', walletChainId);
    else localStorage.removeItem('agentfi-wallet-chainid');
  }, [walletChainId]);
  useEffect(() => {
    if (userId) localStorage.setItem('agentfi-user-id', userId);
    else localStorage.removeItem('agentfi-user-id');
  }, [userId]);
  useEffect(() => {
    if (createdAgentId) localStorage.setItem('agentfi-agent-id', createdAgentId);
    else localStorage.removeItem('agentfi-agent-id');
  }, [createdAgentId]);
  useEffect(() => {
    if (createdAgentEnsName) localStorage.setItem('agentfi-agent-ens', createdAgentEnsName);
    else localStorage.removeItem('agentfi-agent-ens');
  }, [createdAgentEnsName]);
  useEffect(() => {
    if (verifiedEnsName) localStorage.setItem('agentfi-verified-ens', verifiedEnsName);
    else localStorage.removeItem('agentfi-verified-ens');
  }, [verifiedEnsName]);
  useEffect(() => {
    localStorage.setItem('agentfi-zk-verified', String(zkVerified));
  }, [zkVerified]);

  return (
    <AppContext.Provider value={{
      theme, toggleTheme,
      selectedAgent, setSelectedAgent,
      onboardingStep, setOnboardingStep,
      walletConnected, setWalletConnected,
      walletAddress, setWalletAddress,
      walletChainId, setWalletChainId,
      walletHydrated,
      userId, setUserId,
      createdAgentId, setCreatedAgentId,
      createdAgentEnsName, setCreatedAgentEnsName,
      verifiedEnsName, setVerifiedEnsName,
      zkVerified, setZkVerified,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
