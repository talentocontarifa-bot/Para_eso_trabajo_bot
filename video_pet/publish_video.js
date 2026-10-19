const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
let axios;
try {
  axios = require('axios');
} catch (e) {
  try {
    axios = require(path.join(__dirname, 'node_modules', 'axios'));
  } catch (e2) {
    throw e;
  }
}
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { publishReelToInstagram } = require('../instagram_publisher');
const { publishVideoToTikTok } = require('../tiktok_publisher');
const { publishVideoToYouTube } = require('../youtube_publisher');

const PAGE_ID = process.env.META_PAGE_ID || process.env.PAGE_ID;
const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const VIDEO_PATH = path.join(__dirname, 'out', 'video_final_pet.mp4');
const DEAL_DATA_PATH = path.join(__dirname, 'src', 'deal_data.json');

async function resolveFacebookPageToken() {
  if (!PAGE_ID || !ACCESS_TOKEN) return ACCESS_TOKEN;
  try {
    const r = await axios.get(`https://graph.facebook.com/v21.0/${PAGE_ID}?fields=access_token&access_token=${ACCESS_TOKEN}`, { validateStatus: () => true });
    if (r.data && r.data.access_token) {
      return r.data.access_token;
    }
  } catch (e) {}
  return ACCESS_TOKEN;
}

if (!fs.existsSync(VIDEO_PATH)) {
  console.error('❌ No se encontró el video en:', VIDEO_PATH);
  process.exit(1);
}

// Helper para obtener el link del producto (si no está en deal_data.json)
function getRecentProductLink() {
  try {
    const closedIssuesJson = execSync('gh issue list --state closed --json number,title,body --limit 5').toString();
    const closedIssues = JSON.parse(closedIssuesJson);
    const urlRegex = /(https?:\/\/[^\s]+)/;

    for (const issue of closedIssues) {
      const match = (issue.body || '').match(urlRegex) || issue.title.match(urlRegex);
      if (match) return match[1];
    }
  } catch (e) {}

  const queuePath = path.join(__dirname, '..', 'queue.json');
  if (fs.existsSync(queuePath)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      const items = Array.isArray(queue) ? queue : [];
      if (items.length > 0 && items[items.length - 1].link) {
        return items[items.length - 1].link;
      }
    } catch (e) {}
  }
  return "https://www.mercadolibre.com.mx";
}

function buildCaption() {
  try {
    const data = JSON.parse(fs.readFileSync(DEAL_DATA_PATH, 'utf-8'));
    const affiliateLink = data.affiliate_link || getRecentProductLink();
    const productTitle = data.product_title || 'Oferta Imperdible en Mercado Libre';
    const shortTitle = productTitle.substring(0, 60);
    const offerNum = parseFloat(String(data.offer_price || '').replace(/[$,\s]/g, ''));
    const origNum = parseFloat(String(data.original_price || '').replace(/[$,\s]/g, ''));
    const savingsNum = (origNum > offerNum) ? Math.round(origNum - offerNum) : 0;

    const offerPrice = data.offer_price ? `$${data.offer_price}` : '';
    const originalPrice = data.original_price ? `$${data.original_price}` : '';
    const discNum = parseInt(data.discount_percentage || '0', 10);
    const roundedDecade = discNum >= 15 ? Math.floor(discNum / 10) * 10 : discNum;
    const isRoundedPlus = discNum >= 15 && (discNum % 10 !== 0);
    const discountLabel = discNum > 0
      ? (isRoundedPlus ? `MÁS DEL ${roundedDecade}% DE DESCUENTO` : `${discNum}% DE DESCUENTO`)
      : '';
    const shortDiscountLabel = discNum > 0
      ? (isRoundedPlus ? `+${roundedDecade}% OFF` : `-${discNum}% OFF`)
      : '';

    // LÍNEA 1: GOLPE DE DESCUENTO REDONDEADO + MERCADO LIBRE + QUÉ ES
    const headlineLine = discountLabel
      ? `🚨 ¡${discountLabel} EN MERCADO LIBRE! ${productTitle}`
      : `🚨 ¡OFERTA EN MERCADO LIBRE! ${productTitle}`;

    // LÍNEA 2: PRECIO DIRECTO + ANTES + AHORRO EN PESOS
    let priceHeader = '';
    if (offerPrice && originalPrice && savingsNum > 0) {
      priceHeader = `💥 HOY EN MERCADO LIBRE: ${offerPrice} MXN (Antes ${originalPrice} — ¡Te ahorras $${savingsNum}!)`;
    } else if (offerPrice && discountLabel) {
      priceHeader = `💥 HOY EN MERCADO LIBRE: ${offerPrice} MXN (¡${discountLabel}!)`;
    } else if (offerPrice) {
      priceHeader = `💥 HOY EN MERCADO LIBRE: ${offerPrice} MXN`;
    } else {
      priceHeader = `💥 ¡PRECIO DE REMATE HOY EN MERCADO LIBRE!`;
    }

    // QUÉ ES Y QUÉ HACE (Directo, sin rollo)
    const productScene = (data.scenes || []).find(s => s.type === 'product');
    const whatItDoes =
      data.sales_pitch ||
      productScene?.voice_text ||
      'Potencia, calidad y envío rápido FULL directo en Mercado Libre.';

    const keyPoints = data.key_points
      ? data.key_points.map(p => `✅ ${p.replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')}`).join('\n')
      : '';

    const hashtags = `#ParaEsoTrabajo #Ofertas #Descuentos #MercadoLibre #ComprasOnline #Reels #Shorts`;

    // 1. FACEBOOK: Golpe arriba + Link en Línea 3 + Qué es y qué hace + Link abajo
    const facebookCaption =
      `${headlineLine}\n` +
      `${priceHeader}\n` +
      `👉 Cómpralo aquí en Mercado Libre: ${affiliateLink}\n\n` +
      `⚡ ¿Qué es y qué hace?\n${whatItDoes}\n\n` +
      (keyPoints ? `${keyPoints}\n\n` : '') +
      `🔥 A este precio vuela. ¡Date el gusto, que para eso trabajas!\n` +
      `🛒 Link directo a Mercado Libre:\n${affiliateLink}\n\n` +
      hashtags;

    // 2. YOUTUBE SHORTS: Descuento + Precio + Producto en título, Link en Línea 1
    const youtubeTitle = offerPrice && shortDiscountLabel
      ? `🚨 ¡${shortDiscountLabel} en Mercado Libre! ${shortTitle} a ${offerPrice} #Shorts`
      : `🚨 ${shortTitle} en OFERTA en Mercado Libre #Shorts`;

    const youtubeDescription =
      `👉 Cómpralo aquí en Mercado Libre: ${affiliateLink}\n\n` +
      `${headlineLine}\n` +
      `${priceHeader}\n\n` +
      `⚡ ¿Qué es y qué hace?\n${whatItDoes}\n\n` +
      (keyPoints ? `${keyPoints}\n\n` : '') +
      `🛒 Enlace directo: ${affiliateLink}\n\n` +
      hashtags;

    // 3. INSTAGRAM REELS: Golpe arriba + Link en Bio / URL corta + Qué hace
    const instagramCaption =
      `${headlineLine}\n` +
      `${priceHeader}\n` +
      `🔗 Link directo en nuestra BIO o entra a: ${affiliateLink}\n\n` +
      `⚡ ¿Qué es y qué hace?\n${whatItDoes}\n\n` +
      (keyPoints ? `${keyPoints}\n\n` : '') +
      `🔥 A este precio se agota volando. ¡Para eso trabajas!\n\n` +
      hashtags;

    // 4. TIKTOK: Directo al descuento, precio y qué hace
    const tiktokCaption =
      `${headlineLine} | ${priceHeader} ⚡ ${whatItDoes} 👉 Link directo en perfil: ${affiliateLink} #ParaEsoTrabajo #Ofertas #Descuentos #MercadoLibre`;

    return {
      caption: facebookCaption,
      facebookCaption,
      instagramCaption,
      youtubeDescription,
      youtubeTitle,
      tiktokCaption,
      affiliateLink,
      title: `${headlineLine} — ${offerPrice}`,
      shortTitle
    };
  } catch (e) {
    console.warn('⚠️ No se pudo leer deal_data.json, usando caption genérico.');
    const affiliateLink = getRecentProductLink();
    const fallback = `🔥 ¡Ofertón imperdible en Mercado Libre!\n👉 Cómpralo aquí: ${affiliateLink}\n\n¡Date el gusto, que para eso trabajas!\n\n#ParaEsoTrabajo #Ofertas #Descuentos #Reels #Shorts`;
    return {
      caption: fallback,
      facebookCaption: fallback,
      instagramCaption: fallback,
      youtubeDescription: fallback,
      youtubeTitle: '🔥 Oferta del Día | Para Eso Trabajo #Shorts',
      tiktokCaption: fallback,
      affiliateLink,
      title: '🔥 Oferta del Día — Para Eso Trabajo',
      shortTitle: 'Oferta del Día'
    };
  }
}

async function publishAll() {
  const content = buildCaption();
  const isDryRun = process.argv.includes('--dry-run');
  const videoSizeKB = fs.existsSync(VIDEO_PATH) ? Math.round(fs.statSync(VIDEO_PATH).size / 1024) : 0;

  console.log('====================================================');
  console.log('🚀 ORQUESTADOR MULTI-PLATAFORMA — PARA ESO TRABAJO');
  console.log(`📁 Video: ${VIDEO_PATH} (${videoSizeKB} KB)`);
  console.log(`📌 Título: "${content.title}"`);
  console.log('====================================================');

  if (isDryRun) {
    console.log('\n🧪 [MODO DEMO / DRY-RUN] Previsualización de Copys por Red Social:\n');
    console.log('--- 📘 FACEBOOK (Post + Video Description) ---');
    console.log(content.facebookCaption);
    console.log(`\n💬 [Facebook Auto-Comentario #1]:\n🛍️ Enlace directo a la oferta en Mercado Libre:\n${content.affiliateLink}\n`);
    console.log('--- 📸 INSTAGRAM REELS ---');
    console.log(content.instagramCaption);
    console.log('\n--- ▶️ YOUTUBE SHORTS ---');
    console.log(`Título: ${content.youtubeTitle}`);
    console.log(content.youtubeDescription);
    console.log('\n--- 🎵 TIKTOK ---');
    console.log(content.tiktokCaption);
    return;
  }

  const results = {
    tiktok: null,
    instagram: null,
    youtube: null,
    facebook: null
  };

  // 1. PUBLICAR EN TIKTOK
  try {
    console.log('\n--- 1/4: TIKTOK ---');
    results.tiktok = await publishVideoToTikTok(VIDEO_PATH, {
      title: content.tiktokCaption.substring(0, 2000)
    });
  } catch (err) {
    console.error('❌ Error en TikTok:', err.message);
    results.tiktok = { success: false, error: err.message };
  }

  // 2. PUBLICAR EN INSTAGRAM REELS
  try {
    console.log('\n--- 2/4: INSTAGRAM REELS ---');
    results.instagram = await publishReelToInstagram(VIDEO_PATH, {
      caption: content.instagramCaption,
      share_to_feed: true
    });
  } catch (err) {
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('❌ Error en Instagram Reels:', errorDetails);
    results.instagram = { success: false, error: errorDetails };
  }

  // 3. PUBLICAR EN YOUTUBE SHORTS
  try {
    console.log('\n--- 3/4: YOUTUBE SHORTS ---');
    results.youtube = await publishVideoToYouTube(VIDEO_PATH, {
      title: content.youtubeTitle,
      description: content.youtubeDescription,
      tags: ['ParaEsoTrabajo', 'Ofertas', 'Descuentos', 'MercadoLibre', 'Shorts']
    });
  } catch (err) {
    console.error('❌ Error en YouTube Shorts:', err.message);
    results.youtube = { success: false, error: err.message };
  }

  // 4. PUBLICAR EN FACEBOOK PAGE + PRIMER COMENTARIO CON LINK CLICKEABLE
  if (PAGE_ID && ACCESS_TOKEN) {
    try {
      console.log('\n--- 4/4: FACEBOOK PAGE ---');
      const fbPageToken = await resolveFacebookPageToken();
      const form = new FormData();
      form.append('access_token', fbPageToken);
      form.append('description', content.facebookCaption);
      form.append('title', content.title);
      form.append('file', fs.createReadStream(VIDEO_PATH), {
        filename: 'video_pet.mp4',
        contentType: 'video/mp4',
      });

      const url = `https://graph.facebook.com/v21.0/${PAGE_ID}/videos`;
      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        validateStatus: () => true
      });

      if (response.data?.error) {
        console.error('❌ [Facebook] Error:', response.data.error.message);
        results.facebook = { success: false, error: response.data.error.message };
      } else {
        const fbVideoId = response.data.id;
        console.log(`✅ [Facebook] Video publicado exitosamente! ID: ${fbVideoId}`);
        results.facebook = { success: true, id: fbVideoId };

        // Publicar automáticamente el primer comentario con el link directo clickeable
        try {
          const commentUrl = `https://graph.facebook.com/v21.0/${fbVideoId}/comments`;
          await axios.post(commentUrl, {
            message: `🛍️ Enlace directo a la oferta en Mercado Libre:\n${content.affiliateLink}`,
            access_token: fbPageToken
          });
          console.log(`💬 [Facebook] Primer comentario con link clickeable agregado con éxito.`);
        } catch (commErr) {
          console.warn(`⚠️ [Facebook] No se pudo agregar el primer comentario:`, commErr.response?.data?.error?.message || commErr.message);
        }
      }
    } catch (err) {
      console.error('❌ [Facebook] Error:', err.message);
      results.facebook = { success: false, error: err.message };
    }
  } else {
    console.log('ℹ️ [Facebook] Omitido: No se configuraron credenciales directas de Facebook Page.');
  }

  console.log('\n====================================================');
  console.log('📊 REPORTE DE PUBLICACIÓN FINAL — PARA ESO TRABAJO');
  console.log('====================================================');
  console.log(`🎵 TikTok:          ${results.tiktok?.success ? '✅ PUBLICADO' : (results.tiktok?.error ? `❌ ERROR (${results.tiktok.error})` : '⚠️ OMITIDO')}`);
  console.log(`📸 Instagram Reels:  ${results.instagram?.success ? '✅ PUBLICADO' : (results.instagram?.error ? `❌ ERROR (${results.instagram.error})` : '⚠️ OMITIDO')}`);
  console.log(`▶️  YouTube Shorts:   ${results.youtube?.success ? '✅ PUBLICADO' : (results.youtube?.error ? `❌ ERROR (${results.youtube.error})` : '⚠️ OMITIDO')}`);
  console.log(`📘 Facebook Page:    ${results.facebook?.success ? '✅ PUBLICADO' : (results.facebook?.error ? `❌ ERROR (${results.facebook.error})` : '⚠️ OMITIDO')}`);
  console.log('====================================================\n');

  // Si este video provino de un issue abierto y se publicó exitosamente, cerramos el issue
  try {
    const rawDealData = fs.readFileSync(DEAL_DATA_PATH, 'utf-8');
    const dealData = JSON.parse(rawDealData);
    if (dealData && dealData.issue_number) {
      const anySuccess = results.tiktok?.success || results.instagram?.success || results.youtube?.success || results.facebook?.success;
      if (anySuccess) {
        console.log(`🔒 Cerrando Issue #${dealData.issue_number} tras publicación exitosa...`);
        const commentLines = [
          `🎉 **¡Video generado y publicado automáticamente!**`,
          results.youtube?.success ? `▶️ **YouTube Short:** ${results.youtube.url || 'Publicado'}` : null,
          results.instagram?.success ? `📸 **Instagram Reel:** Media ID \`${results.instagram.id || 'Publicado'}\`` : null,
          results.tiktok?.success ? `🎵 **TikTok:** Enviado a bandeja de entrada de creador` : null,
        ].filter(Boolean).join('\n');

        const cleanComment = commentLines.replace(/"/g, '\\"');
        try {
          execSync(`gh issue comment ${dealData.issue_number} --body "${cleanComment}"`, { stdio: 'inherit' });
          execSync(`gh issue close ${dealData.issue_number}`, { stdio: 'inherit' });
          console.log(`✅ Issue #${dealData.issue_number} cerrado con éxito en GitHub.`);
        } catch (ghErr) {
          console.warn(`⚠️ Error ejecutando gh CLI para cerrar issue #${dealData.issue_number}:`, ghErr.message);
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ No se pudo procesar cierre automático de issue:", e.message);
  }
}

publishAll();
