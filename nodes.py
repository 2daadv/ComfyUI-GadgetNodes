from __future__ import annotations
import re,os
import folder_paths
import comfy.samplers
from nodes import MAX_RESOLUTION
from .utils import *

#https://www.reddit.com/r/comfyui/comments/18wp6oj/tutorial_create_a_custom_node_in_5_minutes/?tl=ja
class NormalizePromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "raw_prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("prompt", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/prompt"

    def run(self, raw_prompt:str):
        if raw_prompt:
            prompt = re.sub(r"#.*$", "", raw_prompt, flags=re.MULTILINE)
            prompt = re.sub(r"(^ +| +$)", "", prompt, flags=re.MULTILINE)
            prompt = re.sub(r"\n\n+", "", prompt)
            prompt = re.sub(r"( *,+\s*)+", ",", prompt)
            prompt = re.sub(r"(^,+|,+$)", "", prompt)
            return (prompt, )
        return (raw_prompt, )


class CheckNsfwPromptNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("BOOLEAN", )
    RETURN_NAMES = ("is_nsfw", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/prompt"

    def run(self, prompt:str):
        if prompt:
            return (
                re.search(r"irrumatio|deepthroat|cunnilingus|anilingus|nipple|completely nude", prompt) or
                re.search(r", *(sex|pussy|anus|penis|pee|[^,]+job)| (sex|pussy|anus|penis) *,", prompt)
                ,)
        return (False, )

class PromptToFileNameNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("filename", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/prompt"

    def run(self, prompt:str):
        if prompt:
            result ="%date%-%seed%-%model%-"
            result = result + re.sub(r'[\\/:*?"<>|\n\r\t]', "_", prompt, flags=re.MULTILINE)
            result = result[:80]
            result = re.sub("\\.+$", "_", result)
            return (result, )
        return ("%date%-%seed%-%model%-ComfyUI", )


class AnyPassNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "value": (any_type, {"forceInput": True})
            }
        }
    RETURN_TYPES = (any_type, )
    RETURN_NAMES = ("value", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/logic"

    def run(self, value):
        return (value, )


class IncrementNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "i": ("INT", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("INT", )
    RETURN_NAMES = ("i + 1", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/logic"

    def run(self, i:int):
        return (i + 1, )


class DecrementNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "i": ("INT", {"forceInput": True})
            }
        }
    RETURN_TYPES = ("INT", )
    RETURN_NAMES = ("i - 1", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/logic"

    def run(self, i:int):
        return (i - 1, )


class SelectNthItemsOfAnyListNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "any_list": (any_type, {"forceInput": True}),
                "index_list": ("INT", {"forceInput": True, "tooltip": "The index of the items you want to select from the list. Use negative values to select from the end (e.g., -1 for last item, -2 for second to last)."}),
            }
        }

    RETURN_TYPES = (any_type,)
    RETURN_NAMES = ("any_list",)
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "run"

    CATEGORY = "Gadget/list"

    DESCRIPTION = "Selects the Nth items from a list. If the index is out of range, it was omit."

    def run(self, any_list, index_list):
        results = []
        flatten_list = flatten(any_list)
        list_len = len(flatten_list)
        if list_len:
            for i in flatten(index_list):
                if -list_len <= i < list_len:
                    results.append(flatten_list[i])
        return (results,)


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
                "scheduler_name": (comfy.samplers.SCHEDULER_NAMES,),
            },
            "optional": {
                "positive": ("STRING", {"default": "", "multiline": True}),
                "negative": ("STRING", {"default": "", "multiline": True}),
                "preset_name": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (any_type, any_type, "INT", "INT", "FLOAT", comfy.samplers.KSampler.SAMPLERS, comfy.samplers.SCHEDULER_NAMES, "STRING", "STRING")
    RETURN_NAMES = ("ckpt_name", "vae_name", "clip_skip", "steps", "cfg", "sampler_name", "scheduler_name", "positive", "negative")
    FUNCTION = "run"
    CATEGORY = "Gadget/model"

    def run(self, ckpt_name, vae_name, clip_skip, steps, cfg, sampler_name, scheduler_name, positive="", negative="", preset_name=None):
        return (ckpt_name, vae_name, clip_skip, steps, cfg, sampler_name, scheduler_name, positive, negative)


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
                "sd_version": ("STRING", {"default": "", "multiline": False}),
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
    CATEGORY = "Gadget/model"

    def run(self, lora_name, lora_prompt="", description="", sd_version="", activation_text="", preferred_weight=1.0, negative_text="", notes=""):
        return (lora_name, lora_prompt, description, sd_version, activation_text, preferred_weight, negative_text, notes)


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
                "vae": ("STRING", {"default": "", "multiline": False}),
            }
        }

    RETURN_TYPES = (any_type, "STRING", "STRING", "STRING",)
    RETURN_NAMES = ("ckpt_name", "description", "notes", "vae",)
    OUTPUT_NODE = True
    FUNCTION = "run"
    CATEGORY = "Gadget/model"

    def run(self, ckpt_name, description="", notes="", vae="",):
        return (ckpt_name, description, notes, vae,)


class PromptPaletteNode:
    @classmethod
    def INPUT_TYPES(s):
        files = [f for f in os.listdir(PROMPT_PATH) if f.endswith(('.yaml', '.yml'))]
        return {
            "required": {
                "file_name": (sorted(files),),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = "Gadget/prompt"

    def run(self, file_name):
        return ()

class InputFolderSelectNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder": (["."] + folder_paths.get_input_subfolders(),),
                "with_base_path": ("BOOLEAN", {"default": True}),
            },
        }
    RETURN_TYPES = ("STRING", )
    RETURN_NAMES = ("folder", )
    FUNCTION = "run"
    OUTPUT_NODE = False
    CATEGORY = "Gadget/system"

    def run(self, folder:str, with_base_path:bool):
        base_folder = "input" if with_base_path else ""
        return (os.path.join(base_folder, folder), )

class TrainTagsEditNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "folder_path": ("STRING", {"default": ""}), 
                "selected_image": ([],), 
            },
            "optional": {
                "tags_input": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "Gadget/train"

    def noop(self, **kwargs):
        return ()
