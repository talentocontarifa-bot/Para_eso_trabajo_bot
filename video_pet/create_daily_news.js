const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getAudioDurationInSeconds } = require('get-audio-duration');
const { scrapeProduct } = require('../scraper');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_VOICE_ID = 'pVSoAhDpVO8HBRVURsj5'; // Voz profesional
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

  // B. Intentar leer queue.json
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

  // 1. Si hay un item programado específicamente para HOY, lo usamos directamente sin deduplicar
  const todayItem = queueItems.find(item => item.scheduled_date && item.scheduled_date.startsWith(todayStr));
  if (todayItem && todayItem.link) {
    console.log(`🎯 Encontrada oferta programada específicamente para hoy en queue.json (ID: ${todayItem.id}): ${todayItem.producto}`);
    return { link: todayItem.link, queueItem: todayItem };
  }

  // 2. Si no hay item para hoy, recopilamos candidatos para elegir dinámicamente un candidato fresco (que no tenga video reciente)
  console.log("🔄 Buscando candidatos frescos de queue.json y closed issues...");
  const candidatesMap = new Map();

  // Candidatos de queue.json
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
async function generateDealMetadata(scrapeResult) {
  console.log("🤖 Consultando IA para generar guion y metadatos...");

  const productInfo = `
  TÍTULO DEL PRODUCTO: ${scrapeResult.title}
  PRECIO ACTUAL: ${scrapeResult.price || 'No especificado'}
  PRECIO ORIGINAL: ${scrapeResult.originalPrice || 'No especificado'}
  DESCUENTO: ${scrapeResult.discount || 'No especificado'}
  DESCRIPCIÓN: ${scrapeResult.description ? scrapeResult.description.substring(0, 500) : 'Sin descripción.'}
  NOTAS Y CONTEXTO ADICIONAL:
  """
  ${scrapeResult.userNotes || 'Ninguno.'}
  """
  `;

  const prompt = `Actúa como un experto creador de contenido de ofertas de "Para eso trabajo".
Tu misión: convertir la información de esta oferta de producto en un video promocional de alto impacto (vertical 9:16) para TikTok/Facebook Reels.

Aquí está la información real del producto:
${productInfo}

Estructura el video en 4 escenas:
1. "title": Gancho de inicio. Requiere 'text1' (gancho como "OFERTAZO", "LIQUIDACIÓN", "SUPER PRECIO") y 'text2' (el nombre corto o categoría del producto en 1 o 2 palabras, ej: "POWER BANK" o "AUDÍFONOS"). Máximo 12 caracteres por texto.
2. "image_text": Muestra la imagen del producto con un titular en pantalla. Requiere 'text' (titular persuasivo de 2-4 palabras, ej: "BATERÍA INFINITA").
3. "big_percentage": Muestra el porcentaje de descuento en tamaño gigante. Requiere 'number' (solo el número del descuento, ej: 70 si es 70% OFF. Si no hay descuento, calcula uno estimado comparando el precio original y el actual, o inventa un porcentaje congruente, ej. 50) y 'text' (ej: "DE DESCUENTO" o "AHORRO TOTAL").
4. "cta": Pantalla de cierre. Requiere 'text' (ej: "¡LINK EN BIO!" o "¡COMPRA HOY!").

Reglas de Redacción del Guion ("script"):
- Escribe el guion hablado completo que leerá la voz en off, con un tono enérgico, divertido y sumamente persuasivo.
- El guion DEBE tener una extensión de exactamente entre 75 y 90 palabras para garantizar una duración de 18 a 22 segundos de video.
- IMPORTANTE: Utiliza las "NOTAS Y CONTEXTO ADICIONAL" como guía, orientación y tono para estructurar el mensaje, pero NO uses el texto de las notas directamente como el título del producto si este ya tiene un nombre descriptivo real.
- IMPORTANTE: No uses frases de una sola línea. Debes narrar detalladamente los beneficios y características del producto (por ejemplo, hablar de sus componentes, para qué sirve, el gran ahorro, y por qué vale la pena comprarlo hoy mismo).
- Debe mencionar explícitamente el nombre del producto, el precio actual, el descuento, y hacer un llamado a la acción claro indicando que el link de compra oficial está en la biografía o descripción.
- Debe terminar obligatoriamente con la frase ganadora: "¡Para eso trabajo!".

Reglas Generales:
- "theme_color": elige un color neón vibrante que combine con el producto o sea muy llamativo (ej: #00FF66, #FF007F, #00FFFF, #FFFF00).
- "key_points": Genera un array de EXACTAMENTE 3 características o beneficios cortos del producto (max 5 palabras cada uno, ej. ["Carga ultra rápida", "Gran capacidad", "Compatible con todo"]).

Responde ÚNICAMENTE con JSON válido:
{
  "theme_color": "#00FF66",
  "product_title": "Magnesio Complex",
  "discount_percentage": 28,
  "original_price": "499.00",
  "offer_price": "359.00",
  "key_points": ["4 tipos de magnesio", "Sueño profundo", "Reduce el estrés"],
  "script": "¡Atención! Si sufres de estrés, calambres o duermes mal, esto es para ti. Acaba de bajar de precio el Magnesio Complex de Beyond Vitamins. Contiene cuatro tipos de magnesio de alta absorción en un frasco con ciento ochenta cápsulas. Llévatelo hoy mismo por solo trescientos cincuenta y nueve pesos, con un veintiocho por ciento de descuento sobre su precio original de cuatrocientos noventa y nueve pesos. Haz clic en el enlace de nuestra biografía para conseguir el tuyo antes de que se agote. ¡Para eso trabajo!",
  "scenes": [
    { "type": "title", "text1": "OFERTAZO", "text2": "MAGNESIO" },
    { "type": "image_text", "text": "SUEÑO PROFUNDO Y SIN ESTRÉS" },
    { "type": "big_percentage", "number": 28, "text": "DE DESCUENTO" },
    { "type": "cta", "text": "¡LINK EN BIO!" }
  ]
}`;

  if (process.env.GROQ_API_KEY) {
    console.log("🧠 Intentando generar con Groq (Llama 3.3 70B)...");
    const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    for (const modelName of models) {
      let attempts = 0;
      while (attempts < 3) {
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
              temperature: 0.7
            })
          });
          const data = await response.json();
          if (response.ok) {
            const parsed = JSON.parse(data.choices[0].message.content.trim());
            console.log(`✅ Guion generado con Groq (${modelName})`);
            return parsed;
          } else {
            throw new Error(data.error?.message || "Error de Groq");
          }
        } catch (e) {
          attempts++;
          console.log(`⚠️ Intento ${attempts} con Groq (${modelName}) fallido: ${e.message}`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    console.log("❌ Groq falló. Usando Gemini como fallback...");
  }

  if (!genAI) {
    throw new Error("No hay API keys de Groq ni Gemini disponibles.");
  }

  console.log("🧠 Usando Gemini para generar guion...");
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const result = await model.generateContent(prompt);
  const parsed = JSON.parse(result.response.text());
  console.log("✅ Guion generado con Gemini");
  return parsed;
}

// ─────────────────────────────────────────
// 4. GENERAR VOZ EN OFF (ElevenLabs → edge-tts fallback)
// ─────────────────────────────────────────
function sanitizeTtsText(text) {
  return text
    // Reemplazar elipsis con un punto simple para evitar tropezones en ElevenLabs
    .replace(/\.{3,}/g, '.')
    .replace(/\.{2,}/g, '.')
    // Reemplazar dos puntos y punto y coma con puntos para pausas más naturales
    .replace(/[;:]/g, '.')
    // Quitar comas repetidas
    .replace(/,{2,}/g, ',')
    // Eliminar caracteres especiales/emojis, dejando letras, números, espacios y puntuación básica
    .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ.,¡!¿?]/g, ' ')
    // Limpiar espacios alrededor de puntuación
    .replace(/\s+([.,;:!?])/g, '$1')
    // Garantizar un único espacio después de cada signo de puntuación
    .replace(/([.,;:!?])\s*/g, '$1 ')
    // Eliminar espacios múltiples
    .replace(/\s+/g, ' ')
    .trim();
}

async function generateVoice(script) {
  console.log(`\n🎙️ Generando voz en off...`);
  const fullScript = sanitizeTtsText(script);
  console.log(`   Guion optimizado: "${fullScript}"`);

  const audioPath = path.join(__dirname, 'public', 'voice.mp3');
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });

  // ── Intento 1: ElevenLabs (calidad premium) ───────────────────────────────
  if (ELEVENLABS_API_KEY) {
    try {
      console.log(`   🎤 Usando ElevenLabs (voz: ${ELEVENLABS_VOICE_ID})...`);
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: fullScript,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.65,
              similarity_boost: 0.85,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        fs.writeFileSync(audioPath, Buffer.from(audioBuffer));
        const durationSeconds = await getAudioDurationInSeconds(audioPath);
        const totalFrames = Math.ceil(durationSeconds * FPS) + 30;
        console.log(`✅ [ElevenLabs] Audio generado. Duración: ${durationSeconds.toFixed(2)}s → ${totalFrames} frames`);
        return { audioPath, durationSeconds, totalFrames };
      } else {
        const err = await response.text();
        console.warn(`⚠️  ElevenLabs respondió ${response.status}: ${err}`);
        console.warn("   Intentando con edge-tts como fallback...");
      }
    } catch (e) {
      console.warn(`⚠️  Error con ElevenLabs: ${e.message}`);
      console.warn("   Intentando con edge-tts como fallback...");
    }
  }

  // ── Fallback: edge-tts (Microsoft Edge TTS, gratis, sin API key) ──────────
  // Voz: es-MX-DaliaNeural — español mexicano, femenina, alta calidad
  try {
    console.log("   🔄 Usando edge-tts (es-MX-DaliaNeural)...");
    // Escapar comillas dobles y saltos de línea para pasarlo por CLI de forma segura
    const safeScript = script.replace(/"/g, "'").replace(/\n/g, ' ');
    execSync(
      `edge-tts --voice es-MX-DaliaNeural --text "${safeScript}" --write-media "${audioPath}"`,
      { timeout: 60000 }
    );
    const durationSeconds = await getAudioDurationInSeconds(audioPath);
    const totalFrames = Math.ceil(durationSeconds * FPS) + 30;
    console.log(`✅ [edge-tts] Audio generado. Duración: ${durationSeconds.toFixed(2)}s → ${totalFrames} frames`);
    return { audioPath, durationSeconds, totalFrames };
  } catch (e) {
    throw new Error(`❌ Todos los motores TTS fallaron. Último error (edge-tts): ${e.message}`);
  }
}

// ─────────────────────────────────────────
// 5. DISTRIBUIR FRAMES
// ─────────────────────────────────────────
function distributeFrames(scenes, totalFrames) {
  const weights = { title: 1, image_text: 2, big_percentage: 1.5, cta: 1.5 };
  const totalWeight = scenes.reduce((acc, s) => acc + (weights[s.type] || 1), 0);

  let framesLeft = totalFrames;
  return scenes.map((scene, i) => {
    const isLast = i === scenes.length - 1;
    const frames = isLast
      ? framesLeft
      : Math.round((weights[scene.type] || 1) / totalWeight * totalFrames);
    framesLeft -= frames;
    return { ...scene, durationInFrames: Math.max(frames, 60) }; // Mínimo 2s
  });
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

    // Limpiar el título de "(repetición)" y otras marcas innecesarias, prefiriendo el título real raspado
    const rawTitle = scrapeResult.title || queueItem.producto || 'Increíble Producto';
    const cleanTitle = rawTitle
      .replace(/\(repetición\)/gi, '')
      .replace(/ - [^-]+$/g, '') // Quitar nombres largos del final si los hay
      .trim();

    console.log(`✅ Producto final para el video: "${cleanTitle}"`);

    // 2. Descargar imagen
    const destImagePath = path.join(__dirname, 'public', 'product.png');
    let imageDownloaded = false;
    if (scrapeResult.imageUrl) {
      try {
        await downloadImage(scrapeResult.imageUrl, destImagePath);
        imageDownloaded = true;
      } catch (e) {
        console.warn(`⚠️ Error descargando la imagen del scraping: ${e.message}`);
      }
    } else {
      console.warn("⚠️ No se detectó imagen de producto en el scraping.");
    }

    if (!imageDownloaded) {
      if (!fs.existsSync(destImagePath)) {
        console.log("    ⚠️ El archivo product.png no existe. Escribiendo pixel de fallback...");
        const emptyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        fs.mkdirSync(path.dirname(destImagePath), { recursive: true });
        fs.writeFileSync(destImagePath, emptyPng);
        console.log("    💾 Escrito pixel de fallback en product.png.");
      } else {
        console.log("    ℹ️ El archivo product.png anterior ya existe, se conservará.");
      }
    }

    // 3. Combinar datos reales para pasárselos a la IA, incluyendo notas/título del issue como orientación
    const combinedData = {
      title: cleanTitle,
      price: scrapeResult.price || queueItem.precio,
      originalPrice: scrapeResult.originalPrice,
      discount: scrapeResult.discount || queueItem.descuento || 'OFERTA',
      description: scrapeResult.description || '',
      userNotes: `${queueItem.producto || ''}\n${queueItem.copy || ''}`.trim()
    };

    console.log(`   Precio Oferta: ${combinedData.price} | Descuento: ${combinedData.discount}`);

    // Generar guion y metadatos con IA
    const metadata = await generateDealMetadata(combinedData);

    // Sobrescribir y limpiar campos clave con valores reales finales
    metadata.product_title = cleanTitle;

    if (combinedData.price) {
      metadata.offer_price = combinedData.price.replace(/[$,]/g, '').trim();
    }
    
    if (combinedData.originalPrice) {
      metadata.original_price = combinedData.originalPrice.replace(/[$,]/g, '').trim();
    } else if (combinedData.price && combinedData.discount) {
      // Calcular precio original estimado a partir del precio de oferta y el descuento
      try {
        const cleanPrice = parseFloat(combinedData.price.replace(/[^\d.]/g, ''));
        const discountPct = parseInt(combinedData.discount.replace(/[^0-9]/g, ''));
        if (!isNaN(cleanPrice) && !isNaN(discountPct) && discountPct > 0 && discountPct < 100) {
          const calcOriginal = Math.round(cleanPrice / (1 - discountPct / 100));
          metadata.original_price = String(calcOriginal);
          console.log(`   Calculando precio original estimado: $${calcOriginal}`);
        } else {
          metadata.original_price = null;
        }
      } catch (e) {
        metadata.original_price = null;
      }
    } else {
      metadata.original_price = null;
    }

    if (combinedData.discount) {
      metadata.discount_percentage = parseInt(combinedData.discount.replace(/[^0-9]/g, '')) || metadata.discount_percentage;
    }

    // 4. Generar voz hablada
    const voiceInfo = await generateVoice(metadata.script);

    // 5. Distribuir frames e integrar duraciones
    metadata.scenes = distributeFrames(metadata.scenes, voiceInfo.totalFrames);
    metadata.affiliate_link = productLink;
    
    // Guardar deal_data.json listo para Remotion
    const dealDataPath = path.join(__dirname, 'src', 'deal_data.json');
    fs.mkdirSync(path.dirname(dealDataPath), { recursive: true });
    fs.writeFileSync(dealDataPath, JSON.stringify(metadata, null, 2));

    console.log(`\n🎉 METADATOS GENERADOS Y GUARDADOS EN ${dealDataPath}`);
    console.log("=========================================");
  } catch (error) {
    console.error("❌ Error en el proceso de creación:", error);
    process.exit(1);
  }
}

main();
