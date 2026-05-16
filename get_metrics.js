require('dotenv').config();
const https = require('https');

const { PAGE_ACCESS_TOKEN, PAGE_ID } = process.env;

function fetchMetrics(endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.facebook.com',
      path: endpoint,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('📊 Consultando métricas de la página...');
  
  // 1. Obtener información básica (seguidores y likes)
  const basicInfoPath = `/v25.0/${PAGE_ID}?fields=name,followers_count,fan_count&access_token=${PAGE_ACCESS_TOKEN}`;
  const basicInfo = await fetchMetrics(basicInfoPath);
  
  if (basicInfo.error) {
    console.error('❌ Error obteniendo info básica:', basicInfo.error.message);
  } else {
    console.log(`\n✅ Página: ${basicInfo.name}`);
    console.log(`👥 Seguidores: ${basicInfo.followers_count}`);
    console.log(`👍 Me gusta (Fans): ${basicInfo.fan_count}`);
  }

  // 2. Obtener métricas de alcance (insights)
  // Nota: Para /insights se requiere el permiso 'read_insights' o 'pages_read_engagement'
  const insightsPath = `/v25.0/${PAGE_ID}/insights?metric=page_impressions,page_post_engagements&period=day&access_token=${PAGE_ACCESS_TOKEN}`;
  const insights = await fetchMetrics(insightsPath);

  if (insights.error) {
    console.log(`\n⚠️ No se pudieron obtener los Insights avanzados (probablemente falte el permiso 'read_insights' o la página es muy nueva):`);
    console.log(`   ${insights.error.message}`);
  } else if (insights.data) {
    console.log('\n📈 Métricas de alcance e interacción (Últimos días disponibles):');
    insights.data.forEach(metric => {
      console.log(`\n👉 ${metric.title} (${metric.description}):`);
      // Mostrar el último valor disponible
      if (metric.values && metric.values.length > 0) {
        const lastValue = metric.values[metric.values.length - 1];
        console.log(`   Valor: ${lastValue.value} (Fecha: ${lastValue.end_time.split('T')[0]})`);
      }
    });
  }
}

main().catch(console.error);
