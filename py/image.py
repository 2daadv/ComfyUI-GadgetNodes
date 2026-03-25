from __future__ import annotations
import base64,hashlib,os,re,threading
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
                    "7:9", "9:7",    # SDXL素材
                    "9:16", "16:9",  # スマホ/YouTube
                    "9:21", "21:9",  # ウルトラワイド
                    "4:3", "3:4",    # 旧来モニタ
                    "Any"            # 自由
                ], {"default": "1:1"}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"}
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

    def crop(self, images, aspect_ratio, unique_id):
        images = unpack_images(images)
        aspect_ratio = unpack_list(aspect_ratio)

        m = hashlib.sha256()
        for img in images:
            m.update(img.tobytes())
        image_hash = m.hexdigest()

        total = len(images)
        preview_imgs = []
        
        # 1回目のプログレスバー：プレビュー生成
        pbar = comfy.utils.ProgressBar(total)
        for img in images:
            i = Image.fromarray(img) # unpack_imagesでuint8化済み
            i.thumbnail((512, 512), Image.Resampling.BOX) # 高速なBOXに変更
            buffer = BytesIO()
            i.save(buffer, format="WebP", quality=75)
            preview_imgs.append(f"data:image/webp;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}")
            pbar.update(1)

        session = {"results": None, "event_obj": threading.Event()}
        node_id = f"crop_{unique_id}"
        GADGET_SESSIONS[node_id] = session
        
        try:
            PromptServer.instance.send_sync("gadget.show_crop_dialog", {
                "node_id": node_id,
                "preview_images": preview_imgs,
                "aspect_ratio": aspect_ratio,
                "image_hash": image_hash
            })
            while not session["event_obj"].wait(timeout=1.0):
                if comfy.model_management.processing_interrupted():
                    PromptServer.instance.send_sync("gadget.close_crop_dialog", {"node_id": node_id})
                    return ([ExecutionBlocker(None)],)

            reply = session["results"]
            if reply == "CANCEL":
                return ([ExecutionBlocker(None)],)

            output_list = []
            # 2回目のプログレスバー：切り抜き処理
            pbar.update_absolute(0, total) 
            for i in range(total):
                if comfy.model_management.processing_interrupted():
                    return ([ExecutionBlocker(None)],)
                
                c = reply[i]
                img = images[i]
                h, w, _ = img.shape
                
                # クロップ座標計算
                x = max(0, min(int(c['x'] * w), w - 1))
                y = max(0, min(int(c['y'] * h), h - 1))
                cw = max(1, min(int(c['w'] * w), w - x))
                ch = max(1, min(int(c['h'] * h), h - y))
                
                cropped_np = img[y:y+ch, x:x+cw, :]
                # ComfyUI形式 [1, H, W, C] (0-1 float32) に戻す
                cropped_tensor = torch.from_numpy(cropped_np.astype(np.float32) / 255.0).unsqueeze(0)
                output_list.append(cropped_tensor)
                pbar.update(1)

            return (output_list,)
        finally:
            if node_id in GADGET_SESSIONS:
                del GADGET_SESSIONS[node_id]

@PromptServer.instance.routes.post("/gadget_nodes/image/crop_callback")
async def crop_callback(request):
    json_data = await request.json()
    node_id = json_data.get("node_id")

    if node_id in GADGET_SESSIONS:
        session = GADGET_SESSIONS[node_id]
        session["results"] = json_data.get("results")
        session["event_obj"].set() # このnode_idを待っているスレッドだけを再開
        return web.json_response({"status": "ok"})

    return web.json_response({"status": "error", "message": "Invalid or expired node_id"}, status=400)

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

        for file_path in valid_files:
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
            pbar.update(1)

        return (output_images,)

#=============================================================================
class ImageIndicesSelectorNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
            },
            "hidden": {"unique_id": "UNIQUE_ID"}
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("selected_indices",)
    FUNCTION = "run"
    CATEGORY = CATEGORY_IMAGE

    @classmethod
    def IS_CHANGED(s, **kwargs):
        return float("NaN")

    def run(self, images, unique_id):
        processed_images = unpack_images(images)
        total = len(processed_images)
        image_data_list = []
        hasher = hashlib.md5()
        pbar = comfy.utils.ProgressBar(total)
        
        for img_np in processed_images:
            if comfy.model_management.processing_interrupted():
                return (ExecutionBlocker(None),)

            img_pil = Image.fromarray(img_np)
            img_pil.thumbnail((512, 512), Image.Resampling.BOX) # 高速なBOXに変更
            
            buffered = BytesIO()
            img_pil.save(buffered, format="WebP", quality=75)
            img_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
            image_data_list.append({"src": f"data:image/webp;base64,{img_b64}"})
            hasher.update(img_b64[:100].encode())
            pbar.update(1)
        
        # JS側へ送信して同期待機
        # 待機状態の初期化
        session = {
            "result": None,
            "event_obj": threading.Event()
        }
        node_id = f"select_{unique_id}"
        GADGET_SESSIONS[node_id] = session
        try:
            PromptServer.instance.send_sync("gadget.show_selector", {
                "node_id": node_id,
                "images": image_data_list,
                "input_hash": hasher.hexdigest()
            })

            while not session["event_obj"].wait(timeout=1.0):
                if comfy.model_management.processing_interrupted():
                    return (ExecutionBlocker(None),)
            res = session["result"]

            # キャンセル時または中断時
            if res is None or res.get("cancelled"):
                return (ExecutionBlocker(None),)
            
            return (res.get("indices", ""),)
        finally:
            if node_id in GADGET_SESSIONS:
                del GADGET_SESSIONS[node_id]

@PromptServer.instance.routes.post("/gadget_nodes/image/select_callback")
async def select_callback(request):
    json_data = await request.json()
    node_id = json_data.get("node_id")
    
    if node_id in GADGET_SESSIONS:
        session = GADGET_SESSIONS[node_id]
        session["result"] = json_data
        session["event_obj"].set() # このnode_idを待っているスレッドだけを再開
        return web.json_response({"status": "ok"})
    
    return web.json_response({"status": "error", "message": "Invalid or expired node_id"}, status=400)