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

// ═══════════════════════════════════════════════════════
// COMPONENTES AUXILIARES Y DE CORREO
// ═══════════════════════════════════════════════════════

const Watermark: React.FC = () => (
  <div style={{
    position: 'absolute', top: 120, right: 60, zIndex: 200,
    backgroundColor: '#3483FA', borderRadius: '16px',
    padding: '12px 28px', boxShadow: '0 8px 24px rgba(52, 131, 250, 0.35)',
    display: 'flex', alignItems: 'center', gap: 10,
    border: '2px solid rgba(255,255,255,0.4)'
  }}>
    <span style={{ fontSize: 26, fontWeight: 900, color: '#FFF', fontFamily: 'Plus Jakarta Sans', letterSpacing: 0.5 }}>
      Para eso trabajo
    </span>
  </div>
);

const LiveBadge: React.FC = () => {
  const frame = useCurrentFrame();
  const blink = Math.floor(frame / 14) % 2 === 0;
  return (
    <div style={{
      position: 'absolute', top: 120, left: 60, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 12,
      backgroundColor: '#FFFFFF', padding: '12px 26px',
      borderRadius: '30px', boxShadow: '0 8px 25px rgba(0,0,0,0.08)',
      border: '2px solid #EAEAEA'
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        backgroundColor: '#00A650',
        boxShadow: blink ? '0 0 10px #00A650' : 'none',
        opacity: blink ? 1 : 0.4,
      }} />
      <span style={{ fontSize: 22, fontWeight: 800, color: '#222', fontFamily: 'Plus Jakarta Sans', letterSpacing: 1 }}>
        OFERTA DEL DÍA
      </span>
    </div>
  );
};

const ProgressBar: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const pct = interpolate(frame, [0, dur], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 300, height: 12, backgroundColor: 'rgba(0,0,0,0.08)' }}>
      <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#3483FA' }} />
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// ESCENAS
// ═══════════════════════════════════════════════════════

// ESCENA 1: TÍTULO / INTRO
const TitleScene: React.FC<{ text1: string; text2: string; dur: number }> = ({ text1, text2, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [dur - 8, dur], [1, 0], { extrapolateLeft: 'clamp' });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  const scale = spring({ fps, frame, from: 0.8, to: 1, config: { damping: 14, stiffness: 120 } });
  const text2Opacity = interpolate(frame, [10, 24], [0, 1], { extrapolateRight: 'clamp' });
  const text2Y = interpolate(frame, [10, 24], [30, 0], { extrapolateRight: 'clamp' });

  const orb1Y = Math.sin(frame / 20) * 20;
  const orb2X = Math.cos(frame / 25) * 20;

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(circle at 50% 35%, #FFF780 0%, #FFE600 65%, #ECCF00 100%)',
      justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans',
      opacity: sceneOpacity
    }}>
      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />

      {/* Decorative dynamic ambient orbs */}
      <div style={{
        position: 'absolute', width: 650, height: 650, borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.25)', top: -120 + orb1Y, right: -150, zIndex: 1
      }} />
      <div style={{
        position: 'absolute', width: 450, height: 450, borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.18)', bottom: -80, left: -100 + orb2X, zIndex: 1
      }} />

      {/* Main Glass/White Card */}
      <div style={{
        zIndex: 10,
        transform: `scale(${scale})`,
        backgroundColor: '#FFFFFF',
        padding: '60px 45px',
        borderRadius: '44px',
        boxShadow: '0 30px 70px rgba(0,0,0,0.14)',
        textAlign: 'center',
        width: '88%',
        border: '2px solid rgba(255,255,255,0.8)',
      }}>
        {/* Tag SUPER PRECIO / LIQUIDACION */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          background: 'linear-gradient(135deg, #00A650 0%, #008740 100%)',
          color: '#FFFFFF',
          padding: '12px 32px',
          borderRadius: '30px',
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: 2,
          marginBottom: 28,
          textTransform: 'uppercase',
          boxShadow: '0 8px 24px rgba(0, 166, 80, 0.3)'
        }}>
          🔥 {text1}
        </div>

        {/* Product Headline */}
        <h1 style={{
          fontSize: 66,
          fontWeight: 900,
          color: '#222222',
          fontFamily: 'Montserrat, sans-serif',
          lineHeight: 1.12,
          margin: 0,
          textTransform: 'uppercase',
          opacity: text2Opacity,
          transform: `translateY(${text2Y}px)`,
          letterSpacing: -0.5
        }}>
          {text2}
        </h1>

        <div style={{
          marginTop: 25,
          fontSize: 26,
          color: '#666',
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 10
        }}>
          <span>En Mercado Libre</span>
          <span>•</span>
          <span style={{ color: '#00A650', fontWeight: 800 }}>Envío Rápido</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ESCENA 2: IMAGEN + CARACTERÍSTICAS (CON KEN BURNS Y SELLOS MERCADO LIBRE)
const ImageTextScene: React.FC<{ text: string; imageFile: string; keyPoints: string[]; dur: number }> = ({ text, imageFile, keyPoints, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [dur - 8, dur], [1, 0], { extrapolateLeft: 'clamp' });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  const cardScale = spring({ fps, frame, from: 0.85, to: 1, config: { damping: 14 } });

  // Ken Burns: zoom continuo sutil en la imagen del producto
  const kenBurns = interpolate(frame, [0, dur], [1.0, 1.10], { extrapolateRight: 'clamp' });
  // Movimiento sutil de flotación
  const floatY = Math.sin(frame / 14) * 8;

  const points = (keyPoints || []).slice(0, 3);
  const pointInterval = Math.floor(dur * 0.22);

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(circle at 50% 25%, #FFFFFF 0%, #F5F7FA 65%, #E5E9F0 100%)',
      justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans',
      opacity: sceneOpacity
    }}>
      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />

      {/* Main product card */}
      <div style={{
        width: '90%',
        height: '78%',
        backgroundColor: '#FFFFFF',
        borderRadius: '40px',
        boxShadow: '0 25px 60px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '35px 25px',
        border: '1px solid rgba(0,0,0,0.04)',
        transform: `scale(${cardScale})`,
        position: 'relative'
      }}>
        {/* Badges de Confianza de Mercado Libre */}
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          padding: '0 10px'
        }}>
          {/* Badge FULL */}
          <div style={{
            backgroundColor: '#00A650',
            color: '#FFFFFF',
            padding: '8px 18px',
            borderRadius: '10px',
            fontWeight: 900,
            fontSize: 22,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 4px 12px rgba(0, 166, 80, 0.25)'
          }}>
            ⚡ FULL
          </div>

          <div style={{
            backgroundColor: '#EBF4FF',
            color: '#3483FA',
            padding: '8px 16px',
            borderRadius: '10px',
            fontWeight: 800,
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}>
            🛡️ Compra Protegida
          </div>
        </div>

        {/* Product Image Frame con Ken Burns y Drop Shadow */}
        <div style={{
          width: '90%',
          height: '42%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          margin: '10px 0',
          overflow: 'visible'
        }}>
          <Img
            src={staticFile(imageFile)}
            style={{
              maxWidth: '92%',
              maxHeight: '92%',
              objectFit: 'contain',
              transform: `scale(${kenBurns}) translateY(${floatY}px)`,
              filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.18))'
            }}
          />
        </div>

        {/* Text / Headline */}
        <h2 style={{
          fontSize: 36,
          fontWeight: 900,
          color: '#222',
          textAlign: 'center',
          marginBottom: 20,
          lineHeight: 1.22,
          padding: '0 10px',
          fontFamily: 'Montserrat, sans-serif'
        }}>
          {text}
        </h2>

        {/* Key Points */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '98%',
        }}>
          {points.map((point: string, idx: number) => {
            const startAt = 10 + idx * pointInterval;
            const pointOpacity = interpolate(frame, [startAt, startAt + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const pointX = interpolate(frame, [startAt, startAt + 10], [-25, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

            return (
              <div key={idx} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                opacity: pointOpacity,
                transform: `translateX(${pointX}px)`,
                backgroundColor: '#F5F7FA',
                padding: '12px 18px',
                borderRadius: '16px',
                border: '1px solid #EAEAEA'
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  backgroundColor: '#E6F8EE', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <span style={{ color: '#00A650', fontWeight: 900, fontSize: 18 }}>✓</span>
                </div>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#333' }}>
                  {point}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ESCENA 3: PRECIOS Y DESCUENTOS CON GLOW Y ALTO CONTRASTE
const PriceScene: React.FC<{ discount: number; original: string; offer: string; dur: number }> = ({ discount, original, offer, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [dur - 8, dur], [1, 0], { extrapolateLeft: 'clamp' });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  const scale = spring({ fps, frame, from: 0.82, to: 1, config: { damping: 12 } });
  const pulse = interpolate(frame % 25, [0, 12, 25], [1, 1.05, 1]);

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(circle at 50% 25%, #FFFFFF 0%, #F5F7FA 65%, #E5E9F0 100%)',
      justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans',
      opacity: sceneOpacity
    }}>
      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />

      <div style={{
        width: '90%',
        backgroundColor: '#FFFFFF',
        borderRadius: '44px',
        boxShadow: '0 30px 70px rgba(0,0,0,0.10)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '55px 35px',
        border: '1px solid rgba(0,0,0,0.04)',
        transform: `scale(${scale})`,
        textAlign: 'center'
      }}>
        {/* Tag de Descuento Gigante con Resplandor */}
        {discount > 0 && (
          <div style={{
            transform: `scale(${pulse})`,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: 'linear-gradient(135deg, #00C853 0%, #009639 100%)',
            color: '#FFFFFF',
            padding: '14px 36px',
            borderRadius: '35px',
            fontSize: 40,
            fontWeight: 900,
            marginBottom: 35,
            boxShadow: '0 12px 30px rgba(0, 200, 83, 0.45)',
            letterSpacing: 0.5
          }}>
            ⚡ {discount}% DE DESCUENTO
          </div>
        )}

        {/* Comparación de Precios */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          {original && (
            <span style={{
              fontSize: 40,
              color: '#8E8E93',
              textDecoration: 'line-through',
              fontWeight: 600
            }}>
              Precio normal: ${original} MXN
            </span>
          )}
          
          <div style={{
            fontSize: 88,
            fontWeight: 900,
            color: '#111111',
            fontFamily: 'Montserrat, sans-serif',
            letterSpacing: -1,
            lineHeight: 1
          }}>
            ${offer} <span style={{ fontSize: 42, fontWeight: 700, color: '#666' }}>MXN</span>
          </div>
        </div>

        {/* Beneficios adicionales */}
        <div style={{
          display: 'flex',
          gap: 15,
          marginTop: 25,
          marginBottom: 35,
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          <span style={{ backgroundColor: '#F0F9F4', color: '#00A650', padding: '8px 18px', borderRadius: '12px', fontSize: 22, fontWeight: 800 }}>
            ✓ Hasta 12 Meses Sin Intereses
          </span>
          <span style={{ backgroundColor: '#F0F4FF', color: '#3483FA', padding: '8px 18px', borderRadius: '12px', fontSize: 22, fontWeight: 800 }}>
            ✓ Garantía Oficial
          </span>
        </div>

        {/* Botón Mercado Libre Blue */}
        <div style={{
          background: 'linear-gradient(135deg, #3483FA 0%, #1E66D8 100%)',
          color: '#FFFFFF',
          padding: '22px 55px',
          borderRadius: '20px',
          fontSize: 34,
          fontWeight: 800,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 14,
          boxShadow: '0 12px 30px rgba(52, 131, 250, 0.45)',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          Ver Oferta en el Enlace ↗
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ESCENA 4: CTA FINAL CON LLAMADO CLARO
const CtaScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [dur - 8, dur], [1, 0], { extrapolateLeft: 'clamp' });
  const sceneOpacity = Math.min(fadeIn, fadeOut);

  const scale = spring({ fps, frame, from: 0.8, to: 1, config: { damping: 12 } });
  const pulse = interpolate(frame % 24, [0, 12, 24], [1, 1.06, 1]);

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(circle at 50% 35%, #FFF780 0%, #FFE600 65%, #ECCF00 100%)',
      justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans',
      opacity: sceneOpacity
    }}>
      <ProgressBar dur={dur} />

      {/* Decorative background shapes */}
      <div style={{
        position: 'absolute', width: 550, height: 550, borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.22)', bottom: -120, right: -120, zIndex: 1
      }} />

      <div style={{
        width: '90%',
        backgroundColor: '#FFFFFF',
        borderRadius: '44px',
        boxShadow: '0 30px 70px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '60px 40px',
        border: '2px solid rgba(255,255,255,0.8)',
        transform: `scale(${scale})`,
        zIndex: 10,
        textAlign: 'center'
      }}>
        <span style={{
          fontSize: 26,
          color: '#3483FA',
          fontWeight: 900,
          letterSpacing: 2,
          marginBottom: 16,
          textTransform: 'uppercase'
        }}>
          ¡OFERTA POR TIEMPO LIMITADO!
        </span>

        <h1 style={{
          fontSize: 58,
          fontWeight: 900,
          color: '#222222',
          fontFamily: 'Montserrat, sans-serif',
          lineHeight: 1.15,
          marginBottom: 20
        }}>
          ¿Dónde comprarlo?
        </h1>

        <p style={{
          fontSize: 30,
          color: '#555555',
          lineHeight: 1.4,
          marginBottom: 40,
          maxWidth: '92%',
          fontWeight: 600
        }}>
          Toca el enlace oficial de Mercado Libre que dejamos en la descripción y en la biografía.
        </p>

        {/* Big Blue CTA Button Pulsing */}
        <div style={{
          transform: `scale(${pulse})`,
          background: 'linear-gradient(135deg, #3483FA 0%, #1E66D8 100%)',
          color: '#FFFFFF',
          padding: '24px 55px',
          borderRadius: '20px',
          fontSize: 38,
          fontWeight: 900,
          boxShadow: '0 16px 36px rgba(52, 131, 250, 0.5)',
          border: '2px solid rgba(255,255,255,0.3)',
          letterSpacing: 0.5
        }}>
          👉 ENLACE EN LA BIO 👈
        </div>
      </div>
    </AbsoluteFill>
  );
};

// COMPOSITOR PRINCIPAL CON AUDIO DUCKING
export const ParaEsoTrabajoVideo: React.FC = () => {
  const frame = useCurrentFrame();
  let accumulatedFrames = 0;

  // Audio Ducking: música de fondo baja de volumen mientras habla la voz
  const totalDuration = dealData.scenes.reduce((acc: number, s: any) => acc + s.durationInFrames, 0);
  const bgVolume = interpolate(
    frame,
    [0, 20, totalDuration - 45, totalDuration],
    [0.16, 0.08, 0.08, 0.18],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#FFE600', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
      {/* Audios con Ducking */}
      <Audio src={staticFile('voice.mp3')} volume={1.6} />
      <Audio src={staticFile('bg_music.mp3')} volume={bgVolume} />

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
