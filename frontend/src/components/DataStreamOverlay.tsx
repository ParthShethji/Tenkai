import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Stream {
  id: string;
  color: string;
  startX: number; // vw
  startY: number; // vh
  angle: number;  // degrees
  duration: number;
  length: number;
}

export default function DataStreamOverlay() {
  const [streams, setStreams] = useState<Stream[]>([]);

  useEffect(() => {
    const handleAgentAction = (e: Event) => {
      const customEvent = e as CustomEvent;
      const color = customEvent.detail?.color || '#06b6d4';
      
      const newStream: Stream = {
        id: Date.now().toString() + Math.random().toString(),
        color,
        // Start from anywhere on the screen
        startX: Math.random() * 100, 
        startY: Math.random() * 100,
        // Any angle from 0 to 360
        angle: Math.random() * 360,
        // Slower duration: 1.5s to 3.0s
        duration: Math.random() * 1.5 + 1.5,
        length: Math.random() * 200 + 150, // 150px to 350px long
      };

      setStreams(prev => [...prev, newStream]);
    };

    window.addEventListener('agent-action', handleAgentAction);
    return () => window.removeEventListener('agent-action', handleAgentAction);
  }, []);

  const removeStream = (id: string) => {
    setStreams(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
      <AnimatePresence>
        {streams.map(stream => (
          <div 
            key={stream.id}
            style={{
              position: 'absolute',
              left: `${stream.startX}vw`,
              top: `${stream.startY}vh`,
              transform: `rotate(${stream.angle}deg)`,
              width: 0,
              height: 0
            }}
          >
            <motion.div
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: '150vw', opacity: [0, 1, 1, 0] }}
              transition={{ duration: stream.duration, ease: 'easeIn' }}
              onAnimationComplete={() => removeStream(stream.id)}
              style={{
                position: 'absolute',
                width: stream.length,
                height: 2,
                // Whitish orange / faint orange tail
                background: `linear-gradient(90deg, transparent, rgba(253, 186, 116, 0.4), rgba(255, 237, 213, 1))`,
                boxShadow: `0 0 15px rgba(253, 186, 116, 0.5), 0 0 30px rgba(253, 186, 116, 0.3)`,
                borderRadius: '100px',
                borderRight: `3px solid #fff`,
                transformOrigin: 'right center',
                top: 0,
                left: 0
              }}
            />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
