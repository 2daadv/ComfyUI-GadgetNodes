
from __future__ import annotations
import os
import folder_paths
from abc import ABC
from .utils import *

CATEGORY_CORE = "Gadget/core"
CATEGORY_CORE_CONST = f"{CATEGORY_CORE}/const"

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
