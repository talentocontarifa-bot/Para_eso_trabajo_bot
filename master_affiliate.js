const fs = require('fs');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { scrapeProduct } = require('./scraper');

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

// extractOgImage removed. Scraper module extracts image directly.

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
            let waitTime = Math.pow(2, attempts) * 1000 + 10000;
            if (error.message.includes("429") || error.message.toLowerCase().includes("quota exceeded") || attempts > 2) {
                waitTime = 65000; // Espera 65 segundos si es cuota o si ya van varios intentos
                console.log(`Error persistente o rate limit detectado. Esperando 65s para enfriar la API...`);
            } else {
                console.log(`Espera de ${waitTime/1000}s antes del próximo intento...`);
            }
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// Jina extraction and url resolving functions removed. Replaced by scrapeProduct.

async function generateCopy(issue, productUrl, productMarkdown) {
    const prompt = `Eres un copywriter experto en marketing de afiliados con estilo directo y persuasivo.
Crea un post corto para Facebook promocionando el siguiente producto de Mercado Libre.

Aquí tienes la información real del producto extraída de la página web (Markdown):
${productMarkdown ? productMarkdown : "No se pudo extraer información directa del producto."}

Título/Comentario sugerido por el usuario: "${issue.title}"
Comentario adicional en el issue: "${issue.body || 'Sin descripción adicional'}"

REGLAS DE REDACCIÓN SUPER ESTRICTAS:
1. Lo PRIMERO que debe verse en el post es el PRECIO ACTUAL, el PRECIO ORIGINAL y el DESCUENTO (si lo hay), todo extraído ÚNICAMENTE de la información real de arriba.
2. Si la información real (Markdown) NO contiene el precio, NO LO INVENTES. En su lugar, usa una frase ganadora como "¡Checa el precio de locura en el link!" o similar. ESTÁ ESTRICTAMENTE PROHIBIDO HALLUCINAR O INVENTAR NÚMEROS O PRECIOS.
3. El copy de venta no debe superar 1 PÁRRAFO de extensión. Sé extremadamente conciso.
4. Usa emojis seleccionados para hacerlo visualmente atractivo y generar urgencia o deseo (ej. 🔥, ⚡, 📦).
5. MUY IMPORTANTE: DEBES INCLUIR el siguiente link de compra exactamente en el texto final: ${productUrl}

Solo devuelve el texto final del post (asegúrate de que el link esté ahí), sin notas adicionales ni explicaciones.`;

    // 1. Intentar con Groq si está disponible
    if (process.env.GROQ_API_KEY) {
        console.log("🧠 Generando copy con Groq (Llama 3.3 70B)...");
        const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
        for (const model of models) {
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
                            model: model,
                            messages: [
                                { role: "user", content: prompt }
                            ],
                            temperature: 0.7
                        })
                    });
                    const data = await response.json();
                    if (response.ok) {
                        console.log(`✅ Copy generado exitosamente con Groq (${model})`);
                        return data.choices[0].message.content.trim();
                    } else {
                        throw new Error(data.error?.message || "Error de Groq");
                    }
                } catch (e) {
                    attempts++;
                    console.log(`⚠️ Intento ${attempts} con Groq (${model}) fallido: ${e.message}`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
        console.log("❌ Todos los intentos con Groq fallaron. Pasando a Gemini como respaldo...");
    }

    // 2. Respaldo a Gemini
    console.log(`🧠 Generando copy con Gemini...`);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
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
            // A. Realizar scraping del producto con el nuevo scraper unificado
            const scrapeResult = await scrapeProduct(productUrl);
            
            let imageUrl = scrapeResult.imageUrl;
            let mediaFbid = null;
            
            if (imageUrl) {
                console.log(`🖼️ Imagen extraída: ${imageUrl}`);
                // B. Subir imagen oculta a Meta
                console.log(`☁️ Subiendo imagen a Meta...`);
                try {
                    mediaFbid = await uploadUnpublishedPhoto(imageUrl);
                    console.log(`✔️ Media FBID obtenido: ${mediaFbid}`);
                } catch (uploadErr) {
                    console.warn(`⚠️ Falló la subida de la imagen a Meta: ${uploadErr.message}`);
                }
            } else {
                console.log(`⚠️ No se pudo extraer la imagen del producto. Se publicará solo con el texto/link.`);
            }

            // C. Formatear la información del producto de manera limpia y estructurada para la IA
            let productMarkdown = null;
            if (scrapeResult.success) {
                productMarkdown = `Título: ${scrapeResult.title}\n`;
                if (scrapeResult.price) productMarkdown += `Precio Actual: ${scrapeResult.price}\n`;
                if (scrapeResult.originalPrice) productMarkdown += `Precio Original: ${scrapeResult.originalPrice}\n`;
                if (scrapeResult.discount) productMarkdown += `Descuento: ${scrapeResult.discount}\n`;
                productMarkdown += `Descripción:\n${scrapeResult.description || 'Sin descripción disponible.'}`;
            } else {
                console.warn(`⚠️ El scraping falló: ${scrapeResult.error}`);
            }

            console.log(`🧠 Generando copy con IA...`);
            let copyText = await generateCopy(issue, productUrl, productMarkdown);
            
            // Limpiar bloques de código markdown de Gemini
            copyText = copyText.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/g, '$1').trim();
            
            if (!copyText.includes(productUrl)) {
                console.warn(`⚠️ Omitió el link, añadiéndolo al final...`);
                copyText += `\n\nComprar aquí: ${productUrl}`;
            }
            console.log(`📝 COPY GENERADO EXITOSAMENTE:\n-----------------\n${copyText}\n-----------------\n`);

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
