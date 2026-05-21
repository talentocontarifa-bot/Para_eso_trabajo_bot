const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getAudioDurationInSeconds } = require('get-audio-duration');
const { scrapeProduct } = require('../scraper');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ELEVENLABS_VOICE_ID = '4XUsiqPDK4UACIM2BILe'; // Voz profesional
const FPS = 30;

if ((!GEMINI_API_KEY && !GROQ_API_KEY) || !ELEVENLABS_API_KEY) {
  console.error("❌ Faltan variables de entorno: (GEMINI_API_KEY o GROQ_API_KEY) y ELEVENLABS_API_KEY");
  process.exit(1);
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// ─────────────────────────────────────────
// 1. OBTENER EL ENLACE DEL PRODUCTO DE HOY
// ─────────────────────────────────────────
function getRecentProductLink() {
  console.log("🔍 Buscando la oferta de hoy...");

  // A. Intentar obtener el link del issue cerrado más reciente
  try {
    const closedIssuesJson = execSync('gh issue list --state closed --json number,title,body --limit 5').toString();
    const closedIssues = JSON.parse(closedIssuesJson);
    const urlRegex = /(https?:\/\/[^\s]+)/;

    for (const issue of closedIssues) {
      const match = (issue.body || '').match(urlRegex) || issue.title.match(urlRegex);
      if (match) {
        const url = match[1];
        console.log(`🎯 Link encontrado en Issue cerrado #${issue.number}: ${url}`);
        return url;
      }
    }
  } catch (e) {
    console.warn("⚠️ No se pudieron obtener closed issues vía GH CLI.");
  }

  // B. Intentar leer de queue.json
  const queuePath = path.join(__dirname, '..', 'queue.json');
  if (fs.existsSync(queuePath)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
      const items = Array.isArray(queue) ? queue : [];

      if (items.length > 0) {
        // Tomar el más reciente del queue
        const lastItem = items[items.length - 1];
        if (lastItem.link) {
          console.log(`🎯 Link encontrado en queue.json: ${lastItem.link}`);
          return lastItem.link;
        }
      }
    } catch (e) {
      console.error("⚠️ Error leyendo queue.json:", e.message);
    }
  }

  // C. Fallback por defecto si no hay nada
  const defaultLink = "https://articulo.mercadolibre.com.mx/MLM-1402242137-audifonos-diadema-bluetooth-inalambricos-auriculares-hifi-_JM";
  console.log(`⚠️ No se encontró oferta activa. Usando fallback por defecto: ${defaultLink}`);
  return defaultLink;
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
- Escribe el guion hablado completo que leerá la voz en off, con un tono enérgico, divertido y que conecte con la frase final del canal "¡Para eso trabajo!".
- El guion debe durar entre 55 y 65 palabras.
- Debe mencionar explícitamente el producto, el precio actual, y animar al usuario a ir al enlace.
- Debe terminar obligatoriamente con la frase ganadora: "¡Para eso trabajo!".

Reglas Generales:
- "theme_color": elige un color neón vibrante que combine con el producto o sea muy llamativo (ej: #00FF66, #FF007F, #00FFFF, #FFFF00).
- "key_points": Genera un array de EXACTAMENTE 3 características o beneficios cortos del producto (max 5 palabras cada uno, ej. ["Carga ultra rápida", "Gran capacidad", "Compatible con todo"]).

Responde ÚNICAMENTE con JSON válido:
{
  "theme_color": "#00FF66",
  "product_title": "Nombre corto del producto",
  "discount_percentage": 70,
  "original_price": "999.00",
  "offer_price": "298.50",
  "key_points": ["Punto 1", "Punto 2", "Punto 3"],
  "script": "El texto del guion de 55-65 palabras terminado en ¡Para eso trabajo!",
  "scenes": [
    { "type": "title", "text1": "OFERTAZO", "text2": "POWER BANK" },
    { "type": "image_text", "text": "CARGA ULTRA RÁPIDA" },
    { "type": "big_percentage", "number": 70, "text": "DE DESCUENTO" },
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
// 4. GENERAR VOZ EN OFF (ElevenLabs)
// ─────────────────────────────────────────
async function generateVoice(script) {
  console.log(`\n🎙️ Generando voz con ElevenLabs (voz: ${ELEVENLABS_VOICE_ID})...`);
  console.log(`   Guion: "${script}"`);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: script,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.82,
          style: 0.35,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs error: ${response.status} — ${err}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const audioPath = path.join(__dirname, 'public', 'voice.mp3');
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(audioPath, Buffer.from(audioBuffer));

  const durationSeconds = await getAudioDurationInSeconds(audioPath);
  const totalFrames = Math.ceil(durationSeconds * FPS) + 30; // +1s de amortiguación
  console.log(`✅ Audio guardado. Duración: ${durationSeconds.toFixed(2)}s → ${totalFrames} frames`);
  return { audioPath, durationSeconds, totalFrames };
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
    const productLink = getRecentProductLink();
    console.log(`🔗 Oferta destino: ${productLink}`);

    const scrapeResult = await scrapeProduct(productLink);
    if (!scrapeResult.success) {
      throw new Error(`Error en scraping del producto: ${scrapeResult.error}`);
    }
    console.log(`✅ Scraping exitoso: "${scrapeResult.title}"`);
    console.log(`   Precio: ${scrapeResult.price} | Descuento: ${scrapeResult.discount}`);

    // 2. Descargar imagen
    if (scrapeResult.imageUrl) {
      const destImagePath = path.join(__dirname, 'public', 'product.png');
      await downloadImage(scrapeResult.imageUrl, destImagePath);
    } else {
      console.warn("⚠️ No se detectó imagen de producto. Se usará un marcador de posición.");
    }

    // 3. Generar guion y metadatos con IA
    const metadata = await generateDealMetadata(scrapeResult);

    // Sobrescribir precios y descuento reales si el scraping los obtuvo
    if (scrapeResult.price) {
      metadata.offer_price = scrapeResult.price.replace(/[$,]/g, '').trim();
    }
    if (scrapeResult.originalPrice) {
      metadata.original_price = scrapeResult.originalPrice.replace(/[$,]/g, '').trim();
    } else {
      metadata.original_price = null;
    }
    if (scrapeResult.discount) {
      metadata.discount_percentage = parseInt(scrapeResult.discount.replace(/[^0-9]/g, '')) || metadata.discount_percentage;
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
