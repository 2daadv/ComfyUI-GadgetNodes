import re,os,yaml,json,io,base64,subprocess
import comfy.samplers
import folder_paths
from server import PromptServer
from aiohttp import web
from PIL import Image
from .utils import *

DEFAULT_PRESET = {
    "vae_name": "None",
    "clip_skip": -2,
    "steps": 30,
    "cfg": 7,
    "sampler_name": comfy.samplers.SAMPLER_NAMES[0],
    "scheduler_name": comfy.samplers.SCHEDULER_NAMES[0],
    "positive": "",
    "negative": "",
}

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
        logger.exception(f"[GadgetNodes] An error occured during read {MODELS_CONFIG_FILE_PATH}.")
    result["preset_name"] = ", ".join(preset_names)
    return DEFAULT_PRESET | result

@PromptServer.instance.routes.get("/gadget_nodes/get_ckpt_preset")
async def get_ckpt_preset_api(request):
    ckpt_name = request.query.get("ckpt_name", "")
    if ckpt_name:
        preset = get_ckpt_preset(ckpt_name)
        if preset:
            return web.json_response(preset)
    return web.json_response({"error": "preset not found"}, status=404)

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

@PromptServer.instance.routes.get("/gadget_nodes/get_lora_info")
async def get_lora_info(request):
    lora_name = request.query.get("lora_name", "")
    full_path = folder_paths.get_full_path("loras", lora_name)
    
    if not full_path:
        return web.json_response({"error": "lora not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)
    
    # JSONの読み込み
    json_data = {}
    if os.path.exists(base_path + ".json"):
        try:
            with open(base_path + ".json", "r", encoding="utf-8") as f:
                json_data = json.load(f)
        except: pass

    # 画像の探索とBase64化
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

@PromptServer.instance.routes.post("/gadget_nodes/save_lora_info")
async def save_lora_info(request):
    data = await request.json()
    lora_name = data.get("lora_name")
    
    full_path = folder_paths.get_full_path("loras", lora_name)
    if not full_path:
        return web.json_response({"error": "Lora path not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)
    json_path = base_path + ".json"

    # 保存するデータの構築（WebUI形式にキー名を合わせる）
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
        return web.json_response({"error": str(e)}, status=500)

@PromptServer.instance.routes.get("/gadget_nodes/get_ckpt_info")
async def get_ckpt_info(request):
    ckpt_name = request.query.get("ckpt_name", "")
    full_path = folder_paths.get_full_path("checkpoints", ckpt_name)

    if not full_path:
        return web.json_response({"error": "ckpt not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)

    # JSONの読み込み
    json_data = {}
    if os.path.exists(base_path + ".json"):
        try:
            with open(base_path + ".json", "r", encoding="utf-8") as f:
                json_data = json.load(f)
        except: pass

    # 画像の探索とBase64化
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

@PromptServer.instance.routes.post("/gadget_nodes/save_ckpt_info")
async def save_ckpt_info(request):
    data = await request.json()
    ckpt_name = data.get("ckpt_name")

    full_path = folder_paths.get_full_path("checkpoints", ckpt_name)
    if not full_path:
        return web.json_response({"error": "ckpt path not found"}, status=404)

    base_path, _ = os.path.splitext(full_path)
    json_path = base_path + ".json"

    # 保存するデータの構築（WebUI形式にキー名を合わせる）
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
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/gadget_nodes/get_prompts")
async def get_prompts(request):
    file_name = request.query.get("file_name")
    if not file_name:
        return web.json_response({"error": "No file specified"}, status=400)
    
    file_path = os.path.join(PROMPT_PATH, file_name)
    if not os.path.exists(file_path):
        return web.json_response({"error": "File not found"}, status=404)
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        return web.json_response(data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/gadget_nodes/open_editor")
async def open_editor(request):
    data = await request.json()
    file_name = data.get("file")
    file_path = os.path.normpath(os.path.join(PROMPT_PATH, file_name))
    
    if os.path.exists(file_path):
        if os.name == 'nt':  # Windows
            os.startfile(file_path)
        elif os.name == 'posix':  # macOS / Linux
            subprocess.call(('open' if os.sys.platform == 'darwin' else 'xdg-open', file_path))
        return web.json_response({"status": "ok"})
    return web.json_response({"status": "error"}, status=404)

#---------------

def load_train_config():
    try:
        with open(TRAIN_CONFIG_FILE_PATH, 'r', encoding='utf-8') as file:
            return yaml.safe_load(file) or {}
    except Exception:
        logger.exception(f"[GadgetNodes] An error occured during read {TRAIN_CONFIG_FILE_PATH}.")
    return {}

train_config = load_train_config()

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
