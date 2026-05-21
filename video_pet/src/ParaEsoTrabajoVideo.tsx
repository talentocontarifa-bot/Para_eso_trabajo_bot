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
    position: 'absolute', top: 55, right: 55, zIndex: 200,
    backgroundColor: '#3483FA', borderRadius: '12px',
    padding: '10px 24px', boxShadow: '0 8px 16px rgba(52, 131, 250, 0.25)',
  }}>
    <span style={{ fontSize: 26, fontWeight: 800, color: '#FFF', fontFamily: 'Plus Jakarta Sans', letterSpacing: 1 }}>
      Para eso trabajo
    </span>
  </div>
);

const LiveBadge: React.FC = () => {
  const frame = useCurrentFrame();
  const blink = Math.floor(frame / 15) % 2 === 0;
  return (
    <div style={{
      position: 'absolute', top: 55, left: 55, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 12,
      backgroundColor: '#FFF', padding: '12px 24px',
      borderRadius: '30px', boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
      border: '2px solid #EAEAEA'
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        backgroundColor: '#00A650', // Verde de activo
        opacity: blink ? 1 : 0.4,
      }} />
      <span style={{ fontSize: 24, fontWeight: 800, color: '#333', fontFamily: 'Plus Jakarta Sans', letterSpacing: 1 }}>
        MEJOR PRECIO
      </span>
    </div>
  );
};

const ProgressBar: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const pct = interpolate(frame, [0, dur], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 300, height: 12, backgroundColor: '#EAEAEA' }}>
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

  const scale = spring({ fps, frame, from: 0.5, to: 1, config: { damping: 15, stiffness: 120 } });
  const text2Opacity = interpolate(frame, [15, 30], [0, 1], { extrapolateRight: 'clamp' });
  const text2Y = interpolate(frame, [15, 30], [20, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: '#FFE600', justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans' }}>
      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />

      {/* Decorative background shapes */}
      <div style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.15)', top: -100, right: -150, zIndex: 1
      }} />
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.1)', bottom: -100, left: -100, zIndex: 1
      }} />

      {/* White Card */}
      <div style={{
        zIndex: 10,
        transform: `scale(${scale})`,
        backgroundColor: '#FFFFFF',
        padding: '50px 40px',
        borderRadius: '40px',
        boxShadow: '0 30px 60px rgba(0,0,0,0.12)',
        textAlign: 'center',
        width: '85%',
        border: '1px solid rgba(0,0,0,0.05)',
      }}>
        {/* Tag SUPER PRECIO / LIQUIDACION */}
        <div style={{
          display: 'inline-block',
          backgroundColor: '#00A650', // Verde ML
          color: '#FFFFFF',
          padding: '8px 24px',
          borderRadius: '20px',
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: 2,
          marginBottom: 24,
          textTransform: 'uppercase',
        }}>
          {text1}
        </div>

        {/* Product Name */}
        <h1 style={{
          fontSize: 64,
          fontWeight: 900,
          color: '#333333',
          fontFamily: 'Montserrat, sans-serif',
          lineHeight: 1.1,
          margin: 0,
          textTransform: 'uppercase',
          opacity: text2Opacity,
          transform: `translateY(${text2Y}px)`,
        }}>
          {text2}
        </h1>
      </div>
    </AbsoluteFill>
  );
};

// ESCENA 2: IMAGEN + CARACTERÍSTICAS
const ImageTextScene: React.FC<{ text: string; imageFile: string; keyPoints: string[]; dur: number }> = ({ text, imageFile, keyPoints, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ fps, frame, from: 0.8, to: 1, config: { damping: 14 } });
  const points = (keyPoints || []).slice(0, 3);
  const pointInterval = Math.floor(dur * 0.22);

  return (
    <AbsoluteFill style={{ backgroundColor: '#F5F5F7', justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans' }}>
      <Watermark />
      <ProgressBar dur={dur} />

      {/* Main product card */}
      <div style={{
        width: '88%',
        height: '80%',
        backgroundColor: '#FFF',
        borderRadius: '36px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '30px',
        border: '1px solid rgba(0,0,0,0.03)',
        transform: `scale(${scale})`,
        position: 'relative'
      }}>
        {/* Mercado Libre Style Tag: Envío Gratis */}
        <div style={{
          position: 'absolute',
          top: 30,
          left: 30,
          backgroundColor: '#D1F2EB',
          color: '#00A650',
          padding: '8px 16px',
          borderRadius: '8px',
          fontWeight: 700,
          fontSize: 22,
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          ⚡ Envío Gratis
        </div>

        {/* Product Image Frame */}
        <div style={{
          width: '90%',
          height: '45%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginTop: 20,
          marginBottom: 20
        }}>
          <Img
            src={staticFile(imageFile)}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        </div>

        {/* Text / Headline */}
        <h2 style={{
          fontSize: 38,
          fontWeight: 800,
          color: '#333',
          textAlign: 'center',
          marginBottom: 24,
          lineHeight: 1.2,
          padding: '0 10px'
        }}>
          {text}
        </h2>

        {/* Key Points */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: '95%',
        }}>
          {points.map((point, idx) => {
            const startAt = 10 + idx * pointInterval;
            const pointOpacity = interpolate(frame, [startAt, startAt + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const pointX = interpolate(frame, [startAt, startAt + 10], [-20, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

            return (
              <div key={idx} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                opacity: pointOpacity,
                transform: `translateX(${pointX}px)`,
                backgroundColor: '#F5F5F7',
                padding: '10px 16px',
                borderRadius: '12px'
              }}>
                {/* Clean circle green check icon */}
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  backgroundColor: '#E6F6EC', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                  <span style={{ color: '#00A650', fontWeight: 900, fontSize: 18 }}>✓</span>
                </div>
                <span style={{ fontSize: 24, fontWeight: 600, color: '#444' }}>
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

// ESCENA 3: PRECIOS Y DESCUENTOS
const PriceScene: React.FC<{ discount: number; original: string; offer: string; dur: number }> = ({ discount, original, offer, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ fps, frame, from: 0.8, to: 1, config: { damping: 12 } });
  const numberScale = spring({ fps, frame: Math.max(0, frame - 15), from: 0.5, to: 1, config: { damping: 10 } });

  return (
    <AbsoluteFill style={{ backgroundColor: '#F5F5F7', justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans' }}>
      <LiveBadge />
      <Watermark />
      <ProgressBar dur={dur} />

      <div style={{
        width: '88%',
        backgroundColor: '#FFF',
        borderRadius: '36px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '60px 40px',
        border: '1px solid rgba(0,0,0,0.03)',
        transform: `scale(${scale})`,
        textAlign: 'center'
      }}>
        {/* Tag de Descuento */}
        {discount > 0 && (
          <div style={{
            transform: `scale(${numberScale})`,
            display: 'inline-block',
            backgroundColor: '#00A650', // Verde ML
            color: '#FFFFFF',
            padding: '12px 30px',
            borderRadius: '30px',
            fontSize: 36,
            fontWeight: 800,
            marginBottom: 35,
            boxShadow: '0 8px 20px rgba(0, 166, 80, 0.2)'
          }}>
            {discount}% DE DESCUENTO
          </div>
        )}

        {/* Comparación de Precios */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          {original && (
            <span style={{
              fontSize: 38,
              color: '#999999',
              textDecoration: 'line-through',
              fontWeight: 500
            }}>
              Antes: ${original} MXN
            </span>
          )}
          <span style={{
            fontSize: 80,
            fontWeight: 900,
            color: '#111111',
            fontFamily: 'Montserrat, sans-serif',
            letterSpacing: -1
          }}>
            ${offer} MXN
          </span>
        </div>

        {/* Separador sutil */}
        <div style={{ height: 1, backgroundColor: '#EAEAEA', width: '80%', margin: '40px 0' }} />

        {/* Botón Mercado Libre Blue */}
        <div style={{
          backgroundColor: '#3483FA', // Azul ML
          color: '#FFFFFF',
          padding: '18px 45px',
          borderRadius: '16px',
          fontSize: 32,
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 10px 24px rgba(52, 131, 250, 0.3)'
        }}>
          Ver Oferta en el Link ↗
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ESCENA 4: CTA FINAL
const CtaScene: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ fps, frame, from: 0.8, to: 1, config: { damping: 12 } });
  const pulse = interpolate(frame % 30, [0, 15, 30], [1, 1.05, 1]);

  return (
    <AbsoluteFill style={{ backgroundColor: '#FFE600', justifyContent: 'center', alignItems: 'center', fontFamily: 'Plus Jakarta Sans' }}>
      <ProgressBar dur={dur} />

      {/* Decorative background shapes */}
      <div style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        backgroundColor: 'rgba(255, 255, 255, 0.15)', bottom: -100, right: -150, zIndex: 1
      }} />

      <div style={{
        width: '88%',
        backgroundColor: '#FFF',
        borderRadius: '36px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '50px 30px',
        border: '1px solid rgba(0,0,0,0.03)',
        transform: `scale(${scale})`,
        zIndex: 10,
        textAlign: 'center'
      }}>
        {/* Emblema final */}
        <span style={{
          fontSize: 24,
          color: '#3483FA',
          fontWeight: 800,
          letterSpacing: 2,
          marginBottom: 16,
          textTransform: 'uppercase'
        }}>
          ¡NO TE LO PIERDAS!
        </span>

        <h1 style={{
          fontSize: 54,
          fontWeight: 900,
          color: '#333333',
          fontFamily: 'Montserrat, sans-serif',
          lineHeight: 1.15,
          marginBottom: 20
        }}>
          ¿Cómo comprar?
        </h1>

        <p style={{
          fontSize: 28,
          color: '#666666',
          lineHeight: 1.4,
          marginBottom: 40,
          maxWidth: '90%'
        }}>
          Encuentra el enlace oficial de Mercado Libre directo en nuestra biografía o descripción.
        </p>

        {/* Separador */}
        <div style={{ height: 2, backgroundColor: '#F5F5F7', width: '90%', marginBottom: 40 }} />

        {/* Big Blue CTA Button */}
        <div style={{
          transform: `scale(${pulse})`,
          backgroundColor: '#3483FA', // Azul ML
          color: '#FFFFFF',
          padding: '24px 50px',
          borderRadius: '16px',
          fontSize: 36,
          fontWeight: 800,
          boxShadow: '0 12px 30px rgba(52, 131, 250, 0.45)',
          border: '1px solid rgba(0,0,0,0.05)'
        }}>
          👉 LINK EN BIO 👈
        </div>
      </div>
    </AbsoluteFill>
  );
};

// COMPOSITOR PRINCIPAL
export const ParaEsoTrabajoVideo: React.FC = () => {
  let accumulatedFrames = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#FFE600', fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
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
