import io,yaml,base64
from PIL import Image
from pathlib import Path
from logging import getLogger

BASE_DIR = Path(__file__).resolve().parent.parent

logger = getLogger("GadgetNodes")

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
            buffered = io.BytesIO()
            # 内部処理はWebPに統一して軽量化
            img.save(buffered, format="WebP", quality=85)
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            return f"data:image/webp;base64,{img_str}"
    except:
        return None

