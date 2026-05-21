import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  Img,
} from 'remotion';
import dealData from './deal_data.json';
import './style.css';

const TC = dealData.theme_color || '#00FF66';

// ═══════════════════════════════════════════════════════
// EFECTOS GLOBALES Y COMPONENTES AUXILIARES
// ═══════════════════════════════════════════════════════

const Scanlines: React.FC = () => (
  <div style={{
    position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none',
    background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.15) 3px, rgba(0,0,0,0.15) 4px)',
  }} />
);

const GlitchCut: React.FC = () => {
  const frame = useCurrentFrame();
  if (frame > 10) return null;

  const opacity = interpolate(frame, [0, 10], [1, 0], { extrapolateRight: 'clamp' });
  const shift = interpolate(frame, [0, 5, 10], [20, 0, 8]);

  return (
    <>
      <div style={{
        position: 'absolute', inset: 0, zIndex: 500, opacity: opacity * 0.6,
        backgroundColor: '#FF0000', mixBlendMode: 'screen',
        transform: `translateX(${shift}px)`,
      }} />
      <div style={{
        position: 'absolute', inset: 0, zIndex: 500, opacity: opacity * 0.6,
        backgroundColor: '#0000FF', mixBlendMode: 'screen',
        transform: `translateX(${-shift}px)`,
      }} />
      <div style={{
        position: 'absolute', zIndex: 501,
        top: `${(frame * 137) % 80}%`,
        left: 0, right: 0, height: '3%',
        backgroundColor: TC, opacity: opacity * 0.8,
        mixBlendMode: 'overlay',
      }} />
    </>
  );
};

const ImageGlitch: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const cycle = frame % 47;
  const active = cycle < 4;
  const shift = active ? ((cycle * 13) % 30) - 15 : 0;
  const skew = active ? ((cycle * 7) % 6) - 3 : 0;

  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%',
      transform: active ? `translateX(${shift}px) skewX(${skew}deg)` : 'none',
      overflow: 'hidden',
    }}>
      {children}
      {active && (
        <div style={{
          position: 'absolute',
          top: `${(frame * 53) % 75}%`,
          left: 0, right: 0, height: '5%',
          backgroundColor: TC, opacity: 0.4, mixBlendMode: 'overlay',
        }} />
      )}
    </div>
  );
};

const TypeReveal: React.FC<{ text: string; startFrame: number; style?: React.CSSProperties }> = ({ text, startFrame, style }) => {
  const frame = useCurrentFrame();
  const charsToShow = Math.floor(interpolate(
    frame, [startFrame, startFrame + text.length * 1.5],
    [0, text.length], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }
  ));
  const cursor = Math.floor(frame / 8) % 2 === 0 && charsToShow < text.length;

  return (
    <span style={style}>
      {text.substring(0, charsToShow)}
      {cursor && <span style={{ opacity: 0.8 }}>|</span>}
    </span>
  );
};

const LiveBadge: React.FC = () => {
  const frame = useCurrentFrame();
  const blink = Math.floor(frame / 15) % 2 === 0;
  return (
    <div style={{
      position: 'absolute', top: 55, left: 55, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 18,
      backgroundColor: '#FF0000', padding: '14px 28px',
      border: '5px solid #000', boxShadow: '6px 6px 0 #000',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        backgroundColor: blink ? '#FFF' : 'transparent',
        border: '3px solid #FFF',
      }} />
      <span style={{ fontSize: 34, fontWeight: 900, color: '#FFF', letterSpacing: 6, fontFamily: 'monospace' }}>
        OFERTA
      </span>
    </div>
  );
};

const Watermark: React.FC = () => (
  <div style={{
    position: 'absolute', top: 55, right: 55, zIndex: 200,
    backgroundColor: '#000', border: `4px solid ${TC}`,
    padding: '10px 20px', boxShadow: `4px 4px 0 #000`,
  }}>
    <span style={{ fontSize: 26, fontWeight: 900, color: TC, fontFamily: 'Impact, sans-serif', letterSpacing: 2 }}>
      PARA ESO TRABAJO
    </span>
  </div>
);

const ProgressBar: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const pct = interpolate(frame, [0, dur], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 300, height: 12, backgroundColor: '#111' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: TC }} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// ESCENAS
// ═══════════════════════════════════════════════════════

// ESCENA 1: TÍTULO / OFERTAZO
const TitleScene: React.FC<{ text1: string; text2: string; dur: number }> = ({ text1, text2, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const t1Y = spring({ fps, frame, from: 400, to: 0, config: { damping: 9, stiffness: 100 } });
  const t2Y = spring({ fps, frame: Math.max(0, frame - 10), from: -300, to: 0, config: { damping: 11 } });
  const scaleIn = spring({ fps, frame, from: 0, to: 1, config: { damping: 13 } });
  const tilt = interpolate(frame, [0, dur], [-2, 2]);
  const lineW = interpolate(frame, [8, 30], [0, 100], { extrapolateRight: 'clamp' });
  const aberration = interpolate(frame, [0, 6, 12], [14, 0, 4], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
      <GlitchCut />
      <Scanlines />
      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />

      <div style={{ transform: `rotate(${tilt}deg) scale(${scaleIn})`, textAlign: 'center', padding: '0 40px' }}>
        {/* TEXT1 con aberración cromática */}
        <div style={{ transform: `translateY(${t1Y}px)`, position: 'relative', display: 'inline-block', marginBottom: 12 }}>
          <h1 style={{
            fontSize: 140, margin: 0, color: 'rgba(255,0,80,0.6)',
            fontFamily: 'Impact, sans-serif', textTransform: 'uppercase', lineHeight: 1,
            position: 'absolute', top: 0, left: aberration, width: '100%',
          }}>{text1}</h1>
          <h1 style={{
            fontSize: 140, margin: 0, color: 'rgba(0,200,255,0.6)',
            fontFamily: 'Impact, sans-serif', textTransform: 'uppercase', lineHeight: 1,
            position: 'absolute', top: 0, left: -aberration, width: '100%',
          }}>{text1}</h1>
          <div style={{
            backgroundColor: TC, padding: '20px 60px',
            border: '12px solid #FFF', boxShadow: '18px 18px 0 #FFF',
            position: 'relative',
          }}>
            <h1 style={{
              fontSize: 140, margin: 0, color: '#000',
              fontFamily: 'Impact, sans-serif', textTransform: 'uppercase', lineHeight: 1,
            }}>{text1}</h1>
          </div>
        </div>

        {/* Líneas decorativas */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, margin: '14px 0' }}>
          {[0.4, 0.7, 0.5, 0.8, 0.3].map((w, n) => (
            <div key={n} style={{
              height: 8, width: `${lineW * w * 1.2}px`,
              backgroundColor: n % 2 === 0 ? '#FFF' : TC,
              border: '2px solid #000',
              transform: n % 2 === 0 ? 'skewX(-8deg)' : 'skewX(8deg)',
            }} />
          ))}
        </div>

        {/* TEXT2 en caja blanca */}
        <div style={{
          transform: `translateY(${t2Y}px)`,
          backgroundColor: '#FFF', padding: '14px 50px',
          border: '10px solid #000', boxShadow: `-16px 16px 0 ${TC}`,
          display: 'inline-block',
          maxWidth: '100%',
          wordBreak: 'break-word',
        }}>
          <h2 style={{
            fontSize: 70, margin: 0, color: '#000',
            fontFamily: 'Impact, sans-serif', textTransform: 'uppercase',
            lineHeight: 1.1,
          }}>{text2}</h2>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ESCENA 2: IMAGEN + PUNTOS CLAVE
const ImageTextScene: React.FC<{ text: string; imageFile: string; keyPoints: string[]; dur: number }> = ({ text, imageFile, keyPoints, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const kenBurns = interpolate(frame, [0, dur], [1.0, 1.15], { extrapolateRight: 'clamp' });
  const panelY = spring({ fps, frame, from: 900, to: 0, config: { damping: 15 } });
  const lineW = interpolate(frame, [5, 25], [0, 100], { extrapolateRight: 'clamp' });

  const pointInterval = Math.floor(dur * 0.25);
  const points = (keyPoints || []).slice(0, 3);

  return (
    <AbsoluteFill>
      <GlitchCut />

      {/* Imagen del producto con Ken Burns */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '72%', overflow: 'hidden', backgroundColor: '#fff' }}>
        <ImageGlitch>
          <Img
            src={staticFile(imageFile)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${kenBurns})` }}
          />
        </ImageGlitch>
      </div>

      {/* Puntos clave secuenciales sobre la imagen */}
      {points.map((point, idx) => {
        const startAt = 6 + idx * pointInterval;
        const exitAt = startAt + pointInterval - 4;

        const entryY = spring({ fps, frame: Math.max(0, frame - startAt), from: 120, to: 0, config: { damping: 12 } });
        const exitY = frame > exitAt
          ? interpolate(frame, [exitAt, exitAt + 8], [0, -140], { extrapolateRight: 'clamp' })
          : 0;
        const opacity = frame < startAt
          ? 0
          : frame > exitAt + 6 ? 0 : 1;

        const isRight = idx % 2 === 1;
        const badgeNum = idx + 1;

        return (
          <div
            key={idx}
            style={{
              position: 'absolute',
              top: `${16 + idx * 16}%`,
              left: isRight ? 'auto' : '40px',
              right: isRight ? '40px' : 'auto',
              zIndex: 100 + idx,
              opacity,
              transform: `translateY(${entryY + exitY}px)`,
              maxWidth: '650px',
            }}
          >
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              filter: 'drop-shadow(6px 6px 0px rgba(0,0,0,0.9))',
            }}>
              <div style={{
                backgroundColor: TC, width: 60, height: 60,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '5px solid #000', flexShrink: 0,
              }}>
                <span style={{ fontSize: 32, fontWeight: 900, color: '#000', fontFamily: 'Impact, sans-serif' }}>
                  {badgeNum}
                </span>
              </div>
              <div style={{
                backgroundColor: '#000', padding: '12px 22px',
                border: '5px solid #000',
                borderLeft: 'none',
              }}>
                <span style={{
                  fontSize: 38, color: '#FFF',
                  fontFamily: 'Impact, sans-serif',
                  textTransform: 'uppercase', letterSpacing: 1,
                  lineHeight: 1.1,
                }}>
                  <TypeReveal text={point} startFrame={startAt} style={{ color: '#FFF' }} />
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Degradado y panel inferior */}
      <div style={{ position: 'absolute', top: '58%', left: 0, right: 0, height: '14%', background: 'linear-gradient(transparent, #000)' }} />

      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%',
        backgroundColor: '#000', borderTop: `12px solid ${TC}`,
        transform: `translateY(${panelY}px)`,
        padding: '22px 50px',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
      }}>
        <div style={{ height: 6, width: `${lineW}%`, backgroundColor: TC, marginBottom: 16 }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18 }}>
          <div style={{ width: 14, flexShrink: 0, alignSelf: 'stretch', backgroundColor: TC, minHeight: 70 }} />
          <h2 style={{
            fontSize: 54, margin: 0, color: '#FFF',
            fontFamily: 'Impact, sans-serif', textTransform: 'uppercase', lineHeight: 1.1,
          }}>
            <TypeReveal text={text} startFrame={4} style={{ color: '#FFF' }} />
          </h2>
        </div>
      </div>

      <Watermark />
      <ProgressBar dur={dur} />
      <Scanlines />
    </AbsoluteFill>
  );
};

// ESCENA 3: PRECIOS Y DESCUENTO
const PriceScene: React.FC<{ discount: number; original: string; offer: string; dur: number }> = ({ discount, original, offer, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const animatedNum = Math.floor(
    interpolate(frame, [0, 40, 55], [0, discount * 1.12, discount], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })
  );
  const punch = spring({ fps, frame: Math.max(0, frame - 50), from: 0.8, to: 1, config: { damping: 5, stiffness: 500 } });
  const pricesY = spring({ fps, frame: Math.max(0, frame - 30), from: 150, to: 0, config: { damping: 12 } });
  const stripeOffset = frame * 3.5;
  const ab = frame > 52 ? interpolate(frame, [52, 58], [12, 0], { extrapolateRight: 'clamp' }) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
      <GlitchCut />

      {/* Fondo de rayas diagonales */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 38px, ${TC}15 38px, ${TC}15 42px)`,
        backgroundPosition: `${stripeOffset}px ${stripeOffset}px`,
      }} />

      <div style={{ zIndex: 10, textAlign: 'center', transform: `scale(${punch})`, padding: '0 40px' }}>
        {/* Descuento Gigante */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <h1 style={{
            fontSize: 320, margin: 0, lineHeight: 0.85,
            fontFamily: 'Impact, sans-serif',
            color: 'rgba(255,0,80,0.5)',
            position: 'absolute', top: 0, left: ab,
          }}>{animatedNum}% OFF</h1>
          <h1 style={{
            fontSize: 320, margin: 0, lineHeight: 0.85,
            fontFamily: 'Impact, sans-serif',
            color: 'rgba(0,200,255,0.5)',
            position: 'absolute', top: 0, left: -ab,
          }}>{animatedNum}% OFF</h1>
          <h1 style={{
            fontSize: 320, margin: 0, lineHeight: 0.85,
            fontFamily: 'Impact, sans-serif', color: TC,
            position: 'relative',
            textShadow: `10px 10px 0 rgba(255,255,255,0.15)`,
          }}>{animatedNum}% OFF</h1>
        </div>

        {/* Bloque de precios */}
        <div style={{
          transform: `translateY(${pricesY}px)`, marginTop: 40,
          backgroundColor: '#FFF', padding: '24px 60px',
          border: '10px solid #000', boxShadow: `14px 14px 0 ${TC}`,
          display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
        }}>
          {original && (
            <span style={{
              fontSize: 48, color: '#888',
              fontFamily: 'Space Mono', fontWeight: 700,
              textDecoration: 'line-through',
            }}>
              Regular: ${original}
            </span>
          )}
          <span style={{
            fontSize: 90, color: '#000',
            fontFamily: 'Impact, sans-serif',
            letterSpacing: 2,
          }}>
            HOY: ${offer} MXN
          </span>
        </div>
      </div>

      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />
      <Scanlines />
    </AbsoluteFill>
  );
};

// ESCENA 4: CTA FINAL
const CtaScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const curtainH = interpolate(frame, [0, 20], [0, 100], { extrapolateRight: 'clamp' });
  const logoScale = spring({ fps, frame: Math.max(0, frame - 16), from: 0, to: 1, config: { damping: 7, stiffness: 280 } });
  const headlineY = spring({ fps, frame: Math.max(0, frame - 28), from: 60, to: 0, config: { damping: 13 } });
  const subY = spring({ fps, frame: Math.max(0, frame - 40), from: 80, to: 0, config: { damping: 13 } });
  const urlY = spring({ fps, frame: Math.max(0, frame - 52), from: 200, to: 0, config: { damping: 12 } });
  
  const headlineOpacity = interpolate(frame, [28, 42], [0, 1], { extrapolateRight: 'clamp' });
  const badgePulse = interpolate(frame % 30, [0, 15, 30], [1, 0.7, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
      <GlitchCut />
      <Scanlines />

      {/* Cortina */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: `${curtainH}%`, backgroundColor: TC, zIndex: 5,
      }} />

      {/* Fondo radial */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1,
        backgroundImage: `radial-gradient(${TC}35 2px, transparent 2px)`,
        backgroundSize: '42px 42px',
      }} />

      {/* Contenido */}
      <div style={{ zIndex: 20, textAlign: 'center', padding: '0 60px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        
        {/* Sello de Marca */}
        <div style={{ transform: `scale(${logoScale})`, marginBottom: 40 }}>
          <div style={{
            backgroundColor: TC, padding: '24px 50px',
            border: '10px solid #FFF', boxShadow: '14px 14px 0 #FFF',
            display: 'inline-block',
          }}>
            <span style={{ fontSize: 50, fontWeight: 900, color: '#000', fontFamily: 'Impact, sans-serif', letterSpacing: 2 }}>
              ¡OFERTA EXCLUSIVA!
            </span>
          </div>
        </div>

        {/* Títulos */}
        <div style={{ opacity: headlineOpacity, transform: `translateY(${headlineY}px)`, marginBottom: 24 }}>
          <h1 style={{
            fontSize: 90, margin: 0, color: '#FFF',
            fontFamily: 'Impact, sans-serif', textTransform: 'uppercase',
            lineHeight: 1, textShadow: `6px 6px 0 ${TC}`,
          }}>
            CONSIGUE EL TUYO
          </h1>
          <h1 style={{
            fontSize: 90, margin: 0, color: TC,
            fontFamily: 'Impact, sans-serif', textTransform: 'uppercase',
            lineHeight: 1, textShadow: `6px 6px 0 #FFF`,
          }}>
            ¡ANTES DE QUE SE AGOTE!
          </h1>
        </div>

        {/* Subtexto */}
        <div style={{ transform: `translateY(${subY}px)`, marginBottom: 40, maxWidth: 900 }}>
          <p style={{
            fontSize: 38, margin: 0, color: '#CCC',
            fontFamily: 'Arial, sans-serif', lineHeight: 1.4,
            fontStyle: 'italic',
          }}>
            Haz clic en el enlace para ir directo a la tienda. ¡Ahorra en grande!
          </p>
        </div>

        {/* Separador */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '80%', marginBottom: 40 }}>
          <div style={{ flex: 1, height: 5, backgroundColor: TC }} />
          <div style={{ width: 18, height: 18, backgroundColor: '#FFF', transform: 'rotate(45deg)' }} />
          <div style={{ flex: 1, height: 5, backgroundColor: TC }} />
        </div>

        {/* Llamado a la acción */}
        <div style={{ transform: `translateY(${urlY}px)`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <div style={{
            opacity: badgePulse,
            backgroundColor: '#000', border: `4px solid ${TC}`,
            padding: '8px 30px', display: 'inline-block',
          }}>
            <span style={{ fontSize: 28, color: TC, fontFamily: 'monospace', letterSpacing: 4 }}>
              ✦ ENLACE DE AFILIADO ✦
            </span>
          </div>

          <div style={{
            backgroundColor: TC, padding: '24px 60px',
            border: '10px solid #FFF', boxShadow: '14px 14px 0 #FFF',
            display: 'inline-flex', alignItems: 'center', gap: 22,
          }}>
            <span style={{ fontSize: 54, fontWeight: 900, color: '#000', fontFamily: 'Impact, sans-serif', letterSpacing: 2 }}>
              LINK EN LA BIOGRAFÍA
            </span>
          </div>
        </div>
      </div>

      <ProgressBar dur={dur} />
    </AbsoluteFill>
  );
};

// COMPOSITOR PRINCIPAL
export const ParaEsoTrabajoVideo: React.FC = () => {
  let accumulatedFrames = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', fontFamily: 'Impact, Arial Black, sans-serif' }}>
      {/* Audios principales */}
      <Audio src={staticFile('voice.mp3')} volume={1.5} />
      <Audio src={staticFile('bg_music.mp3')} volume={0.12} />

      {dealData.scenes.map((scene: any, i: number) => {
        const from = accumulatedFrames;
        accumulatedFrames += scene.durationInFrames;
        const dur = scene.durationInFrames;

        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            {scene.type === 'title' && (
              <TitleScene text1={scene.text1} text2={scene.text2} dur={dur} />
            )}
            {scene.type === 'image_text' && (
              <ImageTextScene text={scene.text} imageFile="product.png" keyPoints={dealData.key_points || []} dur={dur} />
            )}
            {scene.type === 'big_percentage' && (
              <PriceScene discount={dealData.discount_percentage} original={dealData.original_price} offer={dealData.offer_price} dur={dur} />
            )}
            {scene.type === 'cta' && (
              <CtaScene dur={dur} />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
