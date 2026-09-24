# Plantilla Para eso trabajo

El workflow existente sigue ejecutando `node create_daily_news.js`. Al terminar, el generador llama a `build_template.js`, que produce `index.html` con los datos de `src/deal_data.json`. El render y `publish_video.js` conservan sus rutas.

## Editar

- `template.config.json`: paleta, gancho, CTA, música, volumen de efectos y tiempo de cierre.
- `template.html.txt`: base de diseño, fuentes y marca. No editar `index.html`: se regenera.
- `build_template.js`: distribución adaptable, escenas, tiempos y pistas.
- `public/product.png`: foto descargada por el generador, completa, sin mezcla de color ni recorte de fondo.
- `public/music_electrodoodle.mp3` y `public/sfx/`: recursos existentes. Los opcionales ausentes se omiten.

Para reconstruir con los datos actuales: `node build_template.js`. Para pruebas: `node --test template.test.js`. Verificar con `npx hyperframes check` antes de renderizar.

Los tiempos se calculan sumando `audio_duration` porque la voz actual concatena los fragmentos sin silencios. Se comprueba la duración con ffprobe. La música usa una envolvente de entrada/salida y volumen bajo; los efectos siguen las escenas, sin marcas fijas en segundos. El precio se revela al principio de su escena: no hay alineación por palabra.

Esta integración no cambia selección de ofertas, scraping, proveedores de IA ni publicación. Las políticas de precios y fallbacks del generador original se conservan. Los datos Sony son una muestra existente, no precios verificados hoy.
