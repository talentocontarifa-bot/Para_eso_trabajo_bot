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

  // Candidatos de open issues (lo más nuevo y prioritario)
  try {
    const openIssuesJson = execSync('gh issue list --state open --json number,title,body --limit 20').toString();
    const openIssues = JSON.parse(openIssuesJson);
    const urlRegex = /(https?:\/\/[^\s]+)/;

    for (const issue of openIssues) {
      const match = (issue.body || '').match(urlRegex) || issue.title.match(urlRegex);
      if (match) {
        const url = match[1];
        if (!candidatesMap.has(url)) {
          candidatesMap.set(url, {
            link: url,
            producto: issue.title,
            precio: null,
            descuento: null,
            copy: issue.body || '',
            priority: true
          });
        }
      }
    }
    if (openIssues.length > 0) {
      console.log(`🔥 Se encontraron ${openIssues.length} issues abiertos para priorizar.`);
    }
  } catch (e) {
    console.warn("⚠️ No se pudieron obtener candidatos de open issues vía GH CLI:", e.message);
  }

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

  const prompt = `Actúa como el mejor director creativo, copywriter y creador de contenido de "Para eso trabajo".
Tu filosofía y lema de marca es: "¡Date el gusto, para eso trabajas!"
La gente se esfuerza duro toda la semana y se merece consentirse con ofertones reales.
Tu misión: crear un video publicitario irresistible, magnético y antojador (vertical 9:16) para TikTok/Instagram Reels sobre esta oferta real:
${productInfo}

REGLAS DE ORO DE COPYWRITING (HAY QUE ANTOJARLO):
- Tono: Cómplice, entusiasta, antojador, cercano y conversacional (español latino/mexicano natural, con chispa y deseo).
- PROHIBIDAS las frases corporativas o aburridas de catálogo como "Excelente calidad", "Envío directo", "Gran oportunidad", "Atención compradores".
- Enfócate en las SENSACIONES, el placer de estrenar, el confort, el estatus y el gusto de tenerlo:
  * Si es perfume/belleza: antoja el aroma ("aroma magnético", "te van a llover cumplidos", "elegancia pura todo el día").
  * Si es audio/tecnología: antoja la experiencia ("graves profundos", "batería para todo el fin", "diseño comodísimo").
  * Si es ropa/calzado/cuidado: antoja el estilo y el confort ("comodidad nivel nube", "porte impecable", "roba miradas").
  * Si es hogar/herramientas: antoja la practicidad y descanso ("te resuelve la vida", "descanso de hotel 5 estrellas").

Debes estructurar el video en EXACTAMENTE 4 escenas sincronizadas.
Para cada escena debes proveer OBLIGATORIAMENTE:
- 'voice_text': Frase hablada que leerá la locutora en esa escena específica (10-15 palabras).
- 'subtitle': Subtítulo corto y legible para la barra inferior (máximo 10 palabras).

Las 4 escenas son:
1. "title": Apertura con gancho que antoja y despierta curiosidad.
   - 'text1': Gancho como "¡DATE EL GUSTO!", "ANTOJO TOTAL", "JOYITA TOP", "GUSTITO MERECIDO" (máx 16 letras).
   - 'text2': Nombre corto o marca deseable del producto (máx 18 letras).
   - 'voice_text': Gancho inicial que antoja y hace que la persona quiera consentirse (ej: "¿A poco no te mereces un buen gustito hoy? Checa la joya que acaba de caer en ofertón en Mercado Libre.").
   - 'subtitle': Subtítulo de apertura irresistible (ej: "¡Date el gusto que te mereces! Ofertón imperdible.").
2. "product": Beneficios sensoriales y antojadores.
   - 'product_title': "${cleanTitle}",
   - 'key_points': Exactamente 3 beneficios antojadores con emoji inicial (ej: "✨ Aroma fresco y magnético", "👑 Cumplidos garantizados", "🚀 Llega mañana con FULL").
   - 'voice_text': Frase antojando el producto, describiendo la sensación o experiencia placentera de usarlo (12-16 palabras).
   - 'subtitle': Subtítulo destacando el beneficio más antojable.
3. "price": Visual del precio y descuento como justificación perfecta del gusto.
   - 'discount_percentage': ${cleanDiscount},
   - 'original_price': "${cleanOriginalPrice || ''}",
   - 'offer_price': "${cleanPrice}",
   - 'voice_text': Frase mencionando EXACTAMENTE los precios y el descuento, justificando el capricho (ej: "Baja de ${cleanOriginalPrice || cleanPrice} a solo ${cleanPrice} pesos con un ${cleanDiscount} por ciento de descuento. ¡Por este precio es un regalo de ti para ti!").
   - 'subtitle': "De $${cleanOriginalPrice || ''} a solo $${cleanPrice} pesos. ¡${cleanDiscount}% de descuento!"
4. "cta": Cierre con llamado a la acción y el lema de marca.
   - 'headline': "¡PARA ESO TRABAJAS!",
   - 'voice_text': Frase animando a comprarlo en el link de la bio antes de que se termine, terminando OBLIGATORIAMENTE con la frase: "¡Para eso trabajo!" (12-16 palabras).
   - 'subtitle': "¡Para eso trabajo! Consiéntete en el link de la bio."

Reglas:
- "theme_color": elige un color neón vibrante (#00FF66, #FF0055, #00E5FF, #FFE600).
- Cada escena DEBE tener 'voice_text' y 'subtitle'.
- Los precios en el voice_text y en el subtitle DEBEN ser exactamente $${cleanPrice} y $${cleanOriginalPrice || cleanPrice}.

Responde ÚNICAMENTE con JSON válido:
{
  "theme_color": "#00FF66",
  "product_title": "${cleanTitle}",
  "discount_percentage": ${cleanDiscount},
  "original_price": "${cleanOriginalPrice || ''}",
  "offer_price": "${cleanPrice}",
  "key_points": ["✨ Aroma magnético y fresco", "👑 Cumplidos garantizados", "🚀 Llega mañana con FULL"],
  "scenes": [
    { "type": "title", "text1": "¡DATE EL GUSTO!", "text2": "${cleanTitle.substring(0, 16)}", "voice_text": "¿A poco no te mereces un buen gustito hoy? Mira la joya que acaba de caer en oferta en Mercado Libre.", "subtitle": "¡Date el gusto que te mereces! Ofertón imperdible." },
    { "type": "product", "product_title": "${cleanTitle}", "key_points": ["✨ Aroma magnético y fresco", "👑 Cumplidos garantizados", "🚀 Llega mañana con FULL"], "voice_text": "Huele a pura elegancia y sofisticación todo el día, de esos aromas que dejan huella donde camines.", "subtitle": "Aroma magnético, elegancia pura y presencia todo el día." },
    { "type": "price", "discount_percentage": ${cleanDiscount}, "original_price": "${cleanOriginalPrice || ''}", "offer_price": "${cleanPrice}", "voice_text": "Baja de ${cleanOriginalPrice || cleanPrice} a solo ${cleanPrice} pesos con un ${cleanDiscount} por ciento de descuento. ¡Un regalazo de ti para ti!", "subtitle": "De $${cleanOriginalPrice || ''} a solo $${cleanPrice} pesos. ¡${cleanDiscount}% de descuento!" },
    { "type": "cta", "headline": "¡PARA ESO TRABAJAS!", "voice_text": "No te quedes con las ganas y corre al enlace de nuestra biografía antes de que vuele. ¡Para eso trabajo!", "subtitle": "¡Para eso trabajo! Toca el enlace en nuestra bio." }
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
              temperature: 0.7
            })
          });
          const resData = await response.json();
          if (response.ok) {
            const parsed = JSON.parse(resData.choices[0].message.content.trim());
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
    const geminiModels = ["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-2.5-flash"];
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
          const parsed = JSON.parse(result.response.text());
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

  console.warn("⚠️ Los modelos de IA fallaron. Activando guion de contingencia antojador basado en datos reales del producto.");
  return {
    theme_color: "#00FF66",
    product_title: cleanTitle,
    discount_percentage: cleanDiscount,
    original_price: cleanOriginalPrice || '',
    offer_price: cleanPrice,
    key_points: ["✨ Estilo y presencia de lujo", "👑 Calidad premium garantizada", "🚀 Llega volando con FULL"],
    scenes: [
      {
        type: "title",
        text1: "¡DATE EL GUSTO!",
        text2: cleanTitle.substring(0, 16).toUpperCase(),
        voice_text: `¿A poco no te mereces un buen gustito hoy? Checa esta joyita que acaba de caer en ofertón en Mercado Libre.`,
        subtitle: `¡Date el gusto que te mereces! Ofertón en Mercado Libre.`
      },
      {
        type: "product",
        product_title: cleanTitle,
        key_points: ["✨ Estilo y presencia de lujo", "👑 Calidad premium garantizada", "🚀 Llega volando con FULL"],
        voice_text: "Diseño impecable y una experiencia increíble para que te consientas y disfrutes cada día.",
        subtitle: "Lujo accesible, elegancia y satisfacción garantizada."
      },
      {
        type: "price",
        discount_percentage: cleanDiscount,
        original_price: cleanOriginalPrice || '',
        offer_price: cleanPrice,
        voice_text: `Baja a solo ${cleanPrice} pesos con un ${cleanDiscount} por ciento de descuento. ¡Un regalazo de ti para ti!`,
        subtitle: cleanOriginalPrice ? `De $${cleanOriginalPrice} a solo $${cleanPrice} pesos. ¡${cleanDiscount}% OFF!` : `A solo $${cleanPrice} pesos. ¡${cleanDiscount}% OFF!`
      },
      {
        type: "cta",
        headline: "¡PARA ESO TRABAJAS!",
        voice_text: "No te quedes con las ganas. Corre al link de nuestra biografía antes de que vuele. ¡Para eso trabajo!",
        subtitle: "¡Para eso trabajo! Consiéntete en el link de la bio."
      }
    ]
  };
}

// ─────────────────────────────────────────
// 4. GENERAR VOZ EN OFF SINCRONIZADA POR ESCENAS
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
        fs.writeFileSync(outputPath, Buffer.from(audioBuffer));
        return;
      }
    } catch (e) {
      console.warn(`ElevenLabs error en snippet: ${e.message}`);
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
    currentTime += dur + 0.15; // 150ms pausa natural entre escenas
  }

  const targetDur = Math.ceil(currentTime + 1.2);
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

    // Asegurar coherencia en la escena de precio
    if (metadata.scenes && metadata.scenes[2]) {
      metadata.scenes[2].offer_price = cleanPrice;
      metadata.scenes[2].original_price = cleanOriginalPrice || '';
      metadata.scenes[2].discount_percentage = cleanDiscount;
      if (cleanOriginalPrice) {
        metadata.scenes[2].subtitle = `De $${cleanOriginalPrice} a solo $${cleanPrice} pesos. ¡${cleanDiscount}% de descuento!`;
      }
    }

    // 4. Generar voz sincronizada por escenas
    const voiceInfo = await generateVoice(metadata.scenes);
    metadata.scenes = voiceInfo.timelineScenes;
    const targetDur = voiceInfo.durationSeconds;
    metadata.total_duration_sec = targetDur;
    metadata.total_frames = voiceInfo.totalFrames;
    metadata.affiliate_link = productLink;

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
