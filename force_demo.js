const { execSync } = require('child_process');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
    const result = await model.generateContent(prompt);
    return result.response.text();
}

async function main() {
    console.log("🚀 Iniciando Force Demo Post...");
    let issuesJson = execSync('gh issue list --state open --json number,title,body --limit 1').toString();
    let issues = JSON.parse(issuesJson);
    
    if (issues.length === 0) {
        issuesJson = execSync('gh issue list --state closed --json number,title,body --limit 10').toString();
        let closedIssues = JSON.parse(issuesJson);
        issues = closedIssues.sort(() => 0.5 - Math.random()).slice(0, 1);
    }
    
    const issue = issues[0];
    const match = (issue.body || '').match(/(https?:\/\/[^\s]+)/) || issue.title.match(/(https?:\/\/[^\s]+)/);
    const productUrl = match[1];

    let imageUrl = await extractOgImage(productUrl);
    let mediaFbid = null;
    if (imageUrl) mediaFbid = await uploadUnpublishedPhoto(imageUrl);
    
    let copyText = await generateCopy(issue, productUrl);
    copyText = `[PRUEBA DE REDACCIÓN NUEVA]\n\n${copyText}`; 

    const postId = await publishPostNow(copyText, mediaFbid);
    console.log(`✅ ¡Post DEMO publicado exitosamente! ID: ${postId}`);
}

main().catch(console.error);
