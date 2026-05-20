const { execSync } = require('child_process');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const META_PAGE_ID = process.env.META_PAGE_ID;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function extractOgImage(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = await res.text();
        const $ = cheerio.load(html);
        return $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
    } catch (e) {
        return null;
    }
}

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

// Resolver redirecciones de Mercado Libre (e.g. meli.la)
async function resolveUrl(url) {
    try {
        const response = await fetch(url, { method: 'GET', redirect: 'follow' });
        return response.url;
    } catch (e) {
        console.error(`⚠️ Error resolviendo URL redireccionada: ${e.message}`);
        return url;
    }
}

// Extraer markdown limpio con Jina Reader
async function extractProductMarkdown(url) {
    try {
        const resolvedUrl = await resolveUrl(url);
        console.log(`   Scrapeando producto con Jina Reader: ${resolvedUrl}`);
        const jinaUrl = `https://r.jina.ai/${resolvedUrl}`;
        const response = await fetch(jinaUrl);
        if (!response.ok) {
            throw new Error(`Jina retornó status ${response.status}`);
        }
        const text = await response.text();
        return text.substring(0, 10000); // Limitamos para evitar exceder tokens
    } catch (e) {
        console.warn(`⚠️ No se pudo extraer markdown del producto: ${e.message}`);
        return null;
    }
}

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
    const result = await model.generateContent(prompt);
    return result.response.text();
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

    let imageUrl = await extractOgImage(productUrl);
    let mediaFbid = null;
    if (imageUrl) mediaFbid = await uploadUnpublishedPhoto(imageUrl);
    
    console.log(`🔍 Extrayendo información de la web del producto...`);
    const productMarkdown = await extractProductMarkdown(productUrl);

    console.log(`🧠 Generando copy con IA...`);
    let copyText = await generateCopy(issue, productUrl, productMarkdown);
    copyText = `[PRUEBA DE REDACCIÓN NUEVA]\n\n${copyText}`; 

    console.log(`📝 COPY GENERADO EXITOSAMENTE:\n-----------------\n${copyText}\n-----------------\n`);

    const postId = await publishPostNow(copyText, mediaFbid);
    console.log(`✅ ¡Post DEMO publicado exitosamente! ID: ${postId}`);
}

main().catch(console.error);
