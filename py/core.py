
from __future__ import annotations
import os, torch
import folder_paths
from abc import ABC
from .utils import *

CATEGORY_CORE = "Gadget/core"
CATEGORY_CORE_CONST = f"{CATEGORY_CORE}/const"

class AnyPrintNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "optional": {
                "name": ("STRING", {"default": ""}),
                "value": (any_type, {"forceInput": True})
            }
        }
    INPUT_IS_LIST = True
    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("value",)
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = CATEGORY_CORE

    def run(self, name="", value=None):
        name = unpack_list(name)
        label = name if name and name.strip() != "" else None
        display_value = value[0] if (isinstance(value, list) and len(value) == 1) else value
        self.dump_data(display_value, label=label)
        return (value,)

    def format_summary(self, data):
        if isinstance(data, (int, float, bool, str)):
            return f"{type(data).__name__}: {str(data)}"
        elif isinstance(data, torch.Tensor):
            # Batchサイズを明示的に判定して表示
            batch_size = data.shape[0]
            batch_str = f"Batch: {batch_size}, " if data.dim() > 1 and batch_size > 1 else ""
            return f"[Tensor] {batch_str}Shape: {list(data.shape)}, Dtype: {data.dtype}, Device: {data.device}"
        s = str(data)
        return f"{type(data).__name__}: {s[:100]}{'...' if len(s) > 100 else ''}"

    def dump_data(self, data, depth=0, current_stack=None, label=None, path=""):
        if current_stack is None:
            current_stack = set()

        indent = "  " * depth
        prefix_str = f"{label} = " if label else ""
        full_indent = f"[GadgetNodes] {indent}{prefix_str}"

        obj_id = id(data)
        current_path = f"{path} -> {label}" if label else "root"

        # 循環参照チェック: 現在の処理スタック内に同一IDが存在するか
        if obj_id in current_stack:
            logger.error(f"{full_indent}<Circular Reference> Detected!")
            logger.error(f"[GadgetNodes] {indent}  Path: {current_path} (ID: {obj_id})")
            return
        current_stack.add(obj_id)

        # 型に応じた出力処理
        if isinstance(data, dict):
            logger.info(f"{full_indent}Dict[{len(data)}]:")
            for key, val in data.items():
                self.dump_data(val, depth + 1, current_stack, label=str(key), path=current_path)
        elif isinstance(data, list):
            logger.info(f"{full_indent}List[{len(data)}]:")
            for i, item in enumerate(data):
                self.dump_data(item, depth + 1, current_stack, label=f"[{i}]", path=current_path)
        else:
            logger.info(f"{full_indent}{self.format_summary(data)}")

        # 処理終了後にスタックから除去（再帰的な共有データは通過可能にするため）
        current_stack.remove(obj_id)

class InputFolderSelectNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder": (["."] + folder_paths.get_input_subfolders(),),
                "with_base_path": ("BOOLEAN", {"default": True}),
            },
        }
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("folder",)
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_CORE

    def run(self, folder:str, with_base_path:bool):
        base_folder = "input" if with_base_path else ""
        return (os.path.join(base_folder, folder),)


class BaseIntNode(ABC):
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}
    RETURN_TYPES = ("INT",)
    FUNCTION = "value"
    OUTPUT_NODE = False
    CATEGORY = CATEGORY_CORE_CONST
    VAL = None
    def value(self):
        return (self.VAL,)

class Int0Node(BaseIntNode):
    RETURN_NAMES = ("0",)
    VAL = 0

class Int1Node(BaseIntNode):
    RETURN_NAMES = ("1",)
    VAL = 1

class Int_1Node(BaseIntNode):
    RETURN_NAMES = ("-1",)
    VAL = -1

class Int64Node(BaseIntNode):
    RETURN_NAMES = ("64",)
    VAL = 64

class Int256Node(BaseIntNode):
    RETURN_NAMES = ("256",)
    VAL = 256

class Int512Node(BaseIntNode):
    RETURN_NAMES = ("512",)
    VAL = 512

class Int1024Node(BaseIntNode):
    RETURN_NAMES = ("1024",)
    VAL = 1024
