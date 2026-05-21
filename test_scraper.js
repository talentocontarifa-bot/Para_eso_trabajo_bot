const { scrapeProduct } = require('./scraper');

async function test() {
    const url = 'https://www.mercadolibre.com.mx/audifonos-inalambricos-huawei-freebuds-se-3-negro/p/MLM44417681';
    console.log(`🧪 Iniciando prueba con URL en vivo: ${url}`);
    
    try {
        const result = await scrapeProduct(url);
        console.log('\n========================================');
        console.log('📊 RESULTADOS DEL SCRAPING:');
        console.log('========================================');
        console.log(JSON.stringify(result, null, 2));
        console.log('========================================');
        
        if (result.success && result.price && result.title) {
            console.log('✅ Prueba EXITOSA. Los datos se extrajeron correctamente.');
        } else {
            console.error('❌ Prueba FALLIDA. Faltan datos esenciales o falló la extracción.');
        }
    } catch (e) {
        console.error('❌ Ocurrió un error durante la prueba:', e);
    }
}

test();
