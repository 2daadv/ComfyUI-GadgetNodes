from __future__ import annotations
import os,yaml
from .utils import *
from server import PromptServer
from aiohttp import web
import torch
import numpy as np
from PIL import Image, ImageOps

CATEGORY_TRAIN = "Gadget/train"
TRAIN_CONFIG_FILE_PATH = BASE_DIR / "train_config.yaml"

def load_train_config():
    try:
        with open(TRAIN_CONFIG_FILE_PATH, 'r', encoding='utf-8') as file:
            return yaml.safe_load(file) or {}
    except Exception:
        logger.exception(f"[GadgetNodes] Can't read {TRAIN_CONFIG_FILE_PATH}.")
    return {}

train_config = load_train_config()

class TrainTagsEditNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder": ("STRING", {"default": ""}),
                "image_file_name": ([],),
            },
            "optional": {
                "keep_tags": ("STRING", {"default": "", "multiline": True}),
                "remove_tags": ("STRING", {"default": "", "multiline": True}),
            },
        }
    RETURN_TYPES = ("STRING","STRING","IMAGE",)
    RETURN_NAMES = ("folder","image_file_path","image")
    FUNCTION = "run"
    CATEGORY = CATEGORY_TRAIN

    @classmethod
    def VALIDATE_INPUTS(s, folder, image_file_name, **kwargs):
        if not folder:
            return "Folder path is required."
        if not image_file_name:
            return "Image file name is required."

        # image_file_name がリストで届く場合の処理
        image_file_name = unpack_list(image_file_name)
        if not image_file_name:
            return "Image file name is empty."

        # 2. ファイルの実在チェック
        full_path = os.path.join(folder, image_file_name)
        if not os.path.exists(full_path):
            return f"File not found: {full_path}"

        return True

    def run(self, folder, image_file_name, keep_tags="", remove_tags=""):
        image_file_name = unpack_list(image_file_name)
        full_path = os.path.join(folder, image_file_name)

        # 2. 画像の読み込みとテンソル変換
        img = Image.open(full_path)
        img = ImageOps.exif_transpose(img) # 方向情報を補正
        image = img.convert("RGB")

        # ComfyUIの標準形式 [Batch=1, Height, Width, Channels] に変換
        image = np.array(image).astype(np.float32) / 255.0
        image = torch.from_numpy(image)[None, ...]

        # 3. 戻り値の返却
        # WD14Taggerなどのノードには "image" 出力を接続します
        return (folder, full_path, image,)


@PromptServer.instance.routes.get("/gadget_nodes/train/get_images")
async def get_images(request):
    folder = request.query.get("folder", "")
    if not os.path.isdir(folder): return web.json_response({"files": []})
    files = [f for f in os.listdir(folder) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and not f.endswith(train_config.get("mask_image_postfix", "-masklabel.png"))]
    return web.json_response({"files": sorted(files)})

@PromptServer.instance.routes.get("/gadget_nodes/train/get_data")
async def get_data(request):
    folder, filename = request.query.get("folder", ""), request.query.get("filename", "")
    base_name = os.path.splitext(filename)[0]
    def get_b64(path):
        if os.path.exists(path):
            with open(path, "rb") as f: return f"data:image/png;base64,{base64.b64encode(f.read()).decode('utf-8')}"
        return None
    
    blacklist = train_config.get("black_list_tag", [])
    tags = []
    t_path = os.path.join(folder, base_name + ".txt")
    if os.path.exists(t_path):
        with open(t_path, "r", encoding="utf-8") as f:
            tags = [t.strip() for t in f.read().split(",") if t.strip()]
            tags = list(dict.fromkeys(tags))

    return web.json_response({"img": get_b64(os.path.join(folder, filename)), "mask": get_b64(os.path.join(folder, base_name + "-masklabel.png")), "tags": tags, "blacklist": blacklist})

@PromptServer.instance.routes.post("/gadget_nodes/train/save_tags")
async def save_tags(request):
    data = await request.json()
    path = os.path.join(data['folder'], os.path.splitext(data['filename'])[0] + ".txt")
    with open(path, "w", encoding="utf-8") as f: f.write(data['tags'])
    return web.json_response({"status": "ok"})

#---------------------------------------------------
