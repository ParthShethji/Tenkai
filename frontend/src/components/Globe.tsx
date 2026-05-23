import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useApp } from '../context/AppContext';

// ── Fibonacci sphere distribution ──────────────────────────────────────────
function fibonacciSphere(n: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    points.push(new THREE.Vector3(
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius
    ));
  }
  return points;
}

// ── Single agent dot ────────────────────────────────────────────────────────
function AgentDot({ position, index }: { position: THREE.Vector3; index: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const delay = index * 0.07;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = (clock.getElapsedTime() + delay) % 1.8;
    const scale = t < 0.9
      ? 1 + (0.6 * Math.sin((t / 0.9) * Math.PI))
      : 1;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef} position={position}>
      <sphereGeometry args={[0.018, 8, 8]} />
      <meshBasicMaterial color="#06b6d4" />
      <pointLight color="#06b6d4" intensity={0.3} distance={0.4} />
    </mesh>
  );
}

// ── Communication line ──────────────────────────────────────────────────────
interface LineState {
  src: THREE.Vector3;
  dst: THREE.Vector3;
  phase: 'fadein' | 'travel' | 'fadeout';
  elapsed: number;
  opacity: number;
  t: number; // particle position 0-1
}

function CommunicationLines({ dots }: { dots: THREE.Vector3[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<LineState[]>([]);
  const meshesRef = useRef<{ line: THREE.Line, particle: THREE.Mesh, curve: THREE.CatmullRomCurve3 }[]>([]);
  const MAX_LINES = 5;

  function makeNewLine(): LineState {
    const a = Math.floor(Math.random() * dots.length);
    let b = Math.floor(Math.random() * dots.length);
    while (b === a) b = Math.floor(Math.random() * dots.length);
    return { src: dots[a], dst: dots[b], phase: 'fadein', elapsed: 0, opacity: 0, t: 0 };
  }

  useEffect(() => {
    if (!groupRef.current) return;
    const group = groupRef.current;

    for (let i = 0; i < MAX_LINES; i++) {
      const ls = makeNewLine();
      linesRef.current.push(ls);

      // Build curve
      const mid = ls.src.clone().add(ls.dst).multiplyScalar(0.5);
      const outward = mid.clone().normalize().multiplyScalar(0.3);
      const curve = new THREE.CatmullRomCurve3([ls.src, mid.add(outward), ls.dst]);

      // Line geometry
      const pts = curve.getPoints(50);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: '#06b6d4', transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);

      // Particle
      const pgeo = new THREE.SphereGeometry(0.025, 6, 6);
      const pmat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      const particle = new THREE.Mesh(pgeo, pmat);

      group.add(line);
      group.add(particle);
      meshesRef.current.push({ line, particle, curve });
    }

    return () => {
      meshesRef.current.forEach(({ line, particle }) => {
        group.remove(line);
        group.remove(particle);
      });
      meshesRef.current = [];
      linesRef.current = [];
    };
  }, [dots]);

  useFrame((_, delta) => {
    linesRef.current.forEach((ls, i) => {
      const { line, particle, curve } = meshesRef.current[i] || {};
      if (!line || !particle) return;

      ls.elapsed += delta;
      const lineMat = line.material as THREE.LineBasicMaterial;

      if (ls.phase === 'fadein') {
        ls.opacity = Math.min(ls.elapsed / 0.4, 0.35);
        lineMat.opacity = ls.opacity;
        if (ls.elapsed >= 0.4) { ls.phase = 'travel'; ls.elapsed = 0; }

      } else if (ls.phase === 'travel') {
        ls.t = Math.min(ls.elapsed / 1.8, 1);
        const pos = curve.getPoint(ls.t);
        particle.position.copy(pos);
        particle.visible = true;
        if (ls.elapsed >= 1.8) { ls.phase = 'fadeout'; ls.elapsed = 0; particle.visible = false; }

      } else if (ls.phase === 'fadeout') {
        ls.opacity = Math.max(0.35 - (ls.elapsed / 0.4) * 0.35, 0);
        lineMat.opacity = ls.opacity;
        if (ls.elapsed >= 0.4) {
          // Reset with new pair
          const newLs = makeNewLine();
          ls.src = newLs.src; ls.dst = newLs.dst;
          ls.phase = 'fadein'; ls.elapsed = 0; ls.t = 0;

          const mid = ls.src.clone().add(ls.dst).multiplyScalar(0.5);
          const outward = mid.clone().normalize().multiplyScalar(0.3);
          const newCurve = new THREE.CatmullRomCurve3([ls.src, mid.add(outward), ls.dst]);
          meshesRef.current[i].curve = newCurve;
          const pts = newCurve.getPoints(50);
          line.geometry.setFromPoints(pts);
          line.geometry.attributes.position.needsUpdate = true;
        }
      }
    });
  });

  return <group ref={groupRef} />;
}

// ── Globe + Dots + Atmosphere ───────────────────────────────────────────────
function Globe() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { theme } = useApp();
  const isDark = theme === 'dark';

  const [scale, setScale] = useState(0.85);

  useEffect(() => {
    const start = performance.now();
    const animate = (now: number) => {
      const pct = Math.min((now - start) / 1200, 1);
      // ease-out
      const eased = 1 - Math.pow(1 - pct, 3);
      setScale(0.85 + 0.15 * eased);
      if (pct < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, []);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.0008;
    }
  });

  const dotPositions = useMemo(() => fibonacciSphere(60, 2.4), []);

  return (
    <group scale={scale}>
      {/* Atmosphere halo */}
      <mesh>
        <sphereGeometry args={[2.55, 64, 64]} />
        <meshBasicMaterial
          color="#06b6d4"
          transparent
          opacity={0.04}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Globe sphere */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[2.4, 64, 64]} />
        <meshPhongMaterial
          color={isDark ? '#0A1628' : '#E8E4DC'}
          shininess={8}
        />
      </mesh>

      {/* Agent dots */}
      {dotPositions.map((pos, i) => (
        <AgentDot key={i} position={pos} index={i} />
      ))}

      {/* Communication lines */}
      <CommunicationLines dots={dotPositions} />
    </group>
  );
}

// ── Scene lighting ─────────────────────────────────────────────────────────
function SceneLights() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 3, 2]} intensity={0.8} color="#ffffff" />
      <pointLight position={[-3, -2, 1]} intensity={0.3} color="#06b6d4" />
    </>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────
export default function ThreeGlobe() {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      zIndex: 0,
    }}>
      <Canvas
        camera={{ position: [0, 0, 6], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: true }}
      >
        <SceneLights />
        <Globe />
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate={false}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
    </div>
  );
}
