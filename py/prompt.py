from __future__ import annotations
import re,os,yaml,subprocess
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
            # コメントアウトを除去
            prompt = re.sub(r"/\*.*?\*/", "", raw_prompt, flags=re.DOTALL)
            prompt = re.sub(r"<!--.*?-->", "", prompt, flags=re.DOTALL)
            prompt = re.sub(r"#.*$", "", prompt, flags=re.MULTILINE)

            #各行の先頭・末尾の空白除去
            prompt = re.sub(r"(^ +| +$)", "", prompt, flags=re.MULTILINE)
            #改行を消して1行に連結
            prompt = re.sub(r"\n\n+", " ", prompt)
            #連続するカンマや、前後に空白のあるカンマをカンマ+空白にする
            prompt = re.sub(r"( *,+\s*)+", ", ", prompt)
            #先頭・末尾の余分なカンマを除去
            prompt = re.sub(r"(^, |, $)", "", prompt)
            prompt = translate_bracketed_text(prompt).strip()
            return (prompt,)
        return (raw_prompt,)


class AnalyzePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING", "BOOLEAN",)
    RETURN_NAMES = ("prompt", "facedetailer_enabled",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt:str):
        facedetailer_enabled = False
        if prompt:
            facedetailer_enabled = "☹" in prompt
            if facedetailer_enabled:
                prompt = prompt.replace("☹", "")
            if has_any_words(prompt, ("(nude|nipples?|pussy|anus|penis)", "(fellatio|irrumatio|deepthroat)", "(foot|hand|blow)job", "(sex|masturbation)")):
                if not has_word(prompt, "explicit"):
                    prompt = prompt + ", explicit"
                if not has_word(prompt, "uncensored"):
                    prompt = prompt + ", uncensored"
        return (prompt, facedetailer_enabled,)

class SplitPromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING", "STRING",)
    RETURN_NAMES = ("positive","negative",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt: str):
        # 1. 抽出とバリデーション(前方のカンマ/空白を巻き込んでマッチ)
        pattern = r",?\s*-\(([^)]+)\)"
        negatives = []

        def replace_func(match):
            inner = match.group(1)
            # バリデーション
            if "(" in inner or inner.count(":") > 1:
                raise ValueError(f"Invalid tag syntax: {match.group(0)}")

            normalized_tag = f"({inner.replace(':-', ':')})"
            negatives.append(normalized_tag)

            return ""

        # 2. 置換実行
        positive = re.sub(pattern, replace_func, prompt)

        # 3. 整形
        positive = positive.strip(", ")
        negative = ", ".join(negatives)

        return (positive, negative,)

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
            result = prompt.replace(", ", ",")
            result = re.sub(r'[\\/:*?"<>|\n\r\t]', "_", result, flags=re.MULTILINE)
            result = result[:200]
            result = re.sub("\\.+$", "_", result)
            return (result,)
        return ("ComfyUI",)

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
        logger.warning(f"[GadgetNodes] '{file_path}' not found.")
        return web.json_response({"error": "File not found"}, status=404)
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        return web.json_response(data)
    except Exception as e:
        logger.exception(f"[GadgetNodes] Can't read '{file_path}'.")
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
    logger.warning(f"[GadgetNodes] Can't open '{file_path}'.")
    return web.json_response({"status": "error"}, status=404)

