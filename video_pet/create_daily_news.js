const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getAudioDurationInSeconds } = require('get-audio-duration');
const { scrapeProduct } = require('../scraper');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
// Voz femenina joven y entusiasta GRATIS en API (Laura: FGY2WhTYpPnrIDTdsKH5 | Jessica: cgSgspJ2msm6clMCkdW9)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'FGY2WhTYpPnrIDTdsKH5';
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_v4';
const FPS = 30;

if (!GEMINI_API_KEY && !GROQ_API_KEY) {
  console.error("❌ Faltan variables de entorno: necesitas GEMINI_API_KEY o GROQ_API_KEY");
  process.exit(1);
}
if (!ELEVENLABS_API_KEY) {
  console.warn("⚠️  ELEVENLABS_API_KEY no encontrado. Se usará edge-tts como fallback para la voz.");
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ─────────────────────────────────────────
// 1. OBTENER EL ENLACE DEL PRODUCTO DE HOY
// ─────────────────────────────────────────
async function getRecentProductData() {
  console.log("🔍 Buscando la oferta de hoy...");

  const PAGE_ID = process.env.META_PAGE_ID || process.env.PAGE_ID;
  const ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;

  // A. Obtener fecha de hoy en formato local YYYY-MM-DD (México/Colombia)
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Mexico_City",
      year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const [{ value: month },,{ value: day },,{ value: year }] = formatter.formatToParts(now);
  const todayStr = `${year}-${month}-${day}`;
  console.log(`📅 Fecha de hoy (México/Col): ${todayStr}`);

  // 1. PRIORIDAD MÁXIMA: Issues abiertos en GitHub (el pool que alimentas)
  try {
    console.log("🔍 Verificando pool de issues abiertos en GitHub...");
    const openIssuesJson = execSync('gh issue list --state open --json number,title,body --limit 30').toString();
    const openIssues = JSON.parse(openIssuesJson);
    const urlRegex = /(https?:\/\/[^\s]+)/;

    // Ordenar FIFO (número menor primero, es decir, el más antiguo que se abrió)
    const sortedOpen = openIssues.sort((a, b) => a.number - b.number);
    for (const issue of sortedOpen) {
      const match = (issue.body || '').match(urlRegex) || issue.title.match(urlRegex);
      if (match) {
        const url = match[1];
        console.log(`🎯 ¡ENCONTRADO CANDIDATO EN POOL DE ISSUES! Issue #${issue.number}: "${issue.title}" -> ${url}`);
        return {
          link: url,
          queueItem: {
            producto: issue.title,
            precio: null,
            descuento: null,
            copy: issue.body || '',
            issue_number: issue.number,
            is_issue: true
          }
        };
      }
    }
  } catch (e) {
    console.warn("⚠️ No se pudieron obtener candidatos de open issues vía GH CLI:", e.message);
  }

  // 2. Si no hay issues abiertos, revisar queue.json
  const queuePath = path.join(__dirname, '..', 'queue.json');
  let queueItems = [];
  if (fs.existsSync(queuePath)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      queueItems = Array.isArray(queue) ? queue : [];
    } catch (e) {
      console.error("⚠️ Error leyendo queue.json:", e.message);
    }
  }

  // Si hay un item programado específicamente para HOY en queue.json
  const todayItem = queueItems.find(item => item.scheduled_date && item.scheduled_date.startsWith(todayStr));
  if (todayItem && todayItem.link) {
    console.log(`🎯 Encontrada oferta programada específicamente para hoy en queue.json (ID: ${todayItem.id}): ${todayItem.producto}`);
    return { link: todayItem.link, queueItem: todayItem };
  }

  // Recopilar candidatos de queue.json y closed issues
  console.log("🔄 Buscando candidatos frescos de queue.json...");
  const candidatesMap = new Map();

  queueItems.forEach(item => {
    if (item.link) {
      candidatesMap.set(item.link, {
        link: item.link,
        producto: item.producto,
        precio: item.precio,
        descuento: item.descuento,
        copy: item.copy
      });
    }
  });

  // Candidatos de closed issues (vía gh CLI)
  try {
    const closedIssuesJson = execSync('gh issue list --state closed --json number,title,body --limit 30').toString();
    const closedIssues = JSON.parse(closedIssuesJson);
    const urlRegex = /(https?:\/\/[^\s]+)/;

    for (const issue of closedIssues) {
      const match = (issue.body || '').match(urlRegex) || issue.title.match(urlRegex);
      if (match) {
        const url = match[1];
        if (!candidatesMap.has(url)) {
          candidatesMap.set(url, {
            link: url,
            producto: issue.title,
            precio: null,
            descuento: null,
            copy: issue.body || ''
          });
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ No se pudieron obtener candidatos de closed issues vía GH CLI.");
  }

  const allCandidates = Array.from(candidatesMap.values());
  console.log(`📋 Total de candidatos únicos encontrados: ${allCandidates.length}`);

  if (allCandidates.length === 0) {
    // Fallback por defecto si no hay nada
    const defaultLink = "https://articulo.mercadolibre.com.mx/MLM-1402242137-audifonos-diadema-bluetooth-inalambricos-auriculares-hifi-_JM";
    console.log(`⚠️ No se encontraron candidatos. Usando fallback por defecto: ${defaultLink}`);
    return { link: defaultLink, queueItem: { producto: "Audífonos Inalámbricos Bluetooth", precio: "$299", descuento: "50% OFF" } };
  }

  // C. Obtener descripciones de los videos publicados recientemente en Facebook para evitar duplicados
  let recentVideoTexts = [];
  if (PAGE_ID && ACCESS_TOKEN) {
    try {
      console.log("📊 Consultando videos publicados recientemente en Facebook para evitar duplicados...");
      const fbUrl = `https://graph.facebook.com/v19.0/${PAGE_ID}/videos?fields=description,title&limit=15&access_token=${ACCESS_TOKEN}`;
      const res = await fetch(fbUrl);
      if (res.ok) {
        const resJson = await res.json();
        if (resJson && resJson.data) {
          recentVideoTexts = resJson.data.map(v => `${v.title || ''} ${v.description || ''}`);
          console.log(`✅ Obtenidas descripciones de los últimos ${recentVideoTexts.length} videos de Facebook.`);
        }
      } else {
        console.warn(`⚠️ Respuesta de API de Meta no exitosa: ${res.status} ${res.statusText}`);
      }
    } catch (fbErr) {
      console.warn("⚠️ Error conectando con API de Meta para verificar videos duplicados:", fbErr.message);
    }
  }

  // D. Filtrar candidatos que ya tienen video reciente
  const freshCandidates = allCandidates.filter(c => {
    // Comprobar si el link o el título corto del producto aparecen en las descripciones de los videos recientes
    const isUsed = recentVideoTexts.some(text => {
      if (text.includes(c.link)) return true;
      const cleanTitle = c.producto.replace(/\(repetición\)/gi, '').trim().toLowerCase();
      // Si el título es muy largo, tomamos las primeras 3 palabras clave significativas
      const keywords = cleanTitle.split(/\s+/).filter(w => w.length > 3).slice(0, 3);
      if (keywords.length > 0) {
        const matchesAllKeywords = keywords.every(kw => text.toLowerCase().includes(kw));
        if (matchesAllKeywords) return true;
      }
      return false;
    });
    return !isUsed;
  });

  console.log(`✨ Candidatos frescos (sin video reciente): ${freshCandidates.length}`);

  if (freshCandidates.length > 0) {
    // Tomar el candidato fresco más reciente
    const selected = freshCandidates[0];
    console.log(`🎯 Seleccionada oferta fresca para video: ${selected.producto} (${selected.link})`);
    return { link: selected.link, queueItem: selected };
  } else {
    // Si todos ya se usaron recientemente, elegimos el primero/más nuevo del total para no detener la publicación diaria
    const selected = allCandidates[0];
    console.log(`⚠️ Todos los candidatos se usaron recientemente. Seleccionando el más reciente por defecto: ${selected.producto}`);
    return { link: selected.link, queueItem: selected };
  }
}

// ─────────────────────────────────────────
// 2. DESCARGAR LA IMAGEN DEL PRODUCTO
// ─────────────────────────────────────────
async function downloadImage(url, destPath) {
  console.log(`📥 Descargando imagen del producto de: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error descargando imagen: ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
  console.log(`✅ Imagen descargada exitosamente en ${destPath}`);
}

// ─────────────────────────────────────────
// 3. GENERAR METADATOS Y GUION CON IA (Groq / Gemini)
// ─────────────────────────────────────────
async function generateDealMetadata(data) {
  console.log("🤖 Consultando IA para generar guion sincronizado por escenas y metadatos...");

  const cleanTitle = data.title;
  const cleanPrice = data.price;
  const cleanOriginalPrice = data.originalPrice;
  const cleanDiscount = data.discount;

  const productInfo = `
  PRODUCTO: ${cleanTitle}
  PRECIO DE OFERTA: $${cleanPrice} pesos
  PRECIO ORIGINAL: $${cleanOriginalPrice || 'No especificado'} pesos
  DESCUENTO: ${cleanDiscount}% OFF
  DESCRIPCIÓN: ${data.description ? data.description.substring(0, 400) : 'Sin descripción.'}
  NOTAS Y CONTEXTO:
  """
  ${data.userNotes || 'Ninguno.'}
  """
  `;

  const offerNum = parseFloat(cleanPrice);
  const origNum = parseFloat(cleanOriginalPrice || '0');
  const savingsAmount = (origNum > offerNum) ? Math.round(origNum - offerNum) : '';
  const discNum = parseInt(cleanDiscount || '0', 10);
  const roundedDecade = discNum >= 15 ? Math.floor(discNum / 10) * 10 : discNum;
  const isRoundedPlus = discNum >= 15 && (discNum % 10 !== 0);
  const spokenDiscount = isRoundedPlus
    ? `más del ${roundedDecade} por ciento de descuento`
    : `${discNum} por ciento de descuento`;
  const visualDiscount = isRoundedPlus
    ? `MÁS DEL ${roundedDecade}% DE DESCUENTO`
    : `${discNum}% DE DESCUENTO`;
  const badgeDiscount = isRoundedPlus ? `+${roundedDecade}% OFF` : `−${discNum}% OFF`;

  function normalizeDealScript(parsedObj) {
    if (!parsedObj || !Array.isArray(parsedObj.scenes)) return parsedObj;
    const numberWords = {
      1: 'uno', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 7: 'siete', 8: 'ocho', 9: 'nueve'
    };
    const decadeWords = {
      10: 'diez', 20: 'veinte', 30: 'treinta', 40: 'cuarenta', 50: 'cincuenta',
      60: 'sesenta', 70: 'setenta', 80: 'ochenta', 90: 'noventa'
    };
    if (isRoundedPlus && decadeWords[roundedDecade]) {
      const unit = discNum % 10;
      const exactSpoken = `${decadeWords[roundedDecade]} y ${numberWords[unit]}`;
      const exactRegex = new RegExp(`(un\\s+|del\\s+)?(${exactSpoken}|${discNum})\\s*(%|por\\s+ciento)(\\s+de\\s+descuento)?`, 'gi');
      parsedObj.scenes.forEach(sc => {
        if (sc.voice_text) {
          sc.voice_text = sc.voice_text.replace(exactRegex, `más del ${decadeWords[roundedDecade]} por ciento de descuento`);
          sc.voice_text = sc.voice_text.replace(/más del más del/gi, 'más del');
        }
        if (sc.subtitle) {
          sc.subtitle = sc.subtitle.replace(new RegExp(`[-−]?${discNum}%`, 'g'), `+${roundedDecade}%`);
        }
      });
    }
    // Garantizar que se mencione Mercado Libre en el guion hablado
    const allVoice = parsedObj.scenes.map(s => s.voice_text || '').join(' ').toLowerCase();
    if (!allVoice.includes('mercado libre')) {
      if (parsedObj.scenes[0]?.voice_text) {
        parsedObj.scenes[0].voice_text = parsedObj.scenes[0].voice_text.replace(/\.?\s*$/, ' en Mercado Libre.');
      }
    }
    return parsedObj;
  }

  const prompt = `Actúa como el mejor vendedor de respuesta directa y creador de anuncios agresivos de Mercado Libre / TikTok para "Para eso trabajo".
Tu misión: crear un video vertical 9:16 AGRESIVO, DIRECTO AL GRANO y ULTRA VENDEDOR sobre esta oferta real en Mercado Libre:
${productInfo}
AHORRO EN PESOS: ${savingsAmount ? '$' + savingsAmount + ' MXN' : 'Descuento directo'}

REGLAS ESTRICTAS DE VENTA AGRESIVA (CERO RELLENO, CERO POESÍA):
1. REDONDEO NATURAL DEL DESCUENTO: NUNCA digas porcentajes con pico como "${cleanDiscount} por ciento". Redondéalo siempre diciendo exactamente: "${spokenDiscount}" (ej: "¡Más del ${roundedDecade} por ciento de descuento en Mercado Libre!").
2. MENCIONA QUE LA COMPRA ES EN MERCADO LIBRE: Da confianza inmediata dejando claro en la voz y subtítulos que la oferta y compra segura es en Mercado Libre.
3. DIRECTO AL PRECIO Y DESCUENTO DESDE EL SEGUNDO CERO: Entra gritando "${spokenDiscount} en Mercado Libre", el precio de oferta ($${cleanPrice} pesos) y QUÉ ES el producto.
4. QUÉ ES Y QUÉ HACE: Di con datos concretos qué es el producto, qué potencia/capacidad/material tiene y qué hace en la vida real.
5. RITMO RÁPIDO Y CONTUNDENTE: Cada 'voice_text' debe tener entre 11 y 15 palabras máximo para que sea dinámico y golpeador.
6. Los 3 'key_points' deben ser frases cortas en MAYÚSCULAS (máximo 4 palabras) que digan exactamente QUÉ ES Y QUÉ HACE (ej: "CARGA ULTRA RÁPIDA 66W", "HASTA 10 CARGAS CELULAR", "45,000MAH CAPACIDAD REAL").

Estructura OBLIGATORIA de las 4 escenas:
1. "title" (SEGUNDO 0: GOLPE DIRECTO DE DESCUENTO REDONDEADO + PRECIO + MERCADO LIBRE):
   - 'text1': "${badgeDiscount}",
   - 'text2': "$${cleanPrice} MXN",
   - 'voice_text': Entra directo con "${spokenDiscount}" en Mercado Libre, producto y precio (ej: "¡Más del ${roundedDecade} por ciento de descuento en Mercado Libre! Llévate esta ${cleanTitle.substring(0, 32)} por solo ${cleanPrice} pesos.").
   - 'subtitle': "🚨 ¡${visualDiscount} en Mercado Libre! Solo $${cleanPrice} MXN"
2. "product" (QUÉ ES Y QUÉ HACE EXACTAMENTE):
   - 'product_title': "${cleanTitle}",
   - 'key_points': 3 puntos ultra concretos y agresivos de qué es y qué hace (sin relleno).
   - 'voice_text': Explica directo qué es y qué hace con especificaciones reales (ej: "¿Qué es y qué hace? Es una batería portátil de 45 mil miliamperios y 66 watts que carga tu celular hasta 10 veces.").
   - 'subtitle': "⚡ Qué es y qué hace: potencia real, máxima capacidad y listo para usar."
3. "price" (GOLPE AL AHORRO EN MERCADO LIBRE):
   - 'discount_percentage': ${cleanDiscount},
   - 'original_price': "${cleanOriginalPrice || ''}",
   - 'offer_price': "${cleanPrice}",
   - 'voice_text': Remata el precio anterior vs hoy y cuánto se ahorra en Mercado Libre (ej: "Estaba en ${cleanOriginalPrice || cleanPrice} y hoy baja a ${cleanPrice} pesos en Mercado Libre. ¡Te ahorras ${savingsAmount || cleanDiscount} pesos de golpe!").
   - 'subtitle': "${savingsAmount ? `💥 De $${cleanOriginalPrice} a $${cleanPrice} MXN en Mercado Libre (¡Ahorras $${savingsAmount}!)` : `💥 ¡Solo $${cleanPrice} MXN hoy en Mercado Libre! (${badgeDiscount})`}"
4. "cta" (CIERRE AGRESIVO DE COMPRA EN MERCADO LIBRE):
   - 'headline': "¡PARA ESO TRABAJO!",
   - 'voice_text': Orden directa de comprar en Mercado Libre desde el link cerrando con el lema (ej: "Compra seguro en Mercado Libre tocando el link de la descripción o bio. ¡Para eso trabajo!").
   - 'subtitle': "👇 Compra en Mercado Libre desde el link en descripción o bio. ¡Para eso trabajo!"

Incluye también "sales_pitch": 2 oraciones directas y agresivas explicando qué es el producto, qué hace exactamente y por qué con ${spokenDiscount} a $${cleanPrice} MXN en Mercado Libre es una ganga brutal.

Responde ÚNICAMENTE con JSON válido:
{
  "theme_color": "#FFE600",
  "product_title": "${cleanTitle}",
  "discount_percentage": ${cleanDiscount},
  "original_price": "${cleanOriginalPrice || ''}",
  "offer_price": "${cleanPrice}",
  "sales_pitch": "Explicación directa de qué es y qué hace...",
  "key_points": ["PUNTO CONCRETO 1", "PUNTO CONCRETO 2", "PUNTO CONCRETO 3"],
  "scenes": [
    { "type": "title", "text1": "${badgeDiscount}", "text2": "$${cleanPrice} MXN", "voice_text": "...", "subtitle": "..." },
    { "type": "product", "product_title": "${cleanTitle}", "key_points": ["PUNTO CONCRETO 1", "PUNTO CONCRETO 2", "PUNTO CONCRETO 3"], "voice_text": "...", "subtitle": "..." },
    { "type": "price", "discount_percentage": ${cleanDiscount}, "original_price": "${cleanOriginalPrice || ''}", "offer_price": "${cleanPrice}", "voice_text": "...", "subtitle": "..." },
    { "type": "cta", "headline": "¡PARA ESO TRABAJO!", "voice_text": "... ¡Para eso trabajo!", "subtitle": "👇 Compra en Mercado Libre desde el link en descripción o bio. ¡Para eso trabajo!" }
  ]
}`;

  if (process.env.GROQ_API_KEY) {
    console.log("🧠 Intentando generar con Groq...");
    const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    for (const modelName of models) {
      let attempts = 0;
      while (attempts < 2) {
        try {
          const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: modelName,
              response_format: { type: "json_object" },
              messages: [{ role: "user", content: prompt }],
              temperature: 0.6
            })
          });
          const resData = await response.json();
          if (response.ok) {
            const parsed = normalizeDealScript(JSON.parse(resData.choices[0].message.content.trim()));
            console.log(`✅ Guion generado con Groq (${modelName})`);
            return parsed;
          } else {
            throw new Error(resData.error?.message || "Error de Groq");
          }
        } catch (e) {
          attempts++;
          console.log(`⚠️ Intento ${attempts} con Groq (${modelName}) fallido: ${e.message}`);
          if (e.message.includes("does not exist") || e.message.includes("do not have access")) break;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }

  if (genAI) {
    console.log("🧠 Usando Gemini para generar guion y metadatos...");
    const geminiModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
    for (const modelName of geminiModels) {
      let attempts = 0;
      const maxRetries = 2;
      while (attempts < maxRetries) {
        try {
          console.log(`   Probando Gemini (${modelName}) - intento ${attempts + 1}/${maxRetries}...`);
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
          });
          const result = await model.generateContent(prompt);
          const parsed = normalizeDealScript(JSON.parse(result.response.text()));
          console.log(`✅ Guion y metadatos generados exitosamente con Gemini (${modelName})`);
          return parsed;
        } catch (e) {
          attempts++;
          console.warn(`⚠️ Intento ${attempts} con ${modelName} fallido: ${e.message}`);
          if (e.message.includes("404") || e.message.includes("not found")) break;
          if (e.message.includes("429") || e.message.includes("Quota exceeded")) {
            console.log(`⏩ Cuota excedida para ${modelName}, probando siguiente modelo...`);
            break;
          }
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }
  }

  console.warn("⚠️ Los modelos de IA fallaron. Activando guion agresivo de contingencia.");
  return normalizeDealScript({
    theme_color: "#FFE600",
    product_title: cleanTitle,
    discount_percentage: cleanDiscount,
    original_price: cleanOriginalPrice || '',
    offer_price: cleanPrice,
    sales_pitch: `${cleanTitle} con ${spokenDiscount} directo en Mercado Libre. Potencia, durabilidad y envío rápido FULL a precio de remate.`,
    key_points: ["ALTO RENDIMIENTO REAL", "CALIDAD USO RUDO", "ENVÍO FULL MERCADO LIBRE"],
    scenes: [
      {
        type: "title",
        text1: badgeDiscount,
        text2: `$${cleanPrice} MXN`,
        voice_text: `¡${spokenDiscount.charAt(0).toUpperCase() + spokenDiscount.slice(1)} en Mercado Libre! De ${cleanOriginalPrice || cleanPrice} a solo ${cleanPrice} pesos este ${cleanTitle.substring(0, 30)}.`,
        subtitle: `🚨 ¡${visualDiscount} en Mercado Libre! Solo $${cleanPrice} MXN`
      },
      {
        type: "product",
        product_title: cleanTitle,
        key_points: ["ALTO RENDIMIENTO REAL", "CALIDAD USO RUDO", "ENVÍO FULL MERCADO LIBRE"],
        voice_text: "¿Qué es y qué hace? Está diseñado para darte máxima potencia, resistencia y resolver tu día desde el primer uso.",
        subtitle: "⚡ Máxima potencia, uso práctico y envío inmediato en Mercado Libre."
      },
      {
        type: "price",
        discount_percentage: cleanDiscount,
        original_price: cleanOriginalPrice || '',
        offer_price: cleanPrice,
        voice_text: `${savingsAmount ? `Te ahorras ${savingsAmount} pesos hoy mismo en Mercado Libre.` : `Tiene ${spokenDiscount} en Mercado Libre.`} A solo ${cleanPrice} pesos se agota volando.`,
        subtitle: savingsAmount ? `💥 ¡Te ahorras $${savingsAmount} pesos en Mercado Libre! Solo $${cleanPrice} MXN` : `💥 ¡Solo $${cleanPrice} MXN hoy en Mercado Libre! (${badgeDiscount})`
      },
      {
        type: "cta",
        headline: "¡PARA ESO TRABAJO!",
        voice_text: "Compra seguro en Mercado Libre tocando el link en la descripción o bio. ¡Para eso trabajo!",
        subtitle: "👇 Compra en Mercado Libre desde el link en descripción o bio. ¡Para eso trabajo!"
      }
    ]
  });
}

// ─────────────────────────────────────────
// 4. GENERAR VOZ EN OFF SINCRONIZADA POR ESCENAS (ElevenLabs v4 Femenina con energía comercial)
// ─────────────────────────────────────────
function sanitizeTtsText(text) {
  return text
    .replace(/\.{3,}/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/[;:]/g, '.')
    .replace(/,{2,}/g, ',')
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ.,¡!¿?]/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesizeSnippet(text, outputPath) {
  const clean = sanitizeTtsText(text);

  if (ELEVENLABS_API_KEY) {
    const modelsToTry = [ELEVENLABS_MODEL_ID, 'eleven_v4_turbo', 'eleven_multilingual_v2'];
    for (const modelId of modelsToTry) {
      try {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': ELEVENLABS_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text: clean,
              model_id: modelId,
              voice_settings: {
                stability: 0.42,
                similarity_boost: 0.88,
                style: 0.45,
                speed: 1.12,
                use_speaker_boost: true,
              },
            }),
          }
        );

        if (response.ok) {
          const audioBuffer = await response.arrayBuffer();
          fs.writeFileSync(outputPath, Buffer.from(audioBuffer));
          console.log(`    🎙️ [ElevenLabs ${modelId}] Voz femenina sintetizada OK (${ELEVENLABS_VOICE_ID})`);
          return;
        } else {
          const errText = await response.text();
          console.warn(`    ⚠️ ElevenLabs (${modelId}) HTTP ${response.status}: ${errText.substring(0, 140)}`);
        }
      } catch (e) {
        console.warn(`    ⚠️ ElevenLabs (${modelId}) error: ${e.message}`);
      }
    }
  }

  // Fallback: edge-tts (es-MX-DaliaNeural)
  const safeScript = clean.replace(/"/g, "'").replace(/\n/g, ' ');
  const rawAudioPath = outputPath.replace(/\.mp3$/, '_raw.mp3');
  execSync(
    `edge-tts --voice es-MX-DaliaNeural --rate="+10%" --text "${safeScript}" --write-media "${rawAudioPath}"`,
    { timeout: 45000 }
  );
  const filterChain = "highpass=f=80,equalizer=f=140:width_type=h:width=60:g=3.5,equalizer=f=3600:width_type=h:width=1200:g=4.0,acompressor=threshold=-16dB:ratio=4:attack=10:release=120:makeup=2.5dB,loudnorm=I=-14:TP=-1.0:LRA=7";
  execSync(`ffmpeg -y -i "${rawAudioPath}" -af "${filterChain}" -c:a libmp3lame -b:a 192k "${outputPath}"`, { stdio: 'pipe' });
  try { if (fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath); } catch (e) {}
}

async function generateVoice(scenes) {
  console.log(`\n🎙️ Generando voz sincronizada escena por escena...`);
  const tempDir = path.join(__dirname, 'temp_audio');
  fs.mkdirSync(tempDir, { recursive: true });

  const timelineScenes = [];
  const sceneFiles = [];
  let currentTime = 0;

  for (let idx = 0; idx < scenes.length; idx++) {
    const sc = scenes[idx];
    const textToSpeak = sc.voice_text || sc.text || `${sc.text1 || ''} ${sc.text2 || ''}`;
    const snipPath = path.join(tempDir, `pet_scene_${idx + 1}.mp3`);
    await synthesizeSnippet(textToSpeak, snipPath);
    const dur = await getAudioDurationInSeconds(snipPath);
    sceneFiles.push(snipPath);

    const timing = {
      ...sc,
      start: Number(currentTime.toFixed(3)),
      audio_duration: Number(dur.toFixed(3)),
      end: Number((currentTime + dur).toFixed(3))
    };
    timelineScenes.push(timing);
    console.log(`  ✓ Escena ${idx + 1}: [${timing.start}s -> ${timing.end}s] (${dur.toFixed(2)}s) - "${sc.subtitle || textToSpeak.substring(0, 40)}"`);
    currentTime += dur;
  }

  const targetDur = Math.ceil(currentTime + 0.8);
  const totalFrames = targetDur * FPS;

  // Concatenar snippets en voice.mp3
  const listFile = path.join(tempDir, 'concat_list.txt');
  fs.writeFileSync(listFile, sceneFiles.map(f => `file '${path.resolve(f).replace(/\\/g, '/')}'`).join('\n'));
  const finalAudioPath = path.join(__dirname, 'public', 'voice.mp3');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c:a libmp3lame -b:a 192k "${finalAudioPath}"`, { stdio: 'pipe' });

  return { audioPath: finalAudioPath, durationSeconds: targetDur, totalFrames, timelineScenes };
}

// ─────────────────────────────────────────
// FLUJO PRINCIPAL ORQUESTADOR
// ─────────────────────────────────────────
async function main() {
  try {
    console.log("=========================================");
    console.log("🎬 INICIANDO GENERADOR DE VIDEO PET 🎬");
    console.log("=========================================");

    // 1. Obtener link y hacer scraping
    const { link: productLink, queueItem } = await getRecentProductData();
    console.log(`🔗 Oferta destino: ${productLink}`);

    const scrapeResult = await scrapeProduct(productLink);
    if (!scrapeResult.success) {
      console.warn(`⚠️ Scraping falló o fue incompleto: ${scrapeResult.error}. Se continuará con los datos de queue.json.`);
    }

    // Limpiar el título de "(repetición)" y otras marcas innecesarias
    const rawTitle = scrapeResult.title || queueItem.producto || 'Increíble Producto';
    const cleanTitle = rawTitle
      .replace(/\(repetición\)/gi, '')
      .replace(/ - [^-]+$/g, '')
      .trim();

    console.log(`✅ Producto final para el video: "${cleanTitle}"`);

    // 2. Descargar imágenes para galería visual de alto protagonismo
    const destImagePath1 = path.join(__dirname, 'public', 'product.png');
    const destImagePath2 = path.join(__dirname, 'public', 'product_2.png');
    
    const rawCandidates = (scrapeResult.images && scrapeResult.images.length > 0)
        ? scrapeResult.images
        : (scrapeResult.imageUrl ? [scrapeResult.imageUrl] : []);

    // Filtrar banners, logotipos y asegurar que sean imágenes del producto
    const candidateImages = rawCandidates.filter(u => {
      if (!u || typeof u !== 'string') return false;
      const lower = u.toLowerCase();
      if (lower.includes('banner') || lower.includes('logo') || lower.includes('pixel') || lower.includes('plus')) return false;
      return true;
    });

    let image1Downloaded = false;
    let image2Downloaded = false;

    if (candidateImages[0]) {
      try {
        await downloadImage(candidateImages[0], destImagePath1);
        image1Downloaded = true;
      } catch (e) {
        console.warn(`⚠️ Error descargando imagen 1 del scraping: ${e.message}`);
      }
    }

    if (candidateImages[1]) {
      try {
        await downloadImage(candidateImages[1], destImagePath2);
        image2Downloaded = true;
        console.log(`✅ Segunda imagen del producto descargada exitosamente.`);
      } catch (e) {
        console.warn(`⚠️ Error descargando imagen 2 del scraping: ${e.message}`);
      }
    }

    // Si solo hay 1 imagen o falló la segunda, creamos una segunda toma macro/detalle cinematográfica con ffmpeg
    if (image1Downloaded && !image2Downloaded) {
      try {
        console.log(`📸 Generando segunda toma macro/detalle cinematográfica con ffmpeg...`);
        execSync(`ffmpeg -y -i "${destImagePath1}" -filter:v "crop=in_w*0.8:in_h*0.8:(in_w-in_w*0.8)/2:(in_h-in_h*0.8)/3,scale=800:800" "${destImagePath2}"`, { stdio: 'pipe' });
        image2Downloaded = true;
        console.log(`✅ Segunda toma macro/detalle generada exitosamente.`);
      } catch (e) {
        console.warn(`⚠️ No se pudo generar crop con ffmpeg, usando fallback: ${e.message}`);
        fs.copyFileSync(destImagePath1, destImagePath2);
        image2Downloaded = true;
      }
    }

    if (!image1Downloaded && !fs.existsSync(destImagePath1)) {
      console.log("    ⚠️ El archivo product.png no existe. Escribiendo pixel de fallback...");
      const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      fs.mkdirSync(path.dirname(destImagePath1), { recursive: true });
      fs.writeFileSync(destImagePath1, emptyPng);
      if (!fs.existsSync(destImagePath2)) fs.writeFileSync(destImagePath2, emptyPng);
    }

    // 3. Preparar precios y porcentajes exactos
    const rawPrice = scrapeResult.price || queueItem.precio || '299.00';
    const cleanPrice = rawPrice.replace(/[$,]/g, '').trim();

    let rawOriginalPrice = scrapeResult.originalPrice;
    let cleanOriginalPrice = rawOriginalPrice ? rawOriginalPrice.replace(/[$,]/g, '').trim() : null;

    const rawDiscount = scrapeResult.discount || queueItem.descuento || '40';
    let cleanDiscount = parseInt(rawDiscount.replace(/[^0-9]/g, '')) || 40;

    if (!cleanOriginalPrice && cleanPrice && cleanDiscount) {
      const numPrice = parseFloat(cleanPrice);
      if (!isNaN(numPrice) && cleanDiscount > 0 && cleanDiscount < 100) {
        cleanOriginalPrice = String(Math.round(numPrice / (1 - cleanDiscount / 100)));
      }
    }

    const combinedData = {
      title: cleanTitle,
      price: cleanPrice,
      originalPrice: cleanOriginalPrice,
      discount: cleanDiscount,
      description: scrapeResult.description || '',
      userNotes: `${queueItem.producto || ''}\n${queueItem.copy || ''}`.trim()
    };

    console.log(`   Precio Oferta: $${combinedData.price} | Precio Original: $${combinedData.originalPrice || 'N/A'} | Descuento: ${combinedData.discount}%`);

    // Generar guion y escenas sincronizadas con IA
    const metadata = await generateDealMetadata(combinedData);
    metadata.product_title = cleanTitle;
    metadata.offer_price = cleanPrice;
    metadata.original_price = cleanOriginalPrice;
    metadata.discount_percentage = cleanDiscount;

    // Asegurar coherencia en la escena de precio (la que tenga type === 'price')
    if (metadata.scenes) {
      const priceScene = metadata.scenes.find(s => s.type === 'price') || metadata.scenes[2];
      if (priceScene) {
        priceScene.offer_price = cleanPrice;
        priceScene.original_price = cleanOriginalPrice || '';
        priceScene.discount_percentage = cleanDiscount;
        const roundedDec = cleanDiscount >= 15 ? Math.floor(cleanDiscount / 10) * 10 : cleanDiscount;
        const isPlus = cleanDiscount >= 15 && (cleanDiscount % 10 !== 0);
        const subDiscText = isPlus ? `¡Más del ${roundedDec}% de descuento!` : `¡${cleanDiscount}% de descuento!`;
        if (cleanOriginalPrice) {
          priceScene.subtitle = `💥 De $${cleanOriginalPrice} a solo $${cleanPrice} MXN en Mercado Libre (${subDiscText})`;
        }
      }
    }

    // 4. Generar voz sincronizada por escenas
    const voiceInfo = await generateVoice(metadata.scenes);
    metadata.scenes = voiceInfo.timelineScenes;
    const targetDur = voiceInfo.durationSeconds;
    metadata.total_duration_sec = targetDur;
    metadata.total_frames = voiceInfo.totalFrames;
    metadata.affiliate_link = productLink;
    metadata.issue_number = queueItem.issue_number || null;

    // Procesar música temática con Sidechain Ducking automático
    const musicSrc = path.join(__dirname, 'public', 'music_electrodoodle.mp3');
    const duckedMusic = path.join(__dirname, 'public', 'bg_music.mp3');
    if (fs.existsSync(musicSrc)) {
      try {
        console.log('🎵 Aplicando Sidechain Audio Ducking a la música comercial...');
        const duckingFilter = `[1:a]aformat=channel_layouts=stereo:sample_rates=48000[sc];[0:a]atrim=0:${targetDur},aformat=channel_layouts=stereo:sample_rates=48000[music];[music][sc]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=350,volume=0.40[final_music]`;
        execSync(`ffmpeg -y -i "${musicSrc}" -i "${voiceInfo.audioPath}" -filter_complex "${duckingFilter}" -map "[final_music]" -c:a libmp3lame -b:a 192k "${duckedMusic}"`, { stdio: 'pipe' });
        console.log('✅ Música con Sidechain Ducking generada exitosamente.');
      } catch (duckErr) {
        console.warn('⚠️ Error en sidechain ducking, manteniendo música previa:', duckErr.message);
      }
    }

    // Guardar deal_data.json listo para Remotion y deal_data.js para HyperFrames
    const dealDataPath = path.join(__dirname, 'src', 'deal_data.json');
    fs.mkdirSync(path.dirname(dealDataPath), { recursive: true });
    fs.writeFileSync(dealDataPath, JSON.stringify(metadata, null, 2));

    const dealDataJsPath = path.join(__dirname, 'deal_data.js');
    fs.writeFileSync(dealDataJsPath, `window.DEAL_DATA = ${JSON.stringify(metadata, null, 2)};\n`);

    // Sincronizar duración exacta en index.html y hyperframes.json
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
      try {
        let indexHtml = fs.readFileSync(indexPath, 'utf-8');
        indexHtml = indexHtml.replace(/data-duration="[\d.]+"/g, `data-duration="${targetDur}"`);
        fs.writeFileSync(indexPath, indexHtml);
        console.log(`✅ index.html sincronizado con data-duration="${targetDur}"`);
      } catch (e) {
        console.warn(`⚠️ Error actualizando index.html:`, e.message);
      }
    }

    const hfConfigPath = path.join(__dirname, 'hyperframes.json');
    if (fs.existsSync(hfConfigPath)) {
      try {
        const hfConfig = JSON.parse(fs.readFileSync(hfConfigPath, 'utf-8'));
        hfConfig.compositions[0].duration = targetDur;
        fs.writeFileSync(hfConfigPath, JSON.stringify(hfConfig, null, 2));
        console.log(`✅ hyperframes.json actualizado con duración: ${targetDur}s`);
      } catch (e) {
        console.warn(`⚠️ Error actualizando hyperframes.json:`, e.message);
      }
    }

    require('./build_template').build(__dirname);

    console.log(`\n🎉 METADATOS GENERADOS Y GUARDADOS EN ${dealDataPath} y ${dealDataJsPath}`);
    console.log("=========================================");
  } catch (error) {
    console.error("❌ Error en el proceso de creación:", error);
    process.exit(1);
  }
}

main();
