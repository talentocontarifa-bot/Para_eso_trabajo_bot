const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { scrapeProduct } = require('./scraper');
require('dotenv').config();

const PAGE_ID = process.env.META_PAGE_ID || process.env.PAGE_ID;
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN || process.env.PAGE_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!PAGE_ID || !PAGE_ACCESS_TOKEN || !GEMINI_API_KEY) {
    console.error("❌ Error: Faltan credenciales en el archivo .env (PAGE_ID, PAGE_ACCESS_TOKEN o GEMINI_API_KEY).");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const QUEUE_FILE = path.join(__dirname, 'queue.json');

// 1. Función para eliminar un post agendado de Facebook
async function deletePost(postId) {
    const url = `https://graph.facebook.com/v25.0/${postId}?access_token=${PAGE_ACCESS_TOKEN}`;
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    return data;
}

// 2. Función para subir imagen oculta a Meta
async function uploadUnpublishedPhoto(imageUrl) {
    const url = `https://graph.facebook.com/v25.0/${PAGE_ID}/photos`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: imageUrl,
            published: false,
            access_token: PAGE_ACCESS_TOKEN
        })
    });
    const data = await res.json();
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.id;
}

// 3. Función para agendar post en Facebook
async function schedulePost(copyText, mediaFbid, scheduledTime) {
    const url = `https://graph.facebook.com/v25.0/${PAGE_ID}/feed`;
    const payload = {
        message: copyText,
        published: false,
        scheduled_publish_time: scheduledTime,
        access_token: PAGE_ACCESS_TOKEN
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
    if (data.error) throw new Error(JSON.stringify(data.error));
    return data.id;
}

// 4. Generación de Copy
async function generateCopy(title, productUrl, productMarkdown) {
    const prompt = `Eres un copywriter experto en marketing de afiliados con estilo directo y persuasivo.
Crea un post corto para Facebook promocionando el siguiente producto de Mercado Libre.

Aquí tienes la información real del producto extraída de la página web (Markdown):
${productMarkdown ? productMarkdown : "No se pudo extraer información directa del producto."}

Título/Comentario sugerido por el usuario: "${title}"

REGLAS DE REDACCIÓN SUPER ESTRICTAS:
1. Lo PRIMERO que debe verse en el post es el PRECIO ACTUAL, el PRECIO ORIGINAL y el DESCUENTO (si lo hay), todo extraído ÚNICAMENTE de la información real de arriba.
2. Si la información real (Markdown) NO contiene el precio, NO LO INVENTES. En su lugar, usa una frase ganadora como "¡Checa el precio de locura en el link!" o similar. ESTÁ ESTRICTAMENTE PROHIBIDO HALLUCINAR O INVENTAR NÚMEROS O PRECIOS.
3. El copy de venta no debe superar 1 PÁRRAFO de extensión. Sé extremadamente conciso.
4. Usa emojis seleccionados para hacerlo visualmente atractivo y generar urgencia o deseo (ej. 🔥, ⚡, 📦).
5. MUY IMPORTANTE: DEBES INCLUIR el siguiente link de compra exactamente en el texto final: ${productUrl}

Solo devuelve el texto final del post (asegúrate de que el link esté ahí), sin notas adicionales ni explicaciones.`;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text();
}

async function main() {
    console.log("🚀 Iniciando corrección de posts futuros programados con errores...\n");
    const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    const now = new Date();
    let updatedCount = 0;

    for (const post of queue) {
        const postDate = new Date(post.scheduled_date);
        
        // Solo corregir posts cuyo tiempo programado sea en el futuro y estén marcados como scheduled
        if (postDate > now && post.status === 'scheduled' && post.fb_post_id) {
            console.log(`📌 [ID ${post.id}] Corrigiendo post programado para: ${post.scheduled_date}`);
            console.log(`   Producto original en cola: ${post.producto}`);
            console.log(`   Link: ${post.link}`);

            // A. Eliminar post antiguo de Facebook
            console.log(`   🗑️ Eliminando de Facebook (ID: ${post.fb_post_id})...`);
            try {
                const delRes = await deletePost(post.fb_post_id);
                if (delRes.error) {
                    console.warn(`   ⚠️ Advertencia al eliminar: ${delRes.error.message}`);
                } else {
                    console.log(`   ✅ Eliminado de Facebook con éxito.`);
                }
            } catch (err) {
                console.warn(`   ⚠️ Falló la petición de eliminación: ${err.message}`);
            }

            // B. Scrapear producto con el nuevo scraper de alta precisión
            console.log(`   🔍 Scraping de producto...`);
            const scrapeResult = await scrapeProduct(post.link);
            if (!scrapeResult.success) {
                console.error(`   ❌ Error al scrapear producto: ${scrapeResult.error}`);
                continue;
            }

            // C. Subir nueva imagen de producto a Facebook
            let mediaFbid = null;
            if (scrapeResult.imageUrl) {
                console.log(`   🖼️ Subiendo nueva imagen a Meta: ${scrapeResult.imageUrl}`);
                try {
                    mediaFbid = await uploadUnpublishedPhoto(scrapeResult.imageUrl);
                    console.log(`   ✔️ Nuevo Media FBID obtenido: ${mediaFbid}`);
                } catch (uploadErr) {
                    console.warn(`   ⚠️ Falló la subida de la nueva imagen: ${uploadErr.message}`);
                }
            }

            // D. Formatear Markdown e IA Copy
            let productMarkdown = `Título: ${scrapeResult.title}\n`;
            if (scrapeResult.price) productMarkdown += `Precio Actual: ${scrapeResult.price}\n`;
            if (scrapeResult.originalPrice) productMarkdown += `Precio Original: ${scrapeResult.originalPrice}\n`;
            if (scrapeResult.discount) productMarkdown += `Descuento: ${scrapeResult.discount}\n`;
            productMarkdown += `Descripción:\n${scrapeResult.description || 'Sin descripción disponible.'}`;

            console.log(`   🧠 Generando nuevo copy corregido con Gemini...`);
            let newCopy = await generateCopy(scrapeResult.title, post.link, productMarkdown);
            newCopy = newCopy.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/g, '$1').trim();

            if (!newCopy.includes(post.link)) {
                newCopy += `\n\nComprar aquí: ${post.link}`;
            }

            // E. Agendar de nuevo en Facebook
            const unixTimestamp = Math.floor(postDate.getTime() / 1000);
            console.log(`   ⏰ Agendando nuevo post en Facebook para: ${post.scheduled_date}`);
            const newFbPostId = await schedulePost(newCopy, mediaFbid, unixTimestamp);
            console.log(`   ✅ Agendado con éxito. Nuevo ID: ${newFbPostId}`);

            // F. Actualizar cola local
            post.producto = scrapeResult.title;
            post.precio = scrapeResult.price || post.precio;
            post.descuento = scrapeResult.discount || post.descuento;
            post.copy = newCopy;
            post.fb_post_id = newFbPostId;
            post.scheduled_at = new Date().toISOString();
            updatedCount++;
            
            console.log(`   --------------------------------------------`);
        }
    }

    if (updatedCount > 0) {
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
        console.log(`\n🎉 ¡Operación completada! Se corrigieron y reagendaron ${updatedCount} posts futuros en Facebook.`);
    } else {
        console.log("\n🤷 No se encontraron posts agendados en el futuro para corregir.");
    }
}

main().catch(console.error);
