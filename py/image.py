from __future__ import annotations
import base64,hashlib,os,re,threading,math
import torch.nn.functional as F
import comfy,comfy.utils
import torch
import numpy as np
from io import BytesIO
from PIL import Image,ImageOps,ImageFilter
from aiohttp import web
from server import PromptServer
from comfy_execution.graph import ExecutionBlocker
from .utils import *

CATEGORY_IMAGE = "Gadget/image"
ASPECT_RATIO_OPTIONS = [
                    "4:5",
                    "7:9",
                    "3:4",
                    "2:3",
                    "9:16",
                    "9:21",
                    "1:1",
                    "5:4",
                    "9:7",
                    "4:3",
                    "3:2",
                    "16:9",
                    "21:9",
                    "Any"
                ]

class ManualCropImagesNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",), 
                "aspect_ratio": (ASPECT_RATIO_OPTIONS, {"default": "1:1"}),
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
        m.update(aspect_ratio.encode())
        image_hash = m.hexdigest()

        total = len(images)
        preview_imgs = []

        # 1回目のプログレスバー：プレビュー生成
        pbar = comfy.utils.ProgressBar(total)
        for img in images:
            i = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
            i.thumbnail((512, 512), Image.Resampling.BILINEAR)
            i = i.filter(ImageFilter.SHARPEN)
            buffer = BytesIO()
            i.save(buffer, format="WebP", quality=85, method=6)
            preview_imgs.append(f"data:image/webp;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}")
            pbar.update(1)

        session = {"results": None, "event_obj": threading.Event()}
        node_id = f"crop_{unpack_list(unique_id)}"
        GADGET_SESSIONS[node_id] = session

        try:
            PromptServer.instance.send_sync("gadget.show_crop_dialog", {
                "node_id": node_id,
                "preview_images": preview_imgs,
                "default_aspect_ratio": aspect_ratio,
                "aspect_ratio_options": ASPECT_RATIO_OPTIONS,
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
                cropped_tensor = torch.from_numpy(cropped_np).unsqueeze(0)
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

            img_pil = Image.fromarray((np.clip(img_np, 0, 1) * 255).astype(np.uint8))
            img_pil.thumbnail((512, 512), Image.Resampling.BILINEAR)
            img_pil = img_pil.filter(ImageFilter.SHARPEN)

            buffered = BytesIO()
            img_pil.save(buffered, format="WebP", quality=85, method=6)
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
        node_id = f"select_{unpack_list(unique_id)}"
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

#=============================================================================
class SmartResizeImageNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "target_pixels": ("INT", {"default": 1048576, "min": 64, "max": 16777216, "step": 64}),
                "divisible_by": ("INT", {"default": 64, "min": 8, "max": 128, "step": 8}),
                "distortion_threshold": ("FLOAT", {"default": 0.005, "min": 0.0, "max": 0.1, "step": 0.001}),
                "crop_position": (["auto", "center", "left", "right", "top", "bottom"], {"default": "auto"}),
                "upscale_to": (["target_pixels", "match_divisible_by"], {"default": "match_divisible_by"}),
                "upscale_method": (["bicubic", "lanczos", "area"], {"default": "bicubic"}),
            }
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("images", "widths", "heights")
    OUTPUT_IS_LIST = (True, True, True)
    FUNCTION = "resize_images"
    CATEGORY = CATEGORY_IMAGE

    def resize_images(self, images, target_pixels, divisible_by, distortion_threshold, crop_position, upscale_to, upscale_method):
        # 共通部品を使用してリストを平坦化 (結果は uint8 numpy [H, W, 3] のリスト)
        flat_images_np = unpack_images(images)
        total_images = len(flat_images_np)
        target_pixels = unpack_list(target_pixels)
        divisible_by = unpack_list(divisible_by)
        distortion_threshold = unpack_list(distortion_threshold)
        crop_position = unpack_list(crop_position)
        upscale_to = unpack_list(upscale_to)
        upscale_method = unpack_list(upscale_method)

        out_images = []
        out_widths = []
        out_heights = []

        pbar = comfy.utils.ProgressBar(total_images)

        for i, img_np in enumerate(flat_images_np):
            if comfy.model_management.processing_interrupted():
                return (([ExecutionBlocker(None)],), ([],), ([],))

            # numpy [H, W, 3] (uint8) -> torch [1, H, W, 3] (float32, 0-1)
            img = torch.from_numpy(img_np)
            if img.dtype != torch.float32:
                img = img.float() / 255.0
            img = img.unsqueeze(0) # [1, H, W, 3]

            _, old_h, old_w, _ = img.shape
            aspect_ratio = old_w / old_h

            # 1. ターゲットサイズの決定
            current_pixels = old_w * old_h
            if upscale_to == "match_divisible_by" and current_pixels < target_pixels:
                target_w = int(round(old_w / divisible_by) * divisible_by)
                target_h = int(round(old_h / divisible_by) * divisible_by)
            else:
                ideal_w = math.sqrt(target_pixels * aspect_ratio)
                ideal_h = target_pixels / ideal_w
                target_w = int(round(ideal_w / divisible_by) * divisible_by)
                target_h = int(round(ideal_h / divisible_by) * divisible_by)

            # 2. バイパス判定 (サイズが完璧なら何もしない)
            if old_w == target_w and old_h == target_h:
                out_images.append(img)
                out_widths.append(target_w)
                out_heights.append(target_h)
                pbar.update(1)
                continue

            # 3. リサイズ・クロップ処理
            actual_aspect = target_w / target_h
            distortion = abs(actual_aspect - aspect_ratio) / aspect_ratio

            if distortion <= distortion_threshold:
                final_img = self.perform_resize(img, target_w, target_h, upscale_method)
            else:
                resize_ratio = max(target_w / old_w, target_h / old_h)
                inter_w = int(math.ceil(old_w * resize_ratio))
                inter_h = int(math.ceil(old_h * resize_ratio))

                temp_img = self.perform_resize(img, inter_w, inter_h, upscale_method)
                x, y = self.calculate_crop_pos(temp_img, target_w, target_h, crop_position)
                final_img = temp_img[:, y:y+target_h, x:x+target_w, :]

            out_images.append(final_img)
            out_widths.append(target_w)
            out_heights.append(target_h)
            pbar.update(1)

        return (out_images, out_widths, out_heights)

    def perform_resize(self, img_tensor, tw, th, method):
        if method == "lanczos":
            # [1, H, W, C] -> PIL
            i = 255. * img_tensor[0].cpu().numpy()
            img_pil = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))
            img_pil = img_pil.resize((tw, th), resample=Image.LANCZOS)
            ret = np.array(img_pil).astype(np.float32) / 255.0
            return torch.from_numpy(ret).unsqueeze(0).to(img_tensor.device)
        else:
            t_img = img_tensor.permute(0, 3, 1, 2)
            t_img = F.interpolate(t_img, size=(th, tw), mode=method, align_corners=False)
            return t_img.permute(0, 2, 3, 1)

    def calculate_crop_pos(self, img, tw, th, pos):
        _, ih, iw, _ = img.shape
        dw, dh = iw - tw, ih - th

        if pos == "auto":
            if dw > 0:
                l_std = torch.std(img[:, :, :dw, :])
                r_std = torch.std(img[:, :, -dw:, :])
                pos = "right" if l_std < r_std else "left"
            else:
                t_std = torch.std(img[:, :dh, :, :])
                b_std = torch.std(img[:, -dh:, :, :])
                pos = "bottom" if t_std < b_std else "top"

        x = 0 if pos == "left" else dw if pos == "right" else dw // 2
        y = 0 if pos == "top" else dh if pos == "bottom" else dh // 2
        return x, y

#=============================================================================
class ImageRefinerNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "median_enabled": ("BOOLEAN", {"default": True}),
                "median_radius": ("INT", {"default": 1, "min": 1, "max": 8, "step": 1}),
                "denoise_enabled": ("BOOLEAN", {"default": False}),
                "denoise_intensity": ("FLOAT", {"default": 0.1, "min": 0.01, "max": 1.0, "step": 0.01}),
                "aa_enabled": ("BOOLEAN", {"default": True}),
                "aa_sigma": ("FLOAT", {"default": 0.5, "min": 0.1, "max": 5.0, "step": 0.1}),
                "sharpen_enabled": ("BOOLEAN", {"default": False}),
                "sharpen_amount": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.1}),
            }
        }

    INPUT_IS_LIST = True
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "refine_images"
    CATEGORY = CATEGORY_IMAGE

    def refine_images(self, images, median_enabled, median_radius, denoise_enabled, denoise_intensity, aa_enabled, aa_sigma, sharpen_enabled, sharpen_amount):
        flat_images_np = unpack_images(images)
        total_images = len(flat_images_np)

        # リスト入力の展開
        m_en = unpack_list(median_enabled); m_r = unpack_list(median_radius)
        d_en = unpack_list(denoise_enabled); d_i = unpack_list(denoise_intensity)
        a_en = unpack_list(aa_enabled); a_s = unpack_list(aa_sigma)
        s_en = unpack_list(sharpen_enabled); s_a = unpack_list(sharpen_amount)

        out_images = []
        pbar = comfy.utils.ProgressBar(total_images)
        device = comfy.model_management.get_torch_device()

        for i, img_np in enumerate(flat_images_np):
            if comfy.model_management.processing_interrupted():
                return (([ExecutionBlocker(None)],), )

            # numpy [H,W,3] -> tensor [1,3,H,W]
            img = torch.from_numpy(img_np).float().permute(2, 0, 1).unsqueeze(0).to(device)

            # 1. Median (大きなノイズ掃除)
            if m_en:
                img = self.apply_median(img, m_r)

            # 2. Denoise (Bilateral風: 面のザラつき抑制)
            if d_en:
                img = self.apply_denoise(img, d_i)

            # 3. Anti-Alias (エッジの馴染ませ)
            if a_en:
                img = self.apply_gaussian(img, a_s)

            # 4. Sharpen (ディテールの復元)
            if s_en:
                img = self.apply_sharpen(img, s_a)

            out_images.append(img.permute(0, 2, 3, 1).cpu())
            pbar.update(1)

        return (out_images,)

    def apply_median(self, x, r):
        k = 2 * r + 1
        b, c, h, w = x.shape
        # [B, C*k*k, L] に展開
        patches = F.unfold(x, kernel_size=k, padding=r)
        # チャンネルごとに分離して計算
        patches = patches.view(b, c, k*k, h*w)
        result, _ = torch.median(patches, dim=2)
        # 元の形状に戻す
        return result.view(b, c, h, w)

    def apply_denoise(self, x, intensity):
        # 簡易的なバイラテラル効果: 弱いガウシアンと元の画像のブレンド
        # 強度(intensity)に応じて、ディテールを保ちつつ平滑化
        blurred = self.apply_gaussian(x, sigma=intensity * 2.0)
        diff = torch.abs(x - blurred)
        mask = torch.exp(-diff / (intensity + 1e-5))
        return x * mask + blurred * (1.0 - mask)

    def apply_gaussian(self, x, sigma):
        k_size = int(2 * (math.ceil(sigma * 3)) + 1)
        t = torch.arange(k_size).float().to(x.device) - (k_size - 1) / 2
        kernel_1d = torch.exp(-t.pow(2) / (2 * sigma**2))
        kernel_1d = kernel_1d / kernel_1d.sum()
        kernel_2d = kernel_1d[:, None] * kernel_1d[None, :]
        kernel_2d = kernel_2d.expand(x.shape[1], 1, k_size, k_size)
        return F.conv2d(x, kernel_2d, padding=k_size//2, groups=x.shape[1])

    def apply_sharpen(self, x, amount):
        blurred = self.apply_gaussian(x, sigma=1.0)
        return torch.clamp(x + (x - blurred) * amount, 0.0, 1.0)