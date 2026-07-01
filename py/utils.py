import base64,re,requests,fast_langdetect,os,torch
import numpy as np
import folder_paths
from enum import StrEnum
from transformers import pipeline,AutoModelForCausalLM,AutoTokenizer
from functools import lru_cache
from urllib.parse import quote
from io import BytesIO
from PIL import Image
from pathlib import Path
from logging import getLogger

BASE_DIR = Path(__file__).resolve().parent.parent
GADGET_SESSIONS = {}

logger = getLogger("ComfyUI.GadgetNodes")

class AnyType(str):
    def __eq__(self, _):
        return True

    def __ne__(self, _):
        return False

any_type = AnyType("*")

def flatten(any_list:list):
    result = []
    if any_list:
        for item in any_list:
            if isinstance(item, list):
                result.extend(flatten(item))
            else:
                result.append(item)
    return result

def get_image_mimetype(file_path):
    """バイナリヘッダーからMIMEタイプを判別する"""
    try:
        with open(file_path, "rb") as f:
            header = f.read(12)
            if header.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
            if header.startswith(b"\xff\xd8\xff"): return "image/jpeg"
            if header.startswith(b"RIFF") and header[8:12] == b"WEBP": return "image/webp"
    except: pass
    return None

def process_thumbnail(img_path, max_size=(300, 300)):
    """画像をリサイズしてBase64化する"""
    try:
        with Image.open(img_path) as img:
            img.thumbnail(max_size)
            buffer = BytesIO()
            # 内部処理はWebPに統一して軽量化
            img.save(buffer, format="WebP", quality=85)
            img_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
            return f"data:image/webp;base64,{img_str}"
    except:
        return None

def unpack_images(images):
    unpacked_images = []
    for img in images:
        # 4次元テンソル [B, H, W, C] であることを前提に処理
        if img.ndim == 4:
            for i in range(img.shape[0]):
                # 1枚ずつ取り出して numpy 化
                img_np = img[i].cpu().numpy()
                unpacked_images.append(ensure_rgb(img_np))
        elif img.ndim == 3:
            unpacked_images.append(ensure_rgb(img.cpu().numpy()))
        else:
            # 想定外の次元（(1,1,H,W,C)など）は squeeze で標準的な形を試みる
            img_squeezed = img.squeeze()
            if img_squeezed.ndim >= 2:
                unpacked_images.append(ensure_rgb(img_squeezed.cpu().numpy()))
    return unpacked_images

def ensure_rgb(img_np):
    # 1. (H, W) の 2次元配列なら (H, W, 3) に拡張
    if img_np.ndim == 2:
        img_np = np.stack([img_np] * 3, axis=-1)
    # 2. 3次元配列の場合のチャンネル処理
    elif img_np.ndim == 3:
        ch = img_np.shape[-1]
        if ch == 1: # (H, W, 1) -> (H, W, 3)
            img_np = np.concatenate([img_np] * 3, axis=-1)
        elif ch == 4: # (H, W, 4) -> (H, W, 3)
            img_np = img_np[:, :, :3]
        elif ch != 3:
            # 万が一 2ch や 5ch 以上が来た場合、無理やり 3ch に調整（エラー防止）
            img_np = img_np[:, :, :3] if ch > 3 else np.pad(img_np, ((0,0),(0,0),(0, 3-ch)))
    return img_np

def unpack_list(any_list):
    # 1. リストではない（既に展開済み）ならそのまま返す
    if not isinstance(any_list, list):
        return any_list
    
    # 2. リストのリストになっており、かつ外側が長さ1なら、中身を取り出す
    # これにより [ ["1:1", "4:5"] ] -> ["1:1", "4:5"] となり、リスト構造が維持される
    if len(any_list) == 1 and isinstance(any_list[0], list):
        return any_list[0]
        
    # 3. 単なるリスト [ "1:1" ] などの場合は、最初の要素を返す（現在の実装の意図）
    # ただし、これが「画像処理のパラメータ」なら [0] で良いですが、
    # 「複数の画像を処理する」ノードなら、リストのまま扱うべき局面もあります。
    return any_list[0] if len(any_list) > 0 else any_list

class TranslateEngine(StrEnum):
    NONE = ("None", False,)
    # https://github.com/Tencent-Hunyuan/Hy-MT2
    HY_MT2 =("tencent/Hy-MT2-1.8B", True, False, "你是一位专业的翻译官。请将用户的输入翻译成地道的英语。")
    #TRANSLATE_GEMMA="google/translategemma-4b-it" # 規約同意が必要なためカスタムノードには向かない
    GOOGLE=("Google", False,)

    def __new__(cls, value:str, is_llm:bool=True, is_quantized:bool=False, prompt:str=None):
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.is_llm = is_llm
        obj.is_quantized = is_quantized
        obj.prompt = prompt
        return obj

def translate_to_english(text:str, engine:TranslateEngine) -> str:
    if not text or not text.strip():
        return ""
    try:
        src_lang = detect_language(text)
        if src_lang == "en":
            return text
        en = text
        if engine.is_llm:
            en = translate_to_english_by_llm(engine, src_lang, text)
        elif engine == TranslateEngine.GOOGLE:
            en = translate_to_english_by_google(text)
        logger.info(f"[GadgetNodes] '{text}' was translated as '{en}' by {engine}")
        return en
    except Exception as e:
        logger.ex(f"[GadgetNodes] {engine} translation failed for '{text}': {e}")
    return text

@lru_cache(maxsize=100)
def translate_to_english_by_llm(engine:TranslateEngine, src_lang:str, text:str) -> str:
    engine_obj = get_translate_engine(engine, src_lang, "en")
    messages = [
        {"role": "system", "content": engine.prompt},
        {"role": "user", "content": text}
    ]
    result = engine_obj(messages, max_new_tokens=len(text) * 2, temperature=0.1)
    return result[0]['generated_text'][-1]['content']

@lru_cache(maxsize=100)
def translate_to_english_by_google(text:str) -> str:
    #googletransというライブラリもあるっぽいが、一応自前で実装。
    url = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=en&q=" + quote(text)
    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=10
    )
    response.raise_for_status()
    data = response.json()
    if isinstance(data, list) and data and isinstance(data[0], list) and data[0]:
        return data[0][0]
    raise ValueError("Unsupported response data structure.")

@lru_cache(maxsize=100)
def detect_language(text:str) -> str:
    lang = fast_langdetect.detect(text, model="lite")[0]['lang']
    logger.info(f"[GadgetNodes] Detected language: {lang}")
    return lang

LLM_DIR=os.path.join(folder_paths.models_dir, "llm")

@lru_cache(maxsize=1)
def get_translate_engine(engine:TranslateEngine, src_lang:str, tgt_lang:str):
    config = {
        "pretrained_model_name_or_path": engine,
        "cache_dir": LLM_DIR,
        "trust_remote_code": True,
        "local_files_only": os.path.exists(os.path.join(LLM_DIR, f"models--{engine.replace('/', '--')}")),
    }
    quantization_config = {
        "load_in_4bit": True,
        "bnb_4bit_compute_dtype": torch.bfloat16,
        "bnb_4bit_quant_type": "nf4",
        "bnb_4bit_use_double_quant": True,
    } if engine.is_quantized else {}
    # modelとtokenizerはpipelineの外で定義しないと、正確に動作しない。
    model = AutoModelForCausalLM.from_pretrained(torch_dtype=torch.bfloat16, device_map="auto", **quantization_config, **config)
    tokenizer = AutoTokenizer.from_pretrained(**config)
    return pipeline("text-generation", model=model, tokenizer=tokenizer)

def has_word(prompt:str, word:str) -> bool:
    pattern = rf"(^|,\s*){word}($|\s*,)"
    return bool(re.search(pattern, prompt))

def has_any_words(prompt:str, words:tuple[str, ...]) -> bool:
    pattern = rf"(^|,\s*)({'|'.join(words)})($|\s*,)"
    return bool(re.search(pattern, prompt))
