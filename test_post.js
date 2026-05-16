require('dotenv').config();
const https = require('https');

const { PAGE_ACCESS_TOKEN, PAGE_ID } = process.env;

const mensaje = '🔥 Esto se va a poner buenísimo... ¡espéralo! 👀\n\n¡Muy pronto traemos los mejores productos y ofertas directo a esta página! 🛒✨\n\n#ParaEsoTrabajo #Ofertas #MercadoLibre';

const postData = JSON.stringify({ message: mensaje, access_token: PAGE_ACCESS_TOKEN });

const options = {
  hostname: 'graph.facebook.com',
  path: `/v25.0/${PAGE_ID}/feed`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('🚀 Publicando post de prueba en "Para eso trabajo"...\n');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    if (result.error) {
      console.error('❌ Error:', result.error.message);
      console.error('Código:', result.error.code);
    } else {
      console.log('✅ ¡POST PUBLICADO EXITOSAMENTE!');
      console.log('🆔 Post ID:', result.id);
      console.log(`🔗 Ver en Facebook: https://www.facebook.com/${result.id}`);
    }
  });
});

req.on('error', err => console.error('❌ Error de red:', err.message));
req.write(postData);
req.end();
