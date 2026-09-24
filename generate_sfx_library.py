import os
import sys
import math
import struct
import wave
import subprocess

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

def create_pop(wav_path):
    sample_rate = 44100
    duration = 0.08
    n_samples = int(sample_rate * duration)
    with wave.open(wav_path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        for i in range(n_samples):
            t = i / sample_rate
            freq = 750 - 550 * (t / duration)
            env = math.sin(math.pi * (t / duration)) ** 1.3
            val = math.sin(2 * math.pi * freq * t) * env
            data = struct.pack('<h', int(val * 28000))
            f.writeframesraw(data)

def create_ding(wav_path):
    sample_rate = 44100
    duration = 0.6
    n_samples = int(sample_rate * duration)
    with wave.open(wav_path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        for i in range(n_samples):
            t = i / sample_rate
            env = math.exp(-6 * t)
            val = (0.7 * math.sin(2 * math.pi * 1760 * t) + 0.3 * math.sin(2 * math.pi * 3520 * t)) * env
            data = struct.pack('<h', int(val * 26000))
            f.writeframesraw(data)

def create_cash(wav_path):
    sample_rate = 44100
    duration = 0.8
    n_samples = int(sample_rate * duration)
    with wave.open(wav_path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        for i in range(n_samples):
            t = i / sample_rate
            env = math.exp(-4.2 * t)
            val = (0.45 * math.sin(2 * math.pi * 1318.5 * t) + 
                   0.35 * math.sin(2 * math.pi * 1975.5 * t) + 
                   0.20 * math.sin(2 * math.pi * 2637.0 * t)) * env
            data = struct.pack('<h', int(val * 27000))
            f.writeframesraw(data)

def create_whoosh(wav_path):
    import random
    sample_rate = 44100
    duration = 0.35
    n_samples = int(sample_rate * duration)
    last = 0.0
    with wave.open(wav_path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        for i in range(n_samples):
            t = i / sample_rate
            env = math.sin(math.pi * (t / duration)) ** 2
            noise = random.uniform(-1, 1)
            alpha = 0.08 + 0.28 * math.sin(math.pi * (t / duration))
            last = last + alpha * (noise - last)
            val = last * env * 2.8
            data = struct.pack('<h', max(-32767, min(32767, int(val * 26000))))
            f.writeframesraw(data)

def wav_to_mp3(wav_path, mp3_path):
    cmd = [
        "ffmpeg", "-y", "-i", wav_path,
        "-c:a", "libmp3lame", "-b:a", "192k",
        mp3_path
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    if os.path.exists(wav_path):
        os.remove(wav_path)

def generate_pack(target_dir):
    os.makedirs(target_dir, exist_ok=True)
    effects = [
        ("whoosh", create_whoosh),
        ("pop", create_pop),
        ("cash", create_cash),
        ("ding", create_ding)
    ]
    for name, func in effects:
        wav = os.path.join(target_dir, f"{name}.wav")
        mp3 = os.path.join(target_dir, f"{name}.mp3")
        func(wav)
        wav_to_mp3(wav, mp3)
        print(f"  ✓ SFX generado: {mp3}")

if __name__ == "__main__":
    pet_sfx = os.path.join("video_pet", "public", "sfx")
    tct_sfx = os.path.join("..", "talento_con_tarifa_bot", "video_tct", "public", "sfx")

    print("🔊 Generando biblioteca de efectos de sonido (SFX)...")
    generate_pack(pet_sfx)
    if os.path.exists(os.path.dirname(tct_sfx)):
        generate_pack(tct_sfx)
    print("✅ Efectos de sonido generados con éxito!")
