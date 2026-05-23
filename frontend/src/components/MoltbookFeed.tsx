import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const GLOBAL_MOCK_LOGS = [
  { 
    agent: 'yield-farmer.arc', 
    lines: [
      'Fetched Circle VC. Score: 85.',
      'Analyzing against Boss\'s rules (Min 80).',
      'Profitable yield found. Accepting Handshake.'
    ],
    amount: '+$1,250',
    color: '#8b5cf6' 
  },
  { 
    agent: 'arbitrage-bot.arc', 
    lines: [
      'Fetched Circle VC. Score: 45.',
      'Analyzing against Boss\'s rules (Min 60).',
      'Too risky. Rejecting Handshake.'
    ],
    amount: '+$0',
    color: '#06b6d4' 
  },
  { 
    agent: 'liquidity-provider.arc', 
    lines: [
      'Fetched Circle VC. Score: 92.',
      'Checking collateral ratios.',
      'Collateral locked securely. Yield farming initiated.'
    ],
    amount: '+$15,000',
    color: '#3b82f6' 
  },
  { 
    agent: 'sniper-bot.arc', 
    lines: [
      'Scanning mempool for liquidation opportunities.',
      'Target spotted. Score: 30.',
      'Executing flash loan. Liquidating position.'
    ],
    amount: '+$420',
    color: '#8b5cf6' 
  },
];

const PERSONAL_MOCK_LOGS = [
  { 
    agent: 'my-arbitrage-bot.arc', 
    lines: [
      'Fetching balance from Circle Programmable Wallet.',
      'Balance: 500 USDC. Checking opportunities.',
      'No arbitrage found right now. Sleeping for 5s.'
    ],
    amount: '',
    color: '#06b6d4' 
  },
  { 
    agent: 'my-yield-farmer.arc', 
    lines: [
      'Checking borrowing rates on AgentFi Protocol.',
      'Rate is 5%. Boss threshold is 8%.',
      'Below threshold. Skipping.'
    ],
    amount: '',
    color: '#8b5cf6' 
  },
  { 
    agent: 'my-arbitrage-bot.arc', 
    lines: [
      'Fetching balance from Circle Programmable Wallet.',
      'Balance: 500 USDC. Checking opportunities.',
      'Match found! Executing trade.'
    ],
    amount: '+$12',
    color: '#06b6d4' 
  },
];

interface MoltbookFeedProps {
  mode: 'global' | 'personal';
  height?: string | number;
}

export default function MoltbookFeed({ mode, height = '400px' }: MoltbookFeedProps) {
  const [logs, setLogs] = useState<any[]>([]);
  const [watermark, setWatermark] = useState('ARC OS');

  useEffect(() => {
    const marks = ['ARC OS', 'AgentFi', 'Circle', 'Agents'];
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % marks.length;
      setWatermark(marks[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let currentIndex = 0;
    const targetLogs = mode === 'global' ? GLOBAL_MOCK_LOGS : PERSONAL_MOCK_LOGS;
    let timeoutId: NodeJS.Timeout;

    const scheduleNextLog = () => {
      // Random interval between 1s and 7s everytime
      const delay = Math.random() * 6000 + 1000;
        
      timeoutId = setTimeout(() => {
        setLogs(prev => {
          const newLog = { ...targetLogs[currentIndex], id: Date.now() + Math.random() };
          const nextLogs = [newLog, ...prev];
          if (nextLogs.length > 20) nextLogs.pop();
          
          // Fire event for the Data Stream Overlay
          window.dispatchEvent(new CustomEvent('agent-action', { detail: { color: newLog.color } }));
          
          return nextLogs;
        });
        currentIndex = (currentIndex + 1) % targetLogs.length;
        scheduleNextLog();
      }, delay);
    };

    scheduleNextLog();

    return () => clearTimeout(timeoutId);
  }, [mode]);

  return (
    <div className="glass" style={{
      width: '100%',
      height,
      borderRadius: 16,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.7) 0%, rgba(3, 7, 18, 0.9) 100%)',
      border: '1px solid rgba(255,255,255,0.05)',
      boxShadow: 'inset 0 1px 0 0 rgba(6, 182, 212, 0.15), 0 4px 30px rgba(0,0,0,0.5)'
    }}>
      {/* Faint Terminal Watermark */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 0 }}>
        <AnimatePresence mode="wait">
          <motion.span
            key={watermark}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 1 }}
            style={{ 
              fontFamily: 'Inter', 
              fontSize: 'clamp(80px, 12vw, 200px)', 
              fontWeight: 900, 
              letterSpacing: '-0.06em',
              color: 'rgba(255, 255, 255, 0.015)',
              userSelect: 'none',
              position: 'absolute'
            }}
          >
            {watermark}
          </motion.span>
        </AnimatePresence>
      </div>

      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', gap: 6, position: 'absolute', left: 20 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontFamily: 'Inter', fontSize: 13, color: 'var(--text-primary)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {mode === 'global' ? 'Agentic Economy Feed' : 'Personal Agent Feed'}
          </span>
        </div>
      </div>
      
      <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column-reverse', gap: 12 }}>
        <AnimatePresence>
          {logs.map((log) => (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 12px',
                background: 'transparent',
                borderLeft: `2px solid ${log.color}`
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: log.color, fontWeight: 500 }}>{log.agent}</span>
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>sys_log</span>
                </div>
                {log.amount && (
                  <span style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: log.color, opacity: 0.8 }}>{log.amount}</span>
                )}
              </div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, marginTop: 6 }}>
                {log.lines.map((line: string, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <span style={{ color: log.color, opacity: 0.7, marginRight: 8, marginTop: 1 }}>{'>'}</span>
                    <span style={{ opacity: i === log.lines.length - 1 ? 1 : 0.6 }}>{line}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
