'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

interface SpaceSceneProps {
  onBlackHoleClick?: () => void;
  /** When false, the scene renders as a fixed, non-interactive backdrop (no pointer events, no click). */
  interactive?: boolean;
  /** z-index applied to the canvas container. */
  zIndex?: number;
}

function hsl(h: number, s: number, l: number, c: THREE.Color): void { c.setHSL(h, s, l); }

/**
 * Soft radial-gradient sprite used as the point texture so particles render as
 * smooth round dots instead of hard squares (the default PointsMaterial look).
 */
function makeSpriteTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.Texture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function spiralXZ(off: number, t: number, tw: number, sc: number): [number, number] {
  const a = off + t * tw + (Math.random() - 0.5) * sc;
  return [Math.cos(a) * t, Math.sin(a) * t];
}

function makeCloud(
  cx: number, cy: number, cz: number, radius: number, n: number,
  hue: number, sat: number, lum: number, flatY: number,
  size: number, opacity: number, scene: THREE.Scene, sprite: THREE.Texture,
): THREE.Points {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), co = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const r = Math.pow(Math.random(), 0.65) * radius;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const sp = Math.sin(ph);
    p[i * 3] = cx + r * sp * Math.cos(th);
    p[i * 3 + 1] = cy + r * sp * Math.sin(th) * flatY;
    p[i * 3 + 2] = cz + r * Math.cos(ph);
    c.setHSL(hue + (Math.random() - 0.5) * 0.06, sat + Math.random() * 0.12, lum + Math.random() * 0.12);
    co[i * 3] = c.r; co[i * 3 + 1] = c.g; co[i * 3 + 2] = c.b;
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(co, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    size, vertexColors: true, sizeAttenuation: true, transparent: true,
    opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    map: sprite, alphaMap: sprite,
  }));
  scene.add(pts);
  return pts;
}

const SpaceScene: React.FC<SpaceSceneProps> = ({ onBlackHoleClick, interactive = true, zIndex = 0 }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const clickRef = useRef(onBlackHoleClick);
  useEffect(() => { clickRef.current = onBlackHoleClick; }, [onBlackHoleClick]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const W = mount.clientWidth, H = Math.max(mount.clientHeight, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000003);
    scene.fog = new THREE.FogExp2(0x000003, 0.001);

    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 2000);
    camera.position.set(0, 22, 32);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = interactive && !reducedMotion;
    controls.dampingFactor = 0.06;
    controls.minDistance = 3;
    controls.maxDistance = 280;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = interactive ? 0.12 : 0.09;
    controls.target.set(0, 0, 0);
    controls.enablePan = false;
    controls.enabled = interactive;

    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const c = new THREE.Color();
    const sprite = makeSpriteTexture();

    /* ── Cinematic bloom post-processing ─────────────────────────── */
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    composer.setSize(W, H);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(W, H),
      interactive ? 0.6 : 0.48, // strength
      0.5, // radius
      0.2, // threshold
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    /* ── 1. Background stars ─────────────────────────────────────── */
    const BG = 10000;
    const bgG = new THREE.BufferGeometry();
    const bgP = new Float32Array(BG * 3), bgC = new Float32Array(BG * 3);
    for (let i = 0; i < BG; i++) {
      const r = 130 + Math.random() * 650;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = Math.sin(ph);
      bgP[i * 3] = r * sp * Math.cos(th);
      bgP[i * 3 + 1] = r * sp * Math.sin(th);
      bgP[i * 3 + 2] = r * Math.cos(ph);
      const k = Math.random();
      if (k < 0.12) hsl(0.0, 0.75, 0.5 + Math.random() * 0.2, c);
      else if (k < 0.45) hsl(0.12, 0.3, 0.7 + Math.random() * 0.2, c);
      else if (k < 0.75) hsl(0.55, 0.2, 0.8 + Math.random() * 0.15, c);
      else hsl(0.62, 0.6, 0.85 + Math.random() * 0.1, c);
      bgC[i * 3] = c.r; bgC[i * 3 + 1] = c.g; bgC[i * 3 + 2] = c.b;
    }
    bgG.setAttribute('position', new THREE.BufferAttribute(bgP, 3));
    bgG.setAttribute('color', new THREE.BufferAttribute(bgC, 3));
    scene.add(new THREE.Points(bgG, new THREE.PointsMaterial({
      size: 0.4, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.85, depthWrite: false,
      map: sprite, alphaMap: sprite, blending: THREE.AdditiveBlending,
    })));

    /* ── 2. Distant galaxies ─────────────────────────────────────── */
    const distGalGroup = new THREE.Group();
    for (let g = 0; g < 25; g++) {
      const cnt = 160 + Math.floor(Math.random() * 280);
      const geo = new THREE.BufferGeometry();
      const ps = new Float32Array(cnt * 3), cl = new Float32Array(cnt * 3);
      const gR = 2 + Math.random() * 5;
      const arms = Math.random() > 0.35 ? (2 + Math.floor(Math.random() * 3)) : 0;
      const hu = 0.05 + Math.random() * 0.55;
      for (let s = 0; s < cnt; s++) {
        let lx: number, lz: number;
        if (arms > 0) {
          const arm = s % arms, t = Math.pow(Math.random(), 0.5) * gR;
          const a = (arm / arms) * Math.PI * 2 + (t / gR) * 2.5 + (Math.random() - 0.5) * 0.6;
          lx = Math.cos(a) * t + (Math.random() - 0.5) * 0.6;
          lz = Math.sin(a) * t + (Math.random() - 0.5) * 0.6;
        } else {
          const t = Math.pow(Math.random(), 1.8) * gR, a = Math.random() * Math.PI * 2;
          lx = Math.cos(a) * t; lz = Math.sin(a) * t * (0.4 + Math.random() * 0.6);
        }
        ps[s * 3] = lx; ps[s * 3 + 1] = (Math.random() - 0.5) * 0.3; ps[s * 3 + 2] = lz;
        c.setHSL(hu + (Math.random() - 0.5) * 0.08, 0.4 + Math.random() * 0.3, 0.5 + Math.random() * 0.35);
        cl[s * 3] = c.r; cl[s * 3 + 1] = c.g; cl[s * 3 + 2] = c.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(ps, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.5, vertexColors: true, sizeAttenuation: true,
        transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
        map: sprite, alphaMap: sprite,
      }));
      const d = 75 + Math.random() * 170, ang = Math.random() * Math.PI * 2, el = (Math.random() - 0.5) * 90;
      pts.position.set(Math.cos(ang) * d, el, Math.sin(ang) * d);
      pts.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      distGalGroup.add(pts);
    }
    scene.add(distGalGroup);

    /* ── 3. Colliding galaxies pair ──────────────────────────────── */
    const collGroup = new THREE.Group();
    collGroup.position.set(-110, 15, -90);
    for (let gal = 0; gal < 2; gal++) {
      const cnt = 600, geo = new THREE.BufferGeometry();
      const ps = new Float32Array(cnt * 3), cl = new Float32Array(cnt * 3);
      const ox = gal === 0 ? -3 : 3;
      for (let s = 0; s < cnt; s++) {
        const t = Math.pow(Math.random(), 0.6) * 6;
        const arm = s % 2, off = (arm / 2) * Math.PI * 2 + gal * 0.8;
        const a = off + (t / 6) * 3 + (Math.random() - 0.5) * 0.7;
        const warp = gal === 0 ? Math.sin(t * 0.4) * 1.5 : -Math.sin(t * 0.3) * 1.2;
        ps[s * 3] = ox + Math.cos(a) * t + (Math.random() - 0.5) * 1.2;
        ps[s * 3 + 1] = (Math.random() - 0.5) * 0.5 + warp * 0.3;
        ps[s * 3 + 2] = Math.sin(a) * t + warp + (Math.random() - 0.5) * 1.2;
        const hu = gal === 0 ? 0.58 + Math.random() * 0.08 : 0.08 + Math.random() * 0.06;
        c.setHSL(hu, 0.6 + Math.random() * 0.2, 0.45 + Math.random() * 0.3);
        cl[s * 3] = c.r; cl[s * 3 + 1] = c.g; cl[s * 3 + 2] = c.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(ps, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      collGroup.add(new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.55, vertexColors: true, sizeAttenuation: true,
        transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
        map: sprite, alphaMap: sprite,
      })));
    }
    const tidalN = 300, tidalGeo = new THREE.BufferGeometry();
    const tidalP = new Float32Array(tidalN * 3), tidalC = new Float32Array(tidalN * 3);
    for (let i = 0; i < tidalN; i++) {
      const t = Math.random();
      tidalP[i * 3] = (Math.random() - 0.5) * 14;
      tidalP[i * 3 + 1] = (Math.random() - 0.5) * 3 + Math.sin(t * 4) * 2;
      tidalP[i * 3 + 2] = (Math.random() - 0.5) * 14;
      c.setHSL(0.55 + Math.random() * 0.15, 0.5, 0.4 + Math.random() * 0.2);
      tidalC[i * 3] = c.r; tidalC[i * 3 + 1] = c.g; tidalC[i * 3 + 2] = c.b;
    }
    tidalGeo.setAttribute('position', new THREE.BufferAttribute(tidalP, 3));
    tidalGeo.setAttribute('color', new THREE.BufferAttribute(tidalC, 3));
    collGroup.add(new THREE.Points(tidalGeo, new THREE.PointsMaterial({
      size: 0.45, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
      map: sprite, alphaMap: sprite,
    })));
    scene.add(collGroup);

    /* ── 4. Boomerang Nebula (coldest object — icy blue bipolar) ── */
    const boomGroup = new THREE.Group();
    boomGroup.position.set(80, -10, 55);
    for (let lobe = 0; lobe < 2; lobe++) {
      const dir = lobe === 0 ? 1 : -1;
      const cnt = 500, geo = new THREE.BufferGeometry();
      const ps = new Float32Array(cnt * 3), cl = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        const t = Math.random() * 8;
        const spread = t * 0.35;
        ps[i * 3] = (Math.random() - 0.5) * spread;
        ps[i * 3 + 1] = dir * t + (Math.random() - 0.5) * spread * 0.3;
        ps[i * 3 + 2] = (Math.random() - 0.5) * spread;
        c.setHSL(0.55 + Math.random() * 0.05, 0.3 + Math.random() * 0.2, 0.7 + Math.random() * 0.2);
        cl[i * 3] = c.r; cl[i * 3 + 1] = c.g; cl[i * 3 + 2] = c.b;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(ps, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      boomGroup.add(new THREE.Points(geo, new THREE.PointsMaterial({
        size: 1.6, vertexColors: true, sizeAttenuation: true,
        transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false,
        map: sprite, alphaMap: sprite,
      })));
    }
    const boomCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.8 })
    );
    boomGroup.add(boomCore);
    scene.add(boomGroup);

    /* ── 5. Veil Nebula remnant (filamentary supernova shell) ───── */
    const veilGroup = new THREE.Group();
    veilGroup.position.set(-70, 18, -45);
    const veilN = 1200, veilGeo = new THREE.BufferGeometry();
    const vP = new Float32Array(veilN * 3), vC = new Float32Array(veilN * 3);
    for (let i = 0; i < veilN; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const r = 10 + (Math.random() - 0.5) * 2.5;
      const sp = Math.sin(ph);
      vP[i * 3] = r * sp * Math.cos(th) + (Math.random() - 0.5) * 1.5;
      vP[i * 3 + 1] = r * sp * Math.sin(th) * 0.7 + (Math.random() - 0.5) * 1;
      vP[i * 3 + 2] = r * Math.cos(ph) + (Math.random() - 0.5) * 1.5;
      const seg = (th / (Math.PI * 2));
      if (seg < 0.33) c.setHSL(0.0, 0.7, 0.4 + Math.random() * 0.2);
      else if (seg < 0.66) c.setHSL(0.55, 0.65, 0.4 + Math.random() * 0.25);
      else c.setHSL(0.42, 0.6, 0.35 + Math.random() * 0.2);
      vC[i * 3] = c.r; vC[i * 3 + 1] = c.g; vC[i * 3 + 2] = c.b;
    }
    veilGeo.setAttribute('position', new THREE.BufferAttribute(vP, 3));
    veilGeo.setAttribute('color', new THREE.BufferAttribute(vC, 3));
    veilGroup.add(new THREE.Points(veilGeo, new THREE.PointsMaterial({
      size: 1.2, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending, depthWrite: false,
      map: sprite, alphaMap: sprite,
    })));
    scene.add(veilGroup);

    /* ── 6. Planetary nebula (ring/shell + central white dwarf) ── */
    const pnGroup = new THREE.Group();
    pnGroup.position.set(50, -20, -70);
    const pnN = 800, pnGeo = new THREE.BufferGeometry();
    const pnP = new Float32Array(pnN * 3), pnC = new Float32Array(pnN * 3);
    for (let i = 0; i < pnN; i++) {
      const th = Math.random() * Math.PI * 2;
      const r = 4 + (Math.random() - 0.5) * 1.8;
      const y = (Math.random() - 0.5) * 2.5;
      pnP[i * 3] = Math.cos(th) * r;
      pnP[i * 3 + 1] = y;
      pnP[i * 3 + 2] = Math.sin(th) * r;
      const rim = Math.abs(y) / 1.25;
      c.setHSL(0.45 + rim * 0.1, 0.7 + Math.random() * 0.15, 0.35 + (1 - rim) * 0.3);
      pnC[i * 3] = c.r; pnC[i * 3 + 1] = c.g; pnC[i * 3 + 2] = c.b;
    }
    pnGeo.setAttribute('position', new THREE.BufferAttribute(pnP, 3));
    pnGeo.setAttribute('color', new THREE.BufferAttribute(pnC, 3));
    pnGroup.add(new THREE.Points(pnGeo, new THREE.PointsMaterial({
      size: 1.0, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false,
      map: sprite, alphaMap: sprite,
    })));
    const whiteDwarf = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xeeeeff, transparent: true, opacity: 0.95 })
    );
    pnGroup.add(whiteDwarf);
    scene.add(pnGroup);

    /* ── 7. Type Ia Supernova (bright flash + expanding shell) ─── */
    const sn1aGroup = new THREE.Group();
    sn1aGroup.position.set(-45, -8, 65);
    const sn1aCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
    );
    sn1aGroup.add(sn1aCore);
    const sn1aGlowSizes = [1.5, 3.0, 5.0];
    const sn1aGlows: THREE.Mesh[] = [];
    for (const sz of sn1aGlowSizes) {
      const gm = new THREE.Mesh(
        new THREE.SphereGeometry(sz, 20, 20),
        new THREE.MeshBasicMaterial({
          color: 0xffcc44, transparent: true, opacity: 0.04,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      sn1aGroup.add(gm);
      sn1aGlows.push(gm);
    }
    makeCloud(-45, -8, 65, 8, 400, 0.08, 0.7, 0.45, 0.8, 2.0, 0.05, scene, sprite);
    scene.add(sn1aGroup);

    /* ── 8. Supernova remnant (Crab-like) ────────────────────────── */
    makeCloud(40, 25, -40, 12, 900, 0.0, 0.7, 0.35, 0.7, 2.5, 0.06, scene, sprite);
    makeCloud(40, 25, -40, 8, 500, 0.55, 0.6, 0.45, 0.7, 1.8, 0.05, scene, sprite);
    const crabPulsar = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xccffff, transparent: true, opacity: 0.9 })
    );
    crabPulsar.position.set(40, 25, -40);
    scene.add(crabPulsar);

    /* ── 9. Emission nebulae (Orion-like, Carina-like) ───────────── */
    makeCloud(55, 5, -25, 15, 900, 0.95, 0.7, 0.35, 0.6, 3.2, 0.065, scene, sprite);
    makeCloud(-50, -15, 35, 18, 1100, 0.93, 0.65, 0.32, 0.55, 3.8, 0.055, scene, sprite);
    makeCloud(-25, 28, -65, 12, 600, 0.6, 0.5, 0.4, 0.65, 2.8, 0.06, scene, sprite);

    /* ── 10. Pulsars with beams ──────────────────────────────────── */
    const pulsarGroup = new THREE.Group();
    const pulsarData: { mesh: THREE.Mesh; b1: THREE.Mesh; b2: THREE.Mesh }[] = [];
    const pulsarPos: [number, number, number][] = [
      [32, 3, -18], [-28, -6, 25], [15, 14, -42], [-18, 10, -55], [25, -12, 40],
    ];
    for (const [px, py, pz] of pulsarPos) {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xccffff, transparent: true, opacity: 1 })
      );
      core.position.set(px, py, pz);
      pulsarGroup.add(core);
      const bGeo = new THREE.CylinderGeometry(0.015, 0.12, 5, 6);
      const bMat = () => new THREE.MeshBasicMaterial({
        color: 0x88ddff, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const b1 = new THREE.Mesh(bGeo, bMat());
      b1.position.set(px, py + 2.5, pz);
      pulsarGroup.add(b1);
      const b2 = new THREE.Mesh(bGeo, bMat());
      b2.position.set(px, py - 2.5, pz);
      b2.rotation.z = Math.PI;
      pulsarGroup.add(b2);
      pulsarData.push({ mesh: core, b1, b2 });
    }
    scene.add(pulsarGroup);

    /* ── 11. Main spiral galaxy ──────────────────────────────────── */
    const ARM = 5, SPA = 4500, BLG = 6000, HII = 500, GR = 24, TW = 3.2;
    const total = ARM * SPA + BLG + HII;
    const gP = new Float32Array(total * 3), gC = new Float32Array(total * 3);
    let gi = 0;
    for (let arm = 0; arm < ARM; arm++) {
      const off = (arm / ARM) * Math.PI * 2;
      for (let s = 0; s < SPA; s++) {
        const t = Math.pow(Math.random(), 0.55) * GR;
        const [lx, lz] = spiralXZ(off, t, TW / GR, 0.4 + t * 0.015);
        const sc = (1 - (t / GR) * 0.35) * 1.6;
        gP[gi * 3] = lx + (Math.random() - 0.5) * sc;
        gP[gi * 3 + 1] = (Math.random() - 0.5) * (0.25 + (1 - t / GR) * 0.5);
        gP[gi * 3 + 2] = lz + (Math.random() - 0.5) * sc;
        const n = t / GR;
        if (n < 0.35) hsl(0.6 + n * 0.05, 0.7, 0.75 - n * 0.4, c);
        else if (n < 0.7) hsl(0.58, 0.5 + n * 0.15, 0.5 + (1 - n) * 0.3, c);
        else hsl(0.55 + n * 0.12, 0.6, 0.4 + Math.random() * 0.2, c);
        gC[gi * 3] = c.r; gC[gi * 3 + 1] = c.g; gC[gi * 3 + 2] = c.b;
        gi++;
      }
    }
    for (let b = 0; b < BLG; b++) {
      const r = Math.pow(Math.random(), 2.8) * 5.5, a = Math.random() * Math.PI * 2;
      gP[gi * 3] = Math.cos(a) * r;
      gP[gi * 3 + 1] = (Math.random() - 0.5) * Math.max(0.15, 0.8 - r * 0.1);
      gP[gi * 3 + 2] = Math.sin(a) * r;
      hsl(0.1 + (r / 5.5) * 0.04, 0.5 - (r / 5.5) * 0.25, 0.9 - (r / 5.5) * 0.35, c);
      gC[gi * 3] = c.r; gC[gi * 3 + 1] = c.g; gC[gi * 3 + 2] = c.b;
      gi++;
    }
    for (let h = 0; h < HII; h++) {
      const arm = Math.floor(Math.random() * ARM);
      const off = (arm / ARM) * Math.PI * 2;
      const t = (0.3 + Math.random() * 0.5) * GR;
      const [lx, lz] = spiralXZ(off, t, TW / GR, 0.35);
      gP[gi * 3] = lx + (Math.random() - 0.5) * 1.2;
      gP[gi * 3 + 1] = (Math.random() - 0.5) * 0.15;
      gP[gi * 3 + 2] = lz + (Math.random() - 0.5) * 1.2;
      c.setHSL(0.93 + Math.random() * 0.05, 0.8, 0.55 + Math.random() * 0.15);
      gC[gi * 3] = c.r; gC[gi * 3 + 1] = c.g; gC[gi * 3 + 2] = c.b;
      gi++;
    }
    const galaxyGeo = new THREE.BufferGeometry();
    galaxyGeo.setAttribute('position', new THREE.BufferAttribute(gP, 3));
    galaxyGeo.setAttribute('color', new THREE.BufferAttribute(gC, 3));
    const galaxyMat = new THREE.PointsMaterial({
      size: 0.28, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.92, depthWrite: false, blending: THREE.AdditiveBlending,
      map: sprite, alphaMap: sprite,
    });
    const galaxy = new THREE.Points(galaxyGeo, galaxyMat);
    scene.add(galaxy);

    /* ── 12. Dust lanes ──────────────────────────────────────────── */
    const DUST = 1400;
    const dustG = new THREE.BufferGeometry();
    const dP = new Float32Array(DUST * 3), dC = new Float32Array(DUST * 3);
    for (let d = 0; d < DUST; d++) {
      const arm = Math.floor(Math.random() * ARM);
      const off = (arm / ARM) * Math.PI * 2;
      const t = (0.12 + Math.random() * 0.75) * GR;
      const [lx, lz] = spiralXZ(off, t, TW / GR, 0.5);
      dP[d * 3] = lx + (Math.random() - 0.5) * 2.5;
      dP[d * 3 + 1] = (Math.random() - 0.5) * 0.3;
      dP[d * 3 + 2] = lz + (Math.random() - 0.5) * 2.5;
      c.setHSL(0.55 + Math.random() * 0.12, 0.6, 0.3 + Math.random() * 0.1);
      dC[d * 3] = c.r; dC[d * 3 + 1] = c.g; dC[d * 3 + 2] = c.b;
    }
    dustG.setAttribute('position', new THREE.BufferAttribute(dP, 3));
    dustG.setAttribute('color', new THREE.BufferAttribute(dC, 3));
    scene.add(new THREE.Points(dustG, new THREE.PointsMaterial({
      size: 1.4, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false,
      map: sprite, alphaMap: sprite,
    })));

    /* ── 13. Black hole ──────────────────────────────────────────── */
    const bhGroup = new THREE.Group();
    const eventHorizon = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    bhGroup.add(eventHorizon);
    const diskIn = 0.9, diskOut = 4.0;
    const diskGeo = new THREE.RingGeometry(diskIn, diskOut, 160, 6);
    const diskCol = new Float32Array(diskGeo.attributes.position.count * 3);
    const dpa = diskGeo.attributes.position;
    for (let i = 0; i < dpa.count; i++) {
      const dist = Math.sqrt(dpa.getX(i) ** 2 + dpa.getY(i) ** 2);
      const n = (dist - diskIn) / (diskOut - diskIn);
      const ang = Math.atan2(dpa.getY(i), dpa.getX(i));
      const doppler = 0.85 + Math.sin(ang) * 0.15;
      if (n < 0.25) c.setHSL(0.53, 0.95, (0.9 - n * 2) * doppler);
      else if (n < 0.55) c.setHSL(0.09 + n * 0.04, 0.9, (0.7 - n * 0.4) * doppler);
      else c.setHSL(0.02, 0.75 - n * 0.3, (0.35 - n * 0.2) * doppler);
      diskCol[i * 3] = c.r; diskCol[i * 3 + 1] = c.g; diskCol[i * 3 + 2] = c.b;
    }
    diskGeo.setAttribute('color', new THREE.BufferAttribute(diskCol, 3));
    const accDisk = new THREE.Mesh(diskGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    accDisk.rotation.x = -Math.PI / 2;
    bhGroup.add(accDisk);
    // Soft, camera-facing glow halo (smooth gravitational-lensing bloom) instead of hard rings.
    const glowLayers: THREE.Sprite[] = [];
    const glowConf: [number, number, number][] = [
      [9, 0x00e5ff, 0.32], [12.5, 0xff7700, 0.17], [16, 0xff00aa, 0.09], [21, 0x7c3aed, 0.05],
    ];
    for (const [scl, col, op] of glowConf) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sprite, color: col, transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sp.scale.setScalar(scl);
      bhGroup.add(sp); glowLayers.push(sp);
    }
    const photonRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.05, 24, 160),
      new THREE.MeshBasicMaterial({
        color: 0xfff2d0, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    photonRing.rotation.x = Math.PI / 2;
    bhGroup.add(photonRing);
    const jetMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const jetGeo = new THREE.ConeGeometry(0.6, 12, 16, 1, true);
    const jetUp = new THREE.Mesh(jetGeo, jetMat);
    jetUp.position.y = 6;
    bhGroup.add(jetUp);
    const jetDown = new THREE.Mesh(jetGeo, jetMat.clone());
    jetDown.position.y = -6;
    jetDown.rotation.z = Math.PI;
    bhGroup.add(jetDown);
    scene.add(bhGroup);

    /* ── 14. Solar system ────────────────────────────────────────── */
    const solarGroup = new THREE.Group();
    const solarT = 0.65 * GR;
    const solarOff = (2 / ARM) * Math.PI * 2;
    const solarAng = solarOff + (solarT / GR) * (TW / GR) * GR;
    solarGroup.position.set(Math.cos(solarAng) * solarT, 0.1, Math.sin(solarAng) * solarT);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), new THREE.MeshBasicMaterial({ color: 0xffdd44 }));
    solarGroup.add(sun);
    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    solarGroup.add(sunGlow);
    const planetData: { mesh: THREE.Mesh; dist: number; speed: number; angle: number }[] = [];
    const planets: [number, number, number, number][] = [
      [0.04,0.45,4.1,0x999999],[0.055,0.65,3.2,0xe8cfa0],[0.06,0.85,2.6,0x4488ff],
      [0.05,1.1,2.0,0xcc4422],[0.12,1.55,1.1,0xddaa66],[0.1,1.95,0.8,0xccbb77],
      [0.07,2.35,0.55,0x88ccdd],[0.065,2.7,0.4,0x3355bb],
    ];
    for (const [rad, dist, spd, col] of planets) {
      const oG = new THREE.BufferGeometry();
      const oA = new Float32Array(64 * 3);
      for (let o = 0; o < 64; o++) { const a = (o / 64) * Math.PI * 2; oA[o * 3] = Math.cos(a) * dist; oA[o * 3 + 1] = 0; oA[o * 3 + 2] = Math.sin(a) * dist; }
      oG.setAttribute('position', new THREE.BufferAttribute(oA, 3));
      solarGroup.add(new THREE.LineLoop(oG, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false })));
      const pm = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 16), new THREE.MeshBasicMaterial({ color: col }));
      const sa = Math.random() * Math.PI * 2;
      pm.position.set(Math.cos(sa) * dist, 0, Math.sin(sa) * dist);
      solarGroup.add(pm);
      planetData.push({ mesh: pm, dist, speed: spd, angle: sa });
    }
    planetData[5].mesh.add(new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.22, 32),
      new THREE.MeshBasicMaterial({ color: 0xccbb77, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthWrite: false })
    )).rotation.x = -Math.PI / 2.5;
    solarGroup.add(new THREE.Mesh(
      new THREE.RingGeometry(3.2, 3.4, 48),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    )).rotation.x = -Math.PI / 2;
    scene.add(solarGroup);

    const clickTargets: THREE.Object3D[] = [eventHorizon, accDisk, photonRing, ...glowLayers];

    /* ── Interaction ─────────────────────────────────────────────── */
    const pointerDownPos = new THREE.Vector2();
    let hovered = false;
    const parallax = { x: 0, y: 0 };
    const updatePointer = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      parallax.x = pointer.x;
      parallax.y = pointer.y;
    };
    const onPointerMove = (e: PointerEvent) => {
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const over = raycaster.intersectObjects(clickTargets, false).length > 0;
      if (over !== hovered) { hovered = over; renderer.domElement.style.cursor = over ? 'pointer' : 'grab'; }
    };
    const onPointerDown = (e: PointerEvent) => { pointerDownPos.set(e.clientX, e.clientY); };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y) > 5) return;
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.intersectObjects(clickTargets, false).length > 0 && clickRef.current) clickRef.current();
    };
    if (interactive) {
      renderer.domElement.style.cursor = 'grab';
      renderer.domElement.addEventListener('pointermove', onPointerMove);
      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
    }

    const onResize = () => {
      if (!mountRef.current) return;
      const nw = mountRef.current.clientWidth, nh = Math.max(mountRef.current.clientHeight, 1);
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      composer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    /* ── Animate ─────────────────────────────────────────────────── */
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
      controls.update();

      if (interactive) {
        const k = Math.min(dt * 3, 1);
        scene.rotation.y += (parallax.x * 0.05 - scene.rotation.y) * k;
        scene.rotation.x += (-parallax.y * 0.03 - scene.rotation.x) * k;
      }

      galaxy.rotation.y += 0.01 * dt;
      accDisk.rotation.z += 0.55 * dt;
      photonRing.rotation.z -= 1.0 * dt;

      const pulse = 0.85 + Math.sin(t * 1.6) * 0.15;
      glowLayers.forEach((g, i) => {
        (g.material as THREE.SpriteMaterial).opacity = glowConf[i][2] * pulse + Math.sin(t * (1.1 + i * 0.35)) * 0.015;
      });
      (photonRing.material as THREE.MeshBasicMaterial).opacity = 0.8 + Math.sin(t * 2.5) * 0.15;
      const jOp = 0.04 + Math.sin(t * 1.2) * 0.03;
      (jetUp.material as THREE.MeshBasicMaterial).opacity = jOp;
      (jetDown.material as THREE.MeshBasicMaterial).opacity = jOp;
      bhGroup.scale.setScalar(1 + (hovered ? Math.sin(t * 4) * 0.04 : 0));

      pulsarData.forEach((p, i) => {
        const f = 4 + i * 1.3;
        const s = 0.7 + Math.abs(Math.sin(t * f)) * 0.6;
        p.mesh.scale.setScalar(s);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.abs(Math.sin(t * f)) * 0.4;
        const bOp = 0.06 + Math.abs(Math.sin(t * f + 0.2)) * 0.18;
        (p.b1.material as THREE.MeshBasicMaterial).opacity = bOp;
        (p.b2.material as THREE.MeshBasicMaterial).opacity = bOp;
        p.b1.rotation.y += 2.5 * dt;
        p.b2.rotation.y += 2.5 * dt;
      });

      distGalGroup.children.forEach((ch, i) => { ch.rotation.y += (0.003 + i * 0.0003) * dt; });
      collGroup.rotation.y += 0.008 * dt;

      const snPulse = 0.7 + Math.sin(t * 0.8) * 0.3;
      sn1aCore.scale.setScalar(0.8 + snPulse * 0.4);
      (sn1aCore.material as THREE.MeshBasicMaterial).opacity = 0.7 + snPulse * 0.3;
      sn1aGlows.forEach((g, i) => {
        (g.material as THREE.MeshBasicMaterial).opacity = (0.025 + snPulse * 0.025) * (1 - i * 0.2);
      });

      (whiteDwarf.material as THREE.MeshBasicMaterial).opacity = 0.85 + Math.sin(t * 6) * 0.1;
      (crabPulsar.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.abs(Math.sin(t * 30)) * 0.5;
      crabPulsar.scale.setScalar(0.8 + Math.abs(Math.sin(t * 30)) * 0.4);

      planetData.forEach((p) => {
        p.angle += p.speed * dt;
        p.mesh.position.set(Math.cos(p.angle) * p.dist, 0, Math.sin(p.angle) * p.dist);
      });
      sun.rotation.y += 0.3 * dt;
      (sunGlow.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(t * 2) * 0.04;

      composer.render();
    };

    const renderFrame = () => composer.render();
    if (reducedMotion) {
      controls.update();
      renderFrame();
      if (interactive) controls.addEventListener('change', renderFrame);
    } else {
      animate();
    }

    return () => {
      cancelAnimationFrame(raf);
      controls.removeEventListener('change', renderFrame);
      controls.dispose();
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      composer.dispose();
      sprite.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m.dispose();
        }
      });
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [interactive, zIndex]);

  return (
    <div
      ref={mountRef}
      aria-hidden={!interactive}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        zIndex,
        pointerEvents: interactive ? 'auto' : 'none',
      }}
    />
  );
};

export default SpaceScene;
