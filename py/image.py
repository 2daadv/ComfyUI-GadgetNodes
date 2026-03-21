from __future__ import annotations
import time,base64,hashlib,os,re
import comfy,comfy.utils
import torch
import numpy as np
from io import BytesIO
from PIL import Image,ImageOps
from aiohttp import web
from server import PromptServer
from comfy_execution.graph import ExecutionBlocker
from .utils import *

CATEGORY_IMAGE = "Gadget/image"

crop_results = {}

class ManualCropImagesNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",), 
                "aspect_ratio": ([
                    "1:1",           # 正方形
                    "4:5", "5:4",    # SNS/ポートレート
                    "2:3", "3:2",    # カメラ標準
                    "9:16", "16:9",  # スマホ/YouTube
                    "9:21", "21:9",  # ウルトラワイド
                    "4:3", "3:4",    # 旧来モニタ
                    "Any"            # 自由
                ], {"default": "1:1"}),
            },
            "hidden": {"node_id": "UNIQUE_ID"}
        }
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "crop"
    CATEGORY = CATEGORY_IMAGE

    @classmethod
    def IS_CHANGED(s, **kwargs):
        return float("NaN")

    def crop(self, images, aspect_ratio, node_id):
        images = unpack_images(images)
        aspect_ratio = unpack_list(aspect_ratio)
        node_id = unpack_list(node_id)

        m = hashlib.sha256()
        for img in images:
            m.update(img.tobytes())
        image_hash = m.hexdigest()

        preview_imgs = []
        for img in images:
            i = Image.fromarray((img * 255).astype('uint8'))
            i.thumbnail((400, 400))
            buffer = BytesIO()
            i.save(buffer, format="WebP", quality=85)
            preview_imgs.append(f"data:image/webp;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}")

        PromptServer.instance.send_sync("gadget.show_crop_dialog", {
            "node_id": node_id,
            "preview_images": preview_imgs,
            "aspect_ratio": aspect_ratio,
            "image_hash": image_hash
        })

        while node_id not in crop_results:
            if comfy.model_management.processing_interrupted():
                PromptServer.instance.send_sync("gadget.close_crop_dialog", {"node_id": node_id})
                if node_id in crop_results: del crop_results[node_id]
                return ([ExecutionBlocker(None)],)
            time.sleep(1.0)

        reply = crop_results.pop(node_id)
        if reply == "CANCEL":
            return ([ExecutionBlocker(None)],)

        output_list = []
        total = len(images)
        pbar = comfy.utils.ProgressBar(total)
        for i in range(total):
            if comfy.model_management.processing_interrupted():
                return ([ExecutionBlocker(None)],)
            c = reply[i]
            rx = c['x']
            ry = c['y']
            rw = c['w']
            rh = c['h']
            img = images[i]
            if rx < 0.001 and 0.999 < rw and ry < 0.001 and 0.999 < rh:
                output_list.append(torch.from_numpy(img).unsqueeze(0))
            else:
                h, w, _ = img.shape
                x = max(0, min(int(rx * w), w - 1))
                y = max(0, min(int(ry * h), h - 1))
                cw = max(1, min(int(rw * w), w - x))
                ch = max(1, min(int(rh * h), h - y))
                cropped_np = img[y:y+ch, x:x+cw, :]
                cropped_tensor = torch.from_numpy(cropped_np)
                output_list.append(cropped_tensor.unsqueeze(0))
            pbar.update_absolute(i + 1, total)

        return (output_list,)


@PromptServer.instance.routes.post("/gadget_nodes/image/crop_callback")
async def crop_callback(request):
    json_data = await request.json()
    node_id = json_data.get("node_id")
    results = json_data.get("results")
    crop_results[node_id] = results
    return web.json_response({"status": "ok"})

#=============================================================================
class LoadImagesFromFolderNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder": ("STRING",),
                "regex": ("STRING", {"default": r"(?i)\.(jpe?g|png|webp)$"}),
                "max_images": ("INT", {"default": 200, "min": 0, "max": 10000, "step": 1}),
                "recursive": ("BOOLEAN", {"default": False}),
            },
        }

    @classmethod
    def IS_CHANGED(s, folder, regex, max_images, recursive):
        if not os.path.isdir(folder):
            return float("NaN")
        p = Path(folder)
        files = list(p.rglob("*") if recursive else p.glob("*"))
        valid_files = [f for f in files if re.search(regex, f.name)]
        valid_files.sort(key=lambda x: x.name)
        valid_files = valid_files[:max_images]
        m = hashlib.md5()
        for f in valid_files:
            m.update(f"{f.name}{f.stat().st_mtime}".encode())
        m.update(str(max_images).encode())
        return m.hexdigest()

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "run"
    CATEGORY = CATEGORY_IMAGE

    def run(self, folder, regex, max_images, recursive):
        p = Path(folder)
        if not p.is_dir():
            raise FileNotFoundError(f"Directory not found: {folder}")

        files = list(p.rglob("*") if recursive else p.glob("*"))
        valid_files = [str(f) for f in files if re.search(regex, f.name)]
        valid_files.sort()
        if max_images > 0:
            valid_files = valid_files[:max_images]
        total = len(valid_files)

        output_images = []
        pbar = comfy.utils.ProgressBar(total)

        for i, file_path in enumerate(valid_files):
            if comfy.model_management.processing_interrupted():
                return ([ExecutionBlocker(None)],)
            try:
                img = Image.open(file_path)
                img = ImageOps.exif_transpose(img) # 向きを補正
                image = img.convert("RGB")
                
                # テンソル変換 [1, H, W, C]
                image = np.array(image).astype(np.float32) / 255.0
                image = torch.from_numpy(image)[None, :]
                output_images.append(image)
            except Exception as e:
                logger.error(f"[GadgetNodes] Failed to load {file_path}: {e}")
            pbar.update_absolute(i + 1, total)

        return (output_images,)
