"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ParticleSphere } from "./ParticleSphere";
import { Starfield } from "./Starfield";
import { damp, mouse, useScrollProgress } from "./useScrollProgress";

const CAM_START = 3.4;
const CAM_END = -1.2;

/* Read once on the client; the server snapshot is null so nothing mismatches on hydration. */
let env: { webgl: boolean; reduced: boolean; count: number; pixelRatio: number } | null = null;
function readEnv() {
  if (env) return env;
  let webgl = false;
  try {
    const c = document.createElement("canvas");
    webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {}
  const small = window.innerWidth < 768 || (navigator.hardwareConcurrency ?? 8) <= 4;
  env = {
    webgl,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    count: small ? 5500 : 11000,
    pixelRatio: Math.min(2, window.devicePixelRatio || 1),
  };
  return env;
}
const noop = () => () => {};

/** Camera dolly + mouse parallax + visibility pause. Lives inside the Canvas. */
function Rig({ reduced, onLost }: { reduced: boolean; onLost: () => void }) {
  const gl = useThree((s) => s.gl);
  const setFrameloop = useThree((s) => s.setFrameloop);

  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      onLost();
    };
    el.addEventListener("webglcontextlost", lost);
    if (reduced) return () => el.removeEventListener("webglcontextlost", lost);

    const vis = () => setFrameloop(document.hidden ? "never" : "always");
    const move = (e: MouseEvent) => {
      mouse.tx = ((e.clientX / window.innerWidth) * 2 - 1) * 0.045;
      mouse.ty = ((e.clientY / window.innerHeight) * 2 - 1) * 0.045;
    };
    document.addEventListener("visibilitychange", vis);
    if (!window.matchMedia("(pointer: coarse)").matches) window.addEventListener("mousemove", move, { passive: true });
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("mousemove", move);
    };
  }, [gl, reduced, setFrameloop, onLost]);

  useFrame((state, dt) => {
    if (reduced) return;
    const p = damp(dt);
    const e = p * p; // easeInQuad: slow start, accelerating into the shell
    state.camera.position.z = CAM_START + (CAM_END - CAM_START) * e;
  });
  return null;
}

/**
 * Mounted once in the site layout, fixed behind all content. Nothing here is
 * load-bearing: without WebGL the page keeps a black ground with a soft glow.
 */
export function SceneCanvas() {
  const e = useSyncExternalStore(noop, readEnv, () => null);
  const [lost, setLost] = useState(false);
  useScrollProgress();
  if (!e?.webgl || lost) return null;

  return (
    <div className="scene" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: "high-performance", alpha: true }}
        camera={{ fov: 50, near: 0.05, far: 40, position: [0, 0, CAM_START] }}
        frameloop={e.reduced ? "demand" : "always"}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <Rig reduced={e.reduced} onLost={() => setLost(true)} />
        <ParticleSphere count={e.count} pixelRatio={e.pixelRatio} reduced={e.reduced} />
        <Starfield count={600} radius={4} drift={0.012} pixelRatio={e.pixelRatio} reduced={e.reduced} />
        <Starfield count={1400} radius={9} drift={0.006} pixelRatio={e.pixelRatio} reduced={e.reduced} />
      </Canvas>
    </div>
  );
}
