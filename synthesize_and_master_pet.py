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

# Voz femenina mexicana con alta energía comercial
VOICE = "es-MX-DaliaNeural"
RATE = "+10%" # Cadencia ágil comercial

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

def master_voice_clip(input_path, output_path):
    # Cadena de masterización vocal Broadcast:
    # 1. Highpass 80Hz (eliminar rumble de fondo)
    # 2. Equalizer 140Hz +3.5dB (cuerpo y calidez de micrófono)
    # 3. Equalizer 3600Hz +4.0dB (presencia y brillo de consonantes en altavoces móviles)
    # 4. Compressor (reducir rango dinámico y aumentar densidad)
    # 5. Loudnorm (normalización a -14 LUFS estándar TikTok/Reels)
    filter_chain = (
        "highpass=f=80,"
        "equalizer=f=140:width_type=h:width=60:g=3.5,"
        "equalizer=f=3600:width_type=h:width=1200:g=4.0,"
        "acompressor=threshold=-16dB:ratio=4:attack=10:release=120:makeup=2.5dB,"
        "loudnorm=I=-14:TP=-1.0:LRA=7"
    )
    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-af", filter_chain,
        "-c:a", "libmp3lame", "-b:a", "192k",
        output_path
    ]
    subprocess.run(cmd, capture_output=True, check=True)

async def main():
    temp_dir = os.path.join("video_pet", "temp_voice")
    os.makedirs(temp_dir, exist_ok=True)

    print(f"🎙️ Generando locución mejorada con {VOICE} ({RATE}) y Masterización de Estudio...")
    mastered_files = []
    current_time = 0.0
    timeline_scenes = []

    for idx, sc in enumerate(SCENES):
        raw_file = os.path.join(temp_dir, f"scene_{idx+1}_raw.mp3")
        mastered_file = os.path.join(temp_dir, f"scene_{idx+1}_mastered.mp3")

        # 1. Síntesis Edge-TTS con velocidad comercial
        comm = edge_tts.Communicate(sc["voice_text"], VOICE, rate=RATE)
        await comm.save(raw_file)

        # 2. Masterización vocal con FFmpeg
        master_voice_clip(raw_file, mastered_file)
        dur = get_audio_duration(mastered_file)
        mastered_files.append(mastered_file)

        sc_timing = {
            **sc,
            "start": round(current_time, 3),
            "audio_duration": round(dur, 3),
            "end": round(current_time + dur, 3)
        }
        timeline_scenes.append(sc_timing)
        print(f"  ✓ Escena {idx+1}: [{sc_timing['start']}s -> {sc_timing['end']}s] ({dur:.2f}s) - \"{sc['subtitle']}\"")
        current_time += dur + 0.18 # 180ms de pausa natural

    total_duration = current_time + 0.4
    total_duration_sec = int(round(total_duration))
    print(f"\n⏱️ Duración total ajustada: {total_duration:.2f}s (~{total_duration_sec}s)")

    # 3. Concatenar locución final
    concat_list = os.path.join(temp_dir, "concat_list.txt")
    with open(concat_list, "w", encoding="utf-8") as f:
        for fn in mastered_files:
            abs_p = os.path.abspath(fn).replace("\\", "/")
            f.write(f"file '{abs_p}'\n")

    final_voice = os.path.join("video_pet", "public", "voice.mp3")
    concat_cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c:a", "libmp3lame", "-b:a", "192k",
        final_voice
    ]
    subprocess.run(concat_cmd, capture_output=True, check=True)
    print(f"✅ Voz masterizada guardada en {final_voice}")

    # 4. Preparar música con Audio Ducking dinámico (Sidechain Compression)
    # Usamos la nueva música comercial alegre Electrodoodle
    music_src = os.path.join("video_pet", "public", "music_electrodoodle.mp3")
    ducked_music = os.path.join("video_pet", "public", "bg_music.mp3")
    
    # Filtro de Sidechain: Cuando habla la voz, la música baja a ~10-12%, en silencios y final sube a ~35%
    print("🎵 Procesando Audio Ducking sobre la nueva pista musical...")
    ducking_filter = (
        f"[1:a]aformat=channel_layouts=stereo:sample_rates=48000[sc];"
        f"[0:a]atrim=0:{total_duration_sec},aformat=channel_layouts=stereo:sample_rates=48000[music];"
        f"[music][sc]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=350,volume=0.40[final_music]"
    )
    duck_cmd = [
        "ffmpeg", "-y",
        "-i", music_src,
        "-i", final_voice,
        "-filter_complex", ducking_filter,
        "-map", "[final_music]",
        "-c:a", "libmp3lame", "-b:a", "192k",
        ducked_music
    ]
    subprocess.run(duck_cmd, capture_output=True, check=True)
    print(f"✅ Música con Sidechain Ducking guardada en {ducked_music}")

    # 5. Actualizar deal_data.js y deal_data.json
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

    with open(os.path.join("video_pet", "deal_data.js"), "w", encoding="utf-8") as f:
        f.write(f"window.DEAL_DATA = {json.dumps(deal_data, indent=2, ensure_ascii=False)};\n")

    with open(os.path.join("video_pet", "src", "deal_data.json"), "w", encoding="utf-8") as f:
        json.dump(deal_data, f, indent=2, ensure_ascii=False)

    # Actualizar hyperframes.json
    hf_config_file = os.path.join("video_pet", "hyperframes.json")
    with open(hf_config_file, "r", encoding="utf-8") as f:
        hf_config = json.load(f)
    hf_config["compositions"][0]["duration"] = total_duration_sec
    with open(hf_config_file, "w", encoding="utf-8") as f:
        json.dump(hf_config, f, indent=2)

    print(f"🎉 Pipeline de audio completado. Duración video: {total_duration_sec}s")

if __name__ == "__main__":
    asyncio.run(main())
