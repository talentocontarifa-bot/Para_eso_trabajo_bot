const { scrapeProduct } = require('./scraper');
require('dotenv').config();

const META_PAGE_ID = process.env.PAGE_ID;
const META_PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const productUrl = 'https://meli.la/1NABPmx';

// extractOgImage removed. Replaced by scrapeProduct.

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
    return data.id; // media_fbid
}

async function publishNow(copyText, mediaFbid) {
    const url = `https://graph.facebook.com/v25.0/${META_PAGE_ID}/feed`;
    const payload = {
        message: copyText,
        published: true, // TRUE para que se publique ahorita mismo
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
    
    return await res.json();
}

async function main() {
    console.log("Extrayendo imagen...");
    const scrapeResult = await scrapeProduct(productUrl);
    const imageUrl = scrapeResult.imageUrl;
    
    let mediaFbid = null;
    if (imageUrl) {
        console.log("Subiendo imagen oculta a Meta...");
        try {
            mediaFbid = await uploadUnpublishedPhoto(imageUrl);
            console.log("Media FBID:", mediaFbid);
        } catch (uploadErr) {
            console.warn("⚠️ Falló la subida de imagen:", uploadErr.message);
        }
    }
    
    const copyText = `🔥 ¡Mira esta chulada que encontré en Mercado Libre! \n\nNo dejes pasar esta oportunidad. Aprovecha antes de que se acabe el stock. 🏃‍♂️💨\n\n👉 Cómpralo aquí: ${productUrl}`;
    
    console.log("Publicando inmediatamente en la página...");
    const result = await publishNow(copyText, mediaFbid);
    console.log("Resultado de Meta:", result);
}

main().catch(console.error);
