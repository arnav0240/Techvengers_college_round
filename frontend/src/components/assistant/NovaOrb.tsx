import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { audioBus } from '../../features/audio/audioBus';
import type { OrbVisualState } from '../../types';

/**
 * NOVA computational core — technical JARVIS aesthetic.
 * Dark holographic sphere + wireframe grid + thin orbital rings +
 * vertical energy axis + particles travelling on orbit trajectories.
 * No face, no cartoon features. All motion is time-based and damped.
 */

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTION = REDUCED_MOTION ? 0.12 : 1;

interface RingCfg {
  radius: number;
  tube: number;
  color: string;
  tilt: [number, number, number];
  speed: number;
  audioGain: number;
  opacity: number;
  band: 'low' | 'mid' | 'high' | 'mix';
}

const RINGS: RingCfg[] = [
  { radius: 1.52, tube: 0.009, color: '#39d8ff', opacity: 0.9, tilt: [Math.PI / 2.08, 0.12, 0.05], speed: 0.2, audioGain: 0.34, band: 'mid' },
  { radius: 1.74, tube: 0.007, color: '#315bff', opacity: 0.85, tilt: [Math.PI / 1.85, -0.38, 0.42], speed: -0.14, audioGain: 0.4, band: 'low' },
  { radius: 1.96, tube: 0.007, color: '#7c3cff', opacity: 0.8, tilt: [1.02, 0.5, -0.28], speed: 0.1, audioGain: 0.46, band: 'high' },
  { radius: 2.16, tube: 0.006, color: '#a855f7', opacity: 0.7, tilt: [0.72, -0.55, 0.85], speed: -0.08, audioGain: 0.5, band: 'mix' },
  { radius: 2.36, tube: 0.005, color: '#8ea2ff', opacity: 0.5, tilt: [Math.PI / 2.4, 0.25, -0.6], speed: 0.05, audioGain: 0.55, band: 'mix' },
];

function bandValue(band: RingCfg['band']): number {
  if (band === 'low') return audioBus.low;
  if (band === 'mid') return audioBus.mid;
  if (band === 'high') return audioBus.high;
  return (audioBus.low + audioBus.mid + audioBus.high) / 3;
}

interface VisualParams {
  ring: number;
  speed: number;
  core: number;
  axis: number;
  grid: number;
}

function targetParams(s: OrbVisualState): VisualParams {
  switch (s) {
    case 'listening': return { ring: 1.25, speed: 1.25, core: 0.75, axis: 1.0, grid: 0.3 };
    case 'speech': return { ring: 1.55, speed: 1.5, core: 1.15, axis: 1.7, grid: 0.42 };
    case 'thinking': return { ring: 1.45, speed: 2.1, core: 0.95, axis: 1.3, grid: 0.38 };
    case 'executing': return { ring: 1.15, speed: 1.1, core: 0.8, axis: 1.05, grid: 0.3 };
    case 'completed': return { ring: 1.1, speed: 0.8, core: 0.9, axis: 0.95, grid: 0.3 };
    case 'error': return { ring: 0.7, speed: 0.45, core: 0.4, axis: 0.75, grid: 0.2 };
    default: return { ring: 1, speed: 1, core: 0.55, axis: 0.7, grid: 0.22 };
  }
}

function useSmoothParams(visualState: OrbVisualState) {
  const cur = useRef<VisualParams>(targetParams(visualState));
  const errMix = useRef(0);
  const doneMix = useRef(0);
  const update = (dt = 0.016) => {
    const t = targetParams(visualState);
    const k = 1 - Math.exp(-dt * 3.2); // smooth ~300ms transitions
    const c = cur.current;
    c.ring += (t.ring - c.ring) * k;
    c.speed += (t.speed - c.speed) * k;
    c.core += (t.core - c.core) * k;
    c.axis += (t.axis - c.axis) * k;
    c.grid += (t.grid - c.grid) * k;
    errMix.current += ((visualState === 'error' ? 1 : 0) - errMix.current) * k;
    doneMix.current += ((visualState === 'completed' ? 1 : 0) - doneMix.current) * k;
    return { c, errMix: errMix.current, doneMix: doneMix.current };
  };
  return update;
}

function useDispose(obj: { dispose(): void } | null) {
  useEffect(() => () => obj?.dispose(), [obj]);
}

/** Dark semi-transparent holographic core with gentle breathing. */
function Core({ getParams }: { getParams: () => { c: VisualParams } }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshPhysicalMaterial>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const { c } = getParams();
    const s = audioBus.smoothed;
    if (mesh.current) {
      const target = 1 + Math.sin(t * 1.1) * 0.006 * MOTION + s * 0.05;
      mesh.current.scale.setScalar(THREE.MathUtils.lerp(mesh.current.scale.x, target, 0.1));
    }
    if (mat.current) {
      mat.current.emissiveIntensity = THREE.MathUtils.lerp(mat.current.emissiveIntensity, c.core, 0.08);
    }
  });
  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1.02, 48, 48]} />
      <meshPhysicalMaterial
        ref={mat}
        color="#070b18"
        transparent
        opacity={0.96}
        roughness={0.28}
        metalness={0.75}
        clearcoat={0.5}
        clearcoatRoughness={0.4}
        emissive="#1b2c6e"
        emissiveIntensity={0.55}
      />
    </mesh>
  );
}

/** Fine spherical grid shell — the technical readout layer. */
function GridShell({ getParams }: { getParams: () => { c: VisualParams } }) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const geom = useMemo(() => new THREE.SphereGeometry(1.07, 28, 20), []);
  useDispose(geom);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const dtc = Math.min(dt, 0.05);
    const { c } = getParams();
    if (mesh.current) {
      mesh.current.rotation.y += dtc * 0.12 * MOTION * c.speed;
      mesh.current.rotation.x = Math.sin(t * 0.2) * 0.1;
      const target = 1 + audioBus.smoothed * 0.06;
      mesh.current.scale.setScalar(THREE.MathUtils.lerp(mesh.current.scale.x, target, 0.1));
    }
    if (mat.current) {
      const target = Math.min(0.55, c.grid + audioBus.mid * 0.25);
      mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, target, 0.1);
    }
  });
  return (
    <mesh ref={mesh} geometry={geom}>
      <meshBasicMaterial
        ref={mat}
        color="#39d8ff"
        wireframe
        transparent
        opacity={0.22}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Fresnel edge-illumination shell for holographic depth. */
function FresnelShell({ getParams }: { getParams: () => { c: VisualParams; errMix: number } }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const shader = useMemo(
    () => ({
      uniforms: {
        uColor: { value: new THREE.Color('#3b6cff') },
        uIntensity: { value: 0.5 },
      },
      vertex: `
        varying vec3 vN; varying vec3 vV;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragment: `
        uniform vec3 uColor; uniform float uIntensity;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
          gl_FragColor = vec4(uColor, f * uIntensity);
        }`,
    }),
    [],
  );
  const errColor = useMemo(() => new THREE.Color('#ff6488'), []);
  const baseColor = useMemo(() => new THREE.Color('#3b6cff'), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    const t = clock.elapsedTime;
    const { c, errMix } = getParams();
    const s = audioBus.smoothed;
    const target = 0.42 + Math.sin(t * 1.2) * 0.06 * MOTION + s * 0.8 + (c.ring - 1) * 0.2;
    mat.current.uniforms.uIntensity.value = THREE.MathUtils.lerp(
      mat.current.uniforms.uIntensity.value as number,
      Math.max(0.25, target),
      0.1,
    );
    tmp.lerpColors(baseColor, errColor, errMix);
    (mat.current.uniforms.uColor.value as THREE.Color).lerp(tmp, 0.08);
  });
  return (
    <mesh scale={1.3}>
      <sphereGeometry args={[1.12, 48, 48]} />
      <shaderMaterial
        ref={mat}
        uniforms={shader.uniforms}
        vertexShader={shader.vertex}
        fragmentShader={shader.fragment}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

/** Thin intersecting orbital rings — each with own radius/orientation/speed. */
function OrbitRings({ getParams }: { getParams: () => { c: VisualParams; errMix: number } }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const geoms = useMemo(() => RINGS.map((r) => new THREE.TorusGeometry(r.radius, r.tube, 12, 200)), []);
  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms]);
  const baseColors = useMemo(() => RINGS.map((r) => new THREE.Color(r.color)), []);
  const errColor = useMemo(() => new THREE.Color('#ff6488'), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const dtc = Math.min(dt, 0.05);
    const { c, errMix } = getParams();
    const s = audioBus.smoothed;
    RINGS.forEach((cfg, i) => {
      const m = refs.current[i];
      const mat = mats.current[i];
      if (!m) return;
      const band = bandValue(cfg.band);
      const dir = cfg.speed >= 0 ? 1 : -1;
      const spd = Math.abs(cfg.speed) * MOTION * c.speed * (1 + s * 2.0 + band * 1.1);
      m.rotation.x += dtc * spd * dir;
      m.rotation.y += dtc * spd * dir * 0.6;
      const pulse = (1 + Math.sin(t * 1.05 + i * 1.9) * 0.008 * MOTION + band * cfg.audioGain + s * cfg.audioGain * 0.6) * (0.96 + c.ring * 0.04);
      m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, pulse, 0.12));
      if (mat) {
        const target = Math.min(1, cfg.opacity * c.ring + band * 0.3 + s * 0.25);
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, 0.12);
        // Restrained error cue: outermost ring tints red; shape + text carry the rest.
        if (i === RINGS.length - 1) {
          tmp.lerpColors(baseColors[i], errColor, errMix);
          mat.color.lerp(tmp, 0.1);
        }
      }
    });
  });

  return (
    <group>
      {RINGS.map((cfg, i) => (
        <mesh
          key={i}
          geometry={geoms[i]}
          rotation={cfg.tilt}
          ref={(el) => {
            refs.current[i] = el;
          }}
        >
          <meshBasicMaterial
            ref={(el) => {
              mats.current[i] = el;
            }}
            color={cfg.color}
            transparent
            opacity={cfg.opacity}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Luminous vertical energy axis through the core. */
function EnergyAxis({ getParams }: { getParams: () => { c: VisualParams; errMix: number; doneMix: number } }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const nodeMat = useRef<THREE.MeshBasicMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const base = useMemo(() => new THREE.Color('#39d8ff'), []);
  const err = useMemo(() => new THREE.Color('#ff6488'), []);
  const done = useMemo(() => new THREE.Color('#31e8c0'), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const tmp2 = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const { c, errMix, doneMix } = getParams();
    const s = audioBus.smoothed;
    const blink = 0.72 + 0.28 * Math.sin(t * (errMix > 0.5 ? 3.2 : 1.6));
    const target = Math.min(1, (0.35 + c.axis * 0.4 + audioBus.high * 0.4 + s * 0.3) * blink);
    if (mat.current) {
      mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, target, 0.12);
      tmp.lerpColors(base, err, errMix);
      tmp2.lerpColors(tmp, done, doneMix * 0.8);
      mat.current.color.lerp(tmp2, 0.1);
      if (nodeMat.current) {
        nodeMat.current.opacity = THREE.MathUtils.lerp(nodeMat.current.opacity, Math.min(1, target + 0.15), 0.12);
        nodeMat.current.color.copy(mat.current.color);
      }
    }
    if (group.current) {
      group.current.scale.y = THREE.MathUtils.lerp(group.current.scale.y, 1 + s * 0.05, 0.1);
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <cylinderGeometry args={[0.011, 0.011, 5.6, 12, 1, true]} />
        <meshBasicMaterial
          ref={mat}
          color="#39d8ff"
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {[-2.8, 2.8].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <octahedronGeometry args={[0.07]} />
          <meshBasicMaterial
            ref={y > 0 ? nodeMat : undefined}
            color="#39d8ff"
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function makeOrbitPoints(radius: number, tilt: [number, number, number], count: number, seed: number) {
  const pos = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const e = new THREE.Euler(...tilt);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + seed;
    v.set(Math.cos(a) * radius, 0, Math.sin(a) * radius).applyEuler(e);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/** Small particles travelling along selected orbit trajectories. */
function OrbitParticles({ getParams }: { getParams: () => { c: VisualParams } }) {
  const g1 = useRef<THREE.Group>(null);
  const g2 = useRef<THREE.Group>(null);
  const m1 = useRef<THREE.PointsMaterial>(null);
  const m2 = useRef<THREE.PointsMaterial>(null);
  const geomA = useMemo(() => makeOrbitPoints(1.74, [Math.PI / 1.85, -0.38, 0.42], 42, 0.4), []);
  const geomB = useMemo(() => makeOrbitPoints(2.16, [0.72, -0.55, 0.85], 30, 1.7), []);
  useDispose(geomA);
  useDispose(geomB);

  useFrame((_, dt) => {
    const dtc = Math.min(dt, 0.05);
    const { c } = getParams();
    const s = audioBus.smoothed;
    const w = MOTION * c.speed * (0.35 + s * 1.6 + audioBus.mid * 0.5);
    if (g1.current) g1.current.rotation.y += dtc * w;
    if (g2.current) g2.current.rotation.y -= dtc * w * 0.7;
    if (m1.current) m1.current.opacity = THREE.MathUtils.lerp(m1.current.opacity, Math.min(1, 0.55 + s * 0.45 + (c.ring - 1) * 0.3), 0.12);
    if (m2.current) m2.current.opacity = THREE.MathUtils.lerp(m2.current.opacity, Math.min(1, 0.45 + s * 0.4), 0.12);
  });

  return (
    <>
      <group ref={g1}>
        <points geometry={geomA}>
          <pointsMaterial ref={m1} size={0.045} color="#39d8ff" transparent opacity={0.7} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation toneMapped={false} />
        </points>
      </group>
      <group ref={g2}>
        <points geometry={geomB}>
          <pointsMaterial ref={m2} size={0.05} color="#a855f7" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation toneMapped={false} />
        </points>
      </group>
    </>
  );
}

/** Auto-fit: keep the full orb (rings + energy axis) inside the stage,
 *  with vertical clearance for the command deck overlay. */
function useOrbFit() {
  const size = useThree((s) => s.size);
  return useMemo(() => {
    const camZ = 8.8;
    const halfVisH = camZ * Math.tan((40 * Math.PI) / 360); // world half-height at z=0
    const halfVisW = halfVisH * (size.width / Math.max(1, size.height));
    // Orb extent: energy axis half-height 2.8 + margin; rings radius 2.36 + growth.
    const extent = 2.95;
    const fitH = (halfVisH * 2 * 0.86) / (extent * 2); // 86% of height, deck eats bottom
    const fitW = (halfVisW * 2 * 0.84) / (extent * 2);
    const scale = Math.max(0.42, Math.min(1, fitH, fitW));
    return scale;
  }, [size.width, size.height]);
}

function Scene({ visualState }: { visualState: OrbVisualState }) {
  const group = useRef<THREE.Group>(null);
  const getParams = useSmoothParams(visualState);
  const scale = useOrbFit();

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.position.y = 0.35 + Math.sin(t * 0.85) * 0.045 * MOTION;
    group.current.rotation.y = Math.sin(t * 0.22) * 0.06 * MOTION;
  });

  return (
    <>
      <ambientLight intensity={0.55} color="#8ea2ff" />
      <pointLight position={[4, 3, 5]} intensity={26} color="#315bff" distance={22} />
      <pointLight position={[-4, -2, 4]} intensity={18} color="#7c3cff" distance={22} />
      <pointLight position={[0, 4, -4]} intensity={12} color="#39d8ff" distance={20} />
      <directionalLight position={[0, 2, 6]} intensity={0.6} color="#ffffff" />
      <group ref={group} scale={scale}>
        <FresnelShell getParams={getParams} />
        <Core getParams={getParams} />
        <GridShell getParams={getParams} />
        <OrbitRings getParams={getParams} />
        <EnergyAxis getParams={getParams} />
        <OrbitParticles getParams={getParams} />
      </group>
      <Sparkles count={50} scale={[9, 6, 6]} size={2} speed={0.22} opacity={0.45} color="#7fa8ff" position={[0, 0, -2]} />
    </>
  );
}

export default function NovaOrbCanvas({ visualState }: { visualState: OrbVisualState }) {
  return (
    <div className="absolute inset-0" role="img" aria-label={`NOVA computational core, state ${visualState}`}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 8.8], fov: 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ height: '100%', width: '100%', background: 'transparent' }}
      >
        <Scene visualState={visualState} />
      </Canvas>
    </div>
  );
}
