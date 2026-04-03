from __future__ import annotations
import re,json,os,yaml
import folder_paths
import comfy.samplers
from aiohttp import web
from server import PromptServer
from nodes import MAX_RESOLUTION
from .utils import *

CATEGORY_MODEL = "Gadget/model"
DEFAULT_PRESET = {
    "vae_name": "None",
    "clip_skip": -2,
    "steps": 30,
    "cfg": 7,
    "sampler_name": comfy.samplers.SAMPLER_NAMES[0],
    "scheduler": comfy.samplers.SCHEDULER_NAMES[0],
    "positive": "",
    "negative": "",
}
MODELS_CONFIG_FILE_PATH = BASE_DIR / "models_config.yaml"


class CheckpointPresetLoaderNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"),),
                "vae_name": (["None"] + folder_paths.get_filename_list("vae"),),
                "clip_skip": ("INT", {"default": -2, "min": -9, "max": 0, "step": 1}),
                "steps": ("INT", {"default": 30, "min": 1, "max": MAX_RESOLUTION, "step": 1}),
                "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                "sampler_name": (comfy.samplers.SAMPLER_NAMES,),
                "scheduler": (comfy.samplers.SCHEDULER_NAMES,),
            },
            "optional": {
                "positive": ("STRING", {"default": "", "multiline": True}),
                "negative": ("STRING", {"default": "", "multiline": True}),
                "preset_name": ("STRING", {"default": "", "multiline": False}),
            }
        }
    RETURN_TYPES = (any_type, any_type, "INT", "INT", "FLOAT", any_type, any_type, "STRING", "STRING")
    RETURN_NAMES = ("ckpt_name", "vae_name", "clip_skip", "steps", "cfg", "sampler_name", "scheduler", "positive", "negative")
    FUNCTION = "run"
    CATEGORY = CATEGORY_MODEL

    def run(self, ckpt_name, vae_name, clip_skip, steps, cfg, sampler_name, scheduler, positive="", negative="", preset_name=None):
        return (ckpt_name, vae_name, clip_skip, steps, cfg, sampler_name, scheduler, positive, negative)


def get_ckpt_preset(ckpt_name):
    result = {}
    preset_names = []
    try:
        with open(MODELS_CONFIG_FILE_PATH, 'r', encoding='utf-8') as file:
            all_presets = yaml.safe_load(file)
            keywords = all_presets.pop("__keywords__")
            for preset_pattern, preset in all_presets.items():
                if re.search(str(preset_pattern), ckpt_name):
                    old_size = len(result)
                    result = preset | result
                    if old_size < len(result):
                        preset_names.append(preset_pattern)
            for k,v in keywords.items():
                result = result | {
                    "positive": str(result.get("positive", "")).replace(k, v),
                    "negative": str(result.get("negative", "")).replace(k, v)
                }
    except Exception:
        logger.exception(f"[GadgetNodes] Can't read {MODELS_CONFIG_FILE_PATH}.")
    result["preset_name"] = ", ".join(preset_names)
    return DEFAULT_PRESET | result


@PromptServer.instance.routes.get("/gadget_nodes/model/get_ckpt_preset")
async def get_ckpt_preset_api(request):
    ckpt_name = request.query.get("ckpt_name", "")
    if ckpt_name:
        preset = get_ckpt_preset(ckpt_name)
        if preset:
            return web.json_response(preset)
    return web.json_response({"error": "preset not found"}, status=404)

#=============================================================================
class SDLoraInfoEditorNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "lora_name": (folder_paths.get_filename_list("loras"),),
            },
            "optional": {
                "lora_prompt": ("STRING", {"default": "", "multiline": True}),
                "description": ("STRING", {"default": "", "multiline": True}),
                "sd_version": ("STRING", {"default": "SDXL", "multiline": False}),
                "activation_text": ("STRING", {"default": "", "multiline": True}),
                "preferred_weight": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.1}),
                "negative_text": ("STRING", {"default": "", "multiline": False}),
                "notes": ("STRING", {"default": "", "multiline": True}),
            }
        }
    RETURN_TYPES = (any_type, "STRING", "STRING", "STRING", "STRING", "FLOAT", "STRING", "STRING",)
    RETURN_NAMES = ("lora_name", "lora_prompt", "description", "sd_version", "activation_text", "preferred_weight", "negative_text", "notes")
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = CATEGORY_MODEL

    def run(self, lora_name, lora_prompt="", description="", sd_version="SDXL", activation_text="", preferred_weight=1.0, negative_text="", notes=""):
        return (lora_name, lora_prompt, description, sd_version, activation_text, preferred_weight, negative_text, notes)


@PromptServer.instance.routes.get("/gadget_nodes/model/get_lora_info")
async def get_lora_info(request):
    lora_name = request.query.get("lora_name", "")
    full_path = folder_paths.get_full_path("loras", lora_name)
    
    if not full_path:
        return web.json_response({"error": "lora not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)
    
    json_data = {}
    if os.path.exists(base_path + ".json"):
        try:
            with open(base_path + ".json", "r", encoding="utf-8") as f:
                json_data = json.load(f)
        except: pass

    thumb_data = None
    for ext in [".preview.jpeg", ".preview.jpg", ".preview.png", ".jpeg", ".png", ".jpg", ".webp"]:
        img_path = base_path + ext
        if os.path.exists(img_path):
            mimetype = get_image_mimetype(img_path)
            if mimetype:
                thumb_data = process_thumbnail(img_path)
                break

    return web.json_response({
        "json": json_data,
        "thumb": thumb_data
    })


@PromptServer.instance.routes.post("/gadget_nodes/model/save_lora_info")
async def save_lora_info(request):
    data = await request.json()
    lora_name = data.get("lora_name")
    
    full_path = folder_paths.get_full_path("loras", lora_name)
    if not full_path:
        return web.json_response({"error": "Lora path not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)
    json_path = base_path + ".json"

    save_data = {
        "description": data.get("description", ""),
        "sd version": data.get("sd_version", ""),
        "activation text": data.get("activation_text", ""),
        "preferred weight": data.get("preferred_weight", 1.0),
        "negative text": data.get("negative_text", ""),
        "notes": data.get("notes", ""),
    }

    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(save_data, f, indent=4, ensure_ascii=False)
        return web.json_response({"status": "success"})
    except Exception as e:
        logger.exception(f"[GadgetNodes] Can't write {json_path}.")
        return web.json_response({"error": str(e)}, status=500)


#=============================================================================
class SDCheckpointInfoEditorNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ckpt_name": (folder_paths.get_filename_list("checkpoints"),),
            },
            "optional": {
                "description": ("STRING", {"default": "", "multiline": True}),
                "notes": ("STRING", {"default": "", "multiline": True}),
                "vae": ("STRING", {"default": "None", "multiline": False}),
            }
        }
    RETURN_TYPES = (any_type, "STRING", "STRING", "STRING",)
    RETURN_NAMES = ("ckpt_name", "description", "notes", "vae",)
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = CATEGORY_MODEL

    def run(self, ckpt_name, description="", notes="", vae="None",):
        return (ckpt_name, description, notes, vae,)


@PromptServer.instance.routes.get("/gadget_nodes/model/get_ckpt_info")
async def get_ckpt_info(request):
    ckpt_name = request.query.get("ckpt_name", "")
    full_path = folder_paths.get_full_path("checkpoints", ckpt_name)

    if not full_path:
        return web.json_response({"error": "ckpt not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)

    json_data = {}
    if os.path.exists(base_path + ".json"):
        try:
            with open(base_path + ".json", "r", encoding="utf-8") as f:
                json_data = json.load(f)
        except: pass

    thumb_data = None
    for ext in [".preview.jpeg", ".preview.jpg", ".preview.png", ".jpeg", ".png", ".jpg", ".webp"]:
        img_path = base_path + ext
        if os.path.exists(img_path):
            mimetype = get_image_mimetype(img_path)
            if mimetype:
                thumb_data = process_thumbnail(img_path)
                break

    return web.json_response({
        "json": json_data,
        "thumb": thumb_data
    })

@PromptServer.instance.routes.post("/gadget_nodes/model/save_ckpt_info")
async def save_ckpt_info(request):
    data = await request.json()
    ckpt_name = data.get("ckpt_name")

    full_path = folder_paths.get_full_path("checkpoints", ckpt_name)
    if not full_path:
        return web.json_response({"error": "ckpt path not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)
    json_path = base_path + ".json"

    save_data = {
        "description": data.get("description", ""),
        "notes": data.get("notes", ""),
        "vae": data.get("vae", ""),
    }

    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(save_data, f, indent=4, ensure_ascii=False)
        return web.json_response({"status": "success"})
    except Exception as e:
        logger.exception(f"[GadgetNodes] Can't write {json_path}.")
        return web.json_response({"error": str(e)}, status=500)
