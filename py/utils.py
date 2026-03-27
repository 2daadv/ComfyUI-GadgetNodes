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