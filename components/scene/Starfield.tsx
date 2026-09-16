"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type * as THREE from "three";
import { makeMaterial, shellGeometry } from "./ParticleSphere";
import { scroll } from "./useScrollProgress";

interface Props {
  count: number;
  radius: number;
  /** rad/s */
  drift: number;
  pixelRatio: number;
  reduced: boolean;
}

/** A dim, slow star layer that fades in as the camera passes through the shell. */
export function Starfield({ count, radius, drift, pixelRatio, reduced }: Props) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => shellGeometry(count, radius), [count, radius]);
  const material = useMemo(() => {
    const m = makeMaterial(pixelRatio);
    m.uniforms.uPointScale.value = 0.9;
    m.uniforms.uOpacity.value = 0;
    return m;
  }, [pixelRatio]);
  const t = useRef(0);

  useFrame((_, dt) => {
    if (!ref.current || reduced) return;
    const p = scroll.value;
    t.current += dt;
    ref.current.rotation.y += dt * drift;
    ref.current.rotation.x = 0.05 * Math.sin(t.current * 0.07);
    const u = (ref.current.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value = t.current;
    u.uOpacity.value = Math.min(1, Math.max(0, (p - 0.35) / 0.45)) * 0.9;
  });

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />;
}
