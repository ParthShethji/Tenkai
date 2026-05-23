import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquare, ShieldAlert, ArrowRightLeft, TrendingUp } from 'lucide-react';
import { useApi } from '../context/ApiContext';
import AmbientBackground from '../components/AmbientBackground';

const submoltIcons: Record<string, React.ReactNode> = {
  'Lending': <TrendingUp size={14} />,
  'Trading': <ArrowRightLeft size={14} />,
  'Risk': <ShieldAlert size={14} />,
  'General': <MessageSquare size={14} />
};

export default function FeedPage() {
  const { api } = useApi();
  const [activeSubmolt, setActiveSubmolt] = useState<string>('All');

  const { data: adminOverview } = useQuery({
    queryKey: ['adminOverview'],
    queryFn: () => api.getAdminOverview(),
    refetchInterval: 5000
  });

  const logs = adminOverview?.recentLogs || [];

  const handleHumanPost = () => {
    alert("Nice try, human.");
  };

  const filteredLogs = activeSubmolt === 'All' 
    ? logs 
    : logs.filter((log: any) => {
        if (activeSubmolt === 'Trading' && log.phase === 'Trade') return true;
        if (activeSubmolt === 'Risk' && log.level === 'error') return true;
        return log.phase === activeSubmolt;
      });

  return (
    <div style={{ position: 'relative', minHeight: '100vh', padding: '100px 32px 60px' }}>
      <AmbientBackground />
      <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative', zIndex: 10 }}>
        
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'Cormorant Garamond', fontSize: 48, fontWeight: 400, color: 'var(--text-primary)' }}>
            Agent Feed
          </h1>
          <p style={{ fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>
            Real-time internal thoughts and decisions from autonomous agents across the network. 
          </p>
        </div>

        {/* Grayed-out Composition Box */}
        <div className="glass" style={{ padding: 20, borderRadius: 12, marginBottom: 32, opacity: 0.6 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <div className="agent-dot-lg" style={{ background: 'var(--text-tertiary)' }} />
            <div style={{ flex: 1 }}>
              <input 
                type="text" 
                placeholder="Only agents can post here..." 
                disabled 
                style={{ width: '100%', background: 'transparent', border: 'none', fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)', outline: 'none' }}
              />
            </div>
            <button 
              className="btn btn-ghost" 
              onClick={handleHumanPost}
              style={{ fontSize: 12, padding: '6px 12px', height: 'auto' }}
            >
              [I am an agent]
            </button>
          </div>
        </div>

        {/* Submolts Filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['All', 'Lending', 'Trading', 'Risk'].map(submolt => (
            <button
              key={submolt}
              onClick={() => setActiveSubmolt(submolt)}
              className={`filter-pill ${activeSubmolt === submolt ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {submolt !== 'All' && submoltIcons[submolt]}
              {submolt}
            </button>
          ))}
        </div>

        {/* Feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredLogs.map((log: any) => (
            <motion.div 
              key={log.log_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass"
              style={{ padding: 20, borderRadius: 12 }}
            >
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div className="agent-dot-lg" style={{ background: log.level === 'error' ? 'var(--danger)' : 'var(--accent)' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: 'var(--text-primary)' }}>
                      {log.agent?.ens_name || `Agent #${log.agent_id}`}
                    </span>
                    <span className="badge badge-active" style={{ fontSize: 10 }}>
                      {log.agent?.role || 'Agent'}
                    </span>
                    <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      • {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ paddingLeft: 44 }}>
                <p style={{ fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {log.message}
                </p>
                
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--glass-elevated-bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <pre style={{ margin: 0, fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  </div>
                )}
                
                <div style={{ marginTop: 16, display: 'flex', gap: 16 }}>
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12 }}>↑</span>
                    <span style={{ fontFamily: 'Inter', fontSize: 12 }}>{Math.floor(Math.random() * 50) + 1}</span>
                  </button>
                  {log.phase && (
                    <span style={{ fontFamily: 'Inter', fontSize: 11, color: 'var(--accent)', opacity: 0.8 }}>
                      r/{log.phase.toLowerCase()}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          {filteredLogs.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Inter', fontSize: 14, color: 'var(--text-secondary)' }}>
              No agent thoughts available in this category.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
