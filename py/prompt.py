from __future__ import annotations
import re,os,yaml,subprocess
import folder_paths
from .utils import *
from aiohttp import web
from server import PromptServer
from dynamicprompts.generators.combinatorial import CombinatorialPromptGenerator
from dynamicprompts.wildcards import WildcardManager

CATEGORY_PROMPT = "Gadget/prompt"
PROMPT_PATH = BASE_DIR / "prompt"
PROMPT_PATH.mkdir(parents=True, exist_ok=True)

class NormalizePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "raw_prompt": ("STRING", {"forceInput": True}),
                "translation_engine": ([e.value for e in TranslateEngine], {"default": TranslateEngine.NONE})
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, raw_prompt:str, translation_engine:str=TranslateEngine.NONE):
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
            engine = TranslateEngine(translation_engine)
            if engine != TranslateEngine.NONE:
                prompt = self.translate_bracketed_text(engine, prompt).strip()
            return (prompt,)
        return (raw_prompt,)

    def translate_bracketed_text(self, engine:TranslateEngine, prompt:str) -> str:
        return re.sub(r"「\s*([^」]*)\s*」", lambda m: translate_to_english(engine, m.group(1)), prompt)

class TranslatePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "translation_engine": ([e.value for e in TranslateEngine], {"default": TranslateEngine.NONE}),
                "temperature": ("FLOAT", {"default": 0.1, "min": 0.05, "max": 1.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.05}),
            },
            "optional": {
                "system_message": ("STRING", {"multiline": True}),
                "raw_prompt": ("STRING", {"multiline": True}),
                "translated_prompt": ("STRING", {"multiline": True}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY_PROMPT

    def run(self, translation_engine:str="None", temperature:float=0.1, top_p:float=0.9, system_message="", raw_prompt:str="", translated_prompt=""):
        if raw_prompt:
            engine = TranslateEngine(translation_engine)
            if engine != TranslateEngine.NONE:
                return (translate_to_english(engine, raw_prompt, system_message, temperature, top_p).strip(),)
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

class ExpandWildcardsNode:
    # キャッシュを保持するクラス変数
    _wildcard_manager_cache = None
    _last_path_cache = None

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "raw_prompt": ("STRING", {"multiline": True, "forceInput": True}),
            },
            "optional": {
                "max_variations": ("INT", {"default": 100, "min": 1, "max": 10000}),
                "auto_refresh": (["No", "Yes"], {"default": "No"}),
            }
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("prompts", "total_variations")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "run"
    CATEGORY = CATEGORY_PROMPT

    @classmethod
    def IS_CHANGED(cls, auto_refresh="No", **kwargs):
        # auto_refreshがYesの場合は常に再評価を行う
        if auto_refresh == "Yes":
            return float("NaN")
        return None

    def _find_wildcards_path(self) -> Path:
        # 1. ComfyUIのbase/wildcards
        base_wildcard_path = Path(folder_paths.base_path) / "wildcards"
        if base_wildcard_path.exists():
            return base_wildcard_path

        # 2. カスタムノード直下のwildcards
        node_dir = Path(os.path.dirname(os.path.realpath(__file__)))
        node_wildcard_path = node_dir / "wildcards"
        node_wildcard_path.mkdir(parents=True, exist_ok=True)

        return node_wildcard_path

    def _get_wildcard_manager(self, auto_refresh):
        target_path = self._find_wildcards_path()

        # キャッシュ条件: auto_refreshがYes、または未初期化、またはパス変更時
        if auto_refresh == "Yes" or self._wildcard_manager_cache is None or self._last_path_cache != target_path:
            logger.info(f"[GadgetNodes] Loading wildcards from: {target_path}")
            self._wildcard_manager_cache = WildcardManager(path=target_path)
            self._last_path_cache = target_path

        return self._wildcard_manager_cache

    def run(self, raw_prompt, max_variations=100, auto_refresh="No"):
        # マネージャー取得
        wm = self._get_wildcard_manager(auto_refresh)

        # CombinatorialGenerator初期化
        generator = CombinatorialPromptGenerator(wildcard_manager=wm)

        # 展開処理
        try:
            # 展開数が max_variations を超えないように制御
            prompts = list[str](generator.generate(raw_prompt, max_prompts=max_variations))
        except Exception:
            logger.exception(f"[GadgetNodes] Can't expand wildcards.")
            return ([], 0)

        return (prompts, len(prompts),)

class PromptToFileNameNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True}),
                "max_length": ("INT", {"default": 160, "min": 20, "max": 260}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt:str, max_length=160):
        if prompt:
            result = prompt.replace(", ", ",")
            result = re.sub(r'[\\/:*?"<>|\n\r\t]', "_", result, flags=re.MULTILINE)
            # 変数埋め込み後のフルパスがWindows制限(260)を超えないよう、ある程度の長さで切り捨てる。
            result = result[:max_length]
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

