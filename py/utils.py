import base64
import numpy as np
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
                result.extend(item)
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
    # List入力を受け付けるノードで、IMAGESを引数に取る場合にComfyUIの仕様で次元が増えていることがあるので、不要な次元を削る。
    unpacked_images = []
    for img in images:
        # CPUのnumpy配列に変換（処理しやすくするため）
        img_np = img.cpu().numpy()
        # (1, 1, H, W, 3) などの余計な次元をすべて剥ぎ取る
        while img_np.ndim > 3:
            img_np = img_np[0]
        # もし (H, W, 3) に満たない（モノクロなど）場合はエラーを防ぐため再構築
        if img_np.ndim == 2:
            img_np = np.stack([img_np] * 3, axis=-1)
        unpacked_images.append(img_np)
    return unpacked_images

def unpack_list(any_list):
    # List入力を受け付けるノードでComfyUIの仕様で次元が増えていることがあるので、不要な次元を削る
    return any_list[0] if isinstance(any_list, list) else any_list