const { chromium } = require('playwright');

/**
 * Resuelve redirecciones (ej. meli.la) a la URL de destino final.
 */
async function resolveUrl(url) {
    try {
        const response = await fetch(url, { method: 'GET', redirect: 'follow' });
        return response.url;
    } catch (e) {
        console.error(`⚠️ Error resolviendo URL redireccionada: ${e.message}`);
        return url;
    }
}

/**
 * Consulta la API oficial y pública de Mercado Libre para obtener datos exactos del producto.
 */
async function scrapeMercadoLibreApi(itemId) {
    try {
        console.log(`   [API] Consultando API de Mercado Libre para: ${itemId}`);
        const itemRes = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
        if (!itemRes.ok) {
            throw new Error(`API de items retornó status ${itemRes.status}`);
        }
        const itemData = await itemRes.json();
        
        // Traer la descripción oficial en texto plano
        let description = '';
        try {
            const descRes = await fetch(`https://api.mercadolibre.com/items/${itemId}/description`);
            if (descRes.ok) {
                const descData = await descRes.json();
                description = descData.plain_text || descData.text || '';
            }
        } catch (descErr) {
            console.warn(`   [API] No se pudo obtener la descripción vía API: ${descErr.message}`);
        }
        
        const price = itemData.price;
        const originalPrice = itemData.original_price;
        let discountStr = null;
        if (originalPrice && originalPrice > price) {
            const discountPct = Math.round(((originalPrice - price) / originalPrice) * 100);
            discountStr = `${discountPct}% OFF`;
        }
        
        // Extraer la primera imagen de alta calidad
        const imageUrl = itemData.pictures && itemData.pictures.length > 0 
            ? itemData.pictures[0].secure_url || itemData.pictures[0].url 
            : itemData.secure_thumbnail || itemData.thumbnail;
            
        return {
            title: itemData.title,
            price: `$${price}`,
            originalPrice: originalPrice ? `$${originalPrice}` : null,
            discount: discountStr,
            description: description,
            imageUrl: imageUrl,
            success: true,
            method: 'api'
        };
    } catch (e) {
        console.warn(`   [API] Error obteniendo datos de la API de Mercado Libre: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Carga la página mediante Playwright (Chrome Headless) para extraer datos directamente del DOM.
 */
async function scrapeWithPlaywright(url) {
    let browser;
    try {
        console.log(`   [Playwright] Iniciando navegador headless para: ${url}`);
        browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 800 },
            extraHTTPHeaders: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'accept-language': 'es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        const page = await context.newPage();
        
        // Wait for page to fully load
        await page.goto(url, { waitUntil: 'load', timeout: 25000 });
        
        // Wait for title element to settle, confirming navigation is complete
        await page.waitForSelector('h1', { timeout: 8000 }).catch(() => null);
        
        // Extraer todo en un solo bloque evaluate para evitar esperas secuenciales de locators
        const extractedData = await page.evaluate(() => {
            const getMeta = (query) => {
                const el = document.querySelector(query);
                return el ? el.getAttribute('content') : null;
            };
            
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.textContent.trim() : null;
            };
            
            let title = document.title || getText('h1');
            let ogImage = getMeta('meta[property="og:image"]') || getMeta('meta[name="twitter:image"]');
            let ogDescription = getMeta('meta[property="og:description"]') || getMeta('meta[name="description"]');
            
            let price = null;
            let originalPrice = null;
            let discount = null;
            let description = ogDescription || '';
            
            if (window.location.hostname.includes('mercadolibre.com')) {
                // A. CASO PERFIL SOCIAL (/social/)
                if (window.location.pathname.includes('/social/')) {
                    const card = document.querySelector('.poly-card');
                    if (card) {
                        const titleEl = card.querySelector('.poly-component__title, h2, h3, a[class*="title"]');
                        if (titleEl) title = titleEl.innerText.trim();
                        
                        const imgEl = card.querySelector('img.poly-component__picture, img');
                        if (imgEl) ogImage = imgEl.src || imgEl.getAttribute('data-src') || ogImage;
                        
                        const priceContainer = card.querySelector('.poly-component__price');
                        if (priceContainer) {
                            const previousPriceEl = priceContainer.querySelector('.andes-money-amount--previous');
                            if (previousPriceEl) {
                                const prevFraction = previousPriceEl.querySelector('.andes-money-amount__fraction');
                                if (prevFraction) {
                                    originalPrice = `$${prevFraction.innerText.trim().replace(/\./g, '')}`;
                                }
                            }
                            
                            const currentPriceEl = priceContainer.querySelector('.andes-money-amount:not(.andes-money-amount--previous)');
                            if (currentPriceEl) {
                                const currFraction = currentPriceEl.querySelector('.andes-money-amount__fraction');
                                const currCents = currentPriceEl.querySelector('.andes-money-amount__cents')?.innerText.trim() || '';
                                if (currFraction) {
                                    price = `$${currFraction.innerText.trim().replace(/\./g, '')}${currCents ? '.' + currCents : ''}`;
                                }
                            }
                            
                            const discountEl = priceContainer.querySelector('.andes-money-amount__discount, [class*="discount"]');
                            if (discountEl) {
                                discount = discountEl.innerText.trim();
                            }
                        }
                        description = 'Oferta recomendada en el perfil social de Mercado Libre.';
                    }
                } else {
                    // B. CASO DETALLE DE PRODUCTO (PDP)
                    const priceFraction = getText('.ui-pdp-price__second-line .andes-money-amount__fraction') || 
                                          getText('.andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction');
                    const priceCents = getText('.ui-pdp-price__second-line .andes-money-amount__cents') || 
                                        getText('.andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__cents') || '';
                    if (priceFraction) {
                        price = `$${priceFraction.replace(/\./g, '')}${priceCents ? '.' + priceCents : ''}`;
                    }
                    
                    const origFraction = getText('.ui-pdp-price__original-value .andes-money-amount__fraction') || 
                                         getText('.andes-money-amount--previous .andes-money-amount__fraction');
                    const origCents = getText('.ui-pdp-price__original-value .andes-money-amount__cents') || 
                                      getText('.andes-money-amount--previous .andes-money-amount__cents') || '';
                    if (origFraction) {
                        originalPrice = `$${origFraction.replace(/\./g, '')}${origCents ? '.' + origCents : ''}`;
                    }
                    
                    discount = getText('.ui-pdp-price__discount') || getText('.andes-money-amount__discount');
                    
                    const descEl = document.querySelector('.ui-pdp-description__content');
                    if (descEl) {
                        description = descEl.textContent.trim();
                    }
                }
            } else {
                // C. GENÉRICO
                const metaPrice = getMeta('meta[property="og:price:amount"]');
                if (metaPrice) {
                    const currency = getMeta('meta[property="og:price:currency"]') || 'MXN';
                    price = `$${metaPrice} ${currency}`;
                }
            }
            
            return {
                title,
                ogImage,
                price,
                originalPrice,
                discount,
                description
            };
        });
        
        let discount = extractedData.discount;
        if (!discount && extractedData.price && extractedData.originalPrice) {
            try {
                const cleanPrice = parseFloat(extractedData.price.replace(/[^\d.]/g, ''));
                const cleanOriginal = parseFloat(extractedData.originalPrice.replace(/[^\d.]/g, ''));
                if (!isNaN(cleanPrice) && !isNaN(cleanOriginal) && cleanOriginal > cleanPrice) {
                    const discountPct = Math.round(((cleanOriginal - cleanPrice) / cleanOriginal) * 100);
                    discount = `${discountPct}% OFF`;
                }
            } catch (e) {}
        }
        
        return {
            title: extractedData.title ? extractedData.title.trim() : '',
            price: extractedData.price,
            originalPrice: extractedData.originalPrice,
            discount: discount,
            description: extractedData.description,
            imageUrl: extractedData.ogImage,
            success: true,
            method: 'playwright'
        };
    } catch (e) {
        console.error(`❌ Error en scraping con Playwright para ${url}:`, e.message);
        return { success: false, error: e.message };
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

/**
 * Función principal expuesta para realizar el scraping del producto.
 */
async function scrapeProduct(url) {
    console.log(`🔍 Iniciando scraping para: ${url}`);
    const resolvedUrl = await resolveUrl(url);
    console.log(`   URL Resuelta: ${resolvedUrl}`);
    
    // 1. Validar si es Mercado Libre para usar la API Oficial (Rápida y precisa)
    const mlMatch = resolvedUrl.match(/(ML[A-Z])[-_]?(\d+)/i);
    if (mlMatch) {
        const itemId = `${mlMatch[1]}${mlMatch[2]}`.toUpperCase();
        const apiResult = await scrapeMercadoLibreApi(itemId);
        if (apiResult.success) {
            return {
                ...apiResult,
                url: resolvedUrl
            };
        }
        console.log(`   [API] Falló o no retornó datos. Usando fallback con Playwright...`);
    }
    
    // 2. Usar Playwright si no es Mercado Libre o si la API falló
    const playwrightResult = await scrapeWithPlaywright(resolvedUrl);
    if (playwrightResult.success) {
        return {
            ...playwrightResult,
            url: resolvedUrl
        };
    }
    
    // 3. Retornar error si ambos fallan
    return {
        title: '',
        price: null,
        originalPrice: null,
        discount: null,
        description: '',
        imageUrl: null,
        success: false,
        url: resolvedUrl,
        error: 'Ambos métodos de scraping (API y Playwright) fallaron'
    };
}

module.exports = {
    resolveUrl,
    scrapeProduct
};
