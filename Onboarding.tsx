import { useState, useEffect, useRef } from "react"
import * as THREE from "three"

type OnboardingStep = "welcome" | "manus-key" | "connect-services" | "ready"

interface OnboardingProps {
  onComplete: () => void
}

const STEP_ORDER: OnboardingStep[] = ["welcome", "manus-key", "connect-services", "ready"]

// ── WebGL Background ───────────────────────────────────────
// Shared across all steps — the animated blue orb shader from the HTML pages.

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const FRAGMENT_SHADER = `
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec3 u_colorCore;
  uniform vec3 u_colorFringe;
  varying vec2 vUv;

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 center = vec2(0.3, 0.5);

    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = (uv - center);
    p.x *= aspect;

    float baseDist = length(p);
    float angle = atan(p.y, p.x);

    float waveStrength = smoothstep(0.0, 0.5, baseDist);
    float wave1 = sin(angle * 4.0 + u_time * 0.7) * 0.05;
    float wave2 = sin(angle * 6.0 - u_time * 0.4) * 0.025;
    float wave3 = sin(angle * 2.0 + u_time * 0.9) * 0.035;
    float waveDist = (wave1 + wave2 + wave3) * waveStrength;

    float dist = baseDist + waveDist;
    float orb = exp(-dist * 1.7) * 1.3;
    float sweep = 0.5 + 0.5 * sin(angle * 2.0 + u_time * 0.5);
    float glow1 = exp(-dist * 3.8) * 1.1;
    float glow2 = exp(-dist * 1.7) * 0.75 * sweep;
    float glow3 = exp(-dist * 0.75) * 0.4;
    float pulse = 0.5 + 0.5 * sin(u_time * 0.6);

    vec3 brightCore = u_colorCore * 1.8;
    vec3 brightFringe = u_colorFringe * 1.4;

    vec3 color = brightCore * (orb * 2.0 + glow1);
    color += brightFringe * (glow2 + glow3 * pulse);

    float alpha = clamp(orb + glow1 + glow2 + glow3, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha * 0.85);
  }
`

function useWebGLBackground(containerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    camera.position.z = 1

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_time: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        u_colorCore: { value: new THREE.Color("#4169E1") },
        u_colorFringe: { value: new THREE.Color("#1E3A8A") },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
    })

    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    const clock = new THREE.Clock()
    let animId: number

    function animate() {
      animId = requestAnimationFrame(animate)
      material.uniforms.u_time.value = clock.getElapsedTime()
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight)
      material.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight)
    }
    window.addEventListener("resize", handleResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener("resize", handleResize)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [containerRef])
}

// ── Main Component ─────────────────────────────────────────

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const [step, setStep] = useState<OnboardingStep>("welcome")
  const [manusKey, setManusKey] = useState("")
  const [keyError, setKeyError] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [isCheckingConnectors, setIsCheckingConnectors] = useState(false)
  const [connectorStatus, setConnectorStatus] = useState<{
    notion: "unknown" | "connected" | "missing"
    gdrive: "unknown" | "connected" | "missing"
  }>({ notion: "unknown", gdrive: "unknown" })

  const webglRef = useRef<HTMLDivElement>(null)
  useWebGLBackground(webglRef)

  const stepIndex = STEP_ORDER.indexOf(step)

  const goNext = () => {
    const next = stepIndex + 1
    if (next < STEP_ORDER.length) setStep(STEP_ORDER[next])
  }

  const goBack = () => {
    const prev = stepIndex - 1
    if (prev >= 0) setStep(STEP_ORDER[prev])
  }

  // ── Step 1: Save & validate Manus API key via IPC ──

  const handleSaveManusKey = async () => {
    if (!manusKey.trim()) {
      setKeyError("API key cannot be empty.")
      return
    }

    setIsValidating(true)
    setKeyError("")

    try {
      const result = await window.electronAPI.onboardingSaveManusKey(manusKey.trim())
      if (result.success) {
        goNext()
      } else {
        setKeyError(result.error || "Invalid API key. Please check and try again.")
      }
    } catch (err: any) {
      setKeyError(err.message || "Could not validate key. Check your connection.")
    } finally {
      setIsValidating(false)
    }
  }

  // ── Step 2: Check connectors via IPC ──

  const handleCheckConnectors = async () => {
    setIsCheckingConnectors(true)
    try {
      const result = await window.electronAPI.onboardingCheckConnectors()
      if (result.error) {
        console.warn("[Onboarding] Connector check error:", result.error)
      }
      setConnectorStatus({
        notion: result.notion ? "connected" : "missing",
        gdrive: result.gdrive ? "connected" : "missing",
      })
    } catch {
      setConnectorStatus({ notion: "unknown", gdrive: "unknown" })
    } finally {
      setIsCheckingConnectors(false)
    }
  }

  // ── External links via IPC ──

  const handleOpenManusKeys = () => {
    window.electronAPI.onboardingOpenManus()
  }

  const handleOpenConnectors = () => {
    window.electronAPI.onboardingOpenConnectors()
  }

  // ── Complete onboarding via IPC ──

  const handleComplete = async () => {
    await window.electronAPI.onboardingComplete()
    onComplete()
  }

  // ── Connector status indicator dot ──

  const connectorDotColor = (status: "unknown" | "connected" | "missing") => {
    if (status === "connected") return "#34d399"
    if (status === "missing") return "#fbbf24"
    return "rgba(255,255,255,0.15)"
  }

  const bothConnected =
    connectorStatus.notion === "connected" && connectorStatus.gdrive === "connected"

  return (
    <div style={styles.root}>
      {/* WebGL background layer */}
      <div ref={webglRef} style={styles.webglContainer} />

      {/* Content layer */}
      <div style={styles.layoutGrid}>
        {/* ── WELCOME (page_1) ────────────────────────────── */}
        {step === "welcome" && (
          <div style={styles.panel} className="animate-in">
            <div style={styles.headerGroup}>
              <div style={styles.systemBadge}>VANTAGE STRATEGY</div>
              <h1 style={styles.h1}>Vantage</h1>
              <p style={styles.subtitle}>
                The heads-up display for high-performance consulting.
              </p>
            </div>

            <button style={styles.btnPrimary} onClick={goNext}>
              CONNECT MANUS →
            </button>
          </div>
        )}

        {/* ── MANUS KEY (page_2) ─────────────────────────── */}
        {step === "manus-key" && (
          <div style={styles.panel} className="animate-in">
            <div style={styles.stepIndicator}>Step 1 — Agent Integration</div>

            <div style={styles.headerGroup}>
              <h1 style={{ ...styles.h1, fontSize: 32 }}>Connect Manus</h1>
              <p style={styles.subtitle}>
                Manus is the AI agent powering Vantage's deep research tools.
                Connect your API key to synchronize your workspace.
              </p>
              <button style={styles.externalLink} onClick={handleOpenManusKeys}>
                Open Manus → API Keys ↗
              </button>
            </div>

            <div style={styles.formGroup}>
              <div style={styles.inputWrapper}>
                <label style={styles.label}>Paste your Manus API key</label>
                <input
                  type="password"
                  value={manusKey}
                  onChange={(e) => {
                    setManusKey(e.target.value)
                    setKeyError("")
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveManusKey()}
                  placeholder="sk-manus-••••••••••••••••"
                  style={styles.input}
                />
                {keyError && <p style={styles.errorText}>{keyError}</p>}
              </div>
            </div>

            <div style={styles.buttonRow}>
              <button style={styles.btnSecondary} onClick={goBack}>
                Back
              </button>
              <button
                style={{
                  ...styles.btnPrimary,
                  opacity: isValidating ? 0.6 : 1,
                  cursor: isValidating ? "not-allowed" : "pointer",
                }}
                onClick={handleSaveManusKey}
                disabled={isValidating}
              >
                {isValidating ? "Validating…" : "Continue →"}
              </button>
            </div>
          </div>
        )}

        {/* ── CONNECT SERVICES (page_3) ──────────────────── */}
        {step === "connect-services" && (
          <div style={styles.panel} className="animate-in">
            <div style={styles.headerGroup}>
              <div style={styles.stepLabel}>STEP 3 — DATA CONNECTORS</div>
              <h1 style={{ ...styles.h1, fontSize: 28 }}>
                Link Notion & Google Drive
              </h1>
              <p style={styles.subtitle}>
                Manus needs access to your Notion workspace and Google Drive so
                it can look up meeting notes, deal data, and documents on your
                behalf. You connect these inside Manus's settings — not here.
              </p>
            </div>

            <button style={styles.openLink} onClick={handleOpenConnectors}>
              Open Manus → Connectors ↗
            </button>

            {/* Connector list */}
            <div style={styles.connectorList}>
              <div style={styles.connectorItem}>
                <span style={styles.connectorIcon}>📄</span>
                <span style={styles.connectorName}>Notion</span>
                <span
                  style={{
                    ...styles.connectorDot,
                    backgroundColor: connectorDotColor(connectorStatus.notion),
                    boxShadow:
                      connectorStatus.notion === "connected"
                        ? "0 0 8px rgba(52,211,153,0.5)"
                        : "none",
                  }}
                />
              </div>
              <div style={styles.connectorItem}>
                <span style={styles.connectorIcon}>📁</span>
                <span style={styles.connectorName}>Google Drive</span>
                <span
                  style={{
                    ...styles.connectorDot,
                    backgroundColor: connectorDotColor(connectorStatus.gdrive),
                    boxShadow:
                      connectorStatus.gdrive === "connected"
                        ? "0 0 8px rgba(52,211,153,0.5)"
                        : "none",
                  }}
                />
              </div>
            </div>

            <button
              style={{
                ...styles.btnVerify,
                opacity: isCheckingConnectors ? 0.6 : 1,
                cursor: isCheckingConnectors ? "not-allowed" : "pointer",
              }}
              onClick={handleCheckConnectors}
              disabled={isCheckingConnectors}
            >
              {isCheckingConnectors ? "Checking…" : "I've connected them — verify"}
            </button>

            <div style={styles.bottomActions}>
              <button style={styles.btnBack} onClick={goBack}>
                Back
              </button>
              <button style={styles.btnSkip} onClick={goNext}>
                {bothConnected ? "Continue" : "Skip for now"}
              </button>
            </div>

            <p style={styles.footerNote}>
              You can connect these later — some tools will have limited data
              until you do.
            </p>
          </div>
        )}

        {/* ── READY (page_4) ─────────────────────────────── */}
        {step === "ready" && (
          <div style={styles.panel} className="animate-in">
            <div style={styles.stepIndicator}>Step 4 — Complete</div>

            <div style={styles.headerGroup}>
              <h1 style={{ ...styles.h1, fontSize: 32 }}>You're all set!</h1>
            </div>

            <button
              style={{ ...styles.btnPrimary, width: "100%" }}
              onClick={handleComplete}
            >
              Enter Vantage →
            </button>
            <p style={styles.welcomeText}>
              Welcome to the new standard of consulting.
              <br />
              Proudly developed by the team at CCN London.
            </p>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap');

        .animate-in {
          animation: fadeSlideIn 0.45s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        input::placeholder {
          color: rgba(255,255,255,0.25);
        }
        input:focus {
          background-color: rgba(255,255,255,0.12) !important;
          border-color: rgba(65,105,225,0.3) !important;
        }

        button:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </div>
  )
}

// ── Inline styles matching the HTML page designs ───────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: "100vw",
    height: "100vh",
    backgroundColor: "#0a1628",
    fontFamily: "'Open Sans', sans-serif",
    color: "#FFFFFF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    WebkitFontSmoothing: "antialiased",
  },
  webglContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    zIndex: 0,
    pointerEvents: "none",
  },
  layoutGrid: {
    position: "relative",
    zIndex: 10,
    width: "100%",
    maxWidth: 1440,
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
  },
  panel: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 40,
    padding: 48,
    display: "flex",
    flexDirection: "column",
    gap: 28,
    backdropFilter: "blur(40px)",
    WebkitBackdropFilter: "blur(40px)",
    border: "1px solid rgba(255,255,255,0.05)",
    boxShadow: "0 40px 100px rgba(0,0,0,0.4)",
  },
  headerGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    textAlign: "center",
  },
  systemBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: "#4169E1",
    background: "rgba(65,105,225,0.1)",
    padding: "4px 14px",
    borderRadius: 999,
    alignSelf: "center",
    letterSpacing: "0.15em",
  },
  h1: {
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    lineHeight: 1.1,
    margin: 0,
  },
  subtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.6,
    margin: 0,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: 400,
    fontStyle: "italic",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: "0.2em",
    textAlign: "center",
    textTransform: "uppercase" as const,
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: 400,
    fontStyle: "italic",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: "0.2em",
    textAlign: "center",
    textTransform: "uppercase" as const,
  },
  externalLink: {
    color: "#4169E1",
    fontSize: 13,
    fontWeight: 600,
    background: "none",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
    fontFamily: "'Open Sans', sans-serif",
    padding: 0,
  },
  openLink: {
    color: "#4169E1",
    fontSize: 14,
    fontWeight: 600,
    background: "none",
    border: "none",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginTop: -16,
    fontFamily: "'Open Sans', sans-serif",
    padding: 0,
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  inputWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "rgba(255,255,255,0.6)",
    paddingLeft: 20,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  },
  input: {
    width: "100%",
    padding: "0 24px",
    height: 56,
    border: "1px solid rgba(255,255,255,0.05)",
    outline: "none",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "#FFFFFF",
    fontFamily: "'Open Sans', sans-serif",
    fontSize: 14,
    transition: "background-color 0.3s ease, border-color 0.3s ease",
    boxSizing: "border-box" as const,
  },
  errorText: {
    color: "#f87171",
    fontSize: 12,
    marginTop: 4,
    paddingLeft: 20,
    margin: 0,
  },
  buttonRow: {
    display: "grid",
    gridTemplateColumns: "1fr 2fr",
    gap: 12,
    marginTop: 8,
  },
  btnPrimary: {
    height: 60,
    backgroundColor: "#1A3A6B",
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "0.05em",
    border: "none",
    borderRadius: 999,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 15px 30px rgba(0,0,0,0.2)",
    fontFamily: "'Open Sans', sans-serif",
    transition: "background-color 0.3s ease, transform 0.2s ease",
    marginTop: 8,
  },
  btnSecondary: {
    height: 56,
    backgroundColor: "transparent",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 999,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Open Sans', sans-serif",
    transition: "background-color 0.3s ease",
  },
  connectorList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  connectorItem: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 20px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.06)",
  },
  connectorIcon: {
    fontSize: 20,
    width: 28,
    textAlign: "center",
  },
  connectorName: {
    fontSize: 15,
    fontWeight: 500,
    flex: 1,
  },
  connectorDot: {
    width: 12,
    height: 12,
    borderRadius: "50%",
    backgroundColor: "rgba(255,255,255,0.15)",
    transition: "background-color 0.3s ease, box-shadow 0.3s ease",
  },
  btnVerify: {
    height: 56,
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.6)",
    fontSize: 15,
    fontWeight: 600,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 999,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Open Sans', sans-serif",
    transition: "background-color 0.3s ease",
  },
  bottomActions: {
    display: "flex",
    gap: 12,
  },
  btnBack: {
    height: 52,
    padding: "0 24px",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: 600,
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 999,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Open Sans', sans-serif",
    transition: "background-color 0.3s ease",
  },
  btnSkip: {
    flex: 1,
    height: 52,
    background: "#FFFFFF",
    color: "#0a1628",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    borderRadius: 999,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Open Sans', sans-serif",
    transition: "background-color 0.3s ease",
  },
  footerNote: {
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    lineHeight: 1.4,
    margin: 0,
  },
  welcomeText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.6,
    textAlign: "center",
    marginTop: -8,
    margin: 0,
  },
}

export default Onboarding
