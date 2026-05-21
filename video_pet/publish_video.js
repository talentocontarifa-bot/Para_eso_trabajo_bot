const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const { execSync } = require('child_process');

const PAGE_ID = process.env.META_PAGE_ID || process.env.PAGE_ID;
const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const VIDEO_PATH = path.join(__dirname, 'out', 'video_final_pet.mp4');
const DEAL_DATA_PATH = path.join(__dirname, 'src', 'deal_data.json');

if (!PAGE_ID || !ACCESS_TOKEN) {
  console.error('❌ Faltan META_PAGE_ID o META_PAGE_ACCESS_TOKEN');
  process.exit(1);
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

    const keyPoints = data.key_points
      ? data.key_points.map(p => `✅ ${p}`).join('\n')
      : '';

    const caption =
      `${data.script}\n\n` +
      `🛍️ Consigue el tuyo aquí: ${affiliateLink}\n\n` +
      (keyPoints ? `Destacados:\n${keyPoints}\n\n` : '') +
      `─────────────────────────\n` +
      `🤖 Video creado y publicado 100% de manera automática por Inteligencia Artificial.\n\n` +
      `#ParaEsoTrabajo #Ofertas #Descuentos #ComprasOnline #MercadoLibre #Reels`;

    return caption;
  } catch (e) {
    console.warn('⚠️ No se pudo leer deal_data.json, usando caption genérico.');
    const affiliateLink = getRecentProductLink();
    return (
      `🔥 ¡Ofertón imperdible hoy!\n\n` +
      `🛍️ Cómpralo aquí: ${affiliateLink}\n\n` +
      `¡Para eso trabajo!\n\n` +
      `#ParaEsoTrabajo #Ofertas #Descuentos #Reels`
    );
  }
}

async function publishVideo() {
  const caption = buildCaption();
  const videoSizeKB = Math.round(fs.statSync(VIDEO_PATH).size / 1024);
  console.log(`\n📤 Publicando video en Facebook (${videoSizeKB} KB)...`);
  console.log(`📝 Caption (primeros 120 chars): "${caption.substring(0, 120)}..."`);

  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('description', caption);
  form.append('title', 'Oferta del Día — Para Eso Trabajo');
  form.append('file', fs.createReadStream(VIDEO_PATH), {
    filename: 'video_pet.mp4',
    contentType: 'video/mp4',
  });

  const url = `https://graph.facebook.com/v19.0/${PAGE_ID}/videos`;

  try {
    const response = await axios.post(url, form, {
      headers: form.getHeaders(),
      validateStatus: () => true
    });

    const data = response.data;

    if (data.error) {
      console.error('❌ Error de Meta API:', JSON.stringify(data.error, null, 2));
      process.exit(1);
    }

    console.log(`\n✅ ¡Video publicado con éxito!`);
    console.log(`   Post ID: ${data.id}`);
    console.log(`   URL: https://www.facebook.com/${PAGE_ID}/videos/${data.id}`);

  } catch (err) {
    console.error('❌ Error de red al publicar:', err.message);
    process.exit(1);
  }
}

publishVideo();
