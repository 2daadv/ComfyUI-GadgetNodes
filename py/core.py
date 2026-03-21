
from __future__ import annotations
import os
import folder_paths
from .utils import *

CATEGORY_CORE = "Gadget/core"

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