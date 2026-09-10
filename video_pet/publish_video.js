const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const { execSync } = require('child_process');

const PAGE_ID = process.env.META_PAGE_ID || process.env.PAGE_ID;
const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID;
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const TIKTOK_WEBHOOK_URL = process.env.TIKTOK_WEBHOOK_URL;
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

// ─────────────────────────────────────────
// 1. PUBLICAR EN FACEBOOK
// ─────────────────────────────────────────
async function publishToFacebook(caption) {
  const videoSizeKB = Math.round(fs.statSync(VIDEO_PATH).size / 1024);
  console.log(`\n🔵 [Facebook] Publicando video (${videoSizeKB} KB)...`);

  const form = new FormData();
  form.append('access_token', ACCESS_TOKEN);
  form.append('description', caption);
  form.append('title', 'Oferta del Día — Para Eso Trabajo');
  form.append('file', fs.createReadStream(VIDEO_PATH), {
    filename: 'video_pet.mp4',
    contentType: 'video/mp4',
  });

  const url = `https://graph.facebook.com/v19.0/${PAGE_ID}/videos`;

  const response = await axios.post(url, form, {
    headers: form.getHeaders(),
    validateStatus: () => true
  });

  const data = response.data;

  if (data.error) {
    throw new Error(`Meta API error: ${JSON.stringify(data.error)}`);
  }

  const postUrl = `https://www.facebook.com/${PAGE_ID}/videos/${data.id}`;
  console.log(`✅ [Facebook] ¡Video publicado con éxito!`);
  console.log(`   Post ID: ${data.id}`);
  console.log(`   URL: ${postUrl}`);

  return { success: true, id: data.id, url: postUrl };
}

// ─────────────────────────────────────────
// 2. PUBLICAR EN INSTAGRAM REELS
// ─────────────────────────────────────────
async function getInstagramAccountId() {
  if (INSTAGRAM_ACCOUNT_ID) {
    return INSTAGRAM_ACCOUNT_ID;
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${PAGE_ID}?fields=instagram_business_account&access_token=${ACCESS_TOKEN}`;
    const response = await axios.get(url, { validateStatus: () => true });
    if (response.data && response.data.instagram_business_account && response.data.instagram_business_account.id) {
      return response.data.instagram_business_account.id;
    }
  } catch (e) {
    console.warn(`⚠️ Error al consultar instagram_business_account: ${e.message}`);
  }

  return null;
}

async function publishToInstagram(caption) {
  console.log(`\n🟣 [Instagram Reels] Verificando cuenta vinculada...`);
  const igUserId = await getInstagramAccountId();

  if (!igUserId) {
    console.log(`ℹ️ [Instagram] No se detectó una cuenta comercial de Instagram vinculada a la página de Facebook (${PAGE_ID}).`);
    console.log(`   💡 Para publicar en Instagram Reels: vincula tu cuenta en Configuración de la Página de Facebook > Cuentas Vinculadas > Instagram, o agrega el secreto INSTAGRAM_ACCOUNT_ID.`);
    return { status: 'skipped', reason: 'no_instagram_account_linked' };
  }

  console.log(`🟣 [Instagram Reels] Cuenta vinculada encontrada: ${igUserId}`);
  const videoBuffer = fs.readFileSync(VIDEO_PATH);
  const videoSizeBytes = videoBuffer.length;

  // Paso 1: Crear contenedor de Reels mediante Resumable Upload
  console.log(`   1. Creando contenedor de Reels (Resumable Upload)...`);
  const containerUrl = `https://graph.facebook.com/v19.0/${igUserId}/media`;
  const initRes = await axios.post(containerUrl, null, {
    params: {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: caption,
      access_token: ACCESS_TOKEN
    },
    validateStatus: () => true
  });

  if (initRes.data.error) {
    throw new Error(`Error al iniciar contenedor Reels: ${JSON.stringify(initRes.data.error)}`);
  }

  const containerId = initRes.data.id;
  const uploadUri = initRes.data.uri;

  if (!uploadUri) {
    throw new Error(`No se recibió upload uri de Meta para Reels: ${JSON.stringify(initRes.data)}`);
  }

  // Paso 2: Subir el binario del video
  console.log(`   2. Subiendo binario de video a Meta (${Math.round(videoSizeBytes / 1024)} KB)...`);
  const uploadRes = await axios.post(uploadUri, videoBuffer, {
    headers: {
      'Authorization': `OAuth ${ACCESS_TOKEN}`,
      'offset': '0',
      'file_size': videoSizeBytes.toString(),
      'Content-Type': 'application/octet-stream'
    },
    validateStatus: () => true
  });

  if (uploadRes.data.error || (uploadRes.status !== 200 && !uploadRes.data.success)) {
    throw new Error(`Error en subida binaria a Meta: ${JSON.stringify(uploadRes.data)}`);
  }

  // Paso 3: Esperar a que Meta termine de procesar el video
  console.log(`   3. Esperando procesamiento de Reels en Meta...`);
  let isReady = false;
  const maxAttempts = 24; // 24 * 5s = 2 minutos máx
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await axios.get(`https://graph.facebook.com/v19.0/${containerId}`, {
      params: {
        fields: 'status_code,status',
        access_token: ACCESS_TOKEN
      },
      validateStatus: () => true
    });

    const statusCode = statusRes.data?.status_code;
    console.log(`      Intento ${attempt}/${maxAttempts}: Estado = ${statusCode || 'Desconocido'}`);

    if (statusCode === 'FINISHED') {
      isReady = true;
      break;
    } else if (statusCode === 'ERROR') {
      throw new Error(`Error de procesamiento en Reels: ${JSON.stringify(statusRes.data)}`);
    }
  }

  if (!isReady) {
    throw new Error('El procesamiento del Reel tardó más de 2 minutos.');
  }

  // Paso 4: Publicar contenedor
  console.log(`   4. Publicando contenedor definitivo en Instagram Reels...`);
  const publishRes = await axios.post(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, null, {
    params: {
      creation_id: containerId,
      access_token: ACCESS_TOKEN
    },
    validateStatus: () => true
  });

  if (publishRes.data.error) {
    throw new Error(`Error al publicar Reel: ${JSON.stringify(publishRes.data.error)}`);
  }

  const igMediaId = publishRes.data.id;
  console.log(`✅ [Instagram Reels] ¡Reel publicado con éxito! ID: ${igMediaId}`);
  return { success: true, id: igMediaId };
}

// ─────────────────────────────────────────
// 3. PUBLICAR EN TIKTOK
// ─────────────────────────────────────────
async function publishToTikTok(caption) {
  console.log(`\n⚫ [TikTok] Verificando credenciales / webhook...`);

  if (TIKTOK_ACCESS_TOKEN) {
    console.log(`⚫ [TikTok] Publicando mediante TikTok Content Posting API...`);
    const videoBuffer = fs.readFileSync(VIDEO_PATH);
    const videoSizeBytes = videoBuffer.length;

    // Inicializar subida
    const initRes = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      post_info: {
        title: caption.substring(0, 150),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSizeBytes,
        chunk_size: videoSizeBytes,
        total_chunk_count: 1
      }
    }, {
      headers: {
        'Authorization': `Bearer ${TIKTOK_ACCESS_TOKEN}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      validateStatus: () => true
    });

    if (initRes.data.error && initRes.data.error.code !== 'ok') {
      throw new Error(`Error en TikTok API init: ${JSON.stringify(initRes.data.error)}`);
    }

    const uploadUrl = initRes.data?.data?.upload_url;
    const publishId = initRes.data?.data?.publish_id;

    if (!uploadUrl) {
      throw new Error(`TikTok no retornó upload_url: ${JSON.stringify(initRes.data)}`);
    }

    // Subir video a upload_url
    await axios.put(uploadUrl, videoBuffer, {
      headers: {
        'Content-Range': `bytes 0-${videoSizeBytes - 1}/${videoSizeBytes}`,
        'Content-Type': 'video/mp4'
      }
    });

    console.log(`✅ [TikTok] ¡Video enviado a TikTok exitosamente! Publish ID: ${publishId}`);
    return { success: true, id: publishId };
  }

  if (TIKTOK_WEBHOOK_URL) {
    console.log(`⚫ [TikTok] Enviando payload a Webhook externo (${TIKTOK_WEBHOOK_URL})...`);
    const videoBuffer = fs.readFileSync(VIDEO_PATH);

    const webhookPayload = {
      event: 'video_pet_ready',
      platform: 'tiktok',
      title: 'Oferta del Día — Para Eso Trabajo',
      caption: caption,
      filename: 'video_final_pet.mp4',
      video_base64: videoBuffer.toString('base64'),
      timestamp: new Date().toISOString()
    };

    const res = await axios.post(TIKTOK_WEBHOOK_URL, webhookPayload, {
      validateStatus: () => true
    });

    if (res.status >= 400) {
      throw new Error(`Webhook devolvió error HTTP ${res.status}: ${JSON.stringify(res.data)}`);
    }

    console.log(`✅ [TikTok] ¡Video enviado al webhook con éxito!`);
    return { success: true, id: 'webhook_notified' };
  }

  console.log(`ℹ️ [TikTok] No se encontró TIKTOK_ACCESS_TOKEN ni TIKTOK_WEBHOOK_URL.`);
  console.log(`   💡 Para publicar en TikTok automáticamente:`);
  console.log(`      - Opción A: Configura el secreto TIKTOK_ACCESS_TOKEN (TikTok Developer App)`);
  console.log(`      - Opción B: Configura TIKTOK_WEBHOOK_URL (Make, Zapier, Ayrshare o Metricool)`);
  return { status: 'skipped', reason: 'no_credentials_configured' };
}

// ─────────────────────────────────────────
// 4. MAIN ORCHESTRATOR
// ─────────────────────────────────────────
async function main() {
  const caption = buildCaption();
  console.log(`\n========================================`);
  console.log(`🚀 Iniciando Publicación Multiplataforma`);
  console.log(`========================================`);
  console.log(`📝 Caption:\n${caption.substring(0, 150)}...\n`);

  const results = {};

  // 1. Facebook
  try {
    results.facebook = await publishToFacebook(caption);
  } catch (e) {
    console.error(`❌ [Facebook] Error: ${e.message}`);
    results.facebook = { success: false, error: e.message };
  }

  // 2. Instagram
  try {
    results.instagram = await publishToInstagram(caption);
  } catch (e) {
    console.error(`❌ [Instagram] Error: ${e.message}`);
    results.instagram = { success: false, error: e.message };
  }

  // 3. TikTok
  try {
    results.tiktok = await publishToTikTok(caption);
  } catch (e) {
    console.error(`❌ [TikTok] Error: ${e.message}`);
    results.tiktok = { success: false, error: e.message };
  }

  console.log(`\n========================================`);
  console.log(`📊 RESUMEN DE PUBLICACIÓN`);
  console.log(`========================================`);
  console.log(`🔵 Facebook:  ${results.facebook.success ? '✅ Publicado (' + results.facebook.id + ')' : '❌ Falló: ' + results.facebook.error}`);
  console.log(`🟣 Instagram: ${results.instagram.success ? '✅ Publicado en Reels (' + results.instagram.id + ')' : (results.instagram.status === 'skipped' ? '⏸️ Omitido (' + results.instagram.reason + ')' : '❌ Falló: ' + results.instagram.error)}`);
  console.log(`⚫ TikTok:    ${results.tiktok.success ? '✅ Enviado (' + results.tiktok.id + ')' : (results.tiktok.status === 'skipped' ? '⏸️ Omitido (' + results.tiktok.reason + ')' : '❌ Falló: ' + results.tiktok.error)}`);
  console.log(`========================================\n`);

  // Si Facebook falló, salimos con error para que GitHub Actions lo señale
  if (!results.facebook.success) {
    process.exit(1);
  }
}

main();
