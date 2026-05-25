import sys
import json
import argparse
from scrapling.fetchers import StealthyFetcher

def clean_text(text):
    if text:
        return text.strip()
    return None

def extract_product(url):
    try:
        page = StealthyFetcher.fetch(url, headless=True)
        
        title = clean_text(page.css('h1::text').get() or page.css('title::text').get())
        
        og_image = page.css('meta[property="og:image"]::attr(content)').get() or page.css('meta[name="twitter:image"]::attr(content)').get()
        og_desc = page.css('meta[property="og:description"]::attr(content)').get() or page.css('meta[name="description"]::attr(content)').get()
        
        price = None
        original_price = None
        discount = None
        description = og_desc or ''
        
        if 'mercadolibre' in url.lower():
            card = page.css('.poly-card')
            if card:
                title_el = card.css('.poly-component__title::text, h2::text, h3::text').get()
                if title_el:
                    title = clean_text(title_el)
                    
                img_el = card.css('img.poly-component__picture::attr(src), img.poly-component__picture::attr(data-src), img::attr(src)').get()
                if img_el:
                    og_image = img_el
                    
                prev_price = card.css('.andes-money-amount--previous .andes-money-amount__fraction::text').get()
                if prev_price:
                    original_price = f"${clean_text(prev_price).replace('.', '')}"
                    
                curr_price = card.css('.andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction::text').get()
                curr_cents = card.css('.andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__cents::text').get()
                if curr_price:
                    cents_str = f".{clean_text(curr_cents)}" if curr_cents else ""
                    price = f"${clean_text(curr_price).replace('.', '')}{cents_str}"
                    
                discount_el = card.css('.andes-money-amount__discount::text, [class*="discount"]::text').get()
                if discount_el:
                    discount = clean_text(discount_el)
                description = 'Oferta recomendada en el perfil social de Mercado Libre.'
            else:
                price_fraction = page.css('.ui-pdp-price__second-line .andes-money-amount__fraction::text, .andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction::text').get()
                price_cents = page.css('.ui-pdp-price__second-line .andes-money-amount__cents::text, .andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__cents::text').get()
                if price_fraction:
                    cents_str = f".{clean_text(price_cents)}" if price_cents else ""
                    price = f"${clean_text(price_fraction).replace('.', '')}{cents_str}"
                    
                orig_fraction = page.css('.ui-pdp-price__original-value .andes-money-amount__fraction::text, .andes-money-amount--previous .andes-money-amount__fraction::text').get()
                orig_cents = page.css('.ui-pdp-price__original-value .andes-money-amount__cents::text, .andes-money-amount--previous .andes-money-amount__cents::text').get()
                if orig_fraction:
                    cents_str = f".{clean_text(orig_cents)}" if orig_cents else ""
                    original_price = f"${clean_text(orig_fraction).replace('.', '')}{cents_str}"
                    
                discount_el = page.css('.ui-pdp-price__discount::text, .andes-money-amount__discount::text').get()
                if discount_el:
                    discount = clean_text(discount_el)
                    
                desc_el = page.css('.ui-pdp-description__content::text').get()
                if desc_el:
                    description = clean_text(desc_el)
        else:
            meta_price = page.css('meta[property="og:price:amount"]::attr(content)').get()
            if meta_price:
                meta_currency = page.css('meta[property="og:price:currency"]::attr(content)').get() or 'MXN'
                price = f"${clean_text(meta_price)} {clean_text(meta_currency)}"
        
        if not discount and price and original_price:
            try:
                import re
                clean_p = float(re.sub(r'[^\d.]', '', price))
                clean_op = float(re.sub(r'[^\d.]', '', original_price))
                if clean_op > clean_p:
                    discount_pct = round(((clean_op - clean_p) / clean_op) * 100)
                    discount = f"{discount_pct}% OFF"
            except Exception:
                pass

        result = {
            "title": title or '',
            "price": price,
            "originalPrice": original_price,
            "discount": discount,
            "description": description or '',
            "imageUrl": og_image,
            "success": True,
            "method": "scrapling"
        }
        return result
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    data = extract_product(args.url)
    print(json.dumps(data, ensure_ascii=False))
