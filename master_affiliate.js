const fs = require('fs');
const { execSync } = require('child_process');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

require('dotenv').config();

const META_PAGE_ID = process.env.META_PAGE_ID || process.env.PAGE_ID;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Inicializa Gemini
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Horarios de publicación (10:00 AM, 2:00 PM, 6:00 PM, 9:00 PM)
const SCHEDULE_HOURS = ['10:00', '14:00', '18:00', '21:00'];

// Generar timestamp en UTC-6
function getScheduledTime(hourStr) {
    const [targetHour, targetMin] = hourStr.split(':').map(Number);
    const now = new Date();
    
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Mexico_City",
        year: 'numeric', month: 'numeric', day: 'numeric'
    });
    const dateParts = formatter.formatToParts(now);
    const year = dateParts.find(p => p.type === 'year').value;
    const month = dateParts.find(p => p.type === 'month').value;
    const day = dateParts.find(p => p.type === 'day').value;
    
    // Formato ISO con offset de Ciudad de México / Central Time (-06:00)
    const isoString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${String(targetHour).padStart(2, '0')}:${String(targetMin).padStart(2, '0')}:00.000-06:00`;
    
    const timestamp = Math.floor(new Date(isoString).getTime() / 1000);
    return timestamp;
}

// Extraer imagen del HTML usando cheerio
async function extractOgImage(url) {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const html = await res.text();
        const $ = cheerio.load(html);
        const ogImage = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
        return ogImage;
    } catch (e) {
        console.error(`Error extrayendo og:image de ${url}:`, e);
        return null;
    }
}

async function uploadUnpublishedPhoto(imageUrl) {
    const url = `https://graph.facebook.com/v25.0/${META_PAGE_ID}/photos`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: imageUrl,
            published: false,
            access_token: META_PAGE_ACCESS_TOKEN
        })
    });
    
    const data = await res.json();
    if (data.error) {
        throw new Error(`Error en uploadUnpublishedPhoto: ${JSON.stringify(data.error)}`);
    }
    return data.id; // media_fbid
}

async function schedulePost(copyText, mediaFbid, scheduledTime) {
    const url = `https://graph.facebook.com/v25.0/${META_PAGE_ID}/feed`;
    const payload = {
        message: copyText,
        published: false,
        scheduled_publish_time: scheduledTime,
        access_token: META_PAGE_ACCESS_TOKEN
    };

    if (mediaFbid) {
        payload.attached_media = [{ media_fbid: mediaFbid }];
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.error) {
        throw new Error(`Error en schedulePost: ${JSON.stringify(data.error)}`);
    }
    return data.id;
}

async function callGeminiWithRetry(model, content, maxRetries = 5) {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            return await model.generateContent(content);
        } catch (error) {
            attempts++;
            console.warn(`⚠️ Intento ${attempts} fallido al llamar a Gemini: ${error.message}`);
            if (attempts >= maxRetries) {
                throw error;
            }
            let waitTime = Math.pow(2, attempts) * 1000;
            if (error.message.includes("429") || error.message.toLowerCase().includes("quota exceeded")) {
                waitTime = 40000; // Espera 40 segundos si es cuota/rate limit
                console.log(`Rate limit (429) detectado. Esperando 40s para limpiar la cuota...`);
            } else {
                console.log(`Espera de ${waitTime/1000}s antes del próximo intento...`);
            }
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

async function generateCopy(issue, productUrl) {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Eres un copywriter experto en marketing de afiliados.
Crea un post corto, directo y persuasivo para Facebook vendiendo el siguiente producto de Mercado Libre.
REGLAS ESTRICTAS:
1. Lo PRIMERO que se debe ver en el post es el PRECIO, la PROMOCIÓN y el PORCENTAJE DE DESCUENTO (si lo hay).
2. El copy de venta no debe superar 1 PÁRRAFO de extensión. Debe ser muy conciso.
3. Usa emojis para hacerlo visualmente atractivo y generar urgencia o deseo.
4. MUY IMPORTANTE: DEBES INCLUIR el siguiente link de compra en el texto final: ${productUrl}

Aquí tienes la información enviada por el usuario:
Título: ${issue.title}
Cuerpo: ${issue.body || 'Sin descripción adicional'}

Solo devuelve el texto final del post (asegúrate de que el link esté ahí), sin notas adicionales.`;

    const result = await callGeminiWithRetry(model, prompt);
    return result.response.text();
}

async function main() {
    console.log("🚀 Iniciando Master Affiliate...");

    if (!META_PAGE_ID || !META_PAGE_ACCESS_TOKEN || !GEMINI_API_KEY) {
        console.error("❌ Faltan variables de entorno (META_PAGE_ID, META_PAGE_ACCESS_TOKEN, GEMINI_API_KEY).");
        process.exit(1);
    }

    // 1. Obtener issues de GitHub
    console.log("📥 Consultando Issues abiertos...");
    let issuesJson;
    try {
        issuesJson = execSync('gh issue list --state open --json number,title,body --limit 4').toString();
    } catch (e) {
        console.error("❌ Error ejecutando 'gh issue list'. ¿Tienes el GH_TOKEN configurado?");
        console.error(e.message);
        process.exit(1);
    }

    let issues = JSON.parse(issuesJson);
    if (issues.length === 0) {
        console.log("⚠️ No hay issues abiertos. Buscando publicaciones pasadas para reciclar...");
        try {
            // Obtenemos hasta 100 issues cerrados para elegir 4 al azar
            const closedIssuesJson = execSync('gh issue list --state closed --json number,title,body --limit 100').toString();
            let closedIssues = JSON.parse(closedIssuesJson);
            
            if (closedIssues.length === 0) {
                console.log("✅ Tampoco hay issues cerrados. Nada que hacer.");
                return;
            }
            
            // Elegir aleatoriamente hasta 4 y marcarlos como reciclados
            issues = closedIssues.sort(() => 0.5 - Math.random()).slice(0, 4).map(i => ({...i, isRecycled: true}));
            console.log(`♻️ Se reciclarán ${issues.length} publicaciones pasadas.`);
        } catch (e) {
            console.error("❌ Error buscando issues cerrados:", e.message);
            return;
        }
    } else {
        console.log(`📦 Se encontraron ${issues.length} issues para procesar hoy.`);
    }

    const urlRegex = /(https?:\/\/[^\s]+)/;

    // 2. Procesar cada issue
    for (let i = 0; i < issues.length; i++) {
        const issue = issues[i];
        console.log(`\n---------------------------------`);
        console.log(`⚙️ Procesando Issue #${issue.number}: ${issue.title}`);

        const match = (issue.body || '').match(urlRegex) || issue.title.match(urlRegex);
        if (!match) {
            console.log(`⚠️ No se encontró ninguna URL en el issue #${issue.number}. Saltando.`);
            continue;
        }

        const productUrl = match[1];
        console.log(`🔗 Link detectado: ${productUrl}`);

        try {
            // A. Extraer imagen
            let imageUrl = await extractOgImage(productUrl);
            let mediaFbid = null;
            
            if (imageUrl) {
                console.log(`🖼️ Imagen extraída: ${imageUrl}`);
                // B. Subir imagen oculta a Meta
                console.log(`☁️ Subiendo imagen a Meta...`);
                mediaFbid = await uploadUnpublishedPhoto(imageUrl);
                console.log(`✔️ Media FBID obtenido: ${mediaFbid}`);
            } else {
                console.log(`⚠️ No se pudo extraer og:image. Se publicará solo con el texto/link.`);
            }

            // C. Generar Copy
            console.log(`🧠 Generando copy con Gemini...`);
            let copyText = await generateCopy(issue, productUrl);
            
            // Limpiar bloques de código markdown de Gemini
            copyText = copyText.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/g, '$1').trim();
            
            if (!copyText.includes(productUrl)) {
                console.warn(`⚠️ Gemini omitió el link, añadiéndolo al final...`);
                copyText += `\n\nComprar aquí: ${productUrl}`;
            }
            console.log(`📝 Copy generado exitosamente.`);

            // D. Programar Post
            const hourSlot = SCHEDULE_HOURS[i]; // El array tiene máximo 4 elementos
            let scheduledTime = getScheduledTime(hourSlot);
            
            // Validar que la fecha sea mínimo 15 minutos en el futuro
            const now = new Date();
            const minScheduledTime = Math.floor((now.getTime() + 15 * 60 * 1000) / 1000);
            if (scheduledTime < minScheduledTime) {
                console.log(`⚠️ La hora programada (${hourSlot}) ya pasó. Ajustando a 15 min en el futuro...`);
                scheduledTime = minScheduledTime;
            }
            
            console.log(`⏰ Programando post para las ${hourSlot} (Timestamp: ${scheduledTime})`);
            
            const postId = await schedulePost(copyText, mediaFbid, scheduledTime);
            console.log(`✅ Post programado con éxito: ${postId}`);

            // E. Cerrar Issue (solo si es nuevo)
            if (!issue.isRecycled) {
                console.log(`🔒 Cerrando issue #${issue.number}...`);
                execSync(`gh issue close ${issue.number}`);
                console.log(`✔️ Issue cerrado.`);
            } else {
                console.log(`♻️ Issue #${issue.number} reciclado (ya estaba cerrado).`);
            }

        } catch (err) {
            console.error(`❌ Error procesando el issue #${issue.number}:`);
            if (err.response && err.response.data) {
                console.error("Detalles del Error (API):", JSON.stringify(err.response.data, null, 2));
            } else {
                console.error(err.stack || err);
            }
        }
    }
    
    console.log("\n🎉 Proceso completado.");
}

main().catch(console.error);
