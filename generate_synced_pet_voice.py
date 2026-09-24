import asyncio
import os
import sys
import json
import subprocess
import edge_tts

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

VOICE = "es-MX-JorgeNeural"
RATE = "+6%"

SCENES = [
    {
        "id": "scene_1",
        "type": "title",
        "text1": "SUPER OFERTA",
        "text2": "SONY WH-1000XM5",
        "voice_text": "¡Atención compradores! Encontramos un ofertón irresistible en Mercado Libre para los audífonos Sony WH-1000XM5.",
        "subtitle": "¡Super oferta en Mercado Libre! Sony WH-1000XM5."
    },
    {
        "id": "scene_2",
        "type": "product",
        "product_title": "Sony WH-1000XM5 Noise Cancelling",
        "key_points": [
            "Cancelación de Ruido Líder",
            "30 Horas de Batería y Carga Rápida",
            "Sonido Hi-Res con DSEE Extreme"
        ],
        "voice_text": "Cuentan con la mejor cancelación de ruido de la industria, treinta horas continuas de batería y envío rápido FULL.",
        "subtitle": "Cancelación de ruido líder, 30h de batería y envío FULL."
    },
    {
        "id": "scene_3",
        "type": "price",
        "discount_percentage": 40,
        "original_price": "8,999.00",
        "offer_price": "5,399.00",
        "voice_text": "Bajan de ocho mil novecientos noventa y nueve a solo cinco mil trescientos noventa y nueve pesos. ¡Un cuarenta por ciento de descuento!",
        "subtitle": "De $8,999 a solo $5,399 pesos. ¡40% de descuento!"
    },
    {
        "id": "scene_4",
        "type": "cta",
        "headline": "¡LINK EN BIO!",
        "voice_text": "¡Para eso trabajo! Consigue los tuyos antes de que se agoten tocando el enlace directo en nuestro perfil.",
        "subtitle": "¡Para eso trabajo! Toca el enlace en nuestra bio."
    }
]

def get_audio_duration(file_path):
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        file_path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return float(res.stdout.strip())

async def main():
    out_dir = os.path.join("video_pet", "temp_voice")
    os.makedirs(out_dir, exist_ok=True)

    scene_files = []
    current_time = 0.0
    timeline_scenes = []

    print("🎙️ Generando locución ad-hoc para Para Eso Trabajo (Sony WH-1000XM5)...")
    for idx, sc in enumerate(SCENES):
        fn = os.path.join(out_dir, f"scene_{idx+1}.mp3")
        comm = edge_tts.Communicate(sc["voice_text"], VOICE, rate=RATE)
        await comm.save(fn)
        dur = get_audio_duration(fn)
        scene_files.append(fn)

        sc_timing = {
            **sc,
            "start": round(current_time, 3),
            "audio_duration": round(dur, 3),
            "end": round(current_time + dur, 3)
        }
        timeline_scenes.append(sc_timing)
        print(f"  ✓ Escena {idx+1}: [{sc_timing['start']}s -> {sc_timing['end']}s] ({dur:.2f}s) - \"{sc['subtitle']}\"")
        current_time += dur + 0.20 # 200ms pausa natural entre escenas comerciales

    total_duration = current_time + 0.5
    total_duration_sec = int(round(total_duration))
    print(f"\n⏱️ Duración total de locución comercial: {total_duration:.2f}s (~{total_duration_sec}s)")

    # Concatenar audios con ffmpeg
    concat_list_file = os.path.join(out_dir, "concat_list.txt")
    with open(concat_list_file, "w", encoding="utf-8") as f:
        for fn in scene_files:
            abs_path = os.path.abspath(fn).replace("\\", "/")
            f.write(f"file '{abs_path}'\n")

    merged_voice_path = os.path.join("video_pet", "public", "voice.mp3")
    concat_cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", concat_list_file,
        "-c", "copy",
        merged_voice_path
    ]
    subprocess.run(concat_cmd, check=True)
    print(f"✅ Archivo maestro de voz comercial guardado en {merged_voice_path}")

    # Guardar deal_data.js y deal_data.json
    deal_data = {
        "theme_color": "#FFE600",
        "product_title": "Sony WH-1000XM5 Noise Cancelling",
        "discount_percentage": 40,
        "original_price": "8,999.00",
        "offer_price": "5,399.00",
        "key_points": [
            "Cancelación de Ruido Líder",
            "30 Horas de Batería y Carga Rápida",
            "Sonido Hi-Res con DSEE Extreme"
        ],
        "total_duration_sec": total_duration_sec,
        "total_frames": total_duration_sec * 30,
        "scenes": timeline_scenes
    }

    js_file = os.path.join("video_pet", "deal_data.js")
    with open(js_file, "w", encoding="utf-8") as f:
        f.write(f"window.DEAL_DATA = {json.dumps(deal_data, indent=2, ensure_ascii=False)};\n")

    json_file = os.path.join("video_pet", "src", "deal_data.json")
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(deal_data, f, indent=2, ensure_ascii=False)

    # Actualizar hyperframes.json
    hf_config_file = os.path.join("video_pet", "hyperframes.json")
    with open(hf_config_file, "r", encoding="utf-8") as f:
        hf_config = json.load(f)
    if "compositions" not in hf_config:
        hf_config["compositions"] = [{
            "id": "main",
            "source": "index.html",
            "width": 1080,
            "height": 1920,
            "duration": total_duration_sec,
            "fps": 30
        }]
    else:
        hf_config["compositions"][0]["duration"] = total_duration_sec
    with open(hf_config_file, "w", encoding="utf-8") as f:
        json.dump(hf_config, f, indent=2)
    print(f"✅ hyperframes.json actualizado con duration={total_duration_sec}s.")

if __name__ == "__main__":
    asyncio.run(main())
