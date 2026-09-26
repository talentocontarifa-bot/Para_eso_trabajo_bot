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
const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const VIDEO_PATH = path.join(__dirname, 'out', 'video_final_pet.mp4');
const DEAL_DATA_PATH = path.join(__dirname, 'src', 'deal_data.json');

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

    const keyPoints = data.key_points
      ? data.key_points.map(p => `✅ ${p}`).join('\n')
      : '';

    const caption =
      `${data.script || '🔥 ¡Ofertón imperdible hoy!'}\n\n` +
      `🛍️ Consigue el tuyo aquí: ${affiliateLink}\n\n` +
      (keyPoints ? `Destacados:\n${keyPoints}\n\n` : '') +
      `─────────────────────────\n` +
      `🤖 Video creado y publicado 100% de manera automática por Inteligencia Artificial.\n\n` +
      `#ParaEsoTrabajo #Ofertas #Descuentos #ComprasOnline #MercadoLibre #Reels #Shorts`;

    return {
      caption,
      title: data.product_title || '🔥 Oferta del Día — Para Eso Trabajo',
      shortTitle: (data.product_title || 'Oferta del Día').substring(0, 80)
    };
  } catch (e) {
    console.warn('⚠️ No se pudo leer deal_data.json, usando caption genérico.');
    const affiliateLink = getRecentProductLink();
    return {
      caption: `🔥 ¡Ofertón imperdible hoy!\n\n🛍️ Cómpralo aquí: ${affiliateLink}\n\n¡Para eso trabajo!\n\n#ParaEsoTrabajo #Ofertas #Descuentos #Reels #Shorts`,
      title: '🔥 Oferta del Día — Para Eso Trabajo',
      shortTitle: 'Oferta del Día'
    };
  }
}

async function publishAll() {
  const content = buildCaption();
  const videoSizeKB = Math.round(fs.statSync(VIDEO_PATH).size / 1024);

  console.log('====================================================');
  console.log('🚀 ORQUESTADOR MULTI-PLATAFORMA — PARA ESO TRABAJO');
  console.log(`📁 Video: ${VIDEO_PATH} (${videoSizeKB} KB)`);
  console.log(`📌 Título: "${content.shortTitle}"`);
  console.log('====================================================');

  const results = {
    tiktok: null,
    instagram: null,
    youtube: null,
    facebook: null
  };

  // 1. PUBLICAR EN TIKTOK
  try {
    console.log('\n--- 1/4: TIKTOK ---');
    const tiktokTitle = `${content.title.substring(0, 150)} #ParaEsoTrabajo #Ofertas #Descuentos`;
    results.tiktok = await publishVideoToTikTok(VIDEO_PATH, {
      title: tiktokTitle
    });
  } catch (err) {
    console.error('❌ Error en TikTok:', err.message);
    results.tiktok = { success: false, error: err.message };
  }

  // 2. PUBLICAR EN INSTAGRAM REELS
  try {
    console.log('\n--- 2/4: INSTAGRAM REELS ---');
    results.instagram = await publishReelToInstagram(VIDEO_PATH, {
      caption: content.caption,
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
      title: `${content.shortTitle} | Para Eso Trabajo`,
      description: content.caption,
      tags: ['ParaEsoTrabajo', 'Ofertas', 'Descuentos', 'MercadoLibre', 'Shorts']
    });
  } catch (err) {
    console.error('❌ Error en YouTube Shorts:', err.message);
    results.youtube = { success: false, error: err.message };
  }

  // 4. PUBLICAR EN FACEBOOK PAGE
  if (PAGE_ID && ACCESS_TOKEN) {
    try {
      console.log('\n--- 4/4: FACEBOOK PAGE ---');
      const form = new FormData();
      form.append('access_token', ACCESS_TOKEN);
      form.append('description', content.caption);
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
        console.log(`✅ [Facebook] Video publicado exitosamente! ID: ${response.data.id}`);
        results.facebook = { success: true, id: response.data.id };
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
