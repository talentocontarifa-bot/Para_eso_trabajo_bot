"""
Test ScrapeGraphAI integration for resilient e-commerce deal scraping.
Extracts product title, current price, original price, discount, and image
without relying on fragile CSS selectors.
"""
import os
import json
import sys

def scrape_with_ai_schema(html_content, gemini_api_key):
    """
    Simulates the ScrapeGraphAI pipeline using Gemini 2.5 Flash:
    Given raw HTML/text, extracts the structured deal schema.
    """
    import urllib.request
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
    
    prompt = f"""
    Eres un extractor de datos de e-commerce experto (como ScrapeGraphAI).
    A partir del siguiente fragmento HTML o texto de una página de producto, extrae un JSON estricto con los siguientes campos:
    - title: Título exacto y limpio del producto
    - price: Precio con descuento o precio actual (ej: "$499.00")
    - originalPrice: Precio anterior antes del descuento si existe (ej: "$999.00") o null
    - discount: Porcentaje o etiqueta de descuento (ej: "50% OFF") o null
    - imageUrl: URL de la imagen principal del producto si está visible
    - description: Resumen breve de 1 o 2 oraciones sobre el producto
    
    Responde ÚNICAMENTE con el objeto JSON válido, sin bloques markdown ni texto extra.
    
    CONTENIDO DE LA PÁGINA:
    {html_content[:15000]}
    """
    
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        text = res["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)

if __name__ == '__main__':
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(json.dumps({
            "status": "info",
            "message": "ScrapeGraphAI demo script created. Provide GEMINI_API_KEY to execute live AI extraction."
        }))
        sys.exit(0)
    
    sample_html = """
    <div class="poly-card">
      <h2 class="poly-component__title">Audífonos Inalámbricos Bluetooth 5.3 Pro Cancelación Ruido</h2>
      <div class="andes-money-amount--previous"><span class="andes-money-amount__fraction">1.299</span></div>
      <div class="andes-money-amount"><span class="andes-money-amount__fraction">599</span><span class="andes-money-amount__cents">50</span></div>
      <span class="andes-money-amount__discount">53% OFF</span>
      <img src="https://http2.mlstatic.com/D_NQ_NP_2X_789456-MLA.webp" class="poly-component__picture"/>
    </div>
    """
    print("Probando extracción estilo ScrapeGraphAI...")
    extracted = scrape_with_ai_schema(sample_html, api_key)
    print(json.dumps(extracted, indent=2, ensure_ascii=False))
