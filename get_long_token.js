// ============================================
// PASO 1: Convertir token corto → token largo
// ============================================
// Ejecutar UNA SOLA VEZ para obtener el token de larga duración
// Luego copiar el resultado al .env como PAGE_ACCESS_TOKEN

require('dotenv').config();
const https = require('https');

const { META_APP_ID, META_APP_SECRET, SHORT_LIVED_TOKEN } = process.env;

if (!META_APP_ID || META_APP_ID === 'PENDIENTE') {
  console.error('❌ Falta META_APP_ID en el .env');
  process.exit(1);
}

console.log('🔄 Canjeando token corto por token de larga duración...\n');

// PASO 1: Obtener User Long-Lived Token
const url1 = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&fb_exchange_token=${SHORT_LIVED_TOKEN}`;

https.get(url1, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    if (result.error) {
      console.error('❌ Error en token largo:', result.error.message);
      return;
    }
    const longUserToken = result.access_token;
    console.log('✅ User Long-Lived Token obtenido!\n');

    // PASO 2: Obtener Page Access Token (ya de larga duración)
    const url2 = `https://graph.facebook.com/me/accounts?access_token=${longUserToken}`;
    https.get(url2, (res2) => {
      let data2 = '';
      res2.on('data', chunk => data2 += chunk);
      res2.on('end', () => {
        const pages = JSON.parse(data2);
        if (pages.error) {
          console.error('❌ Error obteniendo páginas:', pages.error.message);
          return;
        }

        console.log('📄 Páginas encontradas:\n');
        pages.data.forEach(page => {
          console.log(`  📌 Nombre: ${page.name}`);
          console.log(`  🆔 Page ID: ${page.id}`);
          console.log(`  🔑 Page Token: ${page.access_token}`);
          console.log('  ---');
        });

        console.log('\n✅ Copia el Page Token de "Para eso trabajo" al .env como PAGE_ACCESS_TOKEN');
        console.log('✅ Copia el Page ID al .env como PAGE_ID');
      });
    }).on('error', err => console.error('❌ Error:', err.message));
  });
}).on('error', err => console.error('❌ Error:', err.message));
