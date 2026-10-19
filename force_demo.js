const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { scrapeProduct } = require('./scraper');
require('dotenv').config();

const META_PAGE_ID = process.env.META_PAGE_ID;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// extractOgImage removed. Scraper module extracts image directly.

async function uploadUnpublishedPhoto(imageUrl) {
    const url = `https://graph.facebook.com/v20.0/${META_PAGE_ID}/photos`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: imageUrl, published: false, access_token: META_PAGE_ACCESS_TOKEN })
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.id;
}

async function publishPostNow(copyText, mediaFbid) {
    const url = `https://graph.facebook.com/v20.0/${META_PAGE_ID}/feed`;
    const payload = {
        message: copyText,
        published: true, // INMEDIATAMENTE
        access_token: META_PAGE_ACCESS_TOKEN
    };
    if (mediaFbid) payload.attached_media = [{ media_fbid: mediaFbid }];

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.id;
}

// Jina extraction and url resolving functions removed. Replaced by scrapeProduct.

async function postFirstComment(postId, productUrl) {
    try {
        const url = `https://graph.facebook.com/v20.0/${postId}/comments`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: `🛍️ Enlace directo a la oferta en Mercado Libre:\n${productUrl}`,
                access_token: META_PAGE_ACCESS_TOKEN
            })
        });
        const data = await res.json();
        if (data.id) console.log(`💬 Primer comentario con link clickeable publicado: ${data.id}`);
    } catch (e) {
        console.warn(`⚠️ No se pudo publicar el primer comentario: ${e.message}`);
    }
}

async function generateCopy(issue, productUrl, productMarkdown) {
    const prompt = `Eres un copywriter de respuesta directa agresivo y experto en ventas de afiliados para "Para eso trabajo".
Crea un post de Facebook ULTRA VENDEDOR, directo al grano y sin rodeos promocionando este producto de Mercado Libre.

Aquí tienes la información real del producto extraída de la página web (Markdown):
${productMarkdown ? productMarkdown : "No se pudo extraer información directa del producto."}

Título/Comentario sugerido por el usuario: "${issue.title}"
Comentario adicional en el issue: "${issue.body || 'Sin descripción adicional'}"

ESTRUCTURA OBLIGATORIA Y AGRESIVA (EN ESTE ORDEN EXACTO):
1. GOLPE INMEDIATO DE DESCUENTO, PRODUCTO Y PRECIO (Líneas 1 y 2):
   - Línea 1: 🚨 ¡BAJÓ [DESCUENTO]! [NOMBRE CORTO Y CLARO DE QUÉ ES EL PRODUCTO]
   - Línea 2: 💥 HOY: [PRECIO ACTUAL] (Antes [PRECIO ORIGINAL] — ¡Te ahorras $[AHORRO]!) extraído ÚNICAMENTE de la información real. Si NO viene el precio en los datos reales, NO LO INVENTES y pon: "💥 ¡PRECIO DE REMATE POR TIEMPO LIMITADO!".
2. LINK CLICKEABLE ARRIBA DEL CORTE (Línea 3):
   - Línea 3: 👉 Cómpralo aquí: ${productUrl}
3. QUÉ ES Y QUÉ HACE (Directo, concreto, sin rollo suave):
   - Explica en 2 líneas contundentes QUÉ ES exactamente el producto, QUÉ HACE (potencia, capacidad, material, función real) y agrega 3 bullets cortos con ✅ de sus especificaciones o beneficios más fuertes.
4. CIERRE DE URGENCIA CON SEGUNDO LINK CLICKEABLE:
   - Cierra con:
   🔥 A este precio vuela. ¡Date el gusto, que para eso trabajas!
   🛒 Link directo a Mercado Libre:
   ${productUrl}

Solo devuelve el texto final del post listo para publicar, sin notas adicionales ni bloques markdown.`;

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
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
}

async function main() {
    console.log("🚀 Iniciando Force Demo Post...");
    let issue;
    try {
        let issuesJson = execSync('gh issue list --state open --json number,title,body --limit 1').toString();
        let issues = JSON.parse(issuesJson);
        
        if (issues.length === 0) {
            issuesJson = execSync('gh issue list --state closed --json number,title,body --limit 10').toString();
            let closedIssues = JSON.parse(issuesJson);
            issues = closedIssues.sort(() => 0.5 - Math.random()).slice(0, 1);
        }
        issue = issues[0];
    } catch (e) {
        console.log("⚠️ Falló gh CLI, usando issue mock para prueba local.");
        issue = {
            number: 19,
            title: "Mesa para comer con toda la familia",
            body: "https://meli.la/2i5tQNr"
        };
    }
    const match = (issue.body || '').match(/(https?:\/\/[^\s]+)/) || issue.title.match(/(https?:\/\/[^\s]+)/);
    const productUrl = match[1];

    // A. Realizar scraping del producto con el nuevo scraper unificado
    const scrapeResult = await scrapeProduct(productUrl);
    
    let imageUrl = scrapeResult.imageUrl;
    let mediaFbid = null;
    if (imageUrl && !process.argv.includes('--dry-run')) {
        console.log(`🖼️ Imagen extraída: ${imageUrl}`);
        try {
            mediaFbid = await uploadUnpublishedPhoto(imageUrl);
        } catch (uploadErr) {
            console.warn(`⚠️ Falló la subida de la imagen a Meta: ${uploadErr.message}`);
        }
    }
    
    // B. Formatear la información del producto de manera limpia y estructurada para la IA
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

    console.log(`📝 COPY GENERADO EXITOSAMENTE:\n-----------------\n${copyText}\n-----------------\n`);

    if (process.argv.includes('--dry-run')) {
        console.log(`ℹ️ Modo --dry-run activo: no se publicó en Facebook.`);
        return;
    }

    const postId = await publishPostNow(copyText, mediaFbid);
    console.log(`✅ ¡Post DEMO publicado exitosamente! ID: ${postId}`);
    await postFirstComment(postId, productUrl);
}

main().catch(console.error);
