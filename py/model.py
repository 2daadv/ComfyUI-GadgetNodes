from __future__ import annotations
import re,json,os,yaml
import folder_paths
import comfy.samplers
import comfy.sd
import comfy.utils
from aiohttp import web
from server import PromptServer
from nodes import MAX_RESOLUTION
from .utils import *

CATEGORY_MODEL = "Gadget/model"
DEFAULT_PRESET = {
    "vae_name": "None",
    "clip_name": "None",
    "clip_type": "stable_diffusion",
    "clip_skip": -2,
    "steps": 30,
    "cfg": 7,
    "sampler_name": comfy.samplers.SAMPLER_NAMES[0],
    "scheduler": comfy.samplers.SCHEDULER_NAMES[0],
    "positive": "",
    "negative": "",
}
MODELS_CONFIG_FILE_PATH = BASE_DIR / "models_config.yaml"

@lru_cache(maxsize=1)
def get_models():
    return {
        **{name: "diffusion_models" for name in folder_paths.get_filename_list("diffusion_models")},
        **{name: "checkpoints" for name in folder_paths.get_filename_list("checkpoints")}
    }

def get_model_names():
    get_models.cache_clear()
    return list[str](get_models().keys())

def get_model_type(model_name):
    return get_models().get(model_name, None)

class CheckpointPresetLoaderNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_name": (get_model_names(),),
                "vae_name": (["None"] + folder_paths.get_filename_list("vae"),),
                "clip_name": (["None"] + folder_paths.get_filename_list("text_encoders"),),
                "clip_type": ([item.name.lower() for item in comfy.sd.CLIPType],),
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
    RETURN_TYPES = (any_type, any_type, any_type, any_type, "INT", "INT", "FLOAT", any_type, any_type, "STRING", "STRING")
    RETURN_NAMES = ("model_name", "vae_name", "clip_name", "clip_type", "clip_skip", "steps", "cfg", "sampler_name", "scheduler", "positive", "negative")
    FUNCTION = "run"
    CATEGORY = CATEGORY_MODEL

    def run(self, model_name, vae_name, clip_name, clip_type, clip_skip, steps, cfg, sampler_name, scheduler, positive="", negative="", preset_name=None):
        return (model_name, vae_name, clip_name, clip_type, clip_skip, steps, cfg, sampler_name, scheduler, positive, negative)


def get_model_preset(model_name):
    result = {}
    preset_names = []
    try:
        with open(MODELS_CONFIG_FILE_PATH, 'r', encoding='utf-8') as file:
            all_presets = yaml.safe_load(file)
            keywords = all_presets.pop("__keywords__")
            for preset_pattern, preset in all_presets.items():
                if re.search(str(preset_pattern), model_name):
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


@PromptServer.instance.routes.get("/gadget_nodes/model/get_model_preset")
async def get_model_preset_api(request):
    model_name = request.query.get("model_name", "")
    if model_name:
        preset = get_model_preset(model_name)
        if preset:
            return web.json_response(preset)
    return web.json_response({"error": "preset not found"}, status=404)

#=============================================================================
class LoadCheckpointOrDiffusionModelNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_name": (get_model_names(),),
                "clip_type": ([item.name.lower() for item in comfy.sd.CLIPType],),
                "clip_skip": ("INT", {"default": -2, "min": -9, "max": 0, "step": 1}),
            },
            "optional": {
                "clip_name": (["None"] + folder_paths.get_filename_list("text_encoders"),),
                "vae_name": (["None"] + folder_paths.get_filename_list("vae"),),
            },
        }
    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("model", "clip", "vae")
    FUNCTION = "run"
    CATEGORY = CATEGORY_MODEL

    @classmethod
    def VALIDATE_INPUTS(cls, model_name, clip_name=None, vae_name=None, **kwargs):
        if get_model_type(model_name) == "diffusion_models":
            if not clip_name or clip_name == "None":
                return "Diffusion Model requires clip_name."
            if not vae_name or vae_name == "None":
                return "Diffusion Model requires an external VAE."
        return True

    def run(self, model_name, clip_type, clip_skip, clip_name=None, vae_name=None):
        embedding_directory = folder_paths.get_folder_paths("embeddings")
        baked_vae = None
        model_type = get_model_type(model_name)

        if model_type == "diffusion_models":
            model_path = folder_paths.get_full_path_or_raise("diffusion_models", model_name)
            model = comfy.sd.load_diffusion_model(model_path)
            clip_path = folder_paths.get_full_path_or_raise("text_encoders", clip_name)
            clip = comfy.sd.load_clip(
                ckpt_paths=[clip_path],
                clip_type=getattr(comfy.sd.CLIPType, clip_type.upper(), comfy.sd.CLIPType.STABLE_DIFFUSION),
                embedding_directory=embedding_directory,
            )
        elif model_type == "checkpoints":
            model_path = folder_paths.get_full_path_or_raise("checkpoints", model_name)
            model, clip, baked_vae, _ = comfy.sd.load_checkpoint_guess_config(
                model_path,
                output_vae=True,
                output_clip=True,
                embedding_directory=embedding_directory,
            )

        if clip is not None and clip_skip < 0:
            clip = clip.clone()
            clip.clip_layer(clip_skip)

        if not vae_name or vae_name == "None":
            vae = baked_vae
        else:
            vae_path = folder_paths.get_full_path_or_raise("vae", vae_name)
            sd, metadata = comfy.utils.load_torch_file(vae_path, return_metadata=True)
            vae = comfy.sd.VAE(sd=sd, metadata=metadata)
            vae.throw_exception_if_invalid()
            vae.patcher.cached_patcher_init = (comfy.sd.load_vae_patcher, (vae_path, metadata, None))

        return (model, clip, vae)

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
    for ext in [".preview.jpeg", ".preview.jpg", ".preview.png", ".preview.webp", ".jpeg", ".png", ".jpg", ".webp"]:
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
                "model_name": (get_model_names(),),
            },
            "optional": {
                "description": ("STRING", {"default": "", "multiline": True}),
                "notes": ("STRING", {"default": "", "multiline": True}),
                "vae": ("STRING", {"default": "None", "multiline": False}),
            }
        }
    RETURN_TYPES = (any_type, "STRING", "STRING", "STRING",)
    RETURN_NAMES = ("model_name", "description", "notes", "vae",)
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = CATEGORY_MODEL

    def run(self, model_name, description="", notes="", vae="None",):
        return (model_name, description, notes, vae,)

@PromptServer.instance.routes.get("/gadget_nodes/model/get_model_info")
async def get_model_info(request):
    model_name = request.query.get("model_name", "")
    full_path = folder_paths.get_full_path(get_model_type(model_name), model_name)

    if not full_path:
        return web.json_response({"error": "model not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)

    json_data = {}
    if os.path.exists(base_path + ".json"):
        try:
            with open(base_path + ".json", "r", encoding="utf-8") as f:
                json_data = json.load(f)
        except: pass

    thumb_data = None
    for ext in [".preview.jpeg", ".preview.jpg", ".preview.png", ".preview.webp", ".jpeg", ".png", ".jpg", ".webp"]:
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

@PromptServer.instance.routes.post("/gadget_nodes/model/save_model_info")
async def save_model_info(request):
    data = await request.json()
    model_name = data.get("model_name")

    full_path = folder_paths.get_full_path(get_model_type(model_name), model_name)
    if not full_path:
        return web.json_response({"error": "model not found"}, status=404)

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
