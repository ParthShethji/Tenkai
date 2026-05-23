import React from 'react';
import { ShieldCheck } from 'lucide-react';

export default function TrustRegistryPills() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 12 }}>
        <ShieldCheck size={16} color="#8b5cf6" />
        <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Trust Registry
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        {[
          { name: 'AgentFi DAO', color: '#06b6d4' },
          { name: 'Verite Oracle Node', color: '#8b5cf6' },
          { name: 'Securitize', color: '#3b82f6' }
        ].map(issuer => (
          <div key={issuer.name} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            background: `${issuer.color}20`,
            borderRadius: 100,
            border: `1px solid ${issuer.color}40`
          }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: issuer.color, boxShadow: `0 0 8px ${issuer.color}` }} />
            <span style={{ fontFamily: 'Inter', fontSize: 12, color: 'var(--text-primary)' }}>{issuer.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
