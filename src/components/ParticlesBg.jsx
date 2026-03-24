import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function ParticlesBg({ opacity = 1 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas  = canvasRef.current
    const isMob   = window.innerWidth < 768
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setClearColor(0x000000, 0)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 300)
    camera.position.z = 70

    const COUNT = isMob ? 120 : 240

    const pos = new Float32Array(COUNT * 3)
    const col = new Float32Array(COUNT * 3)

    // Per-particle drift
    const spd  = new Float32Array(COUNT)  // vertical drift speed
    const drift = new Float32Array(COUNT) // horizontal wobble phase

    const W = 100, H = 120, D = 50

    const spawn = (i, randomY) => {
      pos[i*3]   = (Math.random() - 0.5) * W
      pos[i*3+1] = randomY ? (Math.random() - 0.5) * H : -H / 2 - Math.random() * H
      pos[i*3+2] = (Math.random() - 0.5) * D
      spd[i]     = 0.012 + Math.random() * 0.022
      drift[i]   = Math.random() * Math.PI * 2

      // Gold palette: warm white, pale gold, deep amber
      const r = Math.random()
      if (r < 0.5) {
        // pale gold
        const v = 0.75 + Math.random() * 0.25
        col[i*3] = v; col[i*3+1] = v * 0.82; col[i*3+2] = v * 0.28
      } else if (r < 0.80) {
        // warm white
        const v = 0.85 + Math.random() * 0.15
        col[i*3] = v; col[i*3+1] = v * 0.92; col[i*3+2] = v * 0.70
      } else {
        // deep amber accent
        col[i*3] = 0.90; col[i*3+1] = 0.52; col[i*3+2] = 0.08
      }
    }

    for (let i = 0; i < COUNT; i++) spawn(i, true)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3))

    const mat = new THREE.PointsMaterial({
      size: isMob ? 0.9 : 0.75,
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
    })

    const pts = new THREE.Points(geo, mat)
    scene.add(pts)

    const clock = new THREE.Clock()
    let rafId

    const tick = () => {
      rafId = requestAnimationFrame(tick)
      const t = clock.getElapsedTime()

      for (let i = 0; i < COUNT; i++) {
        // float upward
        pos[i*3+1] += spd[i]
        // gentle horizontal wobble
        pos[i*3]   += Math.sin(t * 0.4 + drift[i]) * 0.004

        if (pos[i*3+1] > H / 2 + 2) spawn(i, false)
      }

      geo.attributes.position.needsUpdate = true
      renderer.render(scene, camera)
    }
    tick()

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      geo.dispose()
      mat.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none',
        opacity,
      }}
    />
  )
}
