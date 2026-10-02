from __future__ import annotations
import re,os,yaml,subprocess
import folder_paths
from .utils import *
from datetime import datetime
from aiohttp import web
from server import PromptServer
from dynamicprompts.generators.combinatorial import CombinatorialPromptGenerator
from dynamicprompts.wildcards import WildcardManager

CATEGORY_PROMPT = "Gadget/prompt"
PROMPT_PATH = BASE_DIR / "prompt"
PROMPT_PATH.mkdir(parents=True, exist_ok=True)

#### TODO ##################################################################################################################################
# translation_engineに前回値が指定された状態で、モデルが存在しない／Ollama停止中 などの状況でJOB実行時に翻訳対象がなくてもエラーを吐く。
# 上記エラーを抑制するには、型をリストからSTRINGにする必要がある。
# ただし、そのままでは不便なためjs側で入力補完や選択可能な候補のリスト表示・選択が出来ることが望ましい。
# 比較的難易度が高いようで、Geminiだと解決できなかったため、Cursorでやりたい。
############################################################################################################################################

class NormalizePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "raw_prompt": ("STRING", {"forceInput": True}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, raw_prompt:str):
        prompt = normalize_prompt(raw_prompt)
        logger.info(f"[GadgetNodes] Normalized: {prompt}")
        return (prompt,)

class TranslatePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "translation_engine": (get_translation_engines(), {"default": "None"}),
                "temperature": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 1.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.05}),
            },
            "optional": {
                "system_message": ("STRING", {"multiline": True}),
                "raw_prompt": ("STRING", {"multiline": True}),
                "translated_prompt": ("STRING", {"multiline": True}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("translated_prompt",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, translation_engine:str="None", temperature:float=0.1, top_p:float=0.9, system_message="", raw_prompt:str="", translated_prompt=""):
        raw_prompt = defaultStr(raw_prompt)
        translation_engine = defaultStr(translation_engine, "None")
        if "「" in raw_prompt and "」" in raw_prompt:
            translated_prompt = translate_bracketed_text(translation_engine, raw_prompt, system_message, temperature, top_p).strip()
        else:
            translated_prompt = translate_to_english(translation_engine, raw_prompt, system_message, temperature, top_p).strip()
        return {
            "ui": {"translated_prompt": (translated_prompt,)},
            "result": (translated_prompt,),
        }

@PromptServer.instance.routes.get("/gadget_nodes/prompt/translation_engines")
async def api_get_translation_engines(request):
    return web.json_response(get_translation_engines())

@PromptServer.instance.routes.post("/gadget_nodes/prompt/translate")
async def api_translate_prompt(request):
    data = await request.json()
    raw_prompt = defaultStr(data.get("raw_prompt"))
    translation_engine = defaultStr(data.get("translation_engine"))
    system_message = defaultStr(data.get("system_message"))
    temperature = float(data.get("temperature", 0.1))
    top_p = float(data.get("top_p", 0.9))
    try:
        if "「" in raw_prompt and "」" in raw_prompt:
            translated = translate_bracketed_text(translation_engine, raw_prompt, system_message, temperature, top_p).strip()
        else:
            translated = translate_to_english(translation_engine, raw_prompt, system_message, temperature, top_p).strip()
        return web.json_response({"translated_prompt": translated})
    except:
        logger.exception("[GadgetNodes] translate API failed.")
        return web.json_response({"translated_prompt": raw_prompt})

class AnalyzePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING", "BOOLEAN", "BOOLEAN",)
    RETURN_NAMES = ("prompt", "facedetailer_enabled", "handrefiner_enabled",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt:str):
        facedetailer_enabled = False
        handrefiner_enabled = False
        if prompt:
            facedetailer_enabled = "☹" in prompt
            if facedetailer_enabled:
                prompt = prompt.replace("☹", "")
            handrefiner_enabled = "✌" in prompt
            if handrefiner_enabled:
                prompt = prompt.replace("✌", "")
            if has_any_words(prompt, ("(nude|nipples?|pussy|anus|penis)", "(fellatio|irrumatio|deepthroat)", "(foot|hand|blow)job", "(sex|masturbation)"), False):
                if not has_word(prompt, "explicit", False):
                    prompt = prompt + ", explicit"
                if not has_word(prompt, "uncensored", False):
                    prompt = prompt + ", uncensored"
        return (prompt, facedetailer_enabled, handrefiner_enabled,)

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
        node_dir = Path(os.path.dirname(os.path.realpath(__file__))).parent
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
                "file_name_format": ("STRING", {"default": "%time-%prompt"}),
                "time_format": ("STRING", {"default": "%Y%m%d%H%M%S"}),
                "max_length": ("INT", {"default": 175, "min": 20, "max": 260}),
            }
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_PROMPT

    def run(self, prompt:str, file_name_format:str, time_format:str, max_length:int=175):
        # 1. プロンプトのサニタイズ処理
        clean_prompt = "ComfyUI"
        if prompt:
            result = prompt.replace(", ", ",")
            # ファイル名に使えない文字や制御文字を置換
            result = re.sub(r'[\\/:*?"<>|\n\r\t]', "_", result, flags=re.MULTILINE)
            clean_prompt = result

        # 2. 現在時刻のフォーマット変換
        current_time = datetime.now().strftime(time_format)
        # 3. file_name_format 内のプレースホルダーを置換
        filename = file_name_format.replace("%time", current_time).replace("%prompt", clean_prompt)

        # 4. 全体の長さが max_length を超えないように切り捨て
        if len(filename) > max_length:
            filename = filename[:max_length]
        # 末尾がドットで終わらないように調整
        filename = re.sub(r"\.+$", "_", filename)

        return (filename,)

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

#=============================================================================

class EvalPromptsNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "positive": ("STRING", {"forceInput": True}),
                "negative": ("STRING", {"forceInput": True}),
            },
            "optional": {
                "model_name": ("STRING", {"forceInput": True}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "run"
    CATEGORY = CATEGORY_PROMPT

    def run(self, positive, negative, model_name=""):
        # ifタグとその中身を丸ごと除去する正規表現（閉じタグなし含む）
        if_removal_pattern = re.compile(r'<if\b[^>]*>.*?(?:</if>|$)', re.DOTALL | re.IGNORECASE)
        # --- 【PASS 1: Positive 処理】 ---
        # スナップショット作成: Positive/Negative 両方から if タグと中身を全て除去
        snapshot_pos_base = normalize_prompt(if_removal_pattern.sub('', positive))
        snapshot_neg_base = normalize_prompt(if_removal_pattern.sub('', negative))
        model_name = model_name.replace("\\", "/") if model_name else ""

        evaluator_pos = PromptEvaluator(
            default_target=snapshot_pos_base,
            pos_snapshot=snapshot_pos_base,
            neg_snapshot=snapshot_neg_base,
            model_name = model_name
        )
        final_positive = normalize_prompt(evaluator_pos.process_text(positive))

        # --- 【PASS 2: Negative 処理】 ---
        # スナップショット作成: Positive は確定後のテキスト、Negative は if タグと中身を除去したテキスト
        evaluator_neg = PromptEvaluator(
            default_target=snapshot_neg_base,
            pos_snapshot=final_positive,
            neg_snapshot=snapshot_neg_base,
            model_name = model_name
        )
        final_negative = normalize_prompt(evaluator_neg.process_text(negative))

        return (final_positive, final_negative,)


class PromptEvaluator:
    def __init__(self, default_target:str, pos_snapshot:str, neg_snapshot:str, model_name:str):
        self.default_target = default_target
        self.pos_snapshot = pos_snapshot
        self.neg_snapshot = neg_snapshot
        self.model_name = model_name

        # <if ...>中身</if> または 閉じタグなしの <if ...>中身
        self.if_pattern = re.compile(r'<if\b([^>]*)>(.*?)(?:</if>|$)', re.DOTALL | re.IGNORECASE)
        # 属性抽出用 (例: all="..." または not model pos neg)
        self.attr_pattern = re.compile(r'(\b\w+\b)(?:=(?:"([^"]*)"|\'([^\']*)\'|(\S+)))?')

    def process_text(self, text):
        def replace_tag(match):
            attr_str = match.group(1)
            content = match.group(2)

            # 属性のパース
            attributes = self._parse_attributes(attr_str)

            # 条件評価
            if self._evaluate_condition(attributes):
                return content
            else:
                return ""

        return self.if_pattern.sub(replace_tag, text)

    def _parse_attributes(self, attr_str):
        attributes = {}

        matches = self.attr_pattern.findall(attr_str)
        for key, val1, val2, val3 in matches:
            key_lower = key.lower()
            val = val1 or val2 or val3
            attributes[key_lower] = val.strip() if val else ""

        return attributes

    def _evaluate_condition(self, attributes):
        # 判定対象のターゲット決定
        if "pos" in attributes:
            target_text = self.pos_snapshot
        elif "neg" in attributes:
            target_text = self.neg_snapshot
        else:
            target_text = self.default_target

        # 条件パラメータの取得
        model_param = attributes.get("model")
        all_param = attributes.get("all")
        any_param = attributes.get("any")
        matches_param = attributes.get("matches")
        is_not = "not" in attributes

        conditions_met = [ True ]
        # model 判定 (正規表現)
        if model_param:
            try:
                conditions_met.append(bool(re.search(model_param, self.model_name, re.IGNORECASE)))
            except re.error as e:
                logger.warning(f"[GadgetNodes] if-model regex error at {model_param}: {e}")
                conditions_met.append(False)

        # all 判定
        if all_param:
            items = tuple(all_param.split(','))
            all_result = has_all_words(target_text, items, True) if items else True
            conditions_met.append(all_result)

        # any 判定
        if any_param:
            items = tuple(any_param.split(','))
            any_result = has_any_words(target_text, items, True) if items else True
            conditions_met.append(any_result)

        # matches 判定 (正規表現)
        if matches_param:
            try:
                match_result = bool(re.search(matches_param, target_text, re.IGNORECASE))
            except re.error as e:
                # 正規表現エラー時は False 扱い
                logger.warning(f"[GadgetNodes] if-matches regex error at {matches_param}: {e}")
                match_result = False
            conditions_met.append(match_result)

        # 全ての指定条件を AND 評価
        final_result = all(conditions_met)

        # [not] フラグ指定時は結果を反転
        return not final_result if is_not else final_result
