"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mouse, scroll } from "./useScrollProgress";

/* One shader for the shell and the starfields: soft round points that twinkle,
   shrink with distance, and fade to nothing just before they hit the camera. */
const VERT = /* glsl */ `
attribute float aSeed;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime;
uniform float uPointScale;
uniform float uPixelRatio;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = -mv.z;
  float tw = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 6.28);
  gl_PointSize = min(64.0, aSize * uPointScale * uPixelRatio * (7.0 / max(dist, 0.001)) * (0.85 + 0.15 * tw));
  vAlpha = uOpacity * tw * smoothstep(0.05, 0.55, dist);
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

export function makeMaterial(pixelRatio: number) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPointScale: { value: 1 },
      uPixelRatio: { value: pixelRatio },
      uOpacity: { value: 1 },
    },
  });
}

/* Mostly cool white-blue dust with a few colored specks. */
const PALETTE: [number, THREE.Color][] = [
  [0.45, new THREE.Color("#ffffff")],
  [0.35, new THREE.Color("#8fb4ff")],
  [0.15, new THREE.Color("#4a5f9e")],
  [0.025, new THREE.Color("#ffd9a0")],
  [0.025, new THREE.Color("#9affc8")],
];

function pickColor(r: number, out: Float32Array, i: number) {
  let acc = 0;
  for (const [w, c] of PALETTE) {
    acc += w;
    if (r < acc) {
      const b = c.equals(PALETTE[0][1]) ? 0.55 + Math.random() * 0.35 : 1;
      out[i] = c.r * b;
      out[i + 1] = c.g * b;
      out[i + 2] = c.b * b;
      return;
    }
  }
}

/** Fibonacci sphere: even spacing, no clumping at the poles. */
export function sphereGeometry(count: number) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  let n = 0;
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    if (Math.abs(y) < 0.012) continue; // thin dark equatorial seam
    const rad = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const r = 1 + (Math.random() - 0.5) * 0.035; // shell thickness
    pos[n * 3] = Math.cos(theta) * rad * r;
    pos[n * 3 + 1] = y * r;
    pos[n * 3 + 2] = Math.sin(theta) * rad * r;
    seed[n] = Math.random();
    size[n] = 0.6 + Math.random();
    pickColor(Math.random(), color, n * 3);
    n++;
  }
  return buildGeometry(pos, seed, size, color, n);
}

/** Random points in a thin shell at `radius`, for the starfield layers. */
export function shellGeometry(count: number, radius: number) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const size = new Float32Array(count);
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(1 - u * u) * radius * (0.85 + Math.random() * 0.3);
    pos[i * 3] = Math.cos(t) * rad;
    pos[i * 3 + 1] = u * radius * (0.85 + Math.random() * 0.3);
    pos[i * 3 + 2] = Math.sin(t) * rad;
    seed[i] = Math.random();
    size[i] = 0.4 + Math.random() * 0.6;
    pickColor(Math.random(), color, i * 3);
  }
  return buildGeometry(pos, seed, size, color, count);
}

function buildGeometry(pos: Float32Array, seed: Float32Array, size: Float32Array, color: Float32Array, n: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed.subarray(0, n), 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size.subarray(0, n), 1));
  g.setAttribute("aColor", new THREE.BufferAttribute(color.subarray(0, n * 3), 3));
  return g;
}

interface Props {
  count: number;
  pixelRatio: number;
  reduced: boolean;
}

export function ParticleSphere({ count, pixelRatio, reduced }: Props) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => sphereGeometry(count), [count]);
  const material = useMemo(() => makeMaterial(pixelRatio), [pixelRatio]);
  const t = useRef(0);

  useFrame((_, dt) => {
    const m = ref.current;
    if (!m || reduced) return;
    const p = scroll.value;
    t.current += dt;
    m.rotation.y += dt * 0.035 * (1 + 1.2 * p);
    m.rotation.x = 0.08 * Math.sin(t.current * 0.12) + mouse.y;
    m.rotation.z = mouse.x;
    const u = (m.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = t.current;
    u.uPointScale.value = 1 + 1.6 * p;
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
