from __future__ import annotations
import time,base64,hashlib
import comfy
from io import BytesIO
from PIL import Image
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
    OUTPUT_IS_LIST = (True, )
    FUNCTION = "crop"
    CATEGORY = CATEGORY_IMAGE

    @classmethod
    def IS_CHANGED(s, **kwargs):
        return float("NaN")

    def crop(self, images, aspect_ratio, node_id):
        m = hashlib.sha256()
        for img in images:
            m.update(img.cpu().numpy().tobytes())
        image_hash = m.hexdigest()

        preview_imgs = []
        for img in images:
            i = Image.fromarray((img.cpu().numpy() * 255).astype('uint8'))
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
        for i in range(len(images)):
            img = images[i]
            h, w, _ = img.shape
            c = reply[i]
            x, y = int(c['x'] * w), int(c['y'] * h)
            cw, ch = int(c['w'] * w), int(c['h'] * h)
            output_list.append(img[y:y+ch, x:x+cw, :].unsqueeze(0))

        return (output_list,)


@PromptServer.instance.routes.post("/gadget_nodes/image/crop_callback")
async def crop_callback(request):
    json_data = await request.json()
    node_id = json_data.get("node_id")
    results = json_data.get("results")
    crop_results[node_id] = results
    return web.json_response({"status": "ok"})
