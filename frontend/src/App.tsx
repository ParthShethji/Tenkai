import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AppProvider } from './context/AppContext';
import { ApiProvider } from './context/ApiContext';
import { useApp } from './context/AppContext';
import { useApi } from './context/ApiContext';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import CreateAgentPage from './pages/CreateAgentPage';
import DashboardPage from './pages/DashboardPage';
import SettlementsPage from './pages/SettlementsPage';
import FeedPage from './pages/FeedPage';
import NavBar from './components/NavBar';
import { useEffect } from 'react';

function AnimatedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: location.pathname === '/' ? 0 : 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: location.pathname === '/' ? 0 : -16 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <AnimatedRoute>
            <LandingPage />
          </AnimatedRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <AnimatedRoute>
            <OnboardingPage />
          </AnimatedRoute>
        }
      />
      <Route
        path="/create-agent"
        element={
          <AnimatedRoute>
            <CreateAgentPage />
          </AnimatedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <AnimatedRoute>
            <NavBar activeNav="dashboard" />
            <DashboardPage />
          </AnimatedRoute>
        }
      />
      <Route
        path="/settlements"
        element={
          <AnimatedRoute>
            <NavBar activeNav="activity" />
            <SettlementsPage />
          </AnimatedRoute>
        }
      />
      <Route
        path="/feed"
        element={
          <AnimatedRoute>
            <NavBar activeNav="admin" />
            <FeedPage />
          </AnimatedRoute>
        }
      />
    </Routes>
  );
}

function AppContent() {
  return (
    <BrowserRouter>
      <SessionHydrator />
      <AppRoutes />
    </BrowserRouter>
  );
}

function SessionHydrator() {
  const { api } = useApi();
  const {
    walletAddress,
    walletHydrated,
    setUserId,
    setVerifiedEnsName,
    setZkVerified,
    setCreatedAgentId,
    setCreatedAgentEnsName,
  } = useApp();

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!walletHydrated) {
        return;
      }

      if (!walletAddress) {
        setUserId(null);
        setVerifiedEnsName(null);
        setZkVerified(false);
        setCreatedAgentId(null);
        setCreatedAgentEnsName(null);
        return;
      }

      try {
        const session = await api.getSession(walletAddress);
        if (cancelled) return;
        if (!session.user) {
          setUserId(null);
          setVerifiedEnsName(null);
          setZkVerified(false);
          setCreatedAgentId(null);
          setCreatedAgentEnsName(null);
          return;
        }

        setUserId(session.user.userId);
        setVerifiedEnsName(session.user.ensName || null);
        setZkVerified(Boolean(session.user.zkVerified));

        const latestAgent = session.agents[0];
        setCreatedAgentId(latestAgent?.agent_id || null);
        setCreatedAgentEnsName(latestAgent?.ens_name || null);
      } catch {
        if (cancelled) return;
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    walletAddress,
    walletHydrated,
    setCreatedAgentEnsName,
    setCreatedAgentId,
    setUserId,
    setVerifiedEnsName,
    setZkVerified,
  ]);

  return null;
}

export default function App() {
  return (
    <AppProvider>
      <ApiProvider>
        <AppContent />
      </ApiProvider>
    </AppProvider>
  );
}
