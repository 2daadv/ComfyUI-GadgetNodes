from __future__ import annotations
import re,os,subprocess
from .utils import *
from aiohttp import web
from server import PromptServer

CATEGORY_PROMPT = "Gadget/prompt"
PROMPT_PATH = BASE_DIR / "prompt"
PROMPT_PATH.mkdir(parents=True, exist_ok=True)

class NormalizePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "raw_prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, raw_prompt:str):
        if raw_prompt:
            prompt = re.sub(r"#.*$", "", raw_prompt, flags=re.MULTILINE)
            prompt = re.sub(r"(^ +| +$)", "", prompt, flags=re.MULTILINE)
            prompt = re.sub(r"\n\n+", "", prompt)
            prompt = re.sub(r"( *,+\s*)+", ",", prompt)
            prompt = re.sub(r"(^,+|,+$)", "", prompt)
            return (prompt,)
        return (raw_prompt,)


class CheckNsfwPromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("BOOLEAN",)
    RETURN_NAMES = ("is_nsfw",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt:str):
        if prompt:
            return (
                re.search(r"irrumatio|deepthroat|cunnilingus|anilingus|nipple|completely nude", prompt) or
                re.search(r", *(sex|pussy|anus|penis|pee|[^,]+job)| (sex|pussy|anus|penis) *,", prompt)
                ,)
        return (False,)

class PromptToFileNameNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt:str):
        if prompt:
            result ="%date%-%seed%-%model%-"
            result = result + re.sub(r'[\\/:*?"<>|\n\r\t]', "_", prompt, flags=re.MULTILINE)
            result = result[:80]
            result = re.sub("\\.+$", "_", result)
            return (result,)
        return ("%date%-%seed%-%model%-ComfyUI",)


#=============================================================================
class PromptPaletteNode:
    @classmethod
    def INPUT_TYPES(s):
        files = [f.name for f in PROMPT_PATH.glob('*.y*ml')]
        return {
            "required": {
                "file_name": (sorted(files),),
            }
        }
    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = CATEGORY_PROMPT

    def run(self, file_name):
        return ()


@PromptServer.instance.routes.get("/gadget_nodes/prompt/get_prompts")
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


@PromptServer.instance.routes.post("/gadget_nodes/prompt/open_editor")
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
